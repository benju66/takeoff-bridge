/**
 * suggestionRanking — pure signal-aware ranking (database fidelity Phase 5).
 *
 * The contract under test: Phase 3's count-ranking is the BASE and must be
 * preserved exactly for clean, signal-free data (the before/after regression);
 * signals layer on top — distinct-project dedupe, rejection downweights,
 * recency tiebreaks — and lifecycle resolution (Catalog Manager) refiles
 * merged codes under their winner and drops retired codes BEFORE any scoring.
 */
import { describe, it, expect } from "vitest";
import {
  rankClassificationHistory,
  REJECTION_DOWNWEIGHT,
  type ClassificationObservation,
} from "../suggestionRanking";
import { RESOLVED_BY } from "../resolvedBy";
import type { LifecycleDef } from "../catalogLifecycle";

/** Observation with quiet defaults: trusted `user`, no project, no timestamp. */
const obs = (
  classification: string,
  resolvedCode: string,
  over: Partial<ClassificationObservation> = {}
): ClassificationObservation => ({
  classification,
  resolvedCode,
  resolvedBy: RESOLVED_BY.USER,
  projectId: null,
  createdAt: "",
  ...over,
});

const codesOf = (
  out: Map<string, { resolvedCode: string; count: number }[]>,
  cls: string
) => (out.get(cls) ?? []).map((s) => s.resolvedCode);

describe("rankClassificationHistory — before/after base regression", () => {
  it("signal-free data ranks EXACTLY like the Phase 3 base: count desc, then code asc", () => {
    const out = rankClassificationHistory([
      obs("Plumbing", "22-0000.001", { projectId: "p1" }),
      obs("Plumbing", "22-0000.001", { projectId: "p2" }),
      obs("Plumbing", "22-1000.001", { projectId: "p3" }),
      // Equal counts → deterministic code order breaks the tie.
      obs("Roofing", "07-5000.002", { projectId: "p1" }),
      obs("Roofing", "07-5000.001", { projectId: "p2" }),
    ]);

    expect(out.get("Plumbing")).toEqual([
      { resolvedCode: "22-0000.001", count: 2 },
      { resolvedCode: "22-1000.001", count: 1 },
    ]);
    expect(out.get("Roofing")).toEqual([
      { resolvedCode: "07-5000.001", count: 1 },
      { resolvedCode: "07-5000.002", count: 1 },
    ]);
    expect(out.has("Never Seen")).toBe(false); // absent, not an empty entry
  });

  it("rows with no project identity collapse to ONE observation (deleted-project residue stays bounded)", () => {
    // classification_history keeps a deleted project's rows with project_id
    // SET NULL (Phase 4 finding). Counting them per-row would let deletion
    // INFLATE a pairing from its deduped ×1 back to raw ×N.
    const out = rankClassificationHistory([
      obs("Plumbing", "22-0000.001"),
      obs("Plumbing", "22-0000.001"),
      obs("Plumbing", "22-0000.001"),
      obs("Plumbing", "22-1000.001", { projectId: "p1" }),
      obs("Plumbing", "22-1000.001", { projectId: "p2" }),
    ]);
    expect(out.get("Plumbing")).toEqual([
      { resolvedCode: "22-1000.001", count: 2 },
      { resolvedCode: "22-0000.001", count: 1 },
    ]);
  });
});

describe("rankClassificationHistory — distinct-project dedupe", () => {
  it("repeat observations from the SAME project count once", () => {
    const out = rankClassificationHistory([
      // One bid re-imported (or one bid with three identical lines): still ×1.
      obs("Plumbing", "22-0000.001", { projectId: "p1" }),
      obs("Plumbing", "22-0000.001", { projectId: "p1" }),
      obs("Plumbing", "22-0000.001", { projectId: "p1" }),
      obs("Plumbing", "22-1000.001", { projectId: "p1" }),
      obs("Plumbing", "22-1000.001", { projectId: "p2" }),
    ]);
    // The twice-projected code now outranks the thrice-repeated one.
    expect(out.get("Plumbing")).toEqual([
      { resolvedCode: "22-1000.001", count: 2 },
      { resolvedCode: "22-0000.001", count: 1 },
    ]);
  });
});

describe("rankClassificationHistory — rejection downweight (THE Phase 5 exit test)", () => {
  it("a repeatedly-rejected pairing stops being suggested first", () => {
    const rejected = { resolvedBy: RESOLVED_BY.SUGGESTION_REJECTED };
    const out = rankClassificationHistory([
      // Historically the favorite: confirmed in two bids…
      obs("Mystery Scope", "09-2900.001", { projectId: "p1" }),
      obs("Mystery Scope", "09-2900.001", { projectId: "p2" }),
      // …but the team has since actively declined it in three bids.
      obs("Mystery Scope", "09-2900.001", { ...rejected, projectId: "p3" }),
      obs("Mystery Scope", "09-2900.001", { ...rejected, projectId: "p4" }),
      obs("Mystery Scope", "09-2900.001", { ...rejected, projectId: "p5" }),
      // The single-confirmation competitor.
      obs("Mystery Scope", "09-5100.001", { projectId: "p3" }),
    ]);

    expect(codesOf(out, "Mystery Scope")).toEqual(["09-5100.001", "09-2900.001"]);
    // The badge stays the honest confirmation count — rejections reorder, they
    // don't rewrite history.
    expect(out.get("Mystery Scope")).toEqual([
      { resolvedCode: "09-5100.001", count: 1 },
      { resolvedCode: "09-2900.001", count: 2 },
    ]);
  });

  it("a SINGLE rejection does not overturn a well-confirmed pairing (conservative)", () => {
    expect(REJECTION_DOWNWEIGHT).toBe(1); // one distinct-project rejection cancels one confirmation
    const out = rankClassificationHistory([
      obs("Plumbing", "22-0000.001", { projectId: "p1" }),
      obs("Plumbing", "22-0000.001", { projectId: "p2" }),
      obs("Plumbing", "22-0000.001", { projectId: "p3" }),
      obs("Plumbing", "22-0000.001", { resolvedBy: RESOLVED_BY.SUGGESTION_REJECTED, projectId: "p4" }),
      obs("Plumbing", "22-1000.001", { projectId: "p4" }),
    ]);
    expect(codesOf(out, "Plumbing")).toEqual(["22-0000.001", "22-1000.001"]);
  });

  it("dedupes rejections per project and never surfaces a rejection-only pairing", () => {
    const out = rankClassificationHistory([
      // Same project rejecting the same pairing on two lines = ONE rejection…
      obs("Plumbing", "22-0000.001", { resolvedBy: RESOLVED_BY.SUGGESTION_REJECTED, projectId: "p9" }),
      obs("Plumbing", "22-0000.001", { resolvedBy: RESOLVED_BY.SUGGESTION_REJECTED, projectId: "p9" }),
      obs("Plumbing", "22-0000.001", { projectId: "p1" }),
      obs("Plumbing", "22-0000.001", { projectId: "p2" }),
      obs("Plumbing", "22-1000.001", { projectId: "p3" }),
      // …and a pairing nobody ever CONFIRMED never appears, however rejected.
      obs("Plumbing", "23-0000.001", { resolvedBy: RESOLVED_BY.SUGGESTION_REJECTED, projectId: "p1" }),
    ]);
    expect(codesOf(out, "Plumbing")).toEqual(["22-0000.001", "22-1000.001"]);
  });

  it("a project that both confirmed AND rejected a pairing nets to zero for it (mixed verdicts)", () => {
    // One bid, two lines with the same description: the estimator accepted
    // suggested X on one and overrode X→Y on the other. X carries that
    // project's confirmation and its rejection (net 0); Y carries a clean
    // confirmation — the deliberate override choice ranks first.
    const out = rankClassificationHistory([
      obs("Misc Steel", "05-1000.001", { projectId: "p1" }),
      obs("Misc Steel", "05-1000.001", { resolvedBy: RESOLVED_BY.SUGGESTION_REJECTED, projectId: "p1" }),
      obs("Misc Steel", "05-5000.001", { projectId: "p1" }),
    ]);
    expect(out.get("Misc Steel")).toEqual([
      { resolvedCode: "05-5000.001", count: 1 },
      { resolvedCode: "05-1000.001", count: 1 },
    ]);
  });

  it("rejections with no project identity collapse to ONE downweight (deleted projects never amplify)", () => {
    const out = rankClassificationHistory([
      // A deleted bid's 3 rejected rows (project_id SET NULL) = one rejection…
      obs("Plumbing", "22-0000.001", { resolvedBy: RESOLVED_BY.SUGGESTION_REJECTED }),
      obs("Plumbing", "22-0000.001", { resolvedBy: RESOLVED_BY.SUGGESTION_REJECTED }),
      obs("Plumbing", "22-0000.001", { resolvedBy: RESOLVED_BY.SUGGESTION_REJECTED }),
      // …so two live confirmations still outrank the single-bid competitor.
      obs("Plumbing", "22-0000.001", { projectId: "p1" }),
      obs("Plumbing", "22-0000.001", { projectId: "p2" }),
      obs("Plumbing", "22-1000.001", { projectId: "p3" }),
    ]);
    expect(codesOf(out, "Plumbing")).toEqual(["22-0000.001", "22-1000.001"]);
  });
});

describe("rankClassificationHistory — recency tiebreak", () => {
  it("equal scores rank the more recently confirmed pairing first", () => {
    const out = rankClassificationHistory([
      // Code order alone would put .001 first — recency must win the tie.
      obs("Plumbing", "22-0000.001", { projectId: "p1", createdAt: "2024-03-01T00:00:00Z" }),
      obs("Plumbing", "22-1000.001", { projectId: "p2", createdAt: "2026-05-01T00:00:00Z" }),
    ]);
    expect(codesOf(out, "Plumbing")).toEqual(["22-1000.001", "22-0000.001"]);
  });

  it("recency never beats count — it only breaks ties", () => {
    const out = rankClassificationHistory([
      obs("Plumbing", "22-0000.001", { projectId: "p1", createdAt: "2020-01-01T00:00:00Z" }),
      obs("Plumbing", "22-0000.001", { projectId: "p2", createdAt: "2020-06-01T00:00:00Z" }),
      obs("Plumbing", "22-1000.001", { projectId: "p3", createdAt: "2026-06-01T00:00:00Z" }),
    ]);
    expect(codesOf(out, "Plumbing")).toEqual(["22-0000.001", "22-1000.001"]);
  });

  it("unparseable timestamps tie deterministically by code", () => {
    const out = rankClassificationHistory([
      obs("Plumbing", "22-1000.001", { projectId: "p1", createdAt: "not-a-date" }),
      obs("Plumbing", "22-0000.001", { projectId: "p2" }),
    ]);
    expect(codesOf(out, "Plumbing")).toEqual(["22-0000.001", "22-1000.001"]);
  });
});

