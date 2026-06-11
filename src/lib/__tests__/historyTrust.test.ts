/**
 * historyTrust — the trust-rules authority for historical price reporting
 * (database fidelity Phase 3). Report-only: these stats are what /rates
 * shows; nothing here writes a rate. The keystone test proves the trust
 * pipeline reports IDENTICAL numbers to the pre-trust aggregator for
 * already-clean data (phase exit criterion).
 */
import { describe, it, expect } from "vitest";
import {
  aggregateTrustedHistory,
  observationExclusion,
  canonicalUom,
  TRUST_UOM_ALIASES,
  IDENTITY_ESCALATION,
  OUTLIER_MIN_GROUP_SIZE,
  LOW_CONFIDENCE_BELOW,
} from "../historyTrust";
import { aggregatePriceHistory, type PriceObservation } from "../priceHistory";

const obs = (over: Partial<PriceObservation>): PriceObservation => ({
  itemId: "09-2900.001",
  unitPrice: 100,
  uom: "SF",
  projectName: "P",
  bidDate: "2026-01-01",
  marketSector: "Healthcare",
  qty: 10,
  dataFidelity: "discrete_unit",
  ...over,
});

describe("observationExclusion (the ONE copy of the validity rules)", () => {
  it("passes a clean observation", () => {
    expect(observationExclusion(obs({}))).toBeNull();
  });

  it("excludes a combined-marked line (lump price ≠ unit price)", () => {
    expect(observationExclusion(obs({ dataFidelity: "macro_lump_sum" }))).toBe("combined_line");
  });

  it("excludes zero/corrupt qty but PASSES an undefined qty (no context to judge)", () => {
    expect(observationExclusion(obs({ qty: 0 }))).toBe("zero_qty");
    expect(observationExclusion(obs({ qty: null as unknown as number }))).toBe("zero_qty");
    expect(observationExclusion(obs({ qty: undefined }))).toBeNull();
  });

  it("excludes zero/corrupt rates and %-UOM pseudo-rates", () => {
    expect(observationExclusion(obs({ unitPrice: 0 }))).toBe("zero_rate");
    expect(observationExclusion(obs({ unitPrice: NaN }))).toBe("zero_rate");
    expect(observationExclusion(obs({ uom: "%" }))).toBe("percent_uom");
  });

  it("allows negative rates (deduction lines are real bid decisions)", () => {
    expect(observationExclusion(obs({ unitPrice: -2 }))).toBeNull();
  });
});

describe("canonicalUom (architect-approved alias list, 2026-06-11)", () => {
  it("folds spelling variants to the catalog's canonical unit", () => {
    expect(canonicalUom("SQFT")).toBe("SF");
    expect(canonicalUom(" sq  ft ")).toBe("SF"); // case + whitespace collapse
    expect(canonicalUom("EACH")).toBe("EA");
    expect(canonicalUom("Lump Sum")).toBe("LS");
    expect(canonicalUom("months")).toBe("MO");
    expect(canonicalUom("HRS")).toBe("HR");
  });

  it("NEVER converts across real units — SF and SY stay separate", () => {
    expect(canonicalUom("SY")).toBe("SY");
    expect(canonicalUom("MSF")).toBe("MSF");
    expect(Object.values(TRUST_UOM_ALIASES)).not.toContain("MSF");
  });

  it("extends the parse-time table — a Togal spelling groups identically at read time", () => {
    expect(canonicalUom("FEET")).toBe("LF"); // from uom-aliases.ts
    expect(canonicalUom("SQUARE FEET")).toBe("SF");
  });

  it("passes unknown units through unchanged (own honest group)", () => {
    expect(canonicalUom("STOP")).toBe("STOP");
    expect(canonicalUom("FLR")).toBe("FLR");
    expect(canonicalUom("")).toBe("");
  });
});

