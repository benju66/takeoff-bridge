import { Project, ProjectEstimate, TemplateConfig, TemplateLayoutConfig, CostCodeMapEntry, RateCardEntry, ImportedStep23Lines, CustomStep23LineDef, CatalogAddition, CatalogAdditionStatus, CatalogCostTypeOverride, ProcoreCostCode, EstimateVersionMeta, EstimateVersionDetail, EstimateSectionLine, BudgetSnapshotMeta, BudgetSnapshotDetail, BudgetSnapshotAllocation } from "@/types/db";
import { buildBudgetSnapshotPayload, buildActualCostObservations } from "./actuals";
import type {
  NormalizedActuals,
  CodeActual,
  ClassifiedChangeEvent,
  ActualsDiagnostics,
  FinalSnapshotInput,
  ActualCostObservation,
} from "./actuals";
import type { PriceObservation } from "./priceHistory";
import type { LineItemHealthFact } from "./dataHealth";
import type { Step23HistorySource } from "./step23Normalization";
import { isStep23DeterministicCode, isBuiltInStep23Code } from "./step23Normalization";
import { transitionError, redirectsToRepoint, isActive, type CatalogLifecycleStatus, type LifecycleDef } from "./catalogLifecycle";
import { isBuiltInCatalogCode } from "./catalog";
import { isValidProcoreCode } from "./procoreValidCodes";
import { TRUSTED_RESOLVED_BY, RANKING_RESOLVED_BY, type ResolvedBy } from "./resolvedBy";
import { rankClassificationHistory, type ClassificationObservation } from "./suggestionRanking";
import { ProcessedTakeoffRow, ColumnDefinition, EstimateOverrideRecord } from "@/types";
import type {
  Binding,
  Basis,
  BindingDefinition,
  EstimateBindingRecord,
  StoredBindingDefinition,
} from "./bindings/types";
import { TEMPLATE_STORAGE_BUCKET } from "./constants";
import { supabase } from "./supabase";
import type { Session } from "@supabase/supabase-js";

// ═══════════════════════════════════════════════════════════════════
// db.ts — Async Supabase data access layer
// Single persistence gateway. All consumer hooks and pages import
// from this file exclusively. No other file imports supabase.ts.
// ═══════════════════════════════════════════════════════════════════

// ---------------------------------------------------------------------------
// Helper: camelCase ↔ snake_case row mappers
// ---------------------------------------------------------------------------

function mapProjectFromRow(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    name: row.name as string,
    location: (row.location as string) || "",
    squareFootage: Number(row.square_footage) || 0,
    unitCount: Number(row.unit_count) || 0,
    bidDate: (row.bid_date as string) || "",
    createdAt: (row.created_at as string) || new Date().toISOString(),
    buildingPerimeter: row.building_perimeter != null ? Number(row.building_perimeter) : undefined,
    buildingFootprint: row.building_footprint != null ? Number(row.building_footprint) : undefined,
    podiumArea: row.podium_area != null ? Number(row.podium_area) : undefined,
    woodframedArea: row.woodframed_area != null ? Number(row.woodframed_area) : undefined,
    levelsAbovePodium: row.levels_above_podium != null ? Number(row.levels_above_podium) : undefined,
    expectedStart: (row.expected_start as string) || undefined,
    expectedFinish: (row.expected_finish as string) || undefined,
    tenantId: (row.tenant_id as string) || undefined,
    createdBy: (row.created_by as string) || undefined,
    constructionContingencyRate: row.construction_contingency_rate != null ? Number(row.construction_contingency_rate) : 0,
    designContingencyRate: row.design_contingency_rate != null ? Number(row.design_contingency_rate) : 0,
    buildersRiskRate: row.builders_risk_rate != null ? Number(row.builders_risk_rate) : 0,
    specialInsuranceRate: row.special_insurance_rate != null ? Number(row.special_insurance_rate) : 0,
    glInsuranceRate: row.gl_insurance_rate != null ? Number(row.gl_insurance_rate) : 0.01,
    bondRate: row.bond_rate != null ? Number(row.bond_rate) : 0,
    feeRate: row.fee_rate != null ? Number(row.fee_rate) : 0.05,
    roundingRule: (row.rounding_rule as string) || "none",
    projectType: (row.project_type as string) || "multifamily",
    marketSector: (row.market_sector as string) || "",
    isImported: row.is_imported === true,
    bidOutcome: (row.bid_outcome as Project["bidOutcome"]) || "unknown",
    deliveryMethod: (row.delivery_method as Project["deliveryMethod"]) || "unknown",
  };
}

function mapProjectToRow(project: Project): Record<string, unknown> {
  return {
    id: project.id,
    name: project.name,
    location: project.location,
    square_footage: project.squareFootage,
    unit_count: project.unitCount,
    bid_date: project.bidDate,
    created_at: project.createdAt,
    building_perimeter: project.buildingPerimeter ?? null,
    building_footprint: project.buildingFootprint ?? null,
    podium_area: project.podiumArea ?? null,
    woodframed_area: project.woodframedArea ?? null,
    levels_above_podium: project.levelsAbovePodium ?? null,
    expected_start: project.expectedStart ?? null,
    expected_finish: project.expectedFinish ?? null,
    tenant_id: project.tenantId ?? null,
    created_by: project.createdBy ?? null,
    construction_contingency_rate: project.constructionContingencyRate ?? 0,
    design_contingency_rate: project.designContingencyRate ?? 0,
    builders_risk_rate: project.buildersRiskRate ?? 0,
    special_insurance_rate: project.specialInsuranceRate ?? 0,
    gl_insurance_rate: project.glInsuranceRate ?? 0.01,
    bond_rate: project.bondRate ?? 0,
    fee_rate: project.feeRate ?? 0.05,
    rounding_rule: project.roundingRule ?? "none",
    project_type: project.projectType ?? "multifamily",
    market_sector: project.marketSector ?? "",
    is_imported: project.isImported ?? false,
    bid_outcome: project.bidOutcome ?? "unknown",
    delivery_method: project.deliveryMethod ?? "unknown",
  };
}

function mapLineItemFromRow(row: Record<string, unknown>): ProcessedTakeoffRow {
  const itemId = (row.item_id as string) || "";
  return {
    id: row.id as string,
    classification: (row.classification as string) || "",
    itemId,
    procoreParentCode: (row.procore_parent_code as string) || "",
    // Phase 3a: granular Procore code is persisted per line item (column
    // backfilled from cost_code_map; manual overrides survive reload).
    procoreCode: (row.procore_code as string) || "",
    description: (row.description as string) || "",
    matchedQty: Number(row.matched_qty) || 0,
    uom: (row.uom as string) || "SF",
    unitPrice: Number(row.unit_price) || 0,
    total: Number(row.total) || 0,
    isMapped: row.is_mapped === true,
    rawQuantities: Array.isArray(row.raw_quantities) ? (row.raw_quantities as { qty: number; uom: string }[]) : [],
    costType: (row.cost_type as string) || "M",
    customFields: (row.custom_fields != null && typeof row.custom_fields === "object" && !Array.isArray(row.custom_fields))
      ? (row.custom_fields as Record<string, string | number>)
      : {},
    dataFidelity: (row.data_fidelity as 'discrete_unit' | 'macro_lump_sum') || 'discrete_unit',
    source: (row.source as ProcessedTakeoffRow['source']) || 'template',
  };
}

function mapEstimateFromRow(row: Record<string, unknown>): Omit<ProjectEstimate, "items"> {
  return {
    projectId: row.project_id as string,
    subtotal: Number(row.subtotal) || 0,
    constructionContingency: Number(row.construction_contingency) || 0,
    designContingency: Number(row.design_contingency) || 0,
    buildersRisk: Number(row.builders_risk) || 0,
    specialInsurance: Number(row.special_insurance) || 0,
    glInsurance: Number(row.gl_insurance) || 0,
    bond: Number(row.bond) || 0,
    fee: Number(row.fee) || 0,
    totalCost: Number(row.total_cost) || 0,
    generalConditionsTotal: Number(row.general_conditions_total) || 0,
    siteOperationsTotal: Number(row.site_operations_total) || 0,
    // GC/Site-Ops Addressability Phase B6: the four Step 2/3 input blobs
    // (gc_utilization, gc_equipment_overrides, site_ops_quantities, site_ops_rates)
    // were RETIRED — the columns no longer exist. Step 2/3 inputs now live SOLELY in
    // estimate_section_lines; useProjectWorkspace reconstructs the blob-shaped records
    // for the hooks via sectionLinesToBlobs(). These fields stay OFF the mapped
    // estimate (the workspace overlays them for app-born projects).
    rateCardSnapshot: (row.rate_card_snapshot != null && typeof row.rate_card_snapshot === "object" && !Array.isArray(row.rate_card_snapshot))
      ? (row.rate_card_snapshot as Record<string, number>)
      : {},
    // Present only when the import captured it ('{}' default ↦ undefined).
    importedStep23Lines: (() => {
      const v = row.imported_step23_lines;
      if (v != null && typeof v === "object" && !Array.isArray(v) && Array.isArray((v as ImportedStep23Lines).step2Lines)) {
        return v as ImportedStep23Lines;
      }
      return undefined;
    })(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// Projects
// ═══════════════════════════════════════════════════════════════════

/**
 * Retrieves all saved projects from Supabase.
 */
export async function getProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to fetch projects from Supabase. Code:", error.code, "Message:", error.message, "Details:", error.details, "Hint:", error.hint);
    throw new Error(`Failed to fetch projects: ${error.message}`);
  }
  return (data || []).map(mapProjectFromRow);
}

/**
 * Retrieves a single project by its unique ID.
 */
export async function getProject(projectId: string): Promise<Project | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();

  if (error) {
    console.error(`Failed to fetch project ${projectId}`, error);
    throw new Error(`Failed to fetch project ${projectId}: ${error.message}`);
  }
  return data ? mapProjectFromRow(data) : null;
}

/**
 * Saves or updates a project record in Supabase.
 * Injects tenantId and createdBy automatically if not provided.
 */
export async function saveProject(project: Project): Promise<void> {
  const tenantId = project.tenantId || (await getCurrentTenantId());
  
  let userId: string | undefined = project.createdBy;
  if (!userId) {
    const { data: { session } } = await supabase.auth.getSession();
    userId = session?.user?.id;
  }

  const row = mapProjectToRow({
    ...project,
    tenantId,
    createdBy: userId,
  });

  const { error } = await supabase
    .from("projects")
    .upsert(row, { onConflict: "id" });

  if (error) {
    console.error("Failed to save project to Supabase", error);
    throw new Error(`Failed to save project: ${error.message}`);
  }
}

/**
 * Cleanly removes a project and all cascading related data.
 * ON DELETE CASCADE handles: project_estimates, estimate_line_items,
 * project_column_defs, project_locked_cells, project_registries.
 */
