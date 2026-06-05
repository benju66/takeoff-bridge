import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  primeCostCodeResolver,
  primeCostCodeResolverFromCatalog,
  resolveProcoreCode,
  resetCostCodeResolver,
} from "../costCodeResolver";
import { ESTIMATE_ITEMS_MASTER } from "../mock-data";
import type { CostCodeMapEntry } from "@/types/db";

const entry = (
  internalCode: string,
  procoreCode: string,
  source: CostCodeMapEntry["source"] = "template"
): CostCodeMapEntry => ({
  templateName: "Company_Estimate_Template.xlsx",
  internalCode,
  procoreCode,
  source,
});

describe("Phase 3c — resolveProcoreCode chokepoint", () => {
  beforeEach(() => {
    resetCostCodeResolver();
  });

  afterEach(() => {
    resetCostCodeResolver();
    vi.restoreAllMocks();
  });

  it("returns '' when unprimed — never invents a mapping (export gate catches it)", () => {
    expect(resolveProcoreCode("03-0000.002")).toBe("");
  });

  it("resolves from the primed cost_code_map entries, not the catalog", () => {
    // Deliberately diverge from the catalog value to prove the map wins —
    // this is the exact post-mapping-editor-edit scenario.
    const catalogValue = ESTIMATE_ITEMS_MASTER["03-0000.002"].procoreCode;
    const editedValue = "6-64100.000";
    expect(editedValue).not.toBe(catalogValue);

    primeCostCodeResolver([entry("03-0000.002", editedValue, "manual")]);

    expect(resolveProcoreCode("03-0000.002")).toBe(editedValue);
  });

  it("returns '' on a miss even when primed", () => {
    primeCostCodeResolver([entry("03-0000.002", "3-30000.000")]);
    expect(resolveProcoreCode("99-9999.999")).toBe("");
  });

  it("re-priming replaces the previous mapping (visibility re-prime path)", () => {
    primeCostCodeResolver([entry("03-0000.002", "3-30000.000")]);
    expect(resolveProcoreCode("03-0000.002")).toBe("3-30000.000");

    primeCostCodeResolver([entry("03-0000.002", "6-64100.000", "manual")]);
    expect(resolveProcoreCode("03-0000.002")).toBe("6-64100.000");
  });

  it("catalog fallback primes every catalog itemId with its catalog procoreCode (degraded path)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    primeCostCodeResolverFromCatalog();

    expect(warn).toHaveBeenCalledOnce();
    for (const item of Object.values(ESTIMATE_ITEMS_MASTER)) {
      expect(resolveProcoreCode(item.itemId)).toBe(item.procoreCode);
    }
  });

  it("reset clears the cache back to unprimed", () => {
    primeCostCodeResolver([entry("03-0000.002", "3-30000.000")]);
    resetCostCodeResolver();
    expect(resolveProcoreCode("03-0000.002")).toBe("");
  });
});
