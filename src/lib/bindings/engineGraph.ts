/**
 * Linked Values — Bucket B: engine graph descriptor (Phase 1).
 *
 * Makes the calculation engine's currently-hardcoded value relationships VISIBLE in
 * the kind-blind dependency graph WITHOUT re-implementing any of the math. Each engine
 * value becomes a plain read-only `GraphNode` whose:
 *   - `inputs` declare the REAL edges, hand-authored from the known engine structure
 *     (these drive the depends-on / used-by inspection view), and
 *   - `evaluate` ECHOES the value the engine already computed (captured from the passed
 *     `TakeoffSummary` / calc results) — it NEVER re-derives the math (LD-B2).
 *
 * This keeps `calculations.ts` the sole authority over the math (AGENTS.md financial
 * constraint) and makes value-level drift structurally impossible: the descriptor can
 * only report what the engine produced. The nodes are plain `GraphNode`s folded into the
 * existing graph at the `assembleBindingGraphNodes` seam (Phase 2 wiring) — the graph
 * core, the compiler, and the math are untouched (LD-B5).
 *
 * Like registry.ts, this is an APP-AWARE bindings module (it imports calc-result types);
 * the graph/compiler core (graph.ts, compile.ts) stay indifferent to all of it.
 *
 * Phase 1 shipped Tier 1 — the STEP 4 summary + cross-page money trail (`summary:*`);
 * Phase 3 added the GC tree (`gc:*`); Phase 4 adds the Site-Ops tree (`siteops:*`). Later
 * tiers (division rollups) append to `describeEngineGraph` behind the `tier` switch; the
 * signature is stable from day one (LD-B3).
 */

import type {
  Basis,
  GcSubtotalGroup,
  GraphNode,
  SiteOpsLineGroup,
  SummaryNodeField,
} from "./types";
import {
  GC_GENERAL_NODE_ID,
  GC_GRAND_TOTAL_NODE_ID,
  GC_SUPERVISION_NODE_ID,
  SITEOPS_GRAND_TOTAL_NODE_ID,
  gcLeafNodeId,
  gcSubtotalNodeId,
  siteOpsLeafNodeId,
  siteOpsSectionNodeId,
  siteOpsSubtotalNodeId,
  summaryNodeId,
} from "./types";
import type {
  PersonnelCalcResult,
  SiteOpsCalcResult,
  TakeoffSummary,
} from "../calculations";
import {
  SITE_OPS_DYNAMIC_DEFAULTS,
  SITE_OPS_MANUAL_DEFAULTS,
  SITE_OPS_SECTIONS,
  SUPERVISION_STAFF_CODES,
  type SiteOpsSection,
} from "../constants";
import type { ProcessedTakeoffRow } from "@/types";

// ---------------------------------------------------------------------------
// Tier selector (LD-B3 — tiered rollout to complete coverage)
// ---------------------------------------------------------------------------

/**
 * Which tier of engine relationships `describeEngineGraph` emits. Phase 1 shipped the
 * `"summary"` tier (STEP 4 summary + cross-page money trail); Phase 3 added `"gc"` (the
 * full STEP 2 General Conditions tree); Phase 4 adds `"siteOps"` (the full STEP 3 Site
 * Operations tree). Future phases WIDEN this union (`"division"`, …) and add a matching
 * branch to the switch — the descriptor signature never changes.
 */
export type EngineGraphTier = "summary" | "gc" | "siteOps";

/**
 * Every known engine tier, in dependency-friendly order. The inspection seam
 * (`assembleBindingGraphNodes`) defaults to this so the Links tab auto-covers each tier
 * as it ships — a new phase lights up simply by adding its branch below.
 */
export const ALL_ENGINE_TIERS: readonly EngineGraphTier[] = ["summary", "gc", "siteOps"];

// ---------------------------------------------------------------------------
// Echo-node construction
// ---------------------------------------------------------------------------

/**
 * The 7 STEP 1 modifiers, each a `subtotal × rate` line in `computeTakeoffSummary`. Their
 * NODE values are dollar amounts (`currency`), not the percent rates — the rate lives in
 * STEP 1, outside this tier. Each depends on `summary:subtotal`.
 */
