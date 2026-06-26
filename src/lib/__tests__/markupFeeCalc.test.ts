/**
 * Phase 2 — Division 60 Fee-Block Addressability: calc-engine math for markup fee lines.
 *
 * Proves that a `section='markup'` fee line is a FLAT addend applied AFTER the subtotal +
 * the 7 modifiers — never marked up, never in the markup base (no compounding) — and that
 * the layering / rounding / override contract holds:
 *   - EXIT CRITERION: a single flat $2,500 line raises totalEstimatedCost by EXACTLY $2,500
 *     while subtotal and all 7 modifiers stay BYTE-IDENTICAL (no compounding into the base).
 *   - INERT: omitted / empty markup lines leave every field byte-identical to today;
 *     additionalFees === 0 and no `overrides` key is minted (mirrors the override layer's
 *     "fully inert when absent" property).
 *   - PER-LINE ROUNDING: each fee line rounds INDEPENDENTLY (visual-sum alignment), exactly
 *     like the modifiers — not summed-then-rounded.
 *   - PER-LINE OVERRIDE: a `line:<id>:total` type-over substitutes that line's amount,
 *     reconciles into the total (INV-4), and is recorded in `summary.overrides` (Trust
 *     Inspector attribution) — mirroring GC/Site-Ops one-off line totals.
 *   - DIRECT TOTAL OVERRIDE still wins over additionalFees.
 *   - DEFENSIVE FILTER: a stray gc/site_ops line passed here cannot leak into the total.
 *   - GRAPH ECHO: the summary tier emits an `additionalFees` node echoing the value, and the
 *     totalEstimatedCost node edges to it (the depends-on graph stays honest).
 *
 * NB: `markupLines` is the 7th positional arg of computeTakeoffSummary
 * (rows, sf, units, rates, linkedTotals, overrides, markupLines) — calls below pass
 * `undefined` for the linkedTotals/overrides slots they don't exercise.
 *
 * Every number originates in `computeTakeoffSummary` (the calc authority) — never invented.
 */

import { describe, it, expect } from "vitest";
import {
  computeTakeoffSummary,
  computePersonnelCosts,
  computeSiteOperations,
} from "../calculations";
import { newFeeLine, MARKUP_SECTION } from "../sectionLines/markup";
import { sectionLineTotalOverrideKey } from "../sectionLines/ids";
import { describeEngineGraph } from "../bindings/engineGraph";
import { summaryNodeId } from "../bindings/types";
import type { ProcessedTakeoffRow } from "@/types";
import type { EstimateSectionLine } from "@/types/db";

