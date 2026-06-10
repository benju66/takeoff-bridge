/**
 * priceHistory — pure as-bid price aggregation (Phase 3 Slice 2).
 * Report-only: these stats are what /rates shows; nothing here writes a rate.
 */
import { describe, it, expect } from "vitest";
import { aggregatePriceHistory, median, type PriceObservation } from "../priceHistory";

const obs = (over: Partial<PriceObservation>): PriceObservation => ({
  itemId: "09-2900.001",
  unitPrice: 100,
  uom: "SF",
  projectName: "P",
  bidDate: "2026-01-01",
  marketSector: "Healthcare",
  ...over,
});

describe("median", () => {
  it("handles odd, even, single, and empty inputs", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5); // mean of the two middles
    expect(median([42])).toBe(42);
    expect(median([])).toBe(0);
  });

  it("does not mutate its input", () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe("aggregatePriceHistory", () => {
  it("computes count / median / range per code", () => {
    const stats = aggregatePriceHistory([
      obs({ unitPrice: 80 }),
      obs({ unitPrice: 120 }),
      obs({ unitPrice: 100 }),
    ]).get("09-2900.001")!;

    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ uom: "SF", count: 3, median: 100, min: 80, max: 120 });
  });

  it("NEVER mixes units: a $/SF observation does not average into an EA one", () => {
    const stats = aggregatePriceHistory([
      obs({ uom: "SF", unitPrice: 10 }),
      obs({ uom: "SF", unitPrice: 20 }),
      obs({ uom: "EA", unitPrice: 5_000 }),
    ]).get("09-2900.001")!;

    expect(stats).toHaveLength(2);
    const sf = stats.find((s) => s.uom === "SF")!;
    const ea = stats.find((s) => s.uom === "EA")!;
    expect(sf).toMatchObject({ count: 2, median: 15 });
    expect(ea).toMatchObject({ count: 1, median: 5_000 });
    // Dominant unit first (count desc).
    expect(stats[0].uom).toBe("SF");
  });

  it("orders observations newest-bid-first and keys strictly by itemId", () => {
    const out = aggregatePriceHistory([
      obs({ bidDate: "2025-03-01", projectName: "Old" }),
      obs({ bidDate: "2026-04-06", projectName: "New" }),
      obs({ itemId: "22-0000.001", unitPrice: 9 }),
      obs({ itemId: "" }), // unmapped rows carry no code → excluded
    ]);

    expect(out.get("09-2900.001")![0].observations.map((o) => o.projectName)).toEqual(["New", "Old"]);
    expect(out.get("22-0000.001")![0].count).toBe(1);
    expect(out.has("")).toBe(false);
    expect(out.size).toBe(2);
  });

  it("returns an empty map for no observations (report renders nothing)", () => {
    expect(aggregatePriceHistory([]).size).toBe(0);
  });
});
