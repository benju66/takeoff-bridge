/**
 * Catalog additions — db gateway (Catalog Manager Phase 6, STEP 4 runtime
 * overlay). getCatalogAdditions is READ-only overlay fuel (consumers fail-soft).
 * createCatalogAddition is the /catalog Add-code path and must reject every
 * malformed / colliding addition BEFORE the write — an addition may never shadow
 * a built-in catalog code (a built-in always wins the overlay), and its
 * procore_code must be a real Procore destination. updateCatalogAddition edits an
 * addition or marks it landed. None of these moves a dollar on a saved row
 * (freeze-at-birth). Mock shape mirrors customStep23LineDefsDb.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockOrder = vi.fn(); // from().select(COLUMNS).order()       — getCatalogAdditions
const mockMaybeSingle = vi.fn(); // from().select("item_id").eq().maybeSingle() — collision pre-check
const mockSingle = vi.fn(); // insert/update ...select(COLUMNS).single() — write result

const mockSelectEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = vi.fn(() => ({ order: mockOrder, eq: mockSelectEq }));
const mockInsertSelect = vi.fn(() => ({ single: mockSingle }));
const mockInsert = vi.fn((..._a: unknown[]) => ({ select: mockInsertSelect }));
const mockUpdateSelect = vi.fn(() => ({ single: mockSingle }));
const mockUpdateEq = vi.fn(() => ({ select: mockUpdateSelect }));
const mockUpdate = vi.fn((..._a: unknown[]) => ({ eq: mockUpdateEq }));
const mockFrom = vi.fn((..._a: unknown[]) => ({ select: mockSelect, insert: mockInsert, update: mockUpdate }));

vi.mock("../supabase", () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

import { getCatalogAdditions, createCatalogAddition, updateCatalogAddition } from "../db";
import { ESTIMATE_ITEMS_MASTER } from "../mock-data";
import { PROCORE_VALID_CODES } from "../procoreValidCodes";

beforeEach(() => vi.clearAllMocks());

const COLUMNS =
  "item_id, description, target_uom, default_unit_price, cost_type, procore_code, status, source";

// A real valid Procore code and a real BUILT-IN catalog code, so the BLI-list and
// collision validations exercise the production oracles.
const VALID_PROCORE = PROCORE_VALID_CODES[0].code;
const BUILT_IN_CODE = Object.keys(ESTIMATE_ITEMS_MASTER)[0];
const NOVEL_CODE = "99-9999.999"; // guaranteed not a built-in (see catalog.test.ts)

describe("getCatalogAdditions", () => {
  it("queries all additions ordered by item_id and maps the rows", async () => {
    mockOrder.mockResolvedValueOnce({
      data: [
        { item_id: "11-5000.010", description: "Window Washing Hoist", target_uom: "EA", default_unit_price: 1200, cost_type: "S", procore_code: VALID_PROCORE, status: "active", source: "catalog_manager" },
        // negative deduction price; landed status; narrow-projection defaults
        // (status/source absent → 'active'/undefined via the mapper safety net).
        { item_id: "08-9000.005", description: "Glazing Credit", target_uom: "", default_unit_price: -2, cost_type: "M", procore_code: VALID_PROCORE, status: "landed", source: "catalog_manager" },
      ],
      error: null,
    });

    const out = await getCatalogAdditions();

    expect(mockFrom).toHaveBeenCalledWith("catalog_additions");
    expect(mockSelect).toHaveBeenCalledWith(COLUMNS);
    expect(mockOrder).toHaveBeenCalledWith("item_id", { ascending: true });
    expect(out).toEqual([
      { itemId: "11-5000.010", description: "Window Washing Hoist", targetUom: "EA", defaultUnitPrice: 1200, costType: "S", procoreCode: VALID_PROCORE, status: "active", source: "catalog_manager" },
      { itemId: "08-9000.005", description: "Glazing Credit", targetUom: "", defaultUnitPrice: -2, costType: "M", procoreCode: VALID_PROCORE, status: "landed", source: "catalog_manager" },
    ]);
  });

  it("THROWS on a db error (consumers degrade fail-soft at the prime site)", async () => {
    mockOrder.mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });
    await expect(getCatalogAdditions()).rejects.toThrow(
      "Failed to fetch catalog additions: permission denied"
    );
  });
});

describe("createCatalogAddition", () => {
  const valid = {
    itemId: "11-5000.010",
    description: "Window Washing Hoist",
    targetUom: "EA",
    defaultUnitPrice: 1200,
    costType: "S",
    procoreCode: VALID_PROCORE,
  };
  const insertedRow = {
    item_id: "11-5000.010",
    description: "Window Washing Hoist",
    target_uom: "EA",
    default_unit_price: 1200,
    cost_type: "S",
    procore_code: VALID_PROCORE,
    status: "active",
    source: "catalog_manager",
  };

  it("rejects a non-deterministic itemId shape WITHOUT touching the db", async () => {
    for (const itemId of ["11-5000", "1-5000.010", "11-5000.01", "11-5000.0100", "abc", ""]) {
      await expect(createCatalogAddition({ ...valid, itemId })).rejects.toThrow(
        /must be deterministic NN-NNNN\.NNN/
      );
    }
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects an empty description WITHOUT touching the db", async () => {
    await expect(createCatalogAddition({ ...valid, description: "   " })).rejects.toThrow(
      /needs a non-empty description/
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects a cost type outside L/M/S/E WITHOUT touching the db", async () => {
    await expect(createCatalogAddition({ ...valid, costType: "X" })).rejects.toThrow(
      /must be L \(Labor\), M \(Materials\), S \(Subcontract\), or E \(Equipment\)/
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("accepts cost type E — Equipment (reconciliation Phase 1 vocabulary)", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockSingle.mockResolvedValueOnce({
      data: { ...insertedRow, cost_type: "E" },
      error: null,
    });

    const out = await createCatalogAddition({ ...valid, costType: " e " });

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ cost_type: "E" })
    );
    expect(out.costType).toBe("E");
  });

  it("rejects a non-finite unit price WITHOUT touching the db", async () => {
    for (const defaultUnitPrice of [NaN, Infinity, -Infinity]) {
      await expect(createCatalogAddition({ ...valid, defaultUnitPrice })).rejects.toThrow(
        /must be a finite number/
      );
    }
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects a missing / off-list Procore code WITHOUT touching the db", async () => {
    await expect(createCatalogAddition({ ...valid, procoreCode: "   " })).rejects.toThrow(
      /needs a Procore Budget Line Item/
    );
    await expect(createCatalogAddition({ ...valid, procoreCode: "0-00000.000" })).rejects.toThrow(
      /not on the Importer Data Fields list/
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects an itemId that shadows a BUILT-IN catalog code WITHOUT touching the db", async () => {
    await expect(createCatalogAddition({ ...valid, itemId: BUILT_IN_CODE })).rejects.toThrow(
      /already a built-in STEP 4 catalog code/
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects an itemId that duplicates an EXISTING addition (pre-check)", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { item_id: "11-5000.010" }, error: null });

    await expect(createCatalogAddition(valid)).rejects.toThrow("Catalog code 11-5000.010 already exists");
    expect(mockSelectEq).toHaveBeenCalledWith("item_id", "11-5000.010");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("THROWS when the collision pre-check itself fails (never creates blind)", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: { message: "timeout" } });
    await expect(createCatalogAddition(valid)).rejects.toThrow(
      "Failed to check catalog code 11-5000.010 for collisions: timeout"
    );
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("creates a valid addition with NORMALIZED fields and returns the stored row", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockSingle.mockResolvedValueOnce({ data: insertedRow, error: null });

    const out = await createCatalogAddition({
      itemId: " 11-5000.010 ",
      description: "  Window Washing Hoist ",
      targetUom: " ea ",
      defaultUnitPrice: 1200,
      costType: " s ",
      procoreCode: `  ${VALID_PROCORE} `,
    });

    expect(mockInsert).toHaveBeenCalledWith({
      item_id: "11-5000.010",
      description: "Window Washing Hoist",
      target_uom: "EA",
      default_unit_price: 1200,
      cost_type: "S",
      procore_code: VALID_PROCORE,
    });
    expect(mockInsertSelect).toHaveBeenCalledWith(COLUMNS);
    expect(out).toEqual({
      itemId: "11-5000.010",
      description: "Window Washing Hoist",
      targetUom: "EA",
      defaultUnitPrice: 1200,
      costType: "S",
      procoreCode: VALID_PROCORE,
      status: "active",
      source: "catalog_manager",
    });
  });

  it("accepts a NEGATIVE unit price (a legitimate deduction) and defaults UOM/cost type", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockSingle.mockResolvedValueOnce({
      data: { ...insertedRow, item_id: NOVEL_CODE, target_uom: "", default_unit_price: -2, cost_type: "M" },
      error: null,
    });

    const out = await createCatalogAddition({
      itemId: NOVEL_CODE,
      description: "Glazing Credit",
      defaultUnitPrice: -2,
      procoreCode: VALID_PROCORE,
    });

    expect(mockInsert).toHaveBeenCalledWith({
      item_id: NOVEL_CODE,
      description: "Glazing Credit",
      target_uom: "",
      default_unit_price: -2,
      cost_type: "M", // default
      procore_code: VALID_PROCORE,
    });
    expect(out.defaultUnitPrice).toBe(-2);
  });

  it("translates a PK race (23505 after a clean pre-check) into the same 'already exists' error", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: 'duplicate key value violates unique constraint "catalog_additions_pkey"' },
    });

    await expect(createCatalogAddition(valid)).rejects.toThrow("Catalog code 11-5000.010 already exists");
  });

  it("THROWS with the db message on any other insert failure", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockSingle.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "permission denied" } });

    await expect(createCatalogAddition(valid)).rejects.toThrow(
      "Failed to create catalog code 11-5000.010: permission denied"
    );
  });
});

describe("updateCatalogAddition", () => {
  const updatedRow = {
    item_id: "11-5000.010",
    description: "Hoist - exterior glazing",
    target_uom: "DAY",
    default_unit_price: 1500,
    cost_type: "L",
    procore_code: VALID_PROCORE,
    status: "active",
    source: "catalog_manager",
  };

  it("edits the supplied fields (normalized) and returns the mapped row", async () => {
    mockSingle.mockResolvedValueOnce({ data: updatedRow, error: null });

    const out = await updateCatalogAddition({
      itemId: " 11-5000.010 ",
      description: "  Hoist - exterior glazing ",
      targetUom: " day ",
      defaultUnitPrice: 1500,
      costType: " l ",
      procoreCode: ` ${VALID_PROCORE} `,
    });

    expect(mockUpdate).toHaveBeenCalledWith({
      description: "Hoist - exterior glazing",
      target_uom: "DAY",
      default_unit_price: 1500,
      cost_type: "L",
      procore_code: VALID_PROCORE,
    });
    expect(mockUpdateEq).toHaveBeenCalledWith("item_id", "11-5000.010");
    expect(mockUpdateSelect).toHaveBeenCalledWith(COLUMNS);
    expect(out.itemId).toBe("11-5000.010");
    expect(out.defaultUnitPrice).toBe(1500);
  });

  it("marks an addition LANDED (status only)", async () => {
    mockSingle.mockResolvedValueOnce({ data: { ...updatedRow, status: "landed" }, error: null });

    const out = await updateCatalogAddition({ itemId: "11-5000.010", status: "landed" });

    expect(mockUpdate).toHaveBeenCalledWith({ status: "landed" });
    expect(out.status).toBe("landed");
  });

  it("rejects an empty patch WITHOUT touching the db", async () => {
    await expect(updateCatalogAddition({ itemId: "11-5000.010" })).rejects.toThrow(
      /Nothing to update on catalog code 11-5000\.010/
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects an empty description / bad cost type / non-finite price / off-list BLI / bad status WITHOUT touching the db", async () => {
    await expect(updateCatalogAddition({ itemId: "11-5000.010", description: "  " })).rejects.toThrow(/non-empty description/);
    await expect(updateCatalogAddition({ itemId: "11-5000.010", costType: "Z" })).rejects.toThrow(/must be L \(Labor\)/);
    await expect(updateCatalogAddition({ itemId: "11-5000.010", defaultUnitPrice: Infinity })).rejects.toThrow(/finite number/);
    await expect(updateCatalogAddition({ itemId: "11-5000.010", procoreCode: "0-00000.000" })).rejects.toThrow(/not on the Importer Data Fields list/);
    await expect(
      updateCatalogAddition({ itemId: "11-5000.010", status: "bogus" as unknown as "active" })
    ).rejects.toThrow(/must be 'active' or 'landed'/);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("THROWS with the db message when no row is updated", async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: "no rows" } });
    await expect(updateCatalogAddition({ itemId: "11-5000.010", status: "landed" })).rejects.toThrow(
      "Failed to update catalog code 11-5000.010: no rows"
    );
  });
});
