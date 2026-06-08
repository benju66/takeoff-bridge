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
  tenantId?: string;
  createdBy?: string;
  constructionContingencyRate?: number;
  designContingencyRate?: number;
  buildersRiskRate?: number;
  specialInsuranceRate?: number;
  glInsuranceRate?: number;
  bondRate?: number;
  feeRate?: number;
  roundingRule?: string;
  /** Phase 3a: template selection key (multifamily | ti | medical); UI wiring lands in Phase 3b */
  projectType?: string;
  /** Market sector classification (display label, e.g. 'Healthcare'; '' = unset legacy project) */
  marketSector?: string;
}

export interface ProjectEstimate {
  id?: string;
  projectId: string;
  subtotal: number;
  constructionContingency: number;
  designContingency: number;
  buildersRisk: number;
  specialInsurance: number;
  glInsurance: number;
  bond: number;
  fee: number;
  totalCost: number;
  items: ProcessedTakeoffRow[];
  generalConditionsTotal?: number;
  gcUtilization?: Record<string, number>;
  gcEquipmentOverrides?: Record<string, number>;
  siteOperationsTotal?: number;
  siteOpsQuantities?: Record<string, number>;
  siteOpsRates?: Record<string, number>;
  /**
   * Point-in-time company rate card frozen for this estimate (Rate-card Phase B),
   * `Record<line_code, rate>`. `{}` until the estimate's first save captures the
   * card; thereafter immutable. Calc reads this over the live card so future
   * card edits never move a saved estimate's totals.
   */
  rateCardSnapshot?: Record<string, number>;
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
  /** Phase 3a: persisted granular Procore code (manual-override support) */
  procore_code: string;
  description: string;
  matched_qty: number;
  uom: string;
  unit_price: number;
  total: number;
  is_mapped: boolean;
  raw_quantities: { qty: number; uom: string }[];
  cost_type: string;
  custom_fields: Record<string, string | number>;
  data_fidelity: 'discrete_unit' | 'macro_lump_sum';
}

/** Project-isolated classification → cost code mapping registry */
export interface DbProjectRegistry {
  project_id: string;
  registry: Record<string, string>;
}

/** Global corporate classification → cost code mapping registry */
export interface DbGlobalRegistry {
  tenant_id?: string;
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

export interface DivisionLayout {
  division: string;
  headerRow: number;
  startRow: number;
  endRow: number;
  label?: string;
}

/**
 * Bottom-of-sheet row geometry for the STEP 4 - ESTIMATE sheet.
 * Values are ORIGINAL template row numbers (pre-insertion); the exporter
 * applies its rowShift on top. Derived in code, not stored:
 *   - auto-filter / print-area data boundary = subtotalRow - 1
 *   - sheet dimension end = reconStartRow + 3 (4 reconciliation rows)
 *   - data start row = divisions[0].headerRow; column-header row = that - 1
 *   - grand total row = subtotalRow + grandTotalOffset
 *   - modifier rows = subtotalRow + modifierStartOffset..modifierEndOffset
 */
export interface TemplateLayoutAnchors {
  /** Itemized subtotal row (e.g. 331) */
  subtotalRow: number;
  /** First modifier row, as an offset from subtotalRow (e.g. 2 → row 333) */
  modifierStartOffset: number;
  /** Last modifier row, as an offset from subtotalRow (e.g. 8 → row 339) */
  modifierEndOffset: number;
  /** Grand total row, as an offset from subtotalRow (e.g. 10 → row 341) */
  grandTotalOffset: number;
  /** First of the 4 reconciliation rows (e.g. 346) */
  reconStartRow: number;
}

/** Names of the Procore rollup sheets resolved by the exporter. */
export interface TemplateSheetNames {
  budgetLineItems: string;
  importerDataFields: string;
}

/**
 * Phase 3b: the self-describing layout object stored in
 * template_config.config_data. The single source of truth for the exporter's
 * row geometry — there is no hardcoded fallback (the app throws if this is
 * missing or still in the legacy bare-array shape).
 */
export interface TemplateLayoutConfig {
  divisions: DivisionLayout[];
  anchors: TemplateLayoutAnchors;
  sheetNames: TemplateSheetNames;
}

export interface TemplateConfig {
  id: string;
  templateName: string;
  sheetName: string;
  configType: string;
  configData: TemplateLayoutConfig;
  createdAt?: string;
  updatedAt?: string;
  /** Phase 3a: per-project-type template selection (deferred — dormant) */
  projectType?: string | null;
}

/** App-owned internal → granular Procore code mapping (cost_code_map table) */
export interface CostCodeMapEntry {
  templateName: string;
  internalCode: string;
  procoreCode: string;
  source: 'template' | 'sibling' | 'manual';
}

/**
 * Company default rate for one rate-bearing GC/Site Ops line (rate_card table,
 * Rate-card slice 1, Phase A). Keyed by the constants.ts line `code`. Seeded
 * from constants.ts (source='seed', equals today's values); the /rates editor
 * stamps source='manual'. The company-default layer of the resolution chain
 * rate = projectOverride ?? projectSnapshot ?? companyCard (see rateResolver.ts).
 */
export interface RateCardEntry {
  templateName: string;
  lineCode: string;
  rate: number;
  source: 'seed' | 'manual';
}

