/**
 * Trust Inspector — pure view-model (Phase 5, slice 2: 5a Click-to-trace).
 *
 * This module ONLY arranges values the calculation engine already returned
 * (`computeTakeoffSummary`, `computeLinkedDivisionTotals`) into a decomposition
 * tree the glass-box UI renders. It computes NO dollars — `calculations.ts`
 * stays the sole financial authority (AGENTS.md). Keeping the decomposition as a
 * pure builder lets the trace be unit-tested in node (the repo has no DOM-test
 * harness) without re-implementing any math.
 */

import type { Project } from "@/types/db";
import { ESTIMATE_MODIFIERS } from "@/lib/constants";
import type { LinkedDivisionTotal, TakeoffSummary } from "@/lib/calculations";
import type { ProcessedTakeoffRow, EstimateOverrideRecord } from "@/types";

/** The three Trust Inspector tabs (Reconcile + Flags ship in later slices). */
export type TrustTab = "trace" | "reconcile" | "flags";

/**
 * Human-readable description of each rounding mode, surfaced inline in the trace
 * so the active mode is visible (B-3 visibility — no math change). The keys match
 * the `roundingRule` values understood by `computeTakeoffSummary.applyRounding`.
 */
export const ROUNDING_MODE_LABELS: Record<string, string> = {
  none: "No rounding — ties the source spreadsheet to the cent",
  dollar: "Each line rounded to the nearest $1",
  ten: "Each line rounded to the nearest $10",
  hundred: "Each line rounded to the nearest $100",
};

/** Resolve a rounding-mode label, defaulting the same way the engine does (`dollar`). */
export function roundingModeLabel(mode: string | undefined): string {
  const key = mode ?? "dollar";
  return ROUNDING_MODE_LABELS[key] ?? ROUNDING_MODE_LABELS.dollar;
}

/** Friendly label for a TakeoffSummary override field (audit log + flags). */
export function summaryFieldLabel(field: string): string {
  if (field === "subtotal") return "Subtotal";
  if (field === "totalEstimatedCost") return "Total Estimated Cost";
  const mod = ESTIMATE_MODIFIERS.find((m) => m.key === field);
  return mod ? mod.label : field;
}

/** Where a modifier rate came from: an explicit project value (✎) or the engine default (⚙). */
export type RateOrigin = "project" | "default";

/** Computed-vs-override pair as the engine reports it in `summary.overrides[field]`. */
export interface OverridePair {
  computedValue: number;
  overrideValue: number;
}

/** One modifier row in the trace (rate × subtotal → value), with its rate origin. */
export interface TraceModifierNode {
  /** TakeoffSummary field key, e.g. "fee" (also the OVERRIDABLE_SUMMARY_FIELDS key). */
  key: string;
  /** Template label, e.g. "Fee". */
  label: string;
  /** STEP 4 cost code, e.g. "60-4000.001". */
  code: string;
  /** Rate as a decimal (e.g. 0.04). */
  rateDecimal: number;
  /** Rate formatted for display, e.g. "4" or "1.5" (no trailing zeros). */
  ratePercent: string;
  /** ✎ project-set when the project carries an explicit rate, else ⚙ system default. */
  rateOrigin: RateOrigin;
  /** Effective (override-applied) value the engine returned for this modifier. */
  value: number;
  /** Present only when this modifier is overridden — computed vs override. */
  overridden?: OverridePair;
}

/** The full Total-Estimated-Cost decomposition the Trace tab renders. */
export interface TraceModel {
  /** The summary field the inspector opened focused on (for highlight/scroll). */
  focusField: string;
  subtotal: {
    /** Effective subtotal (= takeoff + linked, unless directly overridden). */
    value: number;
    overridden?: OverridePair;
    /** STEP 4 takeoff rows only: Σ(qty × price). */
    takeoff: { value: number; rowCount: number };
    /** Linked GC + Site Ops division values, expandable to the 10 rows. */
    linked: { value: number; rows: LinkedDivisionTotal[] };
  };
  /** The 7 template modifiers, in template order. */
  modifiers: TraceModifierNode[];
  total: {
    /** Effective Total Estimated Cost. */
    value: number;
    overridden?: OverridePair;
  };
  /** Active rounding rule key (e.g. "dollar"). */
  roundingMode: string;
  /** Human-readable rounding description. */
  roundingLabel: string;
}