export async function deleteProjectData(projectId: string): Promise<void> {
  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", projectId);

  if (error) {
    console.error(`Failed to delete project ${projectId}`, error);
    throw new Error(`Failed to delete project ${projectId}: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Project Estimates (totals + markups — no line items)
// ═══════════════════════════════════════════════════════════════════

/**
 * Retrieves the estimate totals/markups for a project.
 * Does NOT include line items — use getEstimateLineItems() for those.
 */
export async function getProjectEstimate(
  projectId: string
): Promise<Omit<ProjectEstimate, "items"> | null> {
  const { data, error } = await supabase
    .from("project_estimates")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) {
    console.error(`Failed to fetch estimate for project ${projectId}`, error);
    throw new Error(`Failed to fetch estimate for project ${projectId}: ${error.message}`);
  }
  return data ? mapEstimateFromRow(data) : null;
}

/**
 * NaN/Infinity → 0. Financial fields must never persist a non-finite value.
 */
function sanitizeNum(val: number | null | undefined): number {
  if (val === null || val === undefined || isNaN(val) || !isFinite(val)) {
    return 0;
  }
  return val;
}

/**
 * Builds the snake_case project_estimates column object. Shared by the
 * standalone upsert (saveProjectEstimate) and the composed atomic RPC
 * (saveEstimate) so the column mapping + sanitization live in one place.
 * Excludes updated_at — that is stamped by the caller (client) or now() (RPC).
 */
function buildEstimateRow(estimate: Omit<ProjectEstimate, "items">) {
  return {
    project_id: estimate.projectId,
    subtotal: sanitizeNum(estimate.subtotal),
    construction_contingency: sanitizeNum(estimate.constructionContingency),
    design_contingency: sanitizeNum(estimate.designContingency),
    builders_risk: sanitizeNum(estimate.buildersRisk),
    special_insurance: sanitizeNum(estimate.specialInsurance),
    gl_insurance: sanitizeNum(estimate.glInsurance),
    bond: sanitizeNum(estimate.bond),
    fee: sanitizeNum(estimate.fee),
    total_cost: sanitizeNum(estimate.totalCost),
    general_conditions_total: sanitizeNum(estimate.generalConditionsTotal),
    site_operations_total: sanitizeNum(estimate.siteOperationsTotal),
    // GC/Site-Ops Addressability Phase B6: the four Step 2/3 input blobs were
    // RETIRED from project_estimates + the save_estimate RPC. Step 2/3 inputs are
    // persisted SOLELY via save_section_lines (saveSectionLines). The two NUMERIC
    // section totals above remain (display caches, still engine-derived).
    rate_card_snapshot: estimate.rateCardSnapshot ?? {},
  };
}

/**
 * Writes an imported bid's STEP 2/3 line detail (architect-approved column,
 * 2026-06-10). Called ONCE by the import flow, AFTER saveEstimate has created
 * the project_estimates row; the column is read-only thereafter (it is outside
 * the save_estimate RPC's upsert list, so auto-save never touches it).
 * Like overrides, this is imported-data fidelity the user can SEE — it THROWS
 * on failure (including a missing estimate row) rather than vanishing quietly.
 */
export async function saveImportedStep23Lines(
  projectId: string,
  payload: ImportedStep23Lines
): Promise<void> {
  const { data, error } = await supabase
    .from("project_estimates")
    .update({ imported_step23_lines: payload })
    .eq("project_id", projectId)
    .select("project_id");

  if (error) {
    console.error("Failed to save imported STEP 2/3 lines:", error);
    throw new Error(`Failed to save imported STEP 2/3 lines: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error(`Failed to save imported STEP 2/3 lines: no estimate row for project ${projectId}`);
  }
}

/**
 * Saves or updates project estimate totals/markups.
 * Does NOT persist line items — use saveEstimate() for an atomic write of both.
 */
export async function saveProjectEstimate(
  estimate: Omit<ProjectEstimate, "items">
): Promise<void> {
  const { error } = await supabase.from("project_estimates").upsert(
    { ...buildEstimateRow(estimate), updated_at: new Date().toISOString() },
    { onConflict: "project_id" }
  );

  if (error) {
    console.error("Failed to save project estimate:", {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code
    });
    throw new Error(`Failed to save project estimate: ${error.message} (Details: ${error.details || "none"})`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Estimate Line Items (Atomic RPC)
// ═══════════════════════════════════════════════════════════════════

/**
 * Retrieves all estimate line items for a project, ordered by sort_order.
 * Preserves the exact visual array position the user last saved.
 */
export async function getEstimateLineItems(
  projectId: string
): Promise<ProcessedTakeoffRow[]> {
  const { data, error } = await supabase
    .from("estimate_line_items")
    .select("*")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error(`Failed to fetch line items for project ${projectId}`, error);
    throw new Error(`Failed to fetch line items for project ${projectId}: ${error.message}`);
  }
  return (data || []).map(mapLineItemFromRow);
}

/**
 * Builds the p_items JSONB payload (row → snake_case, sort_order from array
 * index to preserve visual position). Shared by saveEstimateLineItems and the
 * composed atomic RPC (saveEstimate).
 */
function buildLineItemPayload(rows: ProcessedTakeoffRow[]) {
  return rows.map((row, index) => ({
    id: row.id,
    sort_order: index,
    classification: row.classification,
    item_id: row.itemId,
    procore_parent_code: row.procoreParentCode,
    procore_code: row.procoreCode || "",
    description: row.description,
    matched_qty: row.matchedQty,
    uom: row.uom,
    unit_price: row.unitPrice,
    total: row.total,
    is_mapped: row.isMapped,
    raw_quantities: row.rawQuantities,
    cost_type: row.costType,
    custom_fields: row.customFields || {},
    data_fidelity: row.dataFidelity || 'discrete_unit',
    source: row.source || 'template',
  }));
}

/**
 * Atomically saves all estimate line items via Supabase RPC.
 * Wraps DELETE + INSERT in a single PostgreSQL transaction.
 * sort_order is derived from the array index to preserve visual position.
 */
export async function saveEstimateLineItems(
  projectId: string,
  rows: ProcessedTakeoffRow[]
): Promise<void> {
  const { error } = await supabase.rpc("save_estimate_line_items", {
    p_project_id: projectId,
    p_items: buildLineItemPayload(rows),
  });

  if (error) {
    console.error("Failed to save estimate line items via RPC", error);
    throw new Error(`Failed to save estimate line items: ${error.message}`);
  }
}

/**
 * Atomically persists BOTH estimate totals/markups AND line items in a single
 * PostgreSQL transaction via the save_estimate RPC. Either everything lands or
 * nothing does — stored header totals can never diverge from their backing line
 * items. This replaces the prior two-call (saveProjectEstimate +
 * saveEstimateLineItems via Promise.all) approach in the auto-save pipeline,
 * which could half-commit on a partial failure (audit #4 — non-atomic save).
 */
export async function saveEstimate(
  estimate: Omit<ProjectEstimate, "items">,
  rows: ProcessedTakeoffRow[]
): Promise<void> {
  const { error } = await supabase.rpc("save_estimate", {
    p_estimate: buildEstimateRow(estimate),
    p_items: buildLineItemPayload(rows),
  });

  if (error) {
    console.error("Failed to save estimate atomically via RPC", error);
    throw new Error(`Failed to save estimate: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Section Lines (GC Personnel / Site Operations addressable lines)
// GC/Site-Ops Addressability Phase A2.
//
// estimate_section_lines holds one addressable row per Step 2 (GC) / Step 3
// (site_ops) line — line IDENTITY + estimator INPUTS only, NEVER a total
// (totals are recomputed by the calc engine: "derived, never frozen", plan
// ID-1). Persisted via its OWN atomic RPC (save_section_lines), independent of
// save_estimate, so a section-line save never rides the Step 4 line-item
// DELETE+INSERT replace. Read ORDER BY sort_order ASC (AGENTS.md sort-order
// integrity). Phase A2 only lays the gateway — nothing calls these yet (A3
// wires synthesis + dual-read/dual-write).
// ═══════════════════════════════════════════════════════════════════

const SECTION_LINE_COLUMNS =
  "id, project_id, section, code, procore_code, cost_type, label, entry_kind, inputs, sort_order, source, updated_at";

function mapSectionLineFromRow(row: Record<string, unknown>): EstimateSectionLine {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    section: row.section as EstimateSectionLine["section"],
    code: (row.code as string) || "",
    procoreCode: (row.procore_code as string) || "",
    costType: (row.cost_type as string) || "",
    label: (row.label as string) || "",
    entryKind: (row.entry_kind as string) || "",
    inputs: (row.inputs as Record<string, unknown>) ?? {},
    sortOrder: Number(row.sort_order) || 0,
    source: (row.source as string) || "template",
    updatedAt: (row.updated_at as string) || new Date().toISOString(),
  };
}

/**
 * Builds the p_lines JSONB payload (line → snake_case, sort_order from array
 * index to preserve visual position, mirroring buildLineItemPayload). No `total`
 * is ever written — the table has no total column.
 */
function buildSectionLinePayload(lines: EstimateSectionLine[]) {
  return lines.map((line, index) => ({
    id: line.id,
    section: line.section,
    code: line.code,
    procore_code: line.procoreCode,
    cost_type: line.costType,
    label: line.label,
    entry_kind: line.entryKind,
    inputs: line.inputs ?? {},
    sort_order: index,
    source: line.source || "template",
  }));
}

/**
 * Reads a project's GC/Site-Ops section lines, ordered by sort_order ASC so
 * manual positions survive (AGENTS.md). Callers (A3+) split by `section`.
 */
export async function getSectionLines(
  projectId: string
): Promise<EstimateSectionLine[]> {
  const { data, error } = await supabase
    .from("estimate_section_lines")
    .select(SECTION_LINE_COLUMNS)
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error(`Failed to fetch section lines for project ${projectId}`, error);
    throw new Error(`Failed to fetch section lines: ${error.message}`);
  }
  return (data || []).map(mapSectionLineFromRow);
}

/**
 * Atomically replaces a project's section lines via the save_section_lines RPC
 * (DELETE-all + INSERT in one transaction). sort_order is derived from the array
 * index to preserve visual position. THROWS on failure — these are authored
 * estimator inputs (like bindings), not fire-and-forget training data.
 */
export async function saveSectionLines(
  projectId: string,
  lines: EstimateSectionLine[]
): Promise<void> {
  const { error } = await supabase.rpc("save_section_lines", {
    p_project_id: projectId,
    p_lines: buildSectionLinePayload(lines),
  });

  if (error) {
    console.error("Failed to save section lines via RPC", error);
    throw new Error(`Failed to save section lines: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Project Registries (per-project classification → cost code)
// ═══════════════════════════════════════════════════════════════════

/**
 * Retrieves the project-isolated classification mapping registry.
 */
export async function getProjectRegistry(
  projectId: string
): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from("project_registries")
    .select("registry")
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) {
    console.error(`Failed to fetch registry for project ${projectId}`, error);
    throw new Error(`Failed to fetch registry for project ${projectId}: ${error.message}`);
  }
  return (data?.registry as Record<string, string>) || {};
}

/**
 * Saves or updates the project-isolated classification mapping registry.
 */
export async function saveProjectRegistry(
  projectId: string,
  registry: Record<string, string>
): Promise<void> {
  const { error } = await supabase.from("project_registries").upsert(
    { project_id: projectId, registry },
    { onConflict: "project_id" }
  );

  if (error) {
    console.error("Failed to save project registry", error);
    throw new Error(`Failed to save project registry: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Global Registry (corporate classification → cost code)
// ═══════════════════════════════════════════════════════════════════

/**
 * Retrieves the global corporate classification mapping registry.
 */
export async function getGlobalRegistry(): Promise<Record<string, string>> {
  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase
    .from("global_registry")
    .select("registry")
    .eq("tenant_id", tenantId)
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    console.error("Failed to fetch global registry", error);
    throw new Error(`Failed to fetch global registry: ${error.message}`);
  }
  return (data?.registry as Record<string, string>) || {};
}

/**
 * Saves the global corporate classification mapping registry.
 */
export async function saveGlobalRegistry(
  registry: Record<string, string>
): Promise<void> {
  const tenantId = await getCurrentTenantId();
  const { error } = await supabase
    .from("global_registry")
    .update({ registry })
    .eq("tenant_id", tenantId)
    .eq("id", 1);

  if (error) {
    console.error("Failed to save global registry", error);
    throw new Error(`Failed to save global registry: ${error.message}`);
  }
}

/**
 * Resets the global corporate registry to an empty map.
 */
export async function deleteGlobalRegistry(): Promise<void> {
  const tenantId = await getCurrentTenantId();
  const { error } = await supabase
    .from("global_registry")
    .update({ registry: {} })
    .eq("tenant_id", tenantId)
    .eq("id", 1);

  if (error) {
    console.error("Failed to clear global registry", error);
    throw new Error(`Failed to clear global registry: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Project Column Definitions
// ═══════════════════════════════════════════════════════════════════

/**
 * Retrieves custom column definitions for a project.
 */
export async function getProjectColumnDefs(
  projectId: string
): Promise<ColumnDefinition[] | null> {
  const { data, error } = await supabase
    .from("project_column_defs")
    .select("column_defs")
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) {
    console.error(`Failed to fetch column defs for project ${projectId}`, error);
    throw new Error(`Failed to fetch column defs for project ${projectId}: ${error.message}`);
  }
  return data ? (data.column_defs as ColumnDefinition[]) : null;
}

/**
 * Saves or updates custom column definitions for a project.
 */
export async function saveProjectColumnDefs(
  projectId: string,
  columnDefs: ColumnDefinition[]
): Promise<void> {
  const { error } = await supabase.from("project_column_defs").upsert(
    { project_id: projectId, column_defs: columnDefs },
    { onConflict: "project_id" }
  );

  if (error) {
    console.error("Failed to save project column defs", error);
    throw new Error(`Failed to save project column defs: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Project Locked Cells
// ═══════════════════════════════════════════════════════════════════

/**
 * Retrieves the cell lock state for a project.
 */
export async function getProjectLockedCells(
  projectId: string
): Promise<Record<string, boolean>> {
  const { data, error } = await supabase
    .from("project_locked_cells")
    .select("locked_cells")
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) {
    console.error(`Failed to fetch locked cells for project ${projectId}`, error);
    throw new Error(`Failed to fetch locked cells for project ${projectId}: ${error.message}`);
  }
  return (data?.locked_cells as Record<string, boolean>) || {};
}

/**
 * Saves or updates the cell lock state for a project.
 */
export async function saveProjectLockedCells(
  projectId: string,
  lockedCells: Record<string, boolean>
): Promise<void> {
  const { error } = await supabase.from("project_locked_cells").upsert(
    { project_id: projectId, locked_cells: lockedCells },
    { onConflict: "project_id" }
  );

  if (error) {
    console.error("Failed to save project locked cells", error);
    throw new Error(`Failed to save project locked cells: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Classification History (AI Training Data Pipeline)
// ═══════════════════════════════════════════════════════════════════

/**
 * Records a classification → cost code resolution event.
 * Each call inserts an immutable training observation.
 * Fire-and-forget callers should swallow errors — training data loss is non-critical.
 *
 * THE single write path to `resolved_by` (database fidelity Phase 2): the
 * parameter is typed against the documented vocabulary in resolvedBy.ts, so a
 * tag this module doesn't define cannot be written. Extend the vocabulary
 * there, never here.
 */
export async function recordClassificationResolution(
  classification: string,
  resolvedCode: string,
  projectId: string | null,
  resolvedBy: ResolvedBy,
  confidence: number = 1.0
): Promise<void> {
  const { error } = await supabase.from("classification_history").insert({
    classification,
    resolved_code: resolvedCode,
    project_id: projectId,
    resolved_by: resolvedBy,
    confidence,
  });

  if (error) {
    console.error("Failed to record classification resolution:", error);
    throw new Error(`Failed to record classification resolution: ${error.message}`);
  }
}

/**
 * Batch form of recordClassificationResolution for the import save's
 * suggestion-signal rows (fidelity Phase 5): ONE insert request instead of a
 * volley of single-row POSTs fired while the page navigates away — and a
 * rejected/overridden pair lands atomically or not at all. Same typed
 * vocabulary gate (a tag resolvedBy.ts doesn't define cannot compile); the
 * table stays append-only. Fire-and-forget callers swallow errors.
 *
 * `projectId` accepts null for signature parity with the single-row helper,
 * but the DEPLOYED insert policy only admits rows whose project the tenant
 * owns — a null-project insert is rejected by RLS. Always pass the saving
 * project's id.
 */
export async function recordClassificationResolutions(
  resolutions: readonly { classification: string; resolvedCode: string; resolvedBy: ResolvedBy }[],
  projectId: string | null
): Promise<void> {
  if (resolutions.length === 0) return;
  const { error } = await supabase.from("classification_history").insert(
    resolutions.map((r) => ({
      classification: r.classification,
      resolved_code: r.resolvedCode,
      project_id: projectId,
      resolved_by: r.resolvedBy,
      confidence: 1.0,
    }))
  );

  if (error) {
    console.error("Failed to record classification resolutions:", error);
    throw new Error(`Failed to record classification resolutions: ${error.message}`);
  }
}

/**
 * Retrieves all historical resolutions for a classification string.
 * Groups by resolved_code with count for AI confidence scoring.
 * Trusted observations only (resolvedBy.ts): lump-tagged rows stay recorded
 * but never feed a suggestion.
 *
 * LEGACY single-classification reader (no production consumers today): raw
 * row counts, no distinct-project dedupe, no lifecycle refile, no rejection
 * downweight. The ranking authority is getClassificationHistoryBulk →
 * suggestionRanking.ts — wire new suggestion consumers THERE, not here.
 */
export async function getClassificationHistory(
  classification: string
): Promise<{ resolvedCode: string; resolvedBy: string; confidence: number; count: number }[]> {
  const { data, error } = await supabase
    .from("classification_history")
    .select("resolved_code, resolved_by, confidence")
    .eq("classification", classification)
    .in("resolved_by", TRUSTED_RESOLVED_BY)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(`Failed to fetch classification history for "${classification}"`, error);
    throw new Error(`Failed to fetch classification history: ${error.message}`);
  }

  // Group by resolved_code and count occurrences
  const groups = new Map<string, { resolvedBy: string; confidence: number; count: number }>();
  for (const row of data || []) {
    const code = row.resolved_code as string;
    const existing = groups.get(code);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(code, {
        resolvedBy: row.resolved_by as string,
        confidence: Number(row.confidence) || 1.0,
        count: 1,
      });
    }
  }

  return Array.from(groups.entries()).map(([resolvedCode, data]) => ({
    resolvedCode,
    resolvedBy: data.resolvedBy,
    confidence: data.confidence,
    count: data.count,
  }));
}

/**
 * Bulk classification-history read for the import review (Phase 3 Slice 1):
 * one chunked `.in()` query for ALL the bid's line descriptions, grouped to
 * `classification → [{resolvedCode, count}]`, best suggestion first.
 * Classifications with no history are simply absent. READ-only; the table
 * stays append-only. Callers treat history as advisory (fail-soft) — an empty
 * map must leave the import flow working unchanged.
 *
 * Ranking is delegated to the pure suggestionRanking.ts (fidelity Phase 5):
 * trusted distinct-project counts are the base, rejection signals downweight,
 * recency tiebreaks, and `lifecycleDefs` (the caller's custom GC/Site-Ops
 * defs) refile merged codes under their winner and drop retired codes before
 * any scoring. The query allowlist (RANKING_RESOLVED_BY) fetches the trusted
 * base plus `suggestion_rejected` rows ONLY — a `user_lump` pairing or an
 * accepted/overridden signal row never even reaches the ranking code (record
 * everything, tagged — architect-locked).
 */
export async function getClassificationHistoryBulk(
  classifications: readonly string[],
  lifecycleDefs?: readonly LifecycleDef[]
): Promise<Map<string, { resolvedCode: string; count: number }[]>> {
  const unique = [...new Set(classifications.filter((c) => c.trim() !== ""))];
  if (unique.length === 0) return new Map();

  // PostgREST `.in()` lists go into the request URL — chunk to stay well clear
  // of URL-length limits on big bids (CARE alone has ~140 distinct lines).
  // Chunks are independent, so they run in parallel. WITHIN a chunk, page past
  // PostgREST's silent 1000-row response cap with a stable total order
  // (created_at, then id) — the ranking's dedupe and downweights need the
  // COMPLETE observation pool, and after a backlog push one chunk's
  // descriptions can easily carry more than 1000 history rows.
  const CHUNK = 100;
  const PAGE = 1000;
  const fetchChunk = async (chunk: string[]) => {
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("classification_history")
        .select("classification, resolved_code, resolved_by, project_id, created_at")
        .in("classification", chunk)
        .in("resolved_by", RANKING_RESOLVED_BY)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) {
        console.error("Failed to fetch bulk classification history:", error);
        throw new Error(`Failed to fetch bulk classification history: ${error.message}`);
      }
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) return rows;
    }
  };

  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += CHUNK) {
    chunks.push(unique.slice(i, i + CHUNK));
  }

  const observations: ClassificationObservation[] = [];
  for (const rows of await Promise.all(chunks.map(fetchChunk))) {
    for (const row of rows) {
      observations.push({
        classification: row.classification as string,
        resolvedCode: row.resolved_code as string,
        resolvedBy: (row.resolved_by as string) ?? "",
        projectId: (row.project_id as string | null) ?? null,
        createdAt: (row.created_at as string) ?? "",
      });
    }
  }

  return rankClassificationHistory(observations, lifecycleDefs);
}

/**
 * Unwraps a PostgREST `projects(...)` join cell (object, or array on older
 * client versions) into the observation's project context. Shared by the
 * imported and submitted-version price-history pools so the two can never
 * normalize the join differently.
 */
function mapObservationProjectContext(
  projects: unknown
): { name?: string; bid_date?: string; market_sector?: string } | null {
  return (Array.isArray(projects) ? projects[0] : projects) as
    | { name?: string; bid_date?: string; market_sector?: string }
    | null;
}

/**
 * Imported observations WITH their source project id — the internal shape the
 * Estimate Versioning supersede rule needs (getBidPriceHistory drops a
 * project's imported observations once it has a SUBMITTED version). Shared by
 * getImportedPriceHistory, whose public PriceObservation[] contract is
 * unchanged (the extra projectId field is a structural superset).
 */
async function fetchImportedPriceObservations(): Promise<(PriceObservation & { projectId: string })[]> {
  const { data, error } = await supabase
    .from("estimate_line_items")
    .select("project_id, item_id, unit_price, uom, matched_qty, data_fidelity, projects(name, bid_date, market_sector)")
    .eq("source", "imported")
    .neq("item_id", "")
    .neq("data_fidelity", "macro_lump_sum");

  if (error) {
    console.error("Failed to fetch imported price history:", error);
    throw new Error(`Failed to fetch imported price history: ${error.message}`);
  }

  return (data || []).map((row) => {
    const project = mapObservationProjectContext(row.projects);
    return {
      projectId: (row.project_id as string) || "",
      itemId: row.item_id as string,
      unitPrice: Number(row.unit_price) || 0,
      uom: ((row.uom as string) || "").trim().toUpperCase(),
      projectName: project?.name ?? "",
      bidDate: project?.bid_date ?? "",
      marketSector: project?.market_sector ?? "",
      // NOT NULL with defaults in the schema; `|| 0` / `?? ""` only guard a
      // malformed payload. A 0 qty is then excluded by the trust screen.
      qty: Number(row.matched_qty) || 0,
      dataFidelity: (row.data_fidelity as string) ?? "",
    };
  });
}

/**
 * Every AS-BID unit price on record (Phase 3 Slice 2): saved line items with
 * `source='imported'` (prices kept verbatim at import) joined to their project
 * context. READ-only fuel for the /rates price-history report — aggregation
 * lives in the pure historyTrust.ts; nothing here or there writes a rate.
 * Lines marked "combined" at the import gate (`data_fidelity='macro_lump_sum'`,
 * fidelity Phase 2) are excluded: one price lumping several scopes is not a
 * unit-price observation. The rows stay in the database untouched — the filter
 * is read-side only. (Column is NOT NULL with a default, so `neq` drops
 * nothing it shouldn't.) The RULE itself is owned by
 * historyTrust.observationExclusion (fidelity Phase 3) — the `neq` here is
 * only a fetch-size optimization, and qty + data_fidelity ride each
 * observation so the trust module can judge every row it receives.
 */
export async function getImportedPriceHistory(): Promise<PriceObservation[]> {
  return fetchImportedPriceObservations();
}

/**
 * Every imported bid's stored STEP 2/3 line detail with its project context
 * (Phase 3 Slice 3): `project_estimates.imported_step23_lines` payloads joined
 * to `projects`. READ-only fuel for the /rates staff-rate history report —
 * resolution + filtering live in the pure step23Normalization.ts; nothing
 * here or there writes a rate or touches the protected JSONB.
 */
export async function getImportedStep23History(): Promise<Step23HistorySource[]> {
  const { data, error } = await supabase
    .from("project_estimates")
    .select("imported_step23_lines, projects(name, bid_date, market_sector)")
    .not("imported_step23_lines", "is", null);

  if (error) {
    console.error("Failed to fetch imported STEP 2/3 history:", error);
    throw new Error(`Failed to fetch imported STEP 2/3 history: ${error.message}`);
  }

  const out: Step23HistorySource[] = [];
  for (const row of data || []) {
    const payload = row.imported_step23_lines;
    // Same shape gate as mapProjectFromRow: a malformed payload is skipped,
    // never thrown over — the report is advisory.
    if (
      payload == null ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      !Array.isArray((payload as ImportedStep23Lines).step2Lines) ||
      !Array.isArray((payload as ImportedStep23Lines).step3Lines)
    ) {
      continue;
    }
    const project = (Array.isArray(row.projects) ? row.projects[0] : row.projects) as
      | { name?: string; bid_date?: string; market_sector?: string }
      | null;
    out.push({
      payload: payload as ImportedStep23Lines,
      projectName: project?.name ?? "",
      bidDate: project?.bid_date ?? "",
      marketSector: project?.market_sector ?? "",
    });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// Estimate Snapshots (Version History / Milestones)
// ═══════════════════════════════════════════════════════════════════

/**
 * Creates a frozen snapshot of the current estimate state.
 * Fire-and-forget callers should swallow errors — snapshot loss is non-critical.
 */
export async function createEstimateSnapshot(
  projectId: string,
  lineItems: ProcessedTakeoffRow[],
  snapshotType: 'auto' | 'manual' | 'pre_import' | 'milestone',
  label?: string,
  summary?: Record<string, number>,
  metadata?: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase.from("estimate_snapshots").insert({
    project_id: projectId,
    snapshot_type: snapshotType,
    label: label || '',
    line_items: lineItems,
    summary: summary || {},
    metadata: metadata || {},
  });

  if (error) {
    console.error("Failed to create estimate snapshot:", error);
    throw new Error(`Failed to create estimate snapshot: ${error.message}`);
  }
}

/**
 * Retrieves snapshot metadata for a project (lightweight listing).
 * Does NOT include full line_items — use getSnapshotDetail() for that.
 */
export async function getEstimateSnapshots(
  projectId: string
): Promise<{ id: string; snapshotAt: string; snapshotType: string; label: string; itemCount: number }[]> {
  const { data, error } = await supabase
    .from("estimate_snapshots")
    .select("id, snapshot_at, snapshot_type, label, line_items")
    .eq("project_id", projectId)
    .order("snapshot_at", { ascending: false });

  if (error) {
    console.error(`Failed to fetch snapshots for project ${projectId}`, error);
    throw new Error(`Failed to fetch snapshots: ${error.message}`);
  }

  return (data || []).map((row) => ({
    id: row.id as string,
    snapshotAt: row.snapshot_at as string,
    snapshotType: row.snapshot_type as string,
    label: (row.label as string) || '',
    itemCount: Array.isArray(row.line_items) ? row.line_items.length : 0,
  }));
}

/**
 * Retrieves a single snapshot's full detail including line items.
 * Summary is returned from stored value — if empty, caller can recompute
 * via computeTakeoffSummary(lineItems, ...).
 */
export async function getSnapshotDetail(
  snapshotId: string
): Promise<{ lineItems: ProcessedTakeoffRow[]; summary: Record<string, number> } | null> {
  const { data, error } = await supabase
    .from("estimate_snapshots")
    .select("line_items, summary")
    .eq("id", snapshotId)
    .maybeSingle();

  if (error) {
    console.error(`Failed to fetch snapshot detail ${snapshotId}`, error);
    throw new Error(`Failed to fetch snapshot detail: ${error.message}`);
  }

  if (!data) return null;

  // Map raw JSONB rows back through the standard line item mapper
  const rawItems = Array.isArray(data.line_items) ? data.line_items : [];
  const lineItems = rawItems.map((item: Record<string, unknown>) => mapLineItemFromRow(item));

  return {
    lineItems,
    summary: (data.summary != null && typeof data.summary === "object" && !Array.isArray(data.summary))
      ? (data.summary as Record<string, number>)
      : {},
  };
}

// ═══════════════════════════════════════════════════════════════════
// Estimate Versions (Estimate Versioning module)
// ═══════════════════════════════════════════════════════════════════
//
// Named frozen versions of the live working copy (estimate_versions table).
// Payloads are immutable after creation (DB freeze-guard trigger); the only
// mutable state is the submission flag, and at most ONE version per project
// carries it (partial-unique index). Cost history is derived AT READ TIME
// from the submitted version (getBidPriceHistory) — no history table is ever
// written, so withdraw/replace follows submission automatically and
// double-counting is impossible by construction.

const ESTIMATE_VERSION_META_COLUMNS =
  "id, project_id, version_number, title, summary, is_submitted, submitted_at, created_at, created_by";

function mapEstimateVersionMetaFromRow(row: Record<string, unknown>): EstimateVersionMeta {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    versionNumber: Number(row.version_number) || 0,
    title: (row.title as string) || "",
    summary: (row.summary != null && typeof row.summary === "object" && !Array.isArray(row.summary))
      ? (row.summary as Record<string, number>)
      : {},
    isSubmitted: row.is_submitted === true,
    submittedAt: (row.submitted_at as string | null) ?? null,
    createdAt: (row.created_at as string) || new Date().toISOString(),
    createdBy: (row.created_by as string | null) ?? null,
  };
}

/**
 * Freezes the current working copy as the next numbered version via the
 * create_estimate_version RPC (per-project numbering assigned atomically
 * server-side). The line-item payload reuses buildLineItemPayload — the exact
 * frozen shape the save_estimate pipeline writes — and `summary` is the
 * engine's TakeoffSummary copied verbatim (calculations.ts stays the sole
 * financial authority; nothing here derives a dollar). A user-facing action,
 * not fire-and-forget: THROWS on failure.
 */
export async function createEstimateVersion(
  projectId: string,
  title: string,
  rows: ProcessedTakeoffRow[],
  summary: Record<string, number>
): Promise<EstimateVersionMeta> {
  const { data, error } = await supabase.rpc("create_estimate_version", {
    p_project_id: projectId,
    p_title: title.trim(),
    p_line_items: buildLineItemPayload(rows),
    p_summary: summary,
  });

  if (error || !data) {
    console.error(`Failed to create estimate version for project ${projectId}:`, error);
    throw new Error(`Failed to create estimate version: ${error?.message ?? "no row returned"}`);
  }

  return mapEstimateVersionMetaFromRow(data as Record<string, unknown>);
}

/**
 * Lightweight version list for a project (no frozen line_items — use
 * getEstimateVersionDetail for those), newest version first.
 */
export async function getEstimateVersions(projectId: string): Promise<EstimateVersionMeta[]> {
  const { data, error } = await supabase
    .from("estimate_versions")
    .select(ESTIMATE_VERSION_META_COLUMNS)
    .eq("project_id", projectId)
    .order("version_number", { ascending: false });

  if (error) {
    console.error(`Failed to fetch estimate versions for project ${projectId}`, error);
    throw new Error(`Failed to fetch estimate versions: ${error.message}`);
  }

  return (data || []).map(mapEstimateVersionMetaFromRow);
}

/**
 * One version's full frozen payload. Line items are mapped back through the
 * standard mapper (precedent: getSnapshotDetail), so the compare view diffs
 * the same ProcessedTakeoffRow shape the workbook renders.
 */
export async function getEstimateVersionDetail(
  versionId: string
): Promise<EstimateVersionDetail | null> {
  const { data, error } = await supabase
    .from("estimate_versions")
    .select(`${ESTIMATE_VERSION_META_COLUMNS}, line_items`)
    .eq("id", versionId)
    .maybeSingle();

  if (error) {
    console.error(`Failed to fetch estimate version ${versionId}`, error);
    throw new Error(`Failed to fetch estimate version: ${error.message}`);
  }

  if (!data) return null;

  const rawItems = Array.isArray(data.line_items) ? data.line_items : [];
  return {
    ...mapEstimateVersionMetaFromRow(data),
    lineItems: rawItems.map((item: Record<string, unknown>) => mapLineItemFromRow(item)),
  };
}

/**
 * Marks one version as the project's OFFICIAL BID — the one and only doorway
 * into cost history. The submit_estimate_version RPC clears the previously
 * submitted version (if any) and sets the target in a single transaction, so
 * the old observations withdraw exactly when the new ones take their place.
 * THROWS on failure (financial intent must never vanish quietly).
 */
export async function submitEstimateVersion(
  projectId: string,
  versionId: string
): Promise<void> {
  const { error } = await supabase.rpc("submit_estimate_version", {
    p_project_id: projectId,
    p_version_id: versionId,
  });

  if (error) {
    console.error(`Failed to submit estimate version ${versionId} for project ${projectId}:`, error);
    throw new Error(`Failed to submit estimate version: ${error.message}`);
  }
}

/**
 * Withdraws the project's submitted version with no replacement (the company
 * pulled out of the bid entirely): the project has no official record and its
 * observations leave cost history until something else is submitted. A single
 * flag flip — the DB freeze-guard trigger confines it to the submission pair.
 * A no-op when nothing is submitted. THROWS on failure.
 */
export async function withdrawSubmittedVersion(projectId: string): Promise<void> {
  const { error } = await supabase
    .from("estimate_versions")
    .update({ is_submitted: false, submitted_at: null })
    .eq("project_id", projectId)
    .eq("is_submitted", true);

  if (error) {
    console.error(`Failed to withdraw submitted version for project ${projectId}:`, error);
    throw new Error(`Failed to withdraw submitted version: ${error.message}`);
  }
}

/**
 * EVERY bid price observation on record — the /rates price-history source
 * (replaces the imported-only read). Two pools merge at read time:
 *
 *  1. SUBMITTED VERSIONS: each submitted version's frozen lines with a
 *     non-empty item_id AND total ≠ 0 (user-locked rule: only lines that
 *     actually carried dollars in the official bid count — untouched template
 *     scaffold rows at default prices never poison the medians).
 *  2. IMPORTED BIDS: the existing source='imported' observations, MINUS any
 *     project that now has a submitted version — the in-app official bid
 *     supersedes the imported record, so nothing double-counts. The supersede
 *     keys off the submitted version's EXISTENCE, not its observation yield.
 *
 * READ-only on both pools; aggregation stays in the pure priceHistory.ts.
 */
export async function getBidPriceHistory(): Promise<PriceObservation[]> {
  const [submittedRows, importedObservations] = await Promise.all([
    (async () => {
      const { data, error } = await supabase
        .from("estimate_versions")
        .select("project_id, line_items, projects(name, bid_date, market_sector)")
        .eq("is_submitted", true);

      if (error) {
        console.error("Failed to fetch submitted-version price history:", error);
        throw new Error(`Failed to fetch submitted-version price history: ${error.message}`);
      }
      return data || [];
    })(),
    fetchImportedPriceObservations(),
  ]);

  const submittedProjectIds = new Set<string>();
  const observations: PriceObservation[] = [];

  for (const row of submittedRows) {
    submittedProjectIds.add(row.project_id as string);
    const project = mapObservationProjectContext(row.projects);
    const items = Array.isArray(row.line_items) ? row.line_items : [];
    for (const item of items as Record<string, unknown>[]) {
      const itemId = (item.item_id as string) || "";
      const total = Number(item.total) || 0;
      // Only lines that carried dollars in the official bid are observations.
      if (!itemId || total === 0) continue;
      observations.push({
        itemId,
        unitPrice: Number(item.unit_price) || 0,
        uom: ((item.uom as string) || "").trim().toUpperCase(),
        projectName: project?.name ?? "",
        bidDate: project?.bid_date ?? "",
        marketSector: project?.market_sector ?? "",
        // qty + data_fidelity ride the frozen payload (buildLineItemPayload)
        // so historyTrust judges submitted lines by the SAME rules as imports
        // (zero-qty / combined-line exclusion — fidelity Phase 3).
        qty: Number(item.matched_qty) || 0,
        dataFidelity: (item.data_fidelity as string) ?? "",
      });
    }
  }

  for (const obs of importedObservations) {
    if (submittedProjectIds.has(obs.projectId)) continue;
    // Drop only the internal projectId; qty + dataFidelity stay on the
    // observation so the trust screen keeps judging imported rows.
    const { projectId: _projectId, ...observation } = obs;
    observations.push(observation);
  }

  return observations;
}

// ═══════════════════════════════════════════════════════════════════
// Budget Snapshots (Actuals Cost-History — Phase 2 storage spine)
// ═══════════════════════════════════════════════════════════════════
//
// Immutable point-in-time captures of a project's Procore Budget Detail (+
// change-event exports) after the Phase 1 normalization engine. Modeled on the
// Estimate Versions section above: the header + per-code actuals are frozen at
// creation (DB freeze-guard trigger), the only mutable header state is the
// promotion pair, and at most ONE snapshot per project is FINAL (partial-unique
// index). The per-line allocations table is a MUTABLE overlay (Phase 4) that
// freezes once its snapshot is FINAL. NO consumer wires these yet — Phase 2 lays
// the gateway (precedent: getProcoreCostCodes landed unwired); Phases 3/4/5/8 use
// it. The calc/normalization engine stays the sole financial authority.

const BUDGET_SNAPSHOT_META_COLUMNS =
  "id, project_id, snapshot_number, label, source_kind, grand_total_actual, grand_normalized_actual, burden_total_actual, direct_total_actual, metadata, is_final, finalized_at, created_at, created_by";

const BUDGET_SNAPSHOT_ACTUAL_COLUMNS =
  "budget_code, cost_code, cost_type, description, original_budget, total_actual, normalized_actual, is_burden, normalized_out_contributions";

function mapBudgetSnapshotMetaFromRow(row: Record<string, unknown>): BudgetSnapshotMeta {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    snapshotNumber: Number(row.snapshot_number) || 0,
    label: (row.label as string) || "",
    sourceKind: (row.source_kind as string) || "csv",
    grandTotalActual: Number(row.grand_total_actual) || 0,
    grandNormalizedActual: Number(row.grand_normalized_actual) || 0,
    burdenTotalActual: Number(row.burden_total_actual) || 0,
    directTotalActual: Number(row.direct_total_actual) || 0,
    metadata: (row.metadata != null && typeof row.metadata === "object" && !Array.isArray(row.metadata))
      ? (row.metadata as Record<string, unknown>)
      : {},
    isFinal: row.is_final === true,
    finalizedAt: (row.finalized_at as string | null) ?? null,
    createdAt: (row.created_at as string) || new Date().toISOString(),
    createdBy: (row.created_by as string | null) ?? null,
  };
}

// The per-code row maps straight back to the engine's CodeActual (the stored shape
// IS the engine output — no drift). normalized_out_contributions is JSONB carrying
// the engine's camelCase CodeChangeContribution[] verbatim.
function mapBudgetSnapshotActualFromRow(row: Record<string, unknown>): CodeActual {
  return {
    budgetCode: (row.budget_code as string) || "",
    costCode: (row.cost_code as string) || "",
    costType: (row.cost_type as CodeActual["costType"]) || "Other",
    description: (row.description as string) || "",
    originalBudget: Number(row.original_budget) || 0,
    totalActual: Number(row.total_actual) || 0,
    normalizedActual: Number(row.normalized_actual) || 0,
    isBurden: row.is_burden === true,
    normalizedOutContributions: Array.isArray(row.normalized_out_contributions)
      ? (row.normalized_out_contributions as CodeActual["normalizedOutContributions"])
      : [],
  };
}

function mapBudgetSnapshotAllocationFromRow(row: Record<string, unknown>): BudgetSnapshotAllocation {
  return {
    id: row.id as string,
    snapshotId: row.snapshot_id as string,
    budgetCode: (row.budget_code as string) || "",
    estimateLineItemId: (row.estimate_line_item_id as string) || "",
    kind: (row.kind as string) || "allocation",
    allocatedTotal: Number(row.allocated_total) || 0,
    allocatedNormalized: Number(row.allocated_normalized) || 0,
    detail: (row.detail != null && typeof row.detail === "object" && !Array.isArray(row.detail))
      ? (row.detail as Record<string, unknown>)
      : {},
    note: (row.note as string) || "",
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: (row.created_at as string) || new Date().toISOString(),
    updatedAt: (row.updated_at as string) || new Date().toISOString(),
  };
}

// Rebuilds a type-safe ActualsDiagnostics from the stored JSONB (defaults every
// field so a legacy/empty '{}' never yields an undefined array).
function mapSnapshotDiagnosticsFromJson(v: unknown): ActualsDiagnostics {
  const o = (v != null && typeof v === "object" && !Array.isArray(v))
    ? (v as Record<string, unknown>)
    : {};
  return {
    unjoinedDetailEventIds: Array.isArray(o.unjoinedDetailEventIds) ? (o.unjoinedDetailEventIds as string[]) : [],
    summaryOnlyEventIds: Array.isArray(o.summaryOnlyEventIds) ? (o.summaryOnlyEventIds as string[]) : [],
    duplicateEventGroups: Array.isArray(o.duplicateEventGroups)
      ? (o.duplicateEventGroups as ActualsDiagnostics["duplicateEventGroups"]) : [],
    unattributedDetailLineCount: Number(o.unattributedDetailLineCount) || 0,
    internalNonZeroEventIds: Array.isArray(o.internalNonZeroEventIds) ? (o.internalNonZeroEventIds as string[]) : [],
    unclassifiedEvents: Array.isArray(o.unclassifiedEvents)
      ? (o.unclassifiedEvents as ActualsDiagnostics["unclassifiedEvents"]) : [],
  };
}

/**
 * Persists a parsed {@link NormalizedActuals} result as a new (un-promoted)
 * snapshot via the atomic save_budget_snapshot RPC — header + per-code actuals in
 * one transaction, with the per-project snapshot_number assigned server-side. The
 * payload is shaped by the pure buildBudgetSnapshotPayload (engine numbers copied
 * verbatim). A user-facing action: THROWS on failure.
 */
export async function saveBudgetSnapshot(input: {
  projectId: string;
  normalized: NormalizedActuals;
  label?: string;
  sourceKind?: string;
  metadata?: Record<string, unknown>;
}): Promise<BudgetSnapshotMeta> {
  const { snapshot, actuals } = buildBudgetSnapshotPayload(input.normalized, {
    projectId: input.projectId,
    label: input.label,
    sourceKind: input.sourceKind,
    metadata: input.metadata,
  });

  const { data, error } = await supabase.rpc("save_budget_snapshot", {
    p_snapshot: snapshot,
    p_actuals: actuals,
  });

  if (error || !data) {
    console.error(`Failed to save budget snapshot for project ${input.projectId}:`, error);
    throw new Error(`Failed to save budget snapshot: ${error?.message ?? "no row returned"}`);
  }

  return mapBudgetSnapshotMetaFromRow(data as Record<string, unknown>);
}

/**
 * Lightweight snapshot list for a project (no events/actuals/allocations — use
 * getBudgetSnapshotDetail for those), newest snapshot first.
 */
export async function getBudgetSnapshots(projectId: string): Promise<BudgetSnapshotMeta[]> {
  const { data, error } = await supabase
    .from("budget_snapshots")
    .select(BUDGET_SNAPSHOT_META_COLUMNS)
    .eq("project_id", projectId)
    .order("snapshot_number", { ascending: false });

  if (error) {
    console.error(`Failed to fetch budget snapshots for project ${projectId}`, error);
    throw new Error(`Failed to fetch budget snapshots: ${error.message}`);
  }

  return (data || []).map(mapBudgetSnapshotMetaFromRow);
}

/**
 * One snapshot's full detail: header + frozen change events + diagnostics + the
 * per-code+costType actuals + any manual allocations. Returns null when the
 * snapshot id does not exist (or is outside the caller's tenant RLS view).
 */
export async function getBudgetSnapshotDetail(
  snapshotId: string
): Promise<BudgetSnapshotDetail | null> {
  const { data: header, error: headerError } = await supabase
    .from("budget_snapshots")
    .select(`${BUDGET_SNAPSHOT_META_COLUMNS}, events, diagnostics`)
    .eq("id", snapshotId)
    .maybeSingle();

  if (headerError) {
    console.error(`Failed to fetch budget snapshot ${snapshotId}`, headerError);
    throw new Error(`Failed to fetch budget snapshot: ${headerError.message}`);
  }
  if (!header) return null;

  const [actuals, allocations] = await Promise.all([
    (async () => {
      const { data, error } = await supabase
        .from("budget_snapshot_actuals")
        .select(BUDGET_SNAPSHOT_ACTUAL_COLUMNS)
        .eq("snapshot_id", snapshotId);
      if (error) {
        console.error(`Failed to fetch actuals for snapshot ${snapshotId}`, error);
        throw new Error(`Failed to fetch snapshot actuals: ${error.message}`);
      }
      return (data || []).map(mapBudgetSnapshotActualFromRow);
    })(),
    getBudgetSnapshotAllocations(snapshotId),
  ]);

  return {
    ...mapBudgetSnapshotMetaFromRow(header),
    events: Array.isArray(header.events) ? (header.events as ClassifiedChangeEvent[]) : [],
    diagnostics: mapSnapshotDiagnosticsFromJson(header.diagnostics),
    actuals,
    allocations,
  };
}

/**
 * Marks one snapshot as the project's FINAL/closeout — the one doorway that makes
 * its normalized actuals eligible for the pricing pool (Phase 6). The
 * finalize_budget_snapshot RPC withdraws the prior FINAL (if any) and sets the
 * target in a single transaction, so the partial-unique invariant always holds.
 * THROWS on failure.
 */
export async function finalizeBudgetSnapshot(
  projectId: string,
  snapshotId: string
): Promise<void> {
  const { error } = await supabase.rpc("finalize_budget_snapshot", {
    p_project_id: projectId,
    p_snapshot_id: snapshotId,
  });

  if (error) {
    console.error(`Failed to finalize budget snapshot ${snapshotId} for project ${projectId}:`, error);
    throw new Error(`Failed to finalize budget snapshot: ${error.message}`);
  }
}

/**
 * Withdraws the project's FINAL snapshot with no replacement (e.g. the wrong
 * closeout was promoted): the project has no FINAL record until something else is
 * finalized. A single flag flip — the DB freeze-guard confines it to the promotion
 * pair. A no-op when nothing is FINAL. THROWS on failure.
 */
export async function withdrawFinalSnapshot(projectId: string): Promise<void> {
  const { error } = await supabase
    .from("budget_snapshots")
    .update({ is_final: false, finalized_at: null })
    .eq("project_id", projectId)
    .eq("is_final", true);

  if (error) {
    console.error(`Failed to withdraw final snapshot for project ${projectId}:`, error);
    throw new Error(`Failed to withdraw final snapshot: ${error.message}`);
  }
}

/**
 * Reads a snapshot's manual allocations (the Phase-4 overlay), oldest first.
 */
export async function getBudgetSnapshotAllocations(
  snapshotId: string
): Promise<BudgetSnapshotAllocation[]> {
  const { data, error } = await supabase
    .from("budget_snapshot_allocations")
    .select("*")
    .eq("snapshot_id", snapshotId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`Failed to fetch allocations for snapshot ${snapshotId}`, error);
    throw new Error(`Failed to fetch snapshot allocations: ${error.message}`);
  }

  return (data || []).map(mapBudgetSnapshotAllocationFromRow);
}

/**
 * Inserts a new manual allocation, or updates one in place when `id` is supplied
 * (Phase-4 reconciliation editing). On CREATE, created_by is stamped from the
 * session; on EDIT it is preserved (the updated_at touch trigger bumps the
 * timestamp). The DB freeze-on-final guard rejects either once the snapshot is
 * FINAL. THROWS on failure.
 */
export async function saveBudgetSnapshotAllocation(input: {
  id?: string;
  snapshotId: string;
  budgetCode?: string;
  estimateLineItemId?: string;
  kind?: string;
  allocatedTotal?: number;
  allocatedNormalized?: number;
  detail?: Record<string, unknown>;
  note?: string;
}): Promise<BudgetSnapshotAllocation> {
  const row: Record<string, unknown> = {
    snapshot_id: input.snapshotId,
    budget_code: input.budgetCode ?? "",
    estimate_line_item_id: input.estimateLineItemId ?? "",
    kind: input.kind ?? "allocation",
    allocated_total: input.allocatedTotal ?? 0,
    allocated_normalized: input.allocatedNormalized ?? 0,
    detail: input.detail ?? {},
    note: input.note ?? "",
  };

  let data: Record<string, unknown> | null;
  let error: { message: string } | null;

  if (input.id) {
    ({ data, error } = await supabase
      .from("budget_snapshot_allocations")
      .update(row)
      .eq("id", input.id)
      .select("*")
      .maybeSingle());
  } else {
    const { data: { session } } = await supabase.auth.getSession();
    ({ data, error } = await supabase
      .from("budget_snapshot_allocations")
      .insert({ ...row, created_by: session?.user?.id ?? null })
      .select("*")
      .maybeSingle());
  }

  if (error || !data) {
    console.error(`Failed to save allocation for snapshot ${input.snapshotId}:`, error);
    throw new Error(`Failed to save snapshot allocation: ${error?.message ?? "no row returned"}`);
  }

  return mapBudgetSnapshotAllocationFromRow(data);
}

/**
 * Deletes one manual allocation by id (Phase-4 editing — e.g. clearing a declined
 * rollup). The DB freeze-on-final guard rejects this once the snapshot is FINAL.
 * THROWS on failure.
 */
export async function deleteBudgetSnapshotAllocation(allocationId: string): Promise<void> {
  const { error } = await supabase
    .from("budget_snapshot_allocations")
    .delete()
    .eq("id", allocationId);

  if (error) {
    console.error(`Failed to delete snapshot allocation ${allocationId}:`, error);
    throw new Error(`Failed to delete snapshot allocation: ${error.message}`);
  }
}

/**
 * The actuals pricing pool reader (Actuals Cost-History Phase 6) — the FIRST
 * downstream consumer of FINAL budget snapshots. Returns per-(FINAL snapshot,
 * Procore code) actual-cost observations across ALL of the caller's projects,
 * tagged `actual` provenance and kept SEPARATE from the as-bid pool
 * (getBidPriceHistory). REPORT-only; the calc/normalization engine stays the
 * sole financial authority (this copies engine output, fabricates nothing).
 *
 * CRITICAL contract (plan Phase 6 + Phase-5 handoff Non-obvious #1): the
 * pricing-relevant per-code normalized actual is the EFFECTIVE one — the pure
 * buildActualCostObservations runs applyEventClassificationOverrides over each
 * snapshot's frozen actuals + events + its `event_classification` overlay rows,
 * so every Phase-5 human classification correction is honored. The frozen
 * `normalizedActual` is NEVER read directly.
 *
 * Reads only FINAL snapshots (is_final = true; at most one per project, RLS
 * tenant-scoped via the projects join — no read-perf index needed).
 */
export async function getActualCostHistory(): Promise<ActualCostObservation[]> {
  // 1. All FINAL snapshots with project context (mirrors getBidPriceHistory's
  //    projects(...) join). RLS confines this to the caller's tenant.
  const { data: finals, error } = await supabase
    .from("budget_snapshots")
    .select("id, project_id, label, finalized_at, projects(name, market_sector)")
    .eq("is_final", true);

  if (error) {
    console.error("Failed to fetch FINAL budget snapshots for the pricing pool:", error);
    throw new Error(`Failed to fetch FINAL budget snapshots: ${error.message}`);
  }

  const finalRows = finals || [];
  if (finalRows.length === 0) return [];

  // 2. Pull each FINAL snapshot's frozen actuals + events + overlay rows.
  const details = await Promise.all(
    finalRows.map((row) => getBudgetSnapshotDetail(row.id as string)),
  );

  // 3. Assemble the pure builder's input (skipping any snapshot that vanished
  //    between the list and the detail read), then derive the EFFECTIVE pool.
  const inputs: FinalSnapshotInput[] = [];
  for (let i = 0; i < finalRows.length; i += 1) {
    const detail = details[i];
    if (!detail) continue;
    const row = finalRows[i];
    const project = mapObservationProjectContext(row.projects);
    inputs.push({
      projectId: detail.projectId,
      projectName: project?.name ?? "",
      snapshotId: detail.id,
      snapshotLabel: detail.label,
      finalizedAt: (row.finalized_at as string | null) ?? detail.finalizedAt ?? "",
      marketSector: project?.market_sector ?? "",
      actuals: detail.actuals,
      events: detail.events,
      overlayRows: detail.allocations,
    });
  }

  return buildActualCostObservations(inputs);
}

// ═══════════════════════════════════════════════════════════════════
// Data Health (fidelity Phase 4 — READ-only audit fuel)
// ═══════════════════════════════════════════════════════════════════

/**
 * Minimal per-line facts across ALL projects for the Data Health engine
 * (unmapped-lines + lump-share findings). READ-only and deliberately thin —
 * five columns, no payloads — so the company-wide scan stays cheap. The
 * judging lives in the pure dataHealth.ts; nothing here filters beyond the
 * row→fact mapping.
 */
export async function getLineItemHealthFacts(): Promise<LineItemHealthFact[]> {
  const { data, error } = await supabase
    .from("estimate_line_items")
    .select("project_id, item_id, is_mapped, data_fidelity, total");

  if (error) {
    console.error("Failed to fetch line-item health facts:", error);
    throw new Error(`Failed to fetch line-item health facts: ${error.message}`);
  }

  return (data || []).map((row) => ({
    projectId: (row.project_id as string) || "",
    itemId: (row.item_id as string) || "",
    isMapped: row.is_mapped === true,
    dataFidelity: (row.data_fidelity as string) || "",
    total: Number(row.total) || 0,
  }));
}

/**
 * Every project's saved estimate grand total keyed by project id — the
 * duplicate-import detector's total-proximity signal (dataHealth.ts).
 * READ-only; a project with no saved estimate simply has no entry, and the
 * detector treats a missing total as "not comparable", never as $0.
 */
export async function getEstimateTotalsByProject(): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from("project_estimates")
    .select("project_id, total_cost");

  if (error) {
    console.error("Failed to fetch estimate totals:", error);
    throw new Error(`Failed to fetch estimate totals: ${error.message}`);
  }

  const out = new Map<string, number>();
  for (const row of data || []) {
    // A NULL total is OMITTED (not stored as 0): the Map's absence IS the
    // "never computed" signal, distinct from a genuine $0.00 estimate.
    if (row.total_cost == null) continue;
    out.set(row.project_id as string, Number(row.total_cost) || 0);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// Estimate Overrides (Phase 4 — append-only override audit trail)
// ═══════════════════════════════════════════════════════════════════

const ESTIMATE_OVERRIDE_COLUMNS =
  "id, project_id, field, computed_value, override_value, reason, created_by, created_at";

function mapOverrideFromRow(row: Record<string, unknown>): EstimateOverrideRecord {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    field: row.field as string,
    computedValue: row.computed_value != null ? Number(row.computed_value) : null,
    overrideValue: row.override_value != null ? Number(row.override_value) : null,
    reason: (row.reason as string) || "",
    createdBy: (row.created_by as string) || null,
    createdAt: (row.created_at as string) || new Date().toISOString(),
  };
}

/**
 * Appends one immutable override event to estimate_overrides (Phase 4).
 *
 * Unlike training-data writes (classification_history / estimate_snapshots, which are
 * fire-and-forget because their loss is non-critical), an override is the estimator's
 * FINANCIAL INTENT and MUST persist — so this THROWS on failure and the caller awaits it.
 * `overrideValue` null = a REVERT tombstone (the field falls back to computed); an
 * `overrideValue` of 0 is a real, honored override (INV-3). `created_by` is stamped from
 * the session ("who"); `created_at` defaults to now() ("when") server-side.
 *
 * Append-only by design: there is intentionally NO update/delete path here — a change of
 * mind appends a new event, matching the table's RLS (no UPDATE/DELETE policy).
 */
export async function recordEstimateOverride(
  projectId: string,
  field: string,
  computedValue: number | null,
  overrideValue: number | null,
  reason: string = ""
): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const createdBy = session?.user?.id ?? null;

  const { error } = await supabase.from("estimate_overrides").insert({
    project_id: projectId,
    field,
    computed_value: computedValue,
    override_value: overrideValue,
    reason,
    created_by: createdBy,
  });

  if (error) {
    console.error("Failed to record estimate override:", error);
    throw new Error(`Failed to record estimate override: ${error.message}`);
  }
}

/**
 * Reads the full append-only override audit trail for a project, newest first (the
 * Phase 5 audit log reads this directly). Feed the result through
 * reduceLatestActiveOverrides() (src/lib/overrides.ts) to get the active field→value map
 * the calc engine (computeTakeoffSummary) consumes.
 */
export async function getEstimateOverrides(
  projectId: string
): Promise<EstimateOverrideRecord[]> {
  const { data, error } = await supabase
    .from("estimate_overrides")
    .select(ESTIMATE_OVERRIDE_COLUMNS)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(`Failed to fetch overrides for project ${projectId}`, error);
    throw new Error(`Failed to fetch overrides: ${error.message}`);
  }

  return (data || []).map(mapOverrideFromRow);
}

