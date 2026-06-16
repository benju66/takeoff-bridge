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
 * Phase 1 emits Tier 1 only — the STEP 4 summary + cross-page money trail (`summary:*`).
 * Later tiers (GC tree, Site-Ops tree, division rollups) append to `describeEngineGraph`
 * behind the `tier` switch; the signature is stable from day one (LD-B3).
 */

import type { Basis, GcSubtotalGroup, GraphNode, SummaryNodeField } from "./types";
import {
  GC_GENERAL_NODE_ID,
  GC_GRAND_TOTAL_NODE_ID,
  GC_SUPERVISION_NODE_ID,
  gcLeafNodeId,
  gcSubtotalNodeId,
  summaryNodeId,
} from "./types";
import type {
  PersonnelCalcResult,
  SiteOpsCalcResult,
  TakeoffSummary,
} from "../calculations";
import { SUPERVISION_STAFF_CODES } from "../constants";
import type { ProcessedTakeoffRow } from "@/types";

// ---------------------------------------------------------------------------
// Tier selector (LD-B3 — tiered rollout to complete coverage)
// ---------------------------------------------------------------------------

/**
 * Which tier of engine relationships `describeEngineGraph` emits. Phase 1 shipped the
 * `"summary"` tier (STEP 4 summary + cross-page money trail); Phase 3 adds `"gc"` (the
 * full STEP 2 General Conditions tree). Future phases WIDEN this union (`"siteOps"`,
 * `"division"`, …) and add a matching branch to the switch — the descriptor signature
 * never changes.
 */
export type EngineGraphTier = "summary" | "gc";

/**
 * Every known engine tier, in dependency-friendly order. The inspection seam
 * (`assembleBindingGraphNodes`) defaults to this so the Links tab auto-covers each tier
 * as it ships — a new phase lights up simply by adding its branch below.
 */
export const ALL_ENGINE_TIERS: readonly EngineGraphTier[] = ["summary", "gc"];

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
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Describes the calculation engine's value relationships as read-only echo `GraphNode`s
 * for the requested `tier`. Pure: it only reads the passed engine results and emits nodes;
 * it performs no math, no I/O, and no graph evaluation (LD-B2, LD-B4).
 *
 * `gc`, `siteOps`, and `rows` are part of the stable signature so later tiers (the Site-Ops
 * tree, division rollups) can describe their leaves without a signature change; the
 * `"summary"` tier reads only `summary`, the `"gc"` tier reads only `gc`.
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
    }
  }
  return nodes;
}