const SUMMARY_MODIFIER_FIELDS: readonly SummaryNodeField[] = [
  "constructionContingency",
  "designContingency",
  "buildersRisk",
  "specialInsurance",
  "glInsurance",
  "bond",
  "fee",
];

/**
 * Builds one read-only echo `GraphNode` for a `summary:<field>` value. `evaluate` ignores
 * its input map entirely and returns the captured engine `value` — the `inputs` exist only
 * to declare the dependency edges for the inspection view (LD-B2: echo, never re-derive).
 */
function echoSummaryNode(
  field: SummaryNodeField,
  value: number,
  inputs: string[],
  basis: Basis
): GraphNode {
  return { id: summaryNodeId(field), basis, inputs, evaluate: () => value };
}

/**
 * Tier 1 — the STEP 4 summary + cross-page money trail, echoed from `TakeoffSummary`:
 *
 *   takeoffSubtotal ─┐
 *                    ├─► subtotal ─► each of 7 modifiers ─┐
 *   linkedDivisionsTotal ─┘     └────────────────────────┴─► totalEstimatedCost ─► costPerSf
 *                                                                                └► costPerUnit
 *
 * `takeoffSubtotal` and `linkedDivisionsTotal` are the cross-page leaves (the linked GC /
 * Site-Ops division values feed `linkedDivisionsTotal`); `subtotal` sums them; each
 * modifier reads `subtotal`; the grand total reads `subtotal` + all 7 modifiers (the
 * effective-component sum); the two cost-per-metric nodes read the grand total. Every
 * value is the engine's own — the edges only describe the wiring.
 */
function describeSummaryNodes(summary: TakeoffSummary): GraphNode[] {
  const takeoffSubtotalId = summaryNodeId("takeoffSubtotal");
  const linkedDivisionsTotalId = summaryNodeId("linkedDivisionsTotal");
  const subtotalId = summaryNodeId("subtotal");
  const totalId = summaryNodeId("totalEstimatedCost");
  const modifierIds = SUMMARY_MODIFIER_FIELDS.map((f) => summaryNodeId(f));

  const nodes: GraphNode[] = [
    // Cross-page leaves (no inputs in this tier; the GC/Site-Ops trees feed
    // linkedDivisionsTotal in later tiers).
    echoSummaryNode("takeoffSubtotal", summary.takeoffSubtotal, [], "currency"),
    echoSummaryNode("linkedDivisionsTotal", summary.linkedDivisionsTotal, [], "currency"),
    // subtotal = takeoffSubtotal + linkedDivisionsTotal
    echoSummaryNode(
      "subtotal",
      summary.subtotal,
      [takeoffSubtotalId, linkedDivisionsTotalId],
      "currency"
    ),
  ];

  // Each modifier = subtotal × its STEP 1 rate → depends on subtotal.
  for (const field of SUMMARY_MODIFIER_FIELDS) {
    nodes.push(echoSummaryNode(field, summary[field], [subtotalId], "currency"));
  }

  // totalEstimatedCost = subtotal + Σ(7 modifiers) (the effective-component sum).
  nodes.push(
    echoSummaryNode(
      "totalEstimatedCost",
      summary.totalEstimatedCost,
      [subtotalId, ...modifierIds],
      "currency"
    )
  );

  // Cost-per-metric = totalEstimatedCost ÷ (SF | unit count). The SF/unit divisors live
  // in STEP 1 (outside this tier); the edge is to the grand total it divides.
  nodes.push(echoSummaryNode("costPerSf", summary.costPerSf, [totalId], "rate"));
  nodes.push(echoSummaryNode("costPerUnit", summary.costPerUnit, [totalId], "rate"));

  return nodes;
}

// ---------------------------------------------------------------------------
// Tier 2 (Phase 3) — the GC (STEP 2) internal decomposition tree
// ---------------------------------------------------------------------------

/** One read-only echo `GraphNode` for a GC value: `evaluate` returns the captured engine
 * value; `inputs` declare the edges only (LD-B2 — echo, never re-derive). */
