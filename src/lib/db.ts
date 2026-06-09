import { Project, ProjectEstimate, TemplateConfig, TemplateLayoutConfig, CostCodeMapEntry, RateCardEntry } from "@/types/db";
import { ProcessedTakeoffRow, ColumnDefinition } from "@/types";
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
    roundingRule: (row.rounding_rule as string) || "dollar",
    projectType: (row.project_type as string) || "multifamily",
    marketSector: (row.market_sector as string) || "",
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
    rounding_rule: project.roundingRule ?? "dollar",
    project_type: project.projectType ?? "multifamily",
    market_sector: project.marketSector ?? "",
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
    gcUtilization: (row.gc_utilization != null && typeof row.gc_utilization === "object" && !Array.isArray(row.gc_utilization))
      ? (row.gc_utilization as Record<string, number>)
      : {},
    gcEquipmentOverrides: (row.gc_equipment_overrides != null && typeof row.gc_equipment_overrides === "object" && !Array.isArray(row.gc_equipment_overrides))
      ? (row.gc_equipment_overrides as Record<string, number>)
      : {},
    siteOperationsTotal: Number(row.site_operations_total) || 0,
    siteOpsQuantities: (row.site_ops_quantities != null && typeof row.site_ops_quantities === "object" && !Array.isArray(row.site_ops_quantities))
      ? (row.site_ops_quantities as Record<string, number>)
      : {},
    siteOpsRates: (row.site_ops_rates != null && typeof row.site_ops_rates === "object" && !Array.isArray(row.site_ops_rates))
      ? (row.site_ops_rates as Record<string, number>)
      : {},
    rateCardSnapshot: (row.rate_card_snapshot != null && typeof row.rate_card_snapshot === "object" && !Array.isArray(row.rate_card_snapshot))
      ? (row.rate_card_snapshot as Record<string, number>)
      : {},
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
    gc_utilization: estimate.gcUtilization ?? {},
    gc_equipment_overrides: estimate.gcEquipmentOverrides ?? {},
    site_operations_total: sanitizeNum(estimate.siteOperationsTotal),
    site_ops_quantities: estimate.siteOpsQuantities ?? {},
    site_ops_rates: estimate.siteOpsRates ?? {},
    rate_card_snapshot: estimate.rateCardSnapshot ?? {},
  };
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
 */
export async function recordClassificationResolution(
  classification: string,
  resolvedCode: string,
  projectId: string | null,
  resolvedBy: 'user' | 'global' | 'seed' | 'ai',
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
 * Retrieves all historical resolutions for a classification string.
 * Groups by resolved_code with count for AI confidence scoring.
 */
export async function getClassificationHistory(
  classification: string
): Promise<{ resolvedCode: string; resolvedBy: string; confidence: number; count: number }[]> {
  const { data, error } = await supabase
    .from("classification_history")
    .select("resolved_code, resolved_by, confidence")
    .eq("classification", classification)
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


