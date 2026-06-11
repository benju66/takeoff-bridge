/**
 * getImportedPriceHistory — db gateway feeding the /rates as-bid price report
 * (Phase 3 Slice 2). READ-only: imported line items (verbatim as-bid prices +
 * Slice-0 UOMs) joined to their project context. Fidelity Phase 2: lines
 * marked "combined" (`data_fidelity='macro_lump_sum'`) are excluded at the
 * query — a lump price is not a unit-price observation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Chain: .select(...).eq("source", ...).neq("item_id", ...).neq("data_fidelity", ...) → promise
const mockNeqFidelity = vi.fn();
const mockNeqItemId = vi.fn(() => ({ neq: mockNeqFidelity }));
const mockEq = vi.fn(() => ({ neq: mockNeqItemId }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn((..._args: unknown[]) => ({ select: mockSelect }));

vi.mock("../supabase", () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

import { getImportedPriceHistory } from "../db";

beforeEach(() => vi.clearAllMocks());

describe("getImportedPriceHistory", () => {
  it("queries imported, code-bearing line items with their project context", async () => {
    mockNeqFidelity.mockResolvedValueOnce({
      data: [
        {
          item_id: "09-2900.001",
          unit_price: 4.25,
          uom: "sf", // legacy-saved rows may be lowercase — normalized on read
          projects: { name: "CARE Relocation", bid_date: "2026-04-06", market_sector: "Healthcare" },
        },
        { item_id: "22-0000.001", unit_price: "12.50", uom: null, projects: null },
      ],
      error: null,
    });

    const out = await getImportedPriceHistory();

    expect(mockFrom).toHaveBeenCalledWith("estimate_line_items");
    expect(mockSelect).toHaveBeenCalledWith("item_id, unit_price, uom, projects(name, bid_date, market_sector)");
    expect(mockEq).toHaveBeenCalledWith("source", "imported");
    expect(mockNeqItemId).toHaveBeenCalledWith("item_id", "");
    expect(out).toEqual([
      {
        itemId: "09-2900.001",
        unitPrice: 4.25,
        uom: "SF",
        projectName: "CARE Relocation",
        bidDate: "2026-04-06",
        marketSector: "Healthcare",
      },
      { itemId: "22-0000.001", unitPrice: 12.5, uom: "", projectName: "", bidDate: "", marketSector: "" },
    ]);
  });

  it("EXCLUDES combined-marked lines at the query (fidelity Phase 2) — a lump never enters price history", async () => {
    mockNeqFidelity.mockResolvedValueOnce({ data: [], error: null });

    await getImportedPriceHistory();

    expect(mockNeqFidelity).toHaveBeenCalledWith("data_fidelity", "macro_lump_sum");
  });

  it("THROWS on a db error (the /rates report degrades fail-soft at the call site)", async () => {
    mockNeqFidelity.mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });
    await expect(getImportedPriceHistory()).rejects.toThrow(
      "Failed to fetch imported price history: permission denied"
    );
  });
});
