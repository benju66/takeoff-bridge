/**
 * Linked Values System — value registry (Phase 2).
 *
 * The APP-AWARE bridge between the pure calculation engine (calculations.ts) and
 * the kind-blind binding graph (graph.ts). Its one job: turn the existing calc
 * results into source `GraphNode`s with the stable IDs from the spec (§2.2), so the
 * 10 hardcoded linked-division rows can be re-expressed as generic `lookup` bindings
 * and evaluated through the same engine a future formula kind will use.
 *
 * This is the ONLY bindings module that imports app concepts (constants, calc-result
 * types, the row type). The graph/compiler core stay indifferent to all of it (LD-4):
 * this module emits plain `GraphNode`s and `Binding`s and teaches the graph no kind.
 *
 * Phase 2 is a drop-in proof: the engine reproduces `computeLinkedDivisionTotals`
 * (app-born) and `linkedTotalsFromRows` (imported) to the cent, then the pages read
 * the engine's output instead — with zero golden movement.
 *
 * BRANCH-AWARENESS (the §6 highest-risk item): for an IMPORTED project the linked
 * rows are frozen, hand-authored values on the saved estimate — they must NOT be
 * re-derived from STEP 2/3. So the imported entry point sources the linked node
 * values as CONSTANTS from the saved rows, never as lookups into STEP 2/3.
 */

import { compileBindingToNode, lineFieldNodeId } from "./compile";
import { evaluateGraph } from "./graph";
import { describeEngineGraph, type EngineGraphTier } from "./engineGraph";
import type { Basis, Binding, BindingLine, GraphNode, RollupField } from "./types";
import {
  LINKED_DIVISION_ROWS,
  SUPERVISION_STAFF_CODES,
  SITE_OPS_DYNAMIC_DEFAULTS,
  SITE_OPS_MANUAL_DEFAULTS,
  SITE_OPS_SECTIONS,
  isLinkedDivisionRow,
  type LinkedDivisionSource,
  type SiteOpsSection,
} from "../constants";
import type {
  LinkedDivisionTotal,
  PersonnelCalcResult,
  SiteOpsCalcResult,
  TakeoffSummary,
} from "../calculations";
import type { ProcessedTakeoffRow } from "@/types";

// ---------------------------------------------------------------------------
// Stable node IDs (spec §2.2) — by-ID / by-query, never by cell position
// ---------------------------------------------------------------------------

/** STEP 2 — Σ supervision staff lines (template "Total Supervision", I16). */
export const GC_SUPERVISION_NODE_ID = "gc:supervisionSubtotal";
/** STEP 2 — personnel grand total (all GC lines). */
export const GC_GRAND_TOTAL_NODE_ID = "gc:grandTotal";
/** STEP 2 — Design/PM/GCs (grand total − supervision; a DERIVED value, not a raw subtotal). */
export const GC_GENERAL_NODE_ID = "gc:general";

/** STEP 3 — one Site-Ops template subtotal section. */
export function siteOpsSectionNodeId(section: SiteOpsSection): string {
  return `siteops:${section}`;
}

/**
 * The stable node ID for a linked STEP 4 division row's total. The linked rows are
 * uniquely identified by their catalog `itemId` (every consumer keys them by itemId;
 * duplicates are deduped), so the itemId is their stable row identity here.
 */
export function linkedRowTotalNodeId(itemId: string): string {
  return lineFieldNodeId(itemId, "total");
}

// ---------------------------------------------------------------------------
// Source-node construction
// ---------------------------------------------------------------------------

/** A constant source node: no inputs, evaluates to a fixed value. */
function constantNode(id: string, value: number, basis: Basis = "currency"): GraphNode {
  return { id, basis, inputs: [], evaluate: () => value };
}

/** Σ staff lines whose code is a supervision code (mirrors the oracle exactly). */
function supervisionSubtotal(gc: PersonnelCalcResult): number {
  return gc.staffLines
    .filter((l) => SUPERVISION_STAFF_CODES.includes(l.code))
    .reduce((sum, l) => sum + l.total, 0);
}

/**
 * Site-Ops line code → template subtotal section, summed into per-section totals.
 * Keyed by the Site-Ops config code (never by a STEP 4 itemId) — this is why the
 * "02-4100.002" string collision between the STEP 3 sawcutting line and the STEP 4
 * Demolition linked row cannot cross-contaminate (constants.ts §LINKED_DIVISION_ROWS).
 */
