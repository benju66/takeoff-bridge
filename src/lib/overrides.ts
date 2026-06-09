/**
 * Pure override-resolution helpers (Phase 4 — Override + Audit Model).
 * Zero React / DB dependencies — testable in isolation, mirroring mergeTakeoff.ts.
 *
 * The `estimate_overrides` table is an append-only audit trail: every "set" and every
 * "revert" is its own immutable row. This module reduces that trail to the ACTIVE
 * override per field that the calc engine (computeTakeoffSummary) consumes. The dollar
 * arithmetic stays in calculations.ts; this is pure data resolution, not financial math.
 */

import { EstimateOverrideRecord, EstimateOverrideMap } from "@/types";

/**
 * Reduces the append-only override trail to the active override per field.
 *
 * - The LATEST row per `field` wins, ranked by `createdAt` (ISO-8601 lexical order ==
 *   chronological order). Input may be in any order — resolution never depends on array
 *   position.
 * - A latest row whose `overrideValue` is null/undefined is a REVERT tombstone: the field
 *   is dropped, so the engine falls back to the computed value.
 * - An `overrideValue` of `0` is a REAL, honored override (INV-3 — explicit zero is never
 *   confused with "no override").
 */
export function reduceLatestActiveOverrides(
  records: EstimateOverrideRecord[]
): EstimateOverrideMap {
  const latest = new Map<string, EstimateOverrideRecord>();
  for (const rec of records) {
    const prev = latest.get(rec.field);
    if (!prev || rec.createdAt > prev.createdAt) {
      latest.set(rec.field, rec);
    }
  }

  const active: EstimateOverrideMap = {};
  for (const [field, rec] of latest) {
    if (rec.overrideValue !== null && rec.overrideValue !== undefined) {
      active[field] = rec.overrideValue;
    }
  }
  return active;
}
