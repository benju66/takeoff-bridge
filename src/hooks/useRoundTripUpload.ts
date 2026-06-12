"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import type { ProcessedTakeoffRow, ApplyRoundTripCommand } from "@/types";
import type { Project } from "@/types/db";
import type { TakeoffSummary, PersonnelCalcResult, SiteOpsCalcResult } from "@/lib/calculations";
import {
  extractRoundTrip,
  computeRoundTripDelta,
  assertRoundTripAllowed,
  type RoundTripDelta,
} from "@/lib/roundTrip";
import type { RoundTripStamp, RoundTripState } from "@/lib/roundTripStamp";
import { buildRoundTripBaseline } from "@/lib/exporter";
import {
  planRoundTripApply,
  isWorkingCopyCaptured,
  rowsEqualForVersionCapture,
  type RoundTripApplyPlan,
  type RoundTripDialSnapshots,
} from "@/lib/applyRoundTrip";
import { summaryNumbers } from "@/lib/calculations";
import { createEstimateVersion, getEstimateVersions, getEstimateVersionDetail } from "@/lib/db";

// ---------------------------------------------------------------------------
// useRoundTripUpload — the Excel re-upload confirm flow (round-trip Phase 6).
//
// Owns: file → extract → gate → three-way delta → live re-plan on conflict
// acknowledgment → confirm = "Pre-upload baseline" version (if the working
// copy isn't already captured) → ONE ApplyRoundTripCommand → post-apply
// version titled from the file. All math/planning is pure (roundTrip.ts /
// applyRoundTrip.ts); this hook only sequences it.
// ---------------------------------------------------------------------------

export interface RoundTripPreviewData {
  fileName: string;
  stamp: RoundTripStamp;
  excel: RoundTripState;
  delta: RoundTripDelta;
  /** Extraction problems (su tri-cell disagreement, non-numeric cells…). */
  issues: string[];
  /** Frozen at upload time: what the user previews is EXACTLY what confirm
   *  applies — live dial/row identity churn must not silently re-plan
   *  underneath the open modal. */
  rowsSnapshot: ProcessedTakeoffRow[];
  dialsSnapshot: RoundTripDialSnapshots;
}

export interface UseRoundTripUploadArgs {
  projectId: string;
  project: Project | null;
  /** FULL unfiltered working copy + its engine summary (version payloads —
   *  same rule as VersionsPanel/the export gate). */
  rows: ProcessedTakeoffRow[];
  summary: TakeoffSummary;
  gcCalcResult: PersonnelCalcResult;
  siteOpsCalcResult: SiteOpsCalcResult;
  /** Live dial snapshots (page hooks) — the planner's `prev` values. */
  dials: RoundTripDialSnapshots;
  /** workbook.applyRoundTripCommand — one push, one Ctrl+Z. */
  applyRoundTripCommand: (cmd: ApplyRoundTripCommand) => void;
}

export interface UseRoundTripUploadReturn {
  /** Non-null while the preview modal should be open. */
  preview: RoundTripPreviewData | null;
  /** The current plan (re-planned live when acknowledgment toggles). */
  plan: RoundTripApplyPlan | null;
  uploadError: string | null;
  clearUploadError: () => void;
  acknowledged: boolean;
  setAcknowledged: (v: boolean) => void;
  busy: boolean;
  /** Post-apply version failed (apply itself succeeded — undo still works). */
  postVersionWarning: string | null;
  handleUploadFile: (file: File) => Promise<void>;
  confirmApply: () => Promise<void>;
  cancel: () => void;
}