export interface BuildTraceArgs {
  summary: TakeoffSummary;
  /** The 10 linked-division rows (`computeLinkedDivisionTotals`). */
  linkedTotals: LinkedDivisionTotal[];
  /** Project — read for rate fields (`${key}Rate`) and `roundingRule` only. */
  project: Project;
  /** Count of contributing (non-linked) takeoff rows, for the "· N rows" label. */
  takeoffRowCount: number;
  /** Which field the inspector is focused on (defaults to the grand total). */
  focusField?: string;
}

/**
 * Format a modifier rate decimal as a percent string with no trailing zeros,
 * matching the EstimateTable footer (`(rate*100).toFixed(2).replace(...)`).
 */
function formatRatePercent(rateDecimal: number): string {
  return (rateDecimal * 100).toFixed(2).replace(/\.?0+$/, "");
}

/**
 * Build the Trace decomposition view-model. Pure: it reads the effective summary,
 * the linked totals, and the project's rates — and rearranges them. No dollar is
 * computed here; every number originates in `calculations.ts`.
 */
export function buildTraceModel({
  summary,
  linkedTotals,
  project,
  takeoffRowCount,
  focusField = "totalEstimatedCost",
}: BuildTraceArgs): TraceModel {
  const overrides = summary.overrides ?? {};

  const modifiers: TraceModifierNode[] = ESTIMATE_MODIFIERS.map((mod) => {
    const rateField = `${mod.key}Rate` as keyof Project;
    const projectRate = project[rateField] as number | null | undefined;
    const rateOrigin: RateOrigin = projectRate != null ? "project" : "default";
    const rateDecimal = projectRate ?? mod.defaultRate;
    return {
      key: mod.key,
      label: mod.label,
      code: mod.code,
      rateDecimal,
      ratePercent: formatRatePercent(rateDecimal),
      rateOrigin,
      value: (summary[mod.key as keyof TakeoffSummary] as number) ?? 0,
      overridden: overrides[mod.key],
    };
  });

  const roundingMode = project.roundingRule ?? "dollar";

  return {
    focusField,
    subtotal: {
      value: summary.subtotal,
      overridden: overrides.subtotal,
      takeoff: { value: summary.takeoffSubtotal, rowCount: takeoffRowCount },
      linked: { value: summary.linkedDivisionsTotal, rows: linkedTotals },
    },
    modifiers,
    total: {
      value: summary.totalEstimatedCost,
      overridden: overrides.totalEstimatedCost,
    },
    roundingMode,
    roundingLabel: roundingModeLabel(roundingMode),
  };
}

// ---------------------------------------------------------------------------
// 5b — Reconciliation view-model (Phase 5, slice 3)
//
// Surfaces the export gate's tie-out LIVE (it runs silently today and throws the
// result away when it passes), and extends it to the grand total: TOTAL ESTIMATED
// COST ↔ the full Procore budget (scope rollup + the 60-xxxx modifier rollup). With
// a modifier override applied this is the live INV-1 proof (screen == exported).
//
// PURE: this only arranges values the engine + export gate already produced and
// classifies the divergence; the modifier rollup is `exporter.rollupEffectiveModifiers`.
// No estimate math here — `calculations.ts` stays the sole authority.
// ---------------------------------------------------------------------------

/**
 * Overall reconciliation classification — drives the status-bar chip color and the
 * Reconcile-tab message. Amber (`blocked`) is reserved for genuine export blockers;
 * a deliberate subtotal/total override the Procore CSV can't carry is `override`
 * (informational, not an alarm); a sub-rounding-unit residual folds into `ties`.
 */
export type ReconciliationStatus = "ties" | "blocked" | "override";