function sectionTotalsByCode(siteOps: SiteOpsCalcResult): Map<SiteOpsSection, number> {
  const sectionByCode = new Map<string, SiteOpsSection>();
  for (const cfg of SITE_OPS_DYNAMIC_DEFAULTS) sectionByCode.set(cfg.code, cfg.section);
  for (const cfg of SITE_OPS_MANUAL_DEFAULTS) sectionByCode.set(cfg.code, cfg.section);

  const totals = new Map<SiteOpsSection, number>();
  for (const line of [...siteOps.dynamicLines, ...siteOps.manualLines]) {
    const section = sectionByCode.get(line.code);
    if (!section) continue; // unknown line — the constants test guards against this
    totals.set(section, (totals.get(section) ?? 0) + line.total);
  }
  return totals;
}

/**
 * The three STEP 2 GC source nodes. `gc:grandTotal` and `gc:supervisionSubtotal` are
 * constants; `gc:general` is a DERIVED node (grandTotal − supervision) that depends on
 * the other two — so the graph orders it after them, and it stays faithful to the
 * oracle's "gcGeneralTotal is a derived value, not a raw subtotal". Shared by the
 * golden linked-division path and the user-binding source set.
 */
function gcSourceNodes(gc: PersonnelCalcResult): GraphNode[] {
  const supervision = supervisionSubtotal(gc);
  return [
    constantNode(GC_GRAND_TOTAL_NODE_ID, gc.grandTotal),
    constantNode(GC_SUPERVISION_NODE_ID, supervision),
    {
      id: GC_GENERAL_NODE_ID,
      basis: "currency",
      inputs: [GC_GRAND_TOTAL_NODE_ID, GC_SUPERVISION_NODE_ID],
      evaluate: (m) =>
        (m.get(GC_GRAND_TOTAL_NODE_ID) ?? 0) - (m.get(GC_SUPERVISION_NODE_ID) ?? 0),
    },
  ];
}

/**
 * The STEP 2/3 computed values the 10 linked lookups read, as source `GraphNode`s
 * (app-born branch). The 3 GC nodes plus one `siteops:<section>` constant per section
 * a linked row references. Kept byte-identical (same nodes, same order) — it backs the
 * golden tie-out, so it must NEVER widen beyond what the linked rows read.
 */
export function gcSiteOpsSourceNodes(
  gc: PersonnelCalcResult,
  siteOps: SiteOpsCalcResult
): GraphNode[] {
  const sectionTotals = sectionTotalsByCode(siteOps);
  const nodes = gcSourceNodes(gc);

  // Emit a source node only for the sections the linked rows actually read.
  const sections = new Set<SiteOpsSection>();
  for (const cfg of LINKED_DIVISION_ROWS) {
    if (cfg.source.kind === "siteOpsSection") sections.add(cfg.source.section);
  }
  for (const section of sections) {
    nodes.push(constantNode(siteOpsSectionNodeId(section), sectionTotals.get(section) ?? 0));
  }
  return nodes;
}

/**
 * EVERY Site-Ops section as a `siteops:<section>` source node (not just the ones the
 * linked rows reference). Used by the user-binding source set so the authoring picker
 * can offer any section and the lookup resolves to a real value (an unreferenced
 * section's total is 0). Distinct from `gcSiteOpsSourceNodes`, which stays narrow for
 * the golden tie-out.
 */
function allSiteOpsSectionNodes(siteOps: SiteOpsCalcResult): GraphNode[] {
  const sectionTotals = sectionTotalsByCode(siteOps);
  return SITE_OPS_SECTIONS.map((s) =>
    constantNode(siteOpsSectionNodeId(s.id), sectionTotals.get(s.id) ?? 0)
  );
}

/**
 * The FULL set of source nodes a USER binding may read (spec §2.2, the addressability
 * ceiling): the 3 GC computed values, every Site-Ops section, and every line's
 * aggregatable field (`line:<id>:total|unitPrice|matchedQty`). A superset of the golden
 * `gcSiteOpsSourceNodes` (extra constants are harmless to an unrelated binding), it is
 * the single source set both the recompute and the authoring picker draw from — so the
 * picker can only ever offer a node the engine actually evaluates.
 */
