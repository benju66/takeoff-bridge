"use client";

import { useState } from "react";
import { ProcessedTakeoffRow, ColumnDefinition, EstimateOverrideMap } from "@/types";
import { Project } from "@/types/db";
import { PersonnelCalcResult, SiteOpsCalcResult, computeLinkedDivisionTotals } from "@/lib/calculations";
import {
  generateExcelPayload,
  generateProcoreBudget,
  generateExcelWorkbook,
  validateExportReadiness,
  ExportBlocker,
} from "@/lib/exporter";
import { getTemplateConfig, downloadTemplateFile, createEstimateSnapshot } from "@/lib/db";
import { MASTER_TEMPLATE_NAME } from "@/lib/constants";

// ---------------------------------------------------------------------------
// useExportHandlers — Export CSV / Excel / Procore budget download logic
//
// Phase 2 gate: validateExportReadiness runs BEFORE any Procore-bound download.
// Rows with unmapped dollars populate exportBlockers (opens the interactive
// override modal — no download happens); reconciliation mismatches surface
// via exportError. Mappings are never auto-assigned (AGENTS.md).
// ---------------------------------------------------------------------------

export type PendingExportKind = "workbook" | "procore";

export interface UseExportHandlersReturn {
  isExportingExcel: boolean;
  exportError: string | null;
  setExportError: React.Dispatch<React.SetStateAction<string | null>>;
  exportBlockers: ExportBlocker[];
  pendingExportKind: PendingExportKind | null;
  clearExportBlockers: () => void;
  handleExportExcel: () => void;
  handleExportProcore: (overrideRows?: ProcessedTakeoffRow[]) => void;
  handleExportExcelWorkbook: (overrideRows?: ProcessedTakeoffRow[]) => Promise<void>;
}

export function useExportHandlers(
  rows: ProcessedTakeoffRow[],
  columnDefs: ColumnDefinition[],
  project: Project | null,
  projectId: string,
  // gc-siteops Phase 3: GC + Site Ops computed results join every export path
  gcCalcResult: PersonnelCalcResult,
  siteOpsCalcResult: SiteOpsCalcResult,
  // Phase 5 (INV-1): active estimator overrides threaded into all three
  // generators so the exported numbers == the on-screen/saved numbers. `{}`
  // (the default) keeps every export byte-identical to pre-override behavior.
  activeOverrides: EstimateOverrideMap = {},
): UseExportHandlersReturn {
  // Export state
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportBlockers, setExportBlockers] = useState<ExportBlocker[]>([]);
  const [pendingExportKind, setPendingExportKind] = useState<PendingExportKind | null>(null);

  const clearExportBlockers = () => {
    setExportBlockers([]);
    setPendingExportKind(null);
  };

  /**
   * Completeness + reconciliation gates. Returns true when the export may
   * proceed. Blockers open the override modal; reconciliation failures set
   * exportError. Remembers which export to retry after overrides are applied.
   */
  const runExportGate = (effectiveRows: ProcessedTakeoffRow[], kind: PendingExportKind): boolean => {
    const readiness = validateExportReadiness(effectiveRows, gcCalcResult, siteOpsCalcResult);
    if (readiness.ok) {
      clearExportBlockers();
      return true;
    }
    if (readiness.blockers.length > 0) {
      setPendingExportKind(kind);
      setExportBlockers(readiness.blockers);
    } else {
      const { lineItemTotal, rollupTotal, delta } = readiness.reconciliation;
      setExportError(
        `Export blocked: line items total $${lineItemTotal.toFixed(2)} but the Procore rollup totals $${rollupTotal.toFixed(2)} (Δ $${delta.toFixed(2)}).`
      );
    }
    return false;
  };

  const downloadCSVFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportExcel = () => {
    // Linked division values keep the payload's rows + modifier basis in
    // step with the estimate page (gc-siteops Phase 5).
    const linkedTotals = computeLinkedDivisionTotals(gcCalcResult, siteOpsCalcResult);
    const payload = generateExcelPayload(rows, columnDefs, project, linkedTotals, activeOverrides);
    downloadCSVFile(payload, `takeoff_excel_${projectId}.csv`);
  };

  const handleExportProcore = (overrideRows?: ProcessedTakeoffRow[]) => {
    const effectiveRows = Array.isArray(overrideRows) ? overrideRows : rows;
    if (!runExportGate(effectiveRows, "procore")) return;
    const payload = generateProcoreBudget(effectiveRows, project, gcCalcResult, siteOpsCalcResult, activeOverrides);
    downloadCSVFile(payload, `procore_budget_${projectId}.csv`);

    // Export milestone snapshot (Phase 4): the exact version sent to Procore. Fire-and-
    // forget — snapshot loss must never block an export (audit immutability, AGENTS.md).
    createEstimateSnapshot(projectId, effectiveRows, 'milestone', 'Exported Procore budget', {}, { kind: 'procore_export' })
      .catch(() => { /* silent — milestone loss is non-critical */ });
  };

  const handleExportExcelWorkbook = async (overrideRows?: ProcessedTakeoffRow[]) => {
    const effectiveRows = Array.isArray(overrideRows) ? overrideRows : rows;
    if (!runExportGate(effectiveRows, "workbook")) return;
    setIsExportingExcel(true);
    setExportError(null);
    try {
      // 1. Fetch layout config (required, no fallback — Phase 3b: config_data
      // is the single source of truth for row geometry) and the template file
      // from the private Storage bucket, in parallel (both via db.ts).
      const [config, templateBuffer] = await Promise.all([
        getTemplateConfig(MASTER_TEMPLATE_NAME),
        downloadTemplateFile(MASTER_TEMPLATE_NAME),
      ]);
      if (!config) {
        throw new Error(
          `No template_config row found for "${MASTER_TEMPLATE_NAME}" — seed it from supabase_schema.sql before exporting.`
        );
      }

      // 2. Generate Excel workbook using the relative shifting engine
      const blob = await generateExcelWorkbook(effectiveRows, project, columnDefs, config.configData, templateBuffer, gcCalcResult, siteOpsCalcResult, activeOverrides);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `takeoff_workbook_${projectId}.xlsx`);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      // Export milestone snapshot (Phase 4): the exact workbook version sent out.
      // Fire-and-forget — snapshot loss must never block an export (AGENTS.md).
      createEstimateSnapshot(projectId, effectiveRows, 'milestone', 'Exported workbook', {}, { kind: 'workbook_export' })
        .catch(() => { /* silent — milestone loss is non-critical */ });
    } catch (err) {
      console.error("Workbook generation failed", err);
      const message = err instanceof Error ? err.message : "Failed to generate Excel Workbook.";
      setExportError(message);
    } finally {
      setIsExportingExcel(false);
    }
  };

  return {
    isExportingExcel,
    exportError,
    setExportError,
    exportBlockers,
    pendingExportKind,
    clearExportBlockers,
    handleExportExcel,
    handleExportProcore,
    handleExportExcelWorkbook,
  };
}
