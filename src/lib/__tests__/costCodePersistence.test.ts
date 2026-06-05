import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock Supabase client (Phase 3a — procore_code persistence + cost_code_map)
// ---------------------------------------------------------------------------
const mockOrder = vi.fn();
const mockRpc = vi.fn();

vi.mock("../supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: mockOrder,
        })),
        order: mockOrder,
      })),
    })),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import {
  getEstimateLineItems,
  saveEstimateLineItems,
  getCostCodeMap,
  getProjects,
} from "../db";
import type { ProcessedTakeoffRow } from "@/types";

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

describe("Phase 3a — saveEstimateLineItems persists procore_code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes procore_code in the RPC payload with sort_order from array index", async () => {
    mockRpc.mockResolvedValueOnce({ error: null });

    await saveEstimateLineItems("project-1", [
      makeRow({ id: "a", procoreCode: "3-30000.000" }),
      makeRow({ id: "b", itemId: "09-9000.001", procoreCode: "9-99000.000" }),
    ]);

    expect(mockRpc).toHaveBeenCalledWith("save_estimate_line_items", {
      p_project_id: "project-1",
      p_items: [
        expect.objectContaining({ id: "a", sort_order: 0, procore_code: "3-30000.000" }),
        expect.objectContaining({ id: "b", sort_order: 1, procore_code: "9-99000.000" }),
      ],
    });
  });

  it("defaults procore_code to empty string when the row carries none", async () => {
    mockRpc.mockResolvedValueOnce({ error: null });

    await saveEstimateLineItems("project-1", [
      makeRow({ procoreCode: "" }),
    ]);

    const payload = mockRpc.mock.calls[0][1].p_items;
    expect(payload[0].procore_code).toBe("");
  });
});

describe("Phase 3a — getEstimateLineItems reads the persisted procore_code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hydrates procoreCode from the DB column, not the catalog", async () => {
    // item_id 03-0000.002 maps to 3-30000.000 in the catalog; the persisted
    // manual override below must win (Phase 3a retires catalog hydration).
    mockOrder.mockResolvedValueOnce({
      data: [
        {
          id: "row-1",
          item_id: "03-0000.002",
          procore_parent_code: "3-30000.000",
          procore_code: "6-64100.000",
          source: "manual",
        },
      ],
      error: null,
    });

    const rows = await getEstimateLineItems("project-1");
    expect(rows[0].procoreCode).toBe("6-64100.000");
  });

  it("returns empty procoreCode (no catalog fallback) when the column is empty", async () => {
    mockOrder.mockResolvedValueOnce({
      data: [
        { id: "row-1", item_id: "03-0000.002", procore_code: "" },
      ],
      error: null,
    });

    const rows = await getEstimateLineItems("project-1");
    expect(rows[0].procoreCode).toBe("");
  });
});

describe("Phase 3a — getCostCodeMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps cost_code_map rows to camelCase entries", async () => {
    mockOrder.mockResolvedValueOnce({
      data: [
        {
          template_name: "Company_Estimate_Template.xlsx",
          internal_code: "03-0000.002",
          procore_code: "3-30000.000",
          source: "sibling",
        },
        {
          template_name: "Company_Estimate_Template.xlsx",
          internal_code: "12-3570.001",
          procore_code: "6-64100.000",
          source: "manual",
        },
      ],
      error: null,
    });

    const entries = await getCostCodeMap("Company_Estimate_Template.xlsx");

    expect(entries).toEqual([
      {
        templateName: "Company_Estimate_Template.xlsx",
        internalCode: "03-0000.002",
        procoreCode: "3-30000.000",
        source: "sibling",
      },
      {
        templateName: "Company_Estimate_Template.xlsx",
        internalCode: "12-3570.001",
        procoreCode: "6-64100.000",
        source: "manual",
      },
    ]);
  });

  it("throws on Supabase error", async () => {
    mockOrder.mockResolvedValueOnce({
      data: null,
      error: { message: "Connection failed" },
    });

    await expect(
      getCostCodeMap("Company_Estimate_Template.xlsx")
    ).rejects.toThrow("Failed to fetch cost code map: Connection failed");
  });
});

describe("Phase 3a — project_type mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps project_type to projectType and defaults to multifamily", async () => {
    mockOrder.mockResolvedValueOnce({
      data: [
        { id: "p1", name: "Medical Job", project_type: "medical" },
        { id: "p2", name: "Legacy Job" },
      ],
      error: null,
    });

    const projects = await getProjects();
    expect(projects[0].projectType).toBe("medical");
    expect(projects[1].projectType).toBe("multifamily");
  });
});
