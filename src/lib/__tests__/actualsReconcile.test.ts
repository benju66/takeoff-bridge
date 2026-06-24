/**
 * Phase 4 reconciliation engine: estimate↔code bucketing, targeting heuristics,
 * disposition-from-overlay derivation, ties-out tolerance, and the overlay-write
 * builders. The synthetic suites pin the logic; the final suite grounds it on the
 * real `templates/` exports (so a re-export that shifts cost codes is caught).
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  buildReconciliationModel,
  buildVerifyAllocation,
  buildLineAllocation,
  buildDeclineAllocation,
  ALLOCATION_KIND,
  computeNormalizedActuals,
  type CodeActual,
  type ActualsCostType,
  type EstimateLineLike,
  type AllocationLike,
  type CodeReconciliation,
  type NormalizedActuals,
  type RawActualsExport,
} from "@/lib/actuals";
import { loadActualsSource } from "./actualsFixtures";

// ---------------------------------------------------------------------------
// Builders for synthetic inputs
// ---------------------------------------------------------------------------

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
    isBurden: opts.isBurden ?? false,
    normalizedOutContributions: [],
  };
}

function el(
  id: string,
  procoreCode: string,
  total: number,
  opts: Partial<EstimateLineLike> = {},
): EstimateLineLike {
  return {
    id,
    procoreCode,
    description: opts.description ?? id,
    costType: opts.costType ?? "M",
    total,
  };
}

function al(
  budgetCode: string,
  kind: string,
  total: number,
  normalized: number,
  estimateLineItemId = "",
): AllocationLike {
  return {
    id: `al-${budgetCode}-${kind}-${estimateLineItemId}`,
    budgetCode,
    estimateLineItemId,
    kind,
    allocatedTotal: total,
    allocatedNormalized: normalized,
  };
}

const codeOf = (m: { codes: CodeReconciliation[] }, code: string) =>
  m.codes.find((c) => c.costCode === code)!;

// ---------------------------------------------------------------------------
// Bucketing
// ---------------------------------------------------------------------------

describe("buildReconciliationModel — bucketing", () => {
  const model = buildReconciliationModel({
    actuals: [
      ca("1-10320.000", "Labor", 1000, 1000),
      ca("2-20000.000", "Subcontract", 2000, 2000),
      ca("3-30000.000", "Material", 3000, 3000), // no estimate line → unbacked
    ],
    estimateLines: [
      el("a", "1-10320.000", 1000), // 1 line → oneToOne
      el("b", "2-20000.000", 1200), // 2 lines → rollup
      el("c", "2-20000.000", 900),
      el("d", "9-99999.999", 500), // code with no actual → estimateOnly
      el("e", "", 250), // unmapped — counted, not lost
    ],
    allocations: [],
  });

  it("classifies one estimate line + actual as oneToOne", () => {
    expect(codeOf(model, "1-10320.000").bucket).toBe("oneToOne");
  });

  it("classifies two+ estimate lines + actual as rollup (with summed estimate)", () => {
    const c = codeOf(model, "2-20000.000");
    expect(c.bucket).toBe("rollup");
    expect(c.estimateLines).toHaveLength(2);
    expect(c.estimateTotal).toBe(2100);
  });

  it("classifies an actual with no estimate line as unbacked", () => {
    expect(codeOf(model, "3-30000.000").bucket).toBe("unbacked");
  });

  it("classifies an estimate line with no actual as estimateOnly", () => {
    const c = codeOf(model, "9-99999.999");
    expect(c.bucket).toBe("estimateOnly");
    expect(c.hasActual).toBe(false);
  });

  it("counts unmapped estimate lines instead of dropping them silently", () => {
    expect(model.unmappedEstimateLineCount).toBe(1);
    expect(model.codes.some((c) => c.costCode === "")).toBe(false);
  });

  it("tallies the bucket counts", () => {
    expect(model.counts.oneToOne).toBe(1);
    expect(model.counts.rollup).toBe(1);
    expect(model.counts.unbacked).toBe(1);
    expect(model.counts.estimateOnly).toBe(1);
  });

  it("aggregates multiple cost types of one code up to the code grain", () => {
    const m = buildReconciliationModel({
      actuals: [
        ca("5-51200.000", "Labor", 400, 400),
        ca("5-51200.000", "Material", 600, 600),
      ],
      estimateLines: [el("x", "5-51200.000", 1000)],
      allocations: [],
    });
    const c = codeOf(m, "5-51200.000");
    expect(c.totalActual).toBe(1000);
    expect(c.perType).toHaveLength(2);
    expect(c.bucket).toBe("oneToOne");
  });
});

// ---------------------------------------------------------------------------
// Targeting heuristics
// ---------------------------------------------------------------------------

describe("buildReconciliationModel — targeting", () => {
  it("flags a high-value rollup by normalized share of the job", () => {
    const m = buildReconciliationModel({
      actuals: [ca("A", "Subcontract", 100000, 100000), ca("B", "Material", 100000, 100000)],
      estimateLines: [el("1", "A", 50000), el("2", "A", 50000)], // rollup, variance 0
      allocations: [],
      thresholds: { valueShareThreshold: 0.4 }, // A = 50% share
    });
    const a = codeOf(m, "A");
    expect(a.isHighValue).toBe(true);
    expect(a.isTargeted).toBe(true);
    expect(m.counts.targetedRollup).toBe(1);
  });

  it("does not flag a rollup below both thresholds", () => {
    const m = buildReconciliationModel({
      actuals: [ca("A", "Subcontract", 100000, 100000), ca("B", "Material", 100000, 100000)],
      estimateLines: [el("1", "A", 50000), el("2", "A", 50000)], // variance 0
      allocations: [],
      thresholds: { valueShareThreshold: 0.6 }, // A = 50% < 60%
    });
    const a = codeOf(m, "A");
    expect(a.isHighValue).toBe(false);
    expect(a.isHighVariance).toBe(false);
    expect(a.isTargeted).toBe(false);
  });

  it("flags a high-variance rollup (over the floor AND the pct)", () => {
    const m = buildReconciliationModel({
      actuals: [ca("A", "Subcontract", 100000, 100000), ca("B", "Material", 900000, 900000)],
      estimateLines: [el("1", "A", 40000), el("2", "A", 40000)], // estimate 80k, var 20k = 25%
      allocations: [],
      thresholds: { valueShareThreshold: 0.99 }, // not high-value (10% share)
    });
    const a = codeOf(m, "A");
    expect(a.isHighValue).toBe(false);
    expect(a.isHighVariance).toBe(true);
    expect(a.isTargeted).toBe(true);
  });

  it("does not flag high-variance when the absolute variance is under the floor", () => {
    const m = buildReconciliationModel({
      // big % swing (50%) but only $4k absolute — under the $5k floor.
      actuals: [ca("A", "Subcontract", 12000, 12000), ca("B", "Material", 988000, 988000)],
      estimateLines: [el("1", "A", 4000), el("2", "A", 4000)], // estimate 8k, var 4k = 50%
      allocations: [],
      thresholds: { valueShareThreshold: 0.99 },
    });
    expect(codeOf(m, "A").isHighVariance).toBe(false);
  });

  it("only rollups can be targeted (a high-value 1:1 is not)", () => {
    const m = buildReconciliationModel({
      actuals: [ca("A", "Subcontract", 100000, 100000)],
      estimateLines: [el("1", "A", 50000)], // single line → oneToOne
      allocations: [],
      thresholds: { valueShareThreshold: 0.1 },
    });
    const a = codeOf(m, "A");
    expect(a.isHighValue).toBe(true);
    expect(a.isTargeted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Disposition derived from the overlay (recompute-on-load; no frozen mutation)
// ---------------------------------------------------------------------------

describe("buildReconciliationModel — disposition from overlay", () => {
  const actuals = [ca("A", "Subcontract", 10000, 9000)]; // normalized 9000
  const lines = [el("1", "A", 6000), el("2", "A", 3000)];

  it("is pending with no overlay rows", () => {
    const m = buildReconciliationModel({ actuals, estimateLines: lines, allocations: [] });
    const a = codeOf(m, "A");
    expect(a.status).toBe("pending");
    expect(a.allocatedNormalized).toBe(0);
    expect(a.remainingNormalized).toBe(9000);
    expect(a.tiesOut).toBe(false);
  });

  it("is verified when a verify row exists (and copies the frozen numbers)", () => {
    const m = buildReconciliationModel({
      actuals,
      estimateLines: lines,
      allocations: [al("A", ALLOCATION_KIND.VERIFY, 10000, 9000, "1")],
    });
    const a = codeOf(m, "A");
    expect(a.status).toBe("verified");
    expect(a.allocatedNormalized).toBe(9000);
    expect(a.tiesOut).toBe(true);
  });

  it("is allocated and ties out when split rows sum to the normalized actual", () => {
    const m = buildReconciliationModel({
      actuals,
      estimateLines: lines,
      allocations: [
        al("A", ALLOCATION_KIND.ALLOCATION, 6000, 6000, "1"),
        al("A", ALLOCATION_KIND.ALLOCATION, 3000, 3000, "2"),
      ],
    });
    const a = codeOf(m, "A");
    expect(a.status).toBe("allocated");
    expect(a.allocatedNormalized).toBe(9000);
    expect(a.remainingNormalized).toBe(0);
    expect(a.tiesOut).toBe(true);
  });

  it("is allocated but does NOT tie out on a partial split", () => {
    const m = buildReconciliationModel({
      actuals,
      estimateLines: lines,
      allocations: [al("A", ALLOCATION_KIND.ALLOCATION, 6000, 6000, "1")],
    });
    const a = codeOf(m, "A");
    expect(a.status).toBe("allocated");
    expect(a.remainingNormalized).toBe(3000);
    expect(a.tiesOut).toBe(false);
  });

  it("is declined when a declined marker exists (excluded from the sums)", () => {
    const m = buildReconciliationModel({
      actuals,
      estimateLines: lines,
      allocations: [al("A", ALLOCATION_KIND.DECLINED, 0, 0)],
    });
    const a = codeOf(m, "A");
    expect(a.status).toBe("declined");
    expect(a.allocatedNormalized).toBe(0);
    expect(m.counts.declined).toBe(1);
  });

  it("ties out within the cent tolerance", () => {
    const m = buildReconciliationModel({
      actuals,
      estimateLines: lines,
      allocations: [al("A", ALLOCATION_KIND.ALLOCATION, 8999.995, 8999.995, "1")],
    });
    expect(codeOf(m, "A").tiesOut).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Overlay-write builders
// ---------------------------------------------------------------------------

describe("allocation write builders", () => {
  const model = buildReconciliationModel({
    actuals: [ca("A", "Subcontract", 10000, 9000)],
    estimateLines: [el("1", "A", 6000, { description: "Framing" }), el("2", "A", 3000)],
    allocations: [],
  });
  const code = codeOf(model, "A");

  it("buildVerifyAllocation copies the frozen total + normalized onto line 0", () => {
    const w = buildVerifyAllocation("snap-1", code);
    expect(w).toMatchObject({
      snapshotId: "snap-1",
      budgetCode: "A",
      estimateLineItemId: "1",
      kind: ALLOCATION_KIND.VERIFY,
      allocatedTotal: 10000,
      allocatedNormalized: 9000,
    });
  });

  it("buildLineAllocation mirrors the entered amount into both fields", () => {
    const w = buildLineAllocation("snap-1", code, "2", 2500);
    expect(w.kind).toBe(ALLOCATION_KIND.ALLOCATION);
    expect(w.estimateLineItemId).toBe("2");
    expect(w.allocatedTotal).toBe(2500);
    expect(w.allocatedNormalized).toBe(2500);
  });

  it("buildDeclineAllocation is a zero-dollar code-level marker", () => {
    const w = buildDeclineAllocation("snap-1", code);
    expect(w).toMatchObject({
      kind: ALLOCATION_KIND.DECLINED,
      estimateLineItemId: "",
      allocatedTotal: 0,
      allocatedNormalized: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Fixture-grounded: real normalized actuals + synthetic estimate lines
// ---------------------------------------------------------------------------

describe("buildReconciliationModel — grounded on the real exports", () => {
  let result: NormalizedActuals;

  beforeAll(async () => {
    const raw: RawActualsExport = await loadActualsSource().loadRawExport();
    result = computeNormalizedActuals(raw);
  });

  it("buckets real cost codes against a synthetic estimate", () => {
    const model = buildReconciliationModel({
      actuals: result.codeActuals,
      estimateLines: [
        // two lines roll into the Sr Project Manager labor code → rollup
        el("pm-a", "1-10320.000", 150000),
        el("pm-b", "1-10320.000", 150000),
        // one line maps to the permits code → oneToOne
        el("permits", "1-10260.000", 100),
        // a line with no actual code → estimateOnly
        el("ghost", "0-00000.000", 5000),
        // unmapped
        el("blank", "", 250),
      ],
      allocations: [],
    });

    expect(codeOf(model, "1-10320.000").bucket).toBe("rollup");
    expect(codeOf(model, "1-10320.000").estimateTotal).toBe(300000);
    expect(codeOf(model, "1-10260.000").bucket).toBe("oneToOne");
    expect(codeOf(model, "0-00000.000").bucket).toBe("estimateOnly");
    expect(model.unmappedEstimateLineCount).toBe(1);
    // the vast majority of real codes have no synthetic estimate line behind them
    expect(model.counts.unbacked).toBeGreaterThan(10);
  });

  it("the model's grand totals tie to the engine's grand totals", () => {
    const model = buildReconciliationModel({
      actuals: result.codeActuals,
      estimateLines: [],
      allocations: [],
    });
    expect(model.grandTotalActual).toBeCloseTo(result.grandTotalActual, 2);
    expect(model.grandNormalizedActual).toBeCloseTo(result.grandNormalizedActual, 2);
  });
});
