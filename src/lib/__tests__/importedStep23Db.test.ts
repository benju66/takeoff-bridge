/**
 * saveImportedStep23Lines — db gateway for the imported_step23_lines column
 * (architect-approved 2026-06-10). Written ONCE at import; THROWS on failure
 * (imported-data fidelity the user can see — not fire-and-forget) and on a
 * missing estimate row (the import flow saves the estimate first).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSelect = vi.fn();
const mockEq = vi.fn(() => ({ select: mockSelect }));
const mockUpdate = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn((..._args: unknown[]) => ({ update: mockUpdate }));

vi.mock("../supabase", () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

import { saveImportedStep23Lines } from "../db";
import type { ImportedStep23Lines } from "@/types/db";

const PAYLOAD: ImportedStep23Lines = {
  // uom (Phase 3 Slice 0) rides the JSONB verbatim; older payloads lack it.
  step2Lines: [{ code: "01-0410", description: "Sr Superintendent", utilization: null, qty: 10, rate: 1_000, total: 10_000, rowNumber: 3, uom: "HR" }],
  step3Lines: [],
  linkedSourceSubtotals: [{ itemId: "01-0400.002", total: 12_000 }],
};

beforeEach(() => vi.clearAllMocks());

describe("saveImportedStep23Lines", () => {
  it("updates the estimate row's imported_step23_lines by project_id", async () => {
    mockSelect.mockResolvedValueOnce({ data: [{ project_id: "p1" }], error: null });
    await saveImportedStep23Lines("p1", PAYLOAD);

    expect(mockFrom).toHaveBeenCalledWith("project_estimates");
    expect(mockUpdate).toHaveBeenCalledWith({ imported_step23_lines: PAYLOAD });
    expect(mockEq).toHaveBeenCalledWith("project_id", "p1");
  });

  it("THROWS on a db error (fidelity must persist, not vanish quietly)", async () => {
    mockSelect.mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });
    await expect(saveImportedStep23Lines("p1", PAYLOAD)).rejects.toThrow(
      "Failed to save imported STEP 2/3 lines: permission denied"
    );
  });

  it("THROWS when no estimate row exists for the project", async () => {
    mockSelect.mockResolvedValueOnce({ data: [], error: null });
    await expect(saveImportedStep23Lines("ghost", PAYLOAD)).rejects.toThrow(
      "no estimate row for project ghost"
    );
  });
});
