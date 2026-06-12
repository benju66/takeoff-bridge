import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";
import {
  SITE_OPS_MANUAL_DEFAULTS,
  SITE_OPS_DYNAMIC_DEFAULTS,
} from "@/lib/constants";

// ---------------------------------------------------------------------------
// Procore Cost Codes — Phase 3: bring the granular Site Ops codes under the
// drift check.
//
// The STEP 3 Site Ops lines hard-code their `procoreCode` in constants.ts
// (SITE_OPS_MANUAL_DEFAULTS / SITE_OPS_DYNAMIC_DEFAULTS) and currently bypass
// cost_code_map AND the JSON oracle entirely — they are valid today but
// otherwise unguarded, so a bad hand-edit would silently ship a Procore code
// that doesn't exist. This test pins every hard-coded Site Ops code against the
// Procore master list (docs/reference/Procore Cost Codes.xlsx, the seed source
// for procore_cost_codes). CHECK ONLY — no behavior change.
//
// Mirrors procore-valid-codes-sync.test.ts: read the authoritative reference
// workbook at test time and assert membership.
// ---------------------------------------------------------------------------

const XLSX_PATH = path.join(__dirname, "..", "..", "docs", "reference", "Procore Cost Codes.xlsx");

function cellStr(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "result" in v) return String((v as { result: unknown }).result ?? "");
  if (typeof v === "object" && "text" in v) return String((v as { text: unknown }).text ?? "");
  return String(v);
}

async function readProcoreCodeSet(): Promise<Set<string>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fs.readFileSync(XLSX_PATH) as unknown as ArrayBuffer);
  const ws = wb.worksheets.find((s) => s.rowCount > 1);
  expect(ws, "data sheet found in reference workbook").toBeTruthy();
  const codes = new Set<string>();
  ws!.eachRow((row, n) => {
    if (n === 1) return; // header
    const code = cellStr(row.getCell(1)).trim();
    if (code) codes.add(code);
  });
  return codes;
}

describe("Site Ops hard-coded Procore codes ↔ procore_cost_codes master list", () => {
  it("every SITE_OPS_* procoreCode exists in the Procore master list", async () => {
    const master = await readProcoreCodeSet();
    expect(master.size).toBe(217);

    const siteOpsCodes = [
      ...SITE_OPS_MANUAL_DEFAULTS,
      ...SITE_OPS_DYNAMIC_DEFAULTS,
    ].map((l) => l.procoreCode);
    expect(siteOpsCodes.length).toBeGreaterThan(0);

    const orphans = [...new Set(siteOpsCodes)].filter((c) => !master.has(c)).sort();
    expect(
      orphans,
      `Site Ops procoreCode(s) not in the Procore master list (bad hand-edit?): ${orphans.join(", ")}`,
    ).toEqual([]);
  });
});
