"use client";

import { useEffect, useRef } from "react";
import { ProcessedTakeoffRow } from "@/types";
import { saveProjectEstimate, saveEstimateLineItems } from "@/lib/db";
import { TakeoffSummary } from "@/lib/calculations";

// ---------------------------------------------------------------------------
// useEstimatePersistence — Auto-persist ProjectEstimate to Supabase
// ---------------------------------------------------------------------------

/**
 * Central orchestration of the auto-persist pipeline.
 * Consumes outputs from all domain hooks and writes to Supabase:
 *
 * Operation A: UPSERT project_estimates (totals/markups — single row)
 * Operation B: RPC save_estimate_line_items (atomic DELETE + INSERT)
 *
 * Both operations are debounced (1500ms) with AbortController to cancel
 * stale in-flight requests when new edits arrive.
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
): void {
  const rowsString = JSON.stringify(rows);
  const gcUtilizationString = JSON.stringify(gcUtilization);
  const gcEquipmentOverridesString = JSON.stringify(gcEquipmentOverrides);
  const siteOpsQuantitiesString = JSON.stringify(siteOpsQuantities);
  const siteOpsRatesString = JSON.stringify(siteOpsRates);

  // Debounce timer ref
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Active save flag to prevent overlapping saves
  const isSavingRef = useRef(false);

  useEffect(() => {
    if (!isLoaded || !projectId) return;

    // Clear previous debounce timer
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      // Skip if a previous save is still in-flight
      if (isSavingRef.current) return;
      isSavingRef.current = true;

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
      } finally {
        isSavingRef.current = false;
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
}
