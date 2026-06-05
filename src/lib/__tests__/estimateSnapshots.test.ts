import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock Supabase client
// ---------------------------------------------------------------------------
const mockInsert = vi.fn();
const mockOrder = vi.fn();
const mockMaybeSingle = vi.fn();

vi.mock("../supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: mockInsert,
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: mockOrder,
          maybeSingle: mockMaybeSingle,
        })),
      })),
    })),
  },
}));

import {
  createEstimateSnapshot,
  getEstimateSnapshots,
  getSnapshotDetail,
} from "../db";
import type { ProcessedTakeoffRow } from "@/types";

const mockRow: ProcessedTakeoffRow = {
  id: "row-1",
  classification: "Slab on Grade",
  itemId: "03-3000.001",
  procoreParentCode: "3-30000.000",
  procoreCode: "",
  description: "Concrete slab",
  matchedQty: 100,
  uom: "SF",
  unitPrice: 5.5,
  total: 550,
  isMapped: true,
  rawQuantities: [{ qty: 100, uom: "SF" }],
  costType: "M",
  customFields: {},
};

describe("Estimate Snapshots — createEstimateSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a snapshot with correct fields", async () => {
    mockInsert.mockResolvedValueOnce({ error: null });

    await createEstimateSnapshot(
      "project-1",
      [mockRow],
      "pre_import",
      "Before CSV import"
    );

    expect(mockInsert).toHaveBeenCalledWith({
      project_id: "project-1",
      snapshot_type: "pre_import",
      label: "Before CSV import",
      line_items: [mockRow],
      summary: {},
      metadata: {},
    });
  });

  it("accepts optional summary and metadata", async () => {
    mockInsert.mockResolvedValueOnce({ error: null });

    await createEstimateSnapshot(
      "project-2",
      [mockRow],
      "manual",
      "Phase 1 complete",
      { totalCost: 550 },
      { squareFootage: 1000 }
    );

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: { totalCost: 550 },
        metadata: { squareFootage: 1000 },
      })
    );
  });

  it("defaults label to empty string when omitted", async () => {
    mockInsert.mockResolvedValueOnce({ error: null });

    await createEstimateSnapshot("p1", [mockRow], "auto");

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ label: "" })
    );
  });

  it("throws on Supabase error", async () => {
    mockInsert.mockResolvedValueOnce({
      error: { message: "Quota exceeded" },
    });

    await expect(
      createEstimateSnapshot("p1", [mockRow], "auto")
    ).rejects.toThrow("Failed to create estimate snapshot: Quota exceeded");
  });
});

describe("Estimate Snapshots — getEstimateSnapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns lightweight snapshot listing with item count", async () => {
    const mockData = [
      {
        id: "snap-1",
        snapshot_at: "2026-06-03T12:00:00Z",
        snapshot_type: "pre_import",
        label: "Before CSV import",
        line_items: [mockRow, mockRow],
      },
      {
        id: "snap-2",
        snapshot_at: "2026-06-03T11:00:00Z",
        snapshot_type: "manual",
        label: "Phase 1",
        line_items: [mockRow],
      },
    ];

    mockOrder.mockResolvedValueOnce({ data: mockData, error: null });

    const result = await getEstimateSnapshots("project-1");

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: "snap-1",
      snapshotAt: "2026-06-03T12:00:00Z",
      snapshotType: "pre_import",
      label: "Before CSV import",
      itemCount: 2,
    });
    expect(result[1].itemCount).toBe(1);
  });

  it("returns empty array when no snapshots exist", async () => {
    mockOrder.mockResolvedValueOnce({ data: [], error: null });

    const result = await getEstimateSnapshots("empty-project");
    expect(result).toEqual([]);
  });

  it("throws on Supabase error", async () => {
    mockOrder.mockResolvedValueOnce({
      data: null,
      error: { message: "Connection failed" },
    });

    await expect(
      getEstimateSnapshots("p1")
    ).rejects.toThrow("Failed to fetch snapshots: Connection failed");
  });
});

describe("Estimate Snapshots — getSnapshotDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when snapshot not found", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const result = await getSnapshotDetail("nonexistent-id");
    expect(result).toBeNull();
  });

  it("throws on Supabase error", async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "DB error" },
    });

    await expect(
      getSnapshotDetail("snap-1")
    ).rejects.toThrow("Failed to fetch snapshot detail: DB error");
  });
});
