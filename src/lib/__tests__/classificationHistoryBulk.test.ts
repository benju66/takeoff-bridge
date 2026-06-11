/**
 * getClassificationHistoryBulk — one chunked read powering the import review's
 * `history` suggestion tier (Phase 3 Slice 1). READ-only over the append-only
 * classification_history table; callers treat the result as advisory.
 * Fidelity Phase 2: counts TRUSTED observations only — a lump-tagged
 * (`user_lump`) row is filtered at the query and can never rank a suggestion.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Chain: .select(...).in("classification", ...).in("resolved_by", ...) → promise
const mockInResolvedBy = vi.fn();
const mockInClassification = vi.fn((..._args: unknown[]) => ({ in: mockInResolvedBy }));
const mockSelect = vi.fn(() => ({ in: mockInClassification }));
const mockFrom = vi.fn((..._args: unknown[]) => ({ select: mockSelect }));

vi.mock("../supabase", () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

import { getClassificationHistoryBulk } from "../db";
import { RESOLVED_BY, TRUSTED_RESOLVED_BY } from "../resolvedBy";

beforeEach(() => vi.clearAllMocks());

describe("getClassificationHistoryBulk", () => {
  it("groups rows per classification, sorted by count desc then code", async () => {
    mockInResolvedBy.mockResolvedValueOnce({
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
    expect(mockInClassification).toHaveBeenCalledWith("classification", ["Plumbing", "Roofing", "Never Seen"]);
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

  it("EXCLUDES lump-tagged observations at the query — only trusted resolved_by values are counted", async () => {
    mockInResolvedBy.mockResolvedValueOnce({ data: [], error: null });

    await getClassificationHistoryBulk(["Plumbing"]);

    // The query itself carries the allowlist — a `user_lump` row never even
    // reaches the ranking code (record everything, tagged; never suggested).
    expect(mockInResolvedBy).toHaveBeenCalledWith("resolved_by", [...TRUSTED_RESOLVED_BY]);
    const trusted = mockInResolvedBy.mock.calls[0][1] as string[];
    expect(trusted).not.toContain(RESOLVED_BY.USER_LUMP);
    expect(trusted).toEqual(["user", "global", "seed", "ai"]);
  });

  it("dedupes input, drops blanks, and skips the query entirely when nothing remains", async () => {
    mockInResolvedBy.mockResolvedValue({ data: [], error: null });

    await getClassificationHistoryBulk(["A", "A", "  ", ""]);
    expect(mockInClassification).toHaveBeenCalledTimes(1);
    expect(mockInClassification).toHaveBeenCalledWith("classification", ["A"]);

    mockInClassification.mockClear();
    const out = await getClassificationHistoryBulk(["", "  "]);
    expect(out.size).toBe(0);
    expect(mockInClassification).not.toHaveBeenCalled();
  });

  it("chunks big bids into multiple .in() queries and merges the groups", async () => {
    const classifications = Array.from({ length: 150 }, (_, i) => `Line ${i}`);
    mockInResolvedBy
      .mockResolvedValueOnce({ data: [{ classification: "Line 0", resolved_code: "03-0000.001" }], error: null })
      .mockResolvedValueOnce({ data: [{ classification: "Line 149", resolved_code: "09-2900.001" }], error: null });

    const out = await getClassificationHistoryBulk(classifications);

    expect(mockInClassification).toHaveBeenCalledTimes(2); // 100 + 50
    expect(mockInClassification.mock.calls[0][1]).toHaveLength(100);
    expect(mockInClassification.mock.calls[1][1]).toHaveLength(50);
    expect(out.get("Line 0")).toEqual([{ resolvedCode: "03-0000.001", count: 1 }]);
    expect(out.get("Line 149")).toEqual([{ resolvedCode: "09-2900.001", count: 1 }]);
  });

  it("THROWS on a db error (callers degrade fail-soft at the call site)", async () => {
    mockInResolvedBy.mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });
    await expect(getClassificationHistoryBulk(["Plumbing"])).rejects.toThrow(
      "Failed to fetch bulk classification history: permission denied"
    );
  });
});
