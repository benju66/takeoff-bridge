import { useState } from "react";
import Papa from "papaparse";
import { ProcessedTakeoffRow, TogalRowPayload, WorkbookCommand } from "@/types";
import { parseTogalCSV } from "@/lib/parser";
import { evaluateDataFidelity } from "@/lib/calculations";

// ---------------------------------------------------------------------------
// UseFileIngestionReturn — Public API surface for the file ingestion hook
// ---------------------------------------------------------------------------

export interface UseFileIngestionReturn {
  dragActive: boolean;
  mergeTakeoffData: (parsed: ProcessedTakeoffRow[]) => void;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleDrag: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
}

// ---------------------------------------------------------------------------
// useFileIngestion — Encapsulates CSV file ingestion, drag/drop, and
// takeoff data merge logic extracted from useTakeoffWorkbook.
// ---------------------------------------------------------------------------

export function useFileIngestion(
  projectId: string,
  rowsRef: React.MutableRefObject<ProcessedTakeoffRow[]>,
  unmappedRef: React.MutableRefObject<string[]>,
  userRegistry: Record<string, string>,
  globalRegistry: Record<string, string>,
  appendData: boolean,
  commandHistory: { pushCommand: (cmd: WorkbookCommand) => void },
  setRows: React.Dispatch<React.SetStateAction<ProcessedTakeoffRow[]>>,
  setUnmappedTakeoffClassifications: React.Dispatch<React.SetStateAction<string[]>>,
): UseFileIngestionReturn {
  const [dragActive, setDragActive] = useState(false);

  // ---------------------------------------------------------------------------
  // Merge takeoff CSV data
  // ---------------------------------------------------------------------------
  const mergeTakeoffData = (parsed: ProcessedTakeoffRow[]) => {
    const unmappedList: string[] = [];
    parsed.forEach((parsedRow) => {
      if (!parsedRow.itemId) {
        if (!unmappedList.includes(parsedRow.classification)) {
          unmappedList.push(parsedRow.classification);
        }
      }
    });

    // Capture prevRowStates before mutation
    const currentRows = rowsRef.current;
    const prevRowStates: Array<{ rowId: string; fields: Partial<ProcessedTakeoffRow> }> = [];
    for (const r of currentRows) {
      prevRowStates.push({
        rowId: r.id,
        fields: {
          matchedQty: r.matchedQty,
          total: r.total,
          classification: r.classification,
          rawQuantities: r.rawQuantities.map((rq) => ({ ...rq })),
          isMapped: r.isMapped,
          dataFidelity: r.dataFidelity,
        },
      });
    }
    const prevUnmapped = [...unmappedRef.current];

    // Compute next state
    const updatedRows = currentRows.map((r) => {
      if (!appendData) {
        return { 
          ...r, 
          matchedQty: 0, 
          total: 0, 
          classification: "", 
          rawQuantities: [] as { qty: number; uom: string }[],
          dataFidelity: 'discrete_unit' as const
        };
      }
      return { ...r };
    });

    parsed.forEach((parsedRow) => {
      if (!parsedRow.itemId) return;
      const targetIdx = updatedRows.findIndex((r) => r.itemId === parsedRow.itemId);
      if (targetIdx !== -1) {
        updatedRows[targetIdx].matchedQty += parsedRow.matchedQty;
        updatedRows[targetIdx].total = updatedRows[targetIdx].matchedQty * updatedRows[targetIdx].unitPrice;
        updatedRows[targetIdx].classification = parsedRow.classification;
        updatedRows[targetIdx].rawQuantities = parsedRow.rawQuantities;
        updatedRows[targetIdx].dataFidelity = evaluateDataFidelity(
          updatedRows[targetIdx].matchedQty,
          updatedRows[targetIdx].uom,
          updatedRows[targetIdx].total
        );
      }
    });

    // Capture nextRowStates after mutation
    const nextRowStates: Array<{ rowId: string; fields: Partial<ProcessedTakeoffRow> }> = [];
    for (const r of updatedRows) {
      nextRowStates.push({
        rowId: r.id,
        fields: {
          matchedQty: r.matchedQty,
          total: r.total,
          classification: r.classification,
          rawQuantities: r.rawQuantities.map((rq) => ({ ...rq })),
          isMapped: r.isMapped,
          dataFidelity: r.dataFidelity,
        },
      });
    }

    // pushCommand BEFORE state setters (AGENTS.md guardrail)
    commandHistory.pushCommand({
      type: "MERGE_TAKEOFF_DATA",
      prevRowStates,
      nextRowStates,
      prevUnmapped,
      nextUnmapped: unmappedList,
    });

    setUnmappedTakeoffClassifications(unmappedList);
    setRows(updatedRows);
  };

  // ---------------------------------------------------------------------------
  // File upload & drag/drop
  // ---------------------------------------------------------------------------
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsed = parseTogalCSV(results.data as TogalRowPayload[], userRegistry, globalRegistry);
        mergeTakeoffData(parsed);
      },
    });
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsed = parseTogalCSV(results.data as TogalRowPayload[], userRegistry, globalRegistry);
        mergeTakeoffData(parsed);
      },
    });
  };

  return {
    dragActive,
    mergeTakeoffData,
    handleFileUpload,
    handleDrag,
    handleDrop,
  };
}