export function userBindingSourceNodes(
  gc: PersonnelCalcResult,
  siteOps: SiteOpsCalcResult,
  lines: readonly BindingLine[]
): GraphNode[] {
  return [
    ...gcSourceNodes(gc),
    ...allSiteOpsSectionNodes(siteOps),
    ...lineFieldSourceNodes(lines),
  ];
}

// ---------------------------------------------------------------------------
// The 10 linked-division rows, re-expressed as lookup bindings
// ---------------------------------------------------------------------------

/** Resolve a linked row's STEP 2/3 source node ID from its `source.kind` discriminator. */
function sourceNodeIdFor(source: LinkedDivisionSource): string {
  switch (source.kind) {
    case "gcSupervision":
      return GC_SUPERVISION_NODE_ID;
    case "gcGeneral":
      return GC_GENERAL_NODE_ID;
    case "siteOpsSection":
      return siteOpsSectionNodeId(source.section);
  }
}

/**
 * The 10 `LINKED_DIVISION_ROWS` as generic `lookup` bindings: each targets
 * `line:<itemId>:total` and mirrors its STEP 2/3 source node by ID. This is the
 * hardcoded bridge generalized into the open binding model (the early `source.kind`
 * enum becomes a real lookup edge in the graph).
 */
export function linkedDivisionBindings(): Binding[] {
  return LINKED_DIVISION_ROWS.map((cfg) => ({
    targetNodeId: linkedRowTotalNodeId(cfg.itemId),
    basis: "currency",
    definition: { kind: "lookup", source: sourceNodeIdFor(cfg.source) },
  }));
}

// ---------------------------------------------------------------------------
// Engine entry points — the drop-in replacements for the two oracles
// ---------------------------------------------------------------------------

/**
 * APP-BORN branch. Reproduces `computeLinkedDivisionTotals(gc, siteOps)` exactly,
 * through the engine: build the STEP 2/3 source nodes + the 10 lookup binding nodes,
 * evaluate the graph in dependency order, and read each linked row's total. Returns
 * the `LinkedDivisionTotal[]` in `LINKED_DIVISION_ROWS` order — same shape the page
 * already consumes (and every consumer keys by itemId, so order is immaterial).
 */
export function computeLinkedDivisionTotalsViaEngine(
  gc: PersonnelCalcResult,
  siteOps: SiteOpsCalcResult
): LinkedDivisionTotal[] {
  const sourceNodes = gcSiteOpsSourceNodes(gc, siteOps);
  const bindingNodes = linkedDivisionBindings().map((b) =>
    compileBindingToNode(b, { lines: [] })
  );
  const values = evaluateGraph([...sourceNodes, ...bindingNodes]);

  return LINKED_DIVISION_ROWS.map((cfg) => ({
    itemId: cfg.itemId,
    description: cfg.description,
    sourceLabel: cfg.sourceLabel,
    total: values.get(linkedRowTotalNodeId(cfg.itemId)) ?? 0,
  }));
}

/**
 * IMPORTED branch (the §6 highest-risk item). For a finished imported bid the linked
 * rows are frozen, hand-authored values on the saved estimate — they MUST be sourced
 * from the saved rows, NOT re-derived from STEP 2/3. So each linked node is a CONSTANT
 * taken from its saved row's `matchedQty × unitPrice`, run through the same engine.
 *
 * Reproduces `linkedTotalsFromRows(rows)` exactly: first-seen dedupe by trimmed itemId,
 * encounter order, description/sourceLabel falling back from the link-table config to
 * the row. There are NO lookups into STEP 2/3 here — wiring imported rows as STEP 2/3
 * lookups would drift the imported golden.
 */
