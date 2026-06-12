import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";
import {
  computeTypeReconciliation,
  estimateCostTypeToProcore,
  type MappingForReconciliation,
} from "@/lib/procoreTypeReconciliation";
import type { ProcoreCostCodeType } from "@/types/db";
import catalog from "@/lib/estimate-catalog.json";

// ---------------------------------------------------------------------------
// Procore Cost Codes — Phase 3 type-aware reconciliation.
//
// Pins the type-mismatch advisory against the MEASURED canonical counts:
//   - 67 estimate-granular codes whose type disagrees with Procore's type, and
//   -  8 estimate codes mapping to a base NOT in the 217-code Procore master list
//      (all 8 are the 2-20000.000 linked-division summaries the export excludes).
//
// Canonical inputs are the two in-repo sources of truth that seed the live
// tables: src/lib/estimate-catalog.json (the cost_code_map seed source) and
// docs/reference/Procore Cost Codes.xlsx (the procore_cost_codes seed source).
// If either drifts, the advisory's accuracy claim breaks here before it ships.
// ---------------------------------------------------------------------------

const XLSX_PATH = path.join(__dirname, "..", "..", "docs", "reference", "Procore Cost Codes.xlsx");

type CatalogItem = { procoreCode: string; costType: string };
const CATALOG = catalog as Record<string, CatalogItem>;

function cellStr(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "result" in v) return String((v as { result: unknown }).result ?? "");
  if (typeof v === "object" && "text" in v) return String((v as { text: unknown }).text ?? "");
  return String(v);
}

async function readProcoreTypeMap(): Promise<Map<string, ProcoreCostCodeType>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fs.readFileSync(XLSX_PATH) as unknown as ArrayBuffer);
  const ws = wb.worksheets.find((s) => s.rowCount > 1);
  expect(ws, "data sheet found in reference workbook").toBeTruthy();
  const map = new Map<string, ProcoreCostCodeType>();
  ws!.eachRow((row, n) => {
    if (n === 1) return; // header
    const code = cellStr(row.getCell(1)).trim();
    const type = cellStr(row.getCell(2)).trim() as ProcoreCostCodeType;
    if (code) map.set(code, type);
  });
  return map;
}

/** Mappings exactly as cost_code_map is seeded from the catalog (1:1). */
function catalogMappings(): MappingForReconciliation[] {
  return Object.keys(CATALOG).map((internalCode) => ({
    internalCode,
    procoreCode: CATALOG[internalCode].procoreCode,
  }));
}

describe("estimateCostTypeToProcore", () => {
  it("maps the L/M/S vocabulary and rejects everything else", () => {
    expect(estimateCostTypeToProcore("L")).toBe("Labor");
    expect(estimateCostTypeToProcore("M")).toBe("Material");
    expect(estimateCostTypeToProcore("S")).toBe("Subcontract");
    expect(estimateCostTypeToProcore(" s ")).toBe("Subcontract"); // trimmed/cased
    expect(estimateCostTypeToProcore("E")).toBeNull();
    expect(estimateCostTypeToProcore("Equipment")).toBeNull();
    expect(estimateCostTypeToProcore("")).toBeNull();
  });
});

describe("computeTypeReconciliation — canonical 67/8", () => {
  it("reports exactly 67 type mismatches and 8 missing-base", async () => {
    const procoreTypeByCode = await readProcoreTypeMap();
    expect(procoreTypeByCode.size).toBe(217);

    const result = computeTypeReconciliation(catalogMappings(), CATALOG, procoreTypeByCode);

    expect(result.mismatches.length).toBe(67);
    expect(result.missingBase.length).toBe(8);

    // All 8 missing-base point at the dropped 2-20000.000 linked-division summary.
    expect(new Set(result.missingBase.map((m) => m.procoreCode))).toEqual(
      new Set(["2-20000.000"]),
    );
    // Every mismatch's Procore base really is in the master list and types differ.
    for (const m of result.mismatches) {
      expect(procoreTypeByCode.has(m.procoreCode)).toBe(true);
      expect(m.estimateType).not.toBe(m.procoreType);
    }
  });

  it("returns no findings when every estimate type agrees and every base exists", () => {
    const procoreTypeByCode = new Map<string, ProcoreCostCodeType>([["1-10000.000", "Material"]]);
    const mappings: MappingForReconciliation[] = [{ internalCode: "x", procoreCode: "1-10000.000" }];
    const result = computeTypeReconciliation(mappings, { x: { costType: "M" } }, procoreTypeByCode);
    expect(result.mismatches).toEqual([]);
    expect(result.missingBase).toEqual([]);
  });

  it("skips a mapping whose internalCode has no catalog item (no type to compare)", () => {
    const procoreTypeByCode = new Map<string, ProcoreCostCodeType>([["1-10000.000", "Material"]]);
    const mappings: MappingForReconciliation[] = [{ internalCode: "ghost", procoreCode: "1-10000.000" }];
    const result = computeTypeReconciliation(mappings, {}, procoreTypeByCode);
    expect(result.mismatches).toEqual([]);
    expect(result.missingBase).toEqual([]);
  });
});
