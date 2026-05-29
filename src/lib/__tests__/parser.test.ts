/// <reference types="vitest" />

import { parseTogalCSV } from "@/lib/parser";
import { INITIAL_MAPPING_REGISTRY } from "@/lib/mock-data";
import type { TogalRowPayload } from "@/types";

// ---------------------------------------------------------------------------
// Helper — builds a minimal TogalRowPayload for test fixtures
// ---------------------------------------------------------------------------
function makeRow(overrides: Partial<TogalRowPayload> & { Classification: string }): TogalRowPayload {
  return {
    "Quantity 1": 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseTogalCSV — Regression Suite
// ---------------------------------------------------------------------------
describe("parseTogalCSV", () => {

  // -------------------------------------------------------------------------
  // Test 1: Exact-case match from INITIAL_MAPPING_REGISTRY
  // -------------------------------------------------------------------------
  it("resolves an exact-case classification via INITIAL_MAPPING_REGISTRY", () => {
    const rows: TogalRowPayload[] = [
      makeRow({ Classification: "Slab on Grade", "Quantity 1": "1500", "Quantity1 UOM": "SF" }),
    ];

    const result = parseTogalCSV(rows);

    expect(result).toHaveLength(1);
    expect(result[0].itemId).toBe(INITIAL_MAPPING_REGISTRY["Slab on Grade"]);
    expect(result[0].isMapped).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 2: Case-insensitive fallback match
  // -------------------------------------------------------------------------
  it("resolves a lowercase classification via normalized fallback", () => {
    const rows: TogalRowPayload[] = [
      makeRow({ Classification: "slab on grade", "Quantity 1": "1500", "Quantity1 UOM": "SF" }),
    ];

    const result = parseTogalCSV(rows);

    expect(result).toHaveLength(1);
    expect(result[0].itemId).toBe("03-0000.001");
    expect(result[0].isMapped).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 3: User registry priority over global and initial
  // -------------------------------------------------------------------------
  it("gives userRegistry priority over globalRegistry and INITIAL_MAPPING_REGISTRY", () => {
    const rows: TogalRowPayload[] = [
      makeRow({ Classification: "Slab on Grade", "Quantity 1": "500", "Quantity1 UOM": "SF" }),
    ];

    const userRegistry = { "Slab on Grade": "99-USER.001" };
    const globalRegistry = { "Slab on Grade": "99-GLOBAL.001" };

    const result = parseTogalCSV(rows, userRegistry, globalRegistry);

    expect(result).toHaveLength(1);
    expect(result[0].itemId).toBe("99-USER.001");
  });

  // -------------------------------------------------------------------------
  // Test 4: Unmapped classification produces correct fallback fields
  // -------------------------------------------------------------------------
  it("returns isMapped: false with fallback defaults for an unknown classification", () => {
    const rows: TogalRowPayload[] = [
      makeRow({ Classification: "Unknown Widget XYZ" }),
    ];

    const result = parseTogalCSV(rows);

    expect(result).toHaveLength(1);
    expect(result[0].isMapped).toBe(false);
    expect(result[0].costType).toBe("M");
    expect(result[0].description).toBe("UNMAPPED - RECONCILE CODE");
    expect(result[0].itemId).toBe("");
  });

  // -------------------------------------------------------------------------
  // Test 5: Empty classification is filtered out
  // -------------------------------------------------------------------------
  it("filters out rows with empty classification", () => {
    const rows: TogalRowPayload[] = [
      makeRow({ Classification: "" }),
      makeRow({ Classification: "Slab on Grade", "Quantity 1": "100", "Quantity1 UOM": "SF" }),
    ];

    const result = parseTogalCSV(rows);

    expect(result).toHaveLength(1);
    expect(result[0].classification).toBe("Slab on Grade");
  });

  // -------------------------------------------------------------------------
  // Test 6: Missing quantity columns default to 0
  // -------------------------------------------------------------------------
  it("defaults matchedQty to 0 when quantity columns are missing", () => {
    const rows: TogalRowPayload[] = [
      { Classification: "Unknown Item" } as TogalRowPayload,
    ];

    const result = parseTogalCSV(rows);

    expect(result).toHaveLength(1);
    expect(result[0].matchedQty).toBe(0);
    expect(result[0].rawQuantities[0].qty).toBe(0);
    expect(result[0].rawQuantities[1].qty).toBe(0);
    expect(result[0].rawQuantities[2].qty).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 7: Duplicate normalized key emits console.warn
  // -------------------------------------------------------------------------
  it("emits console.warn when a registry has duplicate normalized keys", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const rows: TogalRowPayload[] = [
      makeRow({ Classification: "Foo Item", "Quantity 1": "10", "Quantity1 UOM": "SF" }),
    ];

    const userRegistry = {
      "Foo Item": "01-0001.001",
      "foo item": "01-0002.001",
    };

    parseTogalCSV(rows, userRegistry);

    expect(warnSpy).toHaveBeenCalledWith(
      "Duplicate normalized key detected in registry: foo item"
    );

    warnSpy.mockRestore();
  });
});
