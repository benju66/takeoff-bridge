/**
 * resolvedBy.ts — THE documented vocabulary for `classification_history.resolved_by`
 * (database fidelity Phase 2).
 *
 * The column is free text in the database, so this module is the single source
 * of truth for what may be written to it. Every write routes through ONE db.ts
 * helper (`recordClassificationResolution`), whose parameter is typed against
 * this vocabulary — a typo-tag cannot compile. Future phases (Phase 5 records
 * accepted/rejected/overridden suggestion signals) MUST extend this vocabulary,
 * never invent values elsewhere (named risk in docs/plans/database-fidelity.md).
 *
 * Record everything, tagged; never discard (architect-locked 2026-06-10): a
 * "combined" line's confirmation is still a real observation — it enters the
 * append-only table tagged `user_lump` and is excluded on the READ side only.
 * Its line item carries the paired `data_fidelity='macro_lump_sum'` flag.
 */

/** Every value `classification_history.resolved_by` may carry. */
export const RESOLVED_BY = {
  /** Estimator confirmed the code by hand — workspace itemId edit or an
   *  import-review confirmation on an ordinary (discrete-unit) line. */
  USER: "user",
  /** Resolved automatically from the global corporate registry. */
  GLOBAL: "global",
  /** CSV takeoff import auto-mapping. */
  SEED: "seed",
  /** Future AI classification tier (reserved; nothing writes it yet). */
  AI: "ai",
  /** Estimator confirmed the code on a line marked "combined" at the import
   *  review gate — one price lumping several scopes. The pairing is recorded
   *  (future ML can still use it) but it is NOT a clean unit observation, so
   *  trusted reads exclude it from suggestions and price statistics. */
  USER_LUMP: "user_lump",
} as const;

export type ResolvedBy = (typeof RESOLVED_BY)[keyof typeof RESOLVED_BY];

/**
 * The values suggestion ranking and history mining TRUST as clean signal.
 * Deliberately an ALLOWLIST: an unknown or misspelled tag is excluded by
 * default (fail-safe), and every value a future phase adds stays out of
 * suggestions and price statistics until it is consciously added here.
 */
export const TRUSTED_RESOLVED_BY: readonly ResolvedBy[] = [
  RESOLVED_BY.USER,
  RESOLVED_BY.GLOBAL,
  RESOLVED_BY.SEED,
  RESOLVED_BY.AI,
];
