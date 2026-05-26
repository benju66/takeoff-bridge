import { InternalEstimateItem } from "@/types";

// Seed data from your company estimate spreadsheets
export const ESTIMATE_ITEMS_MASTER: Record<string, InternalEstimateItem> = {
  "04-0000.001": {
    itemId: "04-0000.001",
    procoreParentCode: "4-40000.000",
    description: "Masonry - CMU Backup Around Building",
    targetUom: "SF",
    defaultUnitPrice: 25.00,
    costType: "M"
  },
  "03-3543.001": {
    itemId: "03-3543.001",
    procoreParentCode: "3-33543.000",
    description: "Polished Concrete",
    targetUom: "SF",
    defaultUnitPrice: 4.00,
    costType: "S"
  },
  "02-9200.001": {
    itemId: "02-9200.001",
    procoreParentCode: "2-29200.000",
    description: "Survey and Layout - Perimeter Base",
    targetUom: "FT",
    defaultUnitPrice: 1.50,
    costType: "L"
  }
};

// Initial registry dictionary for exact matching routines
export const INITIAL_MAPPING_REGISTRY: Record<string, string> = {
  "Alt - CMU": "04-0000.001",
  "02 - Amenity Deck": "03-3543.001",
  "02 - Perimeter of Garage": "02-9200.001"
};
