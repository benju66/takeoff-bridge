/**
 * Phase 6 actuals pricing pool: the observation builder (effective recompute
 * honored, burden/blank/zero-normalized excluded, cost types summed to code grain,
 * negatives kept, context carried), the per-(code, sector) aggregation
 * (grouping, median/min/max, newest-finalized order), and the strength layer
 * (actual floor, count gate for "strong", cleanliness/recency/spread monotonicity).
 * The final suite grounds it on the real `templates/` export so a re-export
 * shifting codes is caught.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  buildActualCostObservations,
  aggregateActualCostHistory,
  scoreActualStrength,
  ACTUAL_PROVENANCE_FLOOR,
  computeNormalizedActuals,
  isBurdenCode,
  FEE_CODE,
  GL_INSURANCE_CODE,
  EVENT_CLASSIFICATION_KIND,
  type FinalSnapshotInput,
  type ActualCostObservation,
  type CodeActual,
  type ActualsCostType,
  type ChangeEventDetailRow,
  type ClassifiedChangeEvent,
  type NormalizationBucket,
  type OverlayRowLike,
  type RawActualsExport,
} from "@/lib/actuals";
import { loadActualsSource } from "./actualsFixtures";

// ---------------------------------------------------------------------------
// Synthetic builders (mirrors actualsEventReview.test.ts)
// ---------------------------------------------------------------------------

function line(
  costCode: string,
  costType: ActualsCostType,
  latestCost: number,
): ChangeEventDetailRow {
  return {
    rawId: "1",
    eventId: "E",
    eventTitle: "",
    costCode,
    costType,
    description: "",
    vendor: "",
    contract: "",
    latestPrice: latestCost,
    latestCost,
  };
}

function ev(
  eventId: string,
  disp: { bucket: NormalizationBucket; isNormalizedOut: boolean },
  lines: ChangeEventDetailRow[],
  opts: Partial<ClassifiedChangeEvent> = {},
): ClassifiedChangeEvent {
  const netLatestCost = lines.reduce((s, l) => s + l.latestCost, 0);
  return {
    eventId,
    title: opts.title ?? eventId,
    scope: opts.scope ?? "In Scope",
    type: opts.type ?? "Original Budget",
    reason: opts.reason ?? "FP Construction",
    status: opts.status ?? "Approved",
    bucket: disp.bucket,
    isNormalizedOut: disp.isNormalizedOut,
    lines: lines.map((l) => ({ ...l, eventId })),
    netLatestCost: opts.netLatestCost ?? netLatestCost,
    isDuplicate: opts.isDuplicate ?? false,
    duplicateOf: opts.duplicateOf,
  };
}

function ca(
  costCode: string,
  costType: ActualsCostType,
  total: number,
  normalized: number,
  opts: Partial<CodeActual> = {},
): CodeActual {
  return {
    budgetCode: `${costCode}.${costType}`,
    costCode,
    costType,
    description: opts.description ?? `Desc.${costType}`,
    originalBudget: opts.originalBudget ?? 0,
    totalActual: total,
    normalizedActual: normalized,
    isBurden: opts.isBurden ?? isBurdenCode(costCode),
    normalizedOutContributions: opts.normalizedOutContributions ?? [],
  };
}

function snap(opts: Partial<FinalSnapshotInput> = {}): FinalSnapshotInput {
  return {
    projectId: opts.projectId ?? "p1",
    projectName: opts.projectName ?? "Project One",
    snapshotId: opts.snapshotId ?? "s1",
    snapshotLabel: opts.snapshotLabel ?? "Closeout",
    finalizedAt: opts.finalizedAt ?? "2026-01-01T00:00:00Z",
    marketSector: opts.marketSector ?? "",
    actuals: opts.actuals ?? [],
    events: opts.events ?? [],
    overlayRows: opts.overlayRows ?? [],
  };
}

function overrideRow(
  eventId: string,
  scope: string,
  type: string,
  reason: string,
): OverlayRowLike {
  return { kind: EVENT_CLASSIFICATION_KIND, detail: { eventId, scope, type, reason } };
}

function obs(
  normalized: number,
  opts: Partial<ActualCostObservation> = {},
): ActualCostObservation {
  return {
    costCode: opts.costCode ?? "09-9000.002",
    description: opts.description ?? "Code",
    normalizedActual: normalized,
    totalActual: opts.totalActual ?? normalized,
    isBurden: opts.isBurden ?? false,
    coAdjustmentShare: opts.coAdjustmentShare ?? 0,
    projectId: opts.projectId ?? "p",
    projectName: opts.projectName ?? "P",
    snapshotId: opts.snapshotId ?? "s",
    snapshotLabel: opts.snapshotLabel ?? "C",
    finalizedAt: opts.finalizedAt ?? "2026-01-01T00:00:00Z",
    marketSector: opts.marketSector ?? "",
  };
}

const NOW = new Date("2026-06-01T00:00:00Z");

// ---------------------------------------------------------------------------
// buildActualCostObservations
// ---------------------------------------------------------------------------

describe("buildActualCostObservations", () => {
  it("sums cost types to the code grain; excludes burden, blank, and zero-normalized codes", () => {
    const actuals = [
      ca("1-10320.000", "Labor", 1000, 800),
      ca("1-10320.000", "Material", 500, 500), // same code, summed
      ca("09-9000.002", "Subcontract", 2000, 2000),
      ca(FEE_CODE, "Other", 300, 300, { isBurden: true }), // burden → excluded
      ca("", "Other", 50, 50), // blank "None" → excluded
      ca("07-1000.003", "Material", 400, 0), // zero normalized → excluded
    ];
    const result = buildActualCostObservations([snap({ actuals })]);

    expect(result.map((o) => o.costCode).sort()).toEqual(["09-9000.002", "1-10320.000"]);

    const a = result.find((o) => o.costCode === "1-10320.000")!;
    expect(a.normalizedActual).toBe(1300);
    expect(a.totalActual).toBe(1500);
    // coAdjustmentShare = |1500 - 1300| / 1500
    expect(a.coAdjustmentShare).toBeCloseTo(200 / 1500, 6);

    const b = result.find((o) => o.costCode === "09-9000.002")!;
    expect(b.normalizedActual).toBe(2000);
    expect(b.coAdjustmentShare).toBe(0);
  });

  it("retains negative (savings / buyout) normalized values", () => {
    const actuals = [ca("07-2100.000", "Subcontract", -41000, -41000)];
    const result = buildActualCostObservations([snap({ actuals })]);
    expect(result).toHaveLength(1);
    expect(result[0].normalizedActual).toBe(-41000);
  });

  it("honors a Phase-5 classification override (kept → out subtracts the line)", () => {
    const code = "03-3543.002";
    const actuals = [ca(code, "Labor", 1000, 800)];
    const events = [
      ev("E1", { bucket: "original_budget", isNormalizedOut: false }, [line(code, "Labor", 500)]),
    ];

    // No override: the frozen normalized (800) flows through unchanged.
    const base = buildActualCostObservations([snap({ actuals, events })]);
    expect(base[0].normalizedActual).toBe(800);

    // Override E1 to Owner Contingency (out): -500 is stripped from normalized.
    const overlayRows = [overrideRow("E1", "Out of Scope", "Owner Contingency", "Owner Request")];
    const corrected = buildActualCostObservations([snap({ actuals, events, overlayRows })]);
    expect(corrected[0].normalizedActual).toBe(300);
  });

  it("honors an out → kept override (adds the line back)", () => {
    const code = "26-0000.006";
    const actuals = [ca(code, "Material", 5000, 4000)];
    const events = [
      ev(
        "E2",
        { bucket: "owner_contingency", isNormalizedOut: true },
        [line(code, "Material", 1000)],
        { scope: "Out of Scope", type: "Owner Contingency", reason: "Owner Request" },
      ),
    ];
    const overlayRows = [overrideRow("E2", "In Scope", "Original Budget", "FP Construction")];
    const result = buildActualCostObservations([snap({ actuals, events, overlayRows })]);
    expect(result[0].normalizedActual).toBe(5000); // 4000 + 1000 added back
  });

  it("carries project / snapshot context onto every observation", () => {
    const actuals = [ca("09-9000.002", "Subcontract", 100, 100)];
    const result = buildActualCostObservations([
      snap({
        actuals,
        projectId: "proj-42",
        projectName: "Orchard Path III",
        snapshotId: "snap-7",
        snapshotLabel: "Final Closeout",
        finalizedAt: "2026-03-15T00:00:00Z",
        marketSector: "Multifamily",
      }),
    ]);
    expect(result[0]).toMatchObject({
      projectId: "proj-42",
      projectName: "Orchard Path III",
      snapshotId: "snap-7",
      snapshotLabel: "Final Closeout",
      finalizedAt: "2026-03-15T00:00:00Z",
      marketSector: "Multifamily",
    });
  });
});

// ---------------------------------------------------------------------------
// aggregateActualCostHistory
// ---------------------------------------------------------------------------

describe("aggregateActualCostHistory", () => {
  it("pools jobs per (code, sector) with median/min/max and newest-finalized order", () => {
    const code = "09-9000.002";
    const observations = [
      obs(100, { costCode: code, marketSector: "MF", finalizedAt: "2025-01-01T00:00:00Z", projectName: "Old" }),
      obs(300, { costCode: code, marketSector: "MF", finalizedAt: "2026-01-01T00:00:00Z", projectName: "New" }),
      obs(200, { costCode: code, marketSector: "MF", finalizedAt: "2025-06-01T00:00:00Z", projectName: "Mid" }),
    ];
    const map = aggregateActualCostHistory(observations, { now: NOW });
    const stats = map.get(code)!;
    expect(stats).toHaveLength(1);
    const s = stats[0];
    expect(s.count).toBe(3);
    expect(s.medianNormalized).toBe(200);
    expect(s.minNormalized).toBe(100);
    expect(s.maxNormalized).toBe(300);
    expect(s.meanNormalized).toBe(200);
    expect(s.latestFinalizedAt).toBe("2026-01-01T00:00:00Z");
    // Newest finalize first.
    expect(s.observations.map((o) => o.projectName)).toEqual(["New", "Mid", "Old"]);
  });

  it("splits a code by market sector and orders groups by job count desc", () => {
    const code = "09-9000.002";
    const observations = [
      obs(100, { costCode: code, marketSector: "Healthcare" }),
      obs(110, { costCode: code, marketSector: "MF" }),
      obs(120, { costCode: code, marketSector: "MF" }),
    ];
    const stats = aggregateActualCostHistory(observations, { now: NOW }).get(code)!;
    expect(stats.map((s) => s.marketSector)).toEqual(["MF", "Healthcare"]);
    expect(stats[0].count).toBe(2);
    expect(stats[1].count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// scoreActualStrength
// ---------------------------------------------------------------------------

describe("scoreActualStrength", () => {
  const recent = "2026-01-01T00:00:00Z"; // 5 months before NOW → fresh
  const stale = "2019-01-01T00:00:00Z"; // > 60 months → fully decayed

  it("never drops below the actual-provenance floor (even a dirty, stale single job)", () => {
    const s = scoreActualStrength(
      [obs(1000, { coAdjustmentShare: 1, finalizedAt: stale })],
      { now: NOW },
    );
    expect(s.score).toBeGreaterThanOrEqual(ACTUAL_PROVENANCE_FLOOR);
  });

  it("gates 'strong' on at least LOW_CONFIDENCE_BELOW (3) jobs", () => {
    // One perfectly clean, recent job scores high but can never be 'strong'.
    const single = scoreActualStrength([obs(1000, { coAdjustmentShare: 0, finalizedAt: recent })], { now: NOW });
    expect(single.tier).not.toBe("strong");
    expect(single.signals.sampleSize).toBe(1);

    // Three clean, recent, tight jobs → strong.
    const three = scoreActualStrength(
      [
        obs(1000, { coAdjustmentShare: 0, finalizedAt: recent }),
        obs(1000, { coAdjustmentShare: 0, finalizedAt: recent }),
        obs(1000, { coAdjustmentShare: 0, finalizedAt: recent }),
      ],
      { now: NOW },
    );
    expect(three.tier).toBe("strong");
    expect(three.signals.spreadCv).toBe(0);
  });

  it("penalizes CO churn (dirtier scores lower, all else equal)", () => {
    const clean = scoreActualStrength(
      [obs(1000, { coAdjustmentShare: 0, finalizedAt: recent }), obs(1000, { coAdjustmentShare: 0, finalizedAt: recent })],
      { now: NOW },
    );
    const dirty = scoreActualStrength(
      [obs(1000, { coAdjustmentShare: 0.8, finalizedAt: recent }), obs(1000, { coAdjustmentShare: 0.8, finalizedAt: recent })],
      { now: NOW },
    );
    expect(dirty.score).toBeLessThan(clean.score);
    expect(dirty.signals.coCleanliness).toBeCloseTo(0.2, 6);
  });

  it("rewards recency (recent scores higher than stale)", () => {
    const fresh = scoreActualStrength([obs(1000, { finalizedAt: recent }), obs(1000, { finalizedAt: recent })], { now: NOW });
    const old = scoreActualStrength([obs(1000, { finalizedAt: stale }), obs(1000, { finalizedAt: stale })], { now: NOW });
    expect(fresh.score).toBeGreaterThan(old.score);
    expect(fresh.signals.recency).toBe(1);
    expect(old.signals.recency).toBe(0);
  });

  it("rewards tight spread and treats a missing date as neutral", () => {
    const tight = scoreActualStrength(
      [obs(1000, { finalizedAt: recent }), obs(1010, { finalizedAt: recent })],
      { now: NOW },
    );
    const wide = scoreActualStrength(
      [obs(200, { finalizedAt: recent }), obs(1800, { finalizedAt: recent })],
      { now: NOW },
    );
    expect(tight.score).toBeGreaterThan(wide.score);

    const noDate = scoreActualStrength([obs(1000, { finalizedAt: "" })], { now: NOW });
    expect(noDate.signals.recencyMonths).toBeNull();
    expect(noDate.signals.recency).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// Fixture-grounded: the pool ties to the engine's per-code normalized
// ---------------------------------------------------------------------------

describe("pricing pool over the real templates/ export", () => {
  let raw: RawActualsExport;

  beforeAll(async () => {
    raw = await loadActualsSource().loadRawExport();
  });

  it("reports each code's normalized as the engine's per-code sum, with burden excluded", () => {
    const norm = computeNormalizedActuals(raw);
    const observations = buildActualCostObservations([
      snap({ actuals: norm.codeActuals, events: norm.events, overlayRows: [] }),
    ]);

    expect(observations.length).toBeGreaterThan(0);

    // Expected: sum normalized per non-burden, non-blank code; drop zeros.
    const expected = new Map<string, number>();
    for (const a of norm.codeActuals) {
      if (a.costCode === "" || a.isBurden) continue;
      expected.set(a.costCode, (expected.get(a.costCode) ?? 0) + a.normalizedActual);
    }

    for (const o of observations) {
      expect(o.normalizedActual).toBeCloseTo(expected.get(o.costCode) ?? NaN, 2);
      expect(o.normalizedActual).not.toBe(0);
    }

    // Burden codes are never in the pricing pool.
    const codes = new Set(observations.map((o) => o.costCode));
    expect(codes.has(FEE_CODE)).toBe(false);
    expect(codes.has(GL_INSURANCE_CODE)).toBe(false);
  });
});
