import { describe, it, expect, afterEach } from "vitest";
import {
  getCatalogItems,
  primeCatalogAdditions,
  resetCatalog,
  catalogAdditionDriftState,
} from "../catalog";
import { ESTIMATE_ITEMS_MASTER } from "../mock-data";
import type { InternalEstimateItem } from "@/types";
import type { CatalogAddition } from "@/types/db";

const addition = (itemId: string, overrides: Partial<InternalEstimateItem> = {}): InternalEstimateItem => ({
  itemId,
  procoreParentCode: "9-99999.000",
  procoreCode: "9-99999.000",
  description: `Addition ${itemId}`,
  targetUom: "EA",
  defaultUnitPrice: 1,
  costType: "M",
  ...overrides,
});

describe("catalog chokepoint", () => {
  afterEach(() => resetCatalog());

  // The keystone identity contract: with nothing primed the chokepoint IS the
  // built-in master, byte-identical and reference-identical. This is what makes
  // Phase 5 a pure refactor — every migrated consumer reads exactly what it read
  // from ESTIMATE_ITEMS_MASTER before.
  it("returns the exact ESTIMATE_ITEMS_MASTER reference when nothing is primed", () => {
    expect(getCatalogItems()).toBe(ESTIMATE_ITEMS_MASTER);
  });

  it("is byte-identical (deep equal) to ESTIMATE_ITEMS_MASTER with no additions", () => {
    expect(getCatalogItems()).toEqual(ESTIMATE_ITEMS_MASTER);
  });

  it("treats an empty prime list as nothing primed (identity preserved)", () => {
    primeCatalogAdditions([]);
    expect(getCatalogItems()).toBe(ESTIMATE_ITEMS_MASTER);
  });

  it("layers a non-colliding addition on top of the built-ins", () => {
    const novelCode = "99-9999.999";
    expect(ESTIMATE_ITEMS_MASTER[novelCode]).toBeUndefined();
    primeCatalogAdditions([addition(novelCode)]);

    const merged = getCatalogItems();
    expect(merged[novelCode]?.description).toBe(`Addition ${novelCode}`);
    // Every built-in still present and unchanged.
    for (const [code, item] of Object.entries(ESTIMATE_ITEMS_MASTER)) {
      expect(merged[code]).toEqual(item);
    }
    expect(Object.keys(merged).length).toBe(Object.keys(ESTIMATE_ITEMS_MASTER).length + 1);
  });

  it("lets the built-in ALWAYS win a code collision with an addition", () => {
    const existingCode = Object.keys(ESTIMATE_ITEMS_MASTER)[0];
    const builtIn = ESTIMATE_ITEMS_MASTER[existingCode];
    primeCatalogAdditions([addition(existingCode, { description: "SHOULD NOT WIN" })]);

    expect(getCatalogItems()[existingCode]).toEqual(builtIn);
  });

  it("resetCatalog restores the identity contract", () => {
    primeCatalogAdditions([addition("99-9999.999")]);
    expect(getCatalogItems()).not.toBe(ESTIMATE_ITEMS_MASTER);
    resetCatalog();
    expect(getCatalogItems()).toBe(ESTIMATE_ITEMS_MASTER);
  });
});

describe("catalogAdditionDriftState — honest drift oracle (Phase 7)", () => {
  const row = (overrides: Partial<CatalogAddition> = {}): CatalogAddition => ({
    itemId: "99-9999.999", // a novel (non-built-in) code unless overridden
    description: "Window Washing Hoist",
    targetUom: "EA",
    defaultUnitPrice: 1200,
    costType: "S",
    procoreCode: "9-99999.000",
    status: "active",
    source: "catalog_manager",
    ...overrides,
  });

  it("'landed' status is always reconciled (built-in wins; row is audit-only)", () => {
    // Even if its code is NOT yet a built-in, an explicitly-landed row is done.
    expect(catalogAdditionDriftState(row({ status: "landed" }))).toBe("reconciled");
  });

  it("active + NOT a built-in is 'drifted' (owed: add to template + sync-codes)", () => {
    expect(ESTIMATE_ITEMS_MASTER["99-9999.999"]).toBeUndefined();
    expect(catalogAdditionDriftState(row())).toBe("drifted");
  });

  it("active + now a BUILT-IN is 'landed-ready' (offer one-click mark landed)", () => {
    const builtInCode = Object.keys(ESTIMATE_ITEMS_MASTER)[0];
    expect(catalogAdditionDriftState(row({ itemId: builtInCode }))).toBe("landed-ready");
  });

  it("does NOT consult the primed overlay (built-ins only — stable in-session)", () => {
    // Priming the addition into the overlay must not flip a drifted row to ready.
    primeCatalogAdditions([
      {
        itemId: "99-9999.999",
        procoreParentCode: "9-99999.000",
        procoreCode: "9-99999.000",
        description: "Window Washing Hoist",
        targetUom: "EA",
        defaultUnitPrice: 1200,
        costType: "S",
      },
    ]);
    expect(catalogAdditionDriftState(row())).toBe("drifted");
  });
});
