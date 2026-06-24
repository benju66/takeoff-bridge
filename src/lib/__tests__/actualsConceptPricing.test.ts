/**
 * Phase 7 parametric concept pricing: division derivation from the Procore code
 * (NOT getDivisionCode), the code/division parametric builders (divide-by-zero /
 * missing-metric guard, $/SF math, negatives kept, division rollup + CO-churn),
 * the full model aggregation (sector split, median, hasSf/hasUnit, strength tier
 * scored on $/metric so the spread dimension tracks $/SF tightness), and a
 * fixture-grounded tie-out over the real `templates/` export.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  buildActualCostObservations,
  aggregateConceptPricing,
  buildCodeParametrics,
  buildDivisionParametrics,
  parseProcoreDivision,
  DIVISION_GRAIN_CODE,
  computeNormalizedActuals,
  type ActualCostObservation,
  type FinalSnapshotInput,
  type RawActualsExport,
} from "@/lib/actuals";
import { loadActualsSource } from "./actualsFixtures";

const NOW = new Date("2026-06-01T00:00:00Z");

// ---------------------------------------------------------------------------
// Synthetic builders
// ---------------------------------------------------------------------------

function obs(opts: Partial<ActualCostObservation> = {}): ActualCostObservation {
  const normalizedActual = opts.normalizedActual ?? 100000;
  return {
    costCode: opts.costCode ?? "1-10320.000",
    description: opts.description ?? "Sr Project Manager",
    normalizedActual,
    totalActual: opts.totalActual ?? normalizedActual,
    isBurden: opts.isBurden ?? false,
    coAdjustmentShare: opts.coAdjustmentShare ?? 0,
    projectId: opts.projectId ?? "p1",
    projectName: opts.projectName ?? "Project One",
    snapshotId: opts.snapshotId ?? "s1",
    snapshotLabel: opts.snapshotLabel ?? "Closeout",
    finalizedAt: opts.finalizedAt ?? "2026-01-01T00:00:00Z",
    marketSector: opts.marketSector ?? "",
    squareFootage: opts.squareFootage ?? 0,
    unitCount: opts.unitCount ?? 0,
  };
}

// ---------------------------------------------------------------------------
// parseProcoreDivision (NOT getDivisionCode)
// ---------------------------------------------------------------------------

describe("parseProcoreDivision", () => {
  it("reads the Procore tier-1 token before the first dash", () => {
    expect(parseProcoreDivision("1-10320.000")).toEqual({ key: "1", label: "Division 1" });
    expect(parseProcoreDivision("09-9000.002")).toEqual({ key: "09", label: "Division 09" });
    expect(parseProcoreDivision("60-604000.000")).toEqual({ key: "60", label: "Division 60" });
  });

  it("does NOT zero-pad or CSI-normalize the token (Procore division space)", () => {
    // Procore tier-1 "1" stays "1" — it is NOT the CSI division "01".
    expect(parseProcoreDivision("1-10320.000").key).toBe("1");
  });

  it("handles a blank / dash-less code honestly", () => {
    expect(parseProcoreDivision("")).toEqual({ key: "", label: "Unassigned" });
    expect(parseProcoreDivision("   ")).toEqual({ key: "", label: "Unassigned" });
    expect(parseProcoreDivision("99999")).toEqual({ key: "99999", label: "Division 99999" });
  });
});

// ---------------------------------------------------------------------------
// buildCodeParametrics
// ---------------------------------------------------------------------------

describe("buildCodeParametrics", () => {
  it("divides normalized dollars by the project metric ($/SF)", () => {
    const result = buildCodeParametrics([obs({ normalizedActual: 100000, squareFootage: 50000 })], "sf");
    expect(result).toHaveLength(1);
    expect(result[0].costPerMetric).toBe(2);
    expect(result[0].metric).toBe("sf");
    expect(result[0].metricValue).toBe(50000);
    expect(result[0].division).toBe("1");
  });

  it("uses unit_count for the $/unit metric", () => {
    const result = buildCodeParametrics([obs({ normalizedActual: 90000, unitCount: 90 })], "unit");
    expect(result[0].costPerMetric).toBe(1000);
    expect(result[0].metric).toBe("unit");
  });

  it("skips a job whose metric is 0 / missing / non-finite (no fabricated denominator)", () => {
    expect(buildCodeParametrics([obs({ squareFootage: 0 })], "sf")).toHaveLength(0);
    // SF present but unit count absent → contributes to $/SF only.
    const sf = buildCodeParametrics([obs({ squareFootage: 50000, unitCount: 0 })], "sf");
    const unit = buildCodeParametrics([obs({ squareFootage: 50000, unitCount: 0 })], "unit");
    expect(sf).toHaveLength(1);
    expect(unit).toHaveLength(0);
  });

  it("retains a negative (savings / buyout) $/SF", () => {
    const result = buildCodeParametrics([obs({ normalizedActual: -41000, squareFootage: 50000 })], "sf");
    expect(result[0].costPerMetric).toBe(-0.82);
  });
});

// ---------------------------------------------------------------------------
// buildDivisionParametrics
// ---------------------------------------------------------------------------

describe("buildDivisionParametrics", () => {
  it("sums every code in a division for a job, then divides by the metric", () => {
    const observations = [
      obs({ costCode: "1-10320.000", normalizedActual: 100000, squareFootage: 50000 }),
      obs({ costCode: "1-10420.000", normalizedActual: 50000, squareFootage: 50000 }),
      obs({ costCode: "09-9000.002", normalizedActual: 300000, squareFootage: 50000 }),
    ];
    const result = buildDivisionParametrics(observations, "sf");
    const div1 = result.find((o) => o.division === "1")!;
    const div9 = result.find((o) => o.division === "09")!;
    expect(div1.costCode).toBe(DIVISION_GRAIN_CODE);
    expect(div1.normalizedActual).toBe(150000);
    expect(div1.costPerMetric).toBe(3); // 150000 / 50000
    expect(div9.costPerMetric).toBe(6); // 300000 / 50000
  });

  it("recomputes the rollup's CO-churn share from summed totals", () => {
    const observations = [
      obs({ costCode: "1-10320.000", normalizedActual: 800, totalActual: 1000, squareFootage: 100 }),
      obs({ costCode: "1-10420.000", normalizedActual: 700, totalActual: 1000, squareFootage: 100 }),
    ];
    const [rollup] = buildDivisionParametrics(observations, "sf");
    // |2000 - 1500| / 2000 = 0.25
    expect(rollup.coAdjustmentShare).toBeCloseTo(0.25, 6);
  });

  it("keeps each job's division rollup separate (no cross-job blending)", () => {
    const observations = [
      obs({ snapshotId: "s1", costCode: "1-10320.000", normalizedActual: 100000, squareFootage: 50000 }),
      obs({ snapshotId: "s2", costCode: "1-10320.000", normalizedActual: 200000, squareFootage: 50000 }),
    ];
    const result = buildDivisionParametrics(observations, "sf");
    expect(result).toHaveLength(2);
    expect(result.map((o) => o.costPerMetric).sort((a, b) => a - b)).toEqual([2, 4]);
  });

  it("drops a division whose summed normalized nets to zero", () => {
    const observations = [
      obs({ costCode: "1-10320.000", normalizedActual: 5000, squareFootage: 100 }),
      obs({ costCode: "1-10420.000", normalizedActual: -5000, squareFootage: 100 }),
    ];
    expect(buildDivisionParametrics(observations, "sf")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// aggregateConceptPricing
// ---------------------------------------------------------------------------

describe("aggregateConceptPricing", () => {
  it("flags which metrics are available and lists distinct sectors", () => {
    const observations = [
      obs({ projectId: "a", snapshotId: "a", squareFootage: 50000, unitCount: 0, marketSector: "MF" }),
      obs({ projectId: "b", snapshotId: "b", squareFootage: 60000, unitCount: 0, marketSector: "Healthcare" }),
    ];
    const model = aggregateConceptPricing(observations, { now: NOW });
    expect(model.hasSf).toBe(true);
    expect(model.hasUnit).toBe(false);
    expect(model.sectors).toEqual(["Healthcare", "MF"]);
  });

  it("pools a code across jobs with a median $/SF and code + division stats", () => {
    const code = "09-9000.002";
    const observations = [
      obs({ projectId: "a", snapshotId: "a", costCode: code, normalizedActual: 100000, squareFootage: 50000 }), // 2
      obs({ projectId: "b", snapshotId: "b", costCode: code, normalizedActual: 300000, squareFootage: 50000 }), // 6
      obs({ projectId: "c", snapshotId: "c", costCode: code, normalizedActual: 200000, squareFootage: 50000 }), // 4
    ];
    const model = aggregateConceptPricing(observations, { now: NOW });
    const codeStat = model.codes.find((s) => s.metric === "sf" && s.costCode === code)!;
    expect(codeStat.count).toBe(3);
    expect(codeStat.medianCostPerMetric).toBe(4);
    expect(codeStat.minCostPerMetric).toBe(2);
    expect(codeStat.maxCostPerMetric).toBe(6);
    // The whole division (just this code here) mirrors the code benchmark.
    const divStat = model.divisions.find((s) => s.metric === "sf" && s.division === "09")!;
    expect(divStat.costCode).toBe(DIVISION_GRAIN_CODE);
    expect(divStat.medianCostPerMetric).toBe(4);
  });

  it("splits a code by market sector", () => {
    const code = "09-9000.002";
    const observations = [
      obs({ projectId: "a", snapshotId: "a", costCode: code, normalizedActual: 100000, squareFootage: 50000, marketSector: "MF" }),
      obs({ projectId: "b", snapshotId: "b", costCode: code, normalizedActual: 250000, squareFootage: 50000, marketSector: "Healthcare" }),
    ];
    const model = aggregateConceptPricing(observations, { now: NOW });
    const sectors = model.codes
      .filter((s) => s.metric === "sf" && s.costCode === code)
      .map((s) => s.marketSector)
      .sort();
    expect(sectors).toEqual(["Healthcare", "MF"]);
  });

  it("scores strength on $/SF, so equal dollars at unequal SF read as a WIDE spread", () => {
    const code = "09-9000.002";
    // Same absolute dollars ($100k) but very different SF → $/SF of 1 vs 4: a
    // genuine parametric spread the dollars-only view would have missed.
    const observations = [
      obs({ projectId: "a", snapshotId: "a", costCode: code, normalizedActual: 100000, squareFootage: 100000 }), // 1
      obs({ projectId: "b", snapshotId: "b", costCode: code, normalizedActual: 100000, squareFootage: 25000 }), // 4
    ];
    const model = aggregateConceptPricing(observations, { now: NOW });
    const stat = model.codes.find((s) => s.metric === "sf" && s.costCode === code)!;
    // CV over {1, 4} is large → spread tightness well below the neutral 0.5.
    expect(stat.strength.signals.spreadCv).not.toBeNull();
    expect(stat.strength.signals.spreadTightness).toBeLessThan(0.5);
  });

  it("carries the P6 strength tiers (3 tight recent jobs → strong; 1 → not strong)", () => {
    const code = "09-9000.002";
    const recent = "2026-01-01T00:00:00Z";
    const three = [
      obs({ projectId: "a", snapshotId: "a", costCode: code, normalizedActual: 100000, squareFootage: 50000, finalizedAt: recent }),
      obs({ projectId: "b", snapshotId: "b", costCode: code, normalizedActual: 100000, squareFootage: 50000, finalizedAt: recent }),
      obs({ projectId: "c", snapshotId: "c", costCode: code, normalizedActual: 100000, squareFootage: 50000, finalizedAt: recent }),
    ];
    const model3 = aggregateConceptPricing(three, { now: NOW });
    expect(model3.codes.find((s) => s.metric === "sf" && s.costCode === code)!.strength.tier).toBe("strong");

    const model1 = aggregateConceptPricing([three[0]], { now: NOW });
    expect(model1.codes.find((s) => s.metric === "sf" && s.costCode === code)!.strength.tier).not.toBe("strong");
  });
});

// ---------------------------------------------------------------------------
// Fixture-grounded: division $/SF ties to the engine's per-division normalized
// ---------------------------------------------------------------------------

describe("concept pricing over the real templates/ export", () => {
  let raw: RawActualsExport;

  beforeAll(async () => {
    raw = await loadActualsSource().loadRawExport();
  });

  it("division $/SF equals the engine's per-division normalized sum ÷ SF", () => {
    const SF = 120000;
    const norm = computeNormalizedActuals(raw);
    const snapshot: FinalSnapshotInput = {
      projectId: "p",
      projectName: "Fixture",
      snapshotId: "s",
      snapshotLabel: "Closeout",
      finalizedAt: "2026-01-01T00:00:00Z",
      marketSector: "MF",
      squareFootage: SF,
      unitCount: 0,
      actuals: norm.codeActuals,
      events: norm.events,
      overlayRows: [],
    };
    const observations = buildActualCostObservations([snapshot]);
    const model = aggregateConceptPricing(observations, { now: NOW });

    expect(observations.length).toBeGreaterThan(0);
    expect(model.hasSf).toBe(true);
    expect(model.hasUnit).toBe(false); // unitCount 0 → no $/unit benchmarks

    // Expected per-division normalized: sum the pool observations' normalized by
    // their Procore tier-1 division (the same grouping parseProcoreDivision uses).
    const expectedByDivision = new Map<string, number>();
    for (const o of observations) {
      const key = parseProcoreDivision(o.costCode).key;
      expectedByDivision.set(key, (expectedByDivision.get(key) ?? 0) + o.normalizedActual);
    }

    for (const divStat of model.divisions.filter((s) => s.metric === "sf")) {
      const expectedNormalized = expectedByDivision.get(divStat.division)!;
      expect(divStat.medianCostPerMetric).toBeCloseTo(expectedNormalized / SF, 2);
    }
    // Every division's $/SF is finite and the model is non-empty.
    expect(model.divisions.some((s) => s.metric === "sf")).toBe(true);
  });
});
