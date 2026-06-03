/// <reference types="vitest" />

import { normalizeUom, UOM_ALIASES } from "@/lib/uom-aliases";

// ---------------------------------------------------------------------------
// normalizeUom — Regression Suite
// ---------------------------------------------------------------------------
describe("normalizeUom", () => {

  // -------------------------------------------------------------------------
  // Core alias translations
  // -------------------------------------------------------------------------
  it("normalizes FT to LF", () => {
    expect(normalizeUom("FT")).toBe("LF");
  });

  it("normalizes FEET to LF", () => {
    expect(normalizeUom("FEET")).toBe("LF");
  });

  it("normalizes FOOT to LF", () => {
    expect(normalizeUom("FOOT")).toBe("LF");
  });

  it("normalizes SQ FT to SF", () => {
    expect(normalizeUom("SQ FT")).toBe("SF");
  });

  it("normalizes CU YD to CY", () => {
    expect(normalizeUom("CU YD")).toBe("CY");
  });

  it("normalizes EACH to EA", () => {
    expect(normalizeUom("EACH")).toBe("EA");
  });

  it("normalizes LUMP SUM to LS", () => {
    expect(normalizeUom("LUMP SUM")).toBe("LS");
  });

  // -------------------------------------------------------------------------
  // Passthrough — canonical values return unchanged
  // -------------------------------------------------------------------------
  it("passes through SF unchanged", () => {
    expect(normalizeUom("SF")).toBe("SF");
  });

  it("passes through LF unchanged", () => {
    expect(normalizeUom("LF")).toBe("LF");
  });

  it("passes through CY unchanged", () => {
    expect(normalizeUom("CY")).toBe("CY");
  });

  it("passes through EA unchanged", () => {
    expect(normalizeUom("EA")).toBe("EA");
  });

  it("passes through LS unchanged", () => {
    expect(normalizeUom("LS")).toBe("LS");
  });

  // -------------------------------------------------------------------------
  // Whitespace and case handling
  // -------------------------------------------------------------------------
  it("trims whitespace before matching", () => {
    expect(normalizeUom("  FT  ")).toBe("LF");
  });

  it("is case-insensitive", () => {
    expect(normalizeUom("ft")).toBe("LF");
    expect(normalizeUom("Ft")).toBe("LF");
    expect(normalizeUom("sq ft")).toBe("SF");
  });

  // -------------------------------------------------------------------------
  // Unknown UOM passes through as uppercase
  // -------------------------------------------------------------------------
  it("returns unknown UOM uppercased as-is", () => {
    expect(normalizeUom("CUSTOM_UNIT")).toBe("CUSTOM_UNIT");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeUom("")).toBe("");
  });

  // -------------------------------------------------------------------------
  // Alias map completeness
  // -------------------------------------------------------------------------
  it("has at least 10 alias entries", () => {
    expect(Object.keys(UOM_ALIASES).length).toBeGreaterThanOrEqual(10);
  });
});