export function computeImportedLinkedDivisionTotalsViaEngine(
  rows: readonly ProcessedTakeoffRow[]
): LinkedDivisionTotal[] {
  const cfgByItemId = new Map(LINKED_DIVISION_ROWS.map((c) => [c.itemId, c]));
  const seen = new Set<string>();
  const encountered: { itemId: string; description: string; sourceLabel: string }[] = [];
  const nodes: GraphNode[] = [];

  for (const r of rows) {
    if (!isLinkedDivisionRow(r.itemId)) continue;
    const id = (r.itemId || "").trim();
    if (seen.has(id)) continue;
    seen.add(id);
    const cfg = cfgByItemId.get(id);
    nodes.push(constantNode(linkedRowTotalNodeId(id), r.matchedQty * r.unitPrice));
    encountered.push({
      itemId: id,
      description: cfg?.description ?? r.description,
      sourceLabel: cfg?.sourceLabel ?? "",
    });
  }

  const values = evaluateGraph(nodes);
  return encountered.map((e) => ({
    itemId: e.itemId,
    description: e.description,
    sourceLabel: e.sourceLabel,
    total: values.get(linkedRowTotalNodeId(e.itemId)) ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// STEP 4 line-field source nodes — groundwork for rollup bindings (Phase 3+)
// ---------------------------------------------------------------------------

/**
 * Projects a `ProcessedTakeoffRow` to the minimal `BindingLine` the SetRule evaluator
 * and rollup compiler read. Keeps the bindings layer off the full row type. `source`
 * is optional on the row, so an absent provenance becomes `""`.
 */
export function projectLine(row: ProcessedTakeoffRow): BindingLine {
  return {
    id: row.id,
    itemId: row.itemId,
    costType: row.costType,
    source: row.source ?? "",
    procoreCode: row.procoreCode,
    total: row.total,
    unitPrice: row.unitPrice,
    matchedQty: row.matchedQty,
  };
}

/** The aggregatable line fields, each exposed as a `line:<id>:<field>` source node. */
const LINE_SOURCE_FIELDS: readonly RollupField[] = ["total", "unitPrice", "matchedQty"];

/**
 * Emits a constant source `GraphNode` for every line's aggregatable field
 * (`line:<id>:total | :unitPrice | :matchedQty`). Phase 2 does not consume these (the
 * 10 reframed rows are lookups, not rollups), but a rollup binding depends on one
 * `line:<id>:<field>` node per matched line — so when the registry starts feeding
 * rollups (Phase 3+) it MUST emit a source node for every line a SetRule can match,
 * or a rollup silently under-counts (Phase 1 code-review carry-forward note).
 */
export function lineFieldSourceNodes(lines: readonly BindingLine[]): GraphNode[] {
  const nodes: GraphNode[] = [];
  for (const line of lines) {
    for (const field of LINE_SOURCE_FIELDS) {
      nodes.push(constantNode(lineFieldNodeId(line.id, field), line[field]));
    }
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// Phase 4 — recompute USER bindings into the grid (display + lifecycle)
// ---------------------------------------------------------------------------

/**
 * Recomputes every persisted USER binding FROM SOURCE for the grid display. This is
 * the Phase 4 load-side entry point: the app builds the live STEP 2/3 + STEP 4 source
 * nodes, folds in the persisted bindings, and evaluates the whole graph in dependency
 * order. Returns target node id → recomputed value (e.g. `line:<rowId>:total` → value).
 *
 * INERT when `bindings` is empty: returns an empty map and builds NO source nodes, so a
 * project with no user bindings carries ZERO overhead and the export goldens tie $0.00.
 *
 * Collision precedence (the §6 Phase-4 decision), resolved here so the kind-blind graph
 * core (graph.ts) is never handed two nodes with the same id:
 *  - **Reserved linked rows win.** The 10 hardcoded linked-division rows are system-
 *    managed (registry lookups into STEP 2/3). A user binding targeting one of their
 *    total nodes is SKIPPED (logged) — the hardcoded bridge stays authoritative.
 *  - **User binding wins over a plain line.** For any other row, the binding REPLACES
 *    that line's constant `line:<id>:total` source node (the cell becomes derived/
 *    read-only). The colliding constant is dropped before evaluation.
 *
 * Stays KIND-BLIND: kind knowledge lives only in `compileBinding` (via
 * recomputeBindingValues). This module only decides WHICH nodes enter the graph.
 */
export function recomputeLineBindingValues(
  bindings: readonly Binding[],
  gc: PersonnelCalcResult,
  siteOps: SiteOpsCalcResult,
  rows: readonly ProcessedTakeoffRow[]
): Map<string, number> {
  const nodes = assembleBindingGraphNodes(bindings, gc, siteOps, rows);
  if (nodes.length === 0) return new Map();
  return evaluateGraph(nodes);
}

/**
 * Options for {@link assembleBindingGraphNodes}. Bucket B (Phase 2) adds the opt-in
 * engine-graph fold; it defaults OFF so the grid recompute / authoring-cycle / preview
 * call paths are byte-identical and the export goldens tie $0.00 (LD-B4).
 */
export interface AssembleBindingGraphOptions {
  /**
   * Fold in the read-only engine-described nodes (engineGraph.ts). OFF by default. When
   * ON the assembly never short-circuits to `[]` on an empty binding set — the engine
   * wiring stays visible even on a project with no user bindings (the Links-tab case).
   */
  includeEngineGraph?: boolean;
  /**
   * The EFFECTIVE summary the engine nodes ECHO (LD-B2). REQUIRED for the engine fold to
   * activate — without it `includeEngineGraph` is a no-op, so a caller can never emit
   * engine nodes against an absent/stale summary (the echo-staleness guard, plan §6).
   */
  summary?: TakeoffSummary;
  /** Which engine tier to describe (default `"summary"` — the Phase 1/2 tier). */
  engineTier?: EngineGraphTier;
}

/**
 * Assembles the kind-blind graph node list (live source nodes + compiled USER binding
 * nodes, plus the opt-in read-only engine-described nodes) the recompute, the authoring
 * cycle-guard, and the Links view all share — the ONE place collision precedence is
 * resolved so the graph core (graph.ts) is never handed two nodes with the same id:
 *  - **User binding > engine node > bare source node.** A user binding REPLACES that
 *    line's constant `line:<id>:total` source node (the cell becomes derived/read-only);
 *    a surviving engine node in turn replaces any bare source-node constant of its id.
 *  - **Reserved linked rows win.** A user binding targeting one of the 10 hardcoded
 *    linked-division total nodes is SKIPPED (logged) — the hardcoded bridge stays
 *    authoritative — and an engine node colliding with a reserved linked node is dropped.
 *
 * With the engine fold OFF (the default — the grid path) and no effective user bindings,
 * returns `[]`, so the recompute is INERT and the export goldens tie $0.00 (a project with
 * no user bindings builds NO nodes). With the fold ON (the Links tab) the engine wiring is
 * emitted regardless. Stays KIND-BLIND: kind knowledge lives only in `compileBindingToNode`;
 * the engine nodes are plain `GraphNode`s (engineGraph.ts) folded here at the single seam.
 */
export function assembleBindingGraphNodes(
  bindings: readonly Binding[],
  gc: PersonnelCalcResult,
  siteOps: SiteOpsCalcResult,
  rows: readonly ProcessedTakeoffRow[],
  options: AssembleBindingGraphOptions = {}
): GraphNode[] {
  // The engine fold activates only with BOTH the opt-in flag AND a summary to echo, so
  // the grid path — which passes neither — stays byte-identical (LD-B4).
  const includeEngine = options.includeEngineGraph === true && options.summary != null;

  // Reserved target node ids: the total node of every linked-division row present. A user
  // binding on one is system-managed (the hardcoded bridge wins); an engine node colliding
  // with one is shadowed by it.
  const reserved = new Set<string>();
  for (const r of rows) {
    if (isLinkedDivisionRow(r.itemId)) reserved.add(lineFieldNodeId(r.id, "total"));
  }

  const effective: Binding[] = [];
  for (const b of bindings) {
    if (reserved.has(b.targetNodeId)) {
      // Collision with a system-managed linked row → skip (the bridge wins).
      console.warn(
        `Skipping user binding on reserved linked-division node ${b.targetNodeId}`
      );
      continue;
    }
    effective.push(b);
  }

  // INERT FAST PATH (grid / recompute / authoring cycle-guard): with the engine fold OFF
  // and no effective user bindings, build NOTHING — the recompute is a no-op and the
  // goldens tie $0.00. (With the fold ON we always proceed so the wiring stays visible.)
  if (!includeEngine && effective.length === 0) return [];

  const lines = rows.map(projectLine);
  const bindingTargets = new Set(effective.map((b) => b.targetNodeId));
  const bindingNodes = effective.map((b) => compileBindingToNode(b, { lines }));

  if (!includeEngine) {
    // Source nodes minus any constant a surviving binding now computes (binding wins).
    const sourceNodes = userBindingSourceNodes(gc, siteOps, lines).filter(
      (n) => !bindingTargets.has(n.id)
    );
    return [...sourceNodes, ...bindingNodes];
  }

  // ---- Bucket B fold (precedence: user binding > engine node > bare source node) ------
  // Engine nodes are shadowed by a user binding target or a reserved linked-division node
  // (both outrank the engine description); the surviving engine nodes in turn outrank any
  // bare source-node constant of the same id. Dropping the losers HERE is what keeps the
  // kind-blind graph core from ever seeing a duplicate id (buildGraph throws GraphError).
  const engineNodes = describeEngineGraph(
    gc,
    siteOps,
    rows,
    options.summary!,
    options.engineTier ?? "summary"
  ).filter((n) => !bindingTargets.has(n.id) && !reserved.has(n.id));
  const engineIds = new Set(engineNodes.map((n) => n.id));

  // Bare source nodes minus any id a surviving user binding OR engine node now computes.
  const sourceNodes = userBindingSourceNodes(gc, siteOps, lines).filter(
    (n) => !bindingTargets.has(n.id) && !engineIds.has(n.id)
  );

  return [...sourceNodes, ...bindingNodes, ...engineNodes];
}

// ---------------------------------------------------------------------------
// Node labelling (Phase 5) — friendly names for the authoring picker + Links view
// ---------------------------------------------------------------------------

/** Friendly labels for the three STEP 2 GC source nodes. */
export const GC_NODE_LABELS: Record<string, string> = {
  [GC_GRAND_TOTAL_NODE_ID]: "Personnel grand total",
  [GC_SUPERVISION_NODE_ID]: "Total Supervision",
  [GC_GENERAL_NODE_ID]: "Design / PM / GCs",
};

/** A node resolved to a display label, with the line's rowId when it is a line node (for click-to-jump). */
export interface NodeLabel {
  /** Human-readable label, e.g. "STEP 2 · Total Supervision" or "09-9000.001 · Drywall". */
  label: string;
  /** The STEP 4 row id when the node is a `line:<rowId>:<field>` node — enables grid jump. */
  rowId?: string;
  /** The line field when the node is a line node and the field is not `total`. */
  field?: RollupField;
}

/**
 * Resolves any source/target node id (spec §2.2) to a friendly {@link NodeLabel}. The
 * single labeller shared by the authoring picker and the Trust Inspector Links view, so
 * a node reads the same everywhere. Pure: it only parses the id and looks up the row.
 */
export function describeSourceNode(
  nodeId: string,
  rows: readonly ProcessedTakeoffRow[]
): NodeLabel {
  if (nodeId.startsWith("gc:")) {
    return { label: `STEP 2 · ${GC_NODE_LABELS[nodeId] ?? nodeId}` };
  }
  if (nodeId.startsWith("siteops:")) {
    const section = nodeId.slice("siteops:".length);
    const cfg = SITE_OPS_SECTIONS.find((s) => s.id === section);
    return { label: `STEP 3 · ${cfg?.label ?? section}` };
  }
  if (nodeId.startsWith("line:")) {
    // line:<rowId>:<field> — rowId may itself contain no colon (uuid / row-<itemId>).
    const rest = nodeId.slice("line:".length);
    const lastColon = rest.lastIndexOf(":");
    const rowId = lastColon === -1 ? rest : rest.slice(0, lastColon);
    const field = (lastColon === -1 ? "total" : rest.slice(lastColon + 1)) as RollupField;
    const row = rows.find((r) => r.id === rowId);
    const base = row ? `${row.itemId || "(no code)"}${row.description ? ` · ${row.description}` : ""}` : rowId;
    return {
      label: field === "total" ? base : `${base} (${field})`,
      rowId,
      field: field === "total" ? undefined : field,
    };
  }
  if (nodeId.startsWith("summary:")) {
    return { label: `Summary · ${nodeId.slice("summary:".length)}` };
  }
  return { label: nodeId };
}

/**
 * A short human-readable "depends-on" summary for a binding's badge/tooltip (Phase 4
 * is display + plumbing; Phase 5's Links tab renders the rich dependency view). The
 * ONE kind-aware spot outside compile.ts that the grid uses — intentionally a pure
 * label, never a graph decision.
 */
export function describeBindingDependency(binding: Binding): string {
  const def = binding.definition;
  if (def.kind === "rollup") {
    return `${def.op} of ${def.field ?? "total"}`;
  }
  // lookup (the only other v1 kind) — `source` mirrored, with an optional ×/+ transform.
  const t = def.transform;
  const suffix =
    t && (t.multiply != null || t.add != null)
      ? ` (×${t.multiply ?? 1}${t.add ? ` +${t.add}` : ""})`
      : "";
  return `${def.source}${suffix}`;
}
