import { TogalRowPayload, ProcessedTakeoffRow } from "@/types";
import { INITIAL_MAPPING_REGISTRY } from "./mock-data";
import { getCatalogItems } from "./catalog";
import { resolveProcoreCode } from "./costCodeResolver";
import { resolveCatalogPrice } from "./rateResolver";
import { evaluateDataFidelity } from "./calculations";
import { normalizeUom } from "./uom-aliases";

/**
 * Converts a Record<string, string> registry into a Map<string, string>
 * with pre-lowercased and trimmed keys for O(1) normalized lookups.
 * Called once before the row-iteration loop, not per-row.
 */
function buildNormalizedMap(
  registry: Record<string, string>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const key of Object.keys(registry)) {
    const normalized = key.trim().toLowerCase();
    if (map.has(normalized)) {
      console.warn(`Duplicate normalized key detected in registry: ${normalized}`);
    }
    map.set(normalized, registry[key]);
  }
  return map;
}

/**
 * One-pass row-key normalizer — converts a raw CSV row object's keys into
 * a Map<string, unknown> so that column access is a single O(1) .get() call.
 * Called once per row, replacing 7× getCaseInsensitiveProp scans.
 */
function normalizeRowKeys(
  obj: Record<string, unknown>
): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const key of Object.keys(obj)) {
    map.set(key.toLowerCase().trim(), obj[key]);
  }
  return map;
}

/** Result of parsing a US-format number string. */
export interface ParsedNumber {
  /** Parsed numeric value. 0 when `ambiguous` (never a guessed positive). */
  value: number;
  /** True when the input could not be confidently parsed as a US-format number. */
  ambiguous: boolean;
}

/**
 * Sign-safe US-format number parser (Phase 3 / INV-8, silent-escape register #5).
 *
 * US format = comma thousands, dot decimal. Negatives may appear as accounting parentheses
 * `"(1,234.50)"` or a leading/trailing minus (`"-1,234.50"`, `"1,234.50-"`) and are honored
 * as negative — a credit must REDUCE the subtotal, never silently add to it.
 *
 * Anything that cannot be read confidently as US format (European decimal-comma `"1.234,50"`,
 * multiple separators, malformed thousands grouping) is reported `ambiguous: true` with
 * `value: 0` rather than coerced to a wrong positive number. The caller routes ambiguous rows
 * to the override interface instead of guessing (AGENTS.md: No AI Autonomy Over Financials).
 *
 * A plain JS number passes through unchanged; empty / null / undefined → `{ 0, false }`.
 */
export function parseUsNumber(val: unknown): ParsedNumber {
  if (val === undefined || val === null || val === "") return { value: 0, ambiguous: false };
  if (typeof val === "number") {
    return Number.isFinite(val) ? { value: val, ambiguous: false } : { value: 0, ambiguous: true };
  }

  let s = String(val).trim();
  if (s === "") return { value: 0, ambiguous: false };

  // --- sign detection (strip at most one of each indicator) ----------------
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {            // accounting parentheses
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith("-")) {                               // leading minus
    negative = true;
    s = s.slice(1).trim();
  }
  if (s.endsWith("-")) {                                 // trailing minus (parseFloat drops this today)
    negative = true;
    s = s.slice(0, -1).trim();
  }

  if (s === "") return { value: 0, ambiguous: true };    // a lone sign/paren, no digits
  if (/[()\-]/.test(s)) return { value: 0, ambiguous: true }; // leftover sign/paren ⇒ malformed

  // --- magnitude validation (US format) ------------------------------------
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  // A comma AFTER the last dot is European decimal-comma ("1.234,50") ⇒ ambiguous.
  if (lastDot !== -1 && lastComma !== -1 && lastComma > lastDot) return { value: 0, ambiguous: true };
  // More than one dot ⇒ European thousands ("1.234.50") ⇒ ambiguous.
  if ((s.match(/\./g) || []).length > 1) return { value: 0, ambiguous: true };

  // Commas (if any) must form valid US thousands groups; otherwise plain digits + optional decimal.
  const usGrouped = /^\d{1,3}(,\d{3})+(\.\d+)?$/;        // 1,234 | 1,234.50 | 1,234,567
  const usPlain = /^(\d+(\.\d+)?|\.\d+)$/;               // 1234 | 1234.50 | .5
  if (s.includes(",")) {
    if (!usGrouped.test(s)) return { value: 0, ambiguous: true };
  } else if (!usPlain.test(s)) {
    return { value: 0, ambiguous: true };
  }

  const magnitude = parseFloat(s.replace(/,/g, ""));
  if (Number.isNaN(magnitude)) return { value: 0, ambiguous: true };

  // Guard against signed zero (-0) so a parenthesized/negated zero compares as plain 0.
  return { value: negative && magnitude !== 0 ? -magnitude : magnitude, ambiguous: false };
}

// Module-level — built once at import time since INITIAL_MAPPING_REGISTRY is a static constant
const initialMap: Map<string, string> = buildNormalizedMap(INITIAL_MAPPING_REGISTRY);

