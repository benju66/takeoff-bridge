/**
 * Phase A2 — estimate_section_lines db gateway + round-trip.
 *
 * The new dedicated table holds one addressable row per GC Personnel (Step 2) /
 * Site Operations (Step 3) line — line IDENTITY + estimator INPUTS only, NEVER a
 * total (totals are recomputed by the calc engine: "derived, never frozen", plan
 * ID-1). saveSectionLines persists via its OWN atomic RPC (save_section_lines),
 * independent of save_estimate. getSectionLines reads ORDER BY sort_order ASC so
 * manual positions survive (AGENTS.md sort-order integrity). The gateway THROWS on
 * failure (authored estimator inputs must persist — not fire-and-forget).
 *
 * Phase A2 wires NOTHING into the pages, so this unit round-trip (save -> read,
 * sort_order ASC) is the exit gate for the gateway. The export goldens are
 * untouched because nothing consumes the table yet.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Chainable Supabase mock (mirrors estimateBindingsDb.test.ts). Terminal chains:
//   from().select(cols).eq(col,val).order(col,opts)  -> { data, error }
//   rpc(name, args)                                   -> { error }
// ---------------------------------------------------------------------------
const mockOrder = vi.fn();
const mockSelectEq = vi.fn(() => ({ order: mockOrder }));
const mockSelect = vi.fn(() => ({ eq: mockSelectEq }));
const mockRpc = vi.fn();
const mockFrom = vi.fn((...args: unknown[]) => {
  void args; // recorded by vi.fn for table-name assertions
  return { select: mockSelect };
});

vi.mock("../supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import * as db from "../db";
import { getSectionLines, saveSectionLines } from "../db";
import type { EstimateSectionLine } from "@/types/db";

beforeEach(() => {
  vi.clearAllMocks();
});

/** A sample app-layer section line (the shape A3 synthesis will produce). */
function gcLine(overrides: Partial<EstimateSectionLine> = {}): EstimateSectionLine {
  return {
    id: "L1",
    projectId: "p1",
    section: "gc",
    code: "01-0310.001",
    procoreCode: "1-10310.000",
    costType: "L",
    label: "Project Executive",
    entryKind: "staffRole",
    inputs: { utilization: 0.5 },
    sortOrder: 0,
    source: "template",
    updatedAt: "2026-06-17T00:00:00.000Z",
    ...overrides,
  };
}

describe("saveSectionLines — atomic replace via save_section_lines RPC", () => {
  it("calls the RPC with project id + snake_case payload, sort_order from array index", async () => {
    mockRpc.mockResolvedValueOnce({ error: null });

    const lines: EstimateSectionLine[] = [
      gcLine({ id: "A", sortOrder: 99 }), // index 0 wins over the stale sortOrder field
      gcLine({
        id: "B",
        section: "site_ops",
        code: "02-9015.001",
        procoreCode: "2-29015.000",
        costType: "M",
        label: "Safety",
        entryKind: "dynamic",
        inputs: { qty: 5 },
        sortOrder: 0,
        source: "manual",
      }),
    ];

    await saveSectionLines("p1", lines);

    expect(mockRpc).toHaveBeenCalledTimes(1);
    const [fnName, args] = mockRpc.mock.calls[0];
    expect(fnName).toBe("save_section_lines");
    expect((args as { p_project_id: string }).p_project_id).toBe("p1");

    const payload = (args as { p_lines: Record<string, unknown>[] }).p_lines;
    expect(payload).toEqual([
      {
        id: "A",
        section: "gc",
        code: "01-0310.001",
        procore_code: "1-10310.000",
        cost_type: "L",
        label: "Project Executive",
        entry_kind: "staffRole",
        inputs: { utilization: 0.5 },
        sort_order: 0, // array index, NOT the stale 99
        source: "template",
      },
      {
        id: "B",
        section: "site_ops",
        code: "02-9015.001",
        procore_code: "2-29015.000",
        cost_type: "M",
        label: "Safety",
        entry_kind: "dynamic",
        inputs: { qty: 5 },
        sort_order: 1, // array index
        source: "manual",
      },
    ]);
    // No `total` is ever sent — the table has no total column (derived, never frozen).
    expect(payload[0]).not.toHaveProperty("total");
    expect(payload[1]).not.toHaveProperty("total");
  });

  it("defaults source to 'template' when omitted", async () => {
    mockRpc.mockResolvedValueOnce({ error: null });
    await saveSectionLines("p1", [gcLine({ source: "" })]);
    const payload = (mockRpc.mock.calls[0][1] as { p_lines: Record<string, unknown>[] }).p_lines;
    expect(payload[0].source).toBe("template");
  });

  it("THROWS on RPC error (authored intent must persist — not fire-and-forget)", async () => {
    mockRpc.mockResolvedValueOnce({ error: { message: "permission denied" } });
    await expect(saveSectionLines("p1", [gcLine()])).rejects.toThrow(
      "Failed to save section lines: permission denied"
    );
  });
});