function echoGcNode(id: string, value: number, inputs: string[], basis: Basis): GraphNode {
  return { id, basis, inputs, evaluate: () => value };
}

/** The minimal leaf-line shape the GC tier reads: a `total` plus optional `qty`/`rate`
 * (absent for the lump-sum equipment group). A projection of `PersonnelCalcResult` lines. */
interface GcLeafLine {
  code: string;
  total: number;
  qty?: number;
  rate?: number;
}

/**
 * Describes one GC cost group's leaf lines: a `total` echo node per line (edged to its
 * `qty` + `rate` derived source nodes), plus those qty/rate nodes. A lump-sum line (no
 * qty/rate — the equipment group) emits only its leaf `total` (a source node, no edges).
 * Returns the group's leaf `total` node IDs so the group subtotal can edge to them.
 */
function describeGcGroup(
  group: GcSubtotalGroup,
  lines: readonly GcLeafLine[]
): { nodes: GraphNode[]; leafTotalIds: string[] } {
  const nodes: GraphNode[] = [];
  const leafTotalIds: string[] = [];
  for (const l of lines) {
    const totalId = gcLeafNodeId(group, l.code, "total");
    leafTotalIds.push(totalId);
    if (l.qty !== undefined && l.rate !== undefined) {
      const qtyId = gcLeafNodeId(group, l.code, "qty");
      const rateId = gcLeafNodeId(group, l.code, "rate");
      nodes.push(echoGcNode(qtyId, l.qty, [], "quantity"));
      nodes.push(echoGcNode(rateId, l.rate, [], "rate"));
      // Leaf total = qty × rate — echoed (the edges describe it; the value is the engine's).
      nodes.push(echoGcNode(totalId, l.total, [qtyId, rateId], "currency"));
    } else {
      // Lump-sum leaf (equipment): the typed total IS the leaf — no qty/rate edges.
      nodes.push(echoGcNode(totalId, l.total, [], "currency"));
    }
  }
  return { nodes, leafTotalIds };
}

/**
 * Tier 2 — the STEP 2 General Conditions tree, echoed from `PersonnelCalcResult` to the
 * leaf:
 *
 *   grandTotal ─► staffSubtotal ─► each staff line total ─► [qty, rate]
 *              ├► opsSubtotal       ├► each ops line total ─► [qty, rate]
 *              ├► equipmentSubtotal ├► each equipment line total (lump sum)
 *              └► manualSubtotal    └► each manual line total ─► [qty, rate]
 *
 *   supervisionSubtotal ─► the 3 supervision staff line totals (a re-grouping of staff)
 *   general ─► [grandTotal, supervisionSubtotal]   (Design/PM/GCs = grandTotal − supervision)
 *
 * Every value is the engine's own: leaf totals echo each `*.total`, `equipmentSubtotal`
 * echoes `gc.equipmentTotal`, `grandTotal` echoes `gc.grandTotal`; the staff/ops/manual
 * subtotals echo the engine's own Σ of that group's leaf totals (the same reduction the
 * engine performs internally), and `general` echoes the oracle's `grandTotal − supervision`
 * derived value. The edges declare the wiring; they never re-derive the math (LD-B2).
 *
 * The canonical `gc:grandTotal` / `gc:supervisionSubtotal` / `gc:general` IDs are reused
 * (LD-B5) — at the `assembleBindingGraphNodes` seam these engine nodes outrank the bare
 * `gc:*` source-node constants (engine > source), so this richer wiring wins.
 */
