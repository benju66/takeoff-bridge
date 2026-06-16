/**
 * Linked Values — Bucket B Phase 1: the engine graph descriptor proof.
 *
 * Proves the echo-descriptor model (LD-B2) end to end for the Tier-1 `summary:*` nodes:
 *   - VALUE FAITHFULNESS: every node's value === the engine's own `computeTakeoffSummary`
 *     output to the cent, across a populated bid, an all-zero edge case, AND an override
 *     fixture (the override case is the load-bearing guard: the descriptor must echo the
 *     engine's EFFECTIVE value, never re-derive the math — re-derivation would diverge
 *     from an overridden subtotal/component).
 *   - EDGE STRUCTURE: each node declares exactly the authored inputs (the depends-on view).
 *   - COMPLETENESS: the descriptor emits exactly the 13 summary fields, no more, no less.
 *   - NO CYCLES: the authored edge set is acyclic.
 *   - END TO END: evaluated through the real kind-blind graph engine, every node resolves
 *     to the engine value.
 *
 * Fixtures flow from the calculation authority (computeTakeoffSummary / the registry's
 * linked-totals engine) — never invented totals.
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
import { computeLinkedDivisionTotalsViaEngine } from "../bindings/registry";
import { describeEngineGraph } from "../bindings/engineGraph";
import { evaluateGraph, findCycle } from "../bindings/graph";
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
  type GcSubtotalGroup,
  type GraphNode,
  type SiteOpsLineGroup,
  type SummaryNodeField,
} from "../bindings/types";
import {
  SITE_OPS_DYNAMIC_DEFAULTS,
  SITE_OPS_MANUAL_DEFAULTS,
  SITE_OPS_SECTIONS,
  SUPERVISION_STAFF_CODES,
  type SiteOpsSection,
} from "../constants";
import type { EstimateOverrideMap, ProcessedTakeoffRow } from "@/types";

// ---------------------------------------------------------------------------
// Helpers + fixtures
// ---------------------------------------------------------------------------

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

/** Every TakeoffSummary field exposed as a node (the Tier-1 set). */
const ALL_SUMMARY_FIELDS: readonly SummaryNodeField[] = [
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
];

const MODIFIER_FIELDS: readonly SummaryNodeField[] = [
  "constructionContingency",
  "designContingency",
  "buildersRisk",
  "specialInsurance",
  "glInsurance",
  "bond",
  "fee",
];

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

// Engine results — passed for the stable signature (the summary tier reads only `summary`).
const gc: PersonnelCalcResult = computePersonnelCosts(
  12,
  30000,
  { ex: 50, su: 100, srSu: 25 },
  { dumpsters: 1000, toilets: 2000, electric: 3000 },
  { designCivil: 18500 }
);
const siteOps: SiteOpsCalcResult = computeSiteOperations(
  12,
  10000,
  { knox: 2, demolition: 500, sawcutting: 950, finalCleaning: 3 },
  {}
);

// Real linked-division totals + their rows, so linkedDivisionsTotal is non-trivial and
// counted exactly as the engine counts it (display-only rows + linkedTotals).
const linkedTotals = computeLinkedDivisionTotalsViaEngine(gc, siteOps);
const linkedRows = linkedTotals.map((l) =>
  makeRow({ itemId: l.itemId, matchedQty: 1, unitPrice: 0, description: l.description })
);
const takeoffRows = [
  makeRow({ itemId: "09-2100.001", matchedQty: 1200, unitPrice: 2.45, description: "Drywall" }),
  makeRow({ itemId: "03-3000.001", matchedQty: 80, unitPrice: 410.5, description: "Concrete" }),
];

/** Build a TakeoffSummary + its echo nodes from one set of inputs. */
function build(
  rows: ProcessedTakeoffRow[],
  sf: number,
  units: number,
  overrides?: EstimateOverrideMap
): { summary: TakeoffSummary; nodes: GraphNode[] } {
  const summary = computeTakeoffSummary(rows, sf, units, RATES, linkedTotals, overrides);
  const nodes = describeEngineGraph(gc, siteOps, rows, summary, "summary");
  return { summary, nodes };
}

