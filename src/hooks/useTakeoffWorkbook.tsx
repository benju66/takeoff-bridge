"use client";

import React, { useState, useEffect, useMemo } from "react";
import Papa from "papaparse";
import {
  useReactTable,
  getCoreRowModel,
  createColumnHelper,
} from "@tanstack/react-table";
import { parseTogalCSV } from "@/lib/parser";
import { ESTIMATE_ITEMS_MASTER } from "@/lib/mock-data";
import { ProcessedTakeoffRow, TogalRowPayload, ColumnDefinition, ContextMenuState, WorkbookSnapshot } from "@/types";
import { Project } from "@/types/db";
import { getProjectEstimate } from "@/lib/db";
import { generateExcelPayload, generateProcoreBudget, generateExcelWorkbook } from "@/lib/exporter";
import { getFuzzySuggestions } from "@/lib/similarity";

// ---------------------------------------------------------------------------
// useTakeoffWorkbook — Core Step 4 grid state, handlers, and TanStack table
// ---------------------------------------------------------------------------

export interface UseTakeoffWorkbookReturn {
  // Core data
  rows: ProcessedTakeoffRow[];
  columnDefs: ColumnDefinition[];
  lockedCells: Record<string, boolean>;

  // TanStack table instance (AMENDMENT GAP-4)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any;

  // UI state
  dragActive: boolean;
  appendData: boolean;
  setAppendData: (val: boolean) => void;
  contextMenu: ContextMenuState;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState>>;
  unmappedTakeoffClassifications: string[];
  historyStack: WorkbookSnapshot[];
  isExportingExcel: boolean;
  exportError: string | null;
  setExportError: React.Dispatch<React.SetStateAction<string | null>>;

  // Handlers
  handleCellEdit: (index: number, field: keyof ProcessedTakeoffRow, value: string | number) => void;
  handleCustomCellEdit: (rowIndex: number, columnId: string, value: string) => void;
  handleKeyDown: (e: React.KeyboardEvent, rIdx: number, type: "code" | "desc" | "qty" | "price") => void;
  handleCustomKeyDown: (e: React.KeyboardEvent, rIdx: number, colId: string) => void;
  handlePaste: (e: React.ClipboardEvent<HTMLInputElement>, startRowIdx: number, type: "code" | "desc" | "qty" | "price") => void;
  handleAddCustomColumn: () => void;
  handleDeleteColumn: (colId: string) => void;
  handleRenameColumn: (colId: string, newHeader: string) => void;
  insertManualRow: (direction: "above" | "below", targetIndex: number) => void;
  handleToggleCellLock: (rowId: string, columnId: string) => void;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleDrag: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  handleExportExcel: () => void;
  handleExportProcore: () => void;
  handleExportExcelWorkbook: () => Promise<void>;
  handleUndo: () => void;
}

