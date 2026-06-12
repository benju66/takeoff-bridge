/**
 * getClassificationHistoryBulk — one chunked read powering the import review's
 * `history` suggestion tier (Phase 3 Slice 1). READ-only over the append-only
 * classification_history table; callers treat the result as advisory.
 * Fidelity Phase 2: a lump-tagged (`user_lump`) row is filtered at the query
 * and can never rank a suggestion. Fidelity Phase 5: the query allowlist
 * widens to RANKING_RESOLVED_BY (trusted base + `suggestion_rejected`
 * downweight signals — accepted/overridden stay excluded, each is paired with
 * a clean `user` row), and scoring is delegated to the pure
 * suggestionRanking.ts (covered exhaustively in suggestionRanking.test.ts —
 * here we prove the wiring: columns fetched, allowlist applied, lifecycle
 * defs passed through, pagination past the response cap, output shape
 * preserved).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Chain: .select(...).in("classification", ...).in("resolved_by", ...)
//        .order("created_at").order("id").range(from, to) → promise
const mockRange = vi.fn();
const mockOrderId = vi.fn((..._args: unknown[]) => ({ range: mockRange }));
const mockOrderCreated = vi.fn((..._args: unknown[]) => ({ order: mockOrderId }));
const mockInResolvedBy = vi.fn((..._args: unknown[]) => ({ order: mockOrderCreated }));
const mockInClassification = vi.fn((..._args: unknown[]) => ({ in: mockInResolvedBy }));
const mockSelect = vi.fn(() => ({ in: mockInClassification }));
const mockFrom = vi.fn((..._args: unknown[]) => ({ select: mockSelect }));

vi.mock("../supabase", () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

import { getClassificationHistoryBulk } from "../db";
import { RESOLVED_BY, RANKING_RESOLVED_BY } from "../resolvedBy";

beforeEach(() => vi.clearAllMocks());

describe("getClassificationHistoryBulk", () => {
  it("groups rows per classification, sorted by count desc then code", async () => {
    mockRange.mockResolvedValueOnce({
      data: [
        { classification: "Plumbing", resolved_code: "22-0000.001", resolved_by: "user", project_id: "p1" },
        { classification: "Plumbing", resolved_code: "22-0000.001", resolved_by: "user", project_id: "p2" },
        { classification: "Plumbing", resolved_code: "22-1000.001", resolved_by: "user", project_id: "p3" },
        // Equal counts → deterministic code order breaks the tie.
        { classification: "Roofing", resolved_code: "07-5000.002", resolved_by: "user", project_id: "p1" },
        { classification: "Roofing", resolved_code: "07-5000.001", resolved_by: "user", project_id: "p2" },
      ],
      error: null,
    });

    const out = await getClassificationHistoryBulk(["Plumbing", "Roofing", "Never Seen"]);

    expect(mockFrom).toHaveBeenCalledWith("classification_history");
    // Phase 5 fetches the signal columns the ranking needs.
    expect(mockSelect).toHaveBeenCalledWith(
      "classification, resolved_code, resolved_by, project_id, created_at"
    );
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

  it("queries the RANKING allowlist: trusted base + rejection signals, nothing else", async () => {
    mockRange.mockResolvedValueOnce({ data: [], error: null });

    await getClassificationHistoryBulk(["Plumbing"]);

    // The query itself carries the allowlist — a `user_lump` pairing or an
    // accepted/overridden signal row never even reaches the ranking code
    // (record everything, tagged; accepted/overridden are each PAIRED with a
    // clean `user` row, so counting them would double-count).
    expect(mockInResolvedBy).toHaveBeenCalledWith("resolved_by", [...RANKING_RESOLVED_BY]);
    const fetched = mockInResolvedBy.mock.calls[0][1] as string[];
    expect(fetched).toEqual(["user", "global", "seed", "ai", "suggestion_rejected"]);
    expect(fetched).not.toContain(RESOLVED_BY.USER_LUMP);
    expect(fetched).not.toContain(RESOLVED_BY.SUGGESTION_ACCEPTED);
    expect(fetched).not.toContain(RESOLVED_BY.SUGGESTION_OVERRIDDEN);
  });

  it("downweights rejected pairings into a new order while badges keep honest counts", async () => {
    mockRange.mockResolvedValueOnce({
      data: [
        { classification: "Mystery", resolved_code: "09-2900.001", resolved_by: "user", project_id: "p1" },
        { classification: "Mystery", resolved_code: "09-2900.001", resolved_by: "user", project_id: "p2" },
        { classification: "Mystery", resolved_code: "09-2900.001", resolved_by: "suggestion_rejected", project_id: "p3" },
        { classification: "Mystery", resolved_code: "09-2900.001", resolved_by: "suggestion_rejected", project_id: "p4" },
        { classification: "Mystery", resolved_code: "09-2900.001", resolved_by: "suggestion_rejected", project_id: "p5" },
        { classification: "Mystery", resolved_code: "09-5100.001", resolved_by: "user", project_id: "p3" },
      ],
      error: null,
    });

    const out = await getClassificationHistoryBulk(["Mystery"]);
    expect(out.get("Mystery")).toEqual([
      { resolvedCode: "09-5100.001", count: 1 },
      { resolvedCode: "09-2900.001", count: 2 },
    ]);
  });

  it("passes lifecycle defs through: merged codes refile, retired codes drop", async () => {
    mockRange.mockResolvedValueOnce({
      data: [
        { classification: "Site Lead", resolved_code: "01-0410.900", resolved_by: "user", project_id: "p1" },
        { classification: "Site Lead", resolved_code: "01-0410.001", resolved_by: "user", project_id: "p2" },
        { classification: "Site Lead", resolved_code: "01-0410.901", resolved_by: "user", project_id: "p3" },
      ],
      error: null,
    });

    const out = await getClassificationHistoryBulk(
      ["Site Lead"],
      [
        { code: "01-0410.900", status: "merged", mergedInto: "01-0410.001" },
        { code: "01-0410.001" },
        { code: "01-0410.901", status: "retired" },
      ]
    );
    expect(out.get("Site Lead")).toEqual([{ resolvedCode: "01-0410.001", count: 2 }]);
  });

  it("dedupes input, drops blanks, and skips the query entirely when nothing remains", async () => {
    mockRange.mockResolvedValue({ data: [], error: null });

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
    mockRange
      .mockResolvedValueOnce({
        data: [{ classification: "Line 0", resolved_code: "03-0000.001", resolved_by: "user", project_id: "p1" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ classification: "Line 149", resolved_code: "09-2900.001", resolved_by: "user", project_id: "p2" }],
        error: null,
      });

    const out = await getClassificationHistoryBulk(classifications);

    expect(mockInClassification).toHaveBeenCalledTimes(2); // 100 + 50
    expect(mockInClassification.mock.calls[0][1]).toHaveLength(100);
    expect(mockInClassification.mock.calls[1][1]).toHaveLength(50);
    expect(out.get("Line 0")).toEqual([{ resolvedCode: "03-0000.001", count: 1 }]);
    expect(out.get("Line 149")).toEqual([{ resolvedCode: "09-2900.001", count: 1 }]);
  });

  it("pages past the 1000-row response cap with a stable order — the ranking needs the COMPLETE pool", async () => {
    // 1000 rows fills page one exactly, so the fetch must request page two.
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({
      classification: "Supervision",
      resolved_code: "01-0410.001",
      resolved_by: "user",
      project_id: `p${i}`,
    }));
    mockRange
      .mockResolvedValueOnce({ data: fullPage, error: null })
      .mockResolvedValueOnce({
        data: [{ classification: "Supervision", resolved_code: "01-0410.001", resolved_by: "user", project_id: "p1000" }],
        error: null,
      });

    const out = await getClassificationHistoryBulk(["Supervision"]);

    expect(mockRange).toHaveBeenCalledTimes(2);
    expect(mockRange).toHaveBeenNthCalledWith(1, 0, 999);
    expect(mockRange).toHaveBeenNthCalledWith(2, 1000, 1999);
    // Pagination is only deterministic under a total order.
    expect(mockOrderCreated).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(mockOrderId).toHaveBeenCalledWith("id", { ascending: true });
    expect(out.get("Supervision")).toEqual([{ resolvedCode: "01-0410.001", count: 1001 }]);
  });

  it("THROWS on a db error (callers degrade fail-soft at the call site)", async () => {
    mockRange.mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });
    await expect(getClassificationHistoryBulk(["Plumbing"])).rejects.toThrow(
      "Failed to fetch bulk classification history: permission denied"
    );
  });
});
