/**
 * Phase 9 planned-buyout-vs-miss accuracy lens: the accuracy stat (within / miss /
 * savings / unbudgeted, tolerance band, utilization), the EFFECTIVE fp_buyout draw
 * extraction (filter, direct-vs-burden split, Procore-division grouping, override
 * reclassification, duplicate + blank/zero skip), the per-project build, and the
 * portfolio roll-up. The final suite grounds it on the real `templates/` export so
 * the draw ties to an independent recompute off the normalization engine.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  buildBuyoutDraws,
  scoreBuyoutAccuracy,
  buildBuyoutAccuracy,
  aggregateBuyoutAccuracy,
  BUYOUT_TOLERANCE_ABS,
  parseProcoreDivision,
  isBurdenCode,
  computeNormalizedActuals,
  FEE_CODE,
  GL_INSURANCE_CODE,
  type BuyoutAccuracyInput,
  type ClassifiedChangeEvent,
  type ChangeEventDetailRow,
  type ActualsCostType,
  type NormalizationBucket,
  type RawActualsExport,
  type OverlayRowLike,
} from "@/lib/actuals";
import { loadActualsSource } from "./actualsFixtures";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------------------
// Synthetic builders
// ---------------------------------------------------------------------------

function dl(
  costCode: string,
  costType: ActualsCostType,
  latestCost: number,
  opts: Partial<ChangeEventDetailRow> = {},
): ChangeEventDetailRow {
  return {
    rawId: opts.rawId ?? "1",
    eventId: opts.eventId ?? "1",
    eventTitle: opts.eventTitle ?? "",
    costCode,
    costType,
    description: opts.description ?? `Desc.${costType}`,
    vendor: "",
    contract: "",
    latestPrice: opts.latestPrice ?? 0,
    latestCost,
  };
}

function ce(opts: Partial<ClassifiedChangeEvent> & { lines: ChangeEventDetailRow[] }): ClassifiedChangeEvent {
  const net = round2(opts.lines.reduce((s, l) => s + l.latestCost, 0));
  return {
    eventId: opts.eventId ?? "1",
    title: opts.title ?? "Event",
    scope: opts.scope ?? "In Scope",
    type: opts.type ?? "FP Contingency/Buyout",
    reason: opts.reason ?? "FP Construction",
    status: opts.status ?? "Closed",
    bucket: opts.bucket ?? "fp_buyout",
    isNormalizedOut: opts.isNormalizedOut ?? false,
    lines: opts.lines,
    netLatestCost: opts.netLatestCost ?? net,
    isDuplicate: opts.isDuplicate ?? false,
    duplicateOf: opts.duplicateOf,
  };
}

/** An `event_classification` overlay row (mirrors the Phase-5 write shape). */
function ovr(eventId: string, scope: string, type: string, reason: string): OverlayRowLike {
  return { kind: "event_classification", detail: { eventId, scope, type, reason } };
}

function input(opts: Partial<BuyoutAccuracyInput> & { events: ClassifiedChangeEvent[] }): BuyoutAccuracyInput {
  return {
    projectId: opts.projectId ?? "p1",
    projectName: opts.projectName ?? "Project One",
    snapshotId: opts.snapshotId ?? "s1",
    snapshotLabel: opts.snapshotLabel ?? "Closeout",
    finalizedAt: opts.finalizedAt ?? "2026-01-01T00:00:00Z",
    marketSector: opts.marketSector ?? "",
    contingencyBudget: opts.contingencyBudget ?? null,
    events: opts.events,
    overlayRows: opts.overlayRows ?? [],
  };
}

// ---------------------------------------------------------------------------
// scoreBuyoutAccuracy
// ---------------------------------------------------------------------------