function describeGcNodes(gc: PersonnelCalcResult): GraphNode[] {
  const nodes: GraphNode[] = [];

  const staff = describeGcGroup("staff", gc.staffLines);
  const ops = describeGcGroup("ops", gc.operationalLines);
  const equipment = describeGcGroup("equipment", gc.equipmentLines);
  const manual = describeGcGroup("manual", gc.manualLines);
  nodes.push(...staff.nodes, ...ops.nodes, ...equipment.nodes, ...manual.nodes);

  // Group subtotals — each ECHOES the engine's own sum of that group's leaf totals
  // (equipmentSubtotal is exposed directly by the engine as `equipmentTotal`).
  const staffSubtotal = gc.staffLines.reduce((s, l) => s + l.total, 0);
  const opsSubtotal = gc.operationalLines.reduce((s, l) => s + l.total, 0);
  const manualSubtotal = gc.manualLines.reduce((s, l) => s + l.total, 0);
  nodes.push(echoGcNode(gcSubtotalNodeId("staff"), staffSubtotal, staff.leafTotalIds, "currency"));
  nodes.push(echoGcNode(gcSubtotalNodeId("ops"), opsSubtotal, ops.leafTotalIds, "currency"));
  nodes.push(
    echoGcNode(gcSubtotalNodeId("equipment"), gc.equipmentTotal, equipment.leafTotalIds, "currency")
  );
  nodes.push(echoGcNode(gcSubtotalNodeId("manual"), manualSubtotal, manual.leafTotalIds, "currency"));

  // Grand total — the engine value, edged to its FOUR subtotals. This hand-authored edge
  // list is the main drift point the structural-completeness test guards: Σ(4 subtotals)
  // must equal gc.grandTotal, so a new engine cost group can't slip in uncounted (§6).
  nodes.push(
    echoGcNode(
      GC_GRAND_TOTAL_NODE_ID,
      gc.grandTotal,
      [
        gcSubtotalNodeId("staff"),
        gcSubtotalNodeId("ops"),
        gcSubtotalNodeId("equipment"),
        gcSubtotalNodeId("manual"),
      ],
      "currency"
    )
  );

  // Supervision subtotal — Σ the supervision staff lines, edged to those staff leaf totals
  // (a re-grouping of staff lines, NOT new leaves). Mirrors the oracle's filter exactly.
  const supervisionLines = gc.staffLines.filter((l) => SUPERVISION_STAFF_CODES.includes(l.code));
  const supervisionTotal = supervisionLines.reduce((s, l) => s + l.total, 0);
  nodes.push(
    echoGcNode(
      GC_SUPERVISION_NODE_ID,
      supervisionTotal,
      supervisionLines.map((l) => gcLeafNodeId("staff", l.code, "total")),
      "currency"
    )
  );

  // gc:general = grandTotal − supervision (the existing derived semantics, registry.ts).
  nodes.push(
    echoGcNode(
      GC_GENERAL_NODE_ID,
      gc.grandTotal - supervisionTotal,
      [GC_GRAND_TOTAL_NODE_ID, GC_SUPERVISION_NODE_ID],
      "currency"
    )
  );

  return nodes;
}

// ---------------------------------------------------------------------------
// Tier 3 (Phase 4) — the Site-Ops (STEP 3) internal decomposition tree
// ---------------------------------------------------------------------------

/** One read-only echo `GraphNode` for a Site-Ops value: `evaluate` returns the captured
 * engine value; `inputs` declare the edges only (LD-B2 — echo, never re-derive). */
function echoSiteOpsNode(id: string, value: number, inputs: string[], basis: Basis): GraphNode {
  return { id, basis, inputs, evaluate: () => value };
}

/** The minimal leaf-line shape the Site-Ops tier reads: code + total + qty + rate. Every
 * Site-Ops line (dynamic AND all 3 manual entry types) carries a qty and a rate. */
interface SiteOpsLeafLine {
  code: string;
  total: number;
  qty: number;
  rate: number;
}

/**
 * STEP 3 line code → its template subtotal section, built from the two config arrays. The
 * Site-Ops analog of the GC supervision filter: it drives the cross-cutting
 * `siteops:<section>` re-grouping. Keyed by the Site-Ops criterion code (never a STEP 4
 * itemId), so the "02-4100.002" string collision between the STEP 3 sawcutting line and
 * the STEP 4 Demolition linked row cannot cross-contaminate (constants.ts).
 */
const SITE_OPS_SECTION_BY_CODE: ReadonlyMap<string, SiteOpsSection> = (() => {
  const m = new Map<string, SiteOpsSection>();
  for (const cfg of SITE_OPS_DYNAMIC_DEFAULTS) m.set(cfg.code, cfg.section);
  for (const cfg of SITE_OPS_MANUAL_DEFAULTS) m.set(cfg.code, cfg.section);
  return m;
})();

