import { Project, ProjectEstimate } from "@/types/db";
import { ProcessedTakeoffRow, ColumnDefinition } from "@/types";
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
  };
}

function mapLineItemFromRow(row: Record<string, unknown>): ProcessedTakeoffRow {
  return {
    id: row.id as string,
    classification: (row.classification as string) || "",
    itemId: (row.item_id as string) || "",
    procoreParentCode: (row.procore_parent_code as string) || "",
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
  };
}

function mapEstimateFromRow(row: Record<string, unknown>): Omit<ProjectEstimate, "items"> {
  return {
    projectId: row.project_id as string,
    subtotal: Number(row.subtotal) || 0,
    generalLiability: Number(row.general_liability) || 0,
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
 * Saves or updates project estimate totals/markups.
 * Does NOT persist line items — use saveEstimateLineItems() for those.
 */
export async function saveProjectEstimate(
  estimate: Omit<ProjectEstimate, "items">
): Promise<void> {
  const { error } = await supabase.from("project_estimates").upsert(
    {
      project_id: estimate.projectId,
      subtotal: estimate.subtotal,
      general_liability: estimate.generalLiability,
      fee: estimate.fee,
      total_cost: estimate.totalCost,
      general_conditions_total: estimate.generalConditionsTotal ?? 0,
      gc_utilization: estimate.gcUtilization ?? {},
      gc_equipment_overrides: estimate.gcEquipmentOverrides ?? {},
      site_operations_total: estimate.siteOperationsTotal ?? 0,
      site_ops_quantities: estimate.siteOpsQuantities ?? {},
      site_ops_rates: estimate.siteOpsRates ?? {},
      updated_at: new Date().toISOString(),
    },
    { onConflict: "project_id" }
  );

  if (error) {
    console.error("Failed to save project estimate", error);
    throw new Error(`Failed to save project estimate: ${error.message}`);
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
 * Atomically saves all estimate line items via Supabase RPC.
 * Wraps DELETE + INSERT in a single PostgreSQL transaction.
 * sort_order is derived from the array index to preserve visual position.
 */
export async function saveEstimateLineItems(
  projectId: string,
  rows: ProcessedTakeoffRow[]
): Promise<void> {
  const payload = rows.map((row, index) => ({
    id: row.id,
    sort_order: index,
    classification: row.classification,
    item_id: row.itemId,
    procore_parent_code: row.procoreParentCode,
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
  }));

  const { error } = await supabase.rpc("save_estimate_line_items", {
    p_project_id: projectId,
    p_items: payload,
  });

  if (error) {
    console.error("Failed to save estimate line items via RPC", error);
    throw new Error(`Failed to save estimate line items: ${error.message}`);
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

