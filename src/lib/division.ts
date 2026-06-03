/**
 * Extracts the 2-digit CSI division code from an itemId.
 * Returns "" if the itemId is missing, too short, or doesn't start with 2 digits.
 *
 * This is the single source of truth for division code derivation.
 * All division grouping, breakdown, and rendering must use this function
 * instead of inline substring/split operations.
 *
 * @example
 *   getDivisionCode("09-2100.001") // "09"
 *   getDivisionCode("04-0000")     // "04"
 *   getDivisionCode("")            // ""
 *   getDivisionCode("MANUAL")      // ""
 */
export function getDivisionCode(itemId: string): string {
  if (!itemId || itemId.length < 2) return "";
  const code = itemId.substring(0, 2);
  return /^\d{2}$/.test(code) ? code : "";
}
