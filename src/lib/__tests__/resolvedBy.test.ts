/**
 * resolvedBy.ts — the documented `resolved_by` vocabulary (fidelity Phase 2).
 * These tests are the CONTRACT future phases extend against: Phase 5 adds
 * suggestion-signal tags HERE, and anything not consciously added to the
 * trusted allowlist stays out of suggestions and price statistics.
 */
import { describe, it, expect } from "vitest";
import { RESOLVED_BY, TRUSTED_RESOLVED_BY, type ResolvedBy } from "../resolvedBy";

describe("resolved_by vocabulary (fidelity Phase 2)", () => {
  it("documents every value, including the combined-line tag", () => {
    expect(Object.values(RESOLVED_BY).sort()).toEqual(
      ["ai", "global", "seed", "user", "user_lump"].sort()
    );
  });

  it("the trusted allowlist NEVER includes the lump tag — recorded, but no suggestion or price stat counts it", () => {
    expect(TRUSTED_RESOLVED_BY).not.toContain(RESOLVED_BY.USER_LUMP);
    // The four pre-Phase-2 values stay trusted (existing history keeps ranking).
    expect([...TRUSTED_RESOLVED_BY].sort()).toEqual(["ai", "global", "seed", "user"].sort());
  });

  it("the allowlist is fail-safe by construction: only documented values can be trusted", () => {
    const documented = new Set<string>(Object.values(RESOLVED_BY));
    for (const value of TRUSTED_RESOLVED_BY) {
      expect(documented.has(value)).toBe(true);
    }
    // Type-level guard (compiles = passes): an allowlist entry must be a
    // documented ResolvedBy, so a typo-tag cannot be trusted by accident.
    const _check: readonly ResolvedBy[] = TRUSTED_RESOLVED_BY;
    void _check;
  });
});
