/**
 * catalogLifecycle — pure lifecycle rules for custom GC/Site-Ops codes
 * (Catalog Manager Phase 1). Transition validation, the chain-collapse sweep,
 * and the render-time merge-redirect follower with its hop guard. No DB, no
 * dollars: a code is a label and a resolver target only.
 */
import { describe, it, expect } from "vitest";
import {
  statusOf,
  isActive,
  transitionError,
  redirectsToRepoint,
  resolveMergeTarget,
  type LifecycleDef,
} from "../catalogLifecycle";

const def = (over: Partial<LifecycleDef> & { code: string }): LifecycleDef => ({ ...over });

describe("statusOf / isActive", () => {
  it("treats an absent status as active (every legacy row degrades unchanged)", () => {
    expect(statusOf({ code: "01-0410.002" })).toBe("active");
    expect(isActive({ code: "01-0410.002" })).toBe(true);
    expect(statusOf({ code: "x", status: "retired" })).toBe("retired");
    expect(isActive({ code: "x", status: "merged", mergedInto: "y" })).toBe(false);
  });
});

describe("transitionError", () => {
  const winnerActive = () => true;

  it("allows active → retired (no winner)", () => {
    expect(transitionError(def({ code: "a" }), "retired", null, winnerActive)).toBeNull();
  });

  it("allows active → merged into an active winner that is not itself", () => {
    expect(transitionError(def({ code: "a" }), "merged", "b", winnerActive)).toBeNull();
  });

  it("rejects transitioning a code that is not active (no un-retire, no re-merge)", () => {
    expect(transitionError(def({ code: "a", status: "retired" }), "merged", "b", winnerActive)).toMatch(
      /is retired; only active codes/
    );
    expect(
      transitionError(def({ code: "a", status: "merged", mergedInto: "b" }), "retired", null, winnerActive)
    ).toMatch(/is merged; only active codes/);
  });

  it("rejects a retired code that carries a merge target", () => {
    expect(transitionError(def({ code: "a" }), "retired", "b", winnerActive)).toMatch(
      /retired code carries no merge target/
    );
  });

  it("rejects a merge with no winner, into itself, or into a non-active winner", () => {
    expect(transitionError(def({ code: "a" }), "merged", "  ", winnerActive)).toMatch(/requires a winning code/);
    expect(transitionError(def({ code: "a" }), "merged", "a", winnerActive)).toMatch(/cannot be merged into itself/);
    expect(transitionError(def({ code: "a" }), "merged", "b", () => false)).toMatch(
      /Merge target b must be an active/
    );
  });

  it("rejects an illegal target status outright", () => {
    expect(transitionError(def({ code: "a" }), "active", null, winnerActive)).toMatch(/Cannot transition/);
  });
});

describe("redirectsToRepoint (chain-collapse sweep)", () => {
  it("returns every def currently merged into the code being merged away", () => {
    const defs: LifecycleDef[] = [
      { code: "x1", status: "merged", mergedInto: "X" },
      { code: "x2", status: "merged", mergedInto: "X" },
      { code: "y1", status: "merged", mergedInto: "Y" }, // points elsewhere
      { code: "r", status: "retired" }, // not a redirect
      { code: "a" }, // active
    ];
    expect(redirectsToRepoint(defs, "X").sort()).toEqual(["x1", "x2"]);
    expect(redirectsToRepoint(defs, "Z")).toEqual([]);
  });
});

describe("resolveMergeTarget (render-time follower + hop guard)", () => {
  const map = (defs: LifecycleDef[]) => new Map(defs.map((d) => [d.code, d]));

  it("returns an active or retired def as itself", () => {
    const byCode = map([{ code: "a" }, { code: "r", status: "retired" }]);
    expect(resolveMergeTarget(byCode.get("a")!, byCode)?.code).toBe("a");
    expect(resolveMergeTarget(byCode.get("r")!, byCode)?.code).toBe("r");
    expect(resolveMergeTarget(null, byCode)).toBeNull();
  });

  it("follows a one-hop merge to its winner", () => {
    const byCode = map([
      { code: "x", status: "merged", mergedInto: "y" },
      { code: "y" },
    ]);
    expect(resolveMergeTarget(byCode.get("x")!, byCode)?.code).toBe("y");
  });

  it("tolerates an accidental chain via the hop guard (chain-collapse normally prevents it)", () => {
    const byCode = map([
      { code: "x", status: "merged", mergedInto: "y" },
      { code: "y", status: "merged", mergedInto: "z" },
      { code: "z" },
    ]);
    expect(resolveMergeTarget(byCode.get("x")!, byCode)?.code).toBe("z");
  });

  it("never loops on a cycle — the guard breaks out", () => {
    const byCode = map([
      { code: "x", status: "merged", mergedInto: "y" },
      { code: "y", status: "merged", mergedInto: "x" },
    ]);
    // No infinite loop; returns one of the cycle members, not a hang.
    expect(["x", "y"]).toContain(resolveMergeTarget(byCode.get("x")!, byCode, 4)?.code);
  });

  it("resolves nothing for a merged def with no winner (corrupt)", () => {
    const byCode = map([{ code: "x", status: "merged", mergedInto: null }]);
    expect(resolveMergeTarget(byCode.get("x")!, byCode)).toBeNull();
  });

  it("keeps labeling under the merged code when its winner is unknown", () => {
    const byCode = map([{ code: "x", status: "merged", mergedInto: "gone" }]);
    expect(resolveMergeTarget(byCode.get("x")!, byCode)?.code).toBe("x");
  });
});
