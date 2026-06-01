/**
 * exportUtils.ts — Shared utilities for export pipeline
 * Extracted from exporter.ts (Phase 2, Item 12)
 */

/**
 * Safely escapes value fields for compliant CSV ingestion.
 * Wraps values containing commas, quotes, or newlines in double quotes,
 * doubling internal quotes per RFC 4180.
 */
export function escapeCSVField(val: unknown): string {
  if (val === undefined || val === null) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Converts a 1-based column index to an Excel column letter.
 * e.g. 1 → A, 26 → Z, 27 → AA, 702 → ZZ, 703 → AAA
 */
export function getColumnLetter(colIndex: number): string {
  let temp = colIndex;
  let letter = "";
  while (temp > 0) {
    const modulo = (temp - 1) % 26;
    letter = String.fromCharCode(65 + modulo) + letter;
    temp = Math.floor((temp - modulo) / 26);
  }
  return letter;
}

/**
 * Build an ExcelJS-compatible number format string.
 * @param decimalPlaces Number of decimal places (0-6)
 * @param isCurrency Whether to prepend a $ sign
 * @returns ExcelJS numFmt string, e.g. '$#,##0.00' or '#,##0.0000'
 */
export function buildNumFmt(decimalPlaces: number, isCurrency: boolean): string {
  const decimals = decimalPlaces > 0 ? '.' + '0'.repeat(decimalPlaces) : '';
  const base = `#,##0${decimals}`;
  return isCurrency ? `$${base}` : base;
}
