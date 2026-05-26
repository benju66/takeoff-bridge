import { InternalEstimateItem } from "@/types";

// Seed data from your company estimate spreadsheets
export const ESTIMATE_ITEMS_MASTER: Record<string, InternalEstimateItem> = {
  // --- Division 02 ---
  "02-9200.001": {
    itemId: "02-9200.001",
    procoreParentCode: "2-29200.000",
    description: "Survey and Layout - Perimeter Base",
    targetUom: "FT",
    defaultUnitPrice: 1.50,
    costType: "L"
  },

  // --- Division 03 (Concrete) ---
  "03-0000.001": {
    itemId: "03-0000.001",
    procoreParentCode: "3-30000.000",
    description: "Concrete Slab on Grade (6 Inch)",
    targetUom: "SF",
    defaultUnitPrice: 8.50,
    costType: "S"
  },
  "03-0000.002": {
    itemId: "03-0000.002",
    procoreParentCode: "3-30000.000",
    description: "Concrete Footings (3000 PSI)",
    targetUom: "CY",
    defaultUnitPrice: 180.00,
    costType: "S"
  },
  "03-0000.003": {
    itemId: "03-0000.003",
    procoreParentCode: "3-30000.000",
    description: "Concrete Piers & Grade Beams",
    targetUom: "CY",
    defaultUnitPrice: 220.00,
    costType: "S"
  },
  "03-0000.004": {
    itemId: "03-0000.004",
    procoreParentCode: "3-30000.000",
    description: "Concrete Structural Columns",
    targetUom: "CY",
    defaultUnitPrice: 250.00,
    costType: "S"
  },
  "03-0000.005": {
    itemId: "03-0000.005",
    procoreParentCode: "3-30000.000",
    description: "Concrete Foundation Walls",
    targetUom: "SF",
    defaultUnitPrice: 32.00,
    costType: "S"
  },
  "03-0000.006": {
    itemId: "03-0000.006",
    procoreParentCode: "3-30000.000",
    description: "Concrete Elevated Deck Slab",
    targetUom: "SF",
    defaultUnitPrice: 18.00,
    costType: "S"
  },
  "03-0000.007": {
    itemId: "03-0000.007",
    procoreParentCode: "3-30000.000",
    description: "Concrete Pan Stairs Fill",
    targetUom: "LF",
    defaultUnitPrice: 95.00,
    costType: "S"
  },
  "03-0000.008": {
    itemId: "03-0000.008",
    procoreParentCode: "3-30000.000",
    description: "Concrete Curbs & Gutters",
    targetUom: "LF",
    defaultUnitPrice: 28.00,
    costType: "S"
  },
  "03-0000.009": {
    itemId: "03-0000.009",
    procoreParentCode: "3-30000.000",
    description: "Concrete Sidewalks & Flatwork",
    targetUom: "SF",
    defaultUnitPrice: 9.00,
    costType: "S"
  },
  "03-0000.010": {
    itemId: "03-0000.010",
    procoreParentCode: "3-30000.000",
    description: "Concrete Slab Pre-treatment & Vapor Barrier",
    targetUom: "SF",
    defaultUnitPrice: 0.75,
    costType: "S"
  },
  "03-0000.011": {
    itemId: "03-0000.011",
    procoreParentCode: "3-30000.000",
    description: "Concrete Anchor Bolts & Embedded Plates",
    targetUom: "EA",
    defaultUnitPrice: 15.00,
    costType: "S"
  },
  "03-3543.001": {
    itemId: "03-3543.001",
    procoreParentCode: "3-33543.000",
    description: "Polished Concrete Finish",
    targetUom: "SF",
    defaultUnitPrice: 4.00,
    costType: "S"
  },

  // --- Division 04 (Masonry) ---
  "04-0000.001": {
    itemId: "04-0000.001",
    procoreParentCode: "4-40000.000",
    description: "Masonry - CMU Backup Around Building",
    targetUom: "SF",
    defaultUnitPrice: 25.00,
    costType: "M"
  },
  "04-0000.002": {
    itemId: "04-0000.002",
    procoreParentCode: "4-40000.000",
    description: "Masonry - Brick Veneer Exterior",
    targetUom: "SF",
    defaultUnitPrice: 32.00,
    costType: "S"
  },
  "04-0000.003": {
    itemId: "04-0000.003",
    procoreParentCode: "4-40000.000",
    description: "Masonry - Architectural Stone Accents",
    targetUom: "SF",
    defaultUnitPrice: 45.00,
    costType: "S"
  },
  "04-0000.004": {
    itemId: "04-0000.004",
    procoreParentCode: "4-40000.000",
    description: "Masonry - Steel Lintels & Wall Ties",
    targetUom: "LF",
    defaultUnitPrice: 12.00,
    costType: "S"
  },

  // --- Division 05 (Metals) ---
  "05-0000.001": {
    itemId: "05-0000.001",
    procoreParentCode: "5-50000.000",
    description: "Metals - Structural Steel Columns",
    targetUom: "LF",
    defaultUnitPrice: 85.00,
    costType: "S"
  },
  "05-0000.002": {
    itemId: "05-0000.002",
    procoreParentCode: "5-50000.000",
    description: "Metals - Structural Steel Beams",
    targetUom: "LF",
    defaultUnitPrice: 95.00,
    costType: "S"
  },
  "05-0000.003": {
    itemId: "05-0000.003",
    procoreParentCode: "5-50000.000",
    description: "Metals - Galvanized Metal Decking",
    targetUom: "SF",
    defaultUnitPrice: 6.50,
    costType: "S"
  },
  "05-0000.004": {
    itemId: "05-0000.004",
    procoreParentCode: "5-50000.000",
    description: "Metals - Steel Roof Joists & Bridging",
    targetUom: "LF",
    defaultUnitPrice: 40.00,
    costType: "S"
  },
  "05-0000.005": {
    itemId: "05-0000.005",
    procoreParentCode: "5-50000.000",
    description: "Metals - Decorative Metal Handrails",
    targetUom: "LF",
    defaultUnitPrice: 110.00,
    costType: "S"
  },

  // --- Division 07 (Thermal & Moisture Protection) ---
  "07-0000.001": {
    itemId: "07-0000.001",
    procoreParentCode: "7-70000.000",
    description: "Thermal - Rigid Foam Cavity Insulation",
    targetUom: "SF",
    defaultUnitPrice: 3.50,
    costType: "S"
  },
  "07-0000.002": {
    itemId: "07-0000.002",
    procoreParentCode: "7-70000.000",
    description: "Thermal - Fiberglass Batt Insulation",
    targetUom: "SF",
    defaultUnitPrice: 1.80,
    costType: "S"
  },
  "07-0000.003": {
    itemId: "07-0000.003",
    procoreParentCode: "7-70000.000",
    description: "Thermal - Spray Polyurethane Foam Insulation",
    targetUom: "SF",
    defaultUnitPrice: 4.75,
    costType: "S"
  },
  "07-0000.004": {
    itemId: "07-0000.004",
    procoreParentCode: "7-70000.000",
    description: "Moisture - TPO Roofing Membrane System",
    targetUom: "SF",
    defaultUnitPrice: 12.50,
    costType: "S"
  },
  "07-0000.005": {
    itemId: "07-0000.005",
    procoreParentCode: "7-70000.000",
    description: "Moisture - Polyethylene Vapor Barrier Under Slab",
    targetUom: "SF",
    defaultUnitPrice: 0.95,
    costType: "S"
  },
  "07-0000.006": {
    itemId: "07-0000.006",
    procoreParentCode: "7-70000.000",
    description: "Moisture - Joint Sealants & Exterior Caulking",
    targetUom: "LF",
    defaultUnitPrice: 2.50,
    costType: "S"
  }
};

// Initial registry dictionary for exact matching routines
export const INITIAL_MAPPING_REGISTRY: Record<string, string> = {
  // Existing initial seed mapping pairs
  "Alt - CMU": "04-0000.001",
  "02 - Amenity Deck": "03-3543.001",
  "02 - Perimeter of Garage": "02-9200.001",

  // Expansion mapping coverage
  "Slab on Grade": "03-0000.001",
  "Concrete Footings": "03-0000.002",
  "Concrete Foundation Walls": "03-0000.005",
  "Elevated Concrete Slab": "03-0000.006",
  "Exterior Brick Veneer": "04-0000.002",
  "Decorative Metal Railings": "05-0000.005",
  "TPO Roofing Area": "07-0000.004",
  "Under Slab Vapor Barrier": "07-0000.005",
  "Joint Sealants Exterior": "07-0000.006"
};
