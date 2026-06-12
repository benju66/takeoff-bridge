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

  // ── Suggestion signals (database fidelity Phase 5) ──────────────────────
  // What the estimator DID with the import gate's primary suggestion, written
  // ALONGSIDE the clean `user`/`user_lump` observation at save (never instead
  // of it). Accepted/overridden therefore stay OUT of TRUSTED_RESOLVED_BY —
  // counting them would double-count the paired clean row. They exist as the
  // training signal a future ML tier needs and that cannot be backfilled.

  /** The estimator confirmed the engine's primary suggested code as-is. */
  SUGGESTION_ACCEPTED: "suggestion_accepted",
  /** The engine's primary suggested code was DECLINED — the estimator
   *  actively chose a different code. Recorded against the rejected code;
   *  ranking downweights the pairing (RANKING_RESOLVED_BY). A row saved with
   *  its suggestion simply untouched is NOT a rejection — only an active
   *  different choice is. Combined-marked lines and flat `similar` shortlists
   *  never emit signals at all (suggestionSignalsForSave's conservatism). */
  SUGGESTION_REJECTED: "suggestion_rejected",
  /** The code the estimator chose INSTEAD of the rejected primary — always
   *  written paired with a `suggestion_rejected` row for the same line. */
  SUGGESTION_OVERRIDDEN: "suggestion_overridden",
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

/**
 * The values the suggestion-ranking read fetches (db.ts
 * getClassificationHistoryBulk → suggestionRanking.ts): the trusted base
 * counts PLUS rejection signals, which downweight a pairing without ever
 * counting as a confirmation. `suggestion_accepted` / `suggestion_overridden`
 * are deliberately absent — each is paired with a clean `user` row recording
 * the same pairing, so fetching them would double-count. Same allowlist
 * philosophy as TRUSTED_RESOLVED_BY: unknown tags stay excluded by default.
 */
export const RANKING_RESOLVED_BY: readonly ResolvedBy[] = [
  ...TRUSTED_RESOLVED_BY,
  RESOLVED_BY.SUGGESTION_REJECTED,
];
