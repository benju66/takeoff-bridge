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
import { summaryNodeId, type GraphNode, type SummaryNodeField } from "../bindings/types";
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
