/**
 * Custom GC/Site-Ops line defs — db gateway for the import STEP 2/3 review
 * gate (Phase 2). getCustomStep23LineDefs is READ-only resolver fuel
 * (consumers fail-soft); createCustomStep23LineDef is the gate's sole mint
 * path and must reject every malformed or colliding def BEFORE the write —
 * a custom code may never shadow a built-in (architect-locked 2026-06-10).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockOrder = vi.fn();
const mockMaybeSingle = vi.fn();
const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = vi.fn(() => ({ order: mockOrder, eq: mockEq }));
const mockSingle = vi.fn();
const mockInsertSelect = vi.fn(() => ({ single: mockSingle }));
const mockInsert = vi.fn((..._args: unknown[]) => ({ select: mockInsertSelect }));
const mockFrom = vi.fn((..._args: unknown[]) => ({ select: mockSelect, insert: mockInsert }));

vi.mock("../supabase", () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

import { getCustomStep23LineDefs, createCustomStep23LineDef } from "../db";

beforeEach(() => vi.clearAllMocks());

const COLUMNS = "code, label, unit, procore_code, source";

describe("getCustomStep23LineDefs", () => {
  it("queries all defs ordered by code and maps the rows", async () => {
    mockOrder.mockResolvedValueOnce({
      data: [
        { code: "01-0410.002", label: "Night Superintendent", unit: "HR", procore_code: "1-10410.000", source: "manual" },
        { code: "02-4100.003", label: "Demolition - Openings in CMU", unit: "EA", procore_code: null, source: "import_gate" },
        // unit can come back null from a raw row — mapped to "".
        { code: "02-9530.002", label: "Fence Wash", unit: null, procore_code: null, source: "import_gate" },
      ],
      error: null,
    });

    const out = await getCustomStep23LineDefs();

    expect(mockFrom).toHaveBeenCalledWith("custom_step23_line_defs");
    expect(mockSelect).toHaveBeenCalledWith(COLUMNS);
    expect(mockOrder).toHaveBeenCalledWith("code", { ascending: true });
    expect(out).toEqual([
      { code: "01-0410.002", label: "Night Superintendent", unit: "HR", procoreCode: "1-10410.000", source: "manual" },
      { code: "02-4100.003", label: "Demolition - Openings in CMU", unit: "EA", procoreCode: null, source: "import_gate" },
      { code: "02-9530.002", label: "Fence Wash", unit: "", procoreCode: null, source: "import_gate" },
    ]);
  });

  it("THROWS on a db error (consumers degrade fail-soft at the call site)", async () => {
    mockOrder.mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });
    await expect(getCustomStep23LineDefs()).rejects.toThrow(
      "Failed to fetch custom GC/Site-Ops line defs: permission denied"
    );
  });
});

describe("createCustomStep23LineDef", () => {
  const valid = { code: "02-4100.003", label: "Demolition - Openings in CMU", unit: "EA" };
  const insertedRow = {
    code: "02-4100.003",
    label: "Demolition - Openings in CMU",
    unit: "EA",
    procore_code: null,
    source: "import_gate",
  };

  it("rejects a non-deterministic code shape WITHOUT touching the db", async () => {
    for (const code of ["02-4100", "2-4100.003", "02-4100.03", "02-4100.0033", "abc", ""]) {
      await expect(createCustomStep23LineDef({ ...valid, code })).rejects.toThrow(
        /must be deterministic NN-NNNN\.NNN/
      );
    }
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects an empty label WITHOUT touching the db (the label is the auto-resolution key)", async () => {
    await expect(createCustomStep23LineDef({ ...valid, label: "   " })).rejects.toThrow(
      /needs a non-empty name/
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects a code that shadows a BUILT-IN def WITHOUT touching the db (collision rule)", async () => {
    await expect(createCustomStep23LineDef({ ...valid, code: "02-4100.001" })).rejects.toThrow(
      /already a built-in GC\/Site-Ops line/
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects a code that duplicates an EXISTING custom row (pre-check)", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { code: "02-4100.003" }, error: null });

    await expect(createCustomStep23LineDef(valid)).rejects.toThrow("Custom code 02-4100.003 already exists");
    expect(mockEq).toHaveBeenCalledWith("code", "02-4100.003");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("THROWS when the collision pre-check itself fails (never mints blind)", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: { message: "timeout" } });
    await expect(createCustomStep23LineDef(valid)).rejects.toThrow(
      "Failed to check custom code 02-4100.003 for collisions: timeout"
    );
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("mints a valid def with NORMALIZED fields and returns the stored row", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockSingle.mockResolvedValueOnce({ data: insertedRow, error: null });

    const out = await createCustomStep23LineDef({
      code: " 02-4100.003 ",
      label: "  Demolition - Openings in CMU ",
      unit: " ea ",
      procoreCode: "   ", // blank → stored as NULL (Catalog Manager backfills)
    });

    expect(mockInsert).toHaveBeenCalledWith({
      code: "02-4100.003",
      label: "Demolition - Openings in CMU",
      unit: "EA",
      procore_code: null,
    });
    expect(mockInsertSelect).toHaveBeenCalledWith(COLUMNS);
    expect(out).toEqual({
      code: "02-4100.003",
      label: "Demolition - Openings in CMU",
      unit: "EA",
      procoreCode: null,
      source: "import_gate",
    });
  });

  it("stores a provided Procore BLI trimmed, and defaults a missing unit to ''", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockSingle.mockResolvedValueOnce({
      data: { ...insertedRow, unit: "", procore_code: "2-33543.000" },
      error: null,
    });

    const out = await createCustomStep23LineDef({
      code: "02-4100.003",
      label: "Demolition - Openings in CMU",
      procoreCode: " 2-33543.000 ",
    });

    expect(mockInsert).toHaveBeenCalledWith({
      code: "02-4100.003",
      label: "Demolition - Openings in CMU",
      unit: "",
      procore_code: "2-33543.000",
    });
    expect(out.procoreCode).toBe("2-33543.000");
  });

  it("translates a PK race (23505 after a clean pre-check) into the same 'already exists' error", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: 'duplicate key value violates unique constraint "custom_step23_line_defs_pkey"' },
    });

    await expect(createCustomStep23LineDef(valid)).rejects.toThrow("Custom code 02-4100.003 already exists");
  });

  it("THROWS with the db message on any other insert failure", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    mockSingle.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "permission denied" } });

    await expect(createCustomStep23LineDef(valid)).rejects.toThrow(
      "Failed to create custom GC/Site-Ops code 02-4100.003: permission denied"
    );
  });
});
