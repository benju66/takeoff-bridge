/**
 * Linked Values — Bucket B Phase 4: the Site-Ops structural-completeness guard.
 *
 * This is the load-bearing test for the Site-Ops tier (plan §6 — "edge-authoring drift, the
 * main risk"), the analog of the Phase 3 GC structure test. The Site-Ops tree's edges are
 * HAND-AUTHORED from the engine's structure; if the engine grows a line/driver/section and
 * the descriptor isn't updated, the inspection graph would silently LIE. It asserts:
 *
 *   1. NODE SET COMPLETENESS — the descriptor's Site-Ops node set EXACTLY matches the set
 *      built independently from `SiteOpsCalcResult`'s own arrays (every produced value has a
 *      node: total/qty/rate per dynamic + manual line, the two group subtotals, all 8 section
 *      subtotals, the grand total; no spurious, no missing field).
 *   2. VALUE/EDGE FIDELITY — every aggregate equals the SUM OF ITS DECLARED INPUTS, and the
 *      grand total equals the sum of ALL leaf totals AND the sum of the 8 section subtotals.
 *      This is the real drift catch: a new engine line/section that the hand-authored edges
 *      don't cover makes Σ(leaves) ≠ grandTotal (or Σ(sections) ≠ grandTotal), so this test
 *      fails the moment the descriptor falls behind.
 *   3. ECHO === ENGINE — each node returns the engine's own value (LD-B2), with no orphan
 *      edges (every input id is emitted).
 *
 * Fixtures flow from the calculation authority (`computeSiteOperations`) — never invented.
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
  SITEOPS_GRAND_TOTAL_NODE_ID,
  siteOpsLeafNodeId,
  siteOpsSectionNodeId,
  siteOpsSubtotalNodeId,
  type GraphNode,
  type SiteOpsLineGroup,
} from "../bindings/types";
import {
  SITE_OPS_DYNAMIC_DEFAULTS,
  SITE_OPS_MANUAL_DEFAULTS,
  SITE_OPS_SECTIONS,
  type SiteOpsSection,
} from "../constants";

// --- Fixtures (the siteOps tier ignores gc/summary; any in-scope values work) ------------
const gc: PersonnelCalcResult = computePersonnelCosts(
  12,
  30000,
  { ex: 50, su: 100, srSu: 25 },
  { dumpsters: 1000, toilets: 2000, electric: 3000 },
  { designCivil: 18500 }
);
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

// Two distinct Site-Ops results so the invariants hold across inputs. The varied fixture
// exercises all 3 manual entry types (qtyRate/lumpSum/qty).
const soPopulated: SiteOpsCalcResult = computeSiteOperations(
  12,
  10000,
  { knox: 2, demolition: 500, sawcutting: 950, finalCleaning: 3 },
  {}
);
const soVaried: SiteOpsCalcResult = computeSiteOperations(
  15,
  25000,
  { knox: 3, demolition: 800, soilBorings: 5, ffeRelocation: 12000, abatement: 8000, payrollCleaning: 40, finalCleaning: 2 },
  { soilBorings: 1500 }
);

const FIXTURES: readonly [string, SiteOpsCalcResult][] = [
  ["populated", soPopulated],
  ["all-3-entry-types", soVaried],
];

const SITE_OPS_GROUPS = ["dynamic", "manual"] as const;
function groupLines(
  so: SiteOpsCalcResult,
  group: SiteOpsLineGroup
): readonly { code: string; total: number }[] {
  return group === "dynamic" ? so.dynamicLines : so.manualLines;
}

/** STEP 3 line code → its template section, built independently from the configs. */
const SECTION_BY_CODE: ReadonlyMap<string, SiteOpsSection> = (() => {
  const m = new Map<string, SiteOpsSection>();
  for (const c of SITE_OPS_DYNAMIC_DEFAULTS) m.set(c.code, c.section);
  for (const c of SITE_OPS_MANUAL_DEFAULTS) m.set(c.code, c.section);
  return m;
})();

/**
 * The Site-Ops node-id set the descriptor MUST emit, built independently from the engine
 * arrays here (so a descriptor that forgets a field/line/aggregate diverges from this set).
 */
function expectedSiteOpsNodeIds(so: SiteOpsCalcResult): Set<string> {
  const ids = new Set<string>([
    SITEOPS_GRAND_TOTAL_NODE_ID,
    siteOpsSubtotalNodeId("dynamic"),
    siteOpsSubtotalNodeId("manual"),
  ]);
  for (const s of SITE_OPS_SECTIONS) ids.add(siteOpsSectionNodeId(s.id));
  for (const group of SITE_OPS_GROUPS) {
    for (const l of groupLines(so, group)) {
      ids.add(siteOpsLeafNodeId(group, l.code, "total"));
      ids.add(siteOpsLeafNodeId(group, l.code, "qty"));
      ids.add(siteOpsLeafNodeId(group, l.code, "rate"));
    }
  }
  return ids;
}

