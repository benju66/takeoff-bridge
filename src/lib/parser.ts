import { TogalRowPayload, ProcessedTakeoffRow } from "@/types";
import { ESTIMATE_ITEMS_MASTER, INITIAL_MAPPING_REGISTRY } from "./mock-data";
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

/**
 * Parses raw string numbers (handling formatting like commas, units, spaces) safely to floats.
 */
function parseCleanFloat(val: unknown): number {
  if (val === undefined || val === null || val === "") return 0;
  const cleaned = String(val).replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
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
    if (embeddedCode && ESTIMATE_ITEMS_MASTER[embeddedCode]) {
      itemId = embeddedCode;
    } else {
      itemId = userRegistry[classification] || globalRegistry[classification] || INITIAL_MAPPING_REGISTRY[classification] || "";
    }

    // Normalized fallback — single .get() per registry instead of O(N) .find() scans
    if (!itemId) {
      const normalizedClassification = classification.toLowerCase();
      itemId = userMap.get(normalizedClassification) || globalMap.get(normalizedClassification) || initialMap.get(normalizedClassification) || "";
    }

    const masterItem = itemId ? ESTIMATE_ITEMS_MASTER[itemId] : null;

    // Normalize Togal wide columns into accessible lookup blocks with clean float parsing
    const measurements = [
      { qty: parseCleanFloat(normalizedRow.get("quantity 1")), uom: normalizeUom(String(normalizedRow.get("quantity1 uom") || "SF")) },
      { qty: parseCleanFloat(normalizedRow.get("quantity 2")), uom: normalizeUom(String(normalizedRow.get("quantity2 uom") || "")) },
      { qty: parseCleanFloat(normalizedRow.get("quantity 3")), uom: normalizeUom(String(normalizedRow.get("quantity3 uom") || "")) },
    ];

    const targetUom = masterItem?.targetUom || "SF";
    const matchedMeasurement = measurements.find(
      (m) => m.uom?.trim().toUpperCase() === targetUom.trim().toUpperCase()
    ) || measurements[0];

    const qty = matchedMeasurement?.qty || 0;
    const price = masterItem?.defaultUnitPrice || 0;
    const total = qty * price;
    const dataFidelity = evaluateDataFidelity(qty, targetUom, total, threshold, keywords);

    return {
      id: `row-${index}`,
      classification,
      itemId,
      procoreParentCode: masterItem?.procoreParentCode || "",
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
    };
  }).filter((r): r is ProcessedTakeoffRow => r !== null);
}
