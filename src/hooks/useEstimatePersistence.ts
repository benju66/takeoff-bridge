"use client";

import { useEffect, useRef, useState } from "react";
import { ProcessedTakeoffRow } from "@/types";
import { saveEstimate, createEstimateSnapshot, saveSectionLines } from "@/lib/db";
import { TakeoffSummary } from "@/lib/calculations";
import type { EstimateSectionLine } from "@/types/db";

// ---------------------------------------------------------------------------
// useEstimatePersistence — Auto-persist ProjectEstimate to Supabase
// ---------------------------------------------------------------------------

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Central orchestration of the auto-persist pipeline.
 * Consumes outputs from all domain hooks and writes to Supabase:
 *
 * Single atomic write: the save_estimate RPC upserts project_estimates
 * (totals/markups) AND replaces estimate_line_items (DELETE + INSERT) inside
 * one PostgreSQL transaction — they commit together or not at all.
 *
 * The write is debounced (1500ms) with overlap prevention via
 * isSavingRef and a dirtyRef re-queue mechanism.
 *
 * NOTE: columnDefs and lockedCells are persisted separately inside
 * useTakeoffWorkbook via their own debounced Supabase calls.
 */
export function useEstimatePersistence(
  projectId: string,
  isLoaded: boolean,
  rows: ProcessedTakeoffRow[],
  rowVersion: number,
  takeoffSummary: TakeoffSummary,
  totalGCs: number,
  siteOperationsTotal: number,
  /** Returns (and freezes-at-first-save) the per-project rate snapshot to persist
   *  (Rate-card Phase B). Idempotent once frozen — see useRateCardSnapshot. */
  freezeRateCardSnapshot: () => Record<string, number>,
  /** True for a brand-new estimate (no persisted project_estimates row at load). Drives
   *  the one-time "Estimate created" milestone snapshot on first save (Phase 4). */
  isNewEstimate: boolean = false,
  /**
   * GC/Site-Ops Addressability: the GC + Site Ops section lines — the SOLE store for
   * Step 2/3 inputs since Phase B6 (the four legacy blob columns were retired). Written
   * via the independent `save_section_lines` RPC AFTER the primary save. The CALLER
   * supplies the right lines per provenance — app-born synthesizes from the live inputs;
   * imported synthesizes the frozen `imported_step23_lines` detail as lumpSum constants
   * (D4) — so this hook persists whatever it is given and needs no provenance flag.
   * Phase B6: the write is AUTHORITATIVE (no longer fail-soft) — a failure surfaces as a
   * save error and the next debounced save retries.
   */
  sectionLines: EstimateSectionLine[] = []
): { saveStatus: SaveStatus; saveError: string | null } {
  // Phase B6: a content key over the section lines — they carry every Step 2/3 input
  // now (identity AND value), so stringifying them is the auto-save trigger for any GC /
  // Site-Ops edit (replaces the retired blob-string keys; the id-only key missed in-line
  // value edits).
  const sectionLinesKey = JSON.stringify(sectionLines);

  // Save-status state machine
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Debounce timer ref
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Active save flag to prevent overlapping saves
  const isSavingRef = useRef(false);
  // Dirty flag: set when edits arrive during an in-flight save
  const dirtyRef = useRef(false);
  // Auto-reset timer for 'saved' → 'idle' transition
  const savedResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Unmount guard to prevent post-teardown state updates (database-guardrails §5)
  const mountedRef = useRef(true);
  // Fires the one-time "Estimate created" milestone snapshot on the first successful
  // save of a brand-new estimate, then never again this session (Phase 4 audit wiring).
  const createdMilestoneDoneRef = useRef(false);
  // Stable ref to the latest executeSave closure, used by the deferred
  // re-queue in the finally block to avoid capturing a stale closure.
  const executeSaveRef = useRef<(() => Promise<void>) | null>(null);

  // ---------------------------------------------------------------------------
  // Core save operation — extracted so it can be called both from the debounce
  // timer and from the dirtyRef re-queue in the finally block.
  // ---------------------------------------------------------------------------
  const executeSave = async () => {
    // Guard against post-unmount saves (database-guardrails §5)
    if (!mountedRef.current) return;

    isSavingRef.current = true;
    setSaveStatus('saving');

    // Clear any pending 'saved' → 'idle' reset timer
    if (savedResetTimerRef.current) {
      clearTimeout(savedResetTimerRef.current);
      savedResetTimerRef.current = null;
    }

    try {
      // Single atomic write: totals/markups AND line items commit together in
      // one PostgreSQL transaction (save_estimate RPC). This replaces the prior
      // two-call Promise.all, which could half-commit — leaving stored header
      // totals diverged from their backing line items (audit #4).
      await saveEstimate(
        {
          projectId,
          subtotal: takeoffSummary.subtotal,
          constructionContingency: takeoffSummary.constructionContingency,
          designContingency: takeoffSummary.designContingency,
          buildersRisk: takeoffSummary.buildersRisk,
          specialInsurance: takeoffSummary.specialInsurance,
          glInsurance: takeoffSummary.glInsurance,
          bond: takeoffSummary.bond,
          fee: takeoffSummary.fee,
          totalCost: takeoffSummary.totalEstimatedCost,
          generalConditionsTotal: totalGCs,
          siteOperationsTotal,
          // Freeze-at-first-save: captures the live card on a new project's first
          // save, returns the existing frozen snapshot thereafter (idempotent).
          rateCardSnapshot: freezeRateCardSnapshot(),
        },
        rows
      );

      // Phase B6: persist the section lines AUTHORITATIVELY (the sole store for Step 2/3
      // inputs since the legacy blob columns were retired) via their independent RPC.
      // No longer fail-soft — a failure throws into the catch below (save → 'error'), and
      // the next debounced save retries with the latest lines. (App-born synthesizes from
      // the live inputs; imported synthesizes the frozen detail as lumpSum constants, D4.)
      if (sectionLines.length > 0) {
        await saveSectionLines(projectId, sectionLines);
      }

      if (!mountedRef.current) return;
      setSaveStatus('saved');
      setSaveError(null);

      // First-save milestone snapshot (Phase 4): a one-time "Estimate created"
      // checkpoint for a brand-new estimate. Fire-and-forget — snapshot loss must never
      // block the save workflow (training/audit immutability rules, AGENTS.md).
      if (isNewEstimate && !createdMilestoneDoneRef.current) {
        createdMilestoneDoneRef.current = true;
        createEstimateSnapshot(
          projectId,
          rows,
          'milestone',
          'Estimate created',
          { subtotal: takeoffSummary.subtotal, totalCost: takeoffSummary.totalEstimatedCost },
        ).catch(() => { /* silent — milestone loss is non-critical */ });
      }

      // Auto-reset to 'idle' after 3 seconds
      savedResetTimerRef.current = setTimeout(() => {
        setSaveStatus('idle');
      }, 3000);
    } catch (err) {
      if (!mountedRef.current) return;
      const message = err instanceof Error ? err.message : 'Save failed';
      console.error('Estimate persistence failed:', err);
      setSaveStatus('error');
      setSaveError(message);
    } finally {
      isSavingRef.current = false;

      // If edits arrived during this save, re-trigger via deferred setTimeout
      // to avoid synchronous recursion (which could infinite-loop on immediate
      // failures).
      //
      // Invariant (Amendment C): dirtyRef is only ever set by the useEffect
      // timer's early-bailout path (when isSavingRef is true and a new debounce
      // fires). Since this re-queued save does not trigger a useEffect dependency
      // change, the effect will not fire during the re-queued execution, so
      // dirtyRef cannot be re-set — preventing infinite loops.
      if (dirtyRef.current) {
        dirtyRef.current = false;
        setTimeout(() => {
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(async () => {
            await executeSaveRef.current?.();
          }, 0);
        }, 0);
      }
    }
  };

  // Update on every render so re-queued saves always use current data.
  useEffect(() => {
    executeSaveRef.current = executeSave;
  });

  // ---------------------------------------------------------------------------
  // Debounced auto-save effect
  // ---------------------------------------------------------------------------
  // Amendment B: The executeSave captured inside the debounce timer is the
  // closure from the render that scheduled the timer. This is the correct
  // React pattern — the effect re-fires on dependency changes, creating a
  // fresh closure each time. The executeSaveRef is only needed for the
  // finally re-queue path, where the timer fires outside the effect lifecycle.
  useEffect(() => {
    if (!isLoaded || !projectId) return;

    // Clear previous debounce timer
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      // If a previous save is still in-flight, mark dirty and return
      if (isSavingRef.current) {
        dirtyRef.current = true;
        return;
      }
      await executeSave();
    }, 1500);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    rowVersion,
    projectId,
    takeoffSummary.subtotal,
    takeoffSummary.constructionContingency,
    takeoffSummary.designContingency,
    takeoffSummary.buildersRisk,
    takeoffSummary.specialInsurance,
    takeoffSummary.glInsurance,
    takeoffSummary.bond,
    takeoffSummary.fee,
    takeoffSummary.totalEstimatedCost,
    isLoaded,
    totalGCs,
    siteOperationsTotal,
    sectionLinesKey,
  ]);

  // Cleanup timers and mark unmounted on teardown
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (savedResetTimerRef.current) clearTimeout(savedResetTimerRef.current);
    };
  }, []);

  return { saveStatus, saveError };
}
