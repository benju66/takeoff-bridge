import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  primeRateCard,
  resolveCompanyRate,
  resetRateCard,
  snapshotRateCard,
} from "../rateResolver";
import type { RateCardEntry } from "@/types/db";

const entry = (
  lineCode: string,
  rate: number,
  source: RateCardEntry["source"] = "seed"
): RateCardEntry => ({
  templateName: "Company_Estimate_Template.xlsx",
  lineCode,
  rate,
  source,
});

describe("Rate-card slice 1 — resolveCompanyRate chokepoint", () => {
  beforeEach(() => {
    resetRateCard();
  });

  afterEach(() => {
    resetRateCard();
  });

  it("returns the fallback when unprimed — keeps calc byte-identical pre-prime", () => {
    expect(resolveCompanyRate("01-0310.001", 175)).toBe(175);
  });

  it("resolves the card rate when primed (the card wins over the fallback)", () => {
    // Diverge from the constants default to prove the card is consulted —
    // the exact post-/rates-editor-edit scenario.
    primeRateCard([entry("01-0310.001", 200, "manual")]);
    expect(resolveCompanyRate("01-0310.001", 175)).toBe(200);
  });

  it("returns the fallback on a miss even when primed", () => {
    primeRateCard([entry("01-0310.001", 175)]);
    expect(resolveCompanyRate("99-9999.999", 42)).toBe(42);
  });

  it("resolves a 0 card rate as 0, not the fallback (?? guards null/undefined only)", () => {
    primeRateCard([entry("01-0310.001", 0, "manual")]);
    expect(resolveCompanyRate("01-0310.001", 175)).toBe(0);
  });

  it("re-priming replaces the previous card (visibility / post-save re-prime path)", () => {
    primeRateCard([entry("01-0310.001", 175)]);
    expect(resolveCompanyRate("01-0310.001", 175)).toBe(175);

    primeRateCard([entry("01-0310.001", 250, "manual")]);
    expect(resolveCompanyRate("01-0310.001", 175)).toBe(250);
  });

  it("reset clears the cache back to unprimed (returns to fallback)", () => {
    primeRateCard([entry("01-0310.001", 250, "manual")]);
    resetRateCard();
    expect(resolveCompanyRate("01-0310.001", 175)).toBe(175);
  });
});

describe("Rate-card slice 1 — snapshotRateCard (freeze-at-first-save, Phase B)", () => {
  beforeEach(() => resetRateCard());
  afterEach(() => resetRateCard());

  it("returns null when the card is unprimed", () => {
    expect(snapshotRateCard()).toBeNull();
  });

  it("returns a plain record of the primed card", () => {
    primeRateCard([entry("01-0310.001", 175), entry("01-0320.001", 135)]);
    expect(snapshotRateCard()).toEqual({ "01-0310.001": 175, "01-0320.001": 135 });
  });

  it("returns a COPY immune to a later re-prime (the frozen snapshot)", () => {
    primeRateCard([entry("01-0310.001", 175)]);
    const frozen = snapshotRateCard();
    // Admin edits the card afterwards (Phase C) and the workspace re-primes.
    primeRateCard([entry("01-0310.001", 999, "manual")]);
    expect(frozen).toEqual({ "01-0310.001": 175 });
  });
});