export function useRoundTripUpload(args: UseRoundTripUploadArgs): UseRoundTripUploadReturn {
  const {
    projectId, project, rows, summary,
    gcCalcResult, siteOpsCalcResult, dials, applyRoundTripCommand,
  } = args;

  const [preview, setPreview] = useState<RoundTripPreviewData | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [postVersionWarning, setPostVersionWarning] = useState<string | null>(null);
  /** Title of the post-apply version awaiting the settled re-render. */
  const [pendingPostVersion, setPendingPostVersion] = useState<string | null>(null);

  // Live refs so the post-apply effect freezes the SETTLED state (the apply's
  // batched updates re-render — and this ref-sync effect runs — before the
  // post-version effect below reads them).
  const rowsRef = useRef(rows);
  const summaryRef = useRef(summary);
  useEffect(() => {
    rowsRef.current = rows;
    summaryRef.current = summary;
  });

  // The plan re-derives ONLY when the user toggles conflict acknowledgment
  // (locked decision 3) — it runs over the upload-time snapshots, so what
  // the modal shows is what confirm applies.
  const plan = useMemo<RoundTripApplyPlan | null>(() => {
    if (!preview || !project) return null;
    return planRoundTripApply({
      delta: preview.delta,
      excel: preview.excel,
      currentRows: preview.rowsSnapshot,
      dials: preview.dialsSnapshot,
      project,
      sourceLabel: preview.fileName,
      applyConflicts: acknowledged,
    });
  }, [preview, project, acknowledged]);

  const handleUploadFile = useCallback(async (file: File) => {
    if (!project) return;
    setUploadError(null);
    setPostVersionWarning(null);
    setAcknowledged(false);
    setBusy(true);
    try {
      const buffer = await file.arrayBuffer();
      const { stamp, state, issues } = await extractRoundTrip(buffer);
      assertRoundTripAllowed(stamp, project);
      // Current app state in the SAME shape as the stamp baseline — the
      // exporter's own builder guarantees field-for-field comparability.
      const current = buildRoundTripBaseline(
        rows, project, gcCalcResult, siteOpsCalcResult, summary.totalEstimatedCost
      );
      const delta = computeRoundTripDelta(state, stamp.baseline, current);
      setPreview({
        fileName: file.name, stamp, excel: state, delta, issues,
        rowsSnapshot: rows, dialsSnapshot: dials,
      });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "The file could not be read as an exported estimate workbook.");
    } finally {
      setBusy(false);
    }
  }, [project, rows, dials, gcCalcResult, siteOpsCalcResult, summary.totalEstimatedCost]);

  const confirmApply = useCallback(async () => {
    if (!plan || !preview || plan.isEmpty) return;
    setBusy(true);
    setUploadError(null);
    try {
      // 1. Safety net BEFORE any mutation (locked decision 2): if the working
      //    copy isn't captured by the newest version, freeze it. A failure
      //    here ABORTS the apply — never mutate without the baseline. The
      //    summary check is a cheap proxy; when it passes, the newest
      //    version's frozen ROWS must also match (description/code edits
      //    move no totals but would be unrecoverable after a reload).
      const numbers = summaryNumbers(summary);
      const versions = await getEstimateVersions(projectId);
      let captured = isWorkingCopyCaptured(versions[0], numbers);
      if (captured) {
        try {
          const detail = await getEstimateVersionDetail(versions[0].id);
          captured = !!detail && rowsEqualForVersionCapture(rows, detail.lineItems);
        } catch {
          captured = false; // can't verify rows ⇒ create the baseline (safe)
        }
      }
      if (!captured) {
        await createEstimateVersion(projectId, "Pre-upload baseline", rows, numbers);
      }
      // 2. ONE undoable command (rows + dials).
      applyRoundTripCommand(plan.command);
      // 3. Post-apply version once the batched updates have re-rendered
      //    (effect below) — title from the uploaded file.
      setPendingPostVersion(`Excel re-upload — ${preview.fileName}`);
      setPreview(null);
      setAcknowledged(false);
    } catch (err) {
      setUploadError(
        err instanceof Error
          ? `Upload not applied — the pre-upload baseline version could not be created: ${err.message}`
          : "Upload not applied — the pre-upload baseline version could not be created."
      );
    } finally {
      setBusy(false);
    }
  }, [plan, preview, projectId, rows, summary, applyRoundTripCommand]);

  // Post-apply version: runs after the apply's render committed, so the refs
  // hold the SETTLED rows + recomputed summary. Failure is a warning, not a
  // rollback — the apply already has one-step undo and the audit trail.
  useEffect(() => {
    if (!pendingPostVersion) return;
    let cancelled = false;
    const title = pendingPostVersion;
    createEstimateVersion(projectId, title, rowsRef.current, summaryNumbers(summaryRef.current))
      .catch((err) => {
        console.error("Post-apply version failed:", err);
        if (!cancelled) {
          setPostVersionWarning(
            `Changes applied, but the "${title}" version could not be saved: ${err instanceof Error ? err.message : "unknown error"}`
          );
        }
      })
      .finally(() => {
        if (!cancelled) setPendingPostVersion(null);
      });
    return () => { cancelled = true; };
  }, [pendingPostVersion, projectId]);

  const cancel = useCallback(() => {
    setPreview(null);
    setAcknowledged(false);
  }, []);

  const clearUploadError = useCallback(() => setUploadError(null), []);

  return {
    preview, plan, uploadError, clearUploadError,
    acknowledged, setAcknowledged, busy, postVersionWarning,
    handleUploadFile, confirmApply, cancel,
  };
}
