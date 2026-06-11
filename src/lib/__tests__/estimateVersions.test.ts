import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock Supabase client — covers every chain the estimate-version functions
// use: rpc(), select().eq().order(), select().eq().maybeSingle(),
// select().eq() awaited directly (submitted-version pool),
// select().eq().neq() awaited (imported pool), update().eq().eq() (withdraw).
// ---------------------------------------------------------------------------
const mockRpc = vi.fn();
const mockOrder = vi.fn();
const mockMaybeSingle = vi.fn();
const mockSelectEqResult = vi.fn(); // awaited select().eq() — submitted versions
const mockNeq = vi.fn();            // awaited select().eq().neq() — imported lines
const mockUpdate = vi.fn();
const mockUpdateFinalEq = vi.fn();  // awaited update().eq().eq()

vi.mock("../supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: mockOrder,
          maybeSingle: mockMaybeSingle,
          neq: mockNeq,
          // Awaiting select().eq() directly resolves the submitted-version pool.
          then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(mockSelectEqResult()).then(resolve, reject),
        })),
      })),
      update: (...args: unknown[]) => {
        mockUpdate(...args);
        return { eq: vi.fn(() => ({ eq: mockUpdateFinalEq })) };
      },
    })),
  },
}));

import {
  createEstimateVersion,
  getEstimateVersions,
  getEstimateVersionDetail,
  submitEstimateVersion,
  withdrawSubmittedVersion,
  getBidPriceHistory,
} from "../db";
import type { ProcessedTakeoffRow } from "@/types";

const mockRow: ProcessedTakeoffRow = {
  id: "row-1",
  classification: "Slab on Grade",
  itemId: "03-3000.001",
  procoreParentCode: "3-30000.000",
  procoreCode: "3-33543.000",
  description: "Concrete slab",
  matchedQty: 100,
  uom: "SF",
  unitPrice: 5.5,
  total: 550,
  isMapped: true,
  rawQuantities: [{ qty: 100, uom: "SF" }],
  costType: "M",
  customFields: {},
  source: "template",
};

const versionRow = {
  id: "ver-1",
  project_id: "project-1",
  version_number: 3,
  title: "50% DD",
  summary: { subtotal: 1000, totalEstimatedCost: 1200 },
  is_submitted: false,
  submitted_at: null,
  created_at: "2026-06-11T12:00:00Z",
  created_by: "user-1",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Estimate Versions — createEstimateVersion", () => {
  it("freezes rows through the RPC in the save_estimate payload shape", async () => {
    mockRpc.mockResolvedValueOnce({ data: versionRow, error: null });

    const result = await createEstimateVersion(
      "project-1",
      "  50% DD  ",
      [mockRow],
      { subtotal: 1000, totalEstimatedCost: 1200 }
    );

    expect(mockRpc).toHaveBeenCalledWith("create_estimate_version", {
      p_project_id: "project-1",
      p_title: "50% DD",
      p_line_items: [
        expect.objectContaining({
          id: "row-1",
          sort_order: 0,
          item_id: "03-3000.001",
          unit_price: 5.5,
          total: 550,
          uom: "SF",
          source: "template",
        }),
      ],
      p_summary: { subtotal: 1000, totalEstimatedCost: 1200 },
    });
    expect(result).toEqual({
      id: "ver-1",
      projectId: "project-1",
      versionNumber: 3,
      title: "50% DD",
      summary: { subtotal: 1000, totalEstimatedCost: 1200 },
      isSubmitted: false,
      submittedAt: null,
      createdAt: "2026-06-11T12:00:00Z",
      createdBy: "user-1",
    });
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    await expect(
      createEstimateVersion("p1", "t", [mockRow], {})
    ).rejects.toThrow("Failed to create estimate version: boom");
  });
});

describe("Estimate Versions — getEstimateVersions", () => {
  it("maps the lightweight listing", async () => {
    mockOrder.mockResolvedValueOnce({
      data: [{ ...versionRow, is_submitted: true, submitted_at: "2026-06-11T13:00:00Z" }],
      error: null,
    });

    const result = await getEstimateVersions("project-1");

    expect(result).toHaveLength(1);
    expect(result[0].isSubmitted).toBe(true);
    expect(result[0].submittedAt).toBe("2026-06-11T13:00:00Z");
    expect(result[0].versionNumber).toBe(3);
  });

  it("throws on Supabase error", async () => {
    mockOrder.mockResolvedValueOnce({ data: null, error: { message: "down" } });
    await expect(getEstimateVersions("p1")).rejects.toThrow(
      "Failed to fetch estimate versions: down"
    );
  });
});

describe("Estimate Versions — getEstimateVersionDetail", () => {
  it("returns null when the version does not exist", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect(await getEstimateVersionDetail("nope")).toBeNull();
  });

  it("maps frozen snake_case line items back to ProcessedTakeoffRow", async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        ...versionRow,
        line_items: [
          {
            id: "row-1",
            item_id: "03-3000.001",
            procore_parent_code: "3-30000.000",
            procore_code: "3-33543.000",
            description: "Concrete slab",
            matched_qty: 100,
            uom: "SF",
            unit_price: 5.5,
            total: 550,
            is_mapped: true,
            raw_quantities: [{ qty: 100, uom: "SF" }],
            cost_type: "M",
            custom_fields: {},
            data_fidelity: "discrete_unit",
            source: "template",
          },
        ],
      },
      error: null,
    });

    const detail = await getEstimateVersionDetail("ver-1");

    expect(detail?.versionNumber).toBe(3);
    expect(detail?.lineItems).toHaveLength(1);
    expect(detail?.lineItems[0]).toMatchObject({
      id: "row-1",
      itemId: "03-3000.001",
      matchedQty: 100,
      unitPrice: 5.5,
      total: 550,
      source: "template",
    });
  });
});

