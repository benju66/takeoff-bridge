/**
 * getImportedPriceHistory — db gateway feeding the /rates as-bid price report
 * (Phase 3 Slice 2). READ-only: imported line items (verbatim as-bid prices +
 * Slice-0 UOMs) joined to their project context.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockNeq = vi.fn();
const mockEq = vi.fn(() => ({ neq: mockNeq }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn((..._args: unknown[]) => ({ select: mockSelect }));

vi.mock("../supabase", () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

import { getImportedPriceHistory } from "../db";

beforeEach(() => vi.clearAllMocks());

describe("getImportedPriceHistory", () => {
  it("queries imported, code-bearing line items with their project context", async () => {
    mockNeq.mockResolvedValueOnce({
      data: [
        {
          project_id: "care-1",
          item_id: "09-2900.001",
          unit_price: 4.25,
          uom: "sf", // legacy-saved rows may be lowercase — normalized on read
          projects: { name: "CARE Relocation", bid_date: "2026-04-06", market_sector: "Healthcare" },
        },
        { project_id: "p2", item_id: "22-0000.001", unit_price: "12.50", uom: null, projects: null },
      ],
      error: null,
    });

    const out = await getImportedPriceHistory();

    expect(mockFrom).toHaveBeenCalledWith("estimate_line_items");
    // project_id rides along for the Estimate Versioning supersede rule
    // (getBidPriceHistory drops a project's imported observations once it has
    // a submitted version); the PriceObservation contract is a structural
    // subset of each returned object.
    expect(mockSelect).toHaveBeenCalledWith("project_id, item_id, unit_price, uom, projects(name, bid_date, market_sector)");
    expect(mockEq).toHaveBeenCalledWith("source", "imported");
    expect(mockNeq).toHaveBeenCalledWith("item_id", "");
    expect(out).toEqual([
      {
        projectId: "care-1",
        itemId: "09-2900.001",
        unitPrice: 4.25,
        uom: "SF",
        projectName: "CARE Relocation",
        bidDate: "2026-04-06",
        marketSector: "Healthcare",
      },
      { projectId: "p2", itemId: "22-0000.001", unitPrice: 12.5, uom: "", projectName: "", bidDate: "", marketSector: "" },
    ]);
  });

  it("THROWS on a db error (the /rates report degrades fail-soft at the call site)", async () => {
    mockNeq.mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });
    await expect(getImportedPriceHistory()).rejects.toThrow(
      "Failed to fetch imported price history: permission denied"
    );
  });
});
