/**
 * Linked Values — Bucket B Phase 3: the GC structural-completeness guard.
 *
 * This is the load-bearing test for the GC tier (plan §6 — "edge-authoring drift, the main
 * risk"). The GC tree's edges are HAND-AUTHORED from the engine's structure; if the engine
 * grows a line/driver/cost-group and the descriptor isn't updated, the inspection graph would
 * silently LIE. The analog of v1's registry-completeness invariant, it asserts three things:
 *
 *   1. NODE SET COMPLETENESS — the descriptor's GC node set EXACTLY matches the set built
 *      independently from `PersonnelCalcResult`'s own arrays (every produced value has one
 *      node; no spurious nodes; no missing field).
 *   2. VALUE/EDGE FIDELITY — every aggregate equals the SUM OF ITS DECLARED INPUTS, and the
 *      grand total equals the sum of ALL leaf totals. This is the real drift catch: a new
 *      engine cost group that the hand-authored grand-total edges don't cover makes
 *      Σ(leaves) ≠ grandTotal, so this test fails the moment the descriptor falls behind.
 *   3. ECHO === ENGINE — each node returns the engine's own value (LD-B2), with no orphan
 *      edges (every input id is emitted).
 *
 * Fixtures flow from the calculation authority (`computePersonnelCosts`) — never invented.
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
import { describeEngineGraph } from "../bindings/engineGraph";
import { evaluateGraph } from "../bindings/graph";
import {
  GC_GENERAL_NODE_ID,
  GC_GRAND_TOTAL_NODE_ID,
  GC_SUPERVISION_NODE_ID,
  gcLeafNodeId,
  gcSubtotalNodeId,
  type GcSubtotalGroup,
  type GraphNode,
} from "../bindings/types";
import { SUPERVISION_STAFF_CODES } from "../constants";

// --- Fixtures (two distinct GC results so the invariants hold across inputs) -------------
const siteOps: SiteOpsCalcResult = computeSiteOperations(12, 10000, { knox: 2 }, {});
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
const summary: TakeoffSummary = computeTakeoffSummary([], 30000, 100, RATES, []);

const gcPopulated: PersonnelCalcResult = computePersonnelCosts(
  12,
  30000,
  { ex: 50, su: 100, srSu: 25 },
  { dumpsters: 1000, toilets: 2000, electric: 3000 },
  { designCivil: 18500 }
);
const gcAlt: PersonnelCalcResult = computePersonnelCosts(
  18,
  52000,
  { ex: 75, srPm: 40, pm: 100, srSu: 60, su: 100, asstSu: 50 },
  { dumpsters: 2500, toilets: 1800, electric: 4200 },
  { designArch: 42000, projectSigns: 3, legalFees: 2 },
  { ex: 210, su: 132 }
);

const FIXTURES: readonly [string, PersonnelCalcResult][] = [
  ["populated", gcPopulated],
  ["rate-override", gcAlt],
];

/** Lines with a qty×rate leaf (equipment is lump-sum). */
const QTY_RATE_GROUPS = ["staff", "ops", "manual"] as const;
function leafLines(
  gc: PersonnelCalcResult,
  group: GcSubtotalGroup
): readonly { code: string; total: number }[] {
  switch (group) {
    case "staff":
      return gc.staffLines;
    case "ops":
      return gc.operationalLines;
    case "manual":
      return gc.manualLines;
    case "equipment":
      return gc.equipmentLines;
  }
}

/**
 * The GC node-id set the descriptor MUST emit, built independently from the engine arrays
 * here (so a descriptor that forgets a field/line/aggregate diverges from this set).
 */
function expectedGcNodeIds(gc: PersonnelCalcResult): Set<string> {
  const ids = new Set<string>([
    GC_GRAND_TOTAL_NODE_ID,
    GC_SUPERVISION_NODE_ID,
    GC_GENERAL_NODE_ID,
    gcSubtotalNodeId("staff"),
    gcSubtotalNodeId("ops"),
    gcSubtotalNodeId("equipment"),
    gcSubtotalNodeId("manual"),
  ]);
  for (const group of QTY_RATE_GROUPS) {
    for (const l of leafLines(gc, group)) {
      ids.add(gcLeafNodeId(group, l.code, "total"));
      ids.add(gcLeafNodeId(group, l.code, "qty"));
      ids.add(gcLeafNodeId(group, l.code, "rate"));
    }
  }
  for (const l of gc.equipmentLines) ids.add(gcLeafNodeId("equipment", l.code, "total"));
  return ids;
}

