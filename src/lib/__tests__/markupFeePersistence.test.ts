/**
 * Phase 3 — Division 60 Fee-Block Addressability: render-feed + persistence contract.
 *
 * Phase 1 proved the gateway round-trips a lone markup line; Phase 2 proved the engine
 * math. Phase 3 wires the lines into the live page, so this locks the two NEW guarantees
 * that wiring must hold — both composed from the REAL functions, never re-proving P1/P2:
 *
 *   1. SAVE-ARRAY INTEGRITY. `save_section_lines` is a FULL per-project replace across ALL
 *      sections. The page hands it gc/site_ops PLUS the loaded markup lines; if markup were
 *      dropped from that array the RPC would DELETE the fee lines. This proves the markup
 *      rows ride the save payload (after gc/site_ops) and reload split back out via
 *      `isMarkupLine` intact — the round-trip that keeps a fee line alive across a reload.
 *
 *   2. AMENDMENT-F SAME-SET. A fee line is below the subtotal and not a takeoff row, so a
 *      grid filter (which partials-out the on-screen subtotal) must NOT change the fee total.
 *      The page feeds the SAME markup set to both the filtered and the unfiltered summary;
 *      this proves `additionalFees` is byte-identical across the two while the subtotal moves.
 *
 * Every dollar originates in `computeTakeoffSummary` / `saveSectionLines` — never invented.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Chainable Supabase mock (mirrors markupFeeLine.test.ts / sectionLinesDb.test.ts).
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
import { computeTakeoffSummary, roundByRule } from "../calculations";
import { newFeeLine, isMarkupLine, feeLineAmount } from "../sectionLines/markup";
import type { ProcessedTakeoffRow } from "@/types";
import type { EstimateSectionLine } from "@/types/db";

beforeEach(() => {
  vi.clearAllMocks();
});

function gcLine(over: Partial<EstimateSectionLine> = {}): EstimateSectionLine {
  return {
    id: over.id ?? "L1",
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
    ...over,
  };
}

function makeRow(over: Partial<ProcessedTakeoffRow> = {}): ProcessedTakeoffRow {
  return {
    id: over.id ?? "row-test",
    classification: "Test",
    itemId: over.itemId ?? "03-1000",
    procoreParentCode: "",
    procoreCode: "",
    description: over.description ?? "Test",
    matchedQty: over.matchedQty ?? 100,
    uom: "SF",
    unitPrice: over.unitPrice ?? 100,
    total: 999, // deliberately wrong — must not be used
    isMapped: true,
    rawQuantities: [],
    costType: "M",
    customFields: {},
    source: "template",
    ...over,
  };
}

const RATES = {
  constructionContingencyRate: 0.03,
  designContingencyRate: 0.02,
  buildersRiskRate: 0.005,
  specialInsuranceRate: 0.004,
  glInsuranceRate: 0.01,
  bondRate: 0.012,
  feeRate: 0.05,
  roundingRule: "none",
};

describe("Phase 3 — markup lines ride the full-replace save array and reload intact", () => {
  it("the page's persist array (gc + markup) saves markup AFTER gc and reloads split-out by isMarkupLine", async () => {
    mockRpc.mockResolvedValueOnce({ error: null });

    const gc = gcLine();
    const fee1 = newFeeLine({ label: "Preconstruction Fee", amount: 2500 });
    const fee2 = newFeeLine({ label: "Allowance", amount: 1500, procoreCode: "60-4000.002" });

    // Exactly the page's `persistedSectionLines` memo: section lines FIRST, fee lines appended.
    const persistArray = [gc, fee1, fee2];
    await saveSectionLines("p1", persistArray);

    const saved = (mockRpc.mock.calls[0][1] as { p_lines: Record<string, unknown>[] }).p_lines;
    // The markup rows are NOT dropped by the full-replace — all three persist, fees last.
    expect(saved.map((l) => l.section)).toEqual(["gc", "markup", "markup"]);
    expect(saved.map((l) => l.sort_order)).toEqual([0, 1, 2]);

    // Reload from the ACTUAL persisted payload (real shape, not a hand-written duplicate).
    mockOrder.mockResolvedValueOnce({
      data: saved.map((l) => ({ ...l, project_id: "p1", updated_at: "2026-06-26T00:00:00.000Z" })),
      error: null,
    });

    const reloaded = await getSectionLines("p1");
    // The page's load split: markup lines peeled off the section-agnostic read.
    const markup = reloaded.filter(isMarkupLine);
    expect(markup).toHaveLength(2);
    expect(markup.map((l) => l.label)).toEqual(["Preconstruction Fee", "Allowance"]);
    expect(markup.map(feeLineAmount)).toEqual([2500, 1500]);
    // The mapped one keeps its code; the unmapped one stays blank (never guessed).
    expect(markup[0].procoreCode).toBe("");
    expect(markup[1].procoreCode).toBe("60-4000.002");
    // The non-markup line is untouched and stays out of the markup split.
    expect(reloaded.filter((l) => !isMarkupLine(l)).map((l) => l.section)).toEqual(["gc"]);
  });

  it("dropping markup from the save array would lose it — the array MUST carry the fee lines", async () => {
    // Documents the guardrail the page's `persistedSectionLines` memo exists to satisfy:
    // saving only gc/site_ops (the pre-Phase-3 array) sends NO markup row, so the
    // full-replace RPC deletes every fee line. The page must append the markup lines.
    mockRpc.mockResolvedValueOnce({ error: null });
    await saveSectionLines("p1", [gcLine()]); // the bug: markup omitted
    const saved = (mockRpc.mock.calls[0][1] as { p_lines: Record<string, unknown>[] }).p_lines;
    expect(saved.some((l) => l.section === "markup")).toBe(false);
  });
});

describe("Phase 3 — Amendment F: the same markup set feeds the filtered + unfiltered summary", () => {
  const allRows = [
    makeRow({ id: "r1", description: "Concrete", matchedQty: 100, unitPrice: 100 }), // 10,000
    makeRow({ id: "r2", description: "Steel", matchedQty: 50, unitPrice: 100 }), //     5,000
  ];
  const filteredRows = [allRows[0]]; // a grid filter hiding the second row
  const fees = [
    newFeeLine({ label: "Preconstruction Fee", amount: 2500 }),
    newFeeLine({ label: "Allowance", amount: 1500 }),
  ];

  it("additionalFees is identical across the filtered and unfiltered summaries; the subtotal is not", () => {
    const full = computeTakeoffSummary(allRows, 1000, 10, RATES, undefined, undefined, fees);
    const filtered = computeTakeoffSummary(filteredRows, 1000, 10, RATES, undefined, undefined, fees);

    // The subtotal DOES partial-out under the filter (row-level), proving the fixture filters.
    expect(full.subtotal).toBe(15000);
    expect(filtered.subtotal).toBe(10000);
    // The fee block does NOT — both summaries carry the whole $4,000 (fees aren't rows).
    expect(full.additionalFees).toBe(4000);
    expect(filtered.additionalFees).toBe(4000);
    expect(filtered.additionalFees).toBe(full.additionalFees);
  });

  it("the fee total raises each summary's grand total by EXACTLY the fee sum (no compounding)", () => {
    const fullNoFee = computeTakeoffSummary(allRows, 1000, 10, RATES);
    const full = computeTakeoffSummary(allRows, 1000, 10, RATES, undefined, undefined, fees);
    expect(full.totalEstimatedCost).toBe(fullNoFee.totalEstimatedCost + 4000);
    // The 7 modifiers stay byte-identical — the fee dollars never entered the markup base.
    expect(full.fee).toBe(fullNoFee.fee);
    expect(full.subtotal).toBe(fullNoFee.subtotal);
  });
});

describe("Phase 3 — the displayed fee amount (roundByRule) ties to the engine's additionalFees", () => {
  // The fee-block row renders `roundByRule(feeLineAmount(line), project.roundingRule)`; the
  // engine sums each line via the SAME helper (`applyRounding` delegates to `roundByRule`).
  // This proves a displayed line always equals its contribution to the total — no "rows
  // don't sum" leak under a non-default rounding rule (the math-trust Zero-Budget-Leaks rule).
  const rows = [makeRow({ matchedQty: 100, unitPrice: 100 })];

  it("under 'dollar' rounding, the per-line displayed amount sums to additionalFees", () => {
    const dollar = { ...RATES, roundingRule: "dollar" };
    const lines = [
      newFeeLine({ label: "a", amount: 2500.5 }), // displayed → 2501
      newFeeLine({ label: "b", amount: 999.5 }), //  displayed → 1000
    ];
    const summary = computeTakeoffSummary(rows, 1000, 10, dollar, undefined, undefined, lines);
    const displayedSum = lines.reduce((s, l) => s + roundByRule(feeLineAmount(l), "dollar"), 0);
    expect(displayedSum).toBe(2501 + 1000);
    expect(displayedSum).toBe(summary.additionalFees); // the rows tie to the total's addend
  });

  it("under the default 'none' rule, roundByRule is the identity (exact display)", () => {
    expect(roundByRule(2500.49, "none")).toBe(2500.49);
    expect(roundByRule(2500.49, "dollar")).toBe(2500);
    expect(roundByRule(2545, "ten")).toBe(2550);
    expect(roundByRule(2545, "hundred")).toBe(2500);
  });
});
