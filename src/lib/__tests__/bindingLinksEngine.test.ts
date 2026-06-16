/**
 * Linked Values - Bucket B Phase 2: buildLinksModel over the engine graph.
 *
 * With a summary passed (the page does, from the same memoized computeTakeoffSummary the
 * grid uses - the echo-staleness guard), the Links tab shows accurate depends-on / used-by
 * for summary:* + cross-page nodes, even with NO user bindings. Without a summary the engine
 * nodes are absent (the pre-Bucket-B view). Plus focusFieldToNodeId, the Trace-field ->
 * node-id mapping that lets a summary cell focus the Links tab on its engine node.
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
import { buildLinksModel, focusFieldToNodeId } from "../trustInspector";
import { computeLinkedDivisionTotalsViaEngine } from "../bindings/registry";
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
  type SummaryNodeField,
} from "../bindings/types";
import { SITE_OPS_MANUAL_DEFAULTS, SUPERVISION_STAFF_CODES } from "../constants";
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

const MODIFIER_FIELDS: readonly SummaryNodeField[] = [
  "constructionContingency",
  "designContingency",
  "buildersRisk",
  "specialInsurance",
  "glInsurance",
  "bond",
  "fee",
];

describe("focusFieldToNodeId", () => {
  it("maps a bare summary field to summary:<field>", () => {
    expect(focusFieldToNodeId("subtotal")).toBe(summaryNodeId("subtotal"));
    expect(focusFieldToNodeId("fee")).toBe("summary:fee");
    expect(focusFieldToNodeId("totalEstimatedCost")).toBe(summaryNodeId("totalEstimatedCost"));
  });

  it("passes a token that already carries a node-id prefix through unchanged", () => {
    expect(focusFieldToNodeId("line:row-x:total")).toBe("line:row-x:total");
    expect(focusFieldToNodeId(summaryNodeId("subtotal"))).toBe(summaryNodeId("subtotal"));
    expect(focusFieldToNodeId("gc:grandTotal")).toBe("gc:grandTotal");
  });
});

describe("buildLinksModel - engine summary node (no user bindings, summary supplied)", () => {
  const model = buildLinksModel({
    focusNodeId: summaryNodeId("subtotal"),
    bindings: [],
    gc,
    siteOps,
    rows,
    summary,
  });

  it("is a derived (read-only engine) value, not a user binding", () => {
    expect(model.isBound).toBe(false);
    expect(model.isDerived).toBe(true);
  });

  it("echoes the engine value at the wiring site", () => {
    expect(model.focus.value).toBeCloseTo(summary.subtotal, 8);
    expect(summary.subtotal).toBeGreaterThan(0);
  });

  it("depends-on lists the two cross-page leaves, in order", () => {
    expect(model.dependsOn.map((d) => d.nodeId)).toEqual([
      summaryNodeId("takeoffSubtotal"),
      summaryNodeId("linkedDivisionsTotal"),
    ]);
  });

  it("used-by lists the 7 modifiers + the grand total", () => {
    const usedByIds = model.usedBy.map((u) => u.nodeId).sort();
    const expected = [
      ...MODIFIER_FIELDS.map((f) => summaryNodeId(f)),
      summaryNodeId("totalEstimatedCost"),
    ].sort();
    expect(usedByIds).toEqual(expected);
  });
});

describe("buildLinksModel - a cross-page leaf and the omitted-summary fallback", () => {
  it("takeoffSubtotal leaf has no dependencies and is used by subtotal", () => {
    const model = buildLinksModel({
      focusNodeId: summaryNodeId("takeoffSubtotal"),
      bindings: [],
      gc,
      siteOps,
      rows,
      summary,
    });
    expect(model.dependsOn).toEqual([]);
    expect(model.usedBy.map((u) => u.nodeId)).toEqual([summaryNodeId("subtotal")]);
  });

  it("WITHOUT a summary the engine nodes are absent - focus-only (the pre-Bucket-B view)", () => {
    const model = buildLinksModel({
      focusNodeId: summaryNodeId("subtotal"),
      bindings: [],
      gc,
      siteOps,
      rows,
    });
    expect(model.isDerived).toBe(false);
    expect(model.dependsOn).toEqual([]);
    expect(model.usedBy).toEqual([]);
    expect(model.focus.value).toBeUndefined();
  });
});

describe("buildLinksModel - GC tree traversal (Phase 3, summary supplied)", () => {
  it("gc:grandTotal depends on the 4 group subtotals and is used by gc:general", () => {
    const model = buildLinksModel({
      focusNodeId: GC_GRAND_TOTAL_NODE_ID,
      bindings: [],
      gc,
      siteOps,
      rows,
      summary,
    });
    expect(model.isBound).toBe(false);
    expect(model.isDerived).toBe(true); // a read-only engine value
    expect(model.focus.value).toBeCloseTo(gc.grandTotal, 8);
    expect(model.dependsOn.map((d) => d.nodeId)).toEqual([
      gcSubtotalNodeId("staff"),
      gcSubtotalNodeId("ops"),
      gcSubtotalNodeId("equipment"),
      gcSubtotalNodeId("manual"),
    ]);
    expect(model.usedBy.map((u) => u.nodeId)).toContain(GC_GENERAL_NODE_ID);
  });

  it("a supervision staff leaf total depends on its qty + rate, and feeds both its subtotal and supervision", () => {
    const code = SUPERVISION_STAFF_CODES[1]; // Superintendent (01-0420.001) — utilized, non-zero
    const totalId = gcLeafNodeId("staff", code, "total");
    const model = buildLinksModel({
      focusNodeId: totalId,
      bindings: [],
      gc,
      siteOps,
      rows,
      summary,
    });
    expect(model.dependsOn.map((d) => d.nodeId)).toEqual([
      gcLeafNodeId("staff", code, "qty"),
      gcLeafNodeId("staff", code, "rate"),
    ]);
    const usedBy = model.usedBy.map((u) => u.nodeId);
    expect(usedBy).toContain(gcSubtotalNodeId("staff"));
    expect(usedBy).toContain(GC_SUPERVISION_NODE_ID);
    // labelled to the leaf via the shared node labeller (not the raw id)
    expect(model.focus.label).toContain("STEP 2");
  });

  it("gc:general depends on grand total + supervision and echoes grandTotal - supervision", () => {
    const model = buildLinksModel({
      focusNodeId: GC_GENERAL_NODE_ID,
      bindings: [],
      gc,
      siteOps,
      rows,
      summary,
    });
    expect(model.dependsOn.map((d) => d.nodeId)).toEqual([
      GC_GRAND_TOTAL_NODE_ID,
      GC_SUPERVISION_NODE_ID,
    ]);
    const supervision = gc.staffLines
      .filter((l) => SUPERVISION_STAFF_CODES.includes(l.code))
      .reduce((s, l) => s + l.total, 0);
    expect(model.focus.value).toBeCloseTo(gc.grandTotal - supervision, 8);
  });
});

describe("buildLinksModel - Site-Ops tree traversal (Phase 4, summary supplied)", () => {
  it("siteops:grandTotal depends on the 2 group subtotals and echoes siteOps.grandTotal", () => {
    const model = buildLinksModel({
      focusNodeId: SITEOPS_GRAND_TOTAL_NODE_ID,
      bindings: [],
      gc,
      siteOps,
      rows,
      summary,
    });
    expect(model.isBound).toBe(false);
    expect(model.isDerived).toBe(true); // a read-only engine value
    expect(model.focus.value).toBeCloseTo(siteOps.grandTotal, 8);
    expect(siteOps.grandTotal).toBeGreaterThan(0);
    expect(model.dependsOn.map((d) => d.nodeId)).toEqual([
      siteOpsSubtotalNodeId("dynamic"),
      siteOpsSubtotalNodeId("manual"),
    ]);
  });

  it("a dynamic leaf total depends on its qty + rate, and feeds both its group subtotal and its section", () => {
    const code = "02-9015.001"; // Safety — a dynamic line (duration-driven), section siteOperations
    const totalId = siteOpsLeafNodeId("dynamic", code, "total");
    const model = buildLinksModel({
      focusNodeId: totalId,
      bindings: [],
      gc,
      siteOps,
      rows,
      summary,
    });
    expect(model.dependsOn.map((d) => d.nodeId)).toEqual([
      siteOpsLeafNodeId("dynamic", code, "qty"),
      siteOpsLeafNodeId("dynamic", code, "rate"),
    ]);
    const usedBy = model.usedBy.map((u) => u.nodeId);
    expect(usedBy).toContain(siteOpsSubtotalNodeId("dynamic"));
    expect(usedBy).toContain(siteOpsSectionNodeId("siteOperations"));
    // labelled to the leaf via the shared node labeller (not the raw id)
    expect(model.focus.label).toContain("STEP 3");
  });

  it("a section subtotal (demolition) reads its member leaf totals and echoes their Σ", () => {
    const model = buildLinksModel({
      focusNodeId: siteOpsSectionNodeId("demolition"),
      bindings: [],
      gc,
      siteOps,
      rows,
      summary,
    });
    // demolition section = the manual lines whose section is "demolition" (demolition + sawcutting).
    const demoCodes = SITE_OPS_MANUAL_DEFAULTS.filter((c) => c.section === "demolition").map(
      (c) => c.code
    );
    expect(model.dependsOn.map((d) => d.nodeId)).toEqual(
      demoCodes.map((c) => siteOpsLeafNodeId("manual", c, "total"))
    );
    // 02-4100.001 demolition = qty 500 × rate 6 = 3000; 02-4100.002 sawcutting (lumpSum) = 950.
    expect(model.focus.value).toBeCloseTo(3950, 8);
  });
});