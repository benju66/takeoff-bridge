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
