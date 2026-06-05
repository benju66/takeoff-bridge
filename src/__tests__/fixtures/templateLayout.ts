import path from "path";
import type { TemplateLayoutConfig } from "@/types/db";
import { MASTER_TEMPLATE_NAME } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Canonical layout fixture for Company_Estimate_Template.xlsx (Phase 3b).
//
// MUST mirror the template_config.config_data seed in supabase_schema.sql
// (the runtime source of truth) — if the template's geometry changes, update
// the seed there FIRST, then this fixture. The unit suite exercises the
// exporter directly, so it supplies this config instead of hitting Supabase.
// ---------------------------------------------------------------------------

export const MASTER_TEMPLATE_LAYOUT: TemplateLayoutConfig = {
  divisions: [
    { division: "01", headerRow: 10, startRow: 11, endRow: 14, label: "DIVISION 01 — GENERAL CONDITIONS" },
    { division: "02", headerRow: 15, startRow: 16, endRow: 25, label: "DIVISION 02 — SITE OPERATIONS" },
    { division: "03", headerRow: 26, startRow: 27, endRow: 52, label: "DIVISION 03 — CONCRETE" },
    { division: "04", headerRow: 53, startRow: 54, endRow: 62, label: "DIVISION 04 — MASONRY" },
    { division: "05", headerRow: 63, startRow: 64, endRow: 72, label: "DIVISION 05 — METALS" },
    { division: "06", headerRow: 73, startRow: 74, endRow: 92, label: "DIVISION 06 — WOOD, PLASTICS, COMPOSITES" },
    { division: "07", headerRow: 93, startRow: 94, endRow: 130, label: "DIVISION 07 — THERMAL & MOISTURE PROTECTION" },
    { division: "08", headerRow: 131, startRow: 132, endRow: 149, label: "DIVISION 08 — OPENINGS" },
    { division: "09", headerRow: 150, startRow: 151, endRow: 164, label: "DIVISION 09 — FINISHES" },
    { division: "10", headerRow: 165, startRow: 166, endRow: 189, label: "DIVISION 10 — SPECIALTIES" },
    { division: "11", headerRow: 190, startRow: 191, endRow: 199, label: "DIVISION 11 — EQUIPMENT" },
    { division: "12", headerRow: 200, startRow: 201, endRow: 211, label: "DIVISION 12 — FURNISHINGS" },
    { division: "13", headerRow: 212, startRow: 213, endRow: 219, label: "DIVISION 13 — SPECIAL CONSTRUCTION" },
    { division: "14", headerRow: 220, startRow: 221, endRow: 226, label: "DIVISION 14 — CONVEYING EQUIPMENT" },
    { division: "21", headerRow: 227, startRow: 228, endRow: 231, label: "DIVISION 21 — FIRE SUPPRESSION" },
    { division: "22", headerRow: 232, startRow: 233, endRow: 238, label: "DIVISION 22 — PLUMBING" },
    { division: "23", headerRow: 239, startRow: 240, endRow: 242, label: "DIVISION 23 — HVAC" },
    { division: "26", headerRow: 243, startRow: 244, endRow: 250, label: "DIVISION 26 — ELECTRICAL" },
    { division: "27", headerRow: 251, startRow: 252, endRow: 255, label: "DIVISION 27 — COMMUNICATIONS" },
    { division: "28", headerRow: 256, startRow: 257, endRow: 262, label: "DIVISION 28 — ELECTRONIC SAFETY AND SECURITY" },
    { division: "31", headerRow: 263, startRow: 264, endRow: 270, label: "DIVISION 31 — EARTHWORK" },
    { division: "32", headerRow: 271, startRow: 272, endRow: 291, label: "DIVISION 32 — EXTERIOR IMPROVEMENTS" },
    { division: "33", headerRow: 292, startRow: 293, endRow: 304, label: "DIVISION 33 — UTILITIES" },
    { division: "50", headerRow: 305, startRow: 306, endRow: 315, label: "DIVISION 50 — WINTER CONDITIONS" },
    { division: "80", headerRow: 316, startRow: 317, endRow: 330, label: "DIVISION 80 — ALLOWANCES" },
  ],
  anchors: {
    subtotalRow: 331,
    modifierStartOffset: 2,
    modifierEndOffset: 8,
    grandTotalOffset: 10,
    reconStartRow: 346,
  },
  sheetNames: {
    budgetLineItems: "Budget Line Items",
    importerDataFields: "Importer Data Fields",
  },
};

/**
 * Builds a layout config whose divisions are limited to the given division
 * codes (anchors/sheetNames unchanged). Lets focused tests iterate fewer
 * divisions while keeping the real bottom-of-sheet geometry.
 */
export function layoutWithDivisions(...divisionCodes: string[]): TemplateLayoutConfig {
  return {
    ...MASTER_TEMPLATE_LAYOUT,
    divisions: MASTER_TEMPLATE_LAYOUT.divisions.filter((d) =>
      divisionCodes.includes(d.division)
    ),
  };
}

/**
 * Git-tracked canonical template file (Phase 3b: runtime fetches come from
 * the private Storage bucket; tests and scripts read this repo copy).
 */
export const MASTER_TEMPLATE_PATH = path.resolve(
  __dirname,
  "../../../templates",
  MASTER_TEMPLATE_NAME
);