describe("aggregateTrustedHistory — grouping", () => {
  it("groups by (code, canonical unit, market sector)", () => {
    const stats = aggregateTrustedHistory([
      obs({ uom: "SF", unitPrice: 10, marketSector: "Healthcare" }),
      obs({ uom: "SQFT", unitPrice: 20, marketSector: "Healthcare" }), // alias joins SF
      obs({ uom: "SF", unitPrice: 30, marketSector: "Multi-Family" }), // sector splits
      obs({ uom: "EA", unitPrice: 5_000, marketSector: "Healthcare" }), // unit splits
    ]).get("09-2900.001")!;

    expect(stats).toHaveLength(3);
    const sfHealth = stats.find((s) => s.uom === "SF" && s.marketSector === "Healthcare")!;
    expect(sfHealth).toMatchObject({ count: 2, median: 15, min: 10, max: 20 });
    expect(stats.find((s) => s.uom === "SF" && s.marketSector === "Multi-Family")!.count).toBe(1);
    expect(stats.find((s) => s.uom === "EA")!.count).toBe(1);
    // Dominant group first (count desc).
    expect(stats[0]).toBe(sfHealth);
  });

  it("excludes invalid rows from the math and skips codeless rows entirely", () => {
    const out = aggregateTrustedHistory([
      obs({ unitPrice: 50 }),
      obs({ unitPrice: 70 }),
      obs({ dataFidelity: "macro_lump_sum", unitPrice: 9_999 }),
      obs({ qty: 0, unitPrice: 9_999 }),
      obs({ unitPrice: 0 }),
      obs({ uom: "%", unitPrice: 16_000_000 }),
      obs({ itemId: "" }),
    ]);
    const stats = out.get("09-2900.001")!;
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ count: 2, median: 60 });
    expect(out.has("")).toBe(false);
  });

  it("orders observations newest bid first within a group", () => {
    const stats = aggregateTrustedHistory([
      obs({ bidDate: "2025-03-01", projectName: "Old" }),
      obs({ bidDate: "2026-04-06", projectName: "New" }),
    ]).get("09-2900.001")!;
    expect(stats[0].observations.map((o) => o.projectName)).toEqual(["New", "Old"]);
  });
});

describe("aggregateTrustedHistory — confidence labels", () => {
  it("labels small samples low-confidence on every aggregate", () => {
    const one = aggregateTrustedHistory([obs({})]).get("09-2900.001")![0];
    expect(one.confidence).toBe("low");
    expect(one.confidenceLabel).toBe("1 observation — low confidence");

    const two = aggregateTrustedHistory([obs({}), obs({ unitPrice: 110 })]).get("09-2900.001")![0];
    expect(two.confidenceLabel).toBe("2 observations — low confidence");

    const atThreshold = aggregateTrustedHistory(
      Array.from({ length: LOW_CONFIDENCE_BELOW }, (_, i) => obs({ unitPrice: 100 + i }))
    ).get("09-2900.001")![0];
    expect(atThreshold.confidence).toBe("normal");
    expect(atThreshold.confidenceLabel).toBe(`${LOW_CONFIDENCE_BELOW} observations`);
  });
});

describe("aggregateTrustedHistory — outlier screen (flag-only, conservative)", () => {
  // 5 tight prices + one wild one: fenced by 3×IQR AND >50% off the median.
  const pool = [
    obs({ unitPrice: 100, projectName: "A" }),
    obs({ unitPrice: 102, projectName: "B" }),
    obs({ unitPrice: 98, projectName: "C" }),
    obs({ unitPrice: 101, projectName: "D" }),
    obs({ unitPrice: 99, projectName: "E" }),
    obs({ unitPrice: 1_000, projectName: "Wild" }),
  ];

  it("flags the extreme value, excludes it from the math, but NEVER deletes it", () => {
    const stat = aggregateTrustedHistory(pool).get("09-2900.001")![0];
    expect(stat.count).toBe(5);
    expect(stat.median).toBe(100);
    expect(stat.max).toBe(102); // the wild price is out of the range math…
    expect(stat.flaggedOutliers.map((o) => o.projectName)).toEqual(["Wild"]); // …but reported
    expect(stat.observations.map((o) => o.projectName)).not.toContain("Wild");
  });

  it("never screens a pool smaller than the minimum group size", () => {
    const small = pool.slice(0, OUTLIER_MIN_GROUP_SIZE - 2).concat(obs({ unitPrice: 1_000, projectName: "Wild" }));
    const stat = aggregateTrustedHistory(small).get("09-2900.001")![0];
    expect(stat.flaggedOutliers).toEqual([]);
    expect(stat.count).toBe(small.length);
  });

  it("the median-deviation guard keeps a degenerate IQR=0 pool from flagging trivia", () => {
    // Five identical prices + one 10% off: fenced (IQR=0) but NOT >50% skewed.
    const stat = aggregateTrustedHistory([
      ...Array.from({ length: 5 }, () => obs({ unitPrice: 100 })),
      obs({ unitPrice: 110, projectName: "Slight" }),
    ]).get("09-2900.001")![0];
    expect(stat.flaggedOutliers).toEqual([]);
    expect(stat.count).toBe(6);
  });

  it("screens the (code, unit) pool BEFORE sector grouping (pooled across sectors)", () => {
    const split = pool.map((o, i) => ({ ...o, marketSector: i % 2 === 0 ? "Healthcare" : "Multi-Family" }));
    const stats = aggregateTrustedHistory(split).get("09-2900.001")!;
    const flagged = stats.flatMap((s) => s.flaggedOutliers);
    expect(flagged.map((o) => o.projectName)).toEqual(["Wild"]);
  });
});

