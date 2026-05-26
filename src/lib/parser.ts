import { TogalRowPayload, ProcessedTakeoffRow } from "@/types";
import { ESTIMATE_ITEMS_MASTER, INITIAL_MAPPING_REGISTRY } from "./mock-data";

/**
 * Safely fetches a property from an object regardless of case-casing in the keys.
 */
function getCaseInsensitiveProp(obj: unknown, targetKey: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  const typedObj = obj as Record<string, unknown>;
  const targetLower = targetKey.toLowerCase().trim();
  const foundKey = Object.keys(typedObj).find((key) => key.toLowerCase().trim() === targetLower);
  return foundKey ? typedObj[foundKey] : undefined;
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

export function parseTogalCSV(
  rawRows: TogalRowPayload[],
  userRegistry: Record<string, string> = {}
): ProcessedTakeoffRow[] {
  return rawRows.map((row, index) => {
    const rawClassification = getCaseInsensitiveProp(row, "Classification");
    const classification = typeof rawClassification === "string" ? rawClassification.trim() : String(rawClassification || "").trim();
    if (!classification) return null;

    // Direct match first: userRegistry override has priority over INITIAL_MAPPING_REGISTRY constant
    let itemId = userRegistry[classification] || INITIAL_MAPPING_REGISTRY[classification] || "";
    
    // Fallback: trimmed, case-insensitive mapping lookup to be highly robust
    if (!itemId) {
      const normalizedClassification = classification.toLowerCase();
      
      // Attempt to match row classifications against userRegistry overrides first
      const userMatchedKey = Object.keys(userRegistry).find(
        (key) => key.trim().toLowerCase() === normalizedClassification
      );
      if (userMatchedKey) {
        itemId = userRegistry[userMatchedKey];
      } else {
        // Fallback to INITIAL_MAPPING_REGISTRY constants
        const initialMatchedKey = Object.keys(INITIAL_MAPPING_REGISTRY).find(
          (key) => key.trim().toLowerCase() === normalizedClassification
        );
        if (initialMatchedKey) {
          itemId = INITIAL_MAPPING_REGISTRY[initialMatchedKey];
        }
      }
    }

    const masterItem = itemId ? ESTIMATE_ITEMS_MASTER[itemId] : null;

    // Normalize Togal wide columns into accessible lookup blocks with clean float parsing
    const measurements = [
      { qty: parseCleanFloat(getCaseInsensitiveProp(row, "Quantity 1")), uom: String(getCaseInsensitiveProp(row, "Quantity1 UOM") || "SF") },
      { qty: parseCleanFloat(getCaseInsensitiveProp(row, "Quantity 2")), uom: String(getCaseInsensitiveProp(row, "Quantity2 UOM") || "") },
      { qty: parseCleanFloat(getCaseInsensitiveProp(row, "Quantity 3")), uom: String(getCaseInsensitiveProp(row, "Quantity3 UOM") || "") },
    ];

    const targetUom = masterItem?.targetUom || "SF";
    const matchedMeasurement = measurements.find(
      (m) => m.uom?.trim().toUpperCase() === targetUom.trim().toUpperCase()
    ) || measurements[0];

    const qty = matchedMeasurement?.qty || 0;
    const price = masterItem?.defaultUnitPrice || 0;

    return {
      id: `row-${index}`,
      classification,
      itemId,
      procoreParentCode: masterItem?.procoreParentCode || "",
      description: masterItem?.description || "UNMAPPED - RECONCILE CODE",
      matchedQty: qty,
      uom: targetUom,
      unitPrice: price,
      total: qty * price,
      isMapped: !!masterItem,
      rawQuantities: measurements,
      costType: masterItem?.costType || "M",
    };
  }).filter((r): r is ProcessedTakeoffRow => r !== null);
}
