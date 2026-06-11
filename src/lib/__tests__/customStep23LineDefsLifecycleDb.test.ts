/**
 * Catalog Manager Phase 2 — the lifecycle WRITE surface in db.ts
 * (updateCustomStep23LineDef / retireCustomStep23LineDef /
 * mergeCustomStep23LineDef). These mirror the DB lifecycle guard trigger
 * client-side for clean error messages; the trigger is the backstop. A def is a
 * label, resolver target, and mining key only — none of these writes moves a
 * dollar. Mock shape mirrors customStep23LineDefsDb.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockOrder = vi.fn(); // from().select(COLUMNS).order()  — getCustomStep23LineDefs
const mockMaybeSingle = vi.fn(); // from().select(COLUMNS).eq().maybeSingle() — fetch one
const mockSingle = vi.fn(); // from().update().eq().select(COLUMNS).single() — write result
const mockIn = vi.fn(); // from().update().in()                — chain-collapse sweep

const mockSelectEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = vi.fn(() => ({ order: mockOrder, eq: mockSelectEq }));
const mockUpdateSelect = vi.fn(() => ({ single: mockSingle }));
const mockUpdateEq = vi.fn(() => ({ select: mockUpdateSelect }));
const mockUpdate = vi.fn((..._args: unknown[]) => ({ eq: mockUpdateEq, in: mockIn }));
const mockFrom = vi.fn((..._args: unknown[]) => ({ select: mockSelect, update: mockUpdate }));

vi.mock("../supabase", () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

import {
  updateCustomStep23LineDef,
  retireCustomStep23LineDef,
  mergeCustomStep23LineDef,
} from "../db";
import { activeStep23Defs } from "../step23Normalization";
import { PROCORE_VALID_CODES } from "../procoreValidCodes";

beforeEach(() => vi.clearAllMocks());

const COLUMNS = "code, label, unit, procore_code, source, status, merged_into";

// A real built-in GC/Site-Ops code (guaranteed active) and a real valid Procore
// code, so the winner/BLI validations exercise the production oracles.
const BUILT_IN_CODE = activeStep23Defs()[0].code;
const VALID_PROCORE = PROCORE_VALID_CODES[0].code;

const activeRow = {
  code: "02-4100.003",
  label: "Demolition - Openings in CMU",
  unit: "EA",
  procore_code: null,
  source: "import_gate",
  status: "active",
  merged_into: null,
};

/** Queue the fetchCustomStep23LineDef() read (select().eq().maybeSingle()). */
function fetchReturns(row: Record<string, unknown> | null) {
  mockMaybeSingle.mockResolvedValueOnce({ data: row, error: null });
}
/** Queue the write result (update().eq().select().single()). */
function writeReturns(row: Record<string, unknown>) {
  mockSingle.mockResolvedValueOnce({ data: row, error: null });
}