function makeRow(over: Partial<ProcessedTakeoffRow> = {}): ProcessedTakeoffRow {
  return {
    id: over.id ?? "row-test",
    classification: "Test",
    itemId: over.itemId ?? "03-1000",
    procoreParentCode: "",
    procoreCode: "",
    description: "Test",
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

// subtotal 10,000 from a single takeoff row.
const ROWS = [makeRow({ matchedQty: 100, unitPrice: 100 })];

// All 7 modifiers non-zero so a compounding bug would be visible; no rounding for the
// to-the-cent exit-criterion proof.
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

/** Subtotal + the 7 modifiers — the fields a fee line must NOT disturb (no compounding). */
const NON_FEE_COMPONENTS = [
  "subtotal",
  "constructionContingency",
  "designContingency",
  "buildersRisk",
  "specialInsurance",
  "glInsurance",
  "bond",
  "fee",
] as const;

describe("computeTakeoffSummary — Division 60 markup fee lines (Phase 2)", () => {
  it("a flat $2,500 line raises totalEstimatedCost by EXACTLY $2,500; subtotal + 7 modifiers byte-identical", () => {
    const base = computeTakeoffSummary(ROWS, 1000, 10, RATES);
    expect(base.additionalFees).toBe(0); // baseline is inert

    const fee = newFeeLine({ label: "Preconstruction Fee", amount: 2500 });
    const withFee = computeTakeoffSummary(ROWS, 1000, 10, RATES, undefined, undefined, [fee]);

    expect(withFee.additionalFees).toBe(2500);
    expect(withFee.totalEstimatedCost).toBe(base.totalEstimatedCost + 2500);
    // The new dollars never entered the markup base — every other component is unchanged.
    for (const k of NON_FEE_COMPONENTS) expect(withFee[k]).toBe(base[k]);
  });

  it("is INERT with omitted/empty markup lines (byte-identical; additionalFees 0; no overrides key)", () => {
    const omitted = computeTakeoffSummary(ROWS, 1000, 10, RATES);
    const empty = computeTakeoffSummary(ROWS, 1000, 10, RATES, undefined, undefined, []);
    expect(empty).toEqual(omitted);
    expect(omitted.additionalFees).toBe(0);
    expect(omitted.overrides).toBeUndefined();
  });

  it("does NOT compound: with a fee line present each modifier is still subtotal × rate", () => {
    const fee = newFeeLine({ label: "Precon", amount: 2500 });
    const r = computeTakeoffSummary(ROWS, 1000, 10, RATES, undefined, undefined, [fee]);
    expect(r.subtotal).toBe(10000); // additionalFees is NOT in the subtotal
    expect(r.fee).toBeCloseTo(r.subtotal * 0.05, 6);
    expect(r.constructionContingency).toBeCloseTo(r.subtotal * 0.03, 6);
    expect(r.bond).toBeCloseTo(r.subtotal * 0.012, 6);
  });

  it("sums multiple fee lines", () => {
    const lines = [
      newFeeLine({ label: "Precon", amount: 2500 }),
      newFeeLine({ label: "Allowance", amount: 1500 }),
    ];
    const r = computeTakeoffSummary(ROWS, 1000, 10, RATES, undefined, undefined, lines);
    expect(r.additionalFees).toBe(4000);
  });

  it("rounds each fee line INDEPENDENTLY (not summed-then-rounded)", () => {
    const dollar = { ...RATES, roundingRule: "dollar" };
    const lines = [
      newFeeLine({ label: "a", amount: 2500.5 }), // → 2501 on its own
      newFeeLine({ label: "b", amount: 999.5 }), //  → 1000 on its own
    ];
    const r = computeTakeoffSummary(ROWS, 1000, 10, dollar, undefined, undefined, lines);
    // Independent per-line rounding: 2501 + 1000 = 3501.
    expect(r.additionalFees).toBe(3501);
    // Summing the raw amounts first (3500.0) then rounding would give 3500 — a different
    // answer. Independent rounding is what keeps the displayed lines tying to the total.
    expect(r.additionalFees).not.toBe(3500);
  });

  it("a per-line line:<id>:total override substitutes the amount, reconciles into the total, and is recorded", () => {
    const fee = newFeeLine({ label: "Precon", amount: 2500 });
    const withFee = computeTakeoffSummary(ROWS, 1000, 10, RATES, undefined, undefined, [fee]);

    const key = sectionLineTotalOverrideKey(fee.id);
    const r = computeTakeoffSummary(ROWS, 1000, 10, RATES, undefined, { [key]: 4000 }, [fee]);

    expect(r.additionalFees).toBe(4000); // effective value is the override
    // Total moved by exactly the override delta (INV-4 — the override reconciles in).
    expect(r.totalEstimatedCost).toBe(withFee.totalEstimatedCost + (4000 - 2500));
    // Recorded computed→override pair for Trust Inspector attribution.
    expect(r.overrides?.[key]).toEqual({ computedValue: 2500, overrideValue: 4000 });
  });

  it("an override of 0 on a fee line is honored (INV-3)", () => {
    const fee = newFeeLine({ label: "Precon", amount: 2500 });
    const key = sectionLineTotalOverrideKey(fee.id);
    const r = computeTakeoffSummary(ROWS, 1000, 10, RATES, undefined, { [key]: 0 }, [fee]);
    expect(r.additionalFees).toBe(0);
    expect(r.overrides?.[key]).toEqual({ computedValue: 2500, overrideValue: 0 });
  });

  it("a DIRECT totalEstimatedCost override still wins over additionalFees", () => {
    const fee = newFeeLine({ label: "Precon", amount: 2500 });
    const withFee = computeTakeoffSummary(ROWS, 1000, 10, RATES, undefined, undefined, [fee]);
    const r = computeTakeoffSummary(ROWS, 1000, 10, RATES, undefined, { totalEstimatedCost: 99999 }, [fee]);
    expect(r.totalEstimatedCost).toBe(99999);
    expect(r.additionalFees).toBe(2500); // still reported as a component
    // The computed baseline recorded for the audit INCLUDES the fee line.
    expect(r.overrides?.totalEstimatedCost).toEqual({
      computedValue: withFee.totalEstimatedCost,
      overrideValue: 99999,
    });
  });

  it("defensively ignores a non-markup (gc/site_ops) line passed as a markup line", () => {
    const strayGc: EstimateSectionLine = {
      ...newFeeLine({ label: "stray", amount: 5000 }),
      section: "gc",
    };
    const r = computeTakeoffSummary(ROWS, 1000, 10, RATES, undefined, undefined, [strayGc]);
    expect(r.additionalFees).toBe(0);
    expect(strayGc.section).not.toBe(MARKUP_SECTION); // sanity: the fixture really is non-markup
  });

  it("the engine graph emits an additionalFees node that echoes the value; the total edges to it", () => {
    const fee = newFeeLine({ label: "Precon", amount: 2500 });
    const summary = computeTakeoffSummary(ROWS, 1000, 10, RATES, undefined, undefined, [fee]);
    // The summary tier reads only `summary`; pass trivial engine results for the signature.
    const gc = computePersonnelCosts(0, 0, {}, { dumpsters: 0, toilets: 0, electric: 0 });
    const so = computeSiteOperations(0, 0, {}, {});
    const nodes = describeEngineGraph(gc, so, ROWS, summary, "summary");

    const feesNode = nodes.find((n) => n.id === summaryNodeId("additionalFees"));
    expect(feesNode).toBeDefined();
    expect(feesNode!.evaluate(new Map())).toBe(2500); // echo, not re-derived
    expect(feesNode!.inputs).toEqual([]); // a cross-page leaf in this tier

    const totalNode = nodes.find((n) => n.id === summaryNodeId("totalEstimatedCost"));
    expect(totalNode!.inputs).toContain(summaryNodeId("additionalFees"));
  });
});
