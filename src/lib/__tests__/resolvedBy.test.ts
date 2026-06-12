/**
 * resolvedBy.ts — the documented `resolved_by` vocabulary (fidelity Phase 2).
 * These tests are the CONTRACT future phases extend against: Phase 5 added
 * the suggestion-signal tags HERE, and anything not consciously added to an
 * allowlist stays out of suggestions and price statistics.
 */
import { describe, it, expect } from "vitest";
import {
  RESOLVED_BY,
  TRUSTED_RESOLVED_BY,
  RANKING_RESOLVED_BY,
  type ResolvedBy,
} from "../resolvedBy";

describe("resolved_by vocabulary (fidelity Phases 2 + 5)", () => {
  it("documents every value, including the combined-line tag and the suggestion signals", () => {
    expect(Object.values(RESOLVED_BY).sort()).toEqual(
      [
        "ai",
        "global",
        "seed",
        "user",
        "user_lump",
        "suggestion_accepted",
        "suggestion_rejected",
        "suggestion_overridden",
      ].sort()
    );
  });

  it("the trusted allowlist NEVER includes the lump tag or any signal tag — a signal is not a clean observation", () => {
    expect(TRUSTED_RESOLVED_BY).not.toContain(RESOLVED_BY.USER_LUMP);
    expect(TRUSTED_RESOLVED_BY).not.toContain(RESOLVED_BY.SUGGESTION_ACCEPTED);
    expect(TRUSTED_RESOLVED_BY).not.toContain(RESOLVED_BY.SUGGESTION_REJECTED);
    expect(TRUSTED_RESOLVED_BY).not.toContain(RESOLVED_BY.SUGGESTION_OVERRIDDEN);
    // The four pre-Phase-2 values stay trusted (existing history keeps ranking).
    expect([...TRUSTED_RESOLVED_BY].sort()).toEqual(["ai", "global", "seed", "user"].sort());
  });

  it("the ranking allowlist is the trusted base plus ONLY the rejection signal", () => {
    // suggestion_accepted / suggestion_overridden are each paired with a clean
    // `user` row recording the same pairing — fetching them for ranking would
    // double-count the confirmation. Rejections carry unique downweight signal.
    expect([...RANKING_RESOLVED_BY].sort()).toEqual(
      [...TRUSTED_RESOLVED_BY, RESOLVED_BY.SUGGESTION_REJECTED].sort()
    );
    expect(RANKING_RESOLVED_BY).not.toContain(RESOLVED_BY.USER_LUMP);
    expect(RANKING_RESOLVED_BY).not.toContain(RESOLVED_BY.SUGGESTION_ACCEPTED);
    expect(RANKING_RESOLVED_BY).not.toContain(RESOLVED_BY.SUGGESTION_OVERRIDDEN);
  });

  it("the allowlists are fail-safe by construction: only documented values can be trusted", () => {
    const documented = new Set<string>(Object.values(RESOLVED_BY));
    for (const value of [...TRUSTED_RESOLVED_BY, ...RANKING_RESOLVED_BY]) {
      expect(documented.has(value)).toBe(true);
    }
    // Type-level guard (compiles = passes): an allowlist entry must be a
    // documented ResolvedBy, so a typo-tag cannot be trusted by accident.
    const _check: readonly ResolvedBy[] = TRUSTED_RESOLVED_BY;
    const _check5: readonly ResolvedBy[] = RANKING_RESOLVED_BY;
    void _check;
    void _check5;
  });
});