const populated = build([...takeoffRows, ...linkedRows], 30000, 100);
const zero = build([], 0, 0);
// Override fixture: a component override (bond) AND a subtotal override — neither equals
// what re-deriving from the rows would yield, so a faithful echo must follow the engine.
const overridden = build([...takeoffRows, ...linkedRows], 30000, 100, {
  subtotal: 500000,
  bond: 7777,
  totalEstimatedCost: 1234567,
});

/** Looks a node up by its summary field. */
function nodeFor(nodes: GraphNode[], field: SummaryNodeField): GraphNode {
  const node = nodes.find((n) => n.id === summaryNodeId(field));
  if (!node) throw new Error(`missing engine node for ${field}`);
  return node;
}

// ---------------------------------------------------------------------------
// Value faithfulness — echo === computeTakeoffSummary to the cent
// ---------------------------------------------------------------------------

describe("engineGraph — echo equals computeTakeoffSummary (the engine is the authority)", () => {
  for (const [label, fx] of [
    ["populated bid", populated],
    ["all-zero edge case", zero],
    ["override fixture", overridden],
  ] as const) {
    it(`echoes every summary node to the cent — ${label}`, () => {
      for (const field of ALL_SUMMARY_FIELDS) {
        const node = nodeFor(fx.nodes, field);
        // evaluate ignores inputs and returns the captured engine value.
        expect(node.evaluate(new Map())).toBeCloseTo(fx.summary[field], 8);
      }
    });
  }

  it("the populated fixture actually exercises non-zero values across the trail", () => {
    expect(populated.summary.takeoffSubtotal).toBeGreaterThan(0);
    expect(populated.summary.linkedDivisionsTotal).toBeGreaterThan(0);
    expect(populated.summary.subtotal).toBeGreaterThan(0);
    expect(populated.summary.fee).toBeGreaterThan(0);
    expect(populated.summary.totalEstimatedCost).toBeGreaterThan(0);
    expect(populated.summary.costPerSf).toBeGreaterThan(0);
  });

  it("the override fixture reports the engine's EFFECTIVE values, NOT a re-derivation", () => {
    // Engine applied the overrides; the echo must follow them (LD-B2 guard).
    expect(overridden.summary.subtotal).toBe(500000);
    expect(overridden.summary.bond).toBe(7777);
    expect(overridden.summary.totalEstimatedCost).toBe(1234567);
    expect(nodeFor(overridden.nodes, "subtotal").evaluate(new Map())).toBe(500000);
    expect(nodeFor(overridden.nodes, "bond").evaluate(new Map())).toBe(7777);
    expect(nodeFor(overridden.nodes, "totalEstimatedCost").evaluate(new Map())).toBe(1234567);
    // And these differ from the un-overridden engine run (proving they are not re-derived).
    expect(overridden.summary.subtotal).not.toBeCloseTo(populated.summary.subtotal, 2);
  });
});

// ---------------------------------------------------------------------------
// Edge structure — the authored depends-on view
// ---------------------------------------------------------------------------