describe("updateCustomStep23LineDef", () => {
  it("edits name + unit + Procore BLI on an active code and returns the mapped row", async () => {
    fetchReturns(activeRow);
    writeReturns({ ...activeRow, label: "Demo - CMU Openings", unit: "SF", procore_code: VALID_PROCORE });

    const out = await updateCustomStep23LineDef({
      code: " 02-4100.003 ",
      label: "  Demo - CMU Openings ",
      unit: " sf ",
      procoreCode: ` ${VALID_PROCORE} `,
    });

    expect(mockUpdate).toHaveBeenCalledWith({ label: "Demo - CMU Openings", unit: "SF", procore_code: VALID_PROCORE });
    expect(mockUpdateEq).toHaveBeenCalledWith("code", "02-4100.003");
    expect(mockUpdateSelect).toHaveBeenCalledWith(COLUMNS);
    expect(out).toEqual({
      code: "02-4100.003",
      label: "Demo - CMU Openings",
      unit: "SF",
      procoreCode: VALID_PROCORE,
      source: "import_gate",
      status: "active",
      mergedInto: null,
    });
  });

  it("updates only the supplied fields (partial edit)", async () => {
    fetchReturns(activeRow);
    writeReturns({ ...activeRow, unit: "LF" });

    await updateCustomStep23LineDef({ code: "02-4100.003", unit: "lf" });

    expect(mockUpdate).toHaveBeenCalledWith({ unit: "LF" });
  });

  it("clears the Procore BLI when given a blank string (stores NULL)", async () => {
    fetchReturns({ ...activeRow, procore_code: VALID_PROCORE });
    writeReturns({ ...activeRow, procore_code: null });

    const out = await updateCustomStep23LineDef({ code: "02-4100.003", procoreCode: "   " });

    expect(mockUpdate).toHaveBeenCalledWith({ procore_code: null });
    expect(out.procoreCode).toBeNull();
  });

  it("rejects a Procore code that is NOT on the Importer list WITHOUT writing", async () => {
    fetchReturns(activeRow);
    await expect(
      updateCustomStep23LineDef({ code: "02-4100.003", procoreCode: "9-99999.999" })
    ).rejects.toThrow(/not on the Importer Data Fields list/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects an empty name WITHOUT writing", async () => {
    fetchReturns(activeRow);
    await expect(updateCustomStep23LineDef({ code: "02-4100.003", label: "   " })).rejects.toThrow(
      /needs a non-empty name/
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects an empty patch (nothing to update) WITHOUT writing", async () => {
    fetchReturns(activeRow);
    await expect(updateCustomStep23LineDef({ code: "02-4100.003" })).rejects.toThrow(/Nothing to update/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects editing a RETIRED code (active-only) WITHOUT writing", async () => {
    fetchReturns({ ...activeRow, status: "retired" });
    await expect(updateCustomStep23LineDef({ code: "02-4100.003", label: "x" })).rejects.toThrow(
      /is retired; only active codes can be edited/
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("throws when the code does not exist", async () => {
    fetchReturns(null);
    await expect(updateCustomStep23LineDef({ code: "02-4100.003", label: "x" })).rejects.toThrow(
      "Custom code 02-4100.003 not found"
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("retireCustomStep23LineDef", () => {
  it("retires an active code (status=retired, merged_into=null) and returns the mapped row", async () => {
    fetchReturns(activeRow);
    writeReturns({ ...activeRow, status: "retired" });

    const out = await retireCustomStep23LineDef(" 02-4100.003 ");

    expect(mockUpdate).toHaveBeenCalledWith({ status: "retired", merged_into: null });
    expect(mockUpdateEq).toHaveBeenCalledWith("code", "02-4100.003");
    expect(out.status).toBe("retired");
    expect(out.mergedInto).toBeNull();
  });

  it("rejects retiring an already-merged code WITHOUT writing", async () => {
    fetchReturns({ ...activeRow, status: "merged", merged_into: BUILT_IN_CODE });
    await expect(retireCustomStep23LineDef("02-4100.003")).rejects.toThrow(
      /is merged; only active codes can be retired or merged/
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("throws when the code does not exist", async () => {
    fetchReturns(null);
    await expect(retireCustomStep23LineDef("02-4100.003")).rejects.toThrow("Custom code 02-4100.003 not found");
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("mergeCustomStep23LineDef", () => {
  it("merges an active code into an active BUILT-IN winner; no followers => no sweep", async () => {
    mockOrder.mockResolvedValueOnce({ data: [activeRow], error: null });
    writeReturns({ ...activeRow, status: "merged", merged_into: BUILT_IN_CODE });

    const out = await mergeCustomStep23LineDef(" 02-4100.003 ", ` ${BUILT_IN_CODE} `);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({ status: "merged", merged_into: BUILT_IN_CODE });
    expect(mockUpdateEq).toHaveBeenCalledWith("code", "02-4100.003");
    expect(mockIn).not.toHaveBeenCalled();
    expect(out).toMatchObject({ code: "02-4100.003", status: "merged", mergedInto: BUILT_IN_CODE });
  });

  it("merges into another active CUSTOM winner", async () => {
    const winner = { ...activeRow, code: "02-4100.009", label: "Demo (canonical)" };
    mockOrder.mockResolvedValueOnce({ data: [activeRow, winner], error: null });
    writeReturns({ ...activeRow, status: "merged", merged_into: "02-4100.009" });

    await mergeCustomStep23LineDef("02-4100.003", "02-4100.009");

    expect(mockUpdate).toHaveBeenCalledWith({ status: "merged", merged_into: "02-4100.009" });
  });

  it("re-points existing followers onto the winner (chain-collapse sweep)", async () => {
    const follower1 = { ...activeRow, code: "02-4100.001", status: "merged", merged_into: "02-4100.003" };
    const follower2 = { ...activeRow, code: "02-4100.002", status: "merged", merged_into: "02-4100.003" };
    const unrelated = { ...activeRow, code: "02-4100.007", status: "merged", merged_into: "09-9999.999" };
    mockOrder.mockResolvedValueOnce({ data: [activeRow, follower1, follower2, unrelated], error: null });
    writeReturns({ ...activeRow, status: "merged", merged_into: BUILT_IN_CODE });
    mockIn.mockResolvedValueOnce({ error: null });

    await mergeCustomStep23LineDef("02-4100.003", BUILT_IN_CODE);

    expect(mockUpdate).toHaveBeenCalledTimes(2);
    // first: tombstone the loser; second: re-point only its own followers.
    expect(mockUpdate).toHaveBeenNthCalledWith(1, { status: "merged", merged_into: BUILT_IN_CODE });
    expect(mockUpdate).toHaveBeenNthCalledWith(2, { merged_into: BUILT_IN_CODE });
    expect(mockIn).toHaveBeenCalledWith("code", ["02-4100.001", "02-4100.002"]);
  });

  it("rejects merging a code into ITSELF WITHOUT writing", async () => {
    mockOrder.mockResolvedValueOnce({ data: [activeRow], error: null });
    await expect(mergeCustomStep23LineDef("02-4100.003", "02-4100.003")).rejects.toThrow(/cannot be merged into itself/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects a winner that is not an active def WITHOUT writing", async () => {
    const retiredWinner = { ...activeRow, code: "02-4100.009", status: "retired" };
    mockOrder.mockResolvedValueOnce({ data: [activeRow, retiredWinner], error: null });
    await expect(mergeCustomStep23LineDef("02-4100.003", "02-4100.009")).rejects.toThrow(
      /must be an active GC\/Site-Ops code/
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects merging a non-active loser WITHOUT writing", async () => {
    const retiredLoser = { ...activeRow, status: "retired" };
    mockOrder.mockResolvedValueOnce({ data: [retiredLoser], error: null });
    await expect(mergeCustomStep23LineDef("02-4100.003", BUILT_IN_CODE)).rejects.toThrow(
      /is retired; only active codes can be retired or merged/
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("throws when the losing code does not exist", async () => {
    mockOrder.mockResolvedValueOnce({ data: [], error: null });
    await expect(mergeCustomStep23LineDef("02-4100.003", BUILT_IN_CODE)).rejects.toThrow(
      "Custom code 02-4100.003 not found"
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