// ═══════════════════════════════════════════════════════════════════
// Estimate Bindings (Linked Values System — Phase 3, mutable)
// ═══════════════════════════════════════════════════════════════════
//
// Persisted authored bindings (lookups + rollups). Unlike the append-only override
// trail, this table is MUTABLE (LD-3): a binding is upserted (one per
// project_id+target_node_id) or deleted. Bindings are written SEPARATELY from the
// atomic save_estimate line-item RPC, so they survive the line-item DELETE+INSERT.
//
// Stored binding VALUES are never trusted: the row carries only the rule (basis +
// kind-specific definition), and the value is recomputed FROM SOURCE on load
// (recomputeBindingValues, src/lib/bindings/recompute.ts). target_node_id and kind are
// denormalized projections of the JSONB payload, derived here on every write so they
// cannot drift; the DB itself stays blind to binding kind (kind is free TEXT).

const ESTIMATE_BINDING_COLUMNS =
  "id, project_id, target_node_id, kind, definition, created_by, created_at, updated_at";

function mapBindingFromRow(row: Record<string, unknown>): EstimateBindingRecord {
  const payload = (row.definition ?? {}) as Partial<StoredBindingDefinition>;
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    binding: {
      targetNodeId: row.target_node_id as string,
      // basis lives in the JSONB payload; default to the dominant case if absent.
      basis: (payload.basis as Basis) ?? "currency",
      definition: payload.rule as BindingDefinition,
    },
    createdBy: (row.created_by as string) || null,
    createdAt: (row.created_at as string) || new Date().toISOString(),
    updatedAt: (row.updated_at as string) || new Date().toISOString(),
  };
}

