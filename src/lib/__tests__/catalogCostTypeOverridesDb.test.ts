/**
 * Catalog cost-type overrides — db gateway (Template + Catalog Reconciliation
 * Phase 2 mechanism; Phase 5 /catalog built-in cost-type editor write path).
 *
 * upsertCatalogCostTypeOverride is the ONLY way the /catalog built-in editor
 * persists a type correction. It MUST:
 *  - reject a code that is not a CURRENT BUILT-IN (an override exists only to
 *    relabel a built-in — the inverse of an addition, which carries its own row);
 *  - reject a type outside L/M/S/E (the shared addition guard);
 *  - write through ONE table only — catalog_cost_type_overrides — and NEVER touch
 *    catalog_additions (a built-in edit must never mint an addition row).
 * getCatalogCostTypeOverrides is READ-only overlay fuel (consumers fail-soft).
 * The overlay is LABEL ONLY — costType moves no dollars. Mock shape mirrors
 * catalogAdditionsDb.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockOrder = vi.fn(); // from().select(COLUMNS).order()                 — getCatalogCostTypeOverrides
const mockSingle = vi.fn(); // from().upsert(row,opts).select(COLUMNS).single() — upsert result

const mockSelect = vi.fn(() => ({ order: mockOrder }));
const mockUpsertSelect = vi.fn(() => ({ single: mockSingle }));
const mockUpsert = vi.fn(() => ({ select: mockUpsertSelect }));
// Rest param so the `from(table)` wrapper can forward + record the table name
// for the toHaveBeenCalledWith assertions (the established mock idiom — see
// catalogAdditionsDb.test.ts).
const mockFrom = vi.fn((..._a: unknown[]) => ({ select: mockSelect, upsert: mockUpsert }));

vi.mock("../supabase", () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

import { getCatalogCostTypeOverrides, upsertCatalogCostTypeOverride } from "../db";
import { ESTIMATE_ITEMS_MASTER } from "../mock-data";
import { primeCatalogCostTypeOverrides, getCatalogItems, resetCatalog } from "../catalog";

beforeEach(() => vi.clearAllMocks());
afterEach(() => resetCatalog()); // the overlay is module state — never leak a prime across tests

const COLUMNS = "item_id, cost_type, note";

// A real BUILT-IN catalog code plus a type GUARANTEED different from its harvested
// one, so the round-trip + the overlay flip are observable.
const BUILT_IN_CODE = Object.keys(ESTIMATE_ITEMS_MASTER)[0];
const HARVESTED_TYPE = ESTIMATE_ITEMS_MASTER[BUILT_IN_CODE].costType;
const FLIPPED_TYPE = HARVESTED_TYPE === "E" ? "M" : "E";
const NOVEL_CODE = "99-9999.999"; // guaranteed NOT a built-in (see catalog.test.ts)

describe("getCatalogCostTypeOverrides", () => {
  it("queries all overrides ordered by item_id and maps the rows", async () => {
    mockOrder.mockResolvedValueOnce({
      data: [
        { item_id: "02-0010.001", cost_type: "S", note: "STEP-4 bulk fix" },
        // note absent → the mapper's '' safety net for narrower projections.
        { item_id: "09-2000.005", cost_type: "M", note: null },
      ],
      error: null,
    });

    const out = await getCatalogCostTypeOverrides();

    expect(mockFrom).toHaveBeenCalledWith("catalog_cost_type_overrides");
    expect(mockSelect).toHaveBeenCalledWith(COLUMNS);
    expect(mockOrder).toHaveBeenCalledWith("item_id", { ascending: true });
    expect(out).toEqual([
      { itemId: "02-0010.001", costType: "S", note: "STEP-4 bulk fix" },
      { itemId: "09-2000.005", costType: "M", note: "" },
    ]);
  });

  it("THROWS on a db error (consumers degrade fail-soft at the prime site)", async () => {
    mockOrder.mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });
    await expect(getCatalogCostTypeOverrides()).rejects.toThrow(
      "Failed to fetch catalog cost-type overrides: permission denied"
    );
  });
});

describe("upsertCatalogCostTypeOverride", () => {
  it("persistence round-trip: upserts a built-in's type and returns the stored override", async () => {
    mockSingle.mockResolvedValueOnce({
      data: { item_id: BUILT_IN_CODE, cost_type: FLIPPED_TYPE, note: "" },
      error: null,
    });

    const out = await upsertCatalogCostTypeOverride({ itemId: BUILT_IN_CODE, costType: FLIPPED_TYPE });

    expect(mockFrom).toHaveBeenCalledWith("catalog_cost_type_overrides");
    expect(mockUpsert).toHaveBeenCalledWith(
      { item_id: BUILT_IN_CODE, cost_type: FLIPPED_TYPE },
      { onConflict: "item_id" }
    );
    expect(mockUpsertSelect).toHaveBeenCalledWith(COLUMNS);
    // The round-trip: what the gateway returns is the persisted override, mapped.
    expect(out).toEqual({ itemId: BUILT_IN_CODE, costType: FLIPPED_TYPE, note: "" });
  });

  it("normalizes the cost type (' e ' → 'E') and trims an optional note", async () => {
    mockSingle.mockResolvedValueOnce({
      data: { item_id: BUILT_IN_CODE, cost_type: "E", note: "site equipment" },
      error: null,
    });

    const out = await upsertCatalogCostTypeOverride({ itemId: ` ${BUILT_IN_CODE} `, costType: " e ", note: "  site equipment  " });

    expect(mockUpsert).toHaveBeenCalledWith(
      { item_id: BUILT_IN_CODE, cost_type: "E", note: "site equipment" },
      { onConflict: "item_id" }
    );
    expect(out.costType).toBe("E");
  });

  it("writes ONLY to catalog_cost_type_overrides — a built-in edit never mints an addition row", async () => {
    mockSingle.mockResolvedValueOnce({
      data: { item_id: BUILT_IN_CODE, cost_type: FLIPPED_TYPE, note: "" },
      error: null,
    });

    await upsertCatalogCostTypeOverride({ itemId: BUILT_IN_CODE, costType: FLIPPED_TYPE });

    // The override overlay is the SOLE write target — catalog_additions is never touched.
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith("catalog_cost_type_overrides");
    expect(mockFrom).not.toHaveBeenCalledWith("catalog_additions");
  });

  it("rejects a code that is NOT a built-in WITHOUT touching the db (an addition path is for new codes)", async () => {
    expect(ESTIMATE_ITEMS_MASTER[NOVEL_CODE]).toBeUndefined();
    await expect(upsertCatalogCostTypeOverride({ itemId: NOVEL_CODE, costType: "E" })).rejects.toThrow(
      /is not a built-in STEP 4 catalog code/
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects a cost type outside L/M/S/E WITHOUT touching the db", async () => {
    await expect(upsertCatalogCostTypeOverride({ itemId: BUILT_IN_CODE, costType: "X" })).rejects.toThrow(
      /must be L \(Labor\), M \(Materials\), S \(Subcontract\), or E \(Equipment\)/
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("THROWS with the db message when no row is returned", async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });
    await expect(upsertCatalogCostTypeOverride({ itemId: BUILT_IN_CODE, costType: FLIPPED_TYPE })).rejects.toThrow(
      `Failed to save cost-type override for ${BUILT_IN_CODE}: permission denied`
    );
  });
});

// The "survives a reload" guarantee: a persisted override, re-read on a fresh page
// load (getCatalogCostTypeOverrides) and primed into the chokepoint, makes the
// merged catalog show the corrected type — exactly what /catalog does at mount.
describe("reload survival — DB read → prime → getCatalogItems reflects the corrected type", () => {
  it("a saved override re-read on reload flips the built-in's type at the chokepoint", async () => {
    // Before any prime: the chokepoint IS the harvested master (identity).
    expect(getCatalogItems()[BUILT_IN_CODE].costType).toBe(HARVESTED_TYPE);

    // Simulate the reload fetch returning the persisted override.
    mockOrder.mockResolvedValueOnce({
      data: [{ item_id: BUILT_IN_CODE, cost_type: FLIPPED_TYPE, note: "" }],
      error: null,
    });
    const loaded = await getCatalogCostTypeOverrides();
    primeCatalogCostTypeOverrides(loaded);

    // The corrected type is now live everywhere getCatalogItems() is read.
    expect(getCatalogItems()[BUILT_IN_CODE].costType).toBe(FLIPPED_TYPE);
    // Label only: nothing but the costType changed on the patched item.
    expect(getCatalogItems()[BUILT_IN_CODE]).toEqual({
      ...ESTIMATE_ITEMS_MASTER[BUILT_IN_CODE],
      costType: FLIPPED_TYPE,
    });
  });
});
