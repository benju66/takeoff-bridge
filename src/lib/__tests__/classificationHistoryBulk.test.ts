/**
 * getClassificationHistoryBulk — one chunked read powering the import review's
 * `history` suggestion tier (Phase 3 Slice 1). READ-only over the append-only
 * classification_history table; callers treat the result as advisory.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockIn = vi.fn();
const mockSelect = vi.fn(() => ({ in: mockIn }));
const mockFrom = vi.fn((..._args: unknown[]) => ({ select: mockSelect }));

vi.mock("../supabase", () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

import { getClassificationHistoryBulk } from "../db";

beforeEach(() => vi.clearAllMocks());

describe("getClassificationHistoryBulk", () => {
  it("groups rows per classification, sorted by count desc then code", async () => {
    mockIn.mockResolvedValueOnce({
      data: [
        { classification: "Plumbing", resolved_code: "22-0000.001" },
        { classification: "Plumbing", resolved_code: "22-0000.001" },
        { classification: "Plumbing", resolved_code: "22-1000.001" },
        // Equal counts → deterministic code order breaks the tie.
        { classification: "Roofing", resolved_code: "07-5000.002" },
        { classification: "Roofing", resolved_code: "07-5000.001" },
      ],
      error: null,
    });

    const out = await getClassificationHistoryBulk(["Plumbing", "Roofing", "Never Seen"]);

    expect(mockFrom).toHaveBeenCalledWith("classification_history");
    expect(mockSelect).toHaveBeenCalledWith("classification, resolved_code");
    expect(mockIn).toHaveBeenCalledWith("classification", ["Plumbing", "Roofing", "Never Seen"]);
    expect(out.get("Plumbing")).toEqual([
      { resolvedCode: "22-0000.001", count: 2 },
      { resolvedCode: "22-1000.001", count: 1 },
    ]);
    expect(out.get("Roofing")).toEqual([
      { resolvedCode: "07-5000.001", count: 1 },
      { resolvedCode: "07-5000.002", count: 1 },
    ]);
    expect(out.has("Never Seen")).toBe(false); // absent, not an empty entry
  });

  it("dedupes input, drops blanks, and skips the query entirely when nothing remains", async () => {
    mockIn.mockResolvedValue({ data: [], error: null });

    await getClassificationHistoryBulk(["A", "A", "  ", ""]);
    expect(mockIn).toHaveBeenCalledTimes(1);
    expect(mockIn).toHaveBeenCalledWith("classification", ["A"]);

    mockIn.mockClear();
    const out = await getClassificationHistoryBulk(["", "  "]);
    expect(out.size).toBe(0);
    expect(mockIn).not.toHaveBeenCalled();
  });

  it("chunks big bids into multiple .in() queries and merges the groups", async () => {
    const classifications = Array.from({ length: 150 }, (_, i) => `Line ${i}`);
    mockIn
      .mockResolvedValueOnce({ data: [{ classification: "Line 0", resolved_code: "03-0000.001" }], error: null })
      .mockResolvedValueOnce({ data: [{ classification: "Line 149", resolved_code: "09-2900.001" }], error: null });

    const out = await getClassificationHistoryBulk(classifications);

    expect(mockIn).toHaveBeenCalledTimes(2); // 100 + 50
    expect(mockIn.mock.calls[0][1]).toHaveLength(100);
    expect(mockIn.mock.calls[1][1]).toHaveLength(50);
    expect(out.get("Line 0")).toEqual([{ resolvedCode: "03-0000.001", count: 1 }]);
    expect(out.get("Line 149")).toEqual([{ resolvedCode: "09-2900.001", count: 1 }]);
  });

  it("THROWS on a db error (callers degrade fail-soft at the call site)", async () => {
    mockIn.mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });
    await expect(getClassificationHistoryBulk(["Plumbing"])).rejects.toThrow(
      "Failed to fetch bulk classification history: permission denied"
    );
  });
});
