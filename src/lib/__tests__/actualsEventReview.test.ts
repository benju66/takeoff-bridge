/**
 * Phase 5 change-event review engine: effective-disposition resolution (auto-read
 * passthrough, override re-derivation, the net-zero internal refinement), the
 * delta-based normalized recompute (idempotence, out→kept add-back, kept→out
 * subtract, synthesize-missing-grain, duplicates ignored, Fee/GL/direct split), and
 * the overlay parse/build round-trip. The final suite grounds it on the real
 * `templates/` exports so a re-export shifting codes is caught.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  applyEventClassificationOverrides,
  resolveEffectiveDisposition,
  buildEventOverrideAllocation,
  parseEventOverride,
  collectEventOverrides,
  EVENT_CLASSIFICATION_KIND,
  computeNormalizedActuals,
  FEE_CODE,
  GL_INSURANCE_CODE,
  type EventClassificationOverride,
  type CodeActual,
  type CodeChangeContribution,
  type ActualsCostType,
  type ChangeEventDetailRow,
  type ClassifiedChangeEvent,
  type NormalizationBucket,
  type NormalizedActuals,
  type RawActualsExport,
} from "@/lib/actuals";
import { loadActualsSource } from "./actualsFixtures";

// ---------------------------------------------------------------------------
// Synthetic builders
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
  contributions: CodeChangeContribution[] = [],
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
    normalizedOutContributions: contributions,
  };
}

const ovr = (
  eventId: string,
  scope: EventClassificationOverride["scope"],
  type: EventClassificationOverride["type"],
  reason: EventClassificationOverride["reason"],
): EventClassificationOverride => ({ eventId, scope, type, reason });

const mapOf = (...os: EventClassificationOverride[]) =>
  new Map(os.map((o) => [o.eventId, o]));

const actualOf = (r: { effectiveActuals: CodeActual[] }, budgetCode: string) =>
  r.effectiveActuals.find((a) => a.budgetCode === budgetCode)!;

// ---------------------------------------------------------------------------
// resolveEffectiveDisposition
// ---------------------------------------------------------------------------

describe("resolveEffectiveDisposition", () => {
  const event = { bucket: "original_budget" as NormalizationBucket, isNormalizedOut: false, netLatestCost: 5000 };

  it("passes the frozen auto-read through when there is no override", () => {
    const d = resolveEffectiveDisposition(event, null);
    expect(d).toEqual({ bucket: "original_budget", isNormalizedOut: false, isOverridden: false });
  });

  it("re-derives the bucket from a corrected scope/type/reason (kept → out)", () => {
    const d = resolveEffectiveDisposition(event, ovr("E", "Out of Scope", "Owner Contingency", "Owner Request"));
    expect(d.bucket).toBe("owner_contingency");
    expect(d.isNormalizedOut).toBe(true);
    expect(d.isOverridden).toBe(true);
  });

  it("re-applies the net-zero internal refinement: non-zero internal stays kept", () => {
    const d = resolveEffectiveDisposition(
      { bucket: "original_budget", isNormalizedOut: false, netLatestCost: 9000 },
      ovr("E", "In Scope", "Original Budget", "Internal"),
    );
    expect(d.bucket).toBe("internal_nonzero");
    expect(d.isNormalizedOut).toBe(false);
  });

  it("a genuinely net-zero internal override is normalized out", () => {
    const d = resolveEffectiveDisposition(
      { bucket: "original_budget", isNormalizedOut: false, netLatestCost: 0 },
      ovr("E", "In Scope", "Original Budget", "Internal"),
    );
    expect(d.bucket).toBe("internal_reclass");
    expect(d.isNormalizedOut).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyEventClassificationOverrides — recompute
// ---------------------------------------------------------------------------

describe("applyEventClassificationOverrides — idempotence", () => {
  const actuals = [
    ca("5-50000.000", "Subcontract", 10000, 8000, [
      { eventId: "E1", bucket: "owner_contingency", amount: 2000 },
    ]),
    ca("6-60000.000", "Material", 5000, 5000),
  ];
  const events = [
    ev("E1", { bucket: "owner_contingency", isNormalizedOut: true }, [line("5-50000.000", "Subcontract", 2000)], {
      scope: "Out of Scope",
      type: "Owner Contingency",
    }),
  ];

  it("with no overrides, effective numbers equal the frozen numbers to the cent", () => {
    const r = applyEventClassificationOverrides({ actuals, events, overrides: new Map() });
    expect(r.overrideCount).toBe(0);
    expect(r.normalizedDelta).toBe(0);
    expect(r.grandNormalizedActual).toBe(r.baseGrandNormalizedActual);
    expect(r.grandNormalizedActual).toBe(13000);
    expect(r.grandTotalActual).toBe(15000);
    expect(actualOf(r, "5-50000.000.Subcontract").normalizedActual).toBe(8000);
  });

  it("does not mutate the input actuals (frozen rows untouched)", () => {
    applyEventClassificationOverrides({ actuals, events, overrides: new Map() });
    expect(actuals[0].normalizedActual).toBe(8000);
    expect(actuals[0].normalizedOutContributions).toHaveLength(1);
  });
});

describe("applyEventClassificationOverrides — out → kept add-back", () => {
  const actuals = [
    ca("5-50000.000", "Subcontract", 10000, 8000, [
      { eventId: "E1", bucket: "owner_contingency", amount: 2000 },
    ]),
  ];
  const events = [
    ev("E1", { bucket: "owner_contingency", isNormalizedOut: true }, [line("5-50000.000", "Subcontract", 2000)]),
  ];

  it("adds the contribution back when an out event is corrected to in-scope", () => {
    const r = applyEventClassificationOverrides({
      actuals,
      events,
      overrides: mapOf(ovr("E1", "In Scope", "Original Budget", "FP Construction")),
    });
    expect(r.overrideCount).toBe(1);
    expect(actualOf(r, "5-50000.000.Subcontract").normalizedActual).toBe(10000);
    expect(r.normalizedDelta).toBe(2000);
    expect(r.grandNormalizedActual).toBe(10000);
    // the ledger entry for E1 is dropped now that it is kept.
    expect(actualOf(r, "5-50000.000.Subcontract").normalizedOutContributions).toHaveLength(0);
  });
});

describe("applyEventClassificationOverrides — kept → out subtract", () => {
  const actuals = [
    ca("5-50000.000", "Subcontract", 10000, 10000), // E2 was kept → nothing subtracted
  ];
  const events = [
    ev("E2", { bucket: "original_budget", isNormalizedOut: false }, [line("5-50000.000", "Subcontract", 1500)]),
  ];

  it("subtracts the contribution when a kept event is corrected to out-of-scope", () => {
    const r = applyEventClassificationOverrides({
      actuals,
      events,
      overrides: mapOf(ovr("E2", "Out of Scope", "Owner Contingency", "Owner Request")),
    });
    expect(actualOf(r, "5-50000.000.Subcontract").normalizedActual).toBe(8500);
    expect(r.normalizedDelta).toBe(-1500);
    const led = actualOf(r, "5-50000.000.Subcontract").normalizedOutContributions;
    expect(led).toHaveLength(1);
    expect(led[0]).toMatchObject({ eventId: "E2", amount: 1500 });
  });
});

describe("applyEventClassificationOverrides — synthesize missing grain", () => {
  const actuals = [ca("5-50000.000", "Subcontract", 10000, 10000)];
  // E3 is kept and lands on a code with NO budget row.
  const events = [
    ev("E3", { bucket: "original_budget", isNormalizedOut: false }, [line("9-90000.000", "Material", 700)]),
  ];

  it("synthesizes a zero-total code so the kept→out dollars are never dropped", () => {
    const r = applyEventClassificationOverrides({
      actuals,
      events,
      overrides: mapOf(ovr("E3", "Out of Scope", "Owner Contingency", "Owner Request")),
    });
    const synth = actualOf(r, "9-90000.000.Material");
    expect(synth.totalActual).toBe(0);
    expect(synth.normalizedActual).toBe(-700);
    expect(r.normalizedDelta).toBe(-700);
    expect(r.grandTotalActual).toBe(10000); // total unaffected
  });
});

describe("applyEventClassificationOverrides — duplicates & no-op overrides", () => {
  const actuals = [ca("5-50000.000", "Subcontract", 10000, 10000)];

  it("ignores a duplicate event even when overridden", () => {
    const events = [
      ev("E4", { bucket: "original_budget", isNormalizedOut: false }, [line("5-50000.000", "Subcontract", 1000)], {
        isDuplicate: true,
        duplicateOf: "E1",
      }),
    ];
    const r = applyEventClassificationOverrides({
      actuals,
      events,
      overrides: mapOf(ovr("E4", "Out of Scope", "Owner Contingency", "Owner Request")),
    });
    expect(r.normalizedDelta).toBe(0);
    expect(actualOf(r, "5-50000.000.Subcontract").normalizedActual).toBe(10000);
  });

  it("an override that does not change the disposition moves nothing", () => {
    const events = [
      ev("E5", { bucket: "original_budget", isNormalizedOut: false }, [line("5-50000.000", "Subcontract", 1000)]),
    ];
    const r = applyEventClassificationOverrides({
      actuals,
      events,
      overrides: mapOf(ovr("E5", "In Scope", "Original Budget", "FP Construction")),
    });
    expect(r.overrideCount).toBe(1);
    expect(r.normalizedDelta).toBe(0);
  });
});

describe("applyEventClassificationOverrides — Fee/GL/direct split", () => {
  it("splits burden out and reports the Fee and GL codes separately", () => {
    const actuals = [
      ca("5-50000.000", "Subcontract", 10000, 10000),
      ca(FEE_CODE, "Other", 1200, 1200, [], { isBurden: true }),
      ca(GL_INSURANCE_CODE, "Other", 800, 800, [], { isBurden: true }),
    ];
    const r = applyEventClassificationOverrides({ actuals, events: [], overrides: new Map() });
    expect(r.grandTotalActual).toBe(12000);
    expect(r.burdenTotalActual).toBe(2000);
    expect(r.directTotalActual).toBe(10000);
    expect(r.feeTotalActual).toBe(1200);
    expect(r.glTotalActual).toBe(800);
  });
});

// ---------------------------------------------------------------------------
// Overlay parse / build round-trip
// ---------------------------------------------------------------------------

describe("event-override overlay round-trip", () => {
  it("builds an event-level zero-dollar overlay write", () => {
    const w = buildEventOverrideAllocation("snap-1", ovr("97", "Out of Scope", "Owner Contingency", "Owner Request"));
    expect(w).toMatchObject({
      snapshotId: "snap-1",
      budgetCode: "",
      estimateLineItemId: "",
      kind: EVENT_CLASSIFICATION_KIND,
      allocatedTotal: 0,
      allocatedNormalized: 0,
    });
    expect(w.detail).toMatchObject({ eventId: "97", scope: "Out of Scope", type: "Owner Contingency", reason: "Owner Request" });
  });

  it("parses an overlay row back to the override (re-canonicalizing)", () => {
    const w = buildEventOverrideAllocation("snap-1", ovr("97", "In Scope", "FP Contingency/Buyout", "FP Construction"));
    const parsed = parseEventOverride({ kind: w.kind, detail: w.detail });
    expect(parsed).toEqual({ eventId: "97", scope: "In Scope", type: "FP Contingency/Buyout", reason: "FP Construction", note: undefined });
  });

  it("ignores rows that are not event-classification overrides", () => {
    expect(parseEventOverride({ kind: "verify", detail: { eventId: "97" } })).toBeNull();
    expect(parseEventOverride({ kind: EVENT_CLASSIFICATION_KIND, detail: {} })).toBeNull();
  });

  it("collectEventOverrides keys by eventId, latest write wins", () => {
    const a = buildEventOverrideAllocation("s", ovr("97", "In Scope", "Original Budget", "FP Construction"));
    const b = buildEventOverrideAllocation("s", ovr("97", "Out of Scope", "Owner Contingency", "Owner Request"));
    const map = collectEventOverrides([
      { kind: a.kind, detail: a.detail },
      { kind: "verify", detail: {} },
      { kind: b.kind, detail: b.detail },
    ]);
    expect(map.size).toBe(1);
    expect(map.get("97")!.scope).toBe("Out of Scope");
  });
});

// ---------------------------------------------------------------------------
// Fixture-grounded: real normalized actuals + an override + a revert
// ---------------------------------------------------------------------------

describe("applyEventClassificationOverrides — grounded on the real exports", () => {
  let result: NormalizedActuals;

  beforeAll(async () => {
    const raw: RawActualsExport = await loadActualsSource().loadRawExport();
    result = computeNormalizedActuals(raw);
  });

  it("no overrides reproduces the engine's grand totals to the cent", () => {
    const r = applyEventClassificationOverrides({
      actuals: result.codeActuals,
      events: result.events,
      overrides: new Map(),
    });
    expect(r.grandTotalActual).toBeCloseTo(result.grandTotalActual, 2);
    expect(r.grandNormalizedActual).toBeCloseTo(result.grandNormalizedActual, 2);
    expect(r.baseGrandNormalizedActual).toBeCloseTo(result.grandNormalizedActual, 2);
    expect(r.normalizedDelta).toBeCloseTo(0, 2);
    expect(r.burdenTotalActual).toBeCloseTo(result.burdenTotalActual, 2);
    expect(r.directTotalActual).toBeCloseTo(result.directTotalActual, 2);
    expect(r.feeTotalActual + r.glTotalActual).toBeCloseTo(result.burdenTotalActual, 2);
  });

  it("correcting a real normalized-out event to in-scope shifts the grand normalized by exactly what was stripped, and reverting restores it", () => {
    // Independent expected per event: everything the engine stripped from the
    // ledger. Pick a real OUT event whose net stripped dollars are non-zero —
    // i.e. NOT a net-zero internal reclass (whose +/- lines cancel to ~$0).
    const strippedOf = (eventId: string) =>
      result.codeActuals.reduce(
        (s, a) => s + a.normalizedOutContributions.filter((c) => c.eventId === eventId).reduce((t, c) => t + c.amount, 0),
        0,
      );
    const candidate = result.events
      .filter((e) => e.isNormalizedOut && !e.isDuplicate)
      .map((e) => ({ e, stripped: strippedOf(e.eventId) }))
      .find((x) => Math.abs(x.stripped) > 1);
    expect(candidate, "fixtures should contain a net-non-zero normalized-out event").toBeDefined();
    const { eventId } = candidate!.e;
    const stripped = candidate!.stripped;
    expect(Math.abs(stripped)).toBeGreaterThan(0);

    const r = applyEventClassificationOverrides({
      actuals: result.codeActuals,
      events: result.events,
      overrides: mapOf(ovr(eventId, "In Scope", "Original Budget", "FP Construction")),
    });
    // Adding it back raises the normalized by the stripped amount.
    expect(r.normalizedDelta).toBeCloseTo(stripped, 2);
    expect(r.grandNormalizedActual).toBeCloseTo(result.grandNormalizedActual + stripped, 2);

    // Reverting (empty overrides) returns to the engine baseline.
    const reverted = applyEventClassificationOverrides({
      actuals: result.codeActuals,
      events: result.events,
      overrides: new Map(),
    });
    expect(reverted.grandNormalizedActual).toBeCloseTo(result.grandNormalizedActual, 2);
  });
});
