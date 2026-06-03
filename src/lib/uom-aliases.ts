/**
 * UOM Alias Normalization Map
 *
 * Togal AI exports use external UOM strings (e.g., "FT", "SQ FT") that differ
 * from the app's canonical UnitOfMeasure type (e.g., "LF", "SF").
 * This module provides a single normalization function used at parse time to
 * ensure all downstream UOM comparisons use canonical values.
 */

/** Canonical alias map: external UOM → internal UOM */
export const UOM_ALIASES: Record<string, string> = {
  "FT": "LF",
  "FEET": "LF",
  "FOOT": "LF",
  "LINEAR FEET": "LF",
  "SQ FT": "SF",
  "SQUARE FEET": "SF",
  "SQ YD": "SY",
  "SQUARE YARDS": "SY",
  "CU FT": "CF",
  "CUBIC FEET": "CF",
  "CU YD": "CY",
  "CUBIC YARDS": "CY",
  "EACH": "EA",
  "GALLON": "GAL",
  "GALLONS": "GAL",
  "HOUR": "HR",
  "HOURS": "HR",
  "MONTH": "MO",
  "MONTHS": "MO",
  "TONS": "TON",
  "WEEK": "WK",
  "WEEKS": "WK",
  "LUMP SUM": "LS",
};

/** Normalize any external UOM string to the app's canonical form */
export function normalizeUom(raw: string): string {
  const upper = raw.trim().toUpperCase();
  return UOM_ALIASES[upper] || upper;
}