describe("aggregateTrustedHistory — escalation seam (ships INERT)", () => {
  it("defaults to the identity: aggregates equal the raw math exactly", () => {
    const raw = aggregateTrustedHistory([obs({ unitPrice: 80 }), obs({ unitPrice: 120 })]);
    const explicit = aggregateTrustedHistory(
      [obs({ unitPrice: 80 }), obs({ unitPrice: 120 })],
      { escalate: IDENTITY_ESCALATION }
    );
    expect(explicit).toEqual(raw);
    expect(IDENTITY_ESCALATION(123.45, "2020-01-01")).toBe(123.45);
  });

  it("a date-based adjuster reaches the stats (Phase 6 plugs in here)", () => {
    const stat = aggregateTrustedHistory(
      [obs({ unitPrice: 100, bidDate: "2020-01-01" }), obs({ unitPrice: 100, bidDate: "2026-01-01" })],
      { escalate: (price, bidDate) => (bidDate < "2023-01-01" ? price * 2 : price) }
    ).get("09-2900.001")![0];
    expect(stat.min).toBe(100);
    expect(stat.max).toBe(200);
    expect(stat.median).toBe(150);
    // The raw observations are untouched — adjusted alongside raw, never replacing it.
    expect(stat.observations.every((o) => o.unitPrice === 100)).toBe(true);
  });

  it("outliers are screened on RAW prices before any adjustment (AACE ordering)", () => {
    // An adjuster that would tame the wild price cannot un-flag it.
    const stat = aggregateTrustedHistory(
      [
        obs({ unitPrice: 100, projectName: "A" }),
        obs({ unitPrice: 102, projectName: "B" }),
        obs({ unitPrice: 98, projectName: "C" }),
        obs({ unitPrice: 101, projectName: "D" }),
        obs({ unitPrice: 99, projectName: "E" }),
        obs({ unitPrice: 1_000, projectName: "Wild", bidDate: "2010-01-01" }),
      ],
      { escalate: (price, bidDate) => (bidDate === "2010-01-01" ? price / 10 : price) }
    ).get("09-2900.001")![0];
    expect(stat.flaggedOutliers.map((o) => o.projectName)).toEqual(["Wild"]);
  });
});

describe("EXIT CRITERION — report outputs UNCHANGED for already-clean data", () => {
  it("matches the pre-trust aggregator field-for-field on clean observations", () => {
    // Clean = canonical units, one sector, real qty + rates, no %-rows, no
    // outliers — exactly what a tidy backlog import produces.
    const clean: PriceObservation[] = [
      obs({ itemId: "09-2900.001", uom: "SF", unitPrice: 80, bidDate: "2025-06-01", projectName: "P1" }),
      obs({ itemId: "09-2900.001", uom: "SF", unitPrice: 120, bidDate: "2026-02-01", projectName: "P2" }),
      obs({ itemId: "09-2900.001", uom: "EA", unitPrice: 5_000, bidDate: "2025-09-01", projectName: "P3" }),
      obs({ itemId: "22-0000.001", uom: "LS", unitPrice: 12_500, bidDate: "2024-12-01", projectName: "P4" }),
    ];

    const trusted = aggregateTrustedHistory(clean);
    const reference = aggregatePriceHistory(clean);

    expect([...trusted.keys()].sort()).toEqual([...reference.keys()].sort());
    for (const [itemId, refStats] of reference) {
      const trustStats = trusted.get(itemId)!;
      expect(trustStats).toHaveLength(refStats.length);
      refStats.forEach((ref, i) => {
        const t = trustStats[i];
        // Identical numbers, identical ordering, identical observation lists.
        expect({
          itemId: t.itemId,
          uom: t.uom,
          count: t.count,
          median: t.median,
          min: t.min,
          max: t.max,
          observations: t.observations,
        }).toEqual(ref);
        expect(t.flaggedOutliers).toEqual([]);
      });
    }
  });
});
