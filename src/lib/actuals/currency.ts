/**
 * Actuals Cost-History — parsing primitives for the Procore CSV exports.
 *
 * Currency parsing delegates to the project's existing sign-safe US-format
 * number parser (`parseUsNumber` in `../parser`) so that savings (accounting
 * parentheses `"($41,476.26)"`, leading/trailing minus) always REDUCE a value
 * and never silently flip to a positive (code-review register #5: sign-flip).
 * We only pre-strip the currency symbol and Procore's trailing space that the
 * generic parser does not expect.
 */

import { parseUsNumber } from "../parser";
import type { ActualsCostType } from "./types";

/**
 * Round to cents — the single money-rounding rule shared across the actuals
 * modules (normalize / eventReview / pricingPool / conceptPricing / variance /
 * buyoutAccuracy). Defined once here so a future change to the rule (epsilon,
 * banker's rounding) lands in exactly one place and the same dollar figure can
 * never round differently between two views.
 */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Parse a Procore currency cell to a signed number.
 *
 * Handles: `"$1,234.50"`, `"$1,234.50 "` (trailing space), `"($41,476.26)"`
 * (savings → negative), `"-$1,250.00"`, plain `"0.0"`, `""`/`"None"` → 0.
 * Anything the underlying sign-safe parser deems ambiguous yields 0 (never a
 * guessed positive — AGENTS.md "No AI Autonomy Over Financials").
 */
export function parseActualsCurrency(val: unknown): number {
  if (val === undefined || val === null) return 0;
  let s = String(val).trim();
  if (s === "" || s === "None") return 0;
  // Strip currency symbol; the sign-safe parser handles commas, parens, minus.
  s = s.replace(/\$/g, "").trim();
  if (s === "") return 0;
  return parseUsNumber(s).value;
}

/**
 * Canonicalize a change-event id for joining the detail and summary exports.
 *
 * The two exports disagree on format: the summary uses unpadded numerics
 * (`"97"`) while the detail zero-pads to three digits (`"097"`). Internal ids
 * (`"INT-001"`) match as-is. Without canonicalization, every event 1–99 would
 * fail to join and silently lose its classification.
 *
 * @example normalizeEventId("097") // "97"
 * @example normalizeEventId("97")  // "97"
 * @example normalizeEventId("INT-001") // "INT-001"
 */
export function normalizeEventId(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (s === "") return "";
  if (/^\d+$/.test(s)) return String(parseInt(s, 10));
  return s.toUpperCase();
}

/**
 * Split a Procore `"<code> - <description>"` cell into its cost code.
 *
 * @example parseCostCode("5-51200.000 - Structural Steel") // "5-51200.000"
 * @example parseCostCode("") // ""
 */
export function parseCostCode(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (s === "") return "";
  const sep = s.indexOf(" - ");
  return sep === -1 ? s : s.slice(0, sep).trim();
}

/**
 * Split a Procore `"<code> - <description>"` cell into its description.
 *
 * @example parseCostCodeDescription("5-51200.000 - Structural Steel") // "Structural Steel"
 */
export function parseCostCodeDescription(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (s === "") return "";
  const sep = s.indexOf(" - ");
  return sep === -1 ? "" : s.slice(sep + 3).trim();
}

/**
 * Parse a Procore `Cost Type` cell (`"Material - Material"`, `"Labor - Labor"`,
 * `"Subcontract - Subcontract"`) into a canonical {@link ActualsCostType}.
 * `"None"`, blank, or an unrecognized value yields `"Other"`.
 */
export function parseCostType(raw: unknown): ActualsCostType {
  const head = String(raw ?? "")
    .trim()
    .split(" - ")[0]
    .trim()
    .toLowerCase();
  switch (head) {
    case "labor":
      return "Labor";
    case "material":
      return "Material";
    case "subcontract":
      return "Subcontract";
    case "equipment":
      return "Equipment";
    default:
      return "Other";
  }
}

/**
 * Build the `code+costType` grain key, e.g. `("1-10320.000", "Labor")` →
 * `"1-10320.000.Labor"`. This mirrors Procore's own `Budget Code` column so the
 * change-event detail joins to the budget export at an identical key.
 */
export function buildGrainKey(costCode: string, costType: ActualsCostType): string {
  return `${costCode}.${costType}`;
}
