"use client";

import { useState, useEffect, useCallback } from "react";
import { getEstimateBindings } from "@/lib/db";
import type { Binding, EstimateBindingRecord } from "@/lib/bindings/types";

// ---------------------------------------------------------------------------
// useEstimateBindings — loads a project's persisted Linked Values bindings at mount
// (Phase 4 — Bindings in the grid). Twin of useEstimateOverrides: a small DB-sync hook
// threaded into page.tsx so a persisted binding applies on reload. On a read failure it
// falls back to NO bindings (the plain computed values), never a half-applied state.
//
// Unlike the append-only override trail, bindings are MUTABLE and undoable: this hook
// OWNS the in-memory `bindings` state and exposes `setBindings` so the SET_BINDING /
// CLEAR_BINDING command path (useCommandDispatch) can flip it optimistically for
// undo/redo while the DB write rides alongside. Stored binding VALUES are never trusted
// — the grid recomputes from source (recomputeLineBindingValues).
// ---------------------------------------------------------------------------

export interface UseEstimateBindingsReturn {
  /** The authored bindings, optimistically mutated by the command path. `[]` until loaded. */
  bindings: Binding[];
  /** Optimistic setter for the SET_BINDING / CLEAR_BINDING command path. */
  setBindings: React.Dispatch<React.SetStateAction<Binding[]>>;
  /** Full persisted records (audit metadata) — for a future Links/Inspector view. */
  records: EstimateBindingRecord[];
  /** Re-fetch from the DB (e.g. after an out-of-band change). */
  refresh: () => void;
}

export function useEstimateBindings(
  projectId: string,
  isLoaded: boolean
): UseEstimateBindingsReturn {
  const [records, setRecords] = useState<EstimateBindingRecord[]>([]);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  useEffect(() => {
    if (!projectId || !isLoaded) return;
    let cancelled = false;

    getEstimateBindings(projectId)
      .then((recs) => {
        if (cancelled) return;
        setRecords(recs);
        setBindings(recs.map((r) => r.binding));
      })
      .catch((err) => {
        if (cancelled) return;
        // Non-fatal: an unreadable bindings list must not break the estimate view.
        // Fall back to no bindings (the plain computed values), never a partial state.
        console.error("Failed to load estimate bindings:", err);
        setRecords([]);
        setBindings([]);
      });

    return () => { cancelled = true; };
  }, [projectId, isLoaded, refreshTick]);

  return { bindings, setBindings, records, refresh };
}
