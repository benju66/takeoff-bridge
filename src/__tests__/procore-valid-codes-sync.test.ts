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
// SECOND assertion (Phase 4, NEW): the JSON is now only a warn-only baseline —
// the DB (`procore_cost_codes`, 217 active) is the live validation oracle. The
// template/JSON still carry 224 codes; the new Procore master list
// (docs/reference/Procore Cost Codes.xlsx, 217) drops exactly 7. This pins that
// delta to the SPECIFIC 7 known retired-by-absence codes, so the test stays
// green today and goes red ONLY if the delta CHANGES (an unexpected add/drop) —
// the real regression risk. Eliminating the delta at the source (removing the 7
// dead template codes) is the follow-on Template + Catalog Reconciliation
// workstream, not Phase 4.
// ---------------------------------------------------------------------------

const IMPORTER_SHEET = "Importer Data Fields";
const PROCORE_CODE_RE = /^\d{1,2}-\d{4,6}\.\d{3}$/;

// The 7 codes the new Procore master list drops vs. the old 224-code JSON/template.
// Architect-approved retire-by-absence (Phase 4); see the Phase 1 reconciliation
// report. Only `2-20000.000` had live references (the 8 linked-division summaries,
// which never export); the other 6 had zero references anywhere.
const KNOWN_DROPPED_CODES = [
  "1-10440.000",
  "2-20000.000",
  "2-29406.000",
  "6-66119.000",
  "8-87000.000",
  "11-110000.000",
  "60-605000.000",
];

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

  it("warn-only drift check: JSON − reference-xlsx === exactly the 7 retired-by-absence codes", async () => {
    const referenceCodes = await readReferenceCodes();
    expect(referenceCodes.size).toBe(217);

    const jsonCodes = new Set((procoreValidCodes as { code: string }[]).map((c) => c.code));

    // Every code in the new master list must still exist in the JSON/template
    // (the reference list is a strict subset — no additions to chase).
    const addedByXlsx = [...referenceCodes].filter((c) => !jsonCodes.has(c));
    expect(addedByXlsx).toEqual([]);

    // The JSON-only codes are EXACTLY the 7 known dropped codes — no more, no less.
    const droppedFromJson = [...jsonCodes].filter((c) => !referenceCodes.has(c)).sort();
    expect(droppedFromJson).toEqual([...KNOWN_DROPPED_CODES].sort());
  });
});