describe("Estimate Versions — submitEstimateVersion", () => {
  it("calls the atomic submit RPC with both ids", async () => {
    mockRpc.mockResolvedValueOnce({ error: null });

    await submitEstimateVersion("project-1", "ver-1");

    expect(mockRpc).toHaveBeenCalledWith("submit_estimate_version", {
      p_project_id: "project-1",
      p_version_id: "ver-1",
    });
  });

  it("throws on RPC error", async () => {
    mockRpc.mockResolvedValueOnce({ error: { message: "not found" } });
    await expect(submitEstimateVersion("p1", "v1")).rejects.toThrow(
      "Failed to submit estimate version: not found"
    );
  });
});

describe("Estimate Versions — withdrawSubmittedVersion", () => {
  it("clears only the submission flag pair", async () => {
    mockUpdateFinalEq.mockResolvedValueOnce({ error: null });

    await withdrawSubmittedVersion("project-1");

    expect(mockUpdate).toHaveBeenCalledWith({ is_submitted: false, submitted_at: null });
  });

  it("throws on Supabase error", async () => {
    mockUpdateFinalEq.mockResolvedValueOnce({ error: { message: "rls" } });
    await expect(withdrawSubmittedVersion("p1")).rejects.toThrow(
      "Failed to withdraw submitted version: rls"
    );
  });
});

describe("Estimate Versions — getBidPriceHistory", () => {
  const submittedVersionRow = {
    project_id: "p-submitted",
    line_items: [
      // Real observation: carried dollars in the official bid.
      { item_id: "03-3000.001", unit_price: 5.5, uom: " sf ", total: 550 },
      // Untouched template scaffold: default price, zero total → excluded.
      { item_id: "04-0000.001", unit_price: 9.99, uom: "SF", total: 0 },
      // No item code → excluded.
      { item_id: "", unit_price: 3, uom: "EA", total: 300 },
    ],
    projects: { name: "Submitted Proj", bid_date: "2026-05-01", market_sector: "Multifamily" },
  };

  const importedLineRow = (projectId: string) => ({
    project_id: projectId,
    item_id: "09-0000.001",
    unit_price: 2.25,
    uom: "SF",
    projects: { name: "Imported Proj", bid_date: "2025-01-01", market_sector: "Healthcare" },
  });

  it("emits only submitted lines that carried dollars, with normalized uom", async () => {
    mockSelectEqResult.mockReturnValueOnce({ data: [submittedVersionRow], error: null });
    mockNeq.mockResolvedValueOnce({ data: [], error: null });

    const observations = await getBidPriceHistory();

    expect(observations).toEqual([
      {
        itemId: "03-3000.001",
        unitPrice: 5.5,
        uom: "SF",
        projectName: "Submitted Proj",
        bidDate: "2026-05-01",
        marketSector: "Multifamily",
      },
    ]);
  });

  it("drops imported observations for projects that have a submitted version", async () => {
    mockSelectEqResult.mockReturnValueOnce({ data: [submittedVersionRow], error: null });
    mockNeq.mockResolvedValueOnce({
      data: [importedLineRow("p-submitted"), importedLineRow("p-imported-only")],
      error: null,
    });

    const observations = await getBidPriceHistory();

    // One from the submitted version, one imported from the OTHER project only.
    expect(observations).toHaveLength(2);
    expect(observations.filter((o) => o.itemId === "09-0000.001")).toHaveLength(1);
    expect(observations.find((o) => o.itemId === "09-0000.001")?.projectName).toBe("Imported Proj");
  });

  it("supersedes by submitted-version existence even when it yields no observations", async () => {
    // A submitted version whose every line is filtered out still supersedes
    // the project's imported record (the official bid exists; it has no
    // qualifying lines).
    mockSelectEqResult.mockReturnValueOnce({
      data: [{ ...submittedVersionRow, line_items: [{ item_id: "03-1", unit_price: 1, uom: "SF", total: 0 }] }],
      error: null,
    });
    mockNeq.mockResolvedValueOnce({ data: [importedLineRow("p-submitted")], error: null });

    expect(await getBidPriceHistory()).toEqual([]);
  });

  it("passes imported observations through untouched when nothing is submitted", async () => {
    mockSelectEqResult.mockReturnValueOnce({ data: [], error: null });
    mockNeq.mockResolvedValueOnce({ data: [importedLineRow("p-imported-only")], error: null });

    const observations = await getBidPriceHistory();

    expect(observations).toEqual([
      {
        itemId: "09-0000.001",
        unitPrice: 2.25,
        uom: "SF",
        projectName: "Imported Proj",
        bidDate: "2025-01-01",
        marketSector: "Healthcare",
      },
    ]);
  });

  it("throws when the submitted-version query fails", async () => {
    mockSelectEqResult.mockReturnValueOnce({ data: null, error: { message: "down" } });
    mockNeq.mockResolvedValueOnce({ data: [], error: null });

    await expect(getBidPriceHistory()).rejects.toThrow(
      "Failed to fetch submitted-version price history: down"
    );
  });
});
