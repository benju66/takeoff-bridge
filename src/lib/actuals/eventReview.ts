/**
 * Actuals Cost-History — Phase 5 change-event review engine (pure; no DB, no React).
 *
 * A budget snapshot freezes every Procore change event already auto-classified by
 * Scope / Type / Reason (Phase 1). That classification decides whether the event's
 * dollars are KEPT in the normalized actual (original-scope cost — the pricing
 * signal) or normalized OUT (owner extras / allowances / net-zero internal
 * reclasses). The export is messy and historical jobs have blanks, so Phase 5 lets
 * a human REVIEW and, where wrong, CORRECT a classification before the snapshot is
 * promoted to FINAL.
 *
 * A correction is stored in the SAME mutable overlay (`budget_snapshot_allocations`)
 * as an open-enum `kind = "event_classification"` row carrying the eventId + the
 * corrected scope/type/reason in its JSONB `detail` — recomputed on every load
 * (the frozen snapshot rows are NEVER mutated, Phase 2 immutability).
 *
 * Nothing is fabricated: the human supplies the corrected Scope/Type/Reason and the
 * SAME deterministic engine ({@link classifyChangeEvent}) re-derives the dollars,
 * exactly mirroring the auto-read — and the net-zero internal-reclass refinement
 * `normalize.ts` applies. The recompute is delta-based and provably idempotent:
 * with no overrides, the effective numbers equal the frozen numbers to the cent.
 *
 * Kept pure and DB/React-decoupled (a structural {@link OverlayRowLike} stand-in,
 * mirroring `reconcile.ts`'s `AllocationLike`) so it is unit-testable against the
 * real `templates/` fixtures without a database.
 */

import {
  classifyChangeEvent,
  canonicalizeScope,
  canonicalizeType,
  canonicalizeReason,
} from "./classify";
import { buildGrainKey, round2 } from "./currency";
import { FEE_CODE, GL_INSURANCE_CODE, isBurdenCode } from "./normalize";
import type { AllocationWriteInput } from "./reconcile";
import type {
  CodeActual,
  ClassifiedChangeEvent,
  NormalizationBucket,
  ChangeEventScope,
  ChangeEventType,
  ChangeEventReason,
} from "./types";

// ---------------------------------------------------------------------------
// Constants mirrored from normalize.ts (kept local to avoid touching the engine).
// ---------------------------------------------------------------------------

/** Tolerance (dollars) for the net-zero Internal-reclass test — mirrors `normalize.ts`. */
const NET_ZERO_EPS = 0.01;

// ---------------------------------------------------------------------------
// The overlay `kind` for an event-classification override (open-enum; no DDL).
// ---------------------------------------------------------------------------

/** The Phase-5 overlay `kind` value for a human classification correction. */
export const EVENT_CLASSIFICATION_KIND = "event_classification";

/** A human's correction of one change event's classification. */
export interface EventClassificationOverride {
  /** Canonical change-event id (matches {@link ClassifiedChangeEvent.eventId}). */
  eventId: string;
  scope: ChangeEventScope;
  type: ChangeEventType;
  reason: ChangeEventReason;
  /** Optional free-text rationale captured with the correction. */
  note?: string;
}

/**
 * The minimal overlay-row shape this module reads — a structural subset of
 * `BudgetSnapshotAllocation` (`src/types/db.ts`). Declared here (not imported) to
 * keep the module DB-decoupled and avoid a type-only import cycle.
 */
