"use client";

import { useState, useEffect, useCallback } from "react";
import { getEstimateOverrides } from "@/lib/db";
import { reduceLatestActiveOverrides } from "@/lib/overrides";
import { EstimateOverrideRecord, EstimateOverrideMap } from "@/types";

// ---------------------------------------------------------------------------
// useEstimateOverrides — loads the append-only override audit trail for a project
// and exposes the resolved ACTIVE overrides for the calc engine (Phase 4 — Override
// + Audit Model). Read-only here: the glass-box UI that SETS an override
// (db.recordEstimateOverride + refresh) is Phase 5.
//
// Twin of useRateCardSnapshot — a small DB-sync hook threaded into page.tsx so a
// persisted override applies on reload. On a read failure it falls back to NO
// overrides (the computed values), never a half-applied state.
// ---------------------------------------------------------------------------

export interface UseEstimateOverridesReturn {
  /** Active field → override value, fed to computeTakeoffSummary. `{}` until loaded. */
  activeOverrides: EstimateOverrideMap;
  /** Full append-only trail, newest first (Phase 5 audit log). */
  overrideRecords: EstimateOverrideRecord[];
  /** Re-fetch after a new override is recorded (Phase 5 setter UI). */
  refresh: () => void;
}

export function useEstimateOverrides(
  projectId: string,
  isLoaded: boolean
): UseEstimateOverridesReturn {
  const [overrideRecords, setOverrideRecords] = useState<EstimateOverrideRecord[]>([]);
  const [activeOverrides, setActiveOverrides] = useState<EstimateOverrideMap>({});
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  useEffect(() => {
    if (!projectId || !isLoaded) return;
    let cancelled = false;

    getEstimateOverrides(projectId)
      .then((records) => {
        if (cancelled) return;
        setOverrideRecords(records);
        setActiveOverrides(reduceLatestActiveOverrides(records));
      })
      .catch((err) => {
        if (cancelled) return;
        // Non-fatal: an unreadable override trail must not break the estimate view.
        // Fall back to no overrides (the computed values), never a half-applied state.
        console.error("Failed to load estimate overrides:", err);
        setOverrideRecords([]);
        setActiveOverrides({});
      });

    return () => { cancelled = true; };
  }, [projectId, isLoaded, refreshTick]);

  return { activeOverrides, overrideRecords, refresh };
}