function build(gc: PersonnelCalcResult): {
  nodes: GraphNode[];
  byId: Map<string, GraphNode>;
  values: Map<string, number>;
} {
  const nodes = describeEngineGraph(gc, siteOps, [], summary, "gc");
  return { nodes, byId: new Map(nodes.map((n) => [n.id, n])), values: evaluateGraph(nodes) };
}

describe("GC structural completeness — node set matches the engine's produced-value set", () => {
  for (const [label, gc] of FIXTURES) {
    const { nodes } = build(gc);
    const ids = new Set(nodes.map((n) => n.id));

    it(`emits EXACTLY the engine-derived GC node set (no missing, no spurious) — ${label}`, () => {
      expect(ids).toEqual(expectedGcNodeIds(gc));
    });

    it(`every GC node id is unique — ${label}`, () => {
      expect(nodes.length).toBe(ids.size);
    });

    it(`one leaf-total node per engine line, every line accounted for — ${label}`, () => {
      const leafTotalCount = [...ids].filter((id) => /^gc:[a-z]+:.+:total$/.test(id)).length;
      const engineLineCount =
        gc.staffLines.length +
        gc.operationalLines.length +
        gc.equipmentLines.length +
        gc.manualLines.length;
      expect(leafTotalCount).toBe(engineLineCount);
    });
  }
});

describe("GC structural completeness — value/edge fidelity (the drift catch)", () => {
  for (const [label, gc] of FIXTURES) {
    const { byId, values } = build(gc);
    const v = (id: string): number => {
      expect(byId.has(id)).toBe(true);
      return values.get(id)!;
    };
    const sumInputs = (id: string): number =>
      byId.get(id)!.inputs.reduce((s, dep) => s + (values.get(dep) ?? 0), 0);

    it(`each aggregate equals the SUM OF ITS DECLARED INPUTS — ${label}`, () => {
      for (const group of ["staff", "ops", "equipment", "manual"] as const) {
        expect(v(gcSubtotalNodeId(group))).toBeCloseTo(sumInputs(gcSubtotalNodeId(group)), 6);
      }
      expect(v(GC_GRAND_TOTAL_NODE_ID)).toBeCloseTo(sumInputs(GC_GRAND_TOTAL_NODE_ID), 6);
      expect(v(GC_SUPERVISION_NODE_ID)).toBeCloseTo(sumInputs(GC_SUPERVISION_NODE_ID), 6);
    });

    it(`grand total equals the sum of ALL leaf totals (no leaf/group escapes) — ${label}`, () => {
      const allLeafTotals = [...byId.keys()]
        .filter((id) => /^gc:[a-z]+:.+:total$/.test(id))
        .reduce((s, id) => s + (values.get(id) ?? 0), 0);
      expect(v(GC_GRAND_TOTAL_NODE_ID)).toBeCloseTo(allLeafTotals, 6);
      expect(v(GC_GRAND_TOTAL_NODE_ID)).toBeCloseTo(gc.grandTotal, 6);
    });

    it(`general = grand total − supervision; supervision sums only supervision staff — ${label}`, () => {
      const engineSupervision = gc.staffLines
        .filter((l) => SUPERVISION_STAFF_CODES.includes(l.code))
        .reduce((s, l) => s + l.total, 0);
      expect(v(GC_SUPERVISION_NODE_ID)).toBeCloseTo(engineSupervision, 6);
      expect(v(GC_GENERAL_NODE_ID)).toBeCloseTo(gc.grandTotal - engineSupervision, 6);
    });

    it(`echo === engine per node, with no orphan edges — ${label}`, () => {
      // echo: every node returns its captured value ignoring inputs.
      for (const n of byId.values()) expect(n.evaluate(new Map())).toBeCloseTo(values.get(n.id)!, 6);
      // no orphan edges: every declared input id is emitted.
      const ids = new Set(byId.keys());
      for (const n of byId.values()) {
        for (const dep of n.inputs) expect(ids.has(dep)).toBe(true);
      }
    });
  }
});
