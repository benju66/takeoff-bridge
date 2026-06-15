import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";
import { MASTER_TEMPLATE_PATH } from "./fixtures/templateLayout";
import procoreValidCodes from "@/lib/procore-valid-codes.json";

// ---------------------------------------------------------------------------
// Procore valid-code drift guard.
//
// FIRST assertion (Phase 3c, KEPT): the committed JSON artifact
// (src/lib/procore-valid-codes.json) still exactly mirrors the canonical
// template's Importer Data Fields sheet. The template-import path reads that
// sheet, so the JSON must not rot — regenerate with `npm run sync-codes`.
//
// SECOND assertion (Template + Catalog Reconciliation Phase 6, ZERO DRIFT):
// the 7 dead codes have been removed from the template's Importer Data Fields
// sheet, so the JSON/template (now 217) and the Procore master list
// (docs/reference/Procore Cost Codes.xlsx, 217) agree EXACTLY — the standing
// drift is gone, eliminated at the source. This used to pin a known 7-code
// delta (Phase 4); Phase 6 drove it to zero. The guard now goes red if ANY
// code is added or dropped on EITHER side (an unexpected divergence) — the real
// regression risk now that the lists are meant to be identical.
// ---------------------------------------------------------------------------

const IMPORTER_SHEET = "Importer Data Fields";
const PROCORE_CODE_RE = /^\d{1,2}-\d{4,6}\.\d{3}$/;

const REFERENCE_XLSX_PATH = path.join(
  __dirname,
  "..",
  "..",
  "docs",
  "reference",
  "Procore Cost Codes.xlsx",
);

/** The 217 codes in the new Procore master list reference workbook (column 1). */
async function readReferenceCodes(): Promise<Set<string>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fs.readFileSync(REFERENCE_XLSX_PATH) as unknown as ArrayBuffer);
  const ws = wb.worksheets.find((s) => s.rowCount > 1);
  expect(ws, "data sheet found in reference workbook").toBeTruthy();
  const codes = new Set<string>();
  ws!.eachRow((row, n) => {
    if (n === 1) return; // header
    const code = String(row.getCell(1).text ?? "").trim();
    if (PROCORE_CODE_RE.test(code)) codes.add(code);
  });
  return codes;
}

describe("procore-valid-codes.json ↔ template Importer Data Fields sync", () => {
  it("artifact exactly matches the Importer sheet's code/description columns", async () => {
    const templateBuffer = fs.readFileSync(MASTER_TEMPLATE_PATH);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(templateBuffer as unknown as ArrayBuffer);

    const importer = workbook.getWorksheet(IMPORTER_SHEET);
    expect(importer, `Worksheet "${IMPORTER_SHEET}" not found in template`).toBeTruthy();

    const fromTemplate: { code: string; description: string }[] = [];
    importer!.eachRow((row) => {
      const code = row.getCell(1).text ?? "";
      if (!PROCORE_CODE_RE.test(code)) return; // header / non-code rows
      fromTemplate.push({ code, description: row.getCell(2).text ?? "" });
    });

    expect(fromTemplate.length).toBeGreaterThan(0);
    expect(procoreValidCodes).toEqual(fromTemplate);
  });

  it("zero drift: JSON, template Importer sheet, and the Procore master list all carry the same 217 codes", async () => {
    const referenceCodes = await readReferenceCodes();
    expect(referenceCodes.size).toBe(217);

    const jsonCodes = new Set((procoreValidCodes as { code: string }[]).map((c) => c.code));
    expect(jsonCodes.size).toBe(217);

    // No master-list code is missing from the JSON ...
    const addedByXlsx = [...referenceCodes].filter((c) => !jsonCodes.has(c));
    expect(addedByXlsx).toEqual([]);

    // ... and no JSON code is absent from the master list. Both directions empty
    // ⇒ the sets are identical: the 7 retired-by-absence codes are gone for good
    // (removed from the template's Importer Data Fields sheet in Phase 6).
    const droppedFromJson = [...jsonCodes].filter((c) => !referenceCodes.has(c)).sort();
    expect(droppedFromJson).toEqual([]);
  });
});
