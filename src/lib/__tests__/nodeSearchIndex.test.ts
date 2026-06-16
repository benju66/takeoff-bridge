/**
 * Links-tab QoL: the whole-estimate value search index (buildNodeSearchIndex + filterNodeSearch).
 *
 * Proves the search box can jump to ANY addressable value: the index covers every engine tier
 * (summary / gc / siteops / division) AND every STEP 4 line field, each labelled (code + name)
 * and evaluated; the filter matches case-insensitively on a code fragment OR a name fragment and
 * is blank-idle + capped.
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
import { buildNodeSearchIndex, filterNodeSearch } from "../trustInspector";
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
  makeRow({ id: "r-dry", itemId: "09-2100.001", matchedQty: 1200, unitPrice: 2.45, total: 1200 * 2.45, description: "Drywall" }),
  makeRow({ id: "r-con", itemId: "03-3000.001", matchedQty: 80, unitPrice: 410.5, total: 80 * 410.5, description: "Concrete" }),
];
const linkedRows = linkedTotals.map((l) =>
  makeRow({ itemId: l.itemId, matchedQty: 1, unitPrice: 0, description: l.description })
);
const rows = [...takeoffRows, ...linkedRows];
const summary: TakeoffSummary = computeTakeoffSummary(rows, 30000, 100, RATES, linkedTotals);

const index = buildNodeSearchIndex({ bindings: [], gc, siteOps, rows, summary });

describe("buildNodeSearchIndex — covers every addressable value", () => {
  it("returns a non-empty, id-unique index sorted by label", () => {
    expect(index.length).toBeGreaterThan(50);
    const ids = index.map((e) => e.nodeId);
    expect(new Set(ids).size).toBe(ids.length); // no dup ids
    const labels = index.map((e) => e.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });

  it("includes a node from each engine tier + a STEP 4 line", () => {
    const has = (pred: (id: string) => boolean) => index.some((e) => pred(e.nodeId));
    expect(has((id) => id.startsWith("summary:"))).toBe(true);
    expect(has((id) => id.startsWith("gc:"))).toBe(true);
    expect(has((id) => id.startsWith("siteops:"))).toBe(true);
    expect(has((id) => id.startsWith("division:"))).toBe(true);
    expect(has((id) => id.startsWith("line:"))).toBe(true);
  });

  it("labels carry the friendly name (code + name) and engine nodes are evaluated", () => {
    const fee = index.find((e) => e.nodeId === "summary:fee");
    expect(fee?.label).toBe("Summary · 60-4000.001 · Fee");
    expect(fee?.value).toBeCloseTo(summary.fee, 6);
    const div09 = index.find((e) => e.nodeId === "division:09:total");
    expect(div09?.label).toContain("Division 09");
    expect(div09?.value).toBeCloseTo(takeoffRows[0].total, 6);
  });
});

describe("filterNodeSearch — matches code OR name, blank-idle, capped", () => {
  it("a blank/whitespace query returns nothing (the box is idle until typed)", () => {
    expect(filterNodeSearch(index, "")).toEqual([]);
    expect(filterNodeSearch(index, "   ")).toEqual([]);
  });

  it("finds a value by NAME fragment (case-insensitive)", () => {
    const hits = filterNodeSearch(index, "supervision");
    expect(hits.some((e) => e.nodeId === "gc:supervisionSubtotal")).toBe(true);
  });

  it("finds a value by CODE fragment", () => {
    const byFeeCode = filterNodeSearch(index, "60-4000");
    expect(byFeeCode.some((e) => e.nodeId === "summary:fee")).toBe(true);
    const byLineCode = filterNodeSearch(index, "09-2100");
    expect(byLineCode.some((e) => e.nodeId.startsWith("line:r-dry:"))).toBe(true);
  });

  it("caps the result list to the requested limit", () => {
    const broad = filterNodeSearch(index, "STEP", 5);
    expect(broad.length).toBe(5);
  });
});
