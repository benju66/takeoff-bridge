import { useState, useCallback } from "react";
import Papa from "papaparse";
import { ProcessedTakeoffRow, TogalRowPayload, WorkbookCommand } from "@/types";
import { parseTogalCSV } from "@/lib/parser";
import { evaluateDataFidelity } from "@/lib/calculations";
import { parseTogalXLSX, XlsxParseResult } from "@/lib/xlsx-reader";
import { detectArchParams, ArchParamSuggestion } from "@/lib/archParamDetector";

// ---------------------------------------------------------------------------
// Pending Import state — holds parsed data between preview and confirm
// ---------------------------------------------------------------------------

export interface PendingImport {
  raw: TogalRowPayload[];
  parsed: ProcessedTakeoffRow[];
  fileName: string;
  archParamSuggestions: ArchParamSuggestion[];
  sheetNames: string[];
  selectedSheet: string;
}

// ---------------------------------------------------------------------------
// UseFileIngestionReturn — Public API surface for the file ingestion hook
// ---------------------------------------------------------------------------

export interface UseFileIngestionReturn {
  dragActive: boolean;
  pendingImport: PendingImport | null;
  mergeTakeoffData: (parsed: ProcessedTakeoffRow[]) => void;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleDrag: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  confirmImport: (archParams: ArchParamSuggestion[]) => void;
  cancelImport: () => void;
  reParseWithSheet: (sheetName: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Helper: detect file type and parse accordingly
// ---------------------------------------------------------------------------

async function parseFile(
  file: File,
  userRegistry: Record<string, string>,
  globalRegistry: Record<string, string>,
  sheetName?: string,
): Promise<{
  raw: TogalRowPayload[];
  parsed: ProcessedTakeoffRow[];
  sheetNames: string[];
  selectedSheet: string;
}> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";

  if (ext === "xlsx" || ext === "xls") {
    const result: XlsxParseResult = await parseTogalXLSX(file, sheetName);
    const parsed = parseTogalCSV(result.rows, userRegistry, globalRegistry);
    return {
      raw: result.rows,
      parsed,
      sheetNames: result.sheetNames,
      selectedSheet: result.selectedSheet,
    };
  }

  // Default: CSV via PapaParse
  return new Promise((resolve) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rawData = results.data as TogalRowPayload[];
        const parsed = parseTogalCSV(rawData, userRegistry, globalRegistry);
        resolve({
          raw: rawData,
          parsed,
          sheetNames: [],
          selectedSheet: "",
        });
      },
    });
  });
}

// ---------------------------------------------------------------------------
// useFileIngestion — Encapsulates CSV/XLSX file ingestion, drag/drop, and
// takeoff data merge logic. Now supports staged import flow with preview.
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
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);

  // Keep a ref to the last uploaded file for re-parsing with different sheet
  const [lastFile, setLastFile] = useState<File | null>(null);

  // ---------------------------------------------------------------------------
  // Merge takeoff CSV data (unchanged from original — core merge engine)
  // ---------------------------------------------------------------------------
  const mergeTakeoffData = useCallback((parsed: ProcessedTakeoffRow[]) => {
    const threshold = Number(globalRegistry["__config_threshold"]) || 5000;
    const keywords = globalRegistry["__config_keywords"]
      ? globalRegistry["__config_keywords"].split(",").map(k => k.trim())
      : ["LS", "SUM", "ALLW", "LUMP"];

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
          updatedRows[targetIdx].total,
          threshold,
          keywords
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
  }, [appendData, commandHistory, globalRegistry, rowsRef, setRows, setUnmappedTakeoffClassifications, unmappedRef]);

  // ---------------------------------------------------------------------------
  // Stage the import — parse file and set pendingImport for modal preview
  // ---------------------------------------------------------------------------
  const stageImport = useCallback(async (file: File) => {
    setLastFile(file);

    try {
      const { raw, parsed, sheetNames, selectedSheet } = await parseFile(
        file, userRegistry, globalRegistry
      );

      const archParamSuggestions = detectArchParams(raw);

      setPendingImport({
        raw,
        parsed,
        fileName: file.name,
        archParamSuggestions,
        sheetNames,
        selectedSheet,
      });
    } catch (error) {
      console.error("Failed to parse import file:", error);
    }
  }, [userRegistry, globalRegistry]);

  // ---------------------------------------------------------------------------
  // Re-parse with a different sheet (for multi-sheet XLSX)
  // ---------------------------------------------------------------------------
  const reParseWithSheet = useCallback(async (sheetName: string) => {
    if (!lastFile) return;

    const { raw, parsed, sheetNames, selectedSheet } = await parseFile(
      lastFile, userRegistry, globalRegistry, sheetName
    );

    const archParamSuggestions = detectArchParams(raw);

    setPendingImport({
      raw,
      parsed,
      fileName: lastFile.name,
      archParamSuggestions,
      sheetNames,
      selectedSheet,
    });
  }, [lastFile, userRegistry, globalRegistry]);

  // ---------------------------------------------------------------------------
  // Confirm import — execute the merge with optional arch params
  // ---------------------------------------------------------------------------
  const confirmImport = useCallback((_archParams: ArchParamSuggestion[]) => {
    void _archParams;
    if (!pendingImport) return;
    mergeTakeoffData(pendingImport.parsed);
    setPendingImport(null);
    setLastFile(null);
    // Note: archParams are handled by the modal caller (passed to handleProjectParamChange)
  }, [pendingImport, mergeTakeoffData]);

  // ---------------------------------------------------------------------------
  // Cancel import — discard pending data
  // ---------------------------------------------------------------------------
  const cancelImport = useCallback(() => {
    setPendingImport(null);
    setLastFile(null);
  }, []);

  // ---------------------------------------------------------------------------
  // File upload & drag/drop — now stages instead of immediately merging
  // ---------------------------------------------------------------------------
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    stageImport(file);
    // Reset input value so the same file can be re-uploaded
    e.target.value = "";
  }, [stageImport]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    stageImport(file);
  }, [stageImport]);

  return {
    dragActive,
    pendingImport,
    mergeTakeoffData,
    handleFileUpload,
    handleDrag,
    handleDrop,
    confirmImport,
    cancelImport,
    reParseWithSheet,
  };
}