describe("scoreBuyoutAccuracy", () => {
  it("a draw inside the budget reads within / no miss", () => {
    const s = scoreBuyoutAccuracy(5000, 10000);
    expect(s.status).toBe("within");
    expect(s.missAmount).toBe(0);
    expect(s.plannedDraw).toBe(5000);
    expect(s.savings).toBe(0);
    expect(s.utilizationPct).toBeCloseTo(0.5, 6);
    expect(s.hasBudget).toBe(true);
  });

  it("a draw over the budget reads miss with the excess", () => {
    const s = scoreBuyoutAccuracy(15000, 10000);
    expect(s.status).toBe("miss");
    expect(s.missAmount).toBe(5000);
    expect(s.plannedDraw).toBe(10000); // the within-budget portion
    expect(s.utilizationPct).toBeCloseTo(1.5, 6);
  });

  it("a net-negative draw reads savings (returned contingency)", () => {
    const s = scoreBuyoutAccuracy(-3000, 10000);
    expect(s.status).toBe("savings");
    expect(s.savings).toBe(3000);
    expect(s.missAmount).toBe(0);
    expect(s.plannedDraw).toBe(0);
  });

  it("no budget reads unbudgeted — draw reported, no miss invented", () => {
    const s = scoreBuyoutAccuracy(5000, null);
    expect(s.status).toBe("unbudgeted");
    expect(s.hasBudget).toBe(false);
    expect(s.contingencyBudget).toBeNull();
    expect(s.missAmount).toBe(0);
    expect(s.plannedDraw).toBe(0);
    expect(s.utilizationPct).toBeNull();
    expect(s.drawn).toBe(5000);

    // a negative draw still surfaces savings honestly even when unbudgeted
    expect(scoreBuyoutAccuracy(-2000, null).savings).toBe(2000);
  });

  it("a zero budget makes any real draw a miss, but a zero draw is within", () => {
    const miss = scoreBuyoutAccuracy(500, 0);
    expect(miss.status).toBe("miss");
    expect(miss.missAmount).toBe(500);
    expect(miss.utilizationPct).toBeNull(); // no baseline to divide by

    expect(scoreBuyoutAccuracy(0, 0).status).toBe("within");
  });

  it("honors the tolerance band around the budget", () => {
    // band = max($1, 0.5%·10000 = $50)
    expect(scoreBuyoutAccuracy(10040, 10000).status).toBe("within"); // 40 < 50
    expect(scoreBuyoutAccuracy(10060, 10000).status).toBe("miss"); // 60 > 50
    // a custom tolerance tightens the band to the absolute floor
    expect(scoreBuyoutAccuracy(BUYOUT_TOLERANCE_ABS + 1, 0, { tolerancePct: 0 }).status).toBe("miss");
    expect(scoreBuyoutAccuracy(BUYOUT_TOLERANCE_ABS, 0, { tolerancePct: 0 }).status).toBe("within");
  });
});

// ---------------------------------------------------------------------------
// buildBuyoutDraws
// ---------------------------------------------------------------------------

