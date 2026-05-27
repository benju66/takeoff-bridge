import { InternalEstimateItem } from "@/types";

// Seed data from your company estimate spreadsheets
export const ESTIMATE_ITEMS_MASTER: Record<string, InternalEstimateItem> = {
  // --- Division 01 ---
  "01-0000": {
    itemId: "01-0000",
    procoreParentCode: "1-10000.000",
    description: "General Conditions - Supervision",
    targetUom: "MO",
    defaultUnitPrice: 0,
    costType: "L"
  },
  "01-0400": {
    itemId: "01-0400",
    procoreParentCode: "1-10000.000",
    description: "General Conditions - Superintendent",
    targetUom: "MO",
    defaultUnitPrice: 0,
    costType: "L"
  },
  "01-0230": {
    itemId: "01-0230",
    procoreParentCode: "1-10000.000",
    description: "General Conditions - Project Management",
    targetUom: "MO",
    defaultUnitPrice: 0,
    costType: "L"
  },

  // --- Division 02 ---
  "02-4100": {
    itemId: "02-4100",
    procoreParentCode: "2-24100.000",
    description: "Site Requirements - Demolition & Clearing",
    targetUom: "LS",
    defaultUnitPrice: 0,
    costType: "S"
  },
  "02-9010": {
    itemId: "02-9010",
    procoreParentCode: "2-29010.000",
    description: "Progress Cleaning",
    targetUom: "HR",
    defaultUnitPrice: 74.00,
    costType: "L"
  },
  "02-9020": {
    itemId: "02-9020",
    procoreParentCode: "2-29020.000",
    description: "Temp Protection",
    targetUom: "SF",
    defaultUnitPrice: 0.25,
    costType: "M"
  },
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
    procoreParentCode: "5-51200.000",
    description: "Metals - Structural Steel Columns",
    targetUom: "LF",
    defaultUnitPrice: 85.00,
    costType: "S"
  },
  "05-0000.002": {
    itemId: "05-0000.002",
    procoreParentCode: "5-51200.000",
    description: "Metals - Structural Steel Beams",
    targetUom: "LF",
    defaultUnitPrice: 95.00,
    costType: "S"
  },
  "05-0000.003": {
    itemId: "05-0000.003",
    procoreParentCode: "5-51200.000",
    description: "Metals - Galvanized Metal Decking",
    targetUom: "SF",
    defaultUnitPrice: 6.50,
    costType: "S"
  },
  "05-0000.004": {
    itemId: "05-0000.004",
    procoreParentCode: "5-51200.000",
    description: "Metals - Steel Roof Joists & Bridging",
    targetUom: "LF",
    defaultUnitPrice: 40.00,
    costType: "S"
  },
  "05-0000.005": {
    itemId: "05-0000.005",
    procoreParentCode: "5-55000.000",
    description: "Metals - Decorative Metal Handrails",
    targetUom: "LF",
    defaultUnitPrice: 110.00,
    costType: "S"
  },

  // --- Division 06 (Wood, Plastics, & Composites) ---
  "06-1000.001": {
    itemId: "06-1000.001",
    procoreParentCode: "6-61000.000",
    description: "Rough Carpentry - Wood Framing Labor",
    targetUom: "SF",
    defaultUnitPrice: 6.50,
    costType: "S"
  },
  "06-1100.001": {
    itemId: "06-1100.001",
    procoreParentCode: "6-61100.000",
    description: "Wood Framing Materials (Timber & Studs)",
    targetUom: "MBF",
    defaultUnitPrice: 1150.00,
    costType: "M"
  },
  "06-1200.001": {
    itemId: "06-1200.001",
    procoreParentCode: "6-61200.000",
    description: "Sheathing - OSB Wall & Roof Panels",
    targetUom: "SF",
    defaultUnitPrice: 1.45,
    costType: "M"
  },

  // --- Division 07 (Thermal & Moisture Protection) ---
  "07-0000.001": {
    itemId: "07-0000.001",
    procoreParentCode: "7-72100.000",
    description: "Thermal - Rigid Foam Cavity Insulation",
    targetUom: "SF",
    defaultUnitPrice: 3.50,
    costType: "S"
  },
  "07-0000.002": {
    itemId: "07-0000.002",
    procoreParentCode: "7-72100.000",
    description: "Thermal - Fiberglass Batt Insulation",
    targetUom: "SF",
    defaultUnitPrice: 1.80,
    costType: "S"
  },
  "07-0000.003": {
    itemId: "07-0000.003",
    procoreParentCode: "7-72100.000",
    description: "Thermal - Spray Polyurethane Foam Insulation",
    targetUom: "SF",
    defaultUnitPrice: 4.75,
    costType: "S"
  },
  "07-0000.004": {
    itemId: "07-0000.004",
    procoreParentCode: "7-75000.000",
    description: "Moisture - TPO Roofing Membrane System",
    targetUom: "SF",
    defaultUnitPrice: 12.50,
    costType: "S"
  },
  "07-0000.005": {
    itemId: "07-0000.005",
    procoreParentCode: "7-71000.000",
    description: "Moisture - Polyethylene Vapor Barrier Under Slab",
    targetUom: "SF",
    defaultUnitPrice: 0.95,
    costType: "S"
  },
  "07-0000.006": {
    itemId: "07-0000.006",
    procoreParentCode: "7-79200.000",
    description: "Moisture - Joint Sealants & Exterior Caulking",
    targetUom: "LF",
    defaultUnitPrice: 2.50,
    costType: "S"
  },

  // --- Division 08 (Openings) ---
  "08-1100.001": {
    itemId: "08-1100.001",
    procoreParentCode: "8-81100.000",
    description: "Hollow Metal Doors & Frames",
    targetUom: "EA",
    defaultUnitPrice: 420.00,
    costType: "M"
  },
  "08-2000.001": {
    itemId: "08-2000.001",
    procoreParentCode: "8-82000.000",
    description: "Solid Core Interior Wood Doors",
    targetUom: "EA",
    defaultUnitPrice: 350.00,
    costType: "M"
  },
  "08-5000.001": {
    itemId: "08-5000.001",
    procoreParentCode: "8-85000.000",
    description: "Vinyl Double-Hung Windows",
    targetUom: "EA",
    defaultUnitPrice: 395.00,
    costType: "M"
  },
  "08-7100.001": {
    itemId: "08-7100.001",
    procoreParentCode: "8-87100.000",
    description: "Door Hardware Sets & Locks",
    targetUom: "EA",
    defaultUnitPrice: 85.00,
    costType: "M"
  },

  // --- Division 09 (Finishes) ---
  "09-2200.001": {
    itemId: "09-2200.001",
    procoreParentCode: "9-92200.000",
    description: "Metal Stud Wall Framing",
    targetUom: "LF",
    defaultUnitPrice: 15.00,
    costType: "S"
  },
  "09-2900.001": {
    itemId: "09-2900.001",
    procoreParentCode: "9-92900.000",
    description: "Gypsum Board / Drywall Assemblies",
    targetUom: "SF",
    defaultUnitPrice: 2.95,
    costType: "S"
  },
  "09-2900.002": {
    itemId: "09-2900.002",
    procoreParentCode: "9-92900.000",
    description: "Drywall Taping & Finishing",
    targetUom: "SF",
    defaultUnitPrice: 1.20,
    costType: "S"
  },
  "09-6000.001": {
    itemId: "09-6000.001",
    procoreParentCode: "9-96000.000",
    description: "Luxury Vinyl Plank (LVP) Flooring",
    targetUom: "SF",
    defaultUnitPrice: 5.50,
    costType: "S"
  },
  "09-9000.001": {
    itemId: "09-9000.001",
    procoreParentCode: "9-99000.000",
    description: "Interior Painting & Wall Coating",
    targetUom: "SF",
    defaultUnitPrice: 2.10,
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
  "Joint Sealants Exterior": "07-0000.006",

  // New Division 06 Multi-Family mappings
  "Rough Carpentry": "06-1000.001",
  "Wood Framing": "06-1100.001",
  "Sheathing": "06-1200.001",
  "Wall Sheathing": "06-1200.001",

  // New Division 08 Multi-Family mappings
  "Hollow Metal Doors": "08-1100.001",
  "Wood Doors": "08-2000.001",
  "Vinyl Windows": "08-5000.001",
  "Door Hardware": "08-7100.001",

  // New Division 09 Multi-Family mappings
  "Drywall Framing": "09-2200.001",
  "Metal Stud Framing": "09-2200.001",
  "Gypsum Board Assemblies": "09-2900.001",
  "Gypsum Board": "09-2900.001",
  "Drywall Taping": "09-2900.002",
  "Flooring": "09-6000.001",
  "LVP Flooring": "09-6000.001",
  "Painting": "09-9000.001",
  "Interior Painting": "09-9000.001"
};