export interface OverlayRowLike {
  kind: string;
  detail: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Overlay read / write
// ---------------------------------------------------------------------------

/**
 * Read a classification override off an overlay row, or `null` when the row is not
 * an `event_classification` (the page passes ALL overlay rows in). The stored
 * scope/type/reason are re-canonicalized defensively so a hand-edited `detail`
 * can never smuggle an off-enum value into the recompute.
 */
export function parseEventOverride(row: OverlayRowLike): EventClassificationOverride | null {
  if (row.kind !== EVENT_CLASSIFICATION_KIND) return null;
  const d = row.detail ?? {};
  const eventId = typeof d.eventId === "string" ? d.eventId : "";
  if (eventId === "") return null;
  const note = typeof d.note === "string" && d.note !== "" ? d.note : undefined;
  return {
    eventId,
    scope: canonicalizeScope(d.scope),
    type: canonicalizeType(d.type),
    reason: canonicalizeReason(d.reason),
    note,
  };
}

/**
 * Collect the per-event overrides from a snapshot's overlay rows, keyed by eventId.
 * Rows arrive oldest-first (`getBudgetSnapshotAllocations` orders by `created_at`),
 * so the latest write for an eventId wins.
 */
export function collectEventOverrides(
  rows: OverlayRowLike[],
): Map<string, EventClassificationOverride> {
  const map = new Map<string, EventClassificationOverride>();
  for (const row of rows) {
    const ov = parseEventOverride(row);
    if (ov) map.set(ov.eventId, ov);
  }
  return map;
}

/**
 * Build the overlay-write payload that persists one classification correction. It
 * is an EVENT-level row (`budgetCode` / `estimateLineItemId` empty, zero dollars) —
 * the dollars it moves are recomputed from the frozen actuals, never stored here.
 */
export function buildEventOverrideAllocation(
  snapshotId: string,
  override: EventClassificationOverride,
): AllocationWriteInput {
  return {
    snapshotId,
    budgetCode: "",
    estimateLineItemId: "",
    kind: EVENT_CLASSIFICATION_KIND,
    allocatedTotal: 0,
    allocatedNormalized: 0,
    detail: {
      eventId: override.eventId,
      scope: override.scope,
      type: override.type,
      reason: override.reason,
      ...(override.note ? { note: override.note } : {}),
    },
    note: override.note ?? "",
  };
}

// ---------------------------------------------------------------------------
// Effective disposition (auto-read, or override re-derived through the engine)
// ---------------------------------------------------------------------------

/** An event's effective classification after applying any human override. */
export interface EffectiveEventDisposition {
  bucket: NormalizationBucket;
  /** True when this event's dollars are subtracted from EAC for the normalized actual. */
  isNormalizedOut: boolean;
  /** True when a human override produced this disposition (vs the frozen auto-read). */
  isOverridden: boolean;
}

/**
 * Resolve an event's effective disposition. With no override, the frozen auto-read
 * passes through verbatim. With an override, the corrected scope/type/reason is run
 * through the SAME {@link classifyChangeEvent} the auto-read used, then the same
 * net-zero internal-reclass refinement `normalize.ts` applies (an internal-reason
 * event that is NOT a net-zero shuffle is kept, using the event's frozen
 * `netLatestCost`).
 */
export function resolveEffectiveDisposition(
  event: Pick<ClassifiedChangeEvent, "bucket" | "isNormalizedOut" | "netLatestCost">,
  override?: EventClassificationOverride | null,
): EffectiveEventDisposition {
  if (!override) {
    return { bucket: event.bucket, isNormalizedOut: event.isNormalizedOut, isOverridden: false };
  }
  let { bucket, isNormalizedOut } = classifyChangeEvent(override.scope, override.type, override.reason);
  if (bucket === "internal_reclass" && Math.abs(event.netLatestCost) >= NET_ZERO_EPS) {
    bucket = "internal_nonzero";
    isNormalizedOut = false;
  }
  return { bucket, isNormalizedOut, isOverridden: true };
}

// ---------------------------------------------------------------------------
// Recompute (delta-based; idempotent)
// ---------------------------------------------------------------------------

/** A change event paired with its effective (post-override) disposition. */
export interface EffectiveChangeEvent extends ClassifiedChangeEvent {
  effectiveBucket: NormalizationBucket;
  effectiveIsNormalizedOut: boolean;
  isOverridden: boolean;
  override: EventClassificationOverride | null;
}

export interface ApplyEventOverridesInput {
  /** The snapshot's frozen per code+type actuals (`getBudgetSnapshotDetail().actuals`). */
  actuals: CodeActual[];
  /** The snapshot's frozen classified events. */
  events: ClassifiedChangeEvent[];
  /** Per-event overrides keyed by eventId (from {@link collectEventOverrides}). */
  overrides: Map<string, EventClassificationOverride>;
}

export interface EffectiveActualsResult {
  /** Frozen actuals with normalizedActual recomputed for overrides (deep copies). */
  effectiveActuals: CodeActual[];
  /** Each event with its effective disposition + override flag. */
  effectiveEvents: EffectiveChangeEvent[];
  /** How many events have a human override applied. */
  overrideCount: number;
  grandTotalActual: number;
  /** Σ frozen normalizedActual (no overrides) — the engine's baseline. */
  baseGrandNormalizedActual: number;
  /** Σ effective normalizedActual (with overrides). */
  grandNormalizedActual: number;
  /** grandNormalizedActual − baseGrandNormalizedActual (how the corrections moved it). */
  normalizedDelta: number;
  /** Σ totalActual across the Fee + GL burden codes. */
  burdenTotalActual: number;
  /** Σ totalActual across non-burden (direct-cost) codes. */
  directTotalActual: number;
  /** Σ totalActual on the Fee code (60-604000.000). */
  feeTotalActual: number;
  /** Σ totalActual on the GL insurance code (60-602020.000). */
  glTotalActual: number;
}

/**
 * Recompute the per-code normalized actuals under a set of human classification
 * corrections, WITHOUT mutating the frozen snapshot.
 *
 * Delta-based: start from each code's frozen `normalizedActual`; for every
 * non-duplicate event whose EFFECTIVE `isNormalizedOut` differs from its frozen
 * value, compute that event's per-grain contribution exactly the way `normalize.ts`
 * does (`event.lines` → skip blank/zero → `buildGrainKey` → `round2(latestCost)`)
 * and ADD it back (out→kept) or SUBTRACT it (kept→out). Events whose disposition is
 * unchanged contribute nothing — so with no overrides the effective numbers equal
 * the frozen numbers to the cent. A kept→out contribution on a grain with no actual
 * row synthesizes a zero-total code (mirrors `normalize.ts` — dollars never dropped).
 */
export function applyEventClassificationOverrides(
  input: ApplyEventOverridesInput,
): EffectiveActualsResult {
  // 1. Deep-copy the frozen actuals into a mutable working map (never touch input).
  const work = new Map<string, CodeActual>();
  for (const a of input.actuals) {
    work.set(a.budgetCode, {
      ...a,
      normalizedOutContributions: a.normalizedOutContributions.map((c) => ({ ...c })),
    });
  }

  // 2. Effective disposition per event + apply the delta for the ones that changed.
  const effectiveEvents: EffectiveChangeEvent[] = [];
  let overrideCount = 0;

  for (const ev of input.events) {
    const override = input.overrides.get(ev.eventId) ?? null;
    const eff = resolveEffectiveDisposition(ev, override);
    if (eff.isOverridden) overrideCount += 1;

    effectiveEvents.push({
      ...ev,
      effectiveBucket: eff.bucket,
      effectiveIsNormalizedOut: eff.isNormalizedOut,
      isOverridden: eff.isOverridden,
      override,
    });

    // Only a disposition CHANGE on a non-duplicate event moves money.
    if (ev.isDuplicate) continue;
    if (eff.isNormalizedOut === ev.isNormalizedOut) continue;

    // was out, now kept → ADD BACK (+); was kept, now out → SUBTRACT (−).
    const sign = ev.isNormalizedOut && !eff.isNormalizedOut ? 1 : -1;

    for (const line of ev.lines) {
      if (line.costCode === "") continue;
      if (line.latestCost === 0) continue;
      const key = buildGrainKey(line.costCode, line.costType);
      let target = work.get(key);
      if (!target) {
        // kept→out on a code with no budget EAC row: synthesize (never drop dollars).
        target = {
          budgetCode: key,
          costCode: line.costCode,
          costType: line.costType,
          description: "",
          originalBudget: 0,
          totalActual: 0,
          normalizedActual: 0,
          isBurden: isBurdenCode(line.costCode),
          normalizedOutContributions: [],
        };
        work.set(key, target);
      }
      target.normalizedActual = round2(target.normalizedActual + sign * line.latestCost);
      // Keep the contributions ledger consistent with the effective set.
      if (sign === 1) {
        target.normalizedOutContributions = target.normalizedOutContributions.filter(
          (c) => c.eventId !== ev.eventId,
        );
      } else {
        target.normalizedOutContributions.push({
          eventId: ev.eventId,
          bucket: eff.bucket,
          amount: round2(line.latestCost),
        });
      }
    }
  }

  // 3. Roll up the effective grand totals + the Fee/GL/direct split.
  let grandTotalActual = 0;
  let grandNormalizedActual = 0;
  let burdenTotalActual = 0;
  let feeTotalActual = 0;
  let glTotalActual = 0;
  for (const a of work.values()) {
    grandTotalActual += a.totalActual;
    grandNormalizedActual += a.normalizedActual;
    if (a.isBurden) burdenTotalActual += a.totalActual;
    if (a.costCode === FEE_CODE) feeTotalActual += a.totalActual;
    if (a.costCode === GL_INSURANCE_CODE) glTotalActual += a.totalActual;
  }
  grandTotalActual = round2(grandTotalActual);
  grandNormalizedActual = round2(grandNormalizedActual);
  burdenTotalActual = round2(burdenTotalActual);
  feeTotalActual = round2(feeTotalActual);
  glTotalActual = round2(glTotalActual);

  const baseGrandNormalizedActual = round2(
    input.actuals.reduce((s, a) => s + a.normalizedActual, 0),
  );

  return {
    effectiveActuals: Array.from(work.values()),
    effectiveEvents,
    overrideCount,
    grandTotalActual,
    baseGrandNormalizedActual,
    grandNormalizedActual,
    normalizedDelta: round2(grandNormalizedActual - baseGrandNormalizedActual),
    burdenTotalActual,
    directTotalActual: round2(grandTotalActual - burdenTotalActual),
    feeTotalActual,
    glTotalActual,
  };
}
