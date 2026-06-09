/**
 * Inline assign-and-place decision logic (Phase 5, slice 5b — B-4: recover an
 * unmapped CSV import row by assigning it a Procore code from inside the Flags tab).
 *
 * Pure: no React, no DB, NO command construction. The Flags-tab control calls these
 * to (1) suggest matching codes for an unmapped row's classification and (2) validate
 * a free-entry code before handing the resolved itemId to the existing command path
 * (`meta.handleCellEdit` + `meta.commitCellEdit` — the SAME pair the grid's fuzzy
 * suggestion buttons use, which already carries the 10-field itemId cascade, the
 * cross-division `moveEffect`, and `pushCommand` for atomic undo/redo). Keeping the
 * decisions here lets them be unit-tested in node — the repo has no DOM harness — and
 * mirrors `overrideSetter.ts` (the slice-4 template): the component is just the I/O shell.
 *
 * The command's undo fidelity (incl. the cross-division moveEffect) is already proven
 * by `commandCapture.test.ts`; this slice does NOT re-test it.
 */

import { ESTIMATE_ITEMS_MASTER } from "@/lib/mock-data";
import { getFuzzySuggestions, SuggestionItem } from "@/lib/similarity";

/** Result of validating a free-entry code against the estimate-items master. */
export type AssignValidation =
  | { ok: true; itemId: string }
  | { ok: false; error: string };

/**
 * Resolve + validate a free-entry code. A code is valid only when it resolves to a
 * known `ESTIMATE_ITEMS_MASTER` entry (the catalog is keyed by itemId, but we also
 * accept a value whose `itemId` matches, so the helper is robust to key/itemId drift).
 * Empty / whitespace-only input is rejected. The returned `itemId` is the canonical
 * code to hand to `commitCellEdit` (never the raw text).
 */
export function validateAssignInput(code: string): AssignValidation {
  const trimmed = code.trim();
  if (trimmed === "") {
    return { ok: false, error: "Enter a code to assign." };
  }
  // Fast path: the catalog is keyed by itemId.
  const direct = ESTIMATE_ITEMS_MASTER[trimmed];
  if (direct) {
    return { ok: true, itemId: direct.itemId };
  }
  // Robust path: a value whose itemId matches (guards against key ≠ itemId drift).
  const match = Object.values(ESTIMATE_ITEMS_MASTER).find((item) => item.itemId === trimmed);
  if (match) {
    return { ok: true, itemId: match.itemId };
  }
  return { ok: false, error: `"${trimmed}" is not a known estimate code.` };
}

/**
 * Top fuzzy code matches for an unmapped row's classification — a thin, testable
 * wrapper over `getFuzzySuggestions(classification, ESTIMATE_ITEMS_MASTER)`, the
 * SAME source the grid's inline Code cell uses for its one-click suggestion chips.
 * Empty classification → `[]`.
 */
export function suggestCodesForClassification(
  classification: string,
  limit = 3
): SuggestionItem[] {
  return getFuzzySuggestions(classification, ESTIMATE_ITEMS_MASTER, limit);
}