/**
 * Reads a project's persisted bindings, ordered by target_node_id for a stable result.
 * Feed `records.map(r => r.binding)` to recomputeBindingValues() — stored values are
 * never trusted, always recomputed from source on load.
 */
export async function getEstimateBindings(
  projectId: string
): Promise<EstimateBindingRecord[]> {
  const { data, error } = await supabase
    .from("estimate_bindings")
    .select(ESTIMATE_BINDING_COLUMNS)
    .eq("project_id", projectId)
    .order("target_node_id", { ascending: true });

  if (error) {
    console.error(`Failed to fetch bindings for project ${projectId}`, error);
    throw new Error(`Failed to fetch estimate bindings: ${error.message}`);
  }

  return (data || []).map(mapBindingFromRow);
}

/**
 * Saves ONE binding (mutable; one per project_id+target_node_id). The JSONB payload is
 * { basis, rule }; target_node_id and kind are derived from the same Binding so they
 * cannot drift. THROWS on failure (authored intent must persist — unlike fire-and-forget
 * training data).
 *
 * `created_by` semantics (Phase 5 decision, no DDL): on EDIT the original creator is
 * preserved — this UPDATEs only kind+definition and never touches created_by, so the
 * column stays "who first authored this link" rather than drifting to "last writer" on
 * every re-save. On CREATE (no existing row) it INSERTs and stamps created_by from the
 * session. The estimate_bindings touch trigger bumps updated_at on the UPDATE; insert
 * defaults it to now(). (The tenant FOR ALL RLS policy covers the UPDATE's SELECT.)
 */