describe("getSectionLines — read ordered by sort_order ASC", () => {
  it("selects by project, orders by sort_order ASC, and maps rows to camelCase", async () => {
    mockOrder.mockResolvedValueOnce({
      data: [
        {
          id: "A", project_id: "p1", section: "gc", code: "01-0310.001",
          procore_code: "1-10310.000", cost_type: "L", label: "Project Executive",
          entry_kind: "staffRole", inputs: { utilization: 0.5 }, sort_order: 0,
          source: "template", updated_at: "2026-06-17T01:00:00.000Z",
        },
        {
          id: "B", project_id: "p1", section: "site_ops", code: "02-9015.001",
          procore_code: "2-29015.000", cost_type: "M", label: "Safety",
          entry_kind: "dynamic", inputs: { qty: 5 }, sort_order: 1,
          source: "manual", updated_at: "2026-06-17T01:00:00.000Z",
        },
      ],
      error: null,
    });

    const lines = await getSectionLines("p1");

    expect(mockFrom).toHaveBeenCalledWith("estimate_section_lines");
    expect(mockSelectEq).toHaveBeenCalledWith("project_id", "p1");
    expect(mockOrder).toHaveBeenCalledWith("sort_order", { ascending: true });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({
      id: "A",
      projectId: "p1",
      section: "gc",
      code: "01-0310.001",
      procoreCode: "1-10310.000",
      costType: "L",
      label: "Project Executive",
      entryKind: "staffRole",
      inputs: { utilization: 0.5 },
      sortOrder: 0,
      source: "template",
      updatedAt: "2026-06-17T01:00:00.000Z",
    });
    expect(lines[1].section).toBe("site_ops");
    expect(lines[1].inputs).toEqual({ qty: 5 });
  });

  it("returns [] for a project with no section lines", async () => {
    mockOrder.mockResolvedValueOnce({ data: [], error: null });
    expect(await getSectionLines("p1")).toEqual([]);
  });

  it("defaults a missing inputs blob to {} and missing source to 'template'", async () => {
    mockOrder.mockResolvedValueOnce({
      data: [
        {
          id: "A", project_id: "p1", section: "gc", code: "", procore_code: "",
          cost_type: "", label: "", entry_kind: "lumpSum",
          inputs: null, sort_order: 0, source: null, updated_at: null,
        },
      ],
      error: null,
    });
    const [line] = await getSectionLines("p1");
    expect(line.inputs).toEqual({});
    expect(line.source).toBe("template");
    expect(typeof line.updatedAt).toBe("string");
  });

  it("throws on error", async () => {
    mockOrder.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(getSectionLines("p1")).rejects.toThrow("Failed to fetch section lines: boom");
  });
});

describe("section-lines gateway surface", () => {
  it("the db gateway exposes read + save for section lines", () => {
    const gateway = db as unknown as Record<string, unknown>;
    expect(typeof gateway.getSectionLines).toBe("function");
    expect(typeof gateway.saveSectionLines).toBe("function");
  });
});

describe("round-trip → save then reload preserves sort_order ASC", () => {
  it("saves out-of-order lines, reloads them ordered, and rides the real persisted shape", async () => {
    // SAVE: pass the lines in REVERSE visual order; the gateway stamps sort_order
    // from the array index, so [first, second] become sort_order 0, 1.
    mockRpc.mockResolvedValueOnce({ error: null });
    const first = gcLine({ id: "first", label: "First" });
    const second = gcLine({
      id: "second", label: "Second", section: "site_ops", entryKind: "qtyRate",
      inputs: { qty: 2, rate: 10 },
    });
    await saveSectionLines("p1", [first, second]);

    // RELOAD: build DB rows from the ACTUAL saved payload (so the test rides the
    // real persisted shape, not a hand-written duplicate), and hand them back in
    // a scrambled order — getSectionLines relies on the DB's ORDER BY sort_order.
    const saved = (mockRpc.mock.calls[0][1] as { p_lines: Record<string, unknown>[] }).p_lines;
    const asDbRow = (p: Record<string, unknown>) => ({
      ...p,
      project_id: "p1",
      updated_at: "2026-06-17T02:00:00.000Z",
    });
    mockOrder.mockResolvedValueOnce({
      data: [asDbRow(saved[0]), asDbRow(saved[1])], // sort_order 0 then 1
      error: null,
    });

    const reloaded = await getSectionLines("p1");
    expect(reloaded.map((l) => l.id)).toEqual(["first", "second"]);
    expect(reloaded.map((l) => l.sortOrder)).toEqual([0, 1]);
    expect(reloaded[0].label).toBe("First");
    expect(reloaded[1].section).toBe("site_ops");
    expect(reloaded[1].inputs).toEqual({ qty: 2, rate: 10 });
    // No total field survives the round-trip — there is no total column.
    expect(reloaded[0]).not.toHaveProperty("total");
  });
});
