/**
 * Linked Values — Bucket B Phase 5: the "no straggler" coverage catch + the full-graph perf
 * check (plan §6). The per-tier structure tests pin each tier's leaves exactly; this test
 * proves the WHOLE engine is covered and that the seam evaluates the full ~240-node graph
 * fast enough on a Links-tab open.
 *
 *   1. TIER REGISTRATION — `ALL_ENGINE_TIERS` is exactly the four shipped tiers, and each
 *      tier emits nodes ONLY in its own namespace. A tier added to the union but missing a
 *      switch branch would emit nothing (caught); a namespace leak would be caught too.
 *   2. UNION COMPLETENESS — the `ALL_ENGINE_TIERS` node set is the disjoint union of the
 *      per-tier sets (no cross-tier id collision) and covers every engine-produced value:
 *      all 13 summary fields, every GC aggregate + one leaf-total per GC line, every Site-Ops
 *      aggregate + all 8 sections + one leaf-total per Site-Ops line, and one division total
 *      per present STEP 4 division.
 *   3. PERF — assembling + evaluating the full graph at the seam stays well under budget.
 */
import { describe, it, expect } from "vitest";
import {
  computePersonnelCosts,
  computeSiteOperations,
  computeTakeoffSummary,
  type PersonnelCalcResult,
  type SiteOpsCalcResult,
  type TakeoffSummary,
} from "../calculations";
import {
  ALL_ENGINE_TIERS,
  describeEngineGraph,
  type EngineGraphTier,
} from "../bindings/engineGraph";
import { assembleBindingGraphNodes } from "../bindings/registry";
import { evaluateGraph } from "../bindings/graph";
import {
  GC_GENERAL_NODE_ID,
  GC_GRAND_TOTAL_NODE_ID,
  GC_SUPERVISION_NODE_ID,
  SITEOPS_GRAND_TOTAL_NODE_ID,
  divisionTotalNodeId,
  gcSubtotalNodeId,
  siteOpsSectionNodeId,
  siteOpsSubtotalNodeId,
  summaryNodeId,
} from "../bindings/types";
import { SITE_OPS_SECTIONS } from "../constants";
import { getDivisionCode } from "../division";
import type { ProcessedTakeoffRow } from "@/types";

const ALL_SUMMARY_FIELDS = [
  "takeoffSubtotal",
  "linkedDivisionsTotal",
  "subtotal",
  "constructionContingency",
  "designContingency",
  "buildersRisk",
  "specialInsurance",
  "glInsurance",
  "bond",
  "fee",
  "totalEstimatedCost",
  "costPerSf",
  "costPerUnit",
] as const;

const RATES = {
  constructionContingencyRate: 0.03,
  designContingencyRate: 0.02,
  buildersRiskRate: 0.005,
  specialInsuranceRate: 0.004,
  glInsuranceRate: 0.01,
  bondRate: 0.012,
  feeRate: 0.05,
  roundingRule: "none",
};

// A fully-exercised fixture: heavy GC utilization, every Site-Ops entry type, and STEP 4
// rows across many divisions — the worst-case node count the Links tab opens against.
const gc: PersonnelCalcResult = computePersonnelCosts(
  18,
  52000,
  { ex: 75, srPm: 40, pm: 100, srSu: 60, su: 100, asstSu: 50 },
  { dumpsters: 2500, toilets: 1800, electric: 4200 },
  { designArch: 42000, projectSigns: 3, legalFees: 2 },
  { ex: 210, su: 132 }
);
const siteOps: SiteOpsCalcResult = computeSiteOperations(
  18,
  52000,
  { knox: 3, demolition: 800, soilBorings: 5, ffeRelocation: 12000, abatement: 8000, payrollCleaning: 40, finalCleaning: 2 },
  { soilBorings: 1500 }
);

let nextId = 0;
function makeRow(over: Partial<ProcessedTakeoffRow> = {}): ProcessedTakeoffRow {
  return {
    id: over.id ?? `row-${nextId++}`,
    classification: "",
    itemId: "",
    procoreParentCode: "",
    procoreCode: "",
    description: "",
    matchedQty: 0,
    uom: "",
    unitPrice: 0,
    total: 0,
    isMapped: false,
    rawQuantities: [],
    costType: "",
    ...over,
  };
}

// STEP 4 rows across 10 divisions (two per division to exercise the rollup), plus one
// unmapped row that must NOT mint a division node.
const DIV_CODES = ["03", "04", "05", "06", "07", "08", "09", "22", "26", "32"];
const rows: ProcessedTakeoffRow[] = [
  ...DIV_CODES.flatMap((d, i) => [
    makeRow({ itemId: `${d}-1000.001`, total: 1000 * (i + 1), description: `${d} A` }),
    makeRow({ itemId: `${d}-2000.001`, total: 500 * (i + 1), description: `${d} B` }),
  ]),
  makeRow({ itemId: "MANUAL", total: 4242, description: "unmapped" }),
];
const summary: TakeoffSummary = computeTakeoffSummary(rows, 52000, 100, RATES, []);