describe("buildBuyoutDraws", () => {
  it("keeps only fp_buyout events; splits direct from Fee/GL burden", () => {
    const events = [
      ce({
        eventId: "1",
        bucket: "fp_buyout",
        lines: [
          dl("1-10320.000", "Labor", 5000, { eventId: "1" }),
          dl(FEE_CODE, "Other", 500, { eventId: "1" }), // the CO's own fee markup
          dl(GL_INSURANCE_CODE, "Other", 100, { eventId: "1" }), // GL markup
        ],
      }),
      // an in-scope ORIGINAL BUDGET change (not buyout) — excluded entirely
      ce({ eventId: "2", bucket: "original_budget", type: "Original Budget", lines: [dl("3-30000.000", "Material", 9999, { eventId: "2" })] }),
    ];
    const draws = buildBuyoutDraws({ events, overlayRows: [] });

    expect(draws.drawCount).toBe(1);
    expect(draws.directDrawn).toBe(5000);
    expect(draws.burdenDrawn).toBe(600);
    expect(draws.grossDrawn).toBe(5600);
    // only the direct code shows up in the division breakdown
    expect(draws.byDivision.map((d) => d.division)).toEqual(["1"]);
    expect(draws.byDivision[0].codes.map((c) => c.costCode)).toEqual(["1-10320.000"]);
  });

  it("groups direct draws by the Procore tier-1 token and skips blank/zero lines", () => {
    const draws = buildBuyoutDraws({
      events: [
        ce({
          eventId: "1",
          lines: [
            dl("1-10320.000", "Labor", 4000, { eventId: "1" }),
            dl("09-9000.002", "Subcontract", 6000, { eventId: "1" }),
            dl("", "Other", 1234, { eventId: "1" }), // blank cost code — skipped
            dl("1-20000.000", "Material", 0, { eventId: "1" }), // zero — skipped
          ],
        }),
      ],
      overlayRows: [],
    });

    expect(draws.directDrawn).toBe(10000);
    const divs = Object.fromEntries(draws.byDivision.map((d) => [d.division, d.directDraw]));
    expect(divs).toEqual({ "1": 4000, "09": 6000 });
    // proves parseProcoreDivision grouping (raw tier-1 "09", not a CSI code)
    expect(draws.byDivision.every((d) => d.division === parseProcoreDivision(d.codes[0].costCode).key)).toBe(true);
  });

  it("excludes a duplicate fp_buyout event (its dollars were already counted)", () => {
    const events = [
      ce({ eventId: "97", lines: [dl("7-71000.000", "Subcontract", -41476.26, { eventId: "97" })] }),
      ce({ eventId: "98", isDuplicate: true, duplicateOf: "97", lines: [dl("7-71000.000", "Subcontract", -41476.26, { eventId: "98" })] }),
    ];
    const draws = buildBuyoutDraws({ events, overlayRows: [] });
    expect(draws.drawCount).toBe(1);
    expect(draws.directDrawn).toBe(-41476.26); // negative (savings) retained
  });

  it("honors a Phase-5 override that reclassifies an event INTO fp_buyout", () => {
    // frozen as original_budget; the human corrects it to FP Contingency/Buyout
    const events = [
      ce({ eventId: "5", bucket: "original_budget", type: "Original Budget", lines: [dl("1-10320.000", "Labor", 2500, { eventId: "5" })] }),
    ];
    const draws = buildBuyoutDraws({
      events,
      overlayRows: [ovr("5", "In Scope", "FP Contingency/Buyout", "FP Construction")],
    });
    expect(draws.drawCount).toBe(1);
    expect(draws.overriddenCount).toBe(1);
    expect(draws.directDrawn).toBe(2500);
    expect(draws.events[0].type).toBe("FP Contingency/Buyout"); // effective shown
    expect(draws.events[0].isOverridden).toBe(true);
  });

  it("honors a Phase-5 override that reclassifies an event OUT of fp_buyout", () => {
    const events = [
      ce({ eventId: "6", bucket: "fp_buyout", lines: [dl("1-10320.000", "Labor", 8000, { eventId: "6" })] }),
    ];
    const draws = buildBuyoutDraws({
      events,
      overlayRows: [ovr("6", "Out of Scope", "Owner Contingency", "Owner Request")],
    });
    expect(draws.drawCount).toBe(0); // no longer a buyout draw
    expect(draws.directDrawn).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildBuyoutAccuracy
// ---------------------------------------------------------------------------

describe("buildBuyoutAccuracy", () => {
  it("combines the draw with the budget into a scored project read", () => {
    const result = buildBuyoutAccuracy(
      input({
        projectName: "Orchard Path III",
        contingencyBudget: 10000,
        events: [ce({ eventId: "1", lines: [dl("1-10320.000", "Labor", 12000, { eventId: "1" })] })],
      }),
    );
    expect(result.projectName).toBe("Orchard Path III");
    expect(result.draws.directDrawn).toBe(12000);
    expect(result.stat.status).toBe("miss");
    expect(result.stat.missAmount).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// aggregateBuyoutAccuracy
// ---------------------------------------------------------------------------

describe("aggregateBuyoutAccuracy", () => {
  it("returns an honest empty portfolio with no snapshots", () => {
    const portfolio = aggregateBuyoutAccuracy([]);
    expect(portfolio.hasData).toBe(false);
    expect(portfolio.projects).toEqual([]);
    expect(portfolio.totals.hitRate).toBeNull();
    expect(portfolio.totals.portfolioStatus).toBe("unbudgeted");
    expect(portfolio.totals.budgetedProjects).toBe(0);
  });

  it("scores each job against its own budget, rolls up totals + hit rate, miss-first", () => {
    const portfolio = aggregateBuyoutAccuracy([
      input({ snapshotId: "within", projectName: "A within", contingencyBudget: 10000, events: [ce({ eventId: "a", lines: [dl("1-1.000", "Labor", 5000, { eventId: "a" })] })] }),
      input({ snapshotId: "miss", projectName: "B miss", contingencyBudget: 10000, events: [ce({ eventId: "b", lines: [dl("1-1.000", "Labor", 18000, { eventId: "b" })] })] }),
      input({ snapshotId: "savings", projectName: "C savings", contingencyBudget: 10000, events: [ce({ eventId: "c", lines: [dl("1-1.000", "Labor", -2000, { eventId: "c" })] })] }),
      input({ snapshotId: "unbudgeted", projectName: "D unbudgeted", contingencyBudget: null, events: [ce({ eventId: "d", lines: [dl("1-1.000", "Labor", 4000, { eventId: "d" })] })] }),
    ]);

    expect(portfolio.hasData).toBe(true);
    // biggest miss first
    expect(portfolio.projects[0].snapshotId).toBe("miss");

    const t = portfolio.totals;
    expect(t.budgetedProjects).toBe(3);
    expect(t.unbudgetedProjects).toBe(1);
    expect(t.withinCount).toBe(1);
    expect(t.missCount).toBe(1);
    expect(t.savingsCount).toBe(1);
    expect(t.totalContingencyBudget).toBe(30000);
    expect(t.totalDrawn).toBe(5000 + 18000 - 2000); // budgeted only (excludes unbudgeted)
    expect(t.totalMiss).toBe(8000); // 18000 − 10000
    expect(t.totalPlanned).toBe(5000 + 10000 + 0);
    expect(t.hitRate).toBe(0.67); // round2((within + savings) / budgeted) = 2/3
  });
});

// ---------------------------------------------------------------------------
// Fixture-grounded: draw ties to an independent recompute off the engine
// ---------------------------------------------------------------------------

describe("buyout accuracy over the real templates/ export", () => {
  let raw: RawActualsExport;

  beforeAll(async () => {
    raw = await loadActualsSource().loadRawExport();
  });

  /** Independent Σ of EFFECTIVE (here = frozen, no overlay) fp_buyout direct draw. */
  function expectedDirectDraw(events: ClassifiedChangeEvent[]): number {
    let sum = 0;
    for (const ev of events) {
      if (ev.isDuplicate) continue;
      if ((ev.bucket as NormalizationBucket) !== "fp_buyout") continue;
      for (const line of ev.lines) {
        if (line.costCode === "") continue;
        if (line.latestCost === 0) continue;
        if (isBurdenCode(line.costCode)) continue;
        sum += line.latestCost;
      }
    }
    return round2(sum);
  }

  it("Σ fp_buyout direct draw ties to the engine, and divisions sum back to it", () => {
    const norm = computeNormalizedActuals(raw);
    const draws = buildBuyoutDraws({ events: norm.events, overlayRows: [] });

    // The export genuinely carries in-scope FP Contingency/Buyout events.
    expect(draws.drawCount).toBeGreaterThan(0);

    // Tie-out to the independent recompute.
    expect(draws.directDrawn).toBeCloseTo(expectedDirectDraw(norm.events), 2);

    // Division roll-up loses nothing.
    const sumDiv = draws.byDivision.reduce((s, d) => s + d.directDraw, 0);
    expect(round2(sumDiv)).toBeCloseTo(draws.directDrawn, 2);

    // Grouping is the Procore tier-1 token, never a CSI code.
    expect(
      draws.byDivision.every((d) => d.division === parseProcoreDivision(d.codes[0].costCode).key),
    ).toBe(true);
  });

  it("pairs the real draw with a synthetic budget for a planned/miss split", () => {
    const norm = computeNormalizedActuals(raw);
    const drawn = buildBuyoutDraws({ events: norm.events, overlayRows: [] }).directDrawn;

    // A budget $1,000 under the real draw forces a miss of exactly $1,000 (the band
    // pinned to the $1 floor so the assertion is independent of the draw's size).
    const tight = buildBuyoutAccuracy(input({ contingencyBudget: round2(drawn - 1000), events: norm.events }), {
      tolerancePct: 0,
      toleranceAbs: 1,
    });
    expect(tight.stat.status).toBe("miss");
    expect(tight.stat.missAmount).toBeCloseTo(1000, 2);

    // A budget $1M above the real draw never misses (within or savings by sign).
    const loose = buildBuyoutAccuracy(input({ contingencyBudget: round2(drawn + 1_000_000), events: norm.events }));
    expect(loose.stat.missAmount).toBe(0);
    expect(loose.stat.status).not.toBe("miss");
  });
});
