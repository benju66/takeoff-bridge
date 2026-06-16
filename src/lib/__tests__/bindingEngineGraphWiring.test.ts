/**
 * Linked Values - Bucket B Phase 2: wiring the engine graph into the assemble seam.
 *
 * Proves assembleBindingGraphNodes' opt-in engine fold + collision precedence:
 *   - DEFAULT OFF: with no options (the grid/recompute path) NO engine nodes are folded in
 *     and the result is the pre-Bucket-B assembly - the export goldens hold.
 *   - includeEngineGraph REQUIRES a summary to ECHO (the echo-staleness guard, plan section 6):
 *     the flag alone is a no-op.
 *   - ON: the 13 summary:* nodes are present and, evaluated through the kind-blind graph,
 *     equal computeTakeoffSummary to the cent (echo === engine at the wiring site, LD-B2).
 *   - PRECEDENCE user binding > engine > source: a user binding targeting summary:subtotal
 *     SHADOWS the engine node (no duplicate-id throw; the user binding's inputs win), and no
 *     assembled node list ever carries a duplicate id (the dedup that protects buildGraph).
 */
import { describe, it, expect, vi } from "vitest";
import {
  computePersonnelCosts,
  computeSiteOperations,
  computeTakeoffSummary,
  type PersonnelCalcResult,
  type SiteOpsCalcResult,
  type TakeoffSummary,
} from "../calculations";
import {
  assembleBindingGraphNodes,
  computeLinkedDivisionTotalsViaEngine,
  GC_GRAND_TOTAL_NODE_ID,
} from "../bindings/registry";
import { lineFieldNodeId } from "../bindings/compile";
import { evaluateGraph } from "../bindings/graph";
import {
  gcSubtotalNodeId,
  summaryNodeId,
  type Binding,
  type GraphNode,
  type SummaryNodeField,
} from "../bindings/types";
import { LINKED_DIVISION_ROWS } from "../constants";
import type { ProcessedTakeoffRow } from "@/types";

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
const linkedTotals = computeLinkedDivisionTotalsViaEngine(gc, siteOps);

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

const takeoffRows = [
  makeRow({ itemId: "09-2100.001", matchedQty: 1200, unitPrice: 2.45, total: 1200 * 2.45, description: "Drywall" }),
  makeRow({ itemId: "03-3000.001", matchedQty: 80, unitPrice: 410.5, total: 80 * 410.5, description: "Concrete" }),
];
const linkedRows = linkedTotals.map((l) =>
  makeRow({ itemId: l.itemId, matchedQty: 1, unitPrice: 0, description: l.description })
);
const rows = [...takeoffRows, ...linkedRows];
const summary: TakeoffSummary = computeTakeoffSummary(rows, 30000, 100, RATES, linkedTotals);

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

const allIds = (nodes: GraphNode[]) => nodes.map((n) => n.id);

describe("assembleBindingGraphNodes - engine fold is OFF by default (the grid path)", () => {
  it("no options + no bindings -> inert empty (byte-identical to the pre-Bucket-B assembly)", () => {
    expect(assembleBindingGraphNodes([], gc, siteOps, rows)).toEqual([]);
  });

  it("a populated binding set with the fold OFF emits NO summary:* nodes", () => {
    const binding: Binding = {
      targetNodeId: lineFieldNodeId(takeoffRows[0].id, "total"),
      basis: "currency",
      definition: { kind: "lookup", source: GC_GRAND_TOTAL_NODE_ID },
    };
    const off = assembleBindingGraphNodes([binding], gc, siteOps, rows);
    expect(off.some((n) => n.id.startsWith("summary:"))).toBe(false);
  });

  it("includeEngineGraph WITHOUT a summary is a no-op (echo-staleness guard)", () => {
    expect(assembleBindingGraphNodes([], gc, siteOps, rows, { includeEngineGraph: true })).toEqual([]);
  });
});

describe("assembleBindingGraphNodes - engine fold ON (the Links tab)", () => {
  const folded = assembleBindingGraphNodes([], gc, siteOps, rows, {
    includeEngineGraph: true,
    summary,
  });

  it("folds in exactly the 13 summary:* engine nodes", () => {
    const summaryIds = folded
      .filter((n) => n.id.startsWith("summary:"))
      .map((n) => n.id)
      .sort();
    const expected = ALL_SUMMARY_FIELDS.map((f) => summaryNodeId(f)).sort();
    expect(summaryIds).toEqual(expected);
  });

  it("emits the bare source nodes alongside (gc:/siteops:/line:) - it is a superset, not a swap", () => {
    expect(folded.some((n) => n.id.startsWith("gc:"))).toBe(true);
    expect(folded.some((n) => n.id.startsWith("line:"))).toBe(true);
  });

  it("no duplicate node ids (the dedup that keeps buildGraph from throwing)", () => {
    const ids = allIds(folded);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ECHO === engine at the wiring site: evaluating the assembled graph reproduces computeTakeoffSummary to the cent", () => {
    const values = evaluateGraph(folded);
    for (const field of ALL_SUMMARY_FIELDS) {
      expect(values.get(summaryNodeId(field))).toBeCloseTo(summary[field], 8);
    }
  });
});

