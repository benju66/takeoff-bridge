/**
 * getImportedStep23History — db gateway feeding the /rates staff-rate history
 * report (Phase 3 Slice 3). READ-only: stored imported_step23_lines payloads
 * joined to their project context; the protected JSONB is never written.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockNot = vi.fn();
const mockSelect = vi.fn(() => ({ not: mockNot }));
const mockFrom = vi.fn((..._args: unknown[]) => ({ select: mockSelect }));

vi.mock("../supabase", () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

import { getImportedStep23History } from "../db";

beforeEach(() => vi.clearAllMocks());

const payload = {
  step2Lines: [
    { code: "01-0410", description: "Sr Superintendent", utilization: null, qty: 10, rate: 125, total: 1_250, rowNumber: 12, uom: "HR" },
  ],
  step3Lines: [],
  linkedSourceSubtotals: [],
};

describe("getImportedStep23History", () => {
  it("queries non-null payloads with project context and skips malformed JSONB", async () => {
    mockNot.mockResolvedValueOnce({
      data: [
        {
          imported_step23_lines: payload,
          projects: { name: "CARE Relocation", bid_date: "2026-04-03", market_sector: "Healthcare" },
        },
        // Malformed payloads are skipped (advisory report), never thrown over.
        { imported_step23_lines: { bogus: true }, projects: null },
        { imported_step23_lines: [1, 2], projects: null },
        // BOTH line arrays must be present — a half-shaped payload would blow
        // up step23Observations' spread downstream.
        { imported_step23_lines: { step2Lines: [], linkedSourceSubtotals: [] }, projects: null },
      ],
      error: null,
    });

    const out = await getImportedStep23History();

    expect(mockFrom).toHaveBeenCalledWith("project_estimates");
    expect(mockSelect).toHaveBeenCalledWith(
      "imported_step23_lines, projects(name, bid_date, market_sector)"
    );
    expect(mockNot).toHaveBeenCalledWith("imported_step23_lines", "is", null);
    expect(out).toEqual([
      {
        payload,
        projectName: "CARE Relocation",
        bidDate: "2026-04-03",
        marketSector: "Healthcare",
      },
    ]);
  });

  it("THROWS on a db error (the /rates report degrades fail-soft at the call site)", async () => {
    mockNot.mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });
    await expect(getImportedStep23History()).rejects.toThrow(
      "Failed to fetch imported STEP 2/3 history: permission denied"
    );
  });
});
