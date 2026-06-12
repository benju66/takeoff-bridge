/**
 * XLSX Reader — Parses Togal AI .xlsx exports into TogalRowPayload[]
 *
 * Uses ExcelJS (already in the bundle via exporter.ts) for client-side parsing.
 * Handles formula cells, Date cells, and multi-sheet workbooks.
 */

import ExcelJS from "exceljs";
import { TogalRowPayload } from "@/types";

// ---------------------------------------------------------------------------
// Safe cell value extractor — handles formula cells (GAP-4 fix)
// ExcelJS returns rich CellValue types:
//   - Numbers: number
//   - Strings: string
//   - Dates: Date
//   - Formulas: { formula: string, result: unknown }
// ---------------------------------------------------------------------------
function extractCellValue(cell: ExcelJS.Cell): string | number {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && v !== null && "result" in v) {
    const result = (v as { result: unknown }).result;
    if (result === null || result === undefined) return "";
    return result as string | number;
  }
  if (v instanceof Date) return v.toISOString();
  return v as string | number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface XlsxParseResult {
  rows: TogalRowPayload[];
  sheetNames: string[];
  selectedSheet: string;
}

/**
 * Parse a .xlsx file into TogalRowPayload[].
 * Accepts optional sheetName for multi-sheet workbooks.
 * If no sheetName is provided, auto-selects the first sheet with data.
 */
export async function parseTogalXLSX(
  file: File,
  sheetName?: string,
): Promise<XlsxParseResult> {
  const wb = new ExcelJS.Workbook();
  const buffer = await file.arrayBuffer();
  await wb.xlsx.load(buffer);

  // Collect sheet names for sheets with actual data (>1 row)
  const sheetNames = wb.worksheets
    .filter((ws) => ws.rowCount > 1)
    .map((ws) => ws.name);

  // Select worksheet: explicit name → first sheet with data
  const ws = sheetName
    ? wb.getWorksheet(sheetName)
    : wb.worksheets.find((s) => s.rowCount > 1);

  if (!ws || ws.rowCount < 2) {
    return { rows: [], sheetNames, selectedSheet: "" };
  }

  // Build header map from row 1
  const headerRow = ws.getRow(1);
  const headerMap: Record<number, string> = {};
  headerRow.eachCell((cell, colNumber) => {
    headerMap[colNumber] = String(extractCellValue(cell) || "").trim();
  });

  // Convert each data row to TogalRowPayload
  const rows: TogalRowPayload[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header row
    const obj: Record<string, string | number> = {};
    row.eachCell((cell, colNumber) => {
      const header = headerMap[colNumber];
      if (header) obj[header] = extractCellValue(cell);
    });
    // Only include rows with a Classification value
    if (obj["Classification"]) {
      rows.push(obj as unknown as TogalRowPayload);
    }
  });

  return { rows, sheetNames, selectedSheet: ws.name };
}

// ---------------------------------------------------------------------------
// Procore Cost Codes master-list reader (Procore Cost Codes — Phase 2)
//
// The Procore export has a fixed 3-column shape: Cost Code | Type | Description.
// parseTogalXLSX above only keeps rows that carry a "Classification" column, so
// it can't read this file — this is the dedicated parse path the /procore-codes
// import flow uses. It returns RAW string cells (no type/shape validation); the
// caller validates the vocabulary + shape via validateProcoreImportRows in
// src/lib/procoreCostCodes.ts (single validation surface, mirrors the seed).
// ---------------------------------------------------------------------------

/** One raw row from the Procore Cost Codes spreadsheet (pre-validation). */
export interface ParsedProcoreCostCodeRow {
  code: string;
  type: string;
  description: string;
}

const PROCORE_COST_CODE_HEADER = ["cost code", "type", "description"];

/**
 * Parse the Procore Cost Codes .xlsx (Cost Code | Type | Description) into raw
 * string rows. Auto-selects the first sheet with data, asserts the 3-column
 * header (fail-loud — a wrong-shape file is rejected before any DB write), and
 * skips fully-blank rows. Cells are trimmed; no other normalization.
 */
export async function parseProcoreCostCodesXLSX(
  file: File,
): Promise<ParsedProcoreCostCodeRow[]> {
  const wb = new ExcelJS.Workbook();
  const buffer = await file.arrayBuffer();
  await wb.xlsx.load(buffer);

  const ws = wb.worksheets.find((s) => s.rowCount > 1);
  if (!ws) {
    throw new Error("No data sheet found in the uploaded file.");
  }

  // Header check (row 1) — exact 3-column shape, case-insensitive.
  const header = [1, 2, 3].map((n) =>
    String(extractCellValue(ws.getRow(1).getCell(n)) || "").trim().toLowerCase(),
  );
  if (header.join("|") !== PROCORE_COST_CODE_HEADER.join("|")) {
    throw new Error(
      `Unexpected header row: got [${header.join(", ")}], expected [Cost Code, Type, Description]. ` +
        `This page imports the Procore Cost Codes export only.`,
    );
  }

  const rows: ParsedProcoreCostCodeRow[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const code = String(extractCellValue(row.getCell(1)) || "").trim();
    const type = String(extractCellValue(row.getCell(2)) || "").trim();
    const description = String(extractCellValue(row.getCell(3)) || "").trim();
    if (!code && !type && !description) return; // skip fully-blank rows
    rows.push({ code, type, description });
  });

  return rows;
}