export function parseTogalCSV(
  rawRows: TogalRowPayload[],
  userRegistry: Record<string, string> = {},
  globalRegistry: Record<string, string> = {}
): ProcessedTakeoffRow[] {
  // Pre-compile O(1) normalized lookup Maps — built once per parse call (parameters vary)
  const userMap: Map<string, string> = buildNormalizedMap(userRegistry);
  const globalMap: Map<string, string> = buildNormalizedMap(globalRegistry);

  const threshold = Number(globalRegistry["__config_threshold"]) || 5000;
  const keywords = globalRegistry["__config_keywords"]
    ? globalRegistry["__config_keywords"].split(",").map(k => k.trim())
    : ["LS", "SUM", "ALLW", "LUMP"];

  const catalog = getCatalogItems();

  return rawRows.map((row, index): ProcessedTakeoffRow | null => {
    // Normalize all row keys once for O(1) column access (Deep Review E1: explicit cast)
    const normalizedRow = normalizeRowKeys(row as unknown as Record<string, unknown>);

    const rawClassification = normalizedRow.get("classification");
    const classification = typeof rawClassification === "string" ? rawClassification.trim() : String(rawClassification || "").trim();
    if (!classification) return null;

    // Priority 0: Extract embedded cost code from classification string
    // Matches patterns like "03-0000.002 - Footings" → "03-0000.002"
    const embeddedCodeMatch = classification.match(/^(\d{2}-\d{4}\.\d{3})\s*-\s*/);
    const embeddedCode = embeddedCodeMatch?.[1] || "";

    // Resolution chain:
    // 0. Embedded code extraction (only if code exists in master catalog)
    // 1. userRegistry exact match
    // 2. globalRegistry exact match
    // 3. INITIAL_MAPPING_REGISTRY exact match
    // 4. Normalized fallback (case-insensitive)
    let itemId = "";
    if (embeddedCode && catalog[embeddedCode]) {
      itemId = embeddedCode;
    } else {
      itemId = userRegistry[classification] || globalRegistry[classification] || INITIAL_MAPPING_REGISTRY[classification] || "";
    }

    // Normalized fallback — single .get() per registry instead of O(N) .find() scans
    if (!itemId) {
      const normalizedClassification = classification.toLowerCase();
      itemId = userMap.get(normalizedClassification) || globalMap.get(normalizedClassification) || initialMap.get(normalizedClassification) || "";
    }

    const masterItem = itemId ? catalog[itemId] : null;

    // Normalize Togal wide columns into accessible lookup blocks. parseUsNumber honors
    // accounting/trailing-minus negatives and FLAGS ambiguous numbers instead of guessing
    // (Phase 3 / INV-8 #5). An ambiguous value comes back as 0 so no wrong number flows
    // into a total; we keep its ambiguity flag parallel to pick it up for the chosen column.
    const m1 = parseUsNumber(normalizedRow.get("quantity 1"));
    const m2 = parseUsNumber(normalizedRow.get("quantity 2"));
    const m3 = parseUsNumber(normalizedRow.get("quantity 3"));
    const measurements = [
      { qty: m1.value, uom: normalizeUom(String(normalizedRow.get("quantity1 uom") || "SF")) },
      { qty: m2.value, uom: normalizeUom(String(normalizedRow.get("quantity2 uom") || "")) },
      { qty: m3.value, uom: normalizeUom(String(normalizedRow.get("quantity3 uom") || "")) },
    ];
    const ambiguousFlags = [m1.ambiguous, m2.ambiguous, m3.ambiguous];

    const targetUom = masterItem?.targetUom || "SF";
    const matchedIdx = measurements.findIndex(
      (m) => m.uom?.trim().toUpperCase() === targetUom.trim().toUpperCase()
    );
    const chosenIdx = matchedIdx !== -1 ? matchedIdx : 0;
    const matchedMeasurement = measurements[chosenIdx];

    // Fail loud, never guess: if the CHOSEN quantity was ambiguous, do not trust it — keep
    // qty 0 (matchedMeasurement.qty is already 0) and flag the row for human review.
    const needsReview = ambiguousFlags[chosenIdx];
    const qty = matchedMeasurement?.qty || 0;
    // Company-default layer (card rate or the catalog default). Keep the `|| 0`
    // fallback so an unmapped/missing itemId still resolves to 0 exactly as before
    // — the resolver returns the fallback on a card miss / when unprimed.
    const price = resolveCatalogPrice(itemId, masterItem?.defaultUnitPrice || 0);
    const total = qty * price;
    const dataFidelity = evaluateDataFidelity(qty, targetUom, total, threshold, keywords);

    return {
      id: `row-${index}`,
      classification,
      itemId,
      // procoreParentCode is catalog-sourced but NON-AUTHORITATIVE (exporter
      // fallback only when procoreCode is empty; removal deferred)
      procoreParentCode: masterItem?.procoreParentCode || "",
      // Single chokepoint: cost_code_map (primed at workspace mount), never the catalog
      procoreCode: resolveProcoreCode(itemId),
      description: masterItem?.description || "UNMAPPED - RECONCILE CODE",
      matchedQty: qty,
      uom: targetUom,
      unitPrice: price,
      total,
      isMapped: !!masterItem,
      rawQuantities: measurements,
      costType: masterItem?.costType || "M",
      dataFidelity,
      embeddedCode: embeddedCode || undefined,
      source: 'csv_import' as const,
      needsReview: needsReview || undefined,
    };
  }).filter((r): r is ProcessedTakeoffRow => r !== null);
}
