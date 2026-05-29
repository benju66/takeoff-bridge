"use client";

import { useEffect } from "react";
import { ProcessedTakeoffRow } from "@/types";
import { ProjectEstimate } from "@/types/db";
import { saveProjectEstimate } from "@/lib/db";
import { TakeoffSummary } from "@/lib/calculations";

// ---------------------------------------------------------------------------
// useEstimatePersistence — Auto-persist ProjectEstimate to localStorage
// ---------------------------------------------------------------------------

/**
 * Central orchestration of the saveProjectEstimate auto-persist useEffect.
 * Consumes outputs from all domain hooks and writes the unified ProjectEstimate.
 *
 * NOTE: columnDefs and lockedCells are persisted separately inside useTakeoffWorkbook
 * via their own localStorage.setItem calls. This hook only handles the ProjectEstimate shape.
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

  useEffect(() => {
    if (!isLoaded || !projectId) return;

    const estimate: ProjectEstimate = {
      projectId,
      subtotal: takeoffSummary.subtotal,
      generalLiability: takeoffSummary.generalLiability,
      fee: takeoffSummary.contractorFee,
      totalCost: takeoffSummary.totalEstimatedCost,
      items: rows,
      generalConditionsTotal: totalGCs,
      gcUtilization,
      gcEquipmentOverrides,
      siteOperationsTotal,
      siteOpsQuantities,
      siteOpsRates,
    };
    saveProjectEstimate(estimate);
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