/** One tie layer: a left figure that must equal a right figure within tolerance. */
export interface ReconciliationLayer {
  left: number;
  right: number;
  /** left − right. */
  delta: number;
  /** |delta| within the layer's tolerance. */
  ok: boolean;
}

export interface ReconciliationModel {
  /** Scope tie (the existing gate): line-item subtotal ↔ 217-code Procore rollup. */
  scope: ReconciliationLayer & { lineItemTotal: number; rollupTotal: number };
  /** Σ effective modifiers written to the 60-xxxx codes (exporter.rollupEffectiveModifiers). */
  modifierRollupTotal: number;
  /** Grand-total tie: Total Estimated Cost ↔ full Procore budget (scope rollup + modifiers). */
  grandTotal: ReconciliationLayer & { totalEstimatedCost: number; fullProcoreBudgetTotal: number };
  /** True only when a direct subtotal/total override (not a modifier) is active. */
  hasDirectOverride: boolean;
  /** Rows whose dollars can't be placed on a Procore code (export-blocking). */
  blockerCount: number;
  /** Overall classification (chip color + tab message). */
  status: ReconciliationStatus;
  /** Active rounding rule key + human label (B-3 visibility). */
  roundingMode: string;
  roundingLabel: string;
}

export interface BuildReconciliationArgs {
  /** The export gate's scope reconciliation (`validateExportReadiness().reconciliation`). */
  reconciliation: { lineItemTotal: number; rollupTotal: number; delta: number; ok: boolean };
  /** Count of rows carrying unmapped dollars (`validateExportReadiness().blockers.length`). */
  blockerCount: number;
  /** Effective (override-applied, FULL unfiltered) summary — never a filtered one (Amendment F). */
  summary: TakeoffSummary;
  /** Σ effective modifiers (exporter.rollupEffectiveModifiers) — the 60-xxxx dollars. */
  modifierRollupTotal: number;
  /** Active rounding rule key (e.g. "dollar"). */
  roundingMode: string;
  /** Cent-level tie tolerance (exporter.RECONCILIATION_TOLERANCE). */
  tolerance: number;
}

/** Half the rounding unit — the most the rounded on-screen subtotal can differ from the raw Procore scope total. */
function roundingResidualBound(mode: string): number {
  switch (mode) {
    case "dollar":
      return 0.5;
    case "ten":
      return 5;
    case "hundred":
      return 50;
    default:
      return 0; // "none" → ties to the cent
  }
}

/**
 * Build the Reconcile view-model. The grand-total tie uses a ROUNDING-AWARE tolerance
 * (½ the rounding unit + the cent tolerance): under `none` it ties to the cent; under
 * `dollar` the subtotal's ≤$0.50 rounding residual still counts as tied (the tab shows
 * the exact delta). A deliberate subtotal/total override blows past that band and is
 * classified `override` (info, not amber). Real export blockers (unmapped rows / a
 * broken scope tie) are the only `blocked` (amber) state.
 */
export function buildReconciliationModel({
  reconciliation,
  blockerCount,
  summary,
  modifierRollupTotal,
  roundingMode,
  tolerance,
}: BuildReconciliationArgs): ReconciliationModel {
  const scope = {
    lineItemTotal: reconciliation.lineItemTotal,
    rollupTotal: reconciliation.rollupTotal,
    left: reconciliation.lineItemTotal,
    right: reconciliation.rollupTotal,
    delta: reconciliation.delta,
    ok: reconciliation.ok,
  };

  const totalEstimatedCost = summary.totalEstimatedCost;
  const fullProcoreBudgetTotal = reconciliation.rollupTotal + modifierRollupTotal;
  const grandDelta = totalEstimatedCost - fullProcoreBudgetTotal;
  const grandTolerance = roundingResidualBound(roundingMode) + tolerance;
  const grandOk = Math.abs(grandDelta) <= grandTolerance;

  const overrides = summary.overrides ?? {};
  const hasDirectOverride =
    overrides.subtotal != null || overrides.totalEstimatedCost != null;

  // Amber is reserved for real export blockers. A grand-total divergence beyond the
  // rounding band is benign only when a direct override explains it; otherwise it is
  // an unexpected mismatch we must NOT hide, so it also surfaces as `blocked`.
  let status: ReconciliationStatus;
  if (blockerCount > 0 || !scope.ok) {
    status = "blocked";
  } else if (grandOk) {
    status = "ties";
  } else if (hasDirectOverride) {
    status = "override";
  } else {
    status = "blocked";
  }

  return {
    scope,
    modifierRollupTotal,
    grandTotal: {
      totalEstimatedCost,
      fullProcoreBudgetTotal,
      left: totalEstimatedCost,
      right: fullProcoreBudgetTotal,
      delta: grandDelta,
      ok: grandOk,
    },
    hasDirectOverride,
    blockerCount,
    status,
    roundingMode,
    roundingLabel: roundingModeLabel(roundingMode),
  };
}

