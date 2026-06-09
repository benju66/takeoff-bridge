/**
 * Override-setter decision logic (Phase 5, slice 4 — the first WRITE path onto the
 * Phase 4 override data layer).
 *
 * Pure: no React, no DB. The glass-box editor (TrustInspector) calls these to build the
 * exact payload it hands to `db.recordEstimateOverride(projectId, field, computedValue,
 * overrideValue, reason)` and to validate the estimator's input. Keeping the decisions
 * here (not inside the component) lets them be unit-tested in node — the repo has no DOM
 * test harness — mirroring `overrides.ts` (the read-side reducer this round-trips with).
 *
 * The three traps these helpers exist to close (all from the Phase 4 contract):
 *  - The audit trail must record the PRISTINE computed value, never a prior override.
 *  - An override of `0` is a REAL set (INV-3) — never confused with a revert.
 *  - A revert is an explicit `overrideValue: null` tombstone, never "clear the input".
 */

import type { TakeoffSummary } from "@/lib/calculations";

/** Default reason stamped on a revert (the editor's Revert button captures no free text). */
export const REVERT_REASON = "Reverted to computed value";

/** A SET event: substitute `overrideValue` (a real number; `0` is honored) for the computed value. */
export interface OverrideSetPayload {
  field: string;
  /** The engine's pristine computed value at the time of the override (audit "what it was"). */
  computedValue: number;
  /** The estimator's value used in place of computed. `0` is a real override (INV-3). */
  overrideValue: number;
  reason: string;
}

/** A REVERT event: an `overrideValue: null` tombstone → the field falls back to computed. */
export interface OverrideRevertPayload {
  field: string;
  computedValue: number;
  overrideValue: null;
  reason: string;
}

/** Either event; both map 1:1 onto `recordEstimateOverride`'s (field, computed, override, reason). */
export type OverridePayload = OverrideSetPayload | OverrideRevertPayload;

/** Result of validating the editor's raw text inputs. */
export type OverrideValidation =
  | { ok: true; value: number }
  | { ok: false; error: string };

/**
 * The PRISTINE computed value to record for the audit trail — the engine's value, not a
 * prior override. First override of a field → the live `summary[field]`. Re-overriding an
 * already-overridden field → `summary.overrides[field].computedValue` (the value the engine
 * computed before any override), so the trail keeps saying what the math actually produced.
 */
export function selectPristineComputedValue(
  field: string,
  summary: TakeoffSummary
): number {
  const existing = summary.overrides?.[field];
  if (existing) return existing.computedValue;
  return (summary[field as keyof TakeoffSummary] as number | undefined) ?? 0;
}

/**
 * Validate the editor inputs for a SET. A reason is required (audit), the override must be a
 * finite number, and an empty input is rejected (clearing an override is the explicit Revert
 * button, not an empty save). `"0"` is VALID — a real override (INV-3).
 */
export function validateOverrideInput(
  overrideRaw: string,
  reason: string
): OverrideValidation {
  if (reason.trim() === "") {
    return { ok: false, error: "A reason is required to record an override." };
  }
  const trimmed = overrideRaw.trim();
  if (trimmed === "") {
    return { ok: false, error: "Enter an override value (use Revert to clear an override)." };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { ok: false, error: "The override must be a number." };
  }
  return { ok: true, value };
}

/** Build a SET payload. `overrideValue` is a real number (`0` is honored, not a revert). */
export function buildSetPayload(
  field: string,
  computedValue: number,
  overrideValue: number,
  reason: string
): OverrideSetPayload {
  return { field, computedValue, overrideValue, reason };
}

/**
 * Build a REVERT tombstone payload (`overrideValue: null`) — the field falls back to computed.
 * Reverting is always explicit; it is never inferred from an empty/zero input.
 */
export function buildRevertPayload(
  field: string,
  computedValue: number,
  reason: string = REVERT_REASON
): OverrideRevertPayload {
  return { field, computedValue, overrideValue: null, reason };
}
