"use client";

import { useState } from "react";
import { ProcessedTakeoffRow, ColumnDefinition } from "@/types";
import { Project } from "@/types/db";
import { generateExcelPayload, generateProcoreBudget, generateExcelWorkbook } from "@/lib/exporter";

// ---------------------------------------------------------------------------
// useExportHandlers — Export CSV / Excel / Procore budget download logic
// ---------------------------------------------------------------------------

export interface UseExportHandlersReturn {
  isExportingExcel: boolean;
  exportError: string | null;
  setExportError: React.Dispatch<React.SetStateAction<string | null>>;
  handleExportExcel: () => void;
  handleExportProcore: () => void;
  handleExportExcelWorkbook: () => Promise<void>;
}

export function useExportHandlers(
  rows: ProcessedTakeoffRow[],
  columnDefs: ColumnDefinition[],
  project: Project | null,
  projectId: string,
): UseExportHandlersReturn {
  // Export state
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

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
    const payload = generateExcelPayload(rows, columnDefs, project);
    downloadCSVFile(payload, `takeoff_excel_${projectId}.csv`);
  };

  const handleExportProcore = () => {
    const payload = generateProcoreBudget(rows, project);
    downloadCSVFile(payload, `procore_budget_${projectId}.csv`);
  };

  const handleExportExcelWorkbook = async () => {
    setIsExportingExcel(true);
    setExportError(null);
    try {
      const blob = await generateExcelWorkbook(rows, project, columnDefs);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `takeoff_workbook_${projectId}.xlsx`);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
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
    handleExportExcel,
    handleExportProcore,
    handleExportExcelWorkbook,
  };
}