export async function saveEstimateBinding(
  projectId: string,
  binding: Binding
): Promise<void> {
  const payload: StoredBindingDefinition = { basis: binding.basis, rule: binding.definition };

  // EDIT path: update an existing binding in place, preserving its created_by. `select`
  // tells us whether a row matched (RLS FOR ALL grants the SELECT the UPDATE needs).
  const { data: updated, error: updateError } = await supabase
    .from("estimate_bindings")
    .update({ kind: binding.definition.kind, definition: payload })
    .eq("project_id", projectId)
    .eq("target_node_id", binding.targetNodeId)
    .select("id");

  if (updateError) {
    console.error("Failed to save estimate binding:", updateError);
    throw new Error(`Failed to save estimate binding: ${updateError.message}`);
  }
  if (updated && updated.length > 0) return; // edited an existing binding

  // CREATE path: no existing row → insert and stamp the creator from the session.
  const { data: { session } } = await supabase.auth.getSession();
  const createdBy = session?.user?.id ?? null;
  const { error: insertError } = await supabase.from("estimate_bindings").insert({
    project_id: projectId,
    target_node_id: binding.targetNodeId,
    kind: binding.definition.kind,
    definition: payload,
    created_by: createdBy,
  });

  if (insertError) {
    console.error("Failed to save estimate binding:", insertError);
    throw new Error(`Failed to save estimate binding: ${insertError.message}`);
  }
}

