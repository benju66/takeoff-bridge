export interface TogalRowPayload {
  Classification: string;
  "Quantity 1": string | number;
  "Quantity1 UOM"?: string;
  "Quantity 2"?: string | number;
  "Quantity2 UOM"?: string;
  "Quantity 3"?: string | number;
  "Quantity3 UOM"?: string;
}

export interface InternalEstimateItem {
  itemId: string;          // e.g., "04-0000.001"
  procoreParentCode: string; // e.g., "4-40000.000"
  description: string;
  targetUom: string;       // e.g., "SF", "FT", "EA"
  defaultUnitPrice: number;
  costType: string;        // e.g., "M" (Materials), "S" (Subcontract), "L" (Labor)
}

export interface ProcessedTakeoffRow {
  id: string;
  classification: string;
  itemId: string;
  procoreParentCode: string;
  description: string;
  matchedQty: number;
  uom: string;
  unitPrice: number;
  total: number;
  isMapped: boolean;
  // Raw quantities extracted from CSV to enable dynamic target UOM re-matching
  rawQuantities: { qty: number; uom: string }[];
  costType: string;        // Dynamic costType mapped from InternalEstimateItem
}
