import { describe, it, expect, beforeEach, afterEach } from "vitest";
import ESTIMATE_CATALOG from "../estimate-catalog.json";
import { ESTIMATE_ITEMS_MASTER } from "../mock-data";
import { MASTER_TEMPLATE_NAME } from "../constants";
import {
  primeRateCard,
  resolveCatalogPrice,
  resetRateCard,
} from "../rateResolver";
import type { RateCardEntry } from "@/types/db";

// ---------------------------------------------------------------------------
// Rate-card slice 2, Phase B — DAY-ONE INVARIANT.
//
// The 221 catalog unit prices now flow through the company-default resolver at
// row birth (template init, CSV import, itemId change) instead of being read
// straight off estimate-catalog.json. Because Phase A seeded the card with
// EXACTLY today's catalog values, a row born from the primed card must carry the
// byte-identical price it carried from the raw JSON — including the -2 deduction
// and the 0.001 placeholders. This test primes the card from the catalog itself
// (== the seed) and replays each of the three call-site expressions.
//
// It also pins the safety contract: an unprimed card or a card miss falls back
// to the JSON default, so behavior before prime / for any uncarried line is
// unchanged.
// ---------------------------------------------------------------------------

type CatalogEntry = { itemId: string; defaultUnitPrice: number };
const CATALOG = ESTIMATE_CATALOG as Record<string, CatalogEntry>;

/** Build the primed map exactly as Phase A's seed does: one row per itemId. */
function seedEntries(): RateCardEntry[] {
  return Object.values(CATALOG).map((e) => ({
    templateName: MASTER_TEMPLATE_NAME,
    lineCode: e.itemId,
    rate: e.defaultUnitPrice,
    source: "seed" as const,
  }));
}

describe("Rate-card slice 2 Phase B — catalog price resolves byte-identical at row birth", () => {
  beforeEach(() => {
    primeRateCard(seedEntries());
  });
  afterEach(() => {
    resetRateCard();
  });

  it("template-init: resolved price == raw JSON default for every catalog item", () => {
    const items = Object.values(ESTIMATE_ITEMS_MASTER);
    // 221 harvested + 6 architect-confirmed manual additions (2026-06-10).
    expect(items.length).toBe(227);
    for (const item of items) {
      // mirrors useTakeoffWorkbook.tsx initializeDefaultEstimateRows
      expect(resolveCatalogPrice(item.itemId, item.defaultUnitPrice)).toBe(
        item.defaultUnitPrice
      );
    }
  });

  it("CSV import: resolveCatalogPrice(itemId, default || 0) == default || 0", () => {
    for (const entry of Object.values(CATALOG)) {
      const masterItem = ESTIMATE_ITEMS_MASTER[entry.itemId];
      // mirrors parser.ts: keep the `|| 0` fallback
      const fallback = masterItem?.defaultUnitPrice || 0;
      expect(resolveCatalogPrice(entry.itemId, fallback)).toBe(fallback);
    }
  });

  it("itemId-change: resolved price == targetItem.defaultUnitPrice", () => {
    for (const entry of Object.values(CATALOG)) {
      const targetItem = ESTIMATE_ITEMS_MASTER[entry.itemId];
      // mirrors useCellEditing.ts (primary row + cascade siblings)
      expect(resolveCatalogPrice(entry.itemId, targetItem.defaultUnitPrice)).toBe(
        targetItem.defaultUnitPrice
      );
    }
  });

  it("preserves the negative deduction, 0.001 placeholders, and $0 lines", () => {
    // -2 deduction line must survive unchanged (fallback would also be -2, so
    // pass a wrong fallback to prove the CARD value is what's returned).
    expect(resolveCatalogPrice("03-5413.002", 999)).toBe(-2);

    // a known $0 line resolves to 0, not the fallback
    expect(resolveCatalogPrice("02-4100.002", 999)).toBe(0);

    // all 5 placeholder lines resolve to exactly 0.001
    const placeholders = Object.values(CATALOG).filter(
      (e) => e.defaultUnitPrice === 0.001
    );
    expect(placeholders.length).toBe(5);
    for (const p of placeholders) {
      expect(resolveCatalogPrice(p.itemId, 999)).toBe(0.001);
    }
  });
});

describe("Rate-card slice 2 Phase B — fallback safety (unprimed / card miss)", () => {
  afterEach(() => {
    resetRateCard();
  });

  it("returns the JSON fallback when the card is unprimed (byte-identical before prime)", () => {
    resetRateCard();
    expect(resolveCatalogPrice("03-5413.002", -2)).toBe(-2);
    expect(resolveCatalogPrice("02-4100.002", 0)).toBe(0);
    expect(resolveCatalogPrice("03-3000.001", 575)).toBe(575);
  });

  it("returns the fallback for an itemId the card does not carry", () => {
    primeRateCard(seedEntries());
    expect(resolveCatalogPrice("99-9999.999", 42)).toBe(42);
  });
});