export function useTakeoffWorkbook(
  projectId: string,
  isLoaded: boolean,
  project: Project | null
): UseTakeoffWorkbookReturn {
  // Derived project metrics needed by TanStack column renderers
  const unitCount = project?.unitCount ?? 0;
  const squareFootage = project?.squareFootage ?? 0;

  // Core row data
  const [rows, setRows] = useState<ProcessedTakeoffRow[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [appendData, setAppendData] = useState(false);

  // Registry state (project-isolated → global corporate)
  const [userRegistry, setUserRegistry] = useState<Record<string, string>>({});
  const [globalRegistry, setGlobalRegistry] = useState<Record<string, string>>({});

  // History stack for undo
  const [historyStack, setHistoryStack] = useState<WorkbookSnapshot[]>([]);

  // Column definitions
  const [columnDefs, setColumnDefs] = useState<ColumnDefinition[]>([
    { id: "costType", header: "TYPE", type: "default" },
    { id: "itemId", header: "Code", type: "default" },
    { id: "description", header: "Description", type: "default" },
    { id: "matchedQty", header: "Quantity", type: "default" },
    { id: "uom", header: "Unit", type: "default" },
    { id: "unitPrice", header: "Rate", type: "default" },
    { id: "total", header: "Total", type: "default" },
    { id: "costPerUnit", header: "Cost/Unit", type: "default" },
    { id: "costPerSf", header: "Cost/S.F.", type: "default" },
  ]);

  // Context menu
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false, x: 0, y: 0, rowIndex: -1, columnId: "",
  });

  // Cell locks
  const [lockedCells, setLockedCells] = useState<Record<string, boolean>>({});

  // Unmapped classifications
  const [unmappedTakeoffClassifications, setUnmappedTakeoffClassifications] = useState<string[]>([]);

  // Export state
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // pushSnapshotToStack — AGENTS.md guardrail: called before every mutation
  // ---------------------------------------------------------------------------
  const pushSnapshotToStack = (currentRows: ProcessedTakeoffRow[], currentLocks: Record<string, boolean>) => {
    setHistoryStack((prev) => [
      ...prev.slice(-9),
      {
        items: JSON.parse(JSON.stringify(currentRows)),
        locks: JSON.parse(JSON.stringify(currentLocks)),
      },
    ]);
  };

  // ---------------------------------------------------------------------------
  // Undo handler
  // ---------------------------------------------------------------------------
  const handleUndo = () => {
    if (historyStack.length === 0) return;
    const lastSnapshot = historyStack[historyStack.length - 1];
    setHistoryStack((prev) => prev.slice(0, -1));
    setRows(lastSnapshot.items);
    setLockedCells(lastSnapshot.locks);
  };

  // ---------------------------------------------------------------------------
  // Context menu outside-click dismiss
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const handleOutsideClick = () => {
      if (contextMenu.visible) {
        setContextMenu((prev) => ({ ...prev, visible: false }));
      }
    };
    window.addEventListener("click", handleOutsideClick);
    return () => window.removeEventListener("click", handleOutsideClick);
  }, [contextMenu.visible]);

  // ---------------------------------------------------------------------------
  // Initialize default rows
  // ---------------------------------------------------------------------------
  const initializeDefaultEstimateRows = (): ProcessedTakeoffRow[] => {
    const sortedKeys = Object.keys(ESTIMATE_ITEMS_MASTER).sort();
    return sortedKeys.map((key, idx) => {
      const item = ESTIMATE_ITEMS_MASTER[key];
      return {
        id: `row-${idx}`,
        classification: "",
        itemId: item.itemId,
        procoreParentCode: item.procoreParentCode,
        description: item.description,
        matchedQty: 0,
        uom: item.targetUom,
        unitPrice: item.defaultUnitPrice,
        total: 0,
        isMapped: true,
        rawQuantities: [],
        costType: item.costType,
        customFields: {},
      };
    });
  };

  // ---------------------------------------------------------------------------
  // Load estimate + registries + columns + locks on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!projectId) return;

    // Load project-isolated mapping registry
    const savedRegistry = localStorage.getItem(`takeoff_user_registry_${projectId}`);
    if (savedRegistry) {
      try { setUserRegistry(JSON.parse(savedRegistry)); } catch (e) { console.error("Failed to parse project userRegistry", e); }
    }

    // Load global corporate registry
    const savedGlobalRegistry = localStorage.getItem("takeoff_global_user_registry");
    if (savedGlobalRegistry) {
      try { setGlobalRegistry(JSON.parse(savedGlobalRegistry)); } catch (e) { console.error("Failed to parse global userRegistry", e); }
    }

    // Load estimate items
    const savedEstimate = getProjectEstimate(projectId);
    if (savedEstimate) {
      if (savedEstimate.items && savedEstimate.items.length > 0) {
        setRows(savedEstimate.items);
      } else {
        setRows(initializeDefaultEstimateRows());
      }
    } else {
      setRows(initializeDefaultEstimateRows());
    }

    // Load column definitions
    const savedColumnDefs = localStorage.getItem(`takeoff_column_defs_${projectId}`);
    if (savedColumnDefs) {
      try { setColumnDefs(JSON.parse(savedColumnDefs)); } catch (e) { console.error("Failed to parse project columnDefs", e); }
    }

    // Load cell locks
    const savedLockedCells = localStorage.getItem(`takeoff_locked_cells_${projectId}`);
    if (savedLockedCells) {
      try { setLockedCells(JSON.parse(savedLockedCells)); } catch (e) { console.error("Failed to parse project lockedCells", e); }
    }
  }, [projectId]);

  // ---------------------------------------------------------------------------
  // Auto-persist column definitions
  // ---------------------------------------------------------------------------
  const columnDefsString = JSON.stringify(columnDefs);
  useEffect(() => {
    if (!isLoaded || !projectId) return;
    localStorage.setItem(`takeoff_column_defs_${projectId}`, JSON.stringify(columnDefs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnDefsString, isLoaded, projectId]);

  // ---------------------------------------------------------------------------
  // Auto-persist cell locks
  // ---------------------------------------------------------------------------
  const lockedCellsString = JSON.stringify(lockedCells);
  useEffect(() => {
    if (!isLoaded || !projectId) return;
    localStorage.setItem(`takeoff_locked_cells_${projectId}`, JSON.stringify(lockedCells));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedCellsString, isLoaded, projectId]);

  // ---------------------------------------------------------------------------
  // Merge takeoff CSV data
  // ---------------------------------------------------------------------------
  const mergeTakeoffData = (parsed: ProcessedTakeoffRow[]) => {
    pushSnapshotToStack(rows, lockedCells);

    const unmappedList: string[] = [];
    parsed.forEach((parsedRow) => {
      if (!parsedRow.itemId) {
        if (!unmappedList.includes(parsedRow.classification)) {
          unmappedList.push(parsedRow.classification);
        }
      }
    });
    setUnmappedTakeoffClassifications(unmappedList);

    setRows((prevRows) => {
      const updatedRows = prevRows.map((r) => {
        if (!appendData) {
          return { ...r, matchedQty: 0, total: 0, classification: "", rawQuantities: [] };
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
        }
      });

      return updatedRows;
    });
  };

  // ---------------------------------------------------------------------------
  // Insert manual row
  // ---------------------------------------------------------------------------
  const insertManualRow = (direction: "above" | "below", targetIndex: number) => {
    pushSnapshotToStack(rows, lockedCells);
    const updated = [...rows];
    const newRow: ProcessedTakeoffRow = {
      id: `manual-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      classification: "MANUAL ENTRY",
      itemId: "",
      procoreParentCode: "",
      description: "",
      matchedQty: 0,
      uom: "SF",
      unitPrice: 0,
      total: 0,
      isMapped: false,
      rawQuantities: [],
      costType: "M",
      customFields: {},
    };
    const insertIdx = direction === "above" ? targetIndex : targetIndex + 1;
    updated.splice(insertIdx, 0, newRow);
    setRows(updated);
  };

  // ---------------------------------------------------------------------------
  // Toggle cell lock
  // ---------------------------------------------------------------------------
  const handleToggleCellLock = (rowId: string, columnId: string) => {
    pushSnapshotToStack(rows, lockedCells);
    const cellKey = `${rowId}::${columnId}`;
    setLockedCells((prev) => ({ ...prev, [cellKey]: !prev[cellKey] }));
    setContextMenu({ visible: false, x: 0, y: 0, rowIndex: -1, columnId: "" });
  };

  // ---------------------------------------------------------------------------
  // Cell edit direct (cascading logic)
  // ---------------------------------------------------------------------------
  const applyCellEditDirect = (
    updated: ProcessedTakeoffRow[],
    index: number,
    field: keyof ProcessedTakeoffRow,
    value: string | number,
    currentRegistry: Record<string, string>
  ): Record<string, string> | null => {
    const row = updated[index];
    if (!row) return null;

    const classification = row.classification;
    let newRegistry: Record<string, string> | null = null;

    if (field === "itemId") {
      const newCode = String(value).trim();
      row.itemId = newCode;
      const targetItem = ESTIMATE_ITEMS_MASTER[newCode];

      if (classification !== "MANUAL ENTRY") {
        newRegistry = { ...currentRegistry, [classification]: newCode };
      }

      if (targetItem) {
        row.description = targetItem.description;
        row.procoreParentCode = targetItem.procoreParentCode;
        row.unitPrice = targetItem.defaultUnitPrice;
        row.uom = targetItem.targetUom;
        row.costType = targetItem.costType;

        const targetUom = targetItem.targetUom;
        const matched = row.rawQuantities.find(
          (m) => m.uom?.trim().toUpperCase() === targetUom.toUpperCase()
        ) || row.rawQuantities[0];

        const qty = matched?.qty || 0;
        row.matchedQty = qty;
        row.total = qty * targetItem.defaultUnitPrice;
        row.isMapped = true;

        // Cascade duplicates
        if (classification !== "MANUAL ENTRY") {
          for (let i = 0; i < updated.length; i++) {
            if (i !== index && updated[i].classification === classification) {
              updated[i].itemId = newCode;
              updated[i].description = targetItem.description;
              updated[i].procoreParentCode = targetItem.procoreParentCode;
              updated[i].unitPrice = targetItem.defaultUnitPrice;
              updated[i].uom = targetItem.targetUom;
              updated[i].costType = targetItem.costType;

              const m = updated[i].rawQuantities.find(
                (mq) => mq.uom?.trim().toUpperCase() === targetUom.toUpperCase()
              ) || updated[i].rawQuantities[0];

              const q = m?.qty || 0;
              updated[i].matchedQty = q;
              updated[i].total = q * targetItem.defaultUnitPrice;
              updated[i].isMapped = true;
            }
          }
        }
      } else {
        row.description = "UNMAPPED - RECONCILE CODE";
        row.procoreParentCode = "";
        row.unitPrice = 0;
        row.total = 0;
        row.isMapped = false;
        row.costType = "M";

        const firstMeasure = row.rawQuantities[0];
        row.matchedQty = firstMeasure?.qty || 0;
        row.uom = firstMeasure?.uom || "SF";
      }
    } else if (field === "description") {
      row.description = String(value);
      if (classification !== "MANUAL ENTRY") {
        for (let i = 0; i < updated.length; i++) {
          if (updated[i].classification === classification) {
            updated[i].description = String(value);
          }
        }
      }
    } else if (field === "matchedQty") {
      const qty = typeof value === "number" ? value : parseFloat(String(value)) || 0;
      row.matchedQty = qty;
      row.total = qty * row.unitPrice;
    } else if (field === "unitPrice") {
      const price = typeof value === "number" ? value : parseFloat(String(value)) || 0;
      row.unitPrice = price;
      row.total = row.matchedQty * price;

      if (classification !== "MANUAL ENTRY") {
        for (let i = 0; i < updated.length; i++) {
          if (updated[i].classification === classification) {
            updated[i].unitPrice = price;
            updated[i].total = updated[i].matchedQty * price;
          }
        }
      }
    }

    return newRegistry;
  };

  // ---------------------------------------------------------------------------
  // Keyboard navigation
  // ---------------------------------------------------------------------------
  const handleKeyDown = (e: React.KeyboardEvent, rIdx: number, type: "code" | "desc" | "qty" | "price") => {
    const columnsList: ("code" | "desc" | "qty" | "price")[] = ["code", "desc", "qty", "price"];
    const colIdx = columnsList.indexOf(type);

    if (e.key === "ArrowDown") {
      e.preventDefault();
      document.getElementById(`${type}-input-${rIdx + 1}`)?.focus();
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      document.getElementById(`${type}-input-${rIdx - 1}`)?.focus();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      document.getElementById(`${type}-input-${rIdx + 1}`)?.focus();
    }
    if (e.key === "Tab") {
      if (e.shiftKey) {
        if (colIdx > 0) {
          e.preventDefault();
          document.getElementById(`${columnsList[colIdx - 1]}-input-${rIdx}`)?.focus();
        } else if (rIdx > 0) {
          e.preventDefault();
          document.getElementById(`price-input-${rIdx - 1}`)?.focus();
        }
      } else {
        if (colIdx < columnsList.length - 1) {
          e.preventDefault();
          document.getElementById(`${columnsList[colIdx + 1]}-input-${rIdx}`)?.focus();
        } else if (rIdx < rows.length - 1) {
          e.preventDefault();
          document.getElementById(`code-input-${rIdx + 1}`)?.focus();
        }
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Paste handler
  // ---------------------------------------------------------------------------
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>, startRowIdx: number, type: "code" | "desc" | "qty" | "price") => {
    const clipboardData = e.clipboardData;
    const pastedText = clipboardData.getData("text") || "";

    if (pastedText.includes("\t") || pastedText.includes("\n") || pastedText.includes("\r")) {
      e.preventDefault();

      pushSnapshotToStack(rows, lockedCells);
      const columnsList: (keyof ProcessedTakeoffRow)[] = ["itemId", "description", "matchedQty", "unitPrice"];
      const fieldTypes: ("code" | "desc" | "qty" | "price")[] = ["code", "desc", "qty", "price"];
      const startColIdx = fieldTypes.indexOf(type);

      const lines = pastedText.split(/\r\n|\r|\n/);
      if (lines.length > 1 && lines[lines.length - 1] === "") {
        lines.pop();
      }

      const updated = [...rows];
      let currentRegistry = { ...userRegistry };
      let registryChanged = false;
      let didModify = false;

      let currentGlobalRegistry = { ...globalRegistry };
      let globalRegistryChanged = false;

      for (let i = 0; i < lines.length; i++) {
        const targetRowIdx = startRowIdx + i;
        if (targetRowIdx >= updated.length) break;

        const line = lines[i];
        const cells = line.split("\t");

        for (let j = 0; j < cells.length; j++) {
          const targetColIdx = startColIdx + j;
          if (targetColIdx >= columnsList.length) break;

          const field = columnsList[targetColIdx];
          const rawValue = cells[j];

          didModify = true;

          const resultRegistry = applyCellEditDirect(updated, targetRowIdx, field, rawValue, currentRegistry);
          if (resultRegistry) {
            currentRegistry = resultRegistry;
            registryChanged = true;

            if (field === "itemId") {
              const row = updated[targetRowIdx];
              if (row) {
                currentGlobalRegistry = {
                  ...currentGlobalRegistry,
                  [row.classification]: String(rawValue).trim(),
                };
                globalRegistryChanged = true;
              }
            }
          }
        }
      }

      if (didModify) {
        if (registryChanged) {
          setUserRegistry(currentRegistry);
          localStorage.setItem(`takeoff_user_registry_${projectId}`, JSON.stringify(currentRegistry));
        }
        if (globalRegistryChanged) {
          setGlobalRegistry(currentGlobalRegistry);
          localStorage.setItem("takeoff_global_user_registry", JSON.stringify(currentGlobalRegistry));
        }
        setRows(updated);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Cell edit handler
  // ---------------------------------------------------------------------------
  const handleCellEdit = (index: number, field: keyof ProcessedTakeoffRow, value: string | number) => {
    pushSnapshotToStack(rows, lockedCells);
    const updated = [...rows];
    const newRegistry = applyCellEditDirect(updated, index, field, value, userRegistry);

    const classification = updated[index]?.classification;
    if (classification !== "MANUAL ENTRY") {
      if (newRegistry) {
        setUserRegistry(newRegistry);
        localStorage.setItem(`takeoff_user_registry_${projectId}`, JSON.stringify(newRegistry));

        if (classification && field === "itemId") {
          const newGlobalRegistry = {
            ...globalRegistry,
            [classification]: String(value).trim(),
          };
          setGlobalRegistry(newGlobalRegistry);
          localStorage.setItem("takeoff_global_user_registry", JSON.stringify(newGlobalRegistry));
        }
      }
    }
    setRows(updated);
  };

  // ---------------------------------------------------------------------------
  // Custom cell edit
  // ---------------------------------------------------------------------------
  const handleCustomCellEdit = (rowIndex: number, columnId: string, value: string) => {
    pushSnapshotToStack(rows, lockedCells);
    setRows((prev) => {
      const updated = [...prev];
      const row = { ...updated[rowIndex] };
      row.customFields = { ...(row.customFields || {}), [columnId]: value };
      updated[rowIndex] = row;
      return updated;
    });
  };

  // ---------------------------------------------------------------------------
  // Custom column keyboard navigation
  // ---------------------------------------------------------------------------
  const handleCustomKeyDown = (e: React.KeyboardEvent, rIdx: number, colId: string) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      document.getElementById(`custom-${colId}-input-${rIdx + 1}`)?.focus();
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      document.getElementById(`custom-${colId}-input-${rIdx - 1}`)?.focus();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      document.getElementById(`custom-${colId}-input-${rIdx + 1}`)?.focus();
    }
  };

  // ---------------------------------------------------------------------------
  // Column management
  // ---------------------------------------------------------------------------
  const handleAddCustomColumn = () => {
    pushSnapshotToStack(rows, lockedCells);
    const newColId = `custom-${Date.now()}`;
    const newColDef: ColumnDefinition = { id: newColId, header: "NEW COLUMN", type: "custom" };
    setColumnDefs((prev) => [...prev, newColDef]);
  };

  const handleDeleteColumn = (colId: string) => {
    pushSnapshotToStack(rows, lockedCells);
    setColumnDefs((prev) => prev.filter((col) => col.id !== colId));
  };

  const handleRenameColumn = (colId: string, newHeader: string) => {
    setColumnDefs((prev) =>
      prev.map((col) => (col.id === colId ? { ...col, header: newHeader } : col))
    );
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

  // ---------------------------------------------------------------------------
  // Export handlers
  // ---------------------------------------------------------------------------
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
    const payload = generateExcelPayload(rows, columnDefs);
    downloadCSVFile(payload, `takeoff_excel_${projectId}.csv`);
  };

  const handleExportProcore = () => {
    const payload = generateProcoreBudget(rows);
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

  // ---------------------------------------------------------------------------
  // TanStack React Table — Column definitions & table instance
  // ---------------------------------------------------------------------------
  const columns = useMemo(() => {
    const columnHelper = createColumnHelper<ProcessedTakeoffRow>();
    return columnDefs.map((def) => {
      if (def.type === "default") {
        switch (def.id) {
          case "costType":
            return columnHelper.accessor("costType", {
              header: def.header,
              cell: (info) => {
                const row = info.row.original;
                const val = row.costType || "TI";
                return (
                  <div className="text-center font-bold">
                    <span className="text-[10px] bg-slate-100 dark:bg-slate-800 border border-grid-border text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded-md tracking-widest uppercase font-semibold">
                      {val}
                    </span>
                  </div>
                );
              },
            });
          case "itemId":
            return columnHelper.accessor("itemId", {
              header: def.header,
              cell: (info) => {
                const index = info.row.index;
                const row = info.row.original;
                const isCellHardLocked = !!lockedCells[`${row.id}::itemId`];
                return (
                  <div className="flex flex-col gap-2 w-full text-left font-sans">
                    <input
                      id={`code-input-${index}`}
                      type="text"
                      list="estimate-items-options"
                      disabled={isCellHardLocked}
                      className={`w-full h-full min-h-[36px] px-3 py-2 bg-transparent border-none rounded-none text-center outline-none font-mono text-xs uppercase transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-10 focus:bg-white dark:focus:bg-slate-900/40 ${
                        isCellHardLocked
                          ? "text-slate-600 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-950/30 cursor-not-allowed opacity-60"
                          : row.isMapped
                            ? "text-slate-900 dark:text-slate-100 font-semibold"
                            : "text-amber-700 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-950/10 font-bold"
                      }`}
                      value={row.itemId}
                      onChange={(e) => handleCellEdit(index, "itemId", e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, index, "code")}
                      onPaste={(e) => handlePaste(e, index, "code")}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setContextMenu({ visible: true, x: e.clientX, y: e.clientY, rowIndex: index, columnId: "itemId" });
                      }}
                      placeholder="Assign code..."
                    />
                    {!row.isMapped && (
                      <div className="flex flex-col gap-1 mt-1 text-left px-3 pb-2">
                        <span className="text-[9px] text-slate-600 dark:text-slate-400 uppercase tracking-wider font-bold">Suggestions:</span>
                        <div className="flex flex-wrap gap-1.5">
                          {getFuzzySuggestions(row.classification, ESTIMATE_ITEMS_MASTER).map((sugg) => (
                            <button
                              key={sugg.itemId}
                              type="button"
                              disabled={isCellHardLocked}
                              onClick={() => handleCellEdit(index, "itemId", sugg.itemId)}
                              title={sugg.description}
                              className="bg-slate-100 hover:bg-amber-50 dark:bg-slate-800 dark:hover:bg-amber-950/20 text-amber-700 dark:text-amber-400 border border-grid-border hover:border-amber-500/50 rounded px-2 py-0.5 text-[10px] font-sans font-semibold transition-all cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {sugg.itemId}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              },
            });
          case "description":
            return columnHelper.accessor("description", {
              header: def.header,
              size: 320,
              cell: (info) => {
                const index = info.row.index;
                const row = info.row.original;
                const isCellHardLocked = !!lockedCells[`${row.id}::description`];
                return (
                  <input
                    id={`desc-input-${index}`}
                    type="text"
                    disabled={isCellHardLocked}
                    className={`w-full h-full min-h-[36px] px-3 py-2 bg-transparent border-none rounded-none text-left outline-none font-sans text-xs transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-10 focus:bg-white dark:focus:bg-slate-900/40 ${
                      isCellHardLocked
                        ? "text-slate-600 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-950/30 cursor-not-allowed opacity-60"
                        : "text-slate-900 dark:text-slate-100 font-medium"
                    }`}
                    value={row.description}
                    onChange={(e) => handleCellEdit(index, "description", e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, index, "desc")}
                    onPaste={(e) => handlePaste(e, index, "desc")}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu({ visible: true, x: e.clientX, y: e.clientY, rowIndex: index, columnId: "description" });
                    }}
                  />
                );
              },
            });
          case "matchedQty":
            return columnHelper.accessor("matchedQty", {
              header: def.header,
              cell: (info) => {
                const index = info.row.index;
                const row = info.row.original;
                const isCellHardLocked = !!lockedCells[`${row.id}::matchedQty`];
                return (
                  <input
                    id={`qty-input-${index}`}
                    type="number"
                    disabled={isCellHardLocked}
                    className={`w-full h-full min-h-[36px] px-3 py-2 bg-transparent border-none rounded-none text-center font-bold outline-none font-mono text-xs transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-10 focus:bg-white dark:focus:bg-slate-900/40 ${
                      isCellHardLocked
                        ? "text-slate-600 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-950/30 cursor-not-allowed opacity-60"
                        : "text-slate-900 dark:text-white"
                    }`}
                    value={row.matchedQty}
                    onChange={(e) => handleCellEdit(index, "matchedQty", e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, index, "qty")}
                    onPaste={(e) => handlePaste(e, index, "qty")}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu({ visible: true, x: e.clientX, y: e.clientY, rowIndex: index, columnId: "matchedQty" });
                    }}
                  />
                );
              },
            });
          case "uom":
            return columnHelper.accessor("uom", {
              header: def.header,
              cell: (info) => (
                <div className="text-center text-slate-600 dark:text-slate-400 font-bold uppercase font-mono">
                  {info.getValue()}
                </div>
              ),
            });
          case "unitPrice":
            return columnHelper.accessor("unitPrice", {
              header: def.header,
              cell: (info) => {
                const index = info.row.index;
                const row = info.row.original;
                const isCellHardLocked = !!lockedCells[`${row.id}::unitPrice`];
                return (
                  <input
                    id={`price-input-${index}`}
                    type="number"
                    step="0.01"
                    disabled={isCellHardLocked}
                    className={`w-full h-full min-h-[36px] px-3 py-2 bg-transparent border-none rounded-none text-center font-bold outline-none font-mono text-xs transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-10 focus:bg-white dark:focus:bg-slate-900/40 ${
                      isCellHardLocked
                        ? "text-slate-600 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-950/30 cursor-not-allowed opacity-60"
                        : "text-slate-900 dark:text-white"
                    }`}
                    value={row.unitPrice}
                    onChange={(e) => handleCellEdit(index, "unitPrice", e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, index, "price")}
                    onPaste={(e) => handlePaste(e, index, "price")}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu({ visible: true, x: e.clientX, y: e.clientY, rowIndex: index, columnId: "unitPrice" });
                    }}
                  />
                );
              },
            });
          case "total":
            return columnHelper.accessor("total", {
              header: def.header,
              cell: (info) => (
                <div className="text-center font-black font-mono">
                  <span className={info.getValue() > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-600 dark:text-slate-400"}>
                    ${info.getValue().toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              ),
            });
          case "costPerUnit":
            return columnHelper.display({
              id: "costPerUnit",
              header: def.header,
              cell: (info) => {
                const row = info.row.original;
                const cpu = row.total / (unitCount || 1);
                return (
                  <div className="text-center font-bold text-slate-600 dark:text-slate-400 font-mono">
                    ${cpu.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                );
              },
            });
          case "costPerSf":
            return columnHelper.display({
              id: "costPerSf",
              header: def.header,
              cell: (info) => {
                const row = info.row.original;
                const cpsf = row.total / (squareFootage || 1);
                return (
                  <div className="text-center font-bold text-slate-600 dark:text-slate-400 font-mono">
                    ${cpsf.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                );
              },
            });
          default:
            return columnHelper.display({ id: def.id, header: def.header });
        }
      } else {
        // Custom Column
        return columnHelper.accessor((row) => row.customFields?.[def.id] ?? "", {
          id: def.id,
          header: def.header,
          cell: (info) => {
            const index = info.row.index;
            const row = info.row.original;
            const isCellHardLocked = !!lockedCells[`${row.id}::${def.id}`];
            const val = row.customFields?.[def.id] ?? "";
            return (
              <input
                id={`custom-${def.id}-input-${index}`}
                type="text"
                disabled={isCellHardLocked}
                className={`w-full h-full min-h-[36px] px-3 py-2 bg-transparent border-none rounded-none text-left outline-none font-sans text-xs transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-10 focus:bg-white dark:focus:bg-slate-900/40 ${
                  isCellHardLocked
                    ? "text-slate-600 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-950/30 cursor-not-allowed opacity-60"
                    : "text-slate-900 dark:text-slate-100 font-medium"
                }`}
                value={val}
                onChange={(e) => handleCustomCellEdit(index, def.id, e.target.value)}
                onKeyDown={(e) => handleCustomKeyDown(e, index, def.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextMenu({ visible: true, x: e.clientX, y: e.clientY, rowIndex: index, columnId: def.id });
                }}
                placeholder="..."
              />
            );
          },
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnDefs, lockedCells, unitCount, squareFootage, userRegistry, globalRegistry]);

  // Instantiate TanStack table (AMENDMENT GAP-4: moved inside hook)
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    columnResizeMode: "onChange",
    getCoreRowModel: getCoreRowModel(),
  });

  return {
    rows,
    columnDefs,
    lockedCells,
    table,
    dragActive,
    appendData,
    setAppendData,
    contextMenu,
    setContextMenu,
    unmappedTakeoffClassifications,
    historyStack,
    isExportingExcel,
    exportError,
    setExportError,
    handleCellEdit,
    handleCustomCellEdit,
    handleKeyDown,
    handleCustomKeyDown,
    handlePaste,
    handleAddCustomColumn,
    handleDeleteColumn,
    handleRenameColumn,
    insertManualRow,
    handleToggleCellLock,
    handleFileUpload,
    handleDrag,
    handleDrop,
    handleExportExcel,
    handleExportProcore,
    handleExportExcelWorkbook,
    handleUndo,
  };
}
