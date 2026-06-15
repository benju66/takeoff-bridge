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

/**
 * Extracts the base cost code (everything before the `.NNN` suffix) from an itemId.
 * Returns "" for the same missing/invalid inputs `getDivisionCode` rejects (so an
 * itemId without a valid 2-digit division prefix has no base code).
 *
 * This is groundwork for binding rollup predicates (Linked Values System): the
 * single source of truth for base-code derivation, mirroring getDivisionCode's
 * permissiveness — garbage in yields "" or a predictable bare value, never a throw.
 *
 * @example
 *   getBaseCode("09-2100.001") // "09-2100"
 *   getBaseCode("04-0000")     // "04-0000"
 *   getBaseCode("")            // ""
 *   getBaseCode("MANUAL")      // ""
 */
export function getBaseCode(itemId: string): string {
  if (!getDivisionCode(itemId)) return "";
  const dot = itemId.indexOf(".");
  return dot === -1 ? itemId : itemId.substring(0, dot);
}

/**
 * Extracts the suffix (the digits after the `.` in `NN-NNNN.NNN`) from an itemId.
 * Returns "" when there is no suffix, or for the same missing/invalid inputs
 * `getDivisionCode` rejects.
 *
 * Single source of truth for suffix derivation; consumers must handle the
 * empty-string case (no suffix present).
 *
 * @example
 *   getCodeSuffix("09-2100.001") // "001"
 *   getCodeSuffix("04-0000")     // ""
 *   getCodeSuffix("")            // ""
 *   getCodeSuffix("MANUAL")      // ""
 */
export function getCodeSuffix(itemId: string): string {
  if (!getDivisionCode(itemId)) return "";
  const dot = itemId.indexOf(".");
  return dot === -1 ? "" : itemId.substring(dot + 1);
}
