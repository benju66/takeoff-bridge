import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// updateRateCardEntry gate (Rate-card slice 2, Phase C). The /rates editor is
// the SOLE update path for an existing rate. This pins two things the catalog
// section depends on:
//   - A catalog edit ({ allowNegative:true }) accepts a negative price (the -$2
//     deduction line) AND stamps source='manual' in the update payload.
//   - A default call (GC/Site Ops) rejects a negative BEFORE any DB write.
// Mirrors the supabase mock pattern in costCodePersistence.test.ts.
// ---------------------------------------------------------------------------

const mockUpdate = vi.fn();
const mockSingle = vi.fn();

vi.mock("../supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      // .update(payload).eq().eq().select().single()
      update: (payload: unknown) => {
        mockUpdate(payload);
        return {
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: mockSingle,
              })),
            })),
          })),
        };
      },
    })),
  },
}));

import { updateRateCardEntry } from "../db";
import { MASTER_TEMPLATE_NAME } from "../constants";

describe("updateRateCardEntry — catalog allowNegative + source='manual'", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts a negative catalog price and writes source='manual'", async () => {
    mockSingle.mockResolvedValueOnce({
      data: {
        template_name: MASTER_TEMPLATE_NAME,
        line_code: "03-5413.002",
        rate: -2,
        source: "manual",
      },
      error: null,
    });

    const result = await updateRateCardEntry(
      MASTER_TEMPLATE_NAME,
      "03-5413.002",
      -2,
      { allowNegative: true },
    );

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ rate: -2, source: "manual" }),
    );
    expect(result).toMatchObject({ lineCode: "03-5413.002", rate: -2, source: "manual" });
  });

  it("rejects a negative rate by default (GC/Site Ops) before any write", async () => {
    await expect(
      updateRateCardEntry(MASTER_TEMPLATE_NAME, "01-0310.001", -1),
    ).rejects.toThrow(/must be a finite number >= 0/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects non-finite even when negatives are allowed", async () => {
    await expect(
      updateRateCardEntry(MASTER_TEMPLATE_NAME, "03-5413.002", Infinity, { allowNegative: true }),
    ).rejects.toThrow(/must be a finite number/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
