import { ProcessedTakeoffRow, ColumnDefinition } from "./index";
import type { CatalogLifecycleStatus } from "@/lib/catalogLifecycle";

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
  /**
   * Import past bids (Phase 1): true = created by importing a finished
   * company-template estimate. The 10 GC/Site-Ops linked-division line items
   * carry hand-authored lump sums the app cannot re-derive from staffing inputs
   * (finding G-2); for imported projects the workspace treats those saved rows'
   * stored qty×unitPrice as the authoritative linked totals (linkedTotalsFromRows)
   * so a reopened import still ties to the cent. Default false = a normal project.
   */
  isImported?: boolean;
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
  /**
   * IMPORTED bids only: the bid's own hand-authored STEP 2/3 line detail,
   * captured once at import (db.ts saveImportedStep23Lines) and read-only
   * thereafter. `undefined` for app-born projects and for imports saved before
   * the column existed (the workspace shows "re-import to capture detail").
   * Deliberately outside the save_estimate RPC's upsert column list, so
   * workspace auto-save can never overwrite it.
   */
  importedStep23Lines?: ImportedStep23Lines;
  updatedAt?: string;
}

/** One hand-authored STEP 2/3 line from an imported bid (JSONB contract —
 *  structurally identical to templateExtractor's ExtractedSheetLine). */
export interface ImportedSheetLine {
  code: string;
  description: string;
  utilization: number | null;
  qty: number;
  rate: number;
  total: number;
  rowNumber: number;
  /** As-bid UOM from col G (uppercased; "" when the bid's cell was blank).
   *  OPTIONAL: payloads saved before Phase 3 Slice 0 lack it — render "—". */
  uom?: string;
  /** Deterministic GC/Site-Ops code the estimator assigned at the import
   *  review gate (additive, architect-locked 2026-06-10): set only when the
   *  line could not resolve on its own; the as-bid `code` is never rewritten.
   *  Wins over description matching in resolveStep23Line. OPTIONAL: absent on
   *  every payload saved before the review gate existed. */
  assignedCode?: string;
}

/** The `project_estimates.imported_step23_lines` JSONB payload. */
export interface ImportedStep23Lines {
  step2Lines: ImportedSheetLine[];
  step3Lines: ImportedSheetLine[];
  /** The bid's STEP 2/3 section subtotals keyed by the linked STEP 4 itemId
   *  they feed (tie context for the read-only panels). */
  linkedSourceSubtotals: { itemId: string; total: number | null }[];
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

/**
 * A user-minted GC/Site-Ops line definition (custom_step23_line_defs table,
 * import STEP 2/3 review gate Phase 2). Minted at the import gate when no
 * built-in constants.ts line fits; the step23Normalization resolver overlays
 * these on the built-in defs at render time, so a minted code labels matching
 * lines in every stored bid retroactively. Structurally a Step23LineDef
 * (code + label) plus the mint-form extras. A label, resolver target, and
 * /rates mining key ONLY — no rate_card row, no calculator line, no ADOPT.
 */
/**
 * Lifecycle/reconciliation state of an in-app catalog addition (catalog_additions
 * table, Catalog Manager Phase 6). 'active' = a live overlay row layered on the
 * built-in catalog; 'landed' = the addition's code now ships in a fresh harvest
 * (estimate-catalog.json), so the built-in wins the overlay by construction and
 * the row remains only as the audit/provenance + reconciliation record.
 */
export type CatalogAdditionStatus = 'active' | 'landed';

/**
 * An in-app STEP 4 catalog addition (catalog_additions table, Catalog Manager
 * Phase 6 — the runtime catalog overlay). A brand-new catalog code created on
 * /catalog (Phase 7 UI) that works everywhere immediately — pickers, import
 * matching, row birth, mapping, rates — with no redeploy. The catalog chokepoint
 * (src/lib/catalog.ts) overlays these on the harvested built-ins at render time;
 * a built-in ALWAYS wins a code collision.
 *
 * SELF-CONTAINED: the row carries its OWN procoreCode + defaultUnitPrice, so
 * cost_code_map / rate_card get NO widening — the cost-code resolver overlays
 * procoreCode and the catalog-price resolver overlays defaultUnitPrice for
 * addition itemIds. Structurally an InternalEstimateItem (minus procoreParentCode,
 * which mirrors procoreCode for additions) plus status/source provenance.
 *
 * FREEZE-AT-BIRTH: defaultUnitPrice reaches a row only at birth; a saved row
 * persists its own unitPrice, so editing an addition never retro-moves it.
 */
export interface CatalogAddition {
  /** Deterministic catalog code, e.g. "11-5000.010" — may never shadow a built-in. */
  itemId: string;
  /** Import-match / display label (non-empty). */
  description: string;
  /** Target UOM ("" when the addition has none). */
  targetUom: string;
  /** Birth-time unit price (may be a negative deduction). */
  defaultUnitPrice: number;
  /** Cost type: 'L' (Labor) | 'M' (Materials) | 'S' (Subcontract). */
  costType: string;
  /** Granular Procore Budget Line Item — required at birth, validated against
   *  the Importer list (PROCORE_VALID_CODES) app-side. */
  procoreCode: string;
  status: CatalogAdditionStatus;
  source: 'catalog_manager' | 'manual';
}

export interface CustomStep23LineDef {
  /** Deterministic code, e.g. "02-4100.003" — may never shadow a built-in. */
  code: string;
  /** Display name; drives description auto-resolution (defaults to the minted
   *  line's as-bid description at the gate). */
  label: string;
  /** As-bid UOM at mint time ("" when the bid had none). */
  unit: string;
  /** Optional Procore Budget Line Item; null until Catalog Manager fills it. */
  procoreCode: string | null;
  source: 'import_gate' | 'manual';
  /**
   * Lifecycle state (Catalog Manager Phase 1). ABSENT === 'active' — every
   * existing row and code path degrades unchanged until Phase 2 writes these.
   * 'retired' leaves all pickers but keeps labeling old lines; 'merged'
   * redirects to `mergedInto` at render time. See `src/lib/catalogLifecycle.ts`.
   */
  status?: CatalogLifecycleStatus;
  /** Winning code when `status === 'merged'`; null/absent otherwise. */
  mergedInto?: string | null;
}