const LEAF_TOTAL_RE = /^siteops:(dynamic|manual):.+:total$/;

function build(so: SiteOpsCalcResult): {
  nodes: GraphNode[];
  byId: Map<string, GraphNode>;
  values: Map<string, number>;
} {
  const nodes = describeEngineGraph(gc, so, [], summary, "siteOps");
  return { nodes, byId: new Map(nodes.map((n) => [n.id, n])), values: evaluateGraph(nodes) };
}

describe("Site-Ops structural completeness — node set matches the engine's produced-value set", () => {
  for (const [label, so] of FIXTURES) {
    const { nodes } = build(so);
    const ids = new Set(nodes.map((n) => n.id));

    it(`emits EXACTLY the engine-derived Site-Ops node set (no missing, no spurious) — ${label}`, () => {
      expect(ids).toEqual(expectedSiteOpsNodeIds(so));
    });

    it(`every Site-Ops node id is unique — ${label}`, () => {
      expect(nodes.length).toBe(ids.size);
    });

    it(`one leaf-total node per engine line, every line accounted for — ${label}`, () => {
      const leafTotalCount = [...ids].filter((id) => LEAF_TOTAL_RE.test(id)).length;
      const engineLineCount = so.dynamicLines.length + so.manualLines.length;
      expect(leafTotalCount).toBe(engineLineCount);
    });

    it(`emits all 8 section subtotal nodes — ${label}`, () => {
      for (const s of SITE_OPS_SECTIONS) expect(ids.has(siteOpsSectionNodeId(s.id))).toBe(true);
    });
  }
});

describe("Site-Ops structural completeness — value/edge fidelity (the drift catch)", () => {
  for (const [label, so] of FIXTURES) {
    const { byId, values } = build(so);
    const v = (id: string): number => {
      expect(byId.has(id)).toBe(true);
      return values.get(id)!;
    };
    const sumInputs = (id: string): number =>
      byId.get(id)!.inputs.reduce((s, dep) => s + (values.get(dep) ?? 0), 0);

    it(`each aggregate equals the SUM OF ITS DECLARED INPUTS — ${label}`, () => {
      expect(v(siteOpsSubtotalNodeId("dynamic"))).toBeCloseTo(sumInputs(siteOpsSubtotalNodeId("dynamic")), 6);
      expect(v(siteOpsSubtotalNodeId("manual"))).toBeCloseTo(sumInputs(siteOpsSubtotalNodeId("manual")), 6);
      expect(v(SITEOPS_GRAND_TOTAL_NODE_ID)).toBeCloseTo(sumInputs(SITEOPS_GRAND_TOTAL_NODE_ID), 6);
      for (const s of SITE_OPS_SECTIONS) {
        expect(v(siteOpsSectionNodeId(s.id))).toBeCloseTo(sumInputs(siteOpsSectionNodeId(s.id)), 6);
      }
    });

    it(`grand total = Σ all leaf totals = Σ the 8 section subtotals = siteOps.grandTotal — ${label}`, () => {
      const allLeafTotals = [...byId.keys()]
        .filter((id) => LEAF_TOTAL_RE.test(id))
        .reduce((s, id) => s + (values.get(id) ?? 0), 0);
      const allSectionSubtotals = SITE_OPS_SECTIONS.reduce(
        (s, sec) => s + (values.get(siteOpsSectionNodeId(sec.id)) ?? 0),
        0
      );
      expect(v(SITEOPS_GRAND_TOTAL_NODE_ID)).toBeCloseTo(allLeafTotals, 6);
      expect(v(SITEOPS_GRAND_TOTAL_NODE_ID)).toBeCloseTo(allSectionSubtotals, 6);
      expect(v(SITEOPS_GRAND_TOTAL_NODE_ID)).toBeCloseTo(so.grandTotal, 6);
    });

    it(`each section subtotal sums only its own member lines (by code) — ${label}`, () => {
      for (const s of SITE_OPS_SECTIONS) {
        const memberTotal = [...so.dynamicLines, ...so.manualLines]
          .filter((l) => SECTION_BY_CODE.get(l.code) === s.id)
          .reduce((sum, l) => sum + l.total, 0);
        expect(v(siteOpsSectionNodeId(s.id))).toBeCloseTo(memberTotal, 6);
      }
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