/**
 * Describes one Site-Ops line group's leaf lines: a `total` echo node per line (edged to
 * its `qty` + `rate` derived source nodes), plus those qty/rate nodes. A UNIFORM
 * `[qty, rate]` leaf edge is faithful for ALL entries — including the 3 manual entry types
 * — because the engine sets `qty`/`rate` so that `total = qty × rate` always holds:
 *   - `qty`     → typed qty × template rate;
 *   - `qtyRate` → typed qty × typed rate;
 *   - `lumpSum` → the engine sets `qty = value>0 ? 1 : 0`, `rate = value`, so the product is
 *     still the typed dollar amount.
 * (This is why Site-Ops, unlike GC's lump-sum equipment, has NO total-only leaves.)
 * Returns the group's leaf `total` node IDs so the group + section subtotals can edge to them.
 */
function describeSiteOpsGroup(
  group: SiteOpsLineGroup,
  lines: readonly SiteOpsLeafLine[]
): { nodes: GraphNode[]; leafTotalIds: string[] } {
  const nodes: GraphNode[] = [];
  const leafTotalIds: string[] = [];
  for (const l of lines) {
    const totalId = siteOpsLeafNodeId(group, l.code, "total");
    const qtyId = siteOpsLeafNodeId(group, l.code, "qty");
    const rateId = siteOpsLeafNodeId(group, l.code, "rate");
    leafTotalIds.push(totalId);
    nodes.push(echoSiteOpsNode(qtyId, l.qty, [], "quantity"));
    nodes.push(echoSiteOpsNode(rateId, l.rate, [], "rate"));
    // Leaf total = qty × rate — echoed (the edges describe it; the value is the engine's).
    nodes.push(echoSiteOpsNode(totalId, l.total, [qtyId, rateId], "currency"));
  }
  return { nodes, leafTotalIds };
}

/**
 * Tier 3 — the STEP 3 Site Operations tree, echoed from `SiteOpsCalcResult` to the leaf:
 *
 *   grandTotal ─► dynamicSubtotal ─► each dynamic line total ─► [qty, rate]
 *              └► manualSubtotal  ─► each manual line total  ─► [qty, rate]
 *
 *   siteops:<section> ─► the leaf totals of the lines whose section is that section
 *      (a CROSS-CUTTING re-grouping spanning dynamic + manual — the Site-Ops analog of
 *       GC's supervisionSubtotal; it REUSES the same leaf `total` ids, no duplicate leaves)
 *
 * Every value is the engine's own: leaf totals echo each `*.total`; the dynamic/manual
 * subtotals echo the engine's own Σ of that group's leaf totals (the same `dynamicTotal`/
 * `manualTotal` reduction the engine performs internally); `grandTotal` echoes
 * `siteOps.grandTotal`, edged to the two group subtotals (its literal
 * `grandTotal = dynamicTotal + manualTotal` decomposition). The edges declare the wiring;
 * they never re-derive the math (LD-B2).
 *
 * The canonical `siteops:<section>` IDs are reused (LD-B5) — at the
 * `assembleBindingGraphNodes` seam these engine section nodes outrank the bare
 * `siteops:<section>` source-node constants (engine > source), so this richer wiring wins.
 */
