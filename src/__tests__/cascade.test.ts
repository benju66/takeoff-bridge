/**
 * cascade.ts — the classification-cascade rule, including the imported-row
 * independence gate (Import past bids — Phase 1). Pure-node; no DOM.
 */

import { describe, it, expect } from "vitest";
import { cascadeEligible, cascadesToSibling } from "../lib/cascade";
import type { ProcessedTakeoffRow } from "../types";

function row(overrides: Partial<ProcessedTakeoffRow>): ProcessedTakeoffRow {
  return {
    id: "r",
    classification: "Concrete Footings",
    itemId: "",
    procoreParentCode: "",
    procoreCode: "",
    description: "",
    matchedQty: 0,
    uom: "SF",
    unitPrice: 0,
    total: 0,
    isMapped: false,
    rawQuantities: [],
    costType: "M",
    source: "csv_import",
    ...overrides,
  };
}

describe("cascade rule", () => {
  it("a CSV row with a real classification is cascade-eligible", () => {
    expect(cascadeEligible(row({ source: "csv_import" }))).toBe(true);
  });

  it("a MANUAL ENTRY row is not cascade-eligible", () => {
    expect(cascadeEligible(row({ classification: "MANUAL ENTRY" }))).toBe(false);
  });

  it("an imported row is never cascade-eligible (independence)", () => {
    expect(cascadeEligible(row({ source: "imported" }))).toBe(false);
  });

  it("two CSV rows sharing a classification cascade together", () => {
    const a = row({ id: "a", source: "csv_import" });
    const b = row({ id: "b", source: "csv_import" });
    expect(cascadesToSibling(a, b)).toBe(true);
  });

  it("does NOT cascade onto an imported sibling sharing the classification", () => {
    const a = row({ id: "a", source: "csv_import" });
    const importedSibling = row({ id: "b", source: "imported" });
    expect(cascadesToSibling(a, importedSibling)).toBe(false);
  });

  it("an imported edited row does NOT cascade to any sibling", () => {
    const importedEdited = row({ id: "a", source: "imported" });
    const csvSibling = row({ id: "b", source: "csv_import" });
    expect(cascadesToSibling(importedEdited, csvSibling)).toBe(false);
  });

  it("does not cascade across different classifications", () => {
    const a = row({ id: "a", classification: "Concrete Footings" });
    const b = row({ id: "b", classification: "Aluminum Storefront - Exterior" });
    expect(cascadesToSibling(a, b)).toBe(false);
  });
});
