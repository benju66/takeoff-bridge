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

import type { Basis, GraphNode, SummaryNodeField } from "./types";
import { summaryNodeId } from "./types";
import type {
  PersonnelCalcResult,
  SiteOpsCalcResult,
  TakeoffSummary,
} from "../calculations";
import type { ProcessedTakeoffRow } from "@/types";

// ---------------------------------------------------------------------------
// Tier selector (LD-B3 — tiered rollout to complete coverage)
// ---------------------------------------------------------------------------

/**
 * Which tier of engine relationships `describeEngineGraph` emits. Phase 1 ships the
 * `"summary"` tier (STEP 4 summary + cross-page money trail). Future phases WIDEN this
 * union (`"gc"`, `"siteOps"`, `"division"`, …) and add a matching branch to the switch —
 * the descriptor signature never changes.
 */
export type EngineGraphTier = "summary";

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
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Describes the calculation engine's value relationships as read-only echo `GraphNode`s
 * for the requested `tier`. Pure: it only reads the passed engine results and emits nodes;
 * it performs no math, no I/O, and no graph evaluation (LD-B2, LD-B4).
 *
 * `gc`, `siteOps`, and `rows` are part of the stable signature so later tiers (the GC tree,
 * the Site-Ops tree, division rollups) can describe their leaves without a signature change;
 * the Phase 1 `"summary"` tier reads only `summary`.
 */
export function describeEngineGraph(
  gc: PersonnelCalcResult,
  siteOps: SiteOpsCalcResult,
  rows: readonly ProcessedTakeoffRow[],
  summary: TakeoffSummary,
  tier: EngineGraphTier
): GraphNode[] {
  const nodes: GraphNode[] = [];
  switch (tier) {
    case "summary":
      nodes.push(...describeSummaryNodes(summary));
      break;
  }
  return nodes;
}
