/// <reference types="vitest" />

import * as fs from "fs";
import * as path from "path";
import { parseProcoreCostCodesXLSX } from "@/lib/xlsx-reader";
import {
  validateProcoreImportRows,
  diffProcoreCostCodes,
  buildProcoreCostCodesWorkbookBuffer,
  type ValidatedProcoreCostCodeRow,
} from "@/lib/procoreCostCodes";
import type { ProcoreCostCode } from "@/types/db";

const REFERENCE_XLSX = path.resolve(
  __dirname,
  "../../../docs/reference/Procore Cost Codes.xlsx",
);

function fileFrom(buffer: Buffer | ArrayBuffer, name: string): File {
  return new File([new Uint8Array(buffer)], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// ---------------------------------------------------------------------------
// Round-trip: parse reference → apply (= validated rows) → export → re-parse,
// row-identical. Proves the parser and exporter are lossless and that an
// imported-then-exported file reproduces the source exactly.
// ---------------------------------------------------------------------------
describe("Procore cost codes import/export round-trip", () => {
  it("parse → validate → export → re-parse is row-identical to the reference", async () => {
    const buffer = fs.readFileSync(REFERENCE_XLSX);
    const parsed = await parseProcoreCostCodesXLSX(fileFrom(buffer, "Procore Cost Codes.xlsx"));

    // The reference file is the authoritative 217-code universe.
    expect(parsed.length).toBe(217);

    const validation = validateProcoreImportRows(parsed);
    expect(validation.ok).toBe(true);
    expect(validation.errors).toEqual([]);
    expect(validation.rows.length).toBe(217);

    // "Apply" preserves the rows; export them in the same order they arrived.
    const exportBuffer = await buildProcoreCostCodesWorkbookBuffer(validation.rows);
    const reparsed = await parseProcoreCostCodesXLSX(fileFrom(exportBuffer, "roundtrip.xlsx"));

    // Row-identical: same count, same code/type/description in the same order.
    expect(reparsed.length).toBe(parsed.length);
    expect(reparsed).toEqual(parsed);

    // And identical to the validated rows (no normalization drift on export).
    const exportedAsValidated = reparsed.map((r) => ({
      code: r.code,
      type: r.type,
      description: r.description,
    }));
    expect(exportedAsValidated).toEqual(validation.rows);
  });

  it("rejects a wrong-shape header file before any apply", async () => {
    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["Classification", "Quantity 1", "UOM"]);
    ws.addRow(["x", 1, "EA"]);
    const buffer = await wb.xlsx.writeBuffer();
    await expect(
      parseProcoreCostCodesXLSX(fileFrom(buffer, "wrong.xlsx")),
    ).rejects.toThrow(/Unexpected header row/);
  });
});

// ---------------------------------------------------------------------------
// Validation — shape + type vocabulary (mirrors the seed + the DB CHECK)
// ---------------------------------------------------------------------------
describe("validateProcoreImportRows", () => {
  it("accepts well-formed rows", () => {
    const v = validateProcoreImportRows([
      { code: "1-10000.000", type: "Material", description: "General Conditions" },
      { code: "2-21000.000", type: "Labor", description: "Supervision" },
    ]);
    expect(v.ok).toBe(true);
    expect(v.rows).toEqual([
      { code: "1-10000.000", type: "Material", description: "General Conditions" },
      { code: "2-21000.000", type: "Labor", description: "Supervision" },
    ]);
  });

  it("rejects an empty file", () => {
    const v = validateProcoreImportRows([]);
    expect(v.ok).toBe(false);
    expect(v.errors[0]).toMatch(/no cost-code rows/);
  });

  it("rejects an invalid type", () => {
    const v = validateProcoreImportRows([
      { code: "1-10000.000", type: "Widget", description: "Bad type" },
    ]);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => /invalid Type "Widget"/.test(e))).toBe(true);
  });

  it("rejects empty code and empty description", () => {
    const v = validateProcoreImportRows([
      { code: "", type: "Material", description: "No code" },
      { code: "1-10000.000", type: "Material", description: "" },
    ]);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => /empty Cost Code/.test(e))).toBe(true);
    expect(v.errors.some((e) => /empty Description/.test(e))).toBe(true);
  });

  it("rejects duplicate codes within the file", () => {
    const v = validateProcoreImportRows([
      { code: "1-10000.000", type: "Material", description: "A" },
      { code: "1-10000.000", type: "Labor", description: "B" },
    ]);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => /duplicate Cost Code 1-10000.000/.test(e))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Diff — incoming file vs. current DB master list
// ---------------------------------------------------------------------------
describe("diffProcoreCostCodes", () => {
  const current: ProcoreCostCode[] = [
    { code: "1-10000.000", type: "Material", description: "General Conditions", status: "active", mergedInto: null },
    { code: "2-21000.000", type: "Labor", description: "Supervision", status: "active", mergedInto: null },
    { code: "9-90000.000", type: "Subcontract", description: "Old code", status: "active", mergedInto: null },
    { code: "8-87000.000", type: "Material", description: "Hardware", status: "retired", mergedInto: null },
  ];

  it("classifies added / changed / proposed retirements / unchanged", () => {
    const incoming: ValidatedProcoreCostCodeRow[] = [
      // unchanged
      { code: "1-10000.000", type: "Material", description: "General Conditions" },
      // changed (description differs)
      { code: "2-21000.000", type: "Labor", description: "Site Supervision" },
      // added (not in DB)
      { code: "3-30000.000", type: "Equipment", description: "Crane" },
      // re-activation of a retired DB code → changed
      { code: "8-87000.000", type: "Material", description: "Hardware" },
    ];
    const d = diffProcoreCostCodes(current, incoming);

    expect(d.added.map((r) => r.code)).toEqual(["3-30000.000"]);
    expect(d.changed.map((c) => c.code).sort()).toEqual(["2-21000.000", "8-87000.000"]);
    expect(d.unchanged).toBe(1);
    // 9-90000.000 is active in the DB but absent from the file → proposed retire.
    expect(d.proposedRetirements.map((c) => c.code)).toEqual(["9-90000.000"]);
  });

  it("does not propose retiring a code that is already retired", () => {
    const incoming: ValidatedProcoreCostCodeRow[] = [
      { code: "1-10000.000", type: "Material", description: "General Conditions" },
    ];
    const d = diffProcoreCostCodes(current, incoming);
    // 8-87000.000 (retired) absent from file is NOT a proposed retirement;
    // 2-21000.000 and 9-90000.000 (active) are.
    expect(d.proposedRetirements.map((c) => c.code)).toEqual(["2-21000.000", "9-90000.000"]);
  });

  it("flags a re-activation as changed (DB row not active)", () => {
    const incoming: ValidatedProcoreCostCodeRow[] = [
      { code: "8-87000.000", type: "Material", description: "Hardware" },
    ];
    const d = diffProcoreCostCodes(current, incoming);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].from.status).toBe("retired");
    expect(d.unchanged).toBe(0);
  });
});
