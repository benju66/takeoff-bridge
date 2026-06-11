/**
 * Catalog Manager Phase 4 — thin promotion (db.ts/promoteCustomStep23LineDef).
 * Promotion creates ONE opt-in rate_card row for an ACTIVE custom GC/Site-Ops
 * code (source='manual', rate validated >= 0, EXACTLY once) so /rates shows the
 * code and the existing audited ADOPT path works — nothing more. It writes the
 * company-DEFAULT layer only; it never moves an estimate dollar (the engine in
 * calculations.ts never reads promotion). Mock shape mirrors the two-table
 * access: a custom_step23_line_defs fetch + a rate_card existence-check
 * (maybeSingle, queued in order) then a rate_card insert (single).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockMaybeSingle = vi.fn(); // select().eq()[.eq()].maybeSingle() — fetch def + existence check
const mockInsertSingle = vi.fn(); // insert().select().single()         — write result
const mockInsert = vi.fn();

function makeReadSelect() {
  const chain: Record<string, unknown> = {
    eq: vi.fn(() => chain),
    maybeSingle: mockMaybeSingle,
  };
  return chain;
}

const mockFrom = vi.fn((..._args: unknown[]) => ({
  select: vi.fn(() => makeReadSelect()),
  insert: (payload: unknown) => {
    mockInsert(payload);
    return { select: vi.fn(() => ({ single: mockInsertSingle })) };
  },
}));

vi.mock("../supabase", () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

import { promoteCustomStep23LineDef } from "../db";
import { MASTER_TEMPLATE_NAME } from "../constants";

beforeEach(() => vi.clearAllMocks());

const activeDefRow = {
  code: "02-4100.003",
  label: "Demolition - Openings in CMU",
  unit: "EA",
  procore_code: null,
  source: "import_gate",
  status: "active",
  merged_into: null,
};

/** Queue the fetchCustomStep23LineDef() read, then the rate_card existence read. */
function fetchThenExisting(def: Record<string, unknown> | null, existing: Record<string, unknown> | null) {
  mockMaybeSingle.mockResolvedValueOnce({ data: def, error: null }); // 1: fetch custom def
  mockMaybeSingle.mockResolvedValueOnce({ data: existing, error: null }); // 2: rate_card existence
}

describe("promoteCustomStep23LineDef", () => {
  it("promotes an active code: inserts source='manual' at default rate 0 and returns the mapped entry", async () => {
    fetchThenExisting(activeDefRow, null);
    mockInsertSingle.mockResolvedValueOnce({
      data: { template_name: MASTER_TEMPLATE_NAME, line_code: "02-4100.003", rate: 0, source: "manual" },
      error: null,
    });

    const out = await promoteCustomStep23LineDef(MASTER_TEMPLATE_NAME, " 02-4100.003 ");

    expect(mockInsert).toHaveBeenCalledWith({
      template_name: MASTER_TEMPLATE_NAME,
      line_code: "02-4100.003",
      rate: 0,
      source: "manual",
    });
    expect(out).toEqual({
      templateName: MASTER_TEMPLATE_NAME,
      lineCode: "02-4100.003",
      rate: 0,
      source: "manual",
    });
  });

  it("accepts a supplied non-negative default rate", async () => {
    fetchThenExisting(activeDefRow, null);
    mockInsertSingle.mockResolvedValueOnce({
      data: { template_name: MASTER_TEMPLATE_NAME, line_code: "02-4100.003", rate: 125.5, source: "manual" },
      error: null,
    });

    const out = await promoteCustomStep23LineDef(MASTER_TEMPLATE_NAME, "02-4100.003", 125.5);

    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ rate: 125.5, source: "manual" }));
    expect(out.rate).toBe(125.5);
  });

  it("rejects an already-promoted code (existing rate_card row) WITHOUT inserting", async () => {
    fetchThenExisting(activeDefRow, { line_code: "02-4100.003" });

    await expect(promoteCustomStep23LineDef(MASTER_TEMPLATE_NAME, "02-4100.003")).rejects.toThrow(
      /already promoted/
    );
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("treats a 23505 race (concurrent promote) as already promoted", async () => {
    fetchThenExisting(activeDefRow, null);
    mockInsertSingle.mockResolvedValueOnce({ data: null, error: { code: "23505" } });

    await expect(promoteCustomStep23LineDef(MASTER_TEMPLATE_NAME, "02-4100.003")).rejects.toThrow(
      /already promoted/
    );
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it("rejects promoting a RETIRED code (active-only) WITHOUT inserting", async () => {
    // Only the fetch read is reached (active gate fails before the existence check).
    mockMaybeSingle.mockResolvedValueOnce({ data: { ...activeDefRow, status: "retired" }, error: null });

    await expect(promoteCustomStep23LineDef(MASTER_TEMPLATE_NAME, "02-4100.003")).rejects.toThrow(
      /is retired; only active codes can be promoted/
    );
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("rejects a negative default rate BEFORE any read or write", async () => {
    await expect(promoteCustomStep23LineDef(MASTER_TEMPLATE_NAME, "02-4100.003", -1)).rejects.toThrow(
      /must be a finite number >= 0/
    );
    expect(mockMaybeSingle).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("rejects a non-finite default rate BEFORE any read or write", async () => {
    await expect(
      promoteCustomStep23LineDef(MASTER_TEMPLATE_NAME, "02-4100.003", Infinity)
    ).rejects.toThrow(/must be a finite number/);
    expect(mockMaybeSingle).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("throws when the code does not exist", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null }); // fetch → null

    await expect(promoteCustomStep23LineDef(MASTER_TEMPLATE_NAME, "02-4100.003")).rejects.toThrow(
      "Custom code 02-4100.003 not found"
    );
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
