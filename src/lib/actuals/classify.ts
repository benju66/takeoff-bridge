/**
 * Actuals Cost-History — change-event classification.
 *
 * The summary export's Scope/Type/Reason fields are inconsistently cased
 * (`"Fp construction"`, `"Internal (do not send to sub)"`, `"Ahj"`); these
 * functions canonicalize them to the enums in `./types`, then derive the
 * {@link NormalizationBucket} and whether the event's dollars are subtracted
 * from EAC to form the normalized actual.
 *
 * Normalized-out (subtracted) = Owner-Contingency OR Out-of-Scope OR Allowance
 * reconcile OR net-zero Internal reclass. Kept = in-scope FP Contingency/Buyout,
 * in-scope Original Budget changes, no-cost, and (flagged) unclassified events.
 * The net-zero test for Internal reclasses is applied by the engine, which can
 * see the detail lines; this module returns the pre-net-test disposition.
 */

import type {
  ChangeEventScope,
  ChangeEventType,
  ChangeEventReason,
  NormalizationBucket,
} from "./types";

/** Canonicalize the raw `Scope` cell. Blank or `TBD` → `Unclassified`. */
export function canonicalizeScope(raw: unknown): ChangeEventScope {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "in scope") return "In Scope";
  if (s === "out of scope") return "Out of Scope";
  return "Unclassified"; // "" or "TBD" — resolved by a human later
}

/** Canonicalize the raw `Type` cell. */
export function canonicalizeType(raw: unknown): ChangeEventType {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "original budget") return "Original Budget";
  if (s === "fp contingency/buyout") return "FP Contingency/Buyout";
  if (s === "owner contingency") return "Owner Contingency";
  if (s === "allowance") return "Allowance";
  if (s === "no cost") return "No Cost";
  return "Unclassified";
}

/** Canonicalize the raw `Reason` cell across the export's casing variants. */
export function canonicalizeReason(raw: unknown): ChangeEventReason {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "") return "Unclassified";
  if (s.includes("internal")) return "Internal";
  if (s.includes("fp constr")) return "FP Construction";
  if (s.includes("arch")) return "Arch/Eng";
  if (s.includes("owner")) return "Owner Request";
  if (s.includes("winter")) return "Winter Conditions";
  if (s.includes("ahj")) return "AHJ";
  if (s.includes("allowance")) return "Allowance";
  return "Unclassified";
}

/**
 * Disposition of a classified change event, BEFORE the engine's net-zero test
 * for internal reclasses. The engine refines `internal_reclass` →
 * `internal_nonzero` (and flips `isNormalizedOut` to false) when an
 * internal-reason event's detail lines do not net to ~zero.
 */
export interface EventDisposition {
  bucket: NormalizationBucket;
  isNormalizedOut: boolean;
}

/**
 * Classify an event into a normalization bucket from its canonical fields.
 *
 * Order of precedence matters:
 *  1. Internal reason → internal_reclass (engine confirms net-zero).
 *  2. Unclassified scope (blank/TBD) → unclassified (kept, flagged — never
 *     silently in/out, per the plan's classification-completeness risk).
 *  3. Out of Scope OR Owner Contingency type → owner_contingency / out_of_scope (OUT).
 *  4. Allowance type → allowance_reconcile (OUT).
 *  5. No Cost type → no_cost (kept; zero dollars anyway).
 *  6. In-scope FP Contingency/Buyout → fp_buyout (KEPT — the buyout-variance signal).
 *  7. In-scope Original Budget → original_budget (KEPT — original-scope cost).
 *  8. Anything else in-scope → original_budget (KEPT, conservative default).
 */
export function classifyChangeEvent(
  scope: ChangeEventScope,
  type: ChangeEventType,
  reason: ChangeEventReason,
): EventDisposition {
  // 1. Internal reclasses — engine applies the net-zero test.
  if (reason === "Internal") {
    return { bucket: "internal_reclass", isNormalizedOut: true };
  }

  // 2. Unclassified scope — kept but flagged; never silently included/excluded.
  if (scope === "Unclassified") {
    return { bucket: "unclassified", isNormalizedOut: false };
  }

  // 3. Owner-driven / out-of-scope — stripped from original-scope history.
  if (type === "Owner Contingency") {
    return { bucket: "owner_contingency", isNormalizedOut: true };
  }
  if (scope === "Out of Scope") {
    return { bucket: "out_of_scope", isNormalizedOut: true };
  }

  // 4. Allowance reconciliations — stripped (they true-up an allowance, not scope cost).
  if (type === "Allowance") {
    return { bucket: "allowance_reconcile", isNormalizedOut: true };
  }

  // 5. No-cost administrative events — kept, zero effect.
  if (type === "No Cost") {
    return { bucket: "no_cost", isNormalizedOut: false };
  }

  // 6. In-scope FP Contingency/Buyout draws — KEPT (the buyout-variance signal).
  if (type === "FP Contingency/Buyout") {
    return { bucket: "fp_buyout", isNormalizedOut: false };
  }

  // 7 & 8. In-scope Original Budget (and any other in-scope) — KEPT.
  return { bucket: "original_budget", isNormalizedOut: false };
}