/** Each tier's exclusive node-ID namespace prefix. */
const TIER_PREFIX: Record<EngineGraphTier, string> = {
  summary: "summary:",
  gc: "gc:",
  siteOps: "siteops:",
  division: "division:",
};

function tierNodes(tier: EngineGraphTier) {
  return describeEngineGraph(gc, siteOps, rows, summary, tier);
}

describe("engine graph coverage — tier registration", () => {
  it("ALL_ENGINE_TIERS is exactly the four shipped tiers", () => {
    expect([...ALL_ENGINE_TIERS]).toEqual(["summary", "gc", "siteOps", "division"]);
  });

  it("every tier emits nodes ONLY in its own namespace (catches a union entry with no switch branch)", () => {
    for (const tier of ALL_ENGINE_TIERS) {
      const nodes = tierNodes(tier);
      expect(nodes.length).toBeGreaterThan(0);
      for (const n of nodes) expect(n.id.startsWith(TIER_PREFIX[tier])).toBe(true);
    }
  });
});

describe("engine graph coverage — the union covers every engine-produced value (no straggler)", () => {
  const full = describeEngineGraph(gc, siteOps, rows, summary, ALL_ENGINE_TIERS);
  const ids = new Set(full.map((n) => n.id));

  it("the full graph is the disjoint union of the per-tier sets (no cross-tier id collision)", () => {
    const perTierTotal = ALL_ENGINE_TIERS.reduce((sum, t) => sum + tierNodes(t).length, 0);
    expect(full.length).toBe(perTierTotal); // no duplicates across tiers
    expect(ids.size).toBe(full.length); // all ids unique
  });

  it("covers all 13 summary fields", () => {
    for (const f of ALL_SUMMARY_FIELDS) expect(ids.has(summaryNodeId(f))).toBe(true);
  });

  it("covers every GC aggregate + one leaf-total per GC line", () => {
    expect(ids.has(GC_GRAND_TOTAL_NODE_ID)).toBe(true);
    expect(ids.has(GC_SUPERVISION_NODE_ID)).toBe(true);
    expect(ids.has(GC_GENERAL_NODE_ID)).toBe(true);
    for (const g of ["staff", "ops", "equipment", "manual"] as const) {
      expect(ids.has(gcSubtotalNodeId(g))).toBe(true);
    }
    const gcLeafTotals = [...ids].filter((id) => /^gc:(staff|ops|equipment|manual):.+:total$/.test(id));
    const gcLineCount =
      gc.staffLines.length + gc.operationalLines.length + gc.equipmentLines.length + gc.manualLines.length;
    expect(gcLeafTotals.length).toBe(gcLineCount);
  });

  it("covers every Site-Ops aggregate + all 8 sections + one leaf-total per Site-Ops line", () => {
    expect(ids.has(SITEOPS_GRAND_TOTAL_NODE_ID)).toBe(true);
    expect(ids.has(siteOpsSubtotalNodeId("dynamic"))).toBe(true);
    expect(ids.has(siteOpsSubtotalNodeId("manual"))).toBe(true);
    for (const s of SITE_OPS_SECTIONS) expect(ids.has(siteOpsSectionNodeId(s.id))).toBe(true);
    const soLeafTotals = [...ids].filter((id) => /^siteops:(dynamic|manual):.+:total$/.test(id));
    expect(soLeafTotals.length).toBe(siteOps.dynamicLines.length + siteOps.manualLines.length);
  });

  it("covers one division total per PRESENT STEP 4 division (and none for unmapped scope)", () => {
    const present = new Set(rows.map((r) => getDivisionCode(r.itemId)).filter((c) => c !== ""));
    for (const code of present) expect(ids.has(divisionTotalNodeId(code))).toBe(true);
    const divisionNodes = [...ids].filter((id) => id.startsWith("division:"));
    expect(divisionNodes.length).toBe(present.size);
    expect(present.has("")).toBe(false);
  });
});

describe("engine graph coverage — full-graph perf at the seam (Links-tab open)", () => {
  it("assembles + evaluates the full ~240-node graph well under budget", () => {
    const t0 = performance.now();
    const nodes = assembleBindingGraphNodes([], gc, siteOps, rows, {
      includeEngineGraph: true,
      summary,
    });
    const values = evaluateGraph(nodes);
    const elapsedMs = performance.now() - t0;

    // The full graph is substantial (engine echo nodes + per-line source nodes). Measured
    // in Phase 5: 326 nodes assemble + evaluate in ~1ms — three orders of magnitude under
    // the budget below (a single in-memory topo-sort pass; perf is a non-issue at this size).
    expect(nodes.length).toBeGreaterThan(150);
    // Sanity: a representative node across each tier resolved.
    expect(values.get(GC_GRAND_TOTAL_NODE_ID)).toBeCloseTo(gc.grandTotal, 6);
    expect(values.get(SITEOPS_GRAND_TOTAL_NODE_ID)).toBeCloseTo(siteOps.grandTotal, 6);
    expect(values.get(summaryNodeId("totalEstimatedCost"))).toBeCloseTo(summary.totalEstimatedCost, 6);
    // Generous CI-safe budget — assemble+evaluate is a single in-memory topo-sort pass.
    expect(elapsedMs).toBeLessThan(500);
  });
});
