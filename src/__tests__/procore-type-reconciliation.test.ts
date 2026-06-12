import { describe, it, expect, afterEach } from "vitest";
import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";
import {
  computeTypeReconciliation,
  estimateCostTypeToProcore,
  type MappingForReconciliation,
} from "@/lib/procoreTypeReconciliation";
import { getCatalogItems, primeCatalogCostTypeOverrides, resetCatalog } from "@/lib/catalog";
import type { ProcoreCostCodeType } from "@/types/db";
import catalog from "@/lib/estimate-catalog.json";

// ---------------------------------------------------------------------------
// Procore Cost Codes — Phase 3 type-aware reconciliation.
//
// Pins the type-mismatch advisory against the MEASURED canonical counts:
//   - RAW (no overlay primed): 67 estimate-granular codes whose HARVESTED type
//     disagrees with Procore's type. The harvested catalog JSON never changes
//     here, so 67 stays the raw pin.
//   - SEEDED (Template + Catalog Reconciliation Phase 3): the live
//     catalog_cost_type_overrides rows relabel the 65 MECHANICAL fixes
//     (architect-approved disposition, docs/plans/2026-06-12-catalog-type-
//     disposition.md), so with the overlay primed the advisory drops to the
//     2 suspected wrong-code mis-maps — the explained residual.
//   -  8 estimate codes mapping to a base NOT in the 217-code Procore master
//      list (all 8 are the 2-20000.000 linked-division summaries the export
//      excludes). Type relabels never touch this count.
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
  it("maps the L/M/S/E vocabulary and rejects everything else", () => {
    expect(estimateCostTypeToProcore("L")).toBe("Labor");
    expect(estimateCostTypeToProcore("M")).toBe("Material");
    expect(estimateCostTypeToProcore("S")).toBe("Subcontract");
    expect(estimateCostTypeToProcore(" s ")).toBe("Subcontract"); // trimmed/cased
    expect(estimateCostTypeToProcore("E")).toBe("Equipment"); // reconciliation Phase 1
    expect(estimateCostTypeToProcore("Equipment")).toBeNull(); // letters only, not full words
    expect(estimateCostTypeToProcore("X")).toBeNull();
    expect(estimateCostTypeToProcore("")).toBeNull();
  });
});

describe("computeTypeReconciliation — canonical raw 67/8, seeded 2", () => {
  // The seeded-overlay test primes the module-level catalog overlay — always
  // clear it so the raw pins (and every other suite) see an unprimed catalog.
  afterEach(() => resetCatalog());

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

  it("with linked-division exemption: 67 mismatches and 0 missing-base", async () => {
    const procoreTypeByCode = await readProcoreTypeMap();

    const exempt = computeTypeReconciliation(catalogMappings(), CATALOG, procoreTypeByCode, {
      exemptLinkedDivision: true,
    });
    // The 8 missing-base ARE the division-02 linked summaries (→ retired
    // 2-20000.000); the exemption skips exactly those and nothing else.
    expect(exempt.missingBase.length).toBe(0);
    // Mismatches are unaffected — no linked-division row is a type mismatch.
    expect(exempt.mismatches.length).toBe(67);

    // Pin that WITHOUT the exemption it is STILL 8 missing-base, so the exemption
    // stays honest/visible (it suppresses a real, enumerated set — not a bug).
    const unexempt = computeTypeReconciliation(catalogMappings(), CATALOG, procoreTypeByCode);
    expect(unexempt.missingBase.length).toBe(8);
    expect(unexempt.mismatches.length).toBe(67);
  });

  it("with the Phase 3 seeded overlay primed: 67 → 2 (the enumerated mis-map residual)", async () => {
    const procoreTypeByCode = await readProcoreTypeMap();

    // The 2 mismatches whose CODE mapping (not just the type label) is suspect —
    // NOT seeded, left standing in the advisory pending an architect repoint
    // review (disposition report §Suspected wrong-code mis-maps):
    //   01-0400.002  Supervision (L) → 1-10000.000 General Conditions (Material);
    //                Procore has dedicated 1-104xx Labor supervision codes.
    //   12-3530.002  Residential Casework - Installation (S) → 12-123530.000
    //                Residential Casework (Material); the install half plausibly
    //                belongs on 6-62000.000 Finish Carpentry Installation (S).
    const RESIDUAL_MISMAPS = ["01-0400.002", "12-3530.002"];

    // Derive the seeded rows by the same rule as the disposition/seed scripts
    // (scripts/catalog-type-disposition.js): every RAW mismatch EXCEPT the
    // enumerated mis-maps gets an override relabeling it to Procore's type.
    const LETTER: Record<string, string> = { Labor: "L", Material: "M", Subcontract: "S", Equipment: "E" };
    const raw = computeTypeReconciliation(catalogMappings(), CATALOG, procoreTypeByCode);
    const overrides = raw.mismatches
      .filter((m) => !RESIDUAL_MISMAPS.includes(m.internalCode))
      .map((m) => ({ itemId: m.internalCode, costType: LETTER[m.procoreType], note: "" }));
    expect(overrides.length).toBe(65); // the seeded mechanical-fix count

    primeCatalogCostTypeOverrides(overrides);
    const seeded = computeTypeReconciliation(catalogMappings(), getCatalogItems(), procoreTypeByCode);

    // The advisory residual is EXACTLY the 2 mis-map suspects, in sort order.
    expect(seeded.mismatches.map((m) => m.internalCode)).toEqual(RESIDUAL_MISMAPS);
    // Relabeling types never touches the missing-base advisory.
    expect(seeded.missingBase.length).toBe(8);
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
