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
