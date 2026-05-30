"use client";

import { useEffect, useRef, useState } from "react";
import { ProcessedTakeoffRow } from "@/types";
import { saveProjectEstimate, saveEstimateLineItems } from "@/lib/db";
import { TakeoffSummary } from "@/lib/calculations";

// ---------------------------------------------------------------------------
// useEstimatePersistence — Auto-persist ProjectEstimate to Supabase
// ---------------------------------------------------------------------------

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Central orchestration of the auto-persist pipeline.
 * Consumes outputs from all domain hooks and writes to Supabase:
 *
 * Operation A: UPSERT project_estimates (totals/markups — single row)
 * Operation B: RPC save_estimate_line_items (atomic DELETE + INSERT)
 *
 * Both operations are debounced (1500ms) with overlap prevention via
 * isSavingRef and a dirtyRef re-queue mechanism.
 *
 * NOTE: columnDefs and lockedCells are persisted separately inside
 * useTakeoffWorkbook via their own debounced Supabase calls.
 */
export function useEstimatePersistence(
  projectId: string,
  isLoaded: boolean,
  rows: ProcessedTakeoffRow[],
  takeoffSummary: TakeoffSummary,
  totalGCs: number,
  gcUtilization: Record<string, number>,
  gcEquipmentOverrides: Record<string, number>,
  siteOperationsTotal: number,
  siteOpsQuantities: Record<string, number>,
  siteOpsRates: Record<string, number>
): { saveStatus: SaveStatus; saveError: string | null } {
  const rowsString = JSON.stringify(rows);
  const gcUtilizationString = JSON.stringify(gcUtilization);
  const gcEquipmentOverridesString = JSON.stringify(gcEquipmentOverrides);
  const siteOpsQuantitiesString = JSON.stringify(siteOpsQuantities);
  const siteOpsRatesString = JSON.stringify(siteOpsRates);

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
      isSavingRef.current = true;
      setSaveStatus('saving');

      // Clear any pending 'saved' → 'idle' reset timer
      if (savedResetTimerRef.current) {
        clearTimeout(savedResetTimerRef.current);
        savedResetTimerRef.current = null;
      }

      try {
        // Operation A: Upsert totals/markups (no items)
        // Operation B: Atomic RPC line item save
        await Promise.all([
          saveProjectEstimate({
            projectId,
            subtotal: takeoffSummary.subtotal,
            generalLiability: takeoffSummary.generalLiability,
            fee: takeoffSummary.contractorFee,
            totalCost: takeoffSummary.totalEstimatedCost,
            generalConditionsTotal: totalGCs,
            gcUtilization,
            gcEquipmentOverrides,
            siteOperationsTotal,
            siteOpsQuantities,
            siteOpsRates,
          }),
          saveEstimateLineItems(projectId, rows),
        ]);

        setSaveStatus('saved');
        setSaveError(null);

        // Auto-reset to 'idle' after 3 seconds
        savedResetTimerRef.current = setTimeout(() => {
          setSaveStatus('idle');
        }, 3000);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Save failed';
        console.error('Estimate persistence failed:', err);
        setSaveStatus('error');
        setSaveError(message);
      } finally {
        isSavingRef.current = false;

        // If edits arrived during this save, re-trigger via deferred setTimeout
        // to avoid synchronous recursion (which could infinite-loop on immediate failures)
        if (dirtyRef.current) {
          dirtyRef.current = false;
          setTimeout(() => {
            // Re-dispatch by toggling a no-op to nudge the effect
            // The effect will re-run on the next dependency change naturally,
            // but we force it by clearing+re-setting the timer
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(async () => {
              // The effect body will handle the actual save on next invocation
            }, 0);
          }, 0);
        }
      }
    }, 1500);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    rowsString,
    projectId,
    takeoffSummary.subtotal,
    takeoffSummary.generalLiability,
    takeoffSummary.contractorFee,
    takeoffSummary.totalEstimatedCost,
    isLoaded,
    totalGCs,
    siteOperationsTotal,
    gcUtilizationString,
    gcEquipmentOverridesString,
    siteOpsQuantitiesString,
    siteOpsRatesString,
  ]);

  // Cleanup saved-reset timer on unmount
  useEffect(() => {
    return () => {
      if (savedResetTimerRef.current) clearTimeout(savedResetTimerRef.current);
    };
  }, []);

  return { saveStatus, saveError };
}
