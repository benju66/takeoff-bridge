/// <reference types="vitest" />
/**
 * parser-numbers.test.ts — Phase 3 / INV-8 (#5): sign-safe US number parsing.
 *
 * Guards `parseUsNumber`: accounting parentheses and leading/trailing minus parse to a
 * NEGATIVE value (a credit must REDUCE the bid), clean US strings parse positive, and
 * genuinely ambiguous input (European format, multiple separators, malformed grouping) is
 * FLAGGED rather than silently coerced to a wrong positive number (AGENTS.md: never guess).
 * End-to-end, a parenthesized credit row reduces the takeoff subtotal.
 */

import { describe, it, expect } from "vitest";
import { parseUsNumber, parseTogalCSV } from "@/lib/parser";
import { computeTakeoffSummary } from "@/lib/calculations";
import { ESTIMATE_ITEMS_MASTER } from "@/lib/mock-data";
import type { ProcessedTakeoffRow, TogalRowPayload } from "@/types";

const NO_ROUNDING = {
  constructionContingencyRate: 0,
  designContingencyRate: 0,
  buildersRiskRate: 0,
  specialInsuranceRate: 0,
  glInsuranceRate: 0,
  bondRate: 0,
  feeRate: 0,
  roundingRule: "none" as const,
};

function makeRow(overrides: Partial<ProcessedTakeoffRow> = {}): ProcessedTakeoffRow {
  return {
    id: "r",
    classification: "Test",
    itemId: "03-1000",
    procoreParentCode: "",
    procoreCode: "",
    description: "Test",
    matchedQty: 100,
    uom: "SF",
    unitPrice: 10,
    total: 0,
    isMapped: true,
    rawQuantities: [],
    costType: "M",
    customFields: {},
    source: "csv_import",
    ...overrides,
  };
}

describe("parseUsNumber — sign handling (INV-8 #5)", () => {
  it("accounting parentheses parse to negative", () => {
    expect(parseUsNumber("(1,234.50)")).toEqual({ value: -1234.5, ambiguous: false });
  });

  it("leading minus parses to negative", () => {
    expect(parseUsNumber("-1,234.50")).toEqual({ value: -1234.5, ambiguous: false });
  });

  it("trailing minus parses to negative (parseFloat drops this today)", () => {
    expect(parseUsNumber("1,234.50- ")).toEqual({ value: -1234.5, ambiguous: false });
  });

  it("a clean US number parses positive", () => {
    expect(parseUsNumber("1,234.50")).toEqual({ value: 1234.5, ambiguous: false });
  });

  it("multi-group US thousands parse", () => {
    expect(parseUsNumber("1,234,567")).toEqual({ value: 1234567, ambiguous: false });
  });

  it("leading-dot decimal parses", () => {
    expect(parseUsNumber(".5")).toEqual({ value: 0.5, ambiguous: false });
  });
});

describe("parseUsNumber — pass-through & empties", () => {
  it("a JS number passes through unchanged", () => {
    expect(parseUsNumber(42)).toEqual({ value: 42, ambiguous: false });
    expect(parseUsNumber(-7.25)).toEqual({ value: -7.25, ambiguous: false });
  });

  it("empty / null / undefined → 0, not ambiguous", () => {
    expect(parseUsNumber("")).toEqual({ value: 0, ambiguous: false });
    expect(parseUsNumber(null)).toEqual({ value: 0, ambiguous: false });
    expect(parseUsNumber(undefined)).toEqual({ value: 0, ambiguous: false });
  });

  it("an explicit zero stays zero (INV-3 extension), and a negated zero is plain 0", () => {
    expect(parseUsNumber("0")).toEqual({ value: 0, ambiguous: false });
    expect(Object.is(parseUsNumber("(0)").value, 0)).toBe(true); // not -0
  });
});

describe("parseUsNumber — ambiguous input is flagged, never guessed", () => {
  it.each([
    ["1.234,50"], // European decimal-comma
    ["1.2.3"], //     multiple dots (European thousands)
    ["1,2,3"], //     malformed thousands grouping
    ["1,23"], //      group not 3 digits
    ["12,3456"], //   group not 3 digits
    ["abc"], //       not a number
    ["1,234.5.6"], // two dots
    ["-"], //         lone sign, no digits
  ])("flags %s as ambiguous with value 0", (input) => {
    expect(parseUsNumber(input)).toEqual({ value: 0, ambiguous: true });
  });
});

describe("INV-8 #5 end-to-end — a credit reduces the subtotal", () => {
  const CODE = "03-0000.002"; // Footings — present in the catalog
  const item = ESTIMATE_ITEMS_MASTER[CODE];

  const fileRow = (qty: string): TogalRowPayload => ({
    Classification: `${CODE} - Footings`,
    "Quantity 1": qty,
    "Quantity1 UOM": item.targetUom, // force the chosen measurement to column 1
  });

  it("a parenthesized credit imports as a NEGATIVE quantity (not silently positive)", () => {
    const credit = parseTogalCSV([fileRow("(100)")]);
    expect(credit[0].itemId).toBe(CODE);
    expect(credit[0].matchedQty).toBe(-100);
    expect(credit[0].needsReview).toBeUndefined(); // a valid negative is NOT a review case
  });

  it("the credit row lowers the takeoff subtotal vs the same magnitude positive", () => {
    const positive = computeTakeoffSummary(
      [makeRow({ matchedQty: 100, unitPrice: 25 })], 1000, 10, NO_ROUNDING,
    );
    const withCredit = computeTakeoffSummary(
      [
        makeRow({ id: "a", matchedQty: 100, unitPrice: 25 }),
        makeRow({ id: "b", itemId: "05-1000", matchedQty: -40, unitPrice: 25 }), // credit
      ],
      1000, 10, NO_ROUNDING,
    );
    expect(withCredit.takeoffSubtotal).toBeLessThan(positive.takeoffSubtotal);
    expect(withCredit.takeoffSubtotal).toBe(100 * 25 + -40 * 25); // 1,500, not 3,500
  });
});

describe("parseTogalCSV — ambiguous quantity flags the row for review (INV-8 #5)", () => {
  it("an ambiguous quantity is NOT trusted: qty 0 + needsReview", () => {
    const rows = parseTogalCSV([
      { Classification: "Slab on Grade", "Quantity 1": "1.234,50", "Quantity1 UOM": "SF" } as TogalRowPayload,
    ]);
    expect(rows[0].matchedQty).toBe(0); // never the wrong 1.2345 or 123450
    expect(rows[0].needsReview).toBe(true);
  });
});
