/**
 * Architectural Parameter Detector
 *
 * Detects takeoff rows that could populate Step 1 project fields
 * (e.g., Building Footprint, Building Perimeter). Results are shown
 * in the import preview modal with accept/dismiss checkboxes.
 */

import { TogalRowPayload } from "@/types";
import { normalizeUom } from "./uom-aliases";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArchParamSuggestion {
  classification: string;
  value: number;
  uom: string;
  projectField: string;  // keyof Project — kept as string for decoupling
  label: string;         // Human-readable: "Building Footprint"
  accepted: boolean;     // User toggle in preview UI
}

export interface ArchParamRule {
  pattern: RegExp;
  uomFilter?: string;
  projectField: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Default detection rules
// Phase 1: hardcoded for known Togal patterns
// Phase 2: persisted per-project in DB via customRules parameter
// ---------------------------------------------------------------------------

const DEFAULT_RULES: ArchParamRule[] = [
  {
    pattern: /^02\s*-\s*Area$/i,
    uomFilter: "SF",
    projectField: "buildingFootprint",
    label: "Building Footprint",
  },
  // Additional rules will be added here as user identifies more patterns
  // Example future rules:
  // { pattern: /Building Perimeter/i, uomFilter: "LF", projectField: "buildingPerimeter", label: "Building Perimeter" },
  // { pattern: /Total Floors/i, uomFilter: "FLR", projectField: "stories", label: "Number of Stories" },
];

// ---------------------------------------------------------------------------
// Detection function
// ---------------------------------------------------------------------------

/**
 * Detect architectural parameters from raw Togal data.
 *
 * @param rawRows - Raw payload from Togal export
 * @param customRules - Optional Phase 2 override rules (replaces defaults entirely)
 * @returns Array of suggestions with accept/dismiss state
 */
export function detectArchParams(
  rawRows: TogalRowPayload[],
  customRules?: ArchParamRule[],
): ArchParamSuggestion[] {
  const rules = customRules || DEFAULT_RULES;
  const suggestions: ArchParamSuggestion[] = [];

  for (const row of rawRows) {
    const classification = String(row.Classification || "").trim();

    for (const rule of rules) {
      if (rule.pattern.test(classification)) {
        const qty = parseFloat(String(row["Quantity 1"] || 0));
        const uom = normalizeUom(String(row["Quantity1 UOM"] || "SF"));

        // Apply UOM filter if specified
        if (rule.uomFilter && uom !== rule.uomFilter.toUpperCase()) continue;

        suggestions.push({
          classification,
          value: qty,
          uom,
          projectField: rule.projectField,
          label: rule.label,
          accepted: true, // Default to accepted — user can dismiss in modal
        });
      }
    }
  }

  return suggestions;
}
