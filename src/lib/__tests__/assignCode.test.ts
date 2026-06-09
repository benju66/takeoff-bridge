import { describe, it, expect } from "vitest";
import { validateAssignInput, suggestCodesForClassification } from "../assignCode";
import { ESTIMATE_ITEMS_MASTER } from "../mock-data";

// ---------------------------------------------------------------------------
// assignCode.test.ts — Phase 5, slice 5b (B-4 inline assign-and-place).
//
// These cover the PURE decision surface the Flags-tab assign control consumes:
//   - validateAssignInput: empty/whitespace rejected; unknown code rejected; a
//     known ESTIMATE_ITEMS_MASTER code resolves to its canonical itemId.
//   - suggestCodesForClassification: a thin wrapper over getFuzzySuggestions.
//
// The actual row mutation goes through meta.commitCellEdit (the same command the
// grid's suggestion buttons use); its undo fidelity — incl. the 10-field itemId
// cascade and the cross-division moveEffect — is ALREADY proven by
// commandCapture.test.ts, so it is intentionally NOT re-tested here.
// ---------------------------------------------------------------------------

describe("validateAssignInput", () => {
  it("rejects an empty or whitespace-only code", () => {
    expect(validateAssignInput("")).toEqual({ ok: false, error: expect.any(String) });
    expect(validateAssignInput("   ")).toEqual({ ok: false, error: expect.any(String) });
  });

  it("rejects a code that is not in the estimate-items master", () => {
    const res = validateAssignInput("99-9999.999");
    expect(res.ok).toBe(false);
  });

  it("resolves a known code to its canonical itemId (and trims surrounding space)", () => {
    // Pick a real catalog entry so the test tracks the live catalog.
    const knownKey = Object.keys(ESTIMATE_ITEMS_MASTER)[0];
    const expectedItemId = ESTIMATE_ITEMS_MASTER[knownKey].itemId;

    const res = validateAssignInput(knownKey);
    expect(res).toEqual({ ok: true, itemId: expectedItemId });

    // Leading/trailing whitespace is tolerated and stripped.
    expect(validateAssignInput(`  ${knownKey}  `)).toEqual({ ok: true, itemId: expectedItemId });
  });

  it("resolves a specific known concrete code (09-9000.001 Painting)", () => {
    // 09-9000.001 is asserted to exist by commandCapture.test.ts — reuse it here.
    expect(validateAssignInput("09-9000.001")).toEqual({ ok: true, itemId: "09-9000.001" });
  });
});

describe("suggestCodesForClassification", () => {
  it("returns no suggestions for an empty classification", () => {
    expect(suggestCodesForClassification("")).toEqual([]);
  });

  it("returns fuzzy code matches for a classification, capped at the limit", () => {
    const suggestions = suggestCodesForClassification("Interior Painting", 3);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.length).toBeLessThanOrEqual(3);
    // Every suggestion is a real, assignable catalog itemId.
    for (const s of suggestions) {
      expect(validateAssignInput(s.itemId).ok).toBe(true);
    }
  });

  it("honors a custom limit", () => {
    const suggestions = suggestCodesForClassification("Concrete", 1);
    expect(suggestions.length).toBeLessThanOrEqual(1);
  });
});
