/**
 * Division 60 Fee-Block Addressability — Phase 1 (storage foundation).
 *
 * Proves the markup fee-line shape (`src/lib/sectionLines/markup.ts`) and that the
 * SAME section-line gateway/RPC that carries GC/Site-Ops lines round-trips a NEW
 * `section: 'markup'` line untouched (the RPC + db.ts gateway are section-agnostic —
 * only the CHECK constraint gated 'markup', and that DDL widened in Phase 1). No
 * consumer reads markup rows yet; this unit round-trip (build -> save -> reload) is
 * the Phase 1 gateway exit gate. No UI / calc / render / export is exercised.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Chainable Supabase mock (mirrors sectionLinesDb.test.ts). Terminal chains:
//   from().select(cols).eq(col,val).order(col,opts)  -> { data, error }
//   rpc(name, args)                                   -> { error }
// ---------------------------------------------------------------------------
const mockOrder = vi.fn();
const mockSelectEq = vi.fn(() => ({ order: mockOrder }));
const mockSelect = vi.fn(() => ({ eq: mockSelectEq }));
const mockRpc = vi.fn();
const mockFrom = vi.fn((...args: unknown[]) => {
  void args;
  return { select: mockSelect };
});

vi.mock("../supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import { getSectionLines, saveSectionLines } from "../db";
import {
  MARKUP_SECTION,
  isMarkupLine,
  feeLineAmount,
  newFeeLine,
} from "@/lib/sectionLines/markup";
import { isOneOffLine } from "@/lib/sectionLines/oneOff";
import type { EstimateSectionLine } from "@/types/db";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("newFeeLine — markup fee-line shape", () => {
  it("builds a flat lumpSum markup line: section='markup', amount in inputs, defaults", () => {
    const line = newFeeLine({ label: "Preconstruction Fee", amount: 2500 });

    expect(line.section).toBe(MARKUP_SECTION);
    expect(line.section).toBe("markup");
    expect(line.entryKind).toBe("lumpSum");
    expect(line.label).toBe("Preconstruction Fee");
    expect(line.inputs).toEqual({ amount: 2500 });
    expect(feeLineAmount(line)).toBe(2500);
    // Unmapped + manual by default — Procore code is BLANK until assigned (never guessed).
    expect(line.procoreCode).toBe("");
    expect(line.costType).toBe("");
    expect(line.source).toBe("manual");
    // A fee line has no STEP 2/3 criterion code; identity rides `id`.
    expect(line.code).toBe("");
    expect(line.id).toMatch(/^markup:fee:/);
    // No frozen total ever — there is no total field/column (derived, never frozen).
    expect(line).not.toHaveProperty("total");
  });

  it("each fee line gets a unique id", () => {
    const a = newFeeLine({ label: "A", amount: 1 });
    const b = newFeeLine({ label: "B", amount: 2 });
    expect(a.id).not.toBe(b.id);
  });

  it("honors an optional Procore code + import provenance", () => {
    const line = newFeeLine({
      label: "Imported Fee",
      amount: 1000,
      procoreCode: "60-4000.002",
      source: "csv_import",
    });
    expect(line.procoreCode).toBe("60-4000.002");
    expect(line.source).toBe("csv_import");
  });

  it("coerces a non-finite amount to 0", () => {
    const line = newFeeLine({ label: "Bad", amount: Number.NaN });
    expect(line.inputs).toEqual({ amount: 0 });
    expect(feeLineAmount(line)).toBe(0);
  });
});

describe("isMarkupLine / feeLineAmount readers", () => {
  it("isMarkupLine is true for a markup line, false for gc/site_ops", () => {
    expect(isMarkupLine(newFeeLine({ label: "F", amount: 5 }))).toBe(true);
    expect(isMarkupLine({ ...newFeeLine({ label: "F", amount: 5 }), section: "gc" })).toBe(false);
    expect(
      isMarkupLine({ ...newFeeLine({ label: "F", amount: 5 }), section: "site_ops" })
    ).toBe(false);
  });

  it("feeLineAmount reads inputs.amount, defaulting a missing/invalid value to 0", () => {
    const line = newFeeLine({ label: "F", amount: 42 });
    expect(feeLineAmount({ ...line, inputs: {} })).toBe(0);
    expect(feeLineAmount({ ...line, inputs: { amount: "nope" } })).toBe(0);
    expect(feeLineAmount({ ...line, inputs: { amount: 42 } })).toBe(42);
  });
});

describe("isOneOffLine guard — a markup fee line is NOT a GC/Site-Ops one-off", () => {
  it("returns false for a markup line even though it is source='manual' + lumpSum", () => {
    // A fee line shares the manual + lumpSum signature of a one-off; the section guard
    // is what keeps the two apart (Fee-Block Addressability Phase 1).
    const fee = newFeeLine({ label: "Preconstruction Fee", amount: 2500 });
    expect(fee.source).toBe("manual");
    expect(fee.entryKind).toBe("lumpSum");
    expect(isOneOffLine(fee)).toBe(false);
  });
});

describe("gateway round-trip — a markup line saves and reloads via save_section_lines", () => {
  it("payload carries section='markup' + entry_kind='lumpSum' + the amount, and reloads intact", async () => {
    mockRpc.mockResolvedValueOnce({ error: null });
    const fee = newFeeLine({ label: "Preconstruction Fee", amount: 2500 });

    await saveSectionLines("p1", [fee]);

    expect(mockRpc).toHaveBeenCalledTimes(1);
    const [fnName, args] = mockRpc.mock.calls[0];
    expect(fnName).toBe("save_section_lines");
    const saved = (args as { p_lines: Record<string, unknown>[] }).p_lines;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      id: fee.id,
      section: "markup",
      code: "",
      procore_code: "",
      cost_type: "",
      label: "Preconstruction Fee",
      entry_kind: "lumpSum",
      inputs: { amount: 2500 },
      sort_order: 0,
      source: "manual",
    });
    expect(saved[0]).not.toHaveProperty("total");

    // RELOAD from the ACTUAL saved payload (rides the real persisted shape, not a
    // hand-written duplicate) — the gateway maps the markup row straight back.
    mockOrder.mockResolvedValueOnce({
      data: [{ ...saved[0], project_id: "p1", updated_at: "2026-06-26T00:00:00.000Z" }],
      error: null,
    });

    const [reloaded] = await getSectionLines("p1");
    expect(mockFrom).toHaveBeenCalledWith("estimate_section_lines");
    expect(isMarkupLine(reloaded)).toBe(true);
    expect(reloaded.section).toBe("markup");
    expect(reloaded.entryKind).toBe("lumpSum");
    expect(reloaded.label).toBe("Preconstruction Fee");
    expect(feeLineAmount(reloaded)).toBe(2500);
    expect(reloaded.procoreCode).toBe("");
    expect(reloaded.source).toBe("manual");
  });

  it("a markup line coexists with gc/site_ops lines in the same replace payload", async () => {
    mockRpc.mockResolvedValueOnce({ error: null });
    const gc: EstimateSectionLine = {
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
      updatedAt: "",
    };
    const fee = newFeeLine({ label: "Preconstruction Fee", amount: 2500 });

    await saveSectionLines("p1", [gc, fee]);

    const saved = (mockRpc.mock.calls[0][1] as { p_lines: Record<string, unknown>[] }).p_lines;
    expect(saved.map((l) => l.section)).toEqual(["gc", "markup"]);
    expect(saved.map((l) => l.sort_order)).toEqual([0, 1]);
  });
});