/**
 * Deletes ONE binding by its (project_id, target_node_id) identity. Idempotent: removing
 * a binding that does not exist is not an error. THROWS on a real failure.
 */
export async function deleteEstimateBinding(
  projectId: string,
  targetNodeId: string
): Promise<void> {
  const { error } = await supabase
    .from("estimate_bindings")
    .delete()
    .eq("project_id", projectId)
    .eq("target_node_id", targetNodeId);

  if (error) {
    console.error("Failed to delete estimate binding:", error);
    throw new Error(`Failed to delete estimate binding: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Auth Session & Profile Gateway Wrappers
// ═══════════════════════════════════════════════════════════════════

let cachedTenantId: string | null = null;

export function clearDbCache() {
  cachedTenantId = null;
}

export async function getCurrentTenantId(): Promise<string> {
  if (cachedTenantId) return cachedTenantId;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) {
    throw new Error("No authenticated session found.");
  }

  const { data, error } = await supabase
    .from("users")
    .select("tenant_id")
    .eq("id", session.user.id)
    .maybeSingle();

  if (error || !data) {
    throw new Error(`Failed to retrieve user tenant: ${error?.message || 'User profile not found'}`);
  }

  cachedTenantId = data.tenant_id as string;
  return cachedTenantId;
}

export async function getUserProfile(userId: string): Promise<{ id: string; email: string; tenantId: string } | null> {
  const { data, error } = await supabase
    .from("users")
    .select("id, email, tenant_id")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("Failed to fetch user profile:", error);
    return null;
  }

  if (!data) return null;

  return {
    id: data.id as string,
    email: data.email as string,
    tenantId: data.tenant_id as string,
  };
}

export function subscribeToAuthChanges(
  callback: (event: string, session: Session | null) => void
) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      clearDbCache();
    }
    callback(event, session);
  });
  return subscription;
}

export async function signIn(email: string, password: string) {
  clearDbCache();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

export async function signUp(email: string, password: string, companyName?: string) {
  clearDbCache();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        company_name: companyName || "Corporate Workspace",
      },
    },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  clearDbCache();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  return session;
}

// ═══════════════════════════════════════════════════════════════════
// Template Configurations
// ═══════════════════════════════════════════════════════════════════

/**
 * Validates the raw config_data JSONB into a TemplateLayoutConfig.
 * Phase 3b: config_data is the single source of truth for the exporter's row
 * geometry — there is no hardcoded fallback, so an out-of-shape row must fail
 * loudly here rather than silently exporting with stale coordinates.
 */
function parseTemplateLayoutConfig(templateName: string, raw: unknown): TemplateLayoutConfig {
  if (Array.isArray(raw)) {
    throw new Error(
      `template_config.config_data for "${templateName}" is in the legacy bare-array shape — ` +
      `apply the Phase 3b config migration in supabase_schema.sql ({divisions, anchors, sheetNames}).`
    );
  }
  const config = raw as Partial<TemplateLayoutConfig> | null;
  const anchors = config?.anchors;
  const sheetNames = config?.sheetNames;
  const valid =
    Array.isArray(config?.divisions) &&
    config.divisions.length > 0 &&
    typeof anchors?.subtotalRow === "number" &&
    typeof anchors.modifierStartOffset === "number" &&
    typeof anchors.modifierEndOffset === "number" &&
    typeof anchors.grandTotalOffset === "number" &&
    typeof anchors.reconStartRow === "number" &&
    anchors.modifierStartOffset <= anchors.modifierEndOffset &&
    anchors.modifierEndOffset < anchors.grandTotalOffset &&
    anchors.reconStartRow > anchors.subtotalRow &&
    typeof sheetNames?.budgetLineItems === "string" &&
    typeof sheetNames.importerDataFields === "string";
  if (!valid) {
    throw new Error(
      `template_config.config_data for "${templateName}" is invalid — expected ` +
      `{divisions[], anchors{subtotalRow, modifierStartOffset, modifierEndOffset, grandTotalOffset, reconStartRow}, ` +
      `sheetNames{budgetLineItems, importerDataFields}} per supabase_schema.sql.`
    );
  }
  return config as TemplateLayoutConfig;
}

/**
 * Retrieves the coordinate layout configuration for a specific spreadsheet template.
 * Throws if the stored config_data fails Phase 3b shape validation.
 */
export async function getTemplateConfig(
  templateName: string
): Promise<TemplateConfig | null> {
  const { data, error } = await supabase
    .from("template_config")
    .select("*")
    .eq("template_name", templateName)
    .maybeSingle();

  if (error) {
    console.error(`Failed to fetch template config for "${templateName}"`, error);
    throw new Error(`Failed to fetch template config: ${error.message}`);
  }

  if (!data) return null;

  return {
    id: data.id as string,
    templateName: data.template_name as string,
    sheetName: data.sheet_name as string,
    configType: data.config_type as string,
    configData: parseTemplateLayoutConfig(templateName, data.config_data),
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
    projectType: (data.project_type as string) ?? null,
  };
}

/**
 * Downloads a template .xlsx from the private Storage bucket (Phase 3b —
 * replaces the unauthenticated /public/templates/ fetch). Single-gateway
 * rule applies to Storage too: this is the app's ONLY Storage access point.
 */
export async function downloadTemplateFile(templateName: string): Promise<ArrayBuffer> {
  const { data, error } = await supabase.storage
    .from(TEMPLATE_STORAGE_BUCKET)
    .download(templateName);

  if (error || !data) {
    console.error(`Failed to download template "${templateName}" from Storage`, error);
    throw new Error(
      `Failed to download template "${templateName}" from the "${TEMPLATE_STORAGE_BUCKET}" bucket: ` +
      `${error?.message ?? "empty response"}. Has it been uploaded (npm run upload-template)?`
    );
  }
  return data.arrayBuffer();
}

/**
 * Retrieves the app-owned internal → granular Procore code mapping for a
 * template (cost_code_map table, seeded from the catalog in Phase 3a).
 * Primes the resolveProcoreCode chokepoint at workspace mount and feeds the
 * /cost-codes mapping editor (Phase 3c).
 */
const COST_CODE_MAP_COLUMNS = "template_name, internal_code, procore_code, source";

function mapCostCodeMapRow(row: Record<string, unknown>): CostCodeMapEntry {
  return {
    templateName: row.template_name as string,
    internalCode: row.internal_code as string,
    procoreCode: row.procore_code as string,
    source: row.source as CostCodeMapEntry["source"],
  };
}

export async function getCostCodeMap(
  templateName: string
): Promise<CostCodeMapEntry[]> {
  const { data, error } = await supabase
    .from("cost_code_map")
    .select(COST_CODE_MAP_COLUMNS)
    .eq("template_name", templateName)
    .order("internal_code", { ascending: true });

  if (error) {
    console.error(`Failed to fetch cost code map for "${templateName}"`, error);
    throw new Error(`Failed to fetch cost code map: ${error.message}`);
  }

  return (data || []).map(mapCostCodeMapRow);
}

/**
 * Updates one cost_code_map mapping to a new granular Procore code
 * (Phase 3c mapping editor — the SOLE update path for existing mappings;
 * the seed script is insert-only). Always stamps source='manual'.
 * Update-only by design: adding new internal codes stays with the
 * harvest/seed pipeline. Caller validates the code against the Importer
 * valid-code list BEFORE calling (AGENTS.md — no unvalidated mappings).
 */
export async function updateCostCodeMapping(
  templateName: string,
  internalCode: string,
  procoreCode: string
): Promise<CostCodeMapEntry> {
  const { data, error } = await supabase
    .from("cost_code_map")
    .update({
      procore_code: procoreCode,
      source: "manual",
      updated_at: new Date().toISOString(),
    })
    .eq("template_name", templateName)
    .eq("internal_code", internalCode)
    .select(COST_CODE_MAP_COLUMNS)
    .single();

  if (error || !data) {
    console.error(`Failed to update cost code mapping ${internalCode} -> ${procoreCode}`, error);
    throw new Error(`Failed to update cost code mapping: ${error?.message ?? "no row updated"}`);
  }

  return mapCostCodeMapRow(data);
}

/**
 * Retrieves the company rate card for a template (rate_card table, Rate-card
 * slice 1, seeded from constants.ts in Phase A). Primes the resolveCompanyRate
 * chokepoint at workspace mount (Phase B) and feeds the /rates editor (Phase C).
 */
const RATE_CARD_COLUMNS = "template_name, line_code, rate, source";

function mapRateCardRow(row: Record<string, unknown>): RateCardEntry {
  return {
    templateName: row.template_name as string,
    lineCode: row.line_code as string,
    rate: Number(row.rate),
    source: row.source as RateCardEntry["source"],
  };
}

export async function getRateCard(
  templateName: string
): Promise<RateCardEntry[]> {
  const { data, error } = await supabase
    .from("rate_card")
    .select(RATE_CARD_COLUMNS)
    .eq("template_name", templateName)
    .order("line_code", { ascending: true });

  if (error) {
    console.error(`Failed to fetch rate card for "${templateName}"`, error);
    throw new Error(`Failed to fetch rate card: ${error.message}`);
  }

  return (data || []).map(mapRateCardRow);
}

/**
 * Updates one rate_card line to a new rate (Phase C /rates editor — the SOLE
 * update path for existing rates; the seed script is insert-only). Always
 * stamps source='manual'. Update-only by design: adding new rate lines stays
 * with the constants/seed pipeline.
 *
 * Validation is per-rate-kind (AGENTS.md — never write an invented/invalid
 * financial value). By default the gate is a finite number >= 0, matching the
 * GC/Site Ops rates (Slice 1) — existing callers are unchanged. Pass
 * `allowNegative: true` for catalog unit prices (Slice 2), which can be a
 * legitimate negative deduction (e.g. 03-5413.002 = -2); that relaxes the gate
 * to finite-only. A non-finite value (NaN/Infinity) is ALWAYS rejected.
 */
export async function updateRateCardEntry(
  templateName: string,
  lineCode: string,
  rate: number,
  opts?: { allowNegative?: boolean }
): Promise<RateCardEntry> {
  const allowNegative = opts?.allowNegative ?? false;
  if (
    typeof rate !== "number" ||
    !Number.isFinite(rate) ||
    (!allowNegative && rate < 0)
  ) {
    throw new Error(
      `Invalid rate ${rate} for ${lineCode}: must be a finite number${
        allowNegative ? "" : " >= 0"
      }`
    );
  }

  const { data, error } = await supabase
    .from("rate_card")
    .update({
      rate,
      source: "manual",
      updated_at: new Date().toISOString(),
    })
    .eq("template_name", templateName)
    .eq("line_code", lineCode)
    .select(RATE_CARD_COLUMNS)
    .single();

  if (error || !data) {
    console.error(`Failed to update rate card entry ${lineCode} -> ${rate}`, error);
    throw new Error(`Failed to update rate card entry: ${error?.message ?? "no row updated"}`);
  }

  return mapRateCardRow(data);
}

// ═══════════════════════════════════════════════════════════════════
// Custom GC/Site-Ops line definitions (import STEP 2/3 review gate, Phase 2)
// ═══════════════════════════════════════════════════════════════════

const CUSTOM_STEP23_LINE_DEF_COLUMNS = "code, label, unit, procore_code, source, status, merged_into";

function mapCustomStep23LineDefRow(row: Record<string, unknown>): CustomStep23LineDef {
  return {
    code: row.code as string,
    label: row.label as string,
    unit: (row.unit as string) || "",
    procoreCode: (row.procore_code as string | null) ?? null,
    source: row.source as CustomStep23LineDef["source"],
    // Lifecycle (Catalog Manager Phase 2). The column is NOT NULL DEFAULT 'active',
    // so a row always carries one; the ?? keeps the mapper safe if a caller ever
    // selects a narrower projection. mergedInto is null unless status === 'merged'.
    status: (row.status as CatalogLifecycleStatus) ?? "active",
    mergedInto: (row.merged_into as string | null) ?? null,
  };
}

/**
 * Every user-minted GC/Site-Ops line def (custom_step23_line_defs table), the
 * overlay the step23Normalization resolver layers on the built-in defs.
 * Consumers (ImportedStep23Panel, /rates, the import review gate) load these
 * FAIL-SOFT: an outage degrades to built-ins only, never blocks a workflow.
 */
export async function getCustomStep23LineDefs(): Promise<CustomStep23LineDef[]> {
  const { data, error } = await supabase
    .from("custom_step23_line_defs")
    .select(CUSTOM_STEP23_LINE_DEF_COLUMNS)
    .order("code", { ascending: true });

  if (error) {
    console.error("Failed to fetch custom GC/Site-Ops line defs:", error);
    throw new Error(`Failed to fetch custom GC/Site-Ops line defs: ${error.message}`);
  }

  return (data || []).map(mapCustomStep23LineDefRow);
}

/**
 * Mints one custom GC/Site-Ops line def (the import review gate's "create new
 * code" path — the SOLE write path this phase; editing/retiring is Catalog
 * Manager scope). Validates before the write, mirroring the table's CHECK
 * constraints so no invalid def ever leaves the browser:
 *  - code must be deterministic (NN-NNNN.NNN);
 *  - code may never shadow a BUILT-IN def (collision rule, locked 2026-06-10);
 *  - code may not duplicate an existing custom row (pre-checked for a clean
 *    message; the PK is the authoritative gate — a same-moment race surfaces
 *    as the same "already exists" error via 23505);
 *  - label must be non-empty (it is the auto-resolution key).
 * unit/procoreCode are normalized to the payload contracts (trim+uppercase
 * UOM; blank Procore code stored as NULL). Stamps source='import_gate' via the
 * column default. NOT a financial write: a def is a label, resolver target,
 * and mining key — it carries no rate and moves no dollar.
 */
export async function createCustomStep23LineDef(input: {
  code: string;
  label: string;
  unit?: string;
  procoreCode?: string | null;
}): Promise<CustomStep23LineDef> {
  const code = input.code.trim();
  const label = input.label.trim();
  const unit = (input.unit ?? "").trim().toUpperCase();
  const procoreCode = (input.procoreCode ?? "").trim() || null;

  if (!isStep23DeterministicCode(code)) {
    throw new Error(
      `Invalid custom GC/Site-Ops code "${input.code}": must be deterministic NN-NNNN.NNN (e.g. 02-4100.003)`
    );
  }
  if (label === "") {
    throw new Error(`Custom code ${code} needs a non-empty name — the name is what auto-resolves matching lines`);
  }
  if (isBuiltInStep23Code(code)) {
    throw new Error(`Code ${code} is already a built-in GC/Site-Ops line — pick the next free suffix instead`);
  }

  const { data: existing, error: existsError } = await supabase
    .from("custom_step23_line_defs")
    .select("code")
    .eq("code", code)
    .maybeSingle();

  if (existsError) {
    console.error(`Failed to check custom code ${code} for collisions:`, existsError);
    throw new Error(`Failed to check custom code ${code} for collisions: ${existsError.message}`);
  }
  if (existing) {
    throw new Error(`Custom code ${code} already exists`);
  }

  const { data, error } = await supabase
    .from("custom_step23_line_defs")
    .insert({ code, label, unit, procore_code: procoreCode })
    .select(CUSTOM_STEP23_LINE_DEF_COLUMNS)
    .single();

  if (error || !data) {
    // 23505 = unique_violation: a concurrent mint won the PK race after our
    // pre-check — same outcome as the pre-check, same clean message.
    if (error?.code === "23505") {
      throw new Error(`Custom code ${code} already exists`);
    }
    console.error(`Failed to create custom GC/Site-Ops code ${code}:`, error);
    throw new Error(`Failed to create custom GC/Site-Ops code ${code}: ${error?.message ?? "no row returned"}`);
  }

  return mapCustomStep23LineDefRow(data);
}

/**
 * Fetches one custom def by code (lifecycle-aware), or null when absent. Shared
 * by the lifecycle writers below so each can validate the CURRENT state (e.g.
 * active-only) and emit the same clean message the DB trigger would.
 */
async function fetchCustomStep23LineDef(code: string): Promise<CustomStep23LineDef | null> {
  const { data, error } = await supabase
    .from("custom_step23_line_defs")
    .select(CUSTOM_STEP23_LINE_DEF_COLUMNS)
    .eq("code", code)
    .maybeSingle();

  if (error) {
    console.error(`Failed to load custom GC/Site-Ops code ${code}:`, error);
    throw new Error(`Failed to load custom GC/Site-Ops code ${code}: ${error.message}`);
  }
  return data ? mapCustomStep23LineDefRow(data) : null;
}

/**
 * Edits an ACTIVE custom def's name, unit, and/or Procore BLI (the Catalog
 * Manager scope-2 BLI backfill write). Only the supplied fields change. Mirrors
 * the lifecycle guard trigger client-side for clean errors: the code (PK) is
 * never touched; only active codes may be edited (a retired/merged tombstone is
 * frozen). A non-empty procoreCode MUST be on Procore's Importer list
 * (PROCORE_VALID_CODES); '' / null clears the backfill. NOT a financial write —
 * a def is a label, resolver target, and mining key only. The DB triggers
 * (guard + updated_at touch) are the backstop behind this validation.
 */
export async function updateCustomStep23LineDef(input: {
  code: string;
  label?: string;
  unit?: string;
  procoreCode?: string | null;
}): Promise<CustomStep23LineDef> {
  const code = input.code.trim();

  const def = await fetchCustomStep23LineDef(code);
  if (!def) throw new Error(`Custom code ${code} not found`);
  if (!isActive(def)) {
    throw new Error(`Code ${code} is ${def.status ?? "active"}; only active codes can be edited.`);
  }

  const patch: { label?: string; unit?: string; procore_code?: string | null } = {};

  if (input.label !== undefined) {
    const label = input.label.trim();
    if (label === "") {
      throw new Error(`Custom code ${code} needs a non-empty name — the name is what auto-resolves matching lines`);
    }
    patch.label = label;
  }

  if (input.unit !== undefined) {
    patch.unit = input.unit.trim().toUpperCase();
  }

  if (input.procoreCode !== undefined) {
    const procoreCode = (input.procoreCode ?? "").trim();
    if (procoreCode !== "" && !isValidProcoreCode(procoreCode)) {
      throw new Error(`Procore code ${procoreCode} is not on the Importer Data Fields list — pick a valid Budget Line Item`);
    }
    patch.procore_code = procoreCode || null;
  }

  if (Object.keys(patch).length === 0) {
    throw new Error(`Nothing to update on custom code ${code} — provide a name, unit, or Procore code`);
  }

  const { data, error } = await supabase
    .from("custom_step23_line_defs")
    .update(patch)
    .eq("code", code)
    .select(CUSTOM_STEP23_LINE_DEF_COLUMNS)
    .single();

  if (error || !data) {
    console.error(`Failed to update custom GC/Site-Ops code ${code}:`, error);
    throw new Error(`Failed to update custom GC/Site-Ops code ${code}: ${error?.message ?? "no row returned"}`);
  }
  return mapCustomStep23LineDefRow(data);
}

/**
 * Retires an ACTIVE custom def (active → retired). A retired code leaves every
 * picker (activeStep23Defs drops it) but keeps labeling its old lines through
 * the resolver — history intact, suffix never reused. A tombstone, not a delete:
 * the row stays. Mirrors `transitionError` for the clean message the trigger
 * would also raise; the trigger is the backstop.
 */
export async function retireCustomStep23LineDef(code: string): Promise<CustomStep23LineDef> {
  const trimmed = code.trim();
  const def = await fetchCustomStep23LineDef(trimmed);
  if (!def) throw new Error(`Custom code ${trimmed} not found`);

  const err = transitionError(def, "retired", null, () => false);
  if (err) throw new Error(err);

  const { data, error } = await supabase
    .from("custom_step23_line_defs")
    .update({ status: "retired", merged_into: null })
    .eq("code", trimmed)
    .select(CUSTOM_STEP23_LINE_DEF_COLUMNS)
    .single();

  if (error || !data) {
    console.error(`Failed to retire custom GC/Site-Ops code ${trimmed}:`, error);
    throw new Error(`Failed to retire custom GC/Site-Ops code ${trimmed}: ${error?.message ?? "no row returned"}`);
  }
  return mapCustomStep23LineDefRow(data);
}

/**
 * Merges an ACTIVE custom def into a WINNER (active → merged). Every stored bid
 * that referenced the losing code now renders the winner at render time — no
 * imported payload is rewritten (redirects + tombstones, architect-locked
 * 2026-06-11). The winner may be any ACTIVE def — a built-in or another active
 * custom — validated via Phase 1's `transitionError` with an `isActiveWinner`
 * predicate composed here from the built-in set + the live custom rows. After
 * the merge, the `redirectsToRepoint` chain-collapse sweep re-points every def
 * already merged into the loser onto the winner, so redirects stay exactly one
 * hop (the resolver also carries a hop guard). Mirrors the DB trigger; the
 * trigger is the backstop. NOT a financial write.
 */
export async function mergeCustomStep23LineDef(code: string, winner: string): Promise<CustomStep23LineDef> {
  const losing = code.trim();
  const win = winner.trim();

  const all = await getCustomStep23LineDefs();
  const def = all.find((d) => d.code === losing);
  if (!def) throw new Error(`Custom code ${losing} not found`);

  const isActiveWinner = (c: string): boolean =>
    isBuiltInStep23Code(c) || all.some((d) => d.code === c && isActive(d));

  const err = transitionError(def, "merged", win, isActiveWinner);
  if (err) throw new Error(err);

  // 1. Tombstone the loser → winner.
  const { data, error } = await supabase
    .from("custom_step23_line_defs")
    .update({ status: "merged", merged_into: win })
    .eq("code", losing)
    .select(CUSTOM_STEP23_LINE_DEF_COLUMNS)
    .single();

  if (error || !data) {
    console.error(`Failed to merge custom GC/Site-Ops code ${losing} into ${win}:`, error);
    throw new Error(`Failed to merge custom GC/Site-Ops code ${losing} into ${win}: ${error?.message ?? "no row returned"}`);
  }

  // 2. Chain-collapse: re-point anything previously merged into the loser onto
  //    the winner so redirects are always one hop. Computed from the pre-merge
  //    snapshot; a no-op when the loser had no followers.
  const followers = redirectsToRepoint(all, losing);
  if (followers.length > 0) {
    const { error: repointError } = await supabase
      .from("custom_step23_line_defs")
      .update({ merged_into: win })
      .in("code", followers);

    if (repointError) {
      console.error(`Failed to re-point redirects from ${losing} to ${win}:`, repointError);
      throw new Error(
        `Merged ${losing} into ${win}, but failed to re-point its existing redirects (${followers.join(", ")}): ${repointError.message}`
      );
    }
  }

  return mapCustomStep23LineDefRow(data);
}

/**
 * Promotes an ACTIVE custom GC/Site-Ops code (Catalog Manager Phase 4 — thin
 * promotion). Creates the code's ONE opt-in rate_card row so /rates shows it with
 * its label/unit and the existing audited ADOPT path works over its mined STEP
 * 2/3 history — and NOTHING more (no calculator visibility; architect-locked
 * 2026-06-11). One-way: there is no un-promote (rate_card carries no DELETE
 * policy). The row is stamped source='manual' (an estimator action, not the
 * constants seed) with the supplied default rate — validated finite >= 0, default
 * 0 so the estimator then ADOPTs a real median (or types a rate) on /rates.
 *
 * Created EXACTLY ONCE: a pre-check rejects a code that already has a rate_card
 * row with a clean "already promoted" message; the PK (template_name, line_code)
 * is the authoritative gate, so a same-moment race surfaces as the same message
 * via 23505. Only ACTIVE codes may be promoted (a retired/merged tombstone is
 * frozen). NOT a calculator write — the rate is a recorded company default
 * awaiting future calculator integration; it moves no estimate dollar today.
 */
export async function promoteCustomStep23LineDef(
  templateName: string,
  code: string,
  rate: number = 0
): Promise<RateCardEntry> {
  const trimmed = code.trim();

  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0) {
    throw new Error(`Invalid promotion rate ${rate} for ${trimmed}: must be a finite number >= 0`);
  }

  const def = await fetchCustomStep23LineDef(trimmed);
  if (!def) throw new Error(`Custom code ${trimmed} not found`);
  if (!isActive(def)) {
    throw new Error(`Code ${trimmed} is ${def.status ?? "active"}; only active codes can be promoted.`);
  }

  // Exactly once: an existing rate_card row for this code === already promoted.
  const { data: existing, error: existsError } = await supabase
    .from("rate_card")
    .select("line_code")
    .eq("template_name", templateName)
    .eq("line_code", trimmed)
    .maybeSingle();

  if (existsError) {
    console.error(`Failed to check promotion state for ${trimmed}:`, existsError);
    throw new Error(`Failed to check promotion state for ${trimmed}: ${existsError.message}`);
  }
  if (existing) {
    throw new Error(`Code ${trimmed} is already promoted (it already has a company rate-card row)`);
  }

  const { data, error } = await supabase
    .from("rate_card")
    .insert({ template_name: templateName, line_code: trimmed, rate, source: "manual" })
    .select(RATE_CARD_COLUMNS)
    .single();

  if (error || !data) {
    // 23505 = unique_violation: a concurrent promote won the PK race after our
    // pre-check — same outcome, same clean message.
    if (error?.code === "23505") {
      throw new Error(`Code ${trimmed} is already promoted (it already has a company rate-card row)`);
    }
    console.error(`Failed to promote custom GC/Site-Ops code ${trimmed}:`, error);
    throw new Error(`Failed to promote custom GC/Site-Ops code ${trimmed}: ${error?.message ?? "no row returned"}`);
  }

  return mapRateCardRow(data);
}

// ═══════════════════════════════════════════════════════════════════
// Catalog additions (Catalog Manager Phase 6 — STEP 4 runtime overlay)
// ═══════════════════════════════════════════════════════════════════
//
// In-app STEP 4 catalog codes (catalog_additions table). Self-contained: a row
// carries its OWN procore_code + default_unit_price, so the catalog chokepoint
// (catalog.ts) and BOTH resolvers overlay it with NO cost_code_map / rate_card
// widening. The price reaches a row only at birth (freeze-at-birth) — editing an
// addition never retro-moves a saved row's stored unit_price.

const CATALOG_ADDITION_COLUMNS =
  "item_id, description, target_uom, default_unit_price, cost_type, procore_code, status, source";

const CATALOG_ADDITION_COST_TYPES = ["L", "M", "S", "E"];

function mapCatalogAdditionRow(row: Record<string, unknown>): CatalogAddition {
  return {
    itemId: row.item_id as string,
    description: row.description as string,
    targetUom: (row.target_uom as string) || "",
    defaultUnitPrice: Number(row.default_unit_price),
    costType: row.cost_type as string,
    procoreCode: row.procore_code as string,
    // status is NOT NULL DEFAULT 'active'; the ?? is a safety net for narrower
    // projections. source is likewise always present.
    status: (row.status as CatalogAdditionStatus) ?? "active",
    source: row.source as CatalogAddition["source"],
  };
}

/**
 * Every in-app catalog addition (catalog_additions table), ordered by itemId —
 * the overlay the catalog chokepoint + both resolvers layer on the built-ins.
 * Consumers load these FAIL-SOFT (`.catch(() => [])` at the prime site): an
 * outage degrades to built-ins only, never blocks a workflow.
 */
export async function getCatalogAdditions(): Promise<CatalogAddition[]> {
  const { data, error } = await supabase
    .from("catalog_additions")
    .select(CATALOG_ADDITION_COLUMNS)
    .order("item_id", { ascending: true });

  if (error) {
    console.error("Failed to fetch catalog additions:", error);
    throw new Error(`Failed to fetch catalog additions: ${error.message}`);
  }

  return (data || []).map(mapCatalogAdditionRow);
}

/**
 * Validates a Procore-destination code against the Importer list and returns it
 * trimmed (shared by create + update). A non-empty value MUST be on Procore's
 * Importer Data Fields list (AGENTS.md — no unvalidated mappings); '' is rejected
 * (an addition must name a valid destination at birth — the column is NOT NULL).
 */
function normalizeAdditionProcoreCode(input: string): string {
  const procoreCode = input.trim();
  if (procoreCode === "") {
    throw new Error("A catalog addition needs a Procore Budget Line Item (it names where the code's dollars land)");
  }
  if (!isValidProcoreCode(procoreCode)) {
    throw new Error(`Procore code ${procoreCode} is not on the Importer Data Fields list — pick a valid Budget Line Item`);
  }
  return procoreCode;
}

/** Shape/range checks shared by create + update for default_unit_price (a finite
 *  number; a negative deduction is legitimate, e.g. an allowance credit). */
function validateAdditionPrice(price: number): void {
  if (typeof price !== "number" || !Number.isFinite(price)) {
    throw new Error(`Invalid catalog unit price ${price}: must be a finite number`);
  }
}

/** L/M/S/E guard shared by create + update (returns the uppercased value). */
function normalizeAdditionCostType(input: string): string {
  const costType = input.trim().toUpperCase();
  if (!CATALOG_ADDITION_COST_TYPES.includes(costType)) {
    throw new Error(`Invalid cost type "${input}": must be L (Labor), M (Materials), S (Subcontract), or E (Equipment)`);
  }
  return costType;
}

/**
 * Creates one in-app STEP 4 catalog code (the /catalog Add-code UI's sole write
 * path — Phase 7). Validates before the write, mirroring the table's CHECK
 * constraints so no invalid addition ever leaves the browser:
 *  - itemId must be a deterministic catalog code (NN-NNNN.NNN);
 *  - description must be non-empty (the import-match / display label);
 *  - cost type must be L/M/S; default unit price must be finite (negatives ok);
 *  - procore_code must be on Procore's Importer list (a valid destination);
 *  - itemId may NEVER shadow a BUILT-IN catalog code (a built-in always wins the
 *    overlay — collision is rejected with a clean message);
 *  - itemId may not duplicate an existing addition (pre-checked for a clean
 *    message; the PK is the authoritative gate — a same-moment race surfaces as
 *    the same "already exists" error via 23505).
 * Stamps source='catalog_manager' + status='active' via the column defaults.
 */
export async function createCatalogAddition(input: {
  itemId: string;
  description: string;
  targetUom?: string;
  defaultUnitPrice?: number;
  costType?: string;
  procoreCode: string;
}): Promise<CatalogAddition> {
  const itemId = input.itemId.trim();
  const description = input.description.trim();
  const targetUom = (input.targetUom ?? "").trim().toUpperCase();
  const defaultUnitPrice = input.defaultUnitPrice ?? 0;

  if (!isStep23DeterministicCode(itemId)) {
    throw new Error(
      `Invalid catalog code "${input.itemId}": must be deterministic NN-NNNN.NNN (e.g. 11-5000.010)`
    );
  }
  if (description === "") {
    throw new Error(`Catalog code ${itemId} needs a non-empty description — it is the import-match and display label`);
  }
  const costType = normalizeAdditionCostType(input.costType ?? "M");
  validateAdditionPrice(defaultUnitPrice);
  const procoreCode = normalizeAdditionProcoreCode(input.procoreCode);

  if (isBuiltInCatalogCode(itemId)) {
    throw new Error(`Code ${itemId} is already a built-in STEP 4 catalog code — a built-in always wins, so an addition can't shadow it`);
  }

  const { data: existing, error: existsError } = await supabase
    .from("catalog_additions")
    .select("item_id")
    .eq("item_id", itemId)
    .maybeSingle();

  if (existsError) {
    console.error(`Failed to check catalog code ${itemId} for collisions:`, existsError);
    throw new Error(`Failed to check catalog code ${itemId} for collisions: ${existsError.message}`);
  }
  if (existing) {
    throw new Error(`Catalog code ${itemId} already exists`);
  }

  const { data, error } = await supabase
    .from("catalog_additions")
    .insert({
      item_id: itemId,
      description,
      target_uom: targetUom,
      default_unit_price: defaultUnitPrice,
      cost_type: costType,
      procore_code: procoreCode,
    })
    .select(CATALOG_ADDITION_COLUMNS)
    .single();

  if (error || !data) {
    // 23505 = unique_violation: a concurrent create won the PK race after our
    // pre-check — same outcome, same clean message.
    if (error?.code === "23505") {
      throw new Error(`Catalog code ${itemId} already exists`);
    }
    console.error(`Failed to create catalog code ${itemId}:`, error);
    throw new Error(`Failed to create catalog code ${itemId}: ${error?.message ?? "no row returned"}`);
  }

  return mapCatalogAdditionRow(data);
}

/**
 * Edits an addition (description / UOM / unit price / cost type / Procore BLI)
 * and/or marks it landed (status → 'landed', the Phase 7 harvest-reconciliation
 * one-click). Only the supplied fields change; each is validated with the same
 * rules as create. The item_id (PK) is never touched. updated_at is owned by the
 * touch trigger (not set here). NOT a retro-financial write — editing the price
 * affects only FUTURE row births (freeze-at-birth; saved rows keep their price).
 */
export async function updateCatalogAddition(input: {
  itemId: string;
  description?: string;
  targetUom?: string;
  defaultUnitPrice?: number;
  costType?: string;
  procoreCode?: string;
  status?: CatalogAdditionStatus;
}): Promise<CatalogAddition> {
  const itemId = input.itemId.trim();

  const patch: {
    description?: string;
    target_uom?: string;
    default_unit_price?: number;
    cost_type?: string;
    procore_code?: string;
    status?: CatalogAdditionStatus;
  } = {};

  if (input.description !== undefined) {
    const description = input.description.trim();
    if (description === "") {
      throw new Error(`Catalog code ${itemId} needs a non-empty description — it is the import-match and display label`);
    }
    patch.description = description;
  }

  if (input.targetUom !== undefined) {
    patch.target_uom = input.targetUom.trim().toUpperCase();
  }

  if (input.defaultUnitPrice !== undefined) {
    validateAdditionPrice(input.defaultUnitPrice);
    patch.default_unit_price = input.defaultUnitPrice;
  }

  if (input.costType !== undefined) {
    patch.cost_type = normalizeAdditionCostType(input.costType);
  }

  if (input.procoreCode !== undefined) {
    patch.procore_code = normalizeAdditionProcoreCode(input.procoreCode);
  }

  if (input.status !== undefined) {
    if (input.status !== "active" && input.status !== "landed") {
      throw new Error(`Invalid catalog addition status "${input.status}": must be 'active' or 'landed'`);
    }
    patch.status = input.status;
  }

  if (Object.keys(patch).length === 0) {
    throw new Error(`Nothing to update on catalog code ${itemId} — provide a field to change`);
  }

  const { data, error } = await supabase
    .from("catalog_additions")
    .update(patch)
    .eq("item_id", itemId)
    .select(CATALOG_ADDITION_COLUMNS)
    .single();

  if (error || !data) {
    console.error(`Failed to update catalog code ${itemId}:`, error);
    throw new Error(`Failed to update catalog code ${itemId}: ${error?.message ?? "no row returned"}`);
  }
  return mapCatalogAdditionRow(data);
}

// ═══════════════════════════════════════════════════════════════════
// Catalog cost-type overrides (Template + Catalog Reconciliation Phase 2)
// ═══════════════════════════════════════════════════════════════════
//
// Cost-type overrides for BUILT-IN STEP 4 catalog codes
// (catalog_cost_type_overrides table). The catalog chokepoint (catalog.ts)
// patches a matching built-in's costType with the override — that ONE field
// only — so a type correction survives the template re-harvest. LABEL ONLY:
// cost_type moves no dollars (not read by calculations.ts / exporter.ts);
// saved line items keep their frozen-at-birth cost_type.

const CATALOG_COST_TYPE_OVERRIDE_COLUMNS = "item_id, cost_type, note";

function mapCatalogCostTypeOverrideRow(row: Record<string, unknown>): CatalogCostTypeOverride {
  return {
    itemId: row.item_id as string,
    costType: row.cost_type as string,
    note: (row.note as string) || "",
  };
}

/**
 * Every built-in cost-type override (catalog_cost_type_overrides table),
 * ordered by itemId — the overlay the catalog chokepoint patches onto the
 * built-ins. Consumers load these FAIL-SOFT (`.catch(() => [])` at the prime
 * site): an outage degrades to the harvested types, never blocks a workflow.
 */
export async function getCatalogCostTypeOverrides(): Promise<CatalogCostTypeOverride[]> {
  const { data, error } = await supabase
    .from("catalog_cost_type_overrides")
    .select(CATALOG_COST_TYPE_OVERRIDE_COLUMNS)
    .order("item_id", { ascending: true });

  if (error) {
    console.error("Failed to fetch catalog cost-type overrides:", error);
    throw new Error(`Failed to fetch catalog cost-type overrides: ${error.message}`);
  }

  return (data || []).map(mapCatalogCostTypeOverrideRow);
}

/**
 * Creates or updates the cost-type override for one BUILT-IN catalog code (the
 * Phase 3 bulk-fix seeding + the Phase 5 /catalog built-in cost-type editor
 * write path). Validates before the write, mirroring the table's CHECK
 * constraints:
 *  - itemId must be a CURRENT BUILT-IN catalog code (an override exists only to
 *    relabel a built-in — the inverse of the addition collision rule);
 *  - cost type must be L/M/S/E (the shared addition guard).
 * Upsert on the item_id PK: one override per code, the latest write wins.
 * updated_at is owned by the touch trigger. NOT a financial write — costType is
 * a label (advisory + future row births only).
 */
export async function upsertCatalogCostTypeOverride(input: {
  itemId: string;
  costType: string;
  note?: string;
}): Promise<CatalogCostTypeOverride> {
  const itemId = input.itemId.trim();
  const costType = normalizeAdditionCostType(input.costType);

  if (!isBuiltInCatalogCode(itemId)) {
    throw new Error(
      `Code ${itemId} is not a built-in STEP 4 catalog code — a cost-type override can only relabel a built-in (additions carry their own type)`
    );
  }

  const row: { item_id: string; cost_type: string; note?: string } = {
    item_id: itemId,
    cost_type: costType,
  };
  if (input.note !== undefined) {
    row.note = input.note.trim();
  }

  const { data, error } = await supabase
    .from("catalog_cost_type_overrides")
    .upsert(row, { onConflict: "item_id" })
    .select(CATALOG_COST_TYPE_OVERRIDE_COLUMNS)
    .single();

  if (error || !data) {
    console.error(`Failed to save cost-type override for ${itemId}:`, error);
    throw new Error(`Failed to save cost-type override for ${itemId}: ${error?.message ?? "no row returned"}`);
  }
  return mapCatalogCostTypeOverrideRow(data);
}

// ═══════════════════════════════════════════════════════════════════
// Procore cost codes master list (Procore Cost Codes — Phase 1)
// ═══════════════════════════════════════════════════════════════════
//
// The company's authoritative Procore cost-code master list (procore_cost_codes
// table): (code, type, description) + lifecycle (status/mergedInto). The
// type-aware source of truth for "what Procore codes exist" and the join spine
// for the later actuals/final-cost workstream.
//
// UNWIRED in Phase 1: this read function exists but NO consumer flips to it yet —
// src/lib/procore-valid-codes.json stays the live export-validation oracle until
// Phase 4. Added now so Phase 2 (the /procore-codes page) and Phase 3 (type-aware
// /cost-codes) have the read surface ready.

const PROCORE_COST_CODE_COLUMNS = "code, type, description, status, merged_into";

function mapProcoreCostCodeRow(row: Record<string, unknown>): ProcoreCostCode {
  return {
    code: row.code as string,
    type: row.type as ProcoreCostCode["type"],
    description: row.description as string,
    // status is NOT NULL DEFAULT 'active'; the ?? is a safety net for narrower projections.
    status: (row.status as ProcoreCostCode["status"]) ?? "active",
    mergedInto: (row.merged_into as string | null) ?? null,
  };
}

/**
 * The full Procore cost-code master list (procore_cost_codes table), ordered by
 * code — every row including retired/merged ones, so the management page and the
 * Phase 4 reconciliation can show lifecycle state. Consumers that want only the
 * live list filter on `status === 'active'`. Throws on error (consistent with
 * getCatalogAdditions / getCostCodeMap); callers that must degrade gracefully wrap
 * with `.catch(() => [])` at the call site.
 */
export async function getProcoreCostCodes(): Promise<ProcoreCostCode[]> {
  const { data, error } = await supabase
    .from("procore_cost_codes")
    .select(PROCORE_COST_CODE_COLUMNS)
    .order("code", { ascending: true });

  if (error) {
    console.error("Failed to fetch Procore cost codes:", error);
    throw new Error(`Failed to fetch Procore cost codes: ${error.message}`);
  }

  return (data || []).map(mapProcoreCostCodeRow);
}

/**
 * Apply a /procore-codes import (Phase 2). Upserts the validated file rows and
 * (only) the codes the architect explicitly confirmed for retirement — never
 * auto-tombstones a missing code (architect-locked: a partial/bad export must
 * not silently nuke live codes).
 *
 * - `upserts` INSERT-or-UPDATE on the `code` PK: a new code is inserted, an
 *   existing one has its type/description refreshed and is (re)set 'active'
 *   with merged_into cleared (a re-import re-activates a previously retired
 *   code that reappears in the file).
 * - `retireCodes` flips the named ACTIVE codes to status='retired'. These are
 *   exactly the diff's proposed retirements the user ticked — nothing else.
 *
 * Re-validates the upsert rows here (single gateway: never trust the caller) so
 * an invalid type/shape can't reach the table even if the page is bypassed.
 * Routes through the table's existing INSERT/UPDATE RLS policies — NO new DDL.
 * Not transactional across the two statements (supabase-js has no multi-stmt tx
 * without an RPC); upserts run first so a mid-apply failure never leaves a code
 * retired without its replacement landing.
 */
export async function applyProcoreCostCodesImport(input: {
  upserts: Array<{ code: string; type: ProcoreCostCode["type"]; description: string }>;
  retireCodes?: string[];
}): Promise<void> {
  const retireCodes = (input.retireCodes ?? []).map((c) => c.trim()).filter(Boolean);

  // Re-validate every upsert row against the table's shape + CHECK vocabulary.
  const validTypes: ProcoreCostCode["type"][] = ["Labor", "Material", "Subcontract", "Equipment"];
  const rows = input.upserts.map((r) => ({
    code: r.code.trim(),
    type: r.type,
    description: r.description.trim(),
  }));
  for (const r of rows) {
    if (!r.code) throw new Error("Cannot apply import: a row has an empty cost code.");
    if (!r.description) throw new Error(`Cannot apply import: ${r.code} has an empty description.`);
    if (!validTypes.includes(r.type)) {
      throw new Error(`Cannot apply import: ${r.code} has invalid type "${r.type}".`);
    }
  }

  if (rows.length > 0) {
    const { error: upsertError } = await supabase
      .from("procore_cost_codes")
      .upsert(
        rows.map((r) => ({
          code: r.code,
          type: r.type,
          description: r.description,
          status: "active",
          merged_into: null,
        })),
        { onConflict: "code" },
      );
    if (upsertError) {
      console.error("Failed to apply Procore cost-code upserts:", upsertError);
      throw new Error(`Failed to apply Procore cost-code import: ${upsertError.message}`);
    }
  }

  if (retireCodes.length > 0) {
    const { error: retireError } = await supabase
      .from("procore_cost_codes")
      .update({ status: "retired" })
      .in("code", retireCodes);
    if (retireError) {
      console.error("Failed to retire Procore cost codes:", retireError);
      throw new Error(`Failed to retire Procore cost codes: ${retireError.message}`);
    }
  }
}
