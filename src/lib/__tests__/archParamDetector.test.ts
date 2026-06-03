/// <reference types="vitest" />

import { detectArchParams, ArchParamRule } from "@/lib/archParamDetector";
import { TogalRowPayload } from "@/types";

// ---------------------------------------------------------------------------
// detectArchParams — Unit Tests
// ---------------------------------------------------------------------------
describe("detectArchParams", () => {

  // -------------------------------------------------------------------------
  // Test 1: Detects "02 - Area" as Building Footprint
  // -------------------------------------------------------------------------
  it("detects '02 - Area' classification as Building Footprint", () => {
    const rows: TogalRowPayload[] = [
      { Classification: "02 - Area", "Quantity 1": 274.01, "Quantity1 UOM": "SF" } as unknown as TogalRowPayload,
    ];

    const suggestions = detectArchParams(rows);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].label).toBe("Building Footprint");
    expect(suggestions[0].value).toBeCloseTo(274.01, 1);
    expect(suggestions[0].uom).toBe("SF");
    expect(suggestions[0].projectField).toBe("buildingFootprint");
    expect(suggestions[0].accepted).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 2: Ignores non-matching classifications
  // -------------------------------------------------------------------------
  it("returns empty array for non-matching classifications", () => {
    const rows: TogalRowPayload[] = [
      { Classification: "03-0000.002 - Footings", "Quantity 1": 100, "Quantity1 UOM": "FT" } as unknown as TogalRowPayload,
      { Classification: "Random Item", "Quantity 1": 50, "Quantity1 UOM": "SF" } as unknown as TogalRowPayload,
    ];

    const suggestions = detectArchParams(rows);
    expect(suggestions).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test 3: UOM filter skips wrong UOM
  // -------------------------------------------------------------------------
  it("skips rows where UOM does not match rule filter", () => {
    const rows: TogalRowPayload[] = [
      { Classification: "02 - Area", "Quantity 1": 100, "Quantity1 UOM": "LF" } as unknown as TogalRowPayload,
    ];

    const suggestions = detectArchParams(rows);
    expect(suggestions).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test 4: Custom rules override defaults
  // -------------------------------------------------------------------------
  it("uses custom rules when provided", () => {
    const customRules: ArchParamRule[] = [
      {
        pattern: /Perimeter/i,
        uomFilter: "LF",
        projectField: "buildingPerimeter",
        label: "Building Perimeter",
      },
    ];

    const rows: TogalRowPayload[] = [
      { Classification: "Building Perimeter", "Quantity 1": 500, "Quantity1 UOM": "LF" } as unknown as TogalRowPayload,
      { Classification: "02 - Area", "Quantity 1": 274, "Quantity1 UOM": "SF" } as unknown as TogalRowPayload,
    ];

    // Custom rules should override defaults
    const suggestions = detectArchParams(rows, customRules);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].label).toBe("Building Perimeter");
    expect(suggestions[0].value).toBe(500);
  });

  // -------------------------------------------------------------------------
  // Test 5: Multiple matching rows produce multiple suggestions
  // -------------------------------------------------------------------------
  it("returns multiple suggestions for multiple matching rows", () => {
    const customRules: ArchParamRule[] = [
      { pattern: /Area/i, projectField: "buildingFootprint", label: "Footprint" },
      { pattern: /Perimeter/i, projectField: "buildingPerimeter", label: "Perimeter" },
    ];

    const rows: TogalRowPayload[] = [
      { Classification: "02 - Area", "Quantity 1": 274, "Quantity1 UOM": "SF" } as unknown as TogalRowPayload,
      { Classification: "Building Perimeter", "Quantity 1": 100, "Quantity1 UOM": "LF" } as unknown as TogalRowPayload,
    ];

    const suggestions = detectArchParams(rows, customRules);
    expect(suggestions).toHaveLength(2);
    expect(suggestions[0].label).toBe("Footprint");
    expect(suggestions[1].label).toBe("Perimeter");
  });

  // -------------------------------------------------------------------------
  // Test 6: UOM normalization handles aliases
  // -------------------------------------------------------------------------
  it("normalizes UOM aliases (FT → LF)", () => {
    const customRules: ArchParamRule[] = [
      { pattern: /Perimeter/i, uomFilter: "LF", projectField: "buildingPerimeter", label: "Perimeter" },
    ];

    const rows: TogalRowPayload[] = [
      // "FT" should be normalized to "LF" by the detector
      { Classification: "Building Perimeter", "Quantity 1": 500, "Quantity1 UOM": "FT" } as unknown as TogalRowPayload,
    ];

    const suggestions = detectArchParams(rows, customRules);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].uom).toBe("LF");
  });
});
