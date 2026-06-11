/**
 * Catalog additions — resolver + catalog-item OVERLAY (Catalog Manager Phase 6).
 * An addition is self-contained: it carries its own procore_code + unit price, so
 * the cost-code resolver overlays the code, the catalog-price resolver overlays
 * the price, and the catalog chokepoint overlays the item — with NO cost_code_map
 * / rate_card widening. A built-in ALWAYS wins a code collision. The price reaches
 * a row ONLY at birth (freeze-at-birth): editing an addition never retro-moves a
 * saved row.
 */
import { describe, it, expect, afterEach } from "vitest";
import type { CatalogAddition } from "@/types/db";
import {
  getCatalogItems,
  primeCatalogAdditions,
  catalogAdditionToItem,
  resetCatalog,
} from "../catalog";
import {
  primeCostCodeResolver,
  primeCostCodeAdditions,
  resolveProcoreCode,
  resetCostCodeResolver,
} from "../costCodeResolver";
import {
  primeRateCard,
  primeCatalogPriceAdditions,
  resolveCatalogPrice,
  resetRateCard,
} from "../rateResolver";
import { ESTIMATE_ITEMS_MASTER } from "../mock-data";

const ADD_CODE = "11-5000.010"; // a novel (non-built-in) catalog code
const PROCORE = "1-10410.000";

function addition(overrides: Partial<CatalogAddition> = {}): CatalogAddition {
  return {
    itemId: ADD_CODE,
    description: "Window Washing Hoist",
    targetUom: "EA",
    defaultUnitPrice: 1200,
    costType: "S",
    procoreCode: PROCORE,
    status: "active",
    source: "catalog_manager",
    ...overrides,
  };
}

/** Prime all three overlays from a list of additions, as the prime sites do. */
function primeAll(adds: CatalogAddition[]): void {
  const items = adds.map(catalogAdditionToItem);
  primeCatalogAdditions(items);
  primeCostCodeAdditions(items);
  primeCatalogPriceAdditions(items);
}

afterEach(() => {
  resetCatalog();
  resetCostCodeResolver();
  resetRateCard();
});

describe("cost-code resolver overlay", () => {
  it("resolves an addition's itemId to its self-contained procore_code", () => {
    primeAll([addition()]);
    expect(resolveProcoreCode(ADD_CODE)).toBe(PROCORE);
  });

  it("a built-in (cost_code_map) ALWAYS wins a code collision", () => {
    primeCostCodeResolver([{ templateName: "T", internalCode: ADD_CODE, procoreCode: "MAP-WINS", source: "manual" }]);
    primeCostCodeAdditions([catalogAdditionToItem(addition({ procoreCode: "ADD-LOSES" }))]);
    expect(resolveProcoreCode(ADD_CODE)).toBe("MAP-WINS");
  });

  it("returns '' for an itemId no map and no addition carries", () => {
    primeAll([addition()]);
    expect(resolveProcoreCode("33-3333.333")).toBe("");
  });
});

describe("catalog-price resolver overlay", () => {
  it("overlays an addition's default_unit_price (ignoring the fallback)", () => {
    primeAll([addition({ defaultUnitPrice: 1200 })]);
    expect(resolveCatalogPrice(ADD_CODE, 0)).toBe(1200);
  });

  it("rate_card (company default) wins a collision over an addition", () => {
    primeRateCard([{ templateName: "T", lineCode: ADD_CODE, rate: 5, source: "manual" }]);
    primeCatalogPriceAdditions([catalogAdditionToItem(addition({ defaultUnitPrice: 1200 }))]);
    expect(resolveCatalogPrice(ADD_CODE, 999)).toBe(5);
  });

  it("preserves a NEGATIVE addition price (a real deduction, not 'no entry')", () => {
    primeAll([addition({ defaultUnitPrice: -2 })]);
    expect(resolveCatalogPrice(ADD_CODE, 999)).toBe(-2);
  });

  it("falls through to the fallback when nothing carries the itemId", () => {
    primeAll([addition()]);
    expect(resolveCatalogPrice("33-3333.333", 77)).toBe(77);
  });
});

describe("catalog-item overlay", () => {
  it("layers the addition into getCatalogItems() as an InternalEstimateItem", () => {
    primeAll([addition()]);
    expect(getCatalogItems()[ADD_CODE]).toEqual({
      itemId: ADD_CODE,
      procoreParentCode: PROCORE,
      procoreCode: PROCORE,
      description: "Window Washing Hoist",
      targetUom: "EA",
      defaultUnitPrice: 1200,
      costType: "S",
    });
  });

  it("a built-in ALWAYS wins a code collision in the catalog overlay", () => {
    const builtInCode = Object.keys(ESTIMATE_ITEMS_MASTER)[0];
    primeAll([addition({ itemId: builtInCode, description: "SHOULD NOT WIN" })]);
    expect(getCatalogItems()[builtInCode]).toBe(ESTIMATE_ITEMS_MASTER[builtInCode]);
  });

  it("an empty additions list is identity (the exact ESTIMATE_ITEMS_MASTER reference)", () => {
    primeAll([]);
    expect(getCatalogItems()).toBe(ESTIMATE_ITEMS_MASTER);
    expect(resolveProcoreCode(ADD_CODE)).toBe("");
    expect(resolveCatalogPrice(ADD_CODE, 42)).toBe(42);
  });
});

describe("freeze-at-birth — an addition's price never retro-moves a saved row", () => {
  it("a born row captures the price at birth; a later edit only changes FUTURE births", () => {
    // 1. Addition priced at 10. A row is "born" — it resolves its unit price ONCE
    //    through the catalog-price overlay and stores it (qty x price).
    primeAll([addition({ defaultUnitPrice: 10 })]);
    const bornUnitPrice = resolveCatalogPrice(ADD_CODE, 0);
    const qty = 5;
    const savedRow = { itemId: ADD_CODE, unitPrice: bornUnitPrice, total: qty * bornUnitPrice };
    expect(savedRow.unitPrice).toBe(10);
    expect(savedRow.total).toBe(50);

    // 2. The estimator edits the addition's default price to 99 (a new prime).
    primeAll([addition({ defaultUnitPrice: 99 })]);

    // 3. The already-saved row is untouched — the resolver is birth-only and never
    //    reaches back into stored rows; its persisted unitPrice/total stand.
    expect(savedRow.unitPrice).toBe(10);
    expect(savedRow.total).toBe(50);

    // 4. Only a NEW birth picks up the edited price.
    const rebornUnitPrice = resolveCatalogPrice(ADD_CODE, 0);
    expect(rebornUnitPrice).toBe(99);
  });
});
