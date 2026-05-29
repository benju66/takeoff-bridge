import { InternalEstimateItem } from "@/types";
import estimateCatalogJson from "./estimate-catalog.json";

// Seed data from your company estimate spreadsheets, dynamically loaded from the harvested JSON
export const ESTIMATE_ITEMS_MASTER: Record<string, InternalEstimateItem> = estimateCatalogJson as unknown as Record<string, InternalEstimateItem>;

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
