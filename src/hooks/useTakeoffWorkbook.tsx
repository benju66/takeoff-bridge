"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { Trash, MessageSquare } from "lucide-react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  createColumnHelper,
  SortingState,
  ColumnFiltersState,
} from "@tanstack/react-table";
import { ESTIMATE_ITEMS_MASTER } from "@/lib/mock-data";
import { ProcessedTakeoffRow, ColumnDefinition, ContextMenuState } from "@/types";
import { NumberCellInput } from "@/components/workspace/NumberCellInput";
import { Project } from "@/types/db";
import {
  getEstimateLineItems,
  getProjectRegistry,
  getGlobalRegistry,
  getProjectColumnDefs,
  getProjectLockedCells,
} from "@/lib/db";
import { getFuzzySuggestions } from "@/lib/similarity";
import { useCommandHistory } from "./useCommandHistory";
import { useLockedCells } from "./useLockedCells";
import { useColumnDefinitions } from "./useColumnDefinitions";
import { useKeyboardNavigation } from "./useKeyboardNavigation";
import { useCommandDispatch } from "./useCommandDispatch";
import { useCellEditing } from "./useCellEditing";
import { usePasteHandler } from "./usePasteHandler";
import { useFileIngestion } from "./useFileIngestion";
import { useExportHandlers } from "./useExportHandlers";

// ---------------------------------------------------------------------------
// useTakeoffWorkbook — Orchestration shell
// Composes sub-hooks for cell editing, paste, file ingestion, export,
// command dispatch, column definitions, keyboard navigation, and locked cells.
// ---------------------------------------------------------------------------

export interface UseTakeoffWorkbookReturn {
  // Core data
  rows: ProcessedTakeoffRow[];
  columnDefs: ColumnDefinition[];
  lockedCells: Record<string, boolean>;

  // TanStack table instance (AMENDMENT GAP-4)
  table: ReturnType<typeof useReactTable<ProcessedTakeoffRow>>;

  // UI state
  dragActive: boolean;
  appendData: boolean;
  setAppendData: (val: boolean) => void;
  contextMenu: ContextMenuState;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState>>;
  unmappedTakeoffClassifications: string[];
  canUndo: boolean;
  canRedo: boolean;
  undoStackSize: number;
  redoStackSize: number;
  isExportingExcel: boolean;
  exportError: string | null;
  setExportError: React.Dispatch<React.SetStateAction<string | null>>;
  rowVersion: number;

  // Sort / Filter state (Phase 4)
  globalFilter: string;
  setGlobalFilter: (value: string) => void;
  sorting: SortingState;
  columnFilters: ColumnFiltersState;

  // Handlers
  handleCellEdit: (index: number, field: keyof ProcessedTakeoffRow, value: string | number) => void;
  commitCellEdit: (rowId: string, field: keyof ProcessedTakeoffRow, prevValue: string | number | boolean, nextValue: string | number | boolean) => void;
  handleCustomCellEdit: (rowIndex: number, columnId: string, value: string) => void;
  commitCustomCellEdit: (rowId: string, columnId: string, prevValue: string, nextValue: string) => void;
  handleKeyDown: (e: React.KeyboardEvent, rIdx: number, type: "code" | "desc" | "qty" | "price") => void;
  handleCustomKeyDown: (e: React.KeyboardEvent, rIdx: number, colId: string) => void;
  handlePaste: (e: React.ClipboardEvent<HTMLInputElement>, startRowIdx: number, type: "code" | "desc" | "qty" | "price") => void;
  handleAddCustomColumn: () => void;
  handleDeleteColumn: (colId: string) => void;
  handleRenameColumn: (colId: string, newHeader: string) => void;
  insertManualRow: (direction: "above" | "below", targetIndex: number) => void;
  deleteRow: (rowId: string) => void;
  handleToggleCellLock: (rowId: string, columnId: string) => void;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleDrag: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  handleExportExcel: () => void;
  handleExportProcore: () => void;
  handleExportExcelWorkbook: () => Promise<void>;
  handleUndo: () => void;
  handleRedo: () => void;
}