function describeSiteOpsNodes(siteOps: SiteOpsCalcResult): GraphNode[] {
  const nodes: GraphNode[] = [];

  const dynamic = describeSiteOpsGroup("dynamic", siteOps.dynamicLines);
  const manual = describeSiteOpsGroup("manual", siteOps.manualLines);
  nodes.push(...dynamic.nodes, ...manual.nodes);

  // Group subtotals — each ECHOES the engine's own Σ of that group's leaf totals
  // (the engine's internal dynamicTotal / manualTotal).
  const dynamicSubtotal = siteOps.dynamicLines.reduce((s, l) => s + l.total, 0);
  const manualSubtotal = siteOps.manualLines.reduce((s, l) => s + l.total, 0);
  nodes.push(
    echoSiteOpsNode(siteOpsSubtotalNodeId("dynamic"), dynamicSubtotal, dynamic.leafTotalIds, "currency")
  );
  nodes.push(
    echoSiteOpsNode(siteOpsSubtotalNodeId("manual"), manualSubtotal, manual.leafTotalIds, "currency")
  );

  // Grand total — the engine value, edged to its TWO group subtotals. This hand-authored
  // edge list is one drift point the structural-completeness test guards: Σ(2 subtotals)
  // must equal siteOps.grandTotal, so a new engine line group can't slip in uncounted (§6).
  nodes.push(
    echoSiteOpsNode(
      SITEOPS_GRAND_TOTAL_NODE_ID,
      siteOps.grandTotal,
      [siteOpsSubtotalNodeId("dynamic"), siteOpsSubtotalNodeId("manual")],
      "currency"
    )
  );

  // Section subtotals — a CROSS-CUTTING re-grouping by `cfg.section` (spanning dynamic +
  // manual), the Site-Ops analog of GC's supervisionSubtotal. Each `siteops:<section>`
  // reads the leaf totals of its member lines (REUSING the same leaf `total` ids — NOT new
  // leaves) and echoes their Σ. One node per section so Σ(8 sections) = Σ(all leaves) =
  // grandTotal exactly (every line maps to exactly one section; the constants test guards
  // that no line's code is unknown). These reuse the canonical `siteops:<section>` ids
  // (LD-B5) and so SHADOW the bare section constants at the seam (engine > source).
  const sectionLeafIds = new Map<SiteOpsSection, string[]>();
  const sectionTotals = new Map<SiteOpsSection, number>();
  const collect = (group: SiteOpsLineGroup, lines: readonly SiteOpsLeafLine[]): void => {
    for (const l of lines) {
      const section = SITE_OPS_SECTION_BY_CODE.get(l.code);
      if (!section) continue; // unknown line — the constants test guards against this
      const list = sectionLeafIds.get(section) ?? [];
      list.push(siteOpsLeafNodeId(group, l.code, "total"));
      sectionLeafIds.set(section, list);
      sectionTotals.set(section, (sectionTotals.get(section) ?? 0) + l.total);
    }
  };
  collect("dynamic", siteOps.dynamicLines);
  collect("manual", siteOps.manualLines);
  for (const s of SITE_OPS_SECTIONS) {
    nodes.push(
      echoSiteOpsNode(
        siteOpsSectionNodeId(s.id),
        sectionTotals.get(s.id) ?? 0,
        sectionLeafIds.get(s.id) ?? [],
        "currency"
      )
    );
  }

  return nodes;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Describes the calculation engine's value relationships as read-only echo `GraphNode`s
 * for the requested `tier`. Pure: it only reads the passed engine results and emits nodes;
 * it performs no math, no I/O, and no graph evaluation (LD-B2, LD-B4).
 *
 * `gc`, `siteOps`, and `rows` are part of the stable signature so later tiers (division
 * rollups, …) can describe their leaves without a signature change; the `"summary"` tier
 * reads only `summary`, the `"gc"` tier reads only `gc`, the `"siteOps"` tier reads only
 * `siteOps`.
 *
 * `tier` accepts a single tier OR a list of tiers — the inspection seam requests the full
 * set (`ALL_ENGINE_TIERS`) so the Links tab shows the complete wiring, while a test or a
 * future caller can scope to one tier. Tiers use disjoint node-ID namespaces, so the union
 * never collides with itself.
 */
export function describeEngineGraph(
  gc: PersonnelCalcResult,
  siteOps: SiteOpsCalcResult,
  rows: readonly ProcessedTakeoffRow[],
  summary: TakeoffSummary,
  tier: EngineGraphTier | readonly EngineGraphTier[]
): GraphNode[] {
  const tiers = typeof tier === "string" ? [tier] : tier;
  const nodes: GraphNode[] = [];
  for (const t of tiers) {
    switch (t) {
      case "summary":
        nodes.push(...describeSummaryNodes(summary));
        break;
      case "gc":
        nodes.push(...describeGcNodes(gc));
        break;
      case "siteOps":
        nodes.push(...describeSiteOpsNodes(siteOps));
        break;
    }
  }
  return nodes;
}
