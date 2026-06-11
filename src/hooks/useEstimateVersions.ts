"use client";

import { useState, useEffect, useCallback } from "react";
import {
  createEstimateVersion,
  getEstimateVersions,
  submitEstimateVersion,
  withdrawSubmittedVersion,
} from "@/lib/db";
import { ProcessedTakeoffRow } from "@/types";
import { EstimateVersionMeta } from "@/types/db";

// ---------------------------------------------------------------------------
// useEstimateVersions — loads a project's saved estimate versions and exposes
// the version lifecycle actions (Estimate Versioning module): freeze the live
// working copy as a named version, SUBMIT one version as the official bid
// (the single doorway into cost history), and WITHDRAW a submission.
//
// Twin of useEstimateOverrides — a small DB-sync hook threaded into page.tsx.
// The list load is fail-soft (an unreadable list must not break the
// workspace); the ACTIONS throw-through so the panel surfaces real errors and
// never shows an unpersisted version/submission.
// ---------------------------------------------------------------------------

export interface UseEstimateVersionsReturn {
  /** Saved versions, newest first. `[]` until loaded. */
  versions: EstimateVersionMeta[];
  /** Re-fetch the list (also called automatically after every action). */
  refresh: () => void;
  /** Freezes the current working copy as the next numbered version. */
  createVersion: (
    title: string,
    rows: ProcessedTakeoffRow[],
    summary: Record<string, number>
  ) => Promise<EstimateVersionMeta>;
  /** Marks one saved version as the official bid (replaces any prior one). */
  submitVersion: (versionId: string) => Promise<void>;
  /** Un-submits with no replacement — the project has no official bid. */
  withdrawVersion: () => Promise<void>;
  /** createVersion + submitVersion in sequence (a failure between the two
   *  leaves a harmless unsubmitted version). */
  saveAndSubmit: (
    title: string,
    rows: ProcessedTakeoffRow[],
    summary: Record<string, number>
  ) => Promise<void>;
  /** True while any action is in flight (panel disables its buttons). */
  busy: boolean;
}

export function useEstimateVersions(
  projectId: string,
  isLoaded: boolean
): UseEstimateVersionsReturn {
  const [versions, setVersions] = useState<EstimateVersionMeta[]>([]);
  const [busy, setBusy] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  useEffect(() => {
    if (!projectId || !isLoaded) return;
    let cancelled = false;

    getEstimateVersions(projectId)
      .then((list) => {
        if (cancelled) return;
        setVersions(list);
      })
      .catch((err) => {
        if (cancelled) return;
        // Non-fatal: an unreadable version list must not break the workspace.
        console.error("Failed to load estimate versions:", err);
        setVersions([]);
      });

    return () => { cancelled = true; };
  }, [projectId, isLoaded, refreshTick]);

  // Wraps an action with the busy flag and a list refresh on success.
  // Errors propagate to the caller (the panel shows them).
  const runAction = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      setBusy(true);
      try {
        const result = await action();
        refresh();
        return result;
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const createVersion = useCallback(
    (title: string, rows: ProcessedTakeoffRow[], summary: Record<string, number>) =>
      runAction(() => createEstimateVersion(projectId, title, rows, summary)),
    [projectId, runAction]
  );

  const submitVersion = useCallback(
    (versionId: string) => runAction(() => submitEstimateVersion(projectId, versionId)),
    [projectId, runAction]
  );

  const withdrawVersion = useCallback(
    () => runAction(() => withdrawSubmittedVersion(projectId)),
    [projectId, runAction]
  );

  const saveAndSubmit = useCallback(
    (title: string, rows: ProcessedTakeoffRow[], summary: Record<string, number>) =>
      runAction(async () => {
        const version = await createEstimateVersion(projectId, title, rows, summary);
        await submitEstimateVersion(projectId, version.id);
      }),
    [projectId, runAction]
  );

  return { versions, refresh, createVersion, submitVersion, withdrawVersion, saveAndSubmit, busy };
}
