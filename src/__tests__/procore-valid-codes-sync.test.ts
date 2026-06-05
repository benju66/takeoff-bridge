import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import fs from "fs";
import { MASTER_TEMPLATE_PATH } from "./fixtures/templateLayout";
import procoreValidCodes from "@/lib/procore-valid-codes.json";

// ---------------------------------------------------------------------------
// Phase 3c drift guard: the Procore valid-code list lives in TWO repo
// locations — the Importer Data Fields sheet inside the canonical template
// (templates/*.xlsx, the validation oracle) and the committed build-time
// artifact src/lib/procore-valid-codes.json (what the /cost-codes mapping
// editor and the export override modal validate against). If they drift, the
// editor validates against stale codes Procore may reject. This test
// mechanically pins artifact === template sheet. Regenerate with
// `npm run sync-codes` after any template change.
// ---------------------------------------------------------------------------

const IMPORTER_SHEET = "Importer Data Fields";
const PROCORE_CODE_RE = /^\d{1,2}-\d{4,6}\.\d{3}$/;

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
});
