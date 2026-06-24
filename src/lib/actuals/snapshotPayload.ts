/**
 * Actuals Cost-History — Phase 2 storage-payload shaping (pure; no DB import).
 *
 * Bridges the Phase 1 normalization engine output ({@link NormalizedActuals}) to
 * the snake_case payload the `save_budget_snapshot` RPC expects. Kept pure and
 * separate from `db.ts` so the shaping is unit-testable against the golden fixture
 * without a live database.
 *
 * The calc/normalization engine is the sole financial authority — this module only
 * renames fields, it never derives or alters a dollar (AGENTS.md "No AI Autonomy
 * Over Financials"). The JSONB blobs (`events`, `diagnostics`,
 * `normalized_out_contributions`) are passed through as the engine's camelCase
 * objects; Postgres stores them verbatim and `db.ts` reads them straight back.
 */

import type {
  NormalizedActuals,
  CodeActual,
  ClassifiedChangeEvent,
  ActualsDiagnostics,
} from "./types";

/** The immutable header payload for `save_budget_snapshot` (p_snapshot). */
export interface BudgetSnapshotHeaderPayload {
  project_id: string;
  label: string;
  source_kind: string;
  grand_total_actual: number;
  grand_normalized_actual: number;
  burden_total_actual: number;
  direct_total_actual: number;
  events: ClassifiedChangeEvent[];
  diagnostics: ActualsDiagnostics;
  metadata: Record<string, unknown>;
}

/** One per-code+costType actuals row payload (p_actuals[]). Mirrors CodeActual. */
export interface BudgetSnapshotActualPayload {
  budget_code: string;
  cost_code: string;
  cost_type: string;
  description: string;
  original_budget: number;
  total_actual: number;
  normalized_actual: number;
  is_burden: boolean;
  normalized_out_contributions: CodeActual["normalizedOutContributions"];
}

/** The full `save_budget_snapshot` payload (header + per-code actuals). */
export interface BudgetSnapshotPayload {
  snapshot: BudgetSnapshotHeaderPayload;
  actuals: BudgetSnapshotActualPayload[];
}

/** Caller-supplied identity/labelling for a snapshot save. */
export interface BuildBudgetSnapshotOptions {
  /** The target project the snapshot is uploaded against (user-picked in Phase 3). */
  projectId: string;
  /** Optional user title (e.g. "March 2026 EAC"). */
  label?: string;
  /** The {@link ActualsSource} kind that produced it ("csv" now; "procore-api" later). */
  sourceKind?: string;
  /** Free-form notes (embedded project token, file names, source provenance). */
  metadata?: Record<string, unknown>;
}

/**
 * Shapes a {@link NormalizedActuals} result into the `save_budget_snapshot` RPC
 * payload. One actuals row per `codeActual` (preserving budget-export order); the
 * four engine grand totals + the frozen `events`/`diagnostics` audit payloads ride
 * the header. Nothing is recomputed — the engine's numbers are copied verbatim.
 */
export function buildBudgetSnapshotPayload(
  normalized: NormalizedActuals,
  opts: BuildBudgetSnapshotOptions,
): BudgetSnapshotPayload {
  return {
    snapshot: {
      project_id: opts.projectId,
      label: opts.label ?? "",
      source_kind: opts.sourceKind ?? "csv",
      grand_total_actual: normalized.grandTotalActual,
      grand_normalized_actual: normalized.grandNormalizedActual,
      burden_total_actual: normalized.burdenTotalActual,
      direct_total_actual: normalized.directTotalActual,
      events: normalized.events,
      diagnostics: normalized.diagnostics,
      metadata: opts.metadata ?? {},
    },
    actuals: normalized.codeActuals.map((c) => ({
      budget_code: c.budgetCode,
      cost_code: c.costCode,
      cost_type: c.costType,
      description: c.description,
      original_budget: c.originalBudget,
      total_actual: c.totalActual,
      normalized_actual: c.normalizedActual,
      is_burden: c.isBurden,
      normalized_out_contributions: c.normalizedOutContributions,
    })),
  };
}
