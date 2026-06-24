/**
 * Phase 8 active-project variance engine: the core budget-vs-EAC stat (sign,
 * percent, on/over/under tolerance band), the code/division roll-up (cost types
 * summed, Procore tier-1 grouping, burden + blank kept so it ties to the grand
 * EAC), the snapshot-over-snapshot timeline (capture order, deltas), and the full
 * project model + KPIs. The final suite grounds it on the real `templates/` export
 * so the division sum ties to the engine's grand total.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  buildProjectVariance,
  buildTimeline,
  buildCodeVariance,
  buildDivisionVariance,
  computeVarianceStat,
  computeNormalizedActuals,
  isBurdenCode,
  FEE_CODE,
  GL_INSURANCE_CODE,
  type ProjectSnapshotInput,
  type CodeActual,
  type ActualsCostType,
  type RawActualsExport,
} from "@/lib/actuals";
import { loadActualsSource } from "./actualsFixtures";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------------------
// Synthetic builders (mirror actualsPricingPool.test.ts)
// ---------------------------------------------------------------------------

function ca(
  costCode: string,
  costType: ActualsCostType,
  originalBudget: number,
  total: number,
  normalized: number,
  opts: Partial<CodeActual> = {},
): CodeActual {
  return {
    budgetCode: `${costCode}.${costType}`,
    costCode,
    costType,
    description: opts.description ?? `Desc.${costType}`,
    originalBudget,
    totalActual: total,
    normalizedActual: normalized,
    isBurden: opts.isBurden ?? isBurdenCode(costCode),
    normalizedOutContributions: opts.normalizedOutContributions ?? [],
  };
}

function psnap(opts: Partial<ProjectSnapshotInput> = {}): ProjectSnapshotInput {
  return {
    snapshotId: opts.snapshotId ?? "s1",
    snapshotNumber: opts.snapshotNumber ?? 1,
    label: opts.label ?? "",
    isFinal: opts.isFinal ?? false,
    capturedAt: opts.capturedAt ?? "2026-01-01T00:00:00Z",
    finalizedAt: opts.finalizedAt ?? "",
    codes: opts.codes ?? [],
  };
}

// ---------------------------------------------------------------------------
// computeVarianceStat
// ---------------------------------------------------------------------------

describe("computeVarianceStat", () => {
  it("EAC over the budget reads positive variance / over", () => {
    const s = computeVarianceStat(1000, 1200, 1100);
    expect(s.variance).toBe(200);
    expect(s.variancePct).toBeCloseTo(0.2, 6);
    expect(s.status).toBe("over");
  });

  it("EAC under the budget reads negative variance / under", () => {
    const s = computeVarianceStat(1000, 800, 800);
    expect(s.variance).toBe(-200);
    expect(s.status).toBe("under");
  });

  it("within the tolerance band reads on budget", () => {
    const s = computeVarianceStat(1000, 1003, 1000); // band = max($1, 0.5%·1000 = $5)
    expect(s.variance).toBe(3);
    expect(s.status).toBe("on");
  });

  it("no baseline: pct is null and any real EAC reads over", () => {
    const s = computeVarianceStat(0, 500, 500);
    expect(s.variancePct).toBeNull();
    expect(s.status).toBe("over");

    const zero = computeVarianceStat(0, 0, 0);
    expect(zero.status).toBe("on");
  });

  it("honors a custom tolerance", () => {
    const tight = computeVarianceStat(1000, 1004, 1000, { tolerancePct: 0, toleranceAbs: 1 });
    expect(tight.status).toBe("over"); // 4 > $1 floor
    const loose = computeVarianceStat(1000, 1050, 1000, { tolerancePct: 0.1 });
    expect(loose.status).toBe("on"); // 50 < 10%·1000 = 100
  });
});

// ---------------------------------------------------------------------------
// buildCodeVariance
// ---------------------------------------------------------------------------

describe("buildCodeVariance", () => {
  it("sums cost types to the code grain and keeps burden + blank codes", () => {
    const codes = [
      ca("1-10320.000", "Labor", 600, 700, 650),
      ca("1-10320.000", "Material", 400, 500, 450), // same code → summed
      ca("09-9000.002", "Subcontract", 2000, 1800, 1800), // under
      ca(FEE_CODE, "Other", 0, 300, 300, { isBurden: true }), // burden — KEPT (unlike the pool)
      ca("", "Other", 0, 50, 50), // blank "None" — KEPT
    ];
    const result = buildCodeVariance(codes);

    // Everything is kept so Σ eac ties to the snapshot grand.
    expect(result).toHaveLength(4);
    expect(result.reduce((s, c) => s + c.eac, 0)).toBe(700 + 500 + 1800 + 300 + 50);

    const gc = result.find((c) => c.costCode === "1-10320.000")!;
    expect(gc.originalBudget).toBe(1000);
    expect(gc.eac).toBe(1200);
    expect(gc.normalized).toBe(1100);
    expect(gc.variance).toBe(200);
    expect(gc.status).toBe("over");

    const fee = result.find((c) => c.costCode === FEE_CODE)!;
    expect(fee.isBurden).toBe(true);
  });

  it("orders rows by overrun (variance desc)", () => {
    const codes = [
      ca("09-9000.002", "Subcontract", 1000, 900, 900), // -100
      ca("1-10320.000", "Labor", 1000, 1500, 1500), // +500
      ca("26-0000.006", "Material", 1000, 1100, 1100), // +100
    ];
    const result = buildCodeVariance(codes);
    expect(result.map((c) => c.costCode)).toEqual([
      "1-10320.000", "26-0000.006", "09-9000.002",
    ]);
  });
});

// ---------------------------------------------------------------------------
// buildDivisionVariance
// ---------------------------------------------------------------------------

describe("buildDivisionVariance", () => {
  it("groups by the Procore tier-1 token; burden rolls to division 60; blank → Unassigned", () => {
    const codes = [
      ca("1-10320.000", "Labor", 1000, 1200, 1100),
      ca("1-20000.000", "Material", 500, 400, 400),
      ca(FEE_CODE, "Other", 0, 300, 300, { isBurden: true }), // 60-604000.000
      ca(GL_INSURANCE_CODE, "Other", 0, 200, 200, { isBurden: true }), // 60-602020.000
      ca("", "Other", 0, 50, 50),
    ];
    const divisions = buildDivisionVariance(codes);

    const div1 = divisions.find((d) => d.division === "1")!;
    expect(div1.divisionLabel).toBe("Division 1");
    expect(div1.originalBudget).toBe(1500);
    expect(div1.eac).toBe(1600);
    expect(div1.codeCount).toBe(2);
    expect(div1.isBurden).toBe(false);

    const div60 = divisions.find((d) => d.division === "60")!;
    expect(div60.eac).toBe(500);
    expect(div60.isBurden).toBe(true); // all codes burden
    expect(div60.status).toBe("over"); // no baseline, real EAC

    const unassigned = divisions.find((d) => d.division === "")!;
    expect(unassigned.divisionLabel).toBe("Unassigned");
    expect(unassigned.eac).toBe(50);

    // Nothing dropped: Σ division eac == Σ all code totals.
    expect(divisions.reduce((s, d) => s + d.eac, 0)).toBe(1600 + 500 + 50);
  });
});

// ---------------------------------------------------------------------------
// buildTimeline
// ---------------------------------------------------------------------------

describe("buildTimeline", () => {
  it("orders by capture time and computes EAC / normalized deltas", () => {
    const snaps = [
      psnap({ snapshotId: "b", snapshotNumber: 2, capturedAt: "2026-02-01T00:00:00Z", codes: [ca("1-10320.000", "Labor", 900, 1000, 950)] }),
      psnap({ snapshotId: "a", snapshotNumber: 1, capturedAt: "2026-01-01T00:00:00Z", codes: [ca("1-10320.000", "Labor", 900, 800, 800)] }),
      psnap({ snapshotId: "c", snapshotNumber: 3, capturedAt: "2026-03-01T00:00:00Z", codes: [ca("1-10320.000", "Labor", 900, 1300, 1200)] }),
    ];
    const tl = buildTimeline(snaps);

    expect(tl.map((p) => p.snapshotId)).toEqual(["a", "b", "c"]);
    expect(tl[0].eacDeltaFromPrev).toBeNull();
    expect(tl[0].normalizedDeltaFromPrev).toBeNull();
    expect(tl[1].eacDeltaFromPrev).toBe(200); // 1000 − 800
    expect(tl[1].eacDeltaPct).toBeCloseTo(200 / 800, 6);
    expect(tl[1].normalizedDeltaFromPrev).toBe(150); // 950 − 800
    expect(tl[2].eacDeltaFromPrev).toBe(300); // 1300 − 1000
  });

  it("breaks a capture-time tie by snapshot number", () => {
    const snaps = [
      psnap({ snapshotId: "two", snapshotNumber: 2, capturedAt: "2026-01-01T00:00:00Z", codes: [ca("1-1.000", "Labor", 0, 200, 200)] }),
      psnap({ snapshotId: "one", snapshotNumber: 1, capturedAt: "2026-01-01T00:00:00Z", codes: [ca("1-1.000", "Labor", 0, 100, 100)] }),
    ];
    const tl = buildTimeline(snaps);
    expect(tl.map((p) => p.snapshotId)).toEqual(["one", "two"]);
  });
});

// ---------------------------------------------------------------------------
// buildProjectVariance
// ---------------------------------------------------------------------------

describe("buildProjectVariance", () => {
  it("returns an honest empty model with no snapshots", () => {
    const model = buildProjectVariance([]);
    expect(model.hasData).toBe(false);
    expect(model.latest).toBeNull();
    expect(model.kpis).toBeNull();
    expect(model.divisions).toEqual([]);
  });

  it("builds KPIs + divisions off the latest snapshot (works with only drafts)", () => {
    const early = psnap({
      snapshotId: "e", snapshotNumber: 1, capturedAt: "2026-01-01T00:00:00Z",
      codes: [ca("1-10320.000", "Labor", 1000, 1000, 1000)],
    });
    const latest = psnap({
      snapshotId: "l", snapshotNumber: 2, capturedAt: "2026-02-01T00:00:00Z",
      codes: [
        ca("1-10320.000", "Labor", 1000, 1200, 1100), // direct, over
        ca(FEE_CODE, "Other", 0, 100, 100, { isBurden: true }), // burden
      ],
    });
    const model = buildProjectVariance([latest, early]); // unordered input

    expect(model.hasData).toBe(true);
    expect(model.latest!.snapshotId).toBe("l"); // newest capture
    expect(model.kpis!.snapshotCount).toBe(2);
    expect(model.kpis!.latestIsFinal).toBe(false); // both drafts — still works

    // KPI tie-outs.
    expect(model.kpis!.eac).toBe(1300);
    expect(model.kpis!.burdenEac).toBe(100);
    expect(model.kpis!.directEac).toBe(1200);
    expect(round2(model.kpis!.directEac + model.kpis!.burdenEac)).toBe(model.kpis!.eac);
    expect(model.kpis!.eacTrend).toBe(300); // 1300 − 1000 over the timeline

    // Both divisions (1 + 60) are over budget.
    expect(model.kpis!.divisionCount).toBe(2);
    expect(model.kpis!.divisionsOverBudget).toBe(2);

    // Σ division eac/original ties to the headline.
    expect(model.divisions.reduce((s, d) => s + d.eac, 0)).toBe(model.kpis!.eac);
    expect(model.divisions.reduce((s, d) => s + d.originalBudget, 0)).toBe(model.kpis!.originalBudget);
  });

  it("flags the latest snapshot as final when it is promoted", () => {
    const model = buildProjectVariance([
      psnap({ snapshotId: "f", capturedAt: "2026-05-01T00:00:00Z", isFinal: true, finalizedAt: "2026-05-02T00:00:00Z", codes: [ca("1-1.000", "Labor", 100, 90, 90)] }),
    ]);
    expect(model.kpis!.latestIsFinal).toBe(true);
    expect(model.kpis!.status).toBe("under");
    expect(model.kpis!.eacTrend).toBeNull(); // single snapshot
  });
});

// ---------------------------------------------------------------------------
// Fixture-grounded: division sum ties to the engine's grand total
// ---------------------------------------------------------------------------

describe("variance over the real templates/ export", () => {
  let raw: RawActualsExport;

  beforeAll(async () => {
    raw = await loadActualsSource().loadRawExport();
  });

  it("ties Σ division EAC to the engine grand total and derives budget variance from it", () => {
    const norm = computeNormalizedActuals(raw);
    const model = buildProjectVariance([psnap({ codes: norm.codeActuals })]);

    expect(model.hasData).toBe(true);

    // The whole job is kept (burden + blank included), so the division sum and the
    // latest-snapshot EAC both equal the engine's grand total.
    const sumDivEac = model.divisions.reduce((s, d) => s + d.eac, 0);
    expect(sumDivEac).toBeCloseTo(round2(norm.grandTotalActual), 2);
    expect(model.latest!.eac).toBeCloseTo(round2(norm.grandTotalActual), 2);

    // Budget variance = grand EAC − Σ original budget.
    const sumOrig = norm.codeActuals.reduce((s, a) => s + a.originalBudget, 0);
    expect(model.latest!.variance).toBeCloseTo(model.latest!.eac - round2(sumOrig), 2);

    // Division grouping is the Procore tier-1 token (GC = "1"), not a CSI code.
    expect(model.divisions.some((d) => d.division === "1")).toBe(true);
  });
});
