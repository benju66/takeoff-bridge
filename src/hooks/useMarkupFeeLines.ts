"use client";

import { useEffect, useState } from "react";
import type { EstimateSectionLine } from "@/types/db";

// ---------------------------------------------------------------------------
// useMarkupFeeLines — owns the MUTABLE Division 60 markup fee-line state (Phase 4).
//
// Twin of useEstimateBindings: a fee line, like a binding, is loaded from the DB
// (here split out by useProjectWorkspace into `persistedMarkupLines`) yet must be
// MUTABLE + undoable. Phase 3 held the loaded lines read-only; Phase 4 lifts them into
// this hook so an insert/delete/edit re-renders, re-feeds the engine total, and
// re-saves through `save_section_lines`. The page owns this state and threads
// `setMarkupLines` into useTakeoffWorkbook so the INSERT_FEE_LINE / DELETE_FEE_LINE /
// EDIT_FEE_LINE command path (useCommandDispatch) flips it optimistically for undo/redo
// while the debounced save rides alongside.
//
// SEED + RESET: state seeds from `persistedMarkupLines` and re-seeds whenever it changes
// — which happens only on project load / change (useProjectWorkspace sets it once per
// load), NOT on a fee edit (that mutates this hook's state, leaving `persistedMarkupLines`
// untouched). So live edits are never clobbered, and a real reload reloads from the DB.
// ---------------------------------------------------------------------------

export interface UseMarkupFeeLinesReturn {
  /** The live markup fee lines, optimistically mutated by the command path. */
  markupLines: EstimateSectionLine[];
  /** Optimistic setter for the INSERT/DELETE/EDIT_FEE_LINE command path. */
  setMarkupLines: React.Dispatch<React.SetStateAction<EstimateSectionLine[]>>;
}

export function useMarkupFeeLines(
  persistedMarkupLines: EstimateSectionLine[],
): UseMarkupFeeLinesReturn {
  const [markupLines, setMarkupLines] = useState<EstimateSectionLine[]>(persistedMarkupLines);

  // Re-seed on load / project change. `persistedMarkupLines` is referentially stable
  // between loads (a constant empty array or a once-set filtered array), so this fires
  // only when a fresh load arrives — never on a live edit.
  useEffect(() => {
    setMarkupLines(persistedMarkupLines);
  }, [persistedMarkupLines]);

  return { markupLines, setMarkupLines };
}