export function useTakeoffWorkbook(
  projectId: string,
  isLoaded: boolean,
  project: Project | null
): UseTakeoffWorkbookReturn {
  const unitCount = project?.unitCount ?? 0;
  const squareFootage = project?.squareFootage ?? 0;

  // Core row data
  const [rows, setRowsRaw] = useState<ProcessedTakeoffRow[]>([]);
  const [rowVersion, setRowVersion] = useState(0);
  const [appendData, setAppendData] = useState(false);

  // setRowsTracked — wraps setRows with a version counter bump
  // Sub-hooks use this instead of raw setRows so rowVersion increments
  // on every mutation, allowing useEstimatePersistence to use it as
  // a dependency instead of JSON.stringify(rows)
  const setRows: React.Dispatch<React.SetStateAction<ProcessedTakeoffRow[]>> = React.useCallback(
    (action) => {
      setRowsRaw(action);
      setRowVersion((v) => v + 1);
    },
    []
  );

  // Registry state (project-isolated → global corporate)
  const [userRegistry, setUserRegistry] = useState<Record<string, string>>({});
  const [globalRegistry, setGlobalRegistry] = useState<Record<string, string>>({});

  // Context menu
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false, x: 0, y: 0, rowIndex: -1, columnId: "",
  });

  // Unmapped classifications
  const [unmappedTakeoffClassifications, setUnmappedTakeoffClassifications] = useState<string[]>([]);

  // Command Pattern history engine
  const commandHistory = useCommandHistory();

  // Stable refs — must be declared before hooks that consume them
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  const userRegistryRef = useRef(userRegistry);
  useEffect(() => { userRegistryRef.current = userRegistry; }, [userRegistry]);
  const globalRegistryRef = useRef(globalRegistry);
  useEffect(() => { globalRegistryRef.current = globalRegistry; }, [globalRegistry]);
  const unmappedRef = useRef(unmappedTakeoffClassifications);
  useEffect(() => { unmappedRef.current = unmappedTakeoffClassifications; }, [unmappedTakeoffClassifications]);

  // --- Extracted hooks ---
  const {
    lockedCells, setLockedCells, handleToggleCellLock,
  } = useLockedCells(projectId, isLoaded, commandHistory);

  const {
    columnDefs, setColumnDefs,
    handleAddCustomColumn, handleDeleteColumn, handleRenameColumn,
  } = useColumnDefinitions(projectId, isLoaded, commandHistory, rowsRef);

  const { handleKeyDown, handleCustomKeyDown } = useKeyboardNavigation(rowsRef);

  const {
    editingValues, editingCellId,
    setEditingValues, setEditingCellId,
    focusedCellRef, focusedCustomCellRef, flushEditingBufferRef,
    applyCellEditDirect,
    handleCellEdit, commitCellEdit,
    handleCustomCellEdit, commitCustomCellEdit,
  } = useCellEditing(
    projectId, rowsRef, userRegistryRef, globalRegistryRef,
    commandHistory, setRows, setUserRegistry, setGlobalRegistry,
  );

  const { handlePaste } = usePasteHandler(
    rows, userRegistry, globalRegistry, projectId,
    commandHistory, applyCellEditDirect,
    setRows, setUserRegistry, setGlobalRegistry,
  );

  const {
    dragActive,
    handleFileUpload, handleDrag, handleDrop,
  } = useFileIngestion(
    projectId, rowsRef, unmappedRef,
    userRegistry, globalRegistry, appendData,
    commandHistory, setRows, setUnmappedTakeoffClassifications,
  );

  const {
    isExportingExcel, exportError, setExportError,
    handleExportExcel, handleExportProcore, handleExportExcelWorkbook,
  } = useExportHandlers(rows, columnDefs, project, projectId);

  const {
    handleUndo, handleRedo,
  } = useCommandDispatch(
    commandHistory, projectId,
    setRows, setUserRegistry, setGlobalRegistry,
    setColumnDefs, setLockedCells, setUnmappedTakeoffClassifications,
  );

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
    return sortedKeys.map((key) => {
      const item = ESTIMATE_ITEMS_MASTER[key];
      return {
        id: `row-${item.itemId}`,
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
  // Load estimate + registries + columns + locks on mount (async Supabase)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    (async () => {
      try {
        // Load all data sources in parallel
        const [savedLineItems, savedRegistry, savedGlobalReg, savedColDefs, savedLocks] =
          await Promise.all([
            getEstimateLineItems(projectId),
            getProjectRegistry(projectId),
            getGlobalRegistry(),
            getProjectColumnDefs(projectId),
            getProjectLockedCells(projectId),
          ]);

        if (cancelled) return;

        // Apply registries
        setUserRegistry(savedRegistry);
        setGlobalRegistry(savedGlobalReg);

        // Apply line items — honor sort_order from DB
        if (savedLineItems.length > 0) {
          // Automatically merge any newly harvested master cost codes
          const masterItems = initializeDefaultEstimateRows();
          const merged = [...savedLineItems];

          masterItems.forEach((masterItem) => {
            const exists = savedLineItems.some(
              (savedItem) => savedItem.itemId === masterItem.itemId
            );
            if (!exists) {
              // Append new master codes to TAIL — do NOT re-sort
              merged.push(masterItem);
            }
          });

          // Normalize standard row IDs — ensure uniqueness for rows sharing an itemId
          const seenIds = new Map<string, number>();
          merged.forEach((row) => {
            if (row.itemId && row.id && row.id.startsWith("row-")) {
              const baseId = `row-${row.itemId}`;
              const count = (seenIds.get(baseId) || 0) + 1;
              seenIds.set(baseId, count);
              row.id = count === 1 ? baseId : `${baseId}-${count}`;
            }
          });

          // DO NOT sort — honor sort_order from DB to preserve manual row positions
          setRows(merged);
        } else {
          // First initialization — sort by itemId for clean divisional ordering
          const defaultRows = initializeDefaultEstimateRows();
          setRows(defaultRows);
        }

        // Apply column definitions
        if (savedColDefs) {
          const normalizeColumnDefs = (loaded: ColumnDefinition[]): ColumnDefinition[] => {
            const merged = [...loaded].filter((col, idx, self) => self.findIndex(c => c.id === col.id) === idx);
            const actIdx = merged.findIndex(c => c.id === "actions");
            if (actIdx === -1) {
              merged.unshift({ id: "actions", header: "", type: "default" });
            } else if (actIdx > 0) {
              const [col] = merged.splice(actIdx, 1);
              merged.unshift(col);
            }
            const valIdx = merged.findIndex(c => c.id === "validationStatus");
            if (valIdx === -1) {
              merged.splice(1, 0, { id: "validationStatus", header: "", type: "default" });
            } else if (valIdx !== 1) {
              const [col] = merged.splice(valIdx, 1);
              merged.splice(1, 0, col);
            }
            if (!merged.some(c => c.id === "notes")) {
              const totIdx = merged.findIndex(c => c.id === "total");
              if (totIdx !== -1) {
                merged.splice(totIdx + 1, 0, { id: "notes", header: "", type: "default" });
              } else {
                merged.push({ id: "notes", header: "", type: "default" });
              }
            }
            return merged;
          };
          setColumnDefs(normalizeColumnDefs(savedColDefs));
        }

        // Apply cell locks
        setLockedCells(savedLocks);
      } catch (err) {
        console.error('Failed to load workbook data:', err);
        if (!cancelled) {
          // Graceful degradation: initialize with defaults
          const defaultRows = initializeDefaultEstimateRows();
          setRows(defaultRows);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [projectId, setColumnDefs, setLockedCells]);

  // ---------------------------------------------------------------------------
  // Insert manual row
  // ---------------------------------------------------------------------------
  const insertManualRow = (direction: "above" | "below", targetIndex: number) => {
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

    // pushCommand BEFORE state setter (AGENTS.md guardrail)
    commandHistory.pushCommand({
      type: "INSERT_ROW",
      rowId: newRow.id,
      insertIndex: insertIdx,
      rowData: { ...newRow },
    });

    const updated = [...rows];
    updated.splice(insertIdx, 0, newRow);
    setRows(updated);
  };

  // ---------------------------------------------------------------------------
  // Delete row — GAP-2: uses rowId (not index) for virtualization/sort safety
  // ---------------------------------------------------------------------------
  const deleteRow = (rowId: string) => {
    const idx = rows.findIndex((r) => r.id === rowId);
    if (idx === -1) return;

    // Deep-clone row data for undo restoration (GAP-3)
    const rowData: ProcessedTakeoffRow = {
      ...rows[idx],
      rawQuantities: rows[idx].rawQuantities.map((rq) => ({ ...rq })),
      customFields: { ...(rows[idx].customFields || {}) },
    };

    // pushCommand BEFORE state setter (AGENTS.md guardrail)
    commandHistory.pushCommand({
      type: "DELETE_ROW",
      rowId,
      deletedIndex: idx,
      rowData,
    });

    setRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  // ---------------------------------------------------------------------------
  // TanStack table columns — maps columnDefs to TanStack ColumnDef instances
  // ---------------------------------------------------------------------------
  const columnHelper = createColumnHelper<ProcessedTakeoffRow>();

  // Default pixel widths for built-in columns. ColumnDefinition.size overrides these.
  const DEFAULT_COLUMN_SIZES: Record<string, { size: number; minSize: number; maxSize?: number }> = {
    actions:          { size: 40,  minSize: 40,  maxSize: 40  },
    validationStatus: { size: 45,  minSize: 45,  maxSize: 45  },
    costType:    { size: 110, minSize: 30 },
    itemId:      { size: 220, minSize: 30 },
    description: { size: 600, minSize: 30 },
    matchedQty:  { size: 180, minSize: 30 },
    uom:         { size: 110, minSize: 30 },
    unitPrice:   { size: 180, minSize: 30 },
    total:       { size: 200, minSize: 30 },
    notes:            { size: 55,  minSize: 55,  maxSize: 55  },
    costPerUnit: { size: 180, minSize: 30 },
    costPerSf:   { size: 180, minSize: 30 },
  };

  /** Resolve column size from ColumnDefinition overrides or DEFAULT_COLUMN_SIZES. */
  const getSizeConfig = (def: ColumnDefinition) => {
    if (def.size != null) {
      return { size: def.size, minSize: def.minSize ?? 50, maxSize: def.maxSize };
    }
    return DEFAULT_COLUMN_SIZES[def.id] ?? { size: 150, minSize: 50 };
  };

  const columns = useMemo(() => {
    return columnDefs.map((def) => {
      if (def.type === "custom") {
        // Custom Column
        return columnHelper.accessor((row) => row.customFields?.[def.id] ?? "", {
          id: def.id,
          header: def.header,
          ...getSizeConfig(def),
          cell: (info) => {
            const index = info.row.index;
            const row = info.row.original;
            const meta = info.table.options.meta!;
            const isCellHardLocked = !!meta.lockedCells[`${row.id}::${def.id}`];
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
                onFocus={(e) => { e.currentTarget.select(); focusedCustomCellRef.current = { rowId: row.id, columnId: def.id, initialValue: String(val) }; }}
                onBlur={() => {
                  const fc = focusedCustomCellRef.current;
                  if (fc && fc.rowId === row.id && fc.columnId === def.id) {
                    const currentVal = String(row.customFields?.[def.id] ?? "");
                    if (currentVal !== fc.initialValue) {
                      commitCustomCellEdit(fc.rowId, fc.columnId, fc.initialValue, currentVal);
                    }
                    focusedCustomCellRef.current = null;
                  }
                }}
                onKeyDown={(e) => handleCustomKeyDown(e, index, def.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  meta.setContextMenu({ visible: true, x: e.clientX, y: e.clientY, rowIndex: index, columnId: def.id });
                }}
                placeholder="..."
              />
            );
          },
        });
      }

      switch (def.id) {
        case "actions":
          return columnHelper.display({
            id: "actions",
            header: "",
            ...getSizeConfig(def),
            cell: (info) => {
              const row = info.row.original;
              const meta = info.table.options.meta!;
              return (
                <div className="flex items-center justify-center h-full w-full">
                  <button
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-slate-400 hover:text-red-500 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm("Delete this row? This action can be undone with Ctrl+Z.")) {
                        meta.deleteRow(row.id);
                      }
                    }}
                    title="Delete Row"
                  >
                    <Trash className="w-4 h-4" />
                  </button>
                </div>
              );
            },
          });
        case "validationStatus":
          return columnHelper.accessor("isMapped", {
            id: "validationStatus",
            header: "",
            ...getSizeConfig(def),
            cell: (info) => {
              const row = info.row.original;
              const meta = info.table.options.meta!;
              const hasLockedCell = Object.keys(meta.lockedCells).some(
                (key) => key.startsWith(`${row.id}::`) && meta.lockedCells[key]
              );
              
              return (
                <div className="flex items-center justify-center h-full w-full">
                  {hasLockedCell ? (
                    <span className="text-blue-500 text-xs select-none" title="Row contains locked values">🔒</span>
                  ) : !row.isMapped ? (
                    <span className="text-amber-500 text-xs select-none animate-pulse" title="Item not mapped to corporate registry">⚠️</span>
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" title="Verified & Mapped" />
                  )}
                </div>
              );
            },
          });
        case "notes":
          return columnHelper.display({
            id: "notes",
            header: "",
            ...getSizeConfig(def),
            cell: (info) => {
              const row = info.row.original;
              const meta = info.table.options.meta!;
              const noteText = String(row.customFields?.notes || "");
              return (
                <div className="flex items-center justify-center h-full w-full">
                  <button
                    className={`p-1.5 rounded transition-all duration-200 ${
                      noteText
                        ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/40"
                        : "text-slate-400 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      const currentVal = String(row.customFields?.notes || "");
                      const newVal = window.prompt("Edit Estimator Notes:", currentVal);
                      if (newVal !== null && newVal !== currentVal) {
                        meta.handleCustomCellEdit(info.row.index, "notes", newVal);
                        meta.commitCustomCellEdit(row.id, "notes", currentVal, newVal);
                      }
                    }}
                    title={noteText ? `Notes: ${noteText}` : "Add Notes"}
                  >
                    <MessageSquare className="w-4 h-4" />
                  </button>
                </div>
              );
            },
          });
        case "costType":
          return columnHelper.accessor("costType", {
            header: def.header,
            ...getSizeConfig(def),
            cell: (info) => (
              <div className="text-center text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {info.getValue()}
              </div>
            ),
          });
        case "itemId": {
          return columnHelper.accessor("itemId", {
            header: def.header,
            ...getSizeConfig(def),
            cell: (info) => {
              const index = info.row.index;
              const row = info.row.original;
              const meta = info.table.options.meta!;
              const isCellHardLocked = !!meta.lockedCells[`${row.id}::itemId`];
              const suggestions = getFuzzySuggestions(row.classification, ESTIMATE_ITEMS_MASTER);
              return (
                <div className="flex items-center gap-2 relative">
                  <input
                    id={`code-input-${index}`}
                    type="text"
                    disabled={isCellHardLocked}
                    className={`w-full h-full min-h-[36px] px-3 py-2 bg-transparent border-none rounded-none outline-none font-mono text-xs transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-10 focus:bg-white dark:focus:bg-slate-900/40 ${
                      isCellHardLocked
                        ? "text-slate-600 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-950/30 cursor-not-allowed opacity-60"
                        : !row.isMapped && row.classification
                        ? "text-amber-600 dark:text-amber-400 font-bold"
                        : "text-slate-900 dark:text-white font-bold"
                    }`}
                    value={row.itemId}
                    onChange={(e) => meta.handleCellEdit(index, "itemId", e.target.value)}
                    onFocus={(e) => { e.currentTarget.select(); meta.focusedCellRef.current = { rowId: row.id, field: "itemId", initialValue: row.itemId }; }}
                    onBlur={() => {
                      const fc = meta.focusedCellRef.current;
                      if (fc && fc.rowId === row.id && fc.field === "itemId") {
                        const currentVal = row.itemId;
                        if (currentVal !== fc.initialValue) {
                          meta.commitCellEdit(fc.rowId, "itemId" as keyof ProcessedTakeoffRow, fc.initialValue, currentVal);
                        }
                        meta.focusedCellRef.current = null;
                      }
                    }}
                    onKeyDown={(e) => meta.handleKeyDown(e, index, "code")}
                    onPaste={(e) => meta.handlePaste(e, index, "code")}
                    list={!row.isMapped && row.classification ? `suggestions-${index}` : undefined}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      meta.setContextMenu({ visible: true, x: e.clientX, y: e.clientY, rowIndex: index, columnId: "itemId" });
                    }}
                  />
                  {!row.isMapped && row.classification && suggestions.length > 0 && (
                    <div className="absolute right-1 top-1/2 -translate-y-1/2 flex gap-1">
                      {suggestions.slice(0, 2).map((s) => (
                        <button
                          key={s.itemId}
                          className="text-[10px] bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 rounded cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-800/60 text-blue-700 dark:text-blue-300 transition-colors"
                          onClick={() => {
                            meta.handleCellEdit(index, "itemId", s.itemId);
                            meta.commitCellEdit(row.id, "itemId", row.itemId, s.itemId);
                          }}
                          title={`${s.itemId}: ${s.description}`}
                        >
                          {s.itemId}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            },
          });
        }
        case "description":
          return columnHelper.accessor("description", {
            header: def.header,
            ...getSizeConfig(def),
            cell: (info) => {
              const index = info.row.index;
              const row = info.row.original;
              const meta = info.table.options.meta!;
              const isCellHardLocked = !!meta.lockedCells[`${row.id}::description`];
              return (
                <input
                  id={`desc-input-${index}`}
                  type="text"
                  disabled={isCellHardLocked}
                  className={`w-full h-full min-h-[36px] px-3 py-2 bg-transparent border-none rounded-none outline-none text-xs transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-10 focus:bg-white dark:focus:bg-slate-900/40 ${
                    isCellHardLocked
                      ? "text-slate-600 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-950/30 cursor-not-allowed opacity-60"
                      : "text-slate-900 dark:text-slate-100 font-medium"
                  }`}
                  value={row.description}
                  onChange={(e) => meta.handleCellEdit(index, "description", e.target.value)}
                  onFocus={(e) => { e.currentTarget.select(); meta.focusedCellRef.current = { rowId: row.id, field: "description", initialValue: row.description }; }}
                  onBlur={() => {
                    const fc = meta.focusedCellRef.current;
                    if (fc && fc.rowId === row.id && fc.field === "description") {
                      const currentVal = row.description;
                      if (currentVal !== fc.initialValue) {
                        meta.commitCellEdit(fc.rowId, "description" as keyof ProcessedTakeoffRow, fc.initialValue, currentVal);
                      }
                      meta.focusedCellRef.current = null;
                    }
                  }}
                  onKeyDown={(e) => meta.handleKeyDown(e, index, "desc")}
                  onPaste={(e) => meta.handlePaste(e, index, "desc")}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    meta.setContextMenu({ visible: true, x: e.clientX, y: e.clientY, rowIndex: index, columnId: "description" });
                  }}
                />
              );
            },
          });
        case "matchedQty": {
          return columnHelper.accessor("matchedQty", {
            header: def.header,
            ...getSizeConfig(def),
            cell: (info) => {
              const index = info.row.index;
              const row = info.row.original;
              const meta = info.table.options.meta!;
              const isCellHardLocked = !!meta.lockedCells[`${row.id}::matchedQty`];
              return (
                <NumberCellInput
                  id={`qty-input-${index}`}
                  value={row.matchedQty}
                  disabled={isCellHardLocked}
                  className={`w-full h-full min-h-[36px] px-3 py-2 bg-transparent border-none rounded-none text-center font-bold outline-none font-mono text-xs transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-10 focus:bg-white dark:focus:bg-slate-900/40 ${
                    isCellHardLocked
                      ? "text-slate-600 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-950/30 cursor-not-allowed opacity-60"
                      : "text-slate-900 dark:text-white"
                  }`}
                  onCommit={(numVal) => {
                    meta.handleCellEdit(index, "matchedQty", numVal);
                    meta.commitCellEdit(row.id, "matchedQty" as keyof ProcessedTakeoffRow, row.matchedQty, numVal);
                  }}
                  onLiveChange={(numVal) => {
                    meta.handleCellEdit(index, "matchedQty", numVal);
                  }}
                  onKeyDown={(e) => meta.handleKeyDown(e, index, "qty")}
                  onPaste={(e) => meta.handlePaste(e, index, "qty")}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    meta.setContextMenu({ visible: true, x: e.clientX, y: e.clientY, rowIndex: index, columnId: "matchedQty" });
                  }}
                />
              );
            },
          });
        }
        case "uom":
          return columnHelper.accessor("uom", {
            header: def.header,
            ...getSizeConfig(def),
            cell: (info) => (
              <div className="text-center text-slate-600 dark:text-slate-400 font-bold uppercase font-mono">
                {info.getValue()}
              </div>
            ),
          });
        case "unitPrice": {
          return columnHelper.accessor("unitPrice", {
            header: def.header,
            ...getSizeConfig(def),
            cell: (info) => {
              const index = info.row.index;
              const row = info.row.original;
              const meta = info.table.options.meta!;
              const isCellHardLocked = !!meta.lockedCells[`${row.id}::unitPrice`];
              return (
                <NumberCellInput
                  id={`price-input-${index}`}
                  value={row.unitPrice}
                  disabled={isCellHardLocked}
                  className={`w-full h-full min-h-[36px] px-3 py-2 bg-transparent border-none rounded-none text-center font-bold outline-none font-mono text-xs transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:z-10 focus:bg-white dark:focus:bg-slate-900/40 ${
                    isCellHardLocked
                      ? "text-slate-600 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-950/30 cursor-not-allowed opacity-60"
                      : "text-slate-900 dark:text-white"
                  }`}
                  onCommit={(numVal) => {
                    meta.handleCellEdit(index, "unitPrice", numVal);
                    meta.commitCellEdit(row.id, "unitPrice" as keyof ProcessedTakeoffRow, row.unitPrice, numVal);
                  }}
                  onLiveChange={(numVal) => {
                    meta.handleCellEdit(index, "unitPrice", numVal);
                  }}
                  onKeyDown={(e) => meta.handleKeyDown(e, index, "price")}
                  onPaste={(e) => meta.handlePaste(e, index, "price")}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    meta.setContextMenu({ visible: true, x: e.clientX, y: e.clientY, rowIndex: index, columnId: "unitPrice" });
                  }}
                />
              );
            },
          });
        }
        case "total":
          return columnHelper.accessor("total", {
            header: def.header,
            ...getSizeConfig(def),
            cell: (info) => (
              <div className="text-center font-black font-mono">
                <span className={info.getValue() > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-600 dark:text-slate-400"}>
                  ${info.getValue().toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            ),
          });
        case "costPerUnit":
          return columnHelper.accessor((row) => (unitCount > 0 ? row.total / unitCount : 0), {
            id: "costPerUnit",
            header: def.header,
            ...getSizeConfig(def),
            cell: (info) => (
              <div className="text-center font-bold font-mono text-slate-600 dark:text-slate-300">
                ${info.getValue().toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            ),
          });
        case "costPerSf":
          return columnHelper.accessor((row) => (squareFootage > 0 ? row.total / squareFootage : 0), {
            id: "costPerSf",
            header: def.header,
            ...getSizeConfig(def),
            cell: (info) => (
              <div className="text-center font-bold font-mono text-slate-600 dark:text-slate-300">
                ${info.getValue().toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            ),
          });
        default:
          return columnHelper.display({ id: def.id, header: def.header, ...getSizeConfig(def), cell: () => null });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnDefs, unitCount, squareFootage, handleCustomCellEdit, commitCustomCellEdit]);

  // Sort / Filter state (Phase 4)
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  // Instantiate TanStack table with sort/filter pipeline
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnFilters, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    columnResizeMode: "onChange",
    columnResizeDirection: "ltr",
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    meta: {
      editingCellId,
      editingValues,
      setEditingCellId,
      setEditingValues,
      flushEditingBufferRef,
      focusedCellRef,
      lockedCells,
      handleCellEdit,
      commitCellEdit,
      handleKeyDown,
      handlePaste,
      setContextMenu,
      deleteRow,
      insertManualRow,
      handleCustomCellEdit,
      commitCustomCellEdit,
    },
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
    canUndo: commandHistory.canUndo,
    canRedo: commandHistory.canRedo,
    undoStackSize: commandHistory.undoStackSize,
    redoStackSize: commandHistory.redoStackSize,
    isExportingExcel,
    exportError,
    setExportError,
    rowVersion,
    globalFilter,
    setGlobalFilter,
    sorting,
    columnFilters,
    handleCellEdit,
    commitCellEdit,
    handleCustomCellEdit,
    commitCustomCellEdit,
    handleKeyDown,
    handleCustomKeyDown,
    handlePaste,
    handleAddCustomColumn,
    handleDeleteColumn,
    handleRenameColumn,
    insertManualRow,
    deleteRow,
    handleToggleCellLock,
    handleFileUpload,
    handleDrag,
    handleDrop,
    handleExportExcel,
    handleExportProcore,
    handleExportExcelWorkbook,
    handleUndo,
    handleRedo,
  };
}
