import { describe, it, expect } from "vitest";
import { diffVersionLines } from "../versionDiff";
import type { ProcessedTakeoffRow } from "@/types";

function makeRow(overrides: Partial<ProcessedTakeoffRow> & { id: string }): ProcessedTakeoffRow {
  return {
    classification: "Slab on Grade",
    itemId: "03-3000.001",
    procoreParentCode: "3-30000.000",
    procoreCode: "",
    description: "Concrete slab",
    matchedQty: 100,
    uom: "SF",
    unitPrice: 5.5,
    total: 550,
    isMapped: true,
    rawQuantities: [],
    costType: "M",
    customFields: {},
    source: "template",
    ...overrides,
  };
}

describe("versionDiff — diffVersionLines", () => {
  it("returns empty diff for two empty inputs", () => {
    const diff = diffVersionLines([], []);
    expect(diff.entries).toEqual([]);
    expect(diff.totalA).toBe(0);
    expect(diff.totalB).toBe(0);
    expect(diff.totalDelta).toBe(0);
    expect(diff.counts).toEqual({ added: 0, removed: 0, changed: 0, unchanged: 0 });
  });

  it("classifies identical inputs as all unchanged with zero deltas", () => {
    const rows = [makeRow({ id: "r1" }), makeRow({ id: "r2", itemId: "04-0000.001" })];
    const diff = diffVersionLines(rows, rows);

    expect(diff.counts).toEqual({ added: 0, removed: 0, changed: 0, unchanged: 2 });
    expect(diff.totalDelta).toBe(0);
    for (const entry of diff.entries) {
      expect(entry.kind).toBe("unchanged");
      expect(entry.qtyDelta).toBe(0);
      expect(entry.unitPriceDelta).toBe(0);
      expect(entry.totalDelta).toBe(0);
    }
  });

  it("classifies a row only in B as added with its full values as deltas", () => {
    const added = makeRow({ id: "r2", matchedQty: 10, unitPrice: 20, total: 200 });
    const diff = diffVersionLines([makeRow({ id: "r1" })], [makeRow({ id: "r1" }), added]);

    expect(diff.counts.added).toBe(1);
    const entry = diff.entries.find((e) => e.kind === "added")!;
    expect(entry.rowA).toBeUndefined();
    expect(entry.rowB).toBe(added);
    expect(entry.qtyDelta).toBe(10);
    expect(entry.unitPriceDelta).toBe(20);
    expect(entry.totalDelta).toBe(200);
  });

  it("classifies a row only in A as removed with negated values as deltas", () => {
    const removed = makeRow({ id: "r2", matchedQty: 10, unitPrice: 20, total: 200 });
    const diff = diffVersionLines([makeRow({ id: "r1" }), removed], [makeRow({ id: "r1" })]);

    expect(diff.counts.removed).toBe(1);
    const entry = diff.entries.find((e) => e.kind === "removed")!;
    expect(entry.rowB).toBeUndefined();
    expect(entry.rowA).toBe(removed);
    expect(entry.qtyDelta).toBe(-10);
    expect(entry.unitPriceDelta).toBe(-20);
    expect(entry.totalDelta).toBe(-200);
  });

  it("classifies quantity and price moves as changed with B−A deltas", () => {
    const a = makeRow({ id: "r1", matchedQty: 100, unitPrice: 5, total: 500 });
    const b = makeRow({ id: "r1", matchedQty: 120, unitPrice: 6, total: 720 });
    const diff = diffVersionLines([a], [b]);

    expect(diff.counts.changed).toBe(1);
    const entry = diff.entries[0];
    expect(entry.kind).toBe("changed");
    expect(entry.qtyDelta).toBe(20);
    expect(entry.unitPriceDelta).toBe(1);
    expect(entry.totalDelta).toBe(220);
  });

  it("classifies description, itemId, and uom edits as changed even at equal dollars", () => {
    const a = makeRow({ id: "r1" });
    expect(diffVersionLines([a], [makeRow({ id: "r1", description: "Renamed" })]).counts.changed).toBe(1);
    expect(diffVersionLines([a], [makeRow({ id: "r1", itemId: "09-0000.001" })]).counts.changed).toBe(1);
    expect(diffVersionLines([a], [makeRow({ id: "r1", uom: "LF" })]).counts.changed).toBe(1);
  });

  it("ignores non-compared fields (e.g. isMapped, classification)", () => {
    const a = makeRow({ id: "r1", isMapped: true, classification: "X" });
    const b = makeRow({ id: "r1", isMapped: false, classification: "Y" });
    expect(diffVersionLines([a], [b]).counts.unchanged).toBe(1);
  });

  it("computes side totals and total movement from line totals", () => {
    const aRows = [
      makeRow({ id: "r1", total: 500 }),
      makeRow({ id: "r2", total: 300 }), // removed in B
    ];
    const bRows = [
      makeRow({ id: "r1", total: 650 }), // changed
      makeRow({ id: "r3", total: 50 }),  // added
    ];
    const diff = diffVersionLines(aRows, bRows);

    expect(diff.totalA).toBe(800);
    expect(diff.totalB).toBe(700);
    expect(diff.totalDelta).toBe(-100);
    expect(diff.counts).toEqual({ added: 1, removed: 1, changed: 1, unchanged: 0 });
  });

  it("orders entries by B's row order, then removed rows in A's order", () => {
    const aRows = [
      makeRow({ id: "a-only-1" }),
      makeRow({ id: "shared" }),
      makeRow({ id: "a-only-2" }),
    ];
    const bRows = [makeRow({ id: "b-only" }), makeRow({ id: "shared" })];
    const diff = diffVersionLines(aRows, bRows);

    expect(diff.entries.map((e) => (e.rowB ?? e.rowA)!.id)).toEqual([
      "b-only",
      "shared",
      "a-only-1",
      "a-only-2",
    ]);
  });
});