describe("assembleBindingGraphNodes - collision precedence (user binding > engine > source)", () => {
  it("a user binding on summary:subtotal SHADOWS the engine node (user inputs win, no duplicate id)", () => {
    const userBinding: Binding = {
      targetNodeId: summaryNodeId("subtotal"),
      basis: "currency",
      definition: { kind: "lookup", source: GC_GRAND_TOTAL_NODE_ID },
    };
    const nodes = assembleBindingGraphNodes([userBinding], gc, siteOps, rows, {
      includeEngineGraph: true,
      summary,
    });

    const subtotalNodes = nodes.filter((n) => n.id === summaryNodeId("subtotal"));
    expect(subtotalNodes).toHaveLength(1); // engine echo dropped - the user binding wins

    // The surviving node is the USER binding (reads gc:grandTotal), not the engine echo
    // (which reads takeoffSubtotal + linkedDivisionsTotal).
    expect(subtotalNodes[0].inputs).toEqual([GC_GRAND_TOTAL_NODE_ID]);

    // It evaluates through the kind-blind graph (no GraphError) to the mirrored source.
    const ids = allIds(nodes);
    expect(new Set(ids).size).toBe(ids.length);
    const values = evaluateGraph(nodes);
    expect(values.get(summaryNodeId("subtotal"))).toBeCloseTo(gc.grandTotal, 8);
  });

  it("a binding on a RESERVED linked-division row is still skipped with the fold ON (no duplicate id)", () => {
    const linkedItemId = LINKED_DIVISION_ROWS[0].itemId;
    const linkedRowId = `row-${linkedItemId}`;
    const linkedRow = makeRow({ id: linkedRowId, itemId: linkedItemId, total: 500 });
    const reservedBinding: Binding = {
      targetNodeId: lineFieldNodeId(linkedRowId, "total"),
      basis: "currency",
      definition: { kind: "lookup", source: GC_GRAND_TOTAL_NODE_ID },
    };

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const nodes = assembleBindingGraphNodes([reservedBinding], gc, siteOps, [linkedRow], {
      includeEngineGraph: true,
      summary,
    });
    warn.mockRestore();

    const ids = allIds(nodes);
    expect(new Set(ids).size).toBe(ids.length);
    const values = evaluateGraph(nodes);
    // The reserved linked node kept its own constant (the bridge wins, not the user binding).
    expect(values.get(lineFieldNodeId(linkedRowId, "total"))).toBeCloseTo(500, 8);
  });
});

describe("assembleBindingGraphNodes - engine gc:* node wins over the bare gc:* source constant", () => {
  // Phase 3 is the FIRST tier whose engine ids overlap the bare gc:* source nodes (LD-B5).
  // With the fold ON (the default tier set now includes "gc") the richer engine node must
  // REPLACE the bare constant — engine > source — so the GC tree wiring is what shows.
  const folded = assembleBindingGraphNodes([], gc, siteOps, rows, {
    includeEngineGraph: true,
    summary,
  });

  it("gc:grandTotal appears once and is the ENGINE node (edged to its 4 subtotals), not the bare constant", () => {
    const grand = folded.filter((n) => n.id === GC_GRAND_TOTAL_NODE_ID);
    expect(grand).toHaveLength(1);
    // The bare source constant has NO inputs; the surviving engine node declares the 4 subtotals.
    expect(grand[0].inputs).toEqual([
      gcSubtotalNodeId("staff"),
      gcSubtotalNodeId("ops"),
      gcSubtotalNodeId("equipment"),
      gcSubtotalNodeId("manual"),
    ]);
  });

  it("folds in the GC tree (group subtotals + leaf nodes) with NO duplicate ids", () => {
    expect(folded.some((n) => n.id === gcSubtotalNodeId("staff"))).toBe(true);
    expect(folded.some((n) => n.id.startsWith("gc:staff:"))).toBe(true);
    const ids = allIds(folded);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("the folded gc:grandTotal evaluates to gc.grandTotal through the kind-blind graph", () => {
    const values = evaluateGraph(folded);
    expect(values.get(GC_GRAND_TOTAL_NODE_ID)).toBeCloseTo(gc.grandTotal, 8);
  });
});