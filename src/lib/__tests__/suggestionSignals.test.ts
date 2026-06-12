/**
 * suggestionSignalsForSave — what the import save records about each primary
 * suggestion (database fidelity Phase 5): accepted / rejected + overridden,
 * derived purely from the confirmed rows vs the immutable suggestions. The
 * conservative contract matters as much as the positive cases: an untouched
 * row and a `none`-tier row produce NO signal — a phantom rejection would
 * downweight a pairing nobody actually declined.
 */
import { describe, it, expect } from "vitest";
import { suggestionSignalsForSave, type MappingSuggestion } from "../importEstimate";
import { RESOLVED_BY } from "../resolvedBy";

const suggestion = (
  rowId: string,
  itemId: string,
  confidence: MappingSuggestion["confidence"] = "history"
): MappingSuggestion => ({ rowId, confidence, itemId, procoreCode: "", candidates: [] });

const row = (
  id: string,
  itemId: string,
  description: string,
  dataFidelity?: "discrete_unit" | "macro_lump_sum"
) => ({ id, itemId, description, dataFidelity });

describe("suggestionSignalsForSave", () => {
  it("confirming the primary suggested code records ONE accepted signal", () => {
    const out = suggestionSignalsForSave(
      [row("r1", "09-2900.001", "Drywall Mystery")],
      new Map([["r1", suggestion("r1", "09-2900.001")]])
    );
    expect(out).toEqual([
      {
        classification: "Drywall Mystery",
        resolvedCode: "09-2900.001",
        resolvedBy: RESOLVED_BY.SUGGESTION_ACCEPTED,
      },
    ]);
  });

  it("confirming a DIFFERENT code records a rejected + overridden pair", () => {
    const out = suggestionSignalsForSave(
      [row("r1", "09-5100.001", "Drywall Mystery")],
      new Map([["r1", suggestion("r1", "09-2900.001")]])
    );
    expect(out).toEqual([
      {
        classification: "Drywall Mystery",
        resolvedCode: "09-2900.001",
        resolvedBy: RESOLVED_BY.SUGGESTION_REJECTED,
      },
      {
        classification: "Drywall Mystery",
        resolvedCode: "09-5100.001",
        resolvedBy: RESOLVED_BY.SUGGESTION_OVERRIDDEN,
      },
    ]);
  });

  it("an UNCONFIRMED row gives no signal — untouched is not an active rejection", () => {
    const out = suggestionSignalsForSave(
      [row("r1", "", "Drywall Mystery")],
      new Map([["r1", suggestion("r1", "09-2900.001")]])
    );
    expect(out).toEqual([]);
  });

  it("a `none`-tier suggestion gives no signal — nothing was suggested to judge", () => {
    const out = suggestionSignalsForSave(
      [row("r1", "09-5100.001", "Hand-mapped Scope")],
      new Map([["r1", suggestion("r1", "", "none")]])
    );
    expect(out).toEqual([]);
  });

  it("the `similar` tier gives no signal — a flat fuzzy shortlist has no distinguished primary to judge", () => {
    // Architect F3: `similar` is "a ranked shortlist a human picks from", and
    // its UI renders equal chips. Picking chip #2 must not manufacture a
    // rejection of chip #1 in the append-only table.
    const out = suggestionSignalsForSave(
      [
        row("r1", "09-5100.001", "Mystery Scope"), // picked a non-first chip
        row("r2", "07-5000.001", "Other Mystery"), // picked exactly the first chip
      ],
      new Map([
        ["r1", suggestion("r1", "09-2900.001", "similar")],
        ["r2", suggestion("r2", "07-5000.001", "similar")],
      ])
    );
    expect(out).toEqual([]);
  });

  it("a combined-marked (lump) row gives no signal — not a clean observation in either direction", () => {
    // Phase 2 quarantines the lump row's confirmation as `user_lump`; its
    // assignment is scope-lumping, not a judgment on the suggested code, so
    // it must not emit a ranking-visible rejection either.
    const out = suggestionSignalsForSave(
      [
        row("r1", "02-4100.001", "Demo & Abatement complete", "macro_lump_sum"), // overrode the primary
        row("r2", "03-3000.001", "Slab on Grade", "macro_lump_sum"), // accepted the primary
      ],
      new Map([
        ["r1", suggestion("r1", "02-4119.001")],
        ["r2", suggestion("r2", "03-3000.001", "bridge")],
      ])
    );
    expect(out).toEqual([]);
  });

  it("rows without a suggestion entry (conforming lines) give no signal", () => {
    const out = suggestionSignalsForSave(
      [row("r1", "09-5100.001", "Conforming Line")],
      new Map()
    );
    expect(out).toEqual([]);
  });

  it("derives per row across a mixed review table", () => {
    const out = suggestionSignalsForSave(
      [
        row("r1", "03-3000.001", "Slab on Grade", "discrete_unit"), // accepted
        row("r2", "09-5100.001", "Drywall Mystery"), // overridden
        row("r3", "", "Left Pending"), // untouched
      ],
      new Map([
        ["r1", suggestion("r1", "03-3000.001", "bridge")],
        ["r2", suggestion("r2", "09-2900.001", "history")],
        ["r3", suggestion("r3", "07-5000.001")],
      ])
    );
    expect(out.map((s) => s.resolvedBy)).toEqual([
      RESOLVED_BY.SUGGESTION_ACCEPTED,
      RESOLVED_BY.SUGGESTION_REJECTED,
      RESOLVED_BY.SUGGESTION_OVERRIDDEN,
    ]);
    expect(out[1]).toMatchObject({ classification: "Drywall Mystery", resolvedCode: "09-2900.001" });
    expect(out[2]).toMatchObject({ classification: "Drywall Mystery", resolvedCode: "09-5100.001" });
  });
});
