/**
 * Phase 4 — computeTakeoffSummary override layer.
 *
 * An override is an INPUT layered over the computed value (override ?? computed): the
 * engine reports the override but ALWAYS retains the computed value in summary.overrides
 * (so the Phase 5 glass box shows both). With no overrides the engine is byte-identical
 * to before — the McKenna golden harness (which passes no overrides) must still tie.
 */

import { describe, it, expect } from "vitest";
import { computeTakeoffSummary, OVERRIDABLE_SUMMARY_FIELDS } from "../calculations";
import { ProcessedTakeoffRow } from "@/types";

function makeRow(overrides: Partial<ProcessedTakeoffRow> = {}): ProcessedTakeoffRow {
  return {
    id: overrides.id ?? "row-test",
    classification: overrides.classification ?? "Test",
    itemId: overrides.itemId ?? "03-1000",
    procoreParentCode: "",
    procoreCode: "",
    description: "Test",
    matchedQty: overrides.matchedQty ?? 100,
    uom: "SF",
    unitPrice: overrides.unitPrice ?? 100,
    total: 999, // deliberately wrong — must not be used
    isMapped: true,
    rawQuantities: [],
    costType: "M",
    customFields: {},
    source: "template",
    ...overrides,
  };
}

// subtotal 10,000; computed: CC 1,000, GL 100, fee 500 → total 11,600
const RATES = {
  constructionContingencyRate: 0.1,
  designContingencyRate: 0,
  buildersRiskRate: 0,
  specialInsuranceRate: 0,
  glInsuranceRate: 0.01,
  bondRate: 0,
  feeRate: 0.05,
  roundingRule: "none",
};

describe("computeTakeoffSummary — override layer (Phase 4)", () => {
  it("exposes the 9 overridable summary fields", () => {
    expect(OVERRIDABLE_SUMMARY_FIELDS).toContain("subtotal");
    expect(OVERRIDABLE_SUMMARY_FIELDS).toContain("totalEstimatedCost");
    expect(OVERRIDABLE_SUMMARY_FIELDS).toHaveLength(9);
  });

  it("is INERT when no overrides are supplied (byte-identical result; no overrides key)", () => {
    const rows = [makeRow({ matchedQty: 100, unitPrice: 100 })];
    const base = computeTakeoffSummary(rows, 1000, 10, RATES);
    const withEmpty = computeTakeoffSummary(rows, 1000, 10, RATES, undefined, {});
    expect(withEmpty).toEqual(base);
    expect(base.overrides).toBeUndefined();
  });

  it("overriding a markup uses the override and retains the computed value (INV-4 holds)", () => {
    const rows = [makeRow({ matchedQty: 100, unitPrice: 100 })];
    const base = computeTakeoffSummary(rows, 1000, 10, RATES);
    expect(base.fee).toBe(500);

    const r = computeTakeoffSummary(rows, 1000, 10, RATES, undefined, { fee: 700 });
    expect(r.fee).toBe(700); // effective value is the override
    expect(r.overrides).toEqual({ fee: { computedValue: 500, overrideValue: 700 } });

    // The displayed components still sum to the displayed total (rounding neutrality).
    const sumOfComponents =
      r.subtotal + r.constructionContingency + r.designContingency + r.buildersRisk +
      r.specialInsurance + r.glInsurance + r.bond + r.fee;
    expect(r.totalEstimatedCost).toBe(sumOfComponents);
    // Total moved by exactly the override delta vs the computed total.
    expect(r.totalEstimatedCost).toBe(base.totalEstimatedCost + (700 - 500));
  });

  it("an override of 0 is honored, not treated as 'no override' (INV-3)", () => {
    const rows = [makeRow({ matchedQty: 100, unitPrice: 100 })];
    const base = computeTakeoffSummary(rows, 1000, 10, RATES);
    const r = computeTakeoffSummary(rows, 1000, 10, RATES, undefined, { fee: 0 });
    expect(r.fee).toBe(0);
    expect(r.overrides).toEqual({ fee: { computedValue: 500, overrideValue: 0 } });
    // Total dropped by the full computed fee.
    expect(r.totalEstimatedCost).toBe(base.totalEstimatedCost - 500);
  });

  it("overriding the grand total wins and leaves the components computed", () => {
    const rows = [makeRow({ matchedQty: 100, unitPrice: 100 })];
    const base = computeTakeoffSummary(rows, 1000, 10, RATES); // total 11,600
    const r = computeTakeoffSummary(rows, 1000, 10, RATES, undefined, { totalEstimatedCost: 12000 });
    expect(r.totalEstimatedCost).toBe(12000);
    expect(r.subtotal).toBe(base.subtotal);
    expect(r.fee).toBe(base.fee);
    expect(r.overrides).toEqual({ totalEstimatedCost: { computedValue: 11600, overrideValue: 12000 } });
    // Cost-per figures follow the effective (overridden) total.
    expect(r.costPerSf).toBe(12000 / 1000);
    expect(r.costPerUnit).toBe(12000 / 10);
  });

  it("overriding the subtotal does NOT recompute the markups (no compounding)", () => {
    const rows = [makeRow({ matchedQty: 100, unitPrice: 100 })]; // subtotal 10,000
    const base = computeTakeoffSummary(rows, 1000, 10, RATES);
    const r = computeTakeoffSummary(rows, 1000, 10, RATES, undefined, { subtotal: 20000 });
    expect(r.subtotal).toBe(20000);
    // Markups stay at their computed values (off the original subtotal), not 2x.
    expect(r.constructionContingency).toBe(base.constructionContingency); // 1,000 not 2,000
    expect(r.fee).toBe(base.fee); // 500 not 1,000
    // Total = effective subtotal + computed markups.
    expect(r.totalEstimatedCost).toBe(
      20000 + base.constructionContingency + base.glInsurance + base.fee
    );
  });

  it("records multiple simultaneous overrides, each with its computed value", () => {
    const rows = [makeRow({ matchedQty: 100, unitPrice: 100 })];
    const r = computeTakeoffSummary(rows, 1000, 10, RATES, undefined, { fee: 700, glInsurance: 0 });
    expect(r.fee).toBe(700);
    expect(r.glInsurance).toBe(0);
    expect(r.overrides).toEqual({
      fee: { computedValue: 500, overrideValue: 700 },
      glInsurance: { computedValue: 100, overrideValue: 0 },
    });
  });
});
