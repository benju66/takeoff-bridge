import { ProcessedTakeoffRow, ColumnDefinition } from "./index";

export interface Project {
  id: string;
  name: string;
  location: string;
  squareFootage: number;
  unitCount: number;
  bidDate: string;
  createdAt: string;
  buildingPerimeter?: number;
  buildingFootprint?: number;
  podiumArea?: number;
  woodframedArea?: number;
  levelsAbovePodium?: number;
  expectedStart?: string;
  expectedFinish?: string;
}

export interface ProjectEstimate {
  id?: string;
  projectId: string;
  subtotal: number;
  generalLiability: number;
  fee: number;
  totalCost: number;
  items: ProcessedTakeoffRow[];
  generalConditionsTotal?: number;
  gcUtilization?: Record<string, number>;
  gcEquipmentOverrides?: Record<string, number>;
  siteOperationsTotal?: number;
  siteOpsQuantities?: Record<string, number>;
  siteOpsRates?: Record<string, number>;
  updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Raw DB Row Shapes (before mapping to application-layer types)
// ---------------------------------------------------------------------------

/** Raw DB row shape for estimate_line_items (before mapping to ProcessedTakeoffRow) */
export interface DbEstimateLineItem {
  id: string;
  project_id: string;
  sort_order: number;
  classification: string;
  item_id: string;
  procore_parent_code: string;
  description: string;
  matched_qty: number;
  uom: string;
  unit_price: number;
  total: number;
  is_mapped: boolean;
  raw_quantities: { qty: number; uom: string }[];
  cost_type: string;
  custom_fields: Record<string, string | number>;
}

/** Project-isolated classification → cost code mapping registry */
export interface DbProjectRegistry {
  project_id: string;
  registry: Record<string, string>;
}

/** Global corporate classification → cost code mapping registry */
export interface DbGlobalRegistry {
  id: number;
  registry: Record<string, string>;
}

/** Custom column definitions persisted per project */
export interface DbProjectColumnDefs {
  project_id: string;
  column_defs: ColumnDefinition[];
}

/** Cell lock state persisted per project */
export interface DbProjectLockedCells {
  project_id: string;
  locked_cells: Record<string, boolean>;
}