describe("rankClassificationHistory — lifecycle resolution BEFORE scoring", () => {
  const defs: LifecycleDef[] = [
    { code: "01-0410.900", status: "merged", mergedInto: "01-0410.001" },
    { code: "01-0410.001" }, // active winner (absent status === active)
    { code: "01-0410.901", status: "retired" },
    { code: "01-0410.902", status: "merged", mergedInto: "01-0410.903" },
    { code: "01-0410.903", status: "retired" }, // winner retired AFTER the merge
  ];

  it("refiles a merged code's observations under the winner", () => {
    const out = rankClassificationHistory(
      [
        obs("Site Lead", "01-0410.900", { projectId: "p1" }),
        obs("Site Lead", "01-0410.001", { projectId: "p2" }),
        obs("Site Lead", "09-2900.001", { projectId: "p3" }),
      ],
      defs
    );
    // 2 distinct projects under the WINNER; the merged code itself never appears.
    expect(out.get("Site Lead")).toEqual([
      { resolvedCode: "01-0410.001", count: 2 },
      { resolvedCode: "09-2900.001", count: 1 },
    ]);
  });

  it("dedupes the same project across a merge — refiled and direct rows are one observation", () => {
    const out = rankClassificationHistory(
      [
        obs("Site Lead", "01-0410.900", { projectId: "p1" }),
        obs("Site Lead", "01-0410.001", { projectId: "p1" }),
      ],
      defs
    );
    expect(out.get("Site Lead")).toEqual([{ resolvedCode: "01-0410.001", count: 1 }]);
  });

  it("refiles rejection signals through the merge too", () => {
    const out = rankClassificationHistory(
      [
        obs("Site Lead", "01-0410.001", { projectId: "p1" }),
        obs("Site Lead", "01-0410.900", {
          resolvedBy: RESOLVED_BY.SUGGESTION_REJECTED,
          projectId: "p2",
        }),
        obs("Site Lead", "09-2900.001", { projectId: "p2" }),
      ],
      defs
    );
    // Winner: 1 confirmation − 1 refiled rejection = 0 → ranks below the clean code.
    expect(codesOf(out, "Site Lead")).toEqual(["09-2900.001", "01-0410.001"]);
  });

  it("drops retired codes — and a classification left with nothing is absent", () => {
    const out = rankClassificationHistory(
      [
        obs("Site Lead", "01-0410.901", { projectId: "p1" }),
        obs("Site Lead", "01-0410.901", { projectId: "p2" }),
      ],
      defs
    );
    expect(out.has("Site Lead")).toBe(false);
  });

  it("refiles a merge into a BUILT-IN winner — a winner absent from the custom defs is active by the no-def convention", () => {
    // mergeCustomStep23LineDef legally merges a custom into a built-in def,
    // but the caller's lifecycle overlay only carries CUSTOM rows — the
    // built-in winner is simply absent. Ranking must refile (matching
    // resolveStep23Line, whose lookups include the built-ins), not drop.
    const out = rankClassificationHistory(
      [
        obs("Asst Super", "01-0400.900", { projectId: "p1" }),
        obs("Asst Super", "01-0400.900", { projectId: "p2" }),
      ],
      [{ code: "01-0400.900", status: "merged", mergedInto: "01-0400.002" }]
    );
    expect(out.get("Asst Super")).toEqual([{ resolvedCode: "01-0400.002", count: 2 }]);
  });

  it("fails closed on corrupt lifecycles: merged into a retired winner, no winner, or a cycle is dropped", () => {
    const out = rankClassificationHistory(
      [
        obs("Site Lead", "01-0410.902", { projectId: "p1" }), // winner retired later
        obs("Site Lead", "01-0410.906", { projectId: "p2" }), // merged with no target
        obs("Site Lead", "01-0410.907", { projectId: "p3" }), // redirect cycle
        obs("Site Lead", "01-0410.904", { projectId: "p4" }), // not a def at all → passes through
      ],
      [
        ...defs,
        { code: "01-0410.906", status: "merged", mergedInto: "" },
        { code: "01-0410.907", status: "merged", mergedInto: "01-0410.908" },
        { code: "01-0410.908", status: "merged", mergedInto: "01-0410.907" },
      ]
    );
    expect(out.get("Site Lead")).toEqual([{ resolvedCode: "01-0410.904", count: 1 }]);
  });

  it("without lifecycle defs every code passes through unchanged (fail-soft degrade)", () => {
    const out = rankClassificationHistory([obs("Site Lead", "01-0410.900", { projectId: "p1" })]);
    expect(out.get("Site Lead")).toEqual([{ resolvedCode: "01-0410.900", count: 1 }]);
  });
});

describe("rankClassificationHistory — tag allowlist (fail-safe)", () => {
  it("ignores lump-tagged, accepted/overridden signal, and unknown tags for ranking", () => {
    const out = rankClassificationHistory([
      obs("Plumbing", "22-0000.001", { resolvedBy: RESOLVED_BY.USER_LUMP, projectId: "p1" }),
      obs("Plumbing", "22-0000.001", { resolvedBy: RESOLVED_BY.SUGGESTION_ACCEPTED, projectId: "p2" }),
      obs("Plumbing", "22-0000.001", { resolvedBy: RESOLVED_BY.SUGGESTION_OVERRIDDEN, projectId: "p3" }),
      obs("Plumbing", "22-0000.001", { resolvedBy: "usre-typo", projectId: "p4" }),
      obs("Plumbing", "22-1000.001", { resolvedBy: RESOLVED_BY.USER, projectId: "p5" }),
    ]);
    // Only the genuine trusted row ranks; the accepted/overridden signal rows
    // are each PAIRED with a clean `user` row at save — counting them here
    // would double-count the same confirmation.
    expect(out.get("Plumbing")).toEqual([{ resolvedCode: "22-1000.001", count: 1 }]);
  });
});
