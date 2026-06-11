/**
 * primeCatalogAdditionOverlays — the shared 5-site prime helper (Phase 7).
 * One call must prime ALL THREE overlays (catalog item, cost-code, price) so no
 * site can ever prime only some of them and birth a row with a code but no price.
 */
import { describe, it, expect, afterEach } from "vitest";
import type { CatalogAddition } from "@/types/db";
import { primeCatalogAdditionOverlays } from "../catalogAdditionOverlays";
import { getCatalogItems, resetCatalog } from "../catalog";
import { resolveProcoreCode, resetCostCodeResolver } from "../costCodeResolver";
import { resolveCatalogPrice, resetRateCard } from "../rateResolver";

const ADD_CODE = "11-5000.010"; // a novel (non-built-in) catalog code

const addition = (overrides: Partial<CatalogAddition> = {}): CatalogAddition => ({
  itemId: ADD_CODE,
  description: "Window Washing Hoist",
  targetUom: "EA",
  defaultUnitPrice: 1200,
  costType: "S",
  procoreCode: "1-10410.000",
  status: "active",
  source: "catalog_manager",
  ...overrides,
});

afterEach(() => {
  resetCatalog();
  resetCostCodeResolver();
  resetRateCard();
});

describe("primeCatalogAdditionOverlays", () => {
  it("primes the catalog item, the procore code, and the unit price in one call", () => {
    primeCatalogAdditionOverlays([addition()]);
    expect(getCatalogItems()[ADD_CODE]?.description).toBe("Window Washing Hoist");
    expect(resolveProcoreCode(ADD_CODE)).toBe("1-10410.000");
    expect(resolveCatalogPrice(ADD_CODE, 0)).toBe(1200);
  });

  it("an empty list clears every overlay (identity — nothing primed)", () => {
    primeCatalogAdditionOverlays([addition()]);
    primeCatalogAdditionOverlays([]);
    expect(getCatalogItems()[ADD_CODE]).toBeUndefined();
    expect(resolveProcoreCode(ADD_CODE)).toBe("");
    expect(resolveCatalogPrice(ADD_CODE, 42)).toBe(42);
  });
});
