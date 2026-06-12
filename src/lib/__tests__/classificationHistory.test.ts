import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock Supabase client — intercepts all db.ts calls
// Read chain: .select(...).eq(...).in("resolved_by", ...).order(...) → promise
// ---------------------------------------------------------------------------
const mockInsert = vi.fn();
const mockEq = vi.fn();
const mockInTrusted = vi.fn();
const mockOrder = vi.fn();

vi.mock("../supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: mockInsert,
      select: vi.fn(() => ({
        eq: mockEq,
      })),
    })),
  },
}));

import {
  recordClassificationResolution,
  recordClassificationResolutions,
  getClassificationHistory,
} from "../db";
import { RESOLVED_BY, TRUSTED_RESOLVED_BY } from "../resolvedBy";

/** Wires the read chain: eq → in → order (order resolves the given payload). */
function mockReadChain(payload: { data: unknown; error: unknown }) {
  mockOrder.mockResolvedValueOnce(payload);
  mockInTrusted.mockReturnValueOnce({ order: mockOrder });
  mockEq.mockReturnValueOnce({ in: mockInTrusted });
}

describe("Classification History — recordClassificationResolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a resolution row with all required fields", async () => {
    mockInsert.mockResolvedValueOnce({ error: null });

    await recordClassificationResolution(
      "Slab on Grade",
      "03-3000.001",
      "project-1",
      "user",
      1.0
    );

    expect(mockInsert).toHaveBeenCalledWith({
      classification: "Slab on Grade",
      resolved_code: "03-3000.001",
      project_id: "project-1",
      resolved_by: "user",
      confidence: 1.0,
    });
  });

  it("accepts null projectId for global resolutions", async () => {
    mockInsert.mockResolvedValueOnce({ error: null });

    await recordClassificationResolution(
      "Brick Veneer",
      "04-0000.001",
      null,
      "global"
    );

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: null,
        resolved_by: "global",
        confidence: 1.0,
      })
    );
  });

  it("records a combined-line confirmation TAGGED as user_lump (fidelity Phase 2: recorded, never discarded)", async () => {
    mockInsert.mockResolvedValueOnce({ error: null });

    await recordClassificationResolution(
      "Doors/Frames/Hardware (combined)",
      "08-1100.001",
      "project-1",
      RESOLVED_BY.USER_LUMP
    );

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ resolved_by: "user_lump" })
    );
  });

  it("defaults confidence to 1.0 when omitted", async () => {
    mockInsert.mockResolvedValueOnce({ error: null });

    await recordClassificationResolution(
      "Test",
      "01-0000",
      "p1",
      "seed"
    );

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ confidence: 1.0 })
    );
  });

  it("throws on Supabase error", async () => {
    mockInsert.mockResolvedValueOnce({
      error: { message: "DB error" },
    });

    await expect(
      recordClassificationResolution("X", "Y", null, "ai")
    ).rejects.toThrow("Failed to record classification resolution: DB error");
  });
});

describe("Classification History — recordClassificationResolutions (Phase 5 signal batch)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts every signal row in ONE batch under the saving project", async () => {
    mockInsert.mockResolvedValueOnce({ error: null });

    await recordClassificationResolutions(
      [
        { classification: "Drywall Mystery", resolvedCode: "09-2900.001", resolvedBy: RESOLVED_BY.SUGGESTION_REJECTED },
        { classification: "Drywall Mystery", resolvedCode: "09-5100.001", resolvedBy: RESOLVED_BY.SUGGESTION_OVERRIDDEN },
        { classification: "Slab on Grade", resolvedCode: "03-3000.001", resolvedBy: RESOLVED_BY.SUGGESTION_ACCEPTED },
      ],
      "project-1"
    );

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledWith([
      {
        classification: "Drywall Mystery",
        resolved_code: "09-2900.001",
        project_id: "project-1",
        resolved_by: "suggestion_rejected",
        confidence: 1.0,
      },
      {
        classification: "Drywall Mystery",
        resolved_code: "09-5100.001",
        project_id: "project-1",
        resolved_by: "suggestion_overridden",
        confidence: 1.0,
      },
      {
        classification: "Slab on Grade",
        resolved_code: "03-3000.001",
        project_id: "project-1",
        resolved_by: "suggestion_accepted",
        confidence: 1.0,
      },
    ]);
  });

  it("skips the request entirely for an empty batch", async () => {
    await recordClassificationResolutions([], "project-1");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("throws on Supabase error (fire-and-forget callers swallow it)", async () => {
    // NOTE: always called with a real project id in production — the deployed
    // RLS insert policy rejects null-project rows (see the helper's doc).
    mockInsert.mockResolvedValueOnce({ error: { message: "DB error" } });

    await expect(
      recordClassificationResolutions(
        [{ classification: "X", resolvedCode: "Y", resolvedBy: RESOLVED_BY.SUGGESTION_ACCEPTED }],
        "project-1"
      )
    ).rejects.toThrow("Failed to record classification resolutions: DB error");
  });
});

describe("Classification History — getClassificationHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("groups results by resolved_code with count", async () => {
    const mockData = [
      { resolved_code: "03-3000.001", resolved_by: "user", confidence: 1.0 },
      { resolved_code: "03-3000.001", resolved_by: "seed", confidence: 0.8 },
      { resolved_code: "04-0000.001", resolved_by: "user", confidence: 1.0 },
    ];

    mockReadChain({ data: mockData, error: null });

    const result = await getClassificationHistory("Slab on Grade");

    expect(result).toHaveLength(2);

    const group03 = result.find((r) => r.resolvedCode === "03-3000.001");
    expect(group03).toBeDefined();
    expect(group03!.count).toBe(2);

    const group04 = result.find((r) => r.resolvedCode === "04-0000.001");
    expect(group04).toBeDefined();
    expect(group04!.count).toBe(1);
  });

  it("reads TRUSTED observations only — lump-tagged rows are filtered at the query", async () => {
    mockReadChain({ data: [], error: null });

    await getClassificationHistory("Slab on Grade");

    expect(mockInTrusted).toHaveBeenCalledWith("resolved_by", [...TRUSTED_RESOLVED_BY]);
    expect(mockInTrusted.mock.calls[0][1]).not.toContain(RESOLVED_BY.USER_LUMP);
  });

  it("returns empty array when no history exists", async () => {
    mockReadChain({ data: [], error: null });

    const result = await getClassificationHistory("Unknown Classification");
    expect(result).toEqual([]);
  });

  it("throws on Supabase error", async () => {
    mockReadChain({ data: null, error: { message: "Network error" } });

    await expect(
      getClassificationHistory("Test")
    ).rejects.toThrow("Failed to fetch classification history: Network error");
  });
});