// ---------------------------------------------------------------------------
// 5c — Flags view-model (Phase 5, slice 5): the needs-review worklist (INV-8),
// the unmapped-import worklist (carries each row's quantity), and the append-only
// override audit log read from `overrideRecords`.
//
// PURE: it filters/arranges rows + override records already loaded by the page;
// no math, no DB. The Flags tab renders this directly; tests assert it in node.
// ---------------------------------------------------------------------------

/** A worklist row reference — enough to show the line and jump the grid to it. */
export interface FlagsRowRef {
  rowId: string;
  itemId: string;
  classification: string;
  description: string;
  /** Carried quantity (Phase 3 preserves it through ingestion). */
  matchedQty: number;
  uom: string;
}

/** A set substitutes a value; a revert (`overrideValue === null`) returns to computed. */
export type FlagsAuditKind = "set" | "revert";

/** One immutable audit entry, projected from an `EstimateOverrideRecord`. */
export interface FlagsAuditEntry {
  field: string;
  /** Friendly field label (e.g. "Fee"). */
  fieldLabel: string;
  kind: FlagsAuditKind;
  computedValue: number | null;
  /** null on a revert tombstone. */
  overrideValue: number | null;
  reason: string;
  createdBy: string | null;
  createdAt: string;
}

export interface FlagsModel {
  /** Rows flagged needsReview (INV-8) — review before export. */
  needsReviewRows: FlagsRowRef[];
  /** Rows carrying a classification but no Procore code yet (B-4 recovery target). */
  unmappedRows: FlagsRowRef[];
  /** The full append-only override trail, newest first (order preserved). */
  auditLog: FlagsAuditEntry[];
}

function toRowRef(r: ProcessedTakeoffRow): FlagsRowRef {
  return {
    rowId: r.id,
    itemId: r.itemId,
    classification: r.classification,
    description: r.description,
    matchedQty: r.matchedQty,
    uom: r.uom,
  };
}

/**
 * Build the Flags view-model. `overrideRecords` MUST already be newest-first (the
 * `useEstimateOverrides` hook returns them so); the log preserves that order.
 */
export function buildFlagsModel({
  rows,
  overrideRecords,
}: {
  rows: ProcessedTakeoffRow[];
  overrideRecords: EstimateOverrideRecord[];
}): FlagsModel {
  const needsReviewRows = rows.filter((r) => r.needsReview).map(toRowRef);
  const unmappedRows = rows
    .filter((r) => !r.isMapped && r.classification.trim() !== "")
    .map(toRowRef);
  const auditLog: FlagsAuditEntry[] = overrideRecords.map((rec) => ({
    field: rec.field,
    fieldLabel: summaryFieldLabel(rec.field),
    kind: rec.overrideValue === null ? "revert" : "set",
    computedValue: rec.computedValue,
    overrideValue: rec.overrideValue,
    reason: rec.reason,
    createdBy: rec.createdBy ?? null,
    createdAt: rec.createdAt,
  }));
  return { needsReviewRows, unmappedRows, auditLog };
}