describe("engineGraph — authored edges (the depends-on / used-by wiring)", () => {
  const nodes = populated.nodes;

  it("cross-page leaves have no inputs in the summary tier", () => {
    expect(nodeFor(nodes, "takeoffSubtotal").inputs).toEqual([]);
    expect(nodeFor(nodes, "linkedDivisionsTotal").inputs).toEqual([]);
  });

  it("subtotal reads takeoffSubtotal + linkedDivisionsTotal", () => {
    expect(nodeFor(nodes, "subtotal").inputs).toEqual([
      summaryNodeId("takeoffSubtotal"),
      summaryNodeId("linkedDivisionsTotal"),
    ]);
  });

  it("each of the 7 modifiers reads subtotal", () => {
    for (const field of MODIFIER_FIELDS) {
      expect(nodeFor(nodes, field).inputs).toEqual([summaryNodeId("subtotal")]);
    }
  });

  it("totalEstimatedCost reads subtotal + all 7 modifiers", () => {
    expect(nodeFor(nodes, "totalEstimatedCost").inputs).toEqual([
      summaryNodeId("subtotal"),
      ...MODIFIER_FIELDS.map((f) => summaryNodeId(f)),
    ]);
  });

  it("cost-per-metric nodes read totalEstimatedCost", () => {
    expect(nodeFor(nodes, "costPerSf").inputs).toEqual([summaryNodeId("totalEstimatedCost")]);
    expect(nodeFor(nodes, "costPerUnit").inputs).toEqual([summaryNodeId("totalEstimatedCost")]);
  });

  it("every edge points at a node the descriptor also emits (no dangling edges)", () => {
    const ids = new Set(nodes.map((n) => n.id));
    for (const n of nodes) {
      for (const dep of n.inputs) expect(ids.has(dep)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Completeness + acyclicity + nodes are plain read-only GraphNodes
// ---------------------------------------------------------------------------

describe("engineGraph — node set, basis, and acyclicity", () => {
  it("emits exactly the 13 summary fields, no more, no less", () => {
    const ids = populated.nodes.map((n) => n.id).sort();
    const expected = ALL_SUMMARY_FIELDS.map((f) => summaryNodeId(f)).sort();
    expect(ids).toEqual(expected);
  });

  it("all summary nodes carry a basis (currency for money, rate for cost-per-metric)", () => {
    for (const field of ALL_SUMMARY_FIELDS) {
      const expectedBasis = field === "costPerSf" || field === "costPerUnit" ? "rate" : "currency";
      expect(nodeFor(populated.nodes, field).basis).toBe(expectedBasis);
    }
  });

  it("the authored edge set is acyclic", () => {
    expect(findCycle(populated.nodes)).toBeNull();
    expect(findCycle(zero.nodes)).toBeNull();
    expect(findCycle(overridden.nodes)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// End to end — evaluated through the real kind-blind graph engine
// ---------------------------------------------------------------------------

describe("engineGraph — evaluates through the kind-blind graph to the engine value", () => {
  for (const [label, fx] of [
    ["populated bid", populated],
    ["override fixture", overridden],
  ] as const) {
    it(`evaluateGraph resolves every summary node to the engine value — ${label}`, () => {
      const values = evaluateGraph(fx.nodes);
      for (const field of ALL_SUMMARY_FIELDS) {
        expect(values.get(summaryNodeId(field))).toBeCloseTo(fx.summary[field], 8);
      }
    });
  }
});

// ===========================================================================
// GC tier (Phase 3) — the STEP 2 General Conditions decomposition tree
// ===========================================================================

// A second GC fixture (different durations, utilizations, rate overrides, and extra
// manual/equipment entries). It proves the descriptor ECHOES the engine's result across
// varied inputs — never a re-derivation of defaults (the LD-B2 faithfulness guard, the GC
// analog of the summary override fixture above).
const gcAlt: PersonnelCalcResult = computePersonnelCosts(
  18,
  52000,
  { ex: 75, srPm: 40, pm: 100, srSu: 60, su: 100, asstSu: 50 },
  { dumpsters: 2500, toilets: 1800, electric: 4200 },
  { designArch: 42000, projectSigns: 3, legalFees: 2 },
  { ex: 210, su: 132 }
);

/** Build the GC-tier nodes + an id→node map for one PersonnelCalcResult (the tier ignores
 * `summary`/`rows`; any in-scope summary works). */
function gcBuild(gcRes: PersonnelCalcResult): {
  nodes: GraphNode[];
  byId: Map<string, GraphNode>;
} {
  const nodes = describeEngineGraph(gcRes, siteOps, [], populated.summary, "gc");
  return { nodes, byId: new Map(nodes.map((n) => [n.id, n])) };
}

/** Σ the supervision staff leaf totals exactly as the engine/oracle does. */
function supervisionOf(gcRes: PersonnelCalcResult): number {
  return gcRes.staffLines
    .filter((l) => SUPERVISION_STAFF_CODES.includes(l.code))
    .reduce((s, l) => s + l.total, 0);
}

/** The three qty×rate groups (equipment is lump-sum, asserted separately). */
const QTY_RATE_GROUPS = ["staff", "ops", "manual"] as const;
type LeafLine = { code: string; qty: number; rate: number; total: number };
function groupLines(gcRes: PersonnelCalcResult, group: GcSubtotalGroup): LeafLine[] {
  switch (group) {
    case "staff":
      return gcRes.staffLines;
    case "ops":
      return gcRes.operationalLines;
    case "manual":
      return gcRes.manualLines;
    case "equipment":
      return gcRes.equipmentLines.map((l) => ({ ...l, qty: 0, rate: 0 }));
  }
}

describe("engineGraph gc tier — echo equals computePersonnelCosts (the engine is the authority)", () => {
  for (const [label, gcRes] of [
    ["populated", gc],
    ["rate-override", gcAlt],
  ] as const) {
    const { byId } = gcBuild(gcRes);
    const val = (id: string): number => {
      const n = byId.get(id);
      if (!n) throw new Error(`missing gc node ${id}`);
      return n.evaluate(new Map());
    };

    it(`echoes every staff/ops/manual leaf line (total, qty, rate) — ${label}`, () => {
      for (const group of QTY_RATE_GROUPS) {
        for (const l of groupLines(gcRes, group)) {
          expect(val(gcLeafNodeId(group, l.code, "total"))).toBeCloseTo(l.total, 8);
          expect(val(gcLeafNodeId(group, l.code, "qty"))).toBeCloseTo(l.qty, 8);
          expect(val(gcLeafNodeId(group, l.code, "rate"))).toBeCloseTo(l.rate, 8);
        }
      }
    });

    it(`echoes each equipment leaf total (lump sum, no qty/rate node) — ${label}`, () => {
      for (const l of gcRes.equipmentLines) {
        expect(val(gcLeafNodeId("equipment", l.code, "total"))).toBeCloseTo(l.total, 8);
        expect(byId.has(gcLeafNodeId("equipment", l.code, "qty"))).toBe(false);
        expect(byId.has(gcLeafNodeId("equipment", l.code, "rate"))).toBe(false);
      }
    });

    it(`echoes the four subtotals, grand total, supervision, and general — ${label}`, () => {
      const sup = supervisionOf(gcRes);
      expect(val(gcSubtotalNodeId("staff"))).toBeCloseTo(
        gcRes.staffLines.reduce((s, l) => s + l.total, 0),
        8
      );
      expect(val(gcSubtotalNodeId("ops"))).toBeCloseTo(
        gcRes.operationalLines.reduce((s, l) => s + l.total, 0),
        8
      );
      expect(val(gcSubtotalNodeId("equipment"))).toBeCloseTo(gcRes.equipmentTotal, 8);
      expect(val(gcSubtotalNodeId("manual"))).toBeCloseTo(
        gcRes.manualLines.reduce((s, l) => s + l.total, 0),
        8
      );
      expect(val(GC_GRAND_TOTAL_NODE_ID)).toBeCloseTo(gcRes.grandTotal, 8);
      expect(val(GC_SUPERVISION_NODE_ID)).toBeCloseTo(sup, 8);
      expect(val(GC_GENERAL_NODE_ID)).toBeCloseTo(gcRes.grandTotal - sup, 8);
    });
  }

  it("the populated fixture exercises non-zero values across all four groups", () => {
    expect(gc.staffLines.reduce((s, l) => s + l.total, 0)).toBeGreaterThan(0);
    expect(gc.operationalLines.reduce((s, l) => s + l.total, 0)).toBeGreaterThan(0);
    expect(gc.equipmentTotal).toBeGreaterThan(0);
    expect(gc.manualLines.reduce((s, l) => s + l.total, 0)).toBeGreaterThan(0);
    expect(supervisionOf(gc)).toBeGreaterThan(0);
  });
});

describe("engineGraph gc tier — authored edges (the depends-on / used-by wiring)", () => {
  const { byId } = gcBuild(gc);
  const inputs = (id: string): string[] => byId.get(id)!.inputs;

  it("grand total reads the four group subtotals, in order", () => {
    expect(inputs(GC_GRAND_TOTAL_NODE_ID)).toEqual([
      gcSubtotalNodeId("staff"),
      gcSubtotalNodeId("ops"),
      gcSubtotalNodeId("equipment"),
      gcSubtotalNodeId("manual"),
    ]);
  });

  it("each group subtotal reads its own group's leaf totals", () => {
    for (const group of ["staff", "ops", "equipment", "manual"] as const) {
      expect(inputs(gcSubtotalNodeId(group))).toEqual(
        groupLines(gc, group).map((l) => gcLeafNodeId(group, l.code, "total"))
      );
    }
  });

  it("each qty×rate leaf total reads its qty + rate; lump-sum equipment leaves read nothing", () => {
    for (const l of gc.staffLines) {
      expect(inputs(gcLeafNodeId("staff", l.code, "total"))).toEqual([
        gcLeafNodeId("staff", l.code, "qty"),
        gcLeafNodeId("staff", l.code, "rate"),
      ]);
    }
    for (const l of gc.equipmentLines) {
      expect(inputs(gcLeafNodeId("equipment", l.code, "total"))).toEqual([]);
    }
  });

  it("qty and rate are leaf source nodes (no inputs)", () => {
    for (const l of gc.staffLines) {
      expect(inputs(gcLeafNodeId("staff", l.code, "qty"))).toEqual([]);
      expect(inputs(gcLeafNodeId("staff", l.code, "rate"))).toEqual([]);
    }
  });

  it("supervision reads its supervision staff leaf totals; general reads grand total + supervision", () => {
    const supIds = gc.staffLines
      .filter((l) => SUPERVISION_STAFF_CODES.includes(l.code))
      .map((l) => gcLeafNodeId("staff", l.code, "total"));
    expect(inputs(GC_SUPERVISION_NODE_ID)).toEqual(supIds);
    expect(inputs(GC_GENERAL_NODE_ID)).toEqual([GC_GRAND_TOTAL_NODE_ID, GC_SUPERVISION_NODE_ID]);
  });

  it("no dangling edges (every input id is also emitted by the tier)", () => {
    const ids = new Set(byId.keys());
    for (const n of byId.values()) {
      for (const dep of n.inputs) expect(ids.has(dep)).toBe(true);
    }
  });
});

describe("engineGraph gc tier — acyclicity + evaluates through the kind-blind graph", () => {
  for (const [label, gcRes] of [
    ["populated", gc],
    ["rate-override", gcAlt],
  ] as const) {
    const { nodes } = gcBuild(gcRes);

    it(`the authored edge set is acyclic — ${label}`, () => {
      expect(findCycle(nodes)).toBeNull();
    });

    it(`evaluateGraph resolves grand total / supervision / general + leaves to the engine value — ${label}`, () => {
      const values = evaluateGraph(nodes);
      const sup = supervisionOf(gcRes);
      expect(values.get(GC_GRAND_TOTAL_NODE_ID)).toBeCloseTo(gcRes.grandTotal, 8);
      expect(values.get(GC_SUPERVISION_NODE_ID)).toBeCloseTo(sup, 8);
      expect(values.get(GC_GENERAL_NODE_ID)).toBeCloseTo(gcRes.grandTotal - sup, 8);
      for (const l of gcRes.staffLines) {
        expect(values.get(gcLeafNodeId("staff", l.code, "total"))).toBeCloseTo(l.total, 8);
      }
    });
  }
});

// ===========================================================================
// Site-Ops tier (Phase 4) — the STEP 3 Site Operations decomposition tree
// ===========================================================================

// A second Site-Ops fixture, deliberately exercising ALL THREE manual entry types so the
// uniform [qty, rate] leaf edge is proven faithful for each (the LD-B2 guard, the Site-Ops
// analog of the summary override fixture above):
//   - qtyRate → soilBorings (typed qty 5 × typed rate 1500)
//   - lumpSum → ffeRelocation (12000) + abatement (8000)
//   - qty     → knox / demolition / payrollCleaning / finalCleaning (typed qty × template rate)
const siteOpsVaried: SiteOpsCalcResult = computeSiteOperations(
  15,
  25000,
  { knox: 3, demolition: 800, soilBorings: 5, ffeRelocation: 12000, abatement: 8000, payrollCleaning: 40, finalCleaning: 2 },
  { soilBorings: 1500 }
);

/** Build the Site-Ops-tier nodes + an id→node map for one SiteOpsCalcResult (the tier
 * ignores `gc`/`summary`/`rows`; any in-scope summary works). */
function siteOpsBuild(soRes: SiteOpsCalcResult): {
  nodes: GraphNode[];
  byId: Map<string, GraphNode>;
} {
  const nodes = describeEngineGraph(gc, soRes, [], populated.summary, "siteOps");
  return { nodes, byId: new Map(nodes.map((n) => [n.id, n])) };
}

const SITE_OPS_GROUPS = ["dynamic", "manual"] as const;
function siteOpsGroupLines(
  soRes: SiteOpsCalcResult,
  group: SiteOpsLineGroup
): readonly { code: string; qty: number; rate: number; total: number }[] {
  return group === "dynamic" ? soRes.dynamicLines : soRes.manualLines;
}

/** STEP 3 line code → its template section, built independently from the configs. */
const SECTION_BY_CODE: ReadonlyMap<string, SiteOpsSection> = (() => {
  const m = new Map<string, SiteOpsSection>();
  for (const c of SITE_OPS_DYNAMIC_DEFAULTS) m.set(c.code, c.section);
  for (const c of SITE_OPS_MANUAL_DEFAULTS) m.set(c.code, c.section);
  return m;
})();

/** The leaf `total` node ids each section node MUST read (cross-cutting re-grouping). */
function expectedSectionLeafIds(soRes: SiteOpsCalcResult): Map<SiteOpsSection, string[]> {
  const m = new Map<SiteOpsSection, string[]>();
  const add = (group: SiteOpsLineGroup, lines: readonly { code: string }[]): void => {
    for (const l of lines) {
      const sec = SECTION_BY_CODE.get(l.code)!;
      const list = m.get(sec) ?? [];
      list.push(siteOpsLeafNodeId(group, l.code, "total"));
      m.set(sec, list);
    }
  };
  add("dynamic", soRes.dynamicLines);
  add("manual", soRes.manualLines);
  return m;
}

describe("engineGraph siteOps tier — echo equals computeSiteOperations (the engine is the authority)", () => {
  for (const [label, soRes] of [
    ["populated", siteOps],
    ["all-3-entry-types", siteOpsVaried],
  ] as const) {
    const { byId } = siteOpsBuild(soRes);
    const val = (id: string): number => {
      const n = byId.get(id);
      if (!n) throw new Error(`missing siteOps node ${id}`);
      return n.evaluate(new Map());
    };

    it(`echoes every dynamic + manual leaf line (total, qty, rate) — ${label}`, () => {
      for (const group of SITE_OPS_GROUPS) {
        for (const l of siteOpsGroupLines(soRes, group)) {
          expect(val(siteOpsLeafNodeId(group, l.code, "total"))).toBeCloseTo(l.total, 8);
          expect(val(siteOpsLeafNodeId(group, l.code, "qty"))).toBeCloseTo(l.qty, 8);
          expect(val(siteOpsLeafNodeId(group, l.code, "rate"))).toBeCloseTo(l.rate, 8);
        }
      }
    });

    it(`echoes the two group subtotals + the grand total — ${label}`, () => {
      expect(val(siteOpsSubtotalNodeId("dynamic"))).toBeCloseTo(
        soRes.dynamicLines.reduce((s, l) => s + l.total, 0),
        8
      );
      expect(val(siteOpsSubtotalNodeId("manual"))).toBeCloseTo(
        soRes.manualLines.reduce((s, l) => s + l.total, 0),
        8
      );
      expect(val(SITEOPS_GRAND_TOTAL_NODE_ID)).toBeCloseTo(soRes.grandTotal, 8);
    });

    it(`echoes each section subtotal as the Σ of its member leaf totals — ${label}`, () => {
      const expected = expectedSectionLeafIds(soRes);
      for (const s of SITE_OPS_SECTIONS) {
        const memberTotal = (expected.get(s.id) ?? []).reduce((sum, id) => sum + val(id), 0);
        expect(val(siteOpsSectionNodeId(s.id))).toBeCloseTo(memberTotal, 8);
      }
    });
  }

  it("the varied fixture actually exercises all three manual entry types (non-zero)", () => {
    const byCode = new Map(siteOpsVaried.manualLines.map((l) => [l.code, l]));
    // qtyRate: soil borings = 5 × 1500
    expect(byCode.get("02-3200.001")!.total).toBeCloseTo(7500, 8);
    // lumpSum: ffe relocation + abatement (typed dollar amounts pass straight through)
    expect(byCode.get("02-5100.001")!.total).toBeCloseTo(12000, 8);
    expect(byCode.get("02-8213.001")!.total).toBeCloseTo(8000, 8);
    // qty: demolition = 800 × 6
    expect(byCode.get("02-4100.001")!.total).toBeCloseTo(4800, 8);
  });
});

describe("engineGraph siteOps tier — authored edges (the depends-on / used-by wiring)", () => {
  const { byId } = siteOpsBuild(siteOps);
  const inputs = (id: string): string[] => byId.get(id)!.inputs;

  it("grand total reads the two group subtotals, in order", () => {
    expect(inputs(SITEOPS_GRAND_TOTAL_NODE_ID)).toEqual([
      siteOpsSubtotalNodeId("dynamic"),
      siteOpsSubtotalNodeId("manual"),
    ]);
  });

  it("each group subtotal reads its own group's leaf totals, in order", () => {
    for (const group of SITE_OPS_GROUPS) {
      expect(inputs(siteOpsSubtotalNodeId(group))).toEqual(
        siteOpsGroupLines(siteOps, group).map((l) => siteOpsLeafNodeId(group, l.code, "total"))
      );
    }
  });

  it("every leaf total reads its qty + rate (uniform across dynamic + all 3 manual entries)", () => {
    for (const group of SITE_OPS_GROUPS) {
      for (const l of siteOpsGroupLines(siteOps, group)) {
        expect(inputs(siteOpsLeafNodeId(group, l.code, "total"))).toEqual([
          siteOpsLeafNodeId(group, l.code, "qty"),
          siteOpsLeafNodeId(group, l.code, "rate"),
        ]);
      }
    }
  });

  it("qty and rate are leaf source nodes (no inputs)", () => {
    for (const group of SITE_OPS_GROUPS) {
      for (const l of siteOpsGroupLines(siteOps, group)) {
        expect(inputs(siteOpsLeafNodeId(group, l.code, "qty"))).toEqual([]);
        expect(inputs(siteOpsLeafNodeId(group, l.code, "rate"))).toEqual([]);
      }
    }
  });

  it("each section subtotal reads its member leaf totals (the cross-cutting re-grouping)", () => {
    const expected = expectedSectionLeafIds(siteOps);
    for (const s of SITE_OPS_SECTIONS) {
      expect(inputs(siteOpsSectionNodeId(s.id))).toEqual(expected.get(s.id) ?? []);
    }
  });

  it("no dangling edges (every input id is also emitted by the tier)", () => {
    const ids = new Set(byId.keys());
    for (const n of byId.values()) {
      for (const dep of n.inputs) expect(ids.has(dep)).toBe(true);
    }
  });
});

describe("engineGraph siteOps tier — acyclicity + evaluates through the kind-blind graph", () => {
  for (const [label, soRes] of [
    ["populated", siteOps],
    ["all-3-entry-types", siteOpsVaried],
  ] as const) {
    const { nodes } = siteOpsBuild(soRes);

    it(`the authored edge set is acyclic — ${label}`, () => {
      expect(findCycle(nodes)).toBeNull();
    });

    it(`evaluateGraph resolves grand total / subtotals / sections + leaves to the engine value — ${label}`, () => {
      const values = evaluateGraph(nodes);
      expect(values.get(SITEOPS_GRAND_TOTAL_NODE_ID)).toBeCloseTo(soRes.grandTotal, 8);
      expect(values.get(siteOpsSubtotalNodeId("dynamic"))).toBeCloseTo(
        soRes.dynamicLines.reduce((s, l) => s + l.total, 0),
        8
      );
      expect(values.get(siteOpsSubtotalNodeId("manual"))).toBeCloseTo(
        soRes.manualLines.reduce((s, l) => s + l.total, 0),
        8
      );
      for (const l of soRes.dynamicLines) {
        expect(values.get(siteOpsLeafNodeId("dynamic", l.code, "total"))).toBeCloseTo(l.total, 8);
      }
    });
  }
});
