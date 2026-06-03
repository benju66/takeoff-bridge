/**
 * UOM Options for the dropdown selector.
 *
 * Derived from the UnitOfMeasure type in src/types/index.ts and the
 * canonical UOM values in the estimate-catalog.json master list.
 * Grouped by measurement category for <optgroup> rendering.
 */

export interface UomOption {
  value: string;
  label: string;
  group: string;
}

export const UOM_OPTIONS: UomOption[] = [
  // Area
  { value: "SF", label: "SF — Square Feet", group: "Area" },
  { value: "SY", label: "SY — Square Yards", group: "Area" },
  // Linear
  { value: "LF", label: "LF — Linear Feet", group: "Linear" },
  // Volume
  { value: "CF", label: "CF — Cubic Feet", group: "Volume" },
  { value: "CY", label: "CY — Cubic Yards", group: "Volume" },
  { value: "GAL", label: "GAL — Gallons", group: "Volume" },
  // Count
  { value: "EA", label: "EA — Each", group: "Count" },
  { value: "FLR", label: "FLR — Floors", group: "Count" },
  { value: "STOP", label: "STOP — Stops", group: "Count" },
  // Weight
  { value: "TON", label: "TON — Tons", group: "Weight" },
  // Time
  { value: "HR", label: "HR — Hours", group: "Time" },
  { value: "DAY", label: "DAY — Days", group: "Time" },
  { value: "WK", label: "WK — Weeks", group: "Time" },
  { value: "MO", label: "MO — Months", group: "Time" },
  // Lump
  { value: "LS", label: "LS — Lump Sum", group: "Lump" },
];

/** All valid UOM values as a Set for O(1) membership checks */
export const VALID_UOMS = new Set(UOM_OPTIONS.map((o) => o.value));

/** Get distinct groups in display order */
export const UOM_GROUPS = [...new Set(UOM_OPTIONS.map((o) => o.group))];
