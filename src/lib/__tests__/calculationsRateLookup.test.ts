import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { computePersonnelCosts, computeSiteOperations, RateLookup } from "../calculations";
import { primeRateCard, resolveCompanyRate, resetRateCard } from "../rateResolver";
import {
  STAFF_ROLE_DEFAULTS,
  OPERATIONAL_EXPENSE_DEFAULTS,
  GC_MANUAL_DEFAULTS,
  SITE_OPS_DYNAMIC_DEFAULTS,
  SITE_OPS_MANUAL_DEFAULTS,
} from "../constants";
import type { RateCardEntry } from "@/types/db";

// ---------------------------------------------------------------------------
// Rate-card slice 1, Phase B — calc wire-in invariants.
//
// 1. DAY-ONE INVARIANT: the seeded card == constants, so a card-primed,
//    layered-lookup calc must equal the constants-only (default-param) calc
//    byte-for-byte. This is what keeps every existing total and the export
//    reconciliation gate green when the card goes live.
// 2. SNAPSHOT LIFECYCLE: a frozen project snapshot wins over the live card, so
//    a later /rates edit never moves a saved estimate; a NEW project (empty
//    snapshot) does pick the edit up; a per-project staff rateOverride still
//    wins on top of everything.
// ---------------------------------------------------------------------------

const TEMPLATE = "Company_Estimate_Template.xlsx";

/** The seeded company card (== today's constants), as primeRateCard expects. */
function seededCardEntries(): RateCardEntry[] {
  const candidates: { code: string; rate: number | null }[] = [
    ...STAFF_ROLE_DEFAULTS.map((r) => ({ code: r.code, rate: r.defaultRate })),
    ...OPERATIONAL_EXPENSE_DEFAULTS.map((r) => ({ code: r.code, rate: r.rate })),
    ...GC_MANUAL_DEFAULTS.map((r) => ({ code: r.code, rate: r.rate })),
    ...SITE_OPS_DYNAMIC_DEFAULTS.map((r) => ({ code: r.code, rate: r.rate })),
    ...SITE_OPS_MANUAL_DEFAULTS.map((r) => ({ code: r.code, rate: r.rate })),
  ];
  return candidates
    .filter((c): c is { code: string; rate: number } => typeof c.rate === "number" && Number.isFinite(c.rate) && c.rate >= 0)
    .map((c) => ({ templateName: TEMPLATE, lineCode: c.code, rate: c.rate, source: "seed" as const }));
}

const seededCardRecord = (): Record<string, number> =>
  Object.fromEntries(seededCardEntries().map((e) => [e.lineCode, e.rate]));

/** Re-prime the card with one line's rate overridden (the Phase C /rates edit). */
function cardWithEdit(code: string, rate: number): void {
  primeRateCard([
    ...seededCardEntries().filter((e) => e.lineCode !== code),
    { templateName: TEMPLATE, lineCode: code, rate, source: "manual" },
  ]);
}

/** Mirrors the calc hooks' layered lookup composition exactly. */
const layered = (snapshot: Record<string, number>): RateLookup =>
  (code, fallback) => snapshot[code] ?? resolveCompanyRate(code, fallback);

// Representative non-trivial inputs exercising every rate-bearing line kind.
const gc = (rateOverrides?: Record<string, number>, rateLookup?: RateLookup) =>
  computePersonnelCosts(
    10,
    30000,
    { ex: 100, su: 50, pm: 25, srSu: 40 },
    { dumpsters: 1000, toilets: 500, electric: 750 },
    { tempOfficeSetup: 2, projectSigns: 3, legalFees: 1, designArch: 5000 },
    rateOverrides,
    rateLookup,
  );

const siteOps = (rateLookup?: RateLookup) =>
  computeSiteOperations(
    10,
    30000,
    { payrollCleaning: 100, hiredCleaning: 50, demolition: 1000, knox: 2, equipmentRental: 3, soilBorings: 5, abatement: 7500 },
    { soilBorings: 250 },
    rateLookup,
  );

describe("Rate-card Phase B — day-one invariant (card-primed calc == constants-only calc)", () => {
  beforeEach(() => primeRateCard(seededCardEntries()));
  afterEach(() => resetRateCard());

  it("computePersonnelCosts is byte-identical with the seeded card vs the default lookup", () => {
    expect(gc(undefined, layered({}))).toEqual(gc());
  });

  it("computeSiteOperations is byte-identical with the seeded card vs the default lookup", () => {
    expect(siteOps(layered({}))).toEqual(siteOps());
  });
});

describe("Rate-card Phase B — snapshot lifecycle (freeze + override precedence)", () => {
  afterEach(() => resetRateCard());

  const EX_CODE = "01-0310.001"; // Project Executive, constants default 175
  const exQty = 10 * 173.2 * 1.0; // duration × hours/mo × 100% util

  it("a frozen snapshot pins the rate even after the live card is edited", () => {
    const frozen = seededCardRecord(); // project froze at the seeded card
    cardWithEdit(EX_CODE, 999);        // admin later edits the live card (Phase C)

    const ex = gc(undefined, layered(frozen)).staffLines.find((l) => l.code === EX_CODE)!;
    expect(ex.rate).toBe(175); // still the FROZEN value — immune to the edit
    expect(ex.total).toBeCloseTo(exQty * 175);
  });

  it("a NEW project (empty snapshot) picks up the edited live card", () => {
    cardWithEdit(EX_CODE, 999);

    const ex = gc(undefined, layered({})).staffLines.find((l) => l.code === EX_CODE)!;
    expect(ex.rate).toBe(999);
    expect(ex.total).toBeCloseTo(exQty * 999);
  });

  it("a per-project staff rateOverride still wins over snapshot and card", () => {
    const frozen = seededCardRecord();
    cardWithEdit(EX_CODE, 999);

    // rateOverrides keyed by role.key ("ex") — the Phase 6B top layer.
    const ex = gc({ ex: 300 }, layered(frozen)).staffLines.find((l) => l.code === EX_CODE)!;
    expect(ex.rate).toBe(300);
    expect(ex.total).toBeCloseTo(exQty * 300);
  });
});
