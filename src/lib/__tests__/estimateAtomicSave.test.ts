import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock Supabase client — audit #4: atomic estimate save (save_estimate RPC).
// saveEstimate must issue ONE rpc carrying BOTH p_estimate and p_items so the
// totals upsert and the line-item replace commit in a single transaction.
// ---------------------------------------------------------------------------
const mockRpc = vi.fn();

vi.mock("../supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import { saveEstimate } from "../db";
import type { ProcessedTakeoffRow } from "@/types";
import type { ProjectEstimate } from "@/types/db";

const makeRow = (overrides: Partial<ProcessedTakeoffRow> = {}): ProcessedTakeoffRow => ({
  id: "row-1",
  classification: "Footings",
  itemId: "03-0000.002",
  procoreParentCode: "3-30000.000",
  procoreCode: "3-30000.000",
  description: "Footings",
  matchedQty: 10,
  uom: "CY",
  unitPrice: 100,
  total: 1000,
  isMapped: true,
  rawQuantities: [],
  costType: "S",
  customFields: {},
  dataFidelity: "discrete_unit",
  source: "template",
  ...overrides,
});

const makeEstimate = (
  overrides: Partial<Omit<ProjectEstimate, "items">> = {}
): Omit<ProjectEstimate, "items"> => ({
  projectId: "project-1",
  subtotal: 6348138,
  constructionContingency: 0,
  designContingency: 0,
  buildersRisk: 0,
  specialInsurance: 0,
  glInsurance: 0,
  bond: 0,
  fee: 0,
  totalCost: 6500000,
  generalConditionsTotal: 0,
  gcUtilization: {},
  gcEquipmentOverrides: {},
  siteOperationsTotal: 0,
  siteOpsQuantities: {},
  siteOpsRates: {},
  rateCardSnapshot: {},
  ...overrides,
});

describe("audit #4 — saveEstimate atomic write", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("issues a SINGLE rpc carrying both p_estimate and p_items", async () => {
    mockRpc.mockResolvedValueOnce({ error: null });

    await saveEstimate(makeEstimate(), [
      makeRow({ id: "a" }),
      makeRow({ id: "b", itemId: "09-9000.001" }),
    ]);

    // Exactly one round-trip — totals and line items cannot half-commit.
    expect(mockRpc).toHaveBeenCalledTimes(1);

    const [fnName, args] = mockRpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fnName).toBe("save_estimate");
    expect(args).toHaveProperty("p_estimate");
    expect(args).toHaveProperty("p_items");

    // p_estimate carries project_id + snake_case totals
    expect(args.p_estimate).toMatchObject({
      project_id: "project-1",
      subtotal: 6348138,
      total_cost: 6500000,
    });
    // updated_at is stamped server-side by the RPC (now()), not in the payload
    expect(args.p_estimate).not.toHaveProperty("updated_at");

    // p_items carries the rows with sort_order from array index
    expect(args.p_items).toEqual([
      expect.objectContaining({ id: "a", sort_order: 0 }),
      expect.objectContaining({ id: "b", sort_order: 1 }),
    ]);
  });

  it("sanitizes non-finite financial fields to 0 in p_estimate", async () => {
    mockRpc.mockResolvedValueOnce({ error: null });

    await saveEstimate(
      makeEstimate({ subtotal: NaN, fee: Infinity, totalCost: -Infinity }),
      [makeRow()]
    );

    const args = mockRpc.mock.calls[0][1] as { p_estimate: Record<string, number> };
    expect(args.p_estimate.subtotal).toBe(0);
    expect(args.p_estimate.fee).toBe(0);
    expect(args.p_estimate.total_cost).toBe(0);
  });

  it("throws when the RPC returns an error", async () => {
    mockRpc.mockResolvedValueOnce({ error: { message: "permission denied" } });

    await expect(
      saveEstimate(makeEstimate(), [makeRow()])
    ).rejects.toThrow("Failed to save estimate: permission denied");
  });
});
