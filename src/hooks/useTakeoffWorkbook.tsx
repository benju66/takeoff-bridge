"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import Papa from "papaparse";
import {
  useReactTable,
  getCoreRowModel,
  createColumnHelper,
} from "@tanstack/react-table";
import { parseTogalCSV } from "@/lib/parser";
import { ESTIMATE_ITEMS_MASTER } from "@/lib/mock-data";
import { ProcessedTakeoffRow, TogalRowPayload, ColumnDefinition, ContextMenuState, WorkbookCommand } from "@/types";
import { Project } from "@/types/db";
import {
  getEstimateLineItems,
  getProjectRegistry,
  getGlobalRegistry,
  getProjectColumnDefs,
  getProjectLockedCells,
  saveProjectRegistry,
  saveGlobalRegistry,
} from "@/lib/db";
import { generateExcelPayload, generateProcoreBudget, generateExcelWorkbook } from "@/lib/exporter";
import { getFuzzySuggestions } from "@/lib/similarity";
import { useCommandHistory } from "./useCommandHistory";
import { useLockedCells } from "./useLockedCells";
import { useColumnDefinitions } from "./useColumnDefinitions";
import { useKeyboardNavigation } from "./useKeyboardNavigation";

// ---------------------------------------------------------------------------
// useTakeoffWorkbook — Core Step 4 grid state, handlers, and TanStack table
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

/** Fields that applyCellEditDirect cascades to sibling rows */
const CASCADE_FIELDS: Set<keyof ProcessedTakeoffRow> = new Set(["itemId", "description", "unitPrice"]);

export function useTakeoffWorkbook(
  projectId: string,
  isLoaded: boolean,
  project: Project | null
): UseTakeoffWorkbookReturn {
  const unitCount = project?.unitCount ?? 0;
  const squareFootage = project?.squareFootage ?? 0;

  // Core row data
  const [rows, setRows] = useState<ProcessedTakeoffRow[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [appendData, setAppendData] = useState(false);

  // Registry state (project-isolated → global corporate)
  const [userRegistry, setUserRegistry] = useState<Record<string, string>>({});
  const [globalRegistry, setGlobalRegistry] = useState<Record<string, string>>({});

  // Context menu
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false, x: 0, y: 0, rowIndex: -1, columnId: "",
  });

  // Unmapped classifications
  const [unmappedTakeoffClassifications, setUnmappedTakeoffClassifications] = useState<string[]>([]);

  // Export state
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Command Pattern history engine (replaces snapshot deep-clone system)
  const commandHistory = useCommandHistory();

  // Stable refs — must be declared before hooks that consume them
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  // --- Extracted hooks ---
  const {
    lockedCells, setLockedCells, handleToggleCellLock,
  } = useLockedCells(projectId, isLoaded, commandHistory);

  const {
    columnDefs, setColumnDefs,
    handleAddCustomColumn, handleDeleteColumn, handleRenameColumn,
  } = useColumnDefinitions(projectId, isLoaded, commandHistory, rowsRef);

  // Remaining stable refs
  const userRegistryRef = useRef(userRegistry);
  useEffect(() => { userRegistryRef.current = userRegistry; }, [userRegistry]);
  const globalRegistryRef = useRef(globalRegistry);
  useEffect(() => { globalRegistryRef.current = globalRegistry; }, [globalRegistry]);
  const unmappedRef = useRef(unmappedTakeoffClassifications);
  useEffect(() => { unmappedRef.current = unmappedTakeoffClassifications; }, [unmappedTakeoffClassifications]);

  const { handleKeyDown, handleCustomKeyDown } = useKeyboardNavigation(rowsRef);

  // Focus tracking refs for blur-based commit
  const focusedCellRef = useRef<{ rowId: string; field: string; initialValue: string | number | boolean } | null>(null);
  const focusedCustomCellRef = useRef<{ rowId: string; columnId: string; initialValue: string } | null>(null);

  // ---------------------------------------------------------------------------
  // applyCommandForward — Execute a command's FORWARD (next) effect on state
  // ---------------------------------------------------------------------------
  const applyCommandForward = useCallback((cmd: WorkbookCommand) => {
    switch (cmd.type) {
      case "EDIT_CELL": {
        setRows((prev) => {
          const updated = [...prev];
          const idx = updated.findIndex((r) => r.id === cmd.rowId);
          if (idx === -1) return prev;
          const row = { ...updated[idx] };
          (row as Record<string, unknown>)[cmd.field] = cmd.nextValue;
          if (cmd.field === "matchedQty" || cmd.field === "unitPrice") {
            row.total = row.matchedQty * row.unitPrice;
          }
          updated[idx] = row;
          if (cmd.cascadeEffects) {
            for (const effect of cmd.cascadeEffects) {
              const si = updated.findIndex((r) => r.id === effect.rowId);
              if (si !== -1) {
                updated[si] = { ...updated[si], ...effect.nextFields };
                if (effect.nextFields.matchedQty !== undefined || effect.nextFields.unitPrice !== undefined) {
                  updated[si].total = updated[si].matchedQty * updated[si].unitPrice;
                }
              }
            }
          }
          return updated;
        });
        if (cmd.registryDelta) {
          if (cmd.registryDelta.projectRegistry) {
            const rd = cmd.registryDelta.projectRegistry;
            setUserRegistry((prev) => {
              const next = { ...prev, [rd.key]: rd.nextValue };
              saveProjectRegistry(projectId, next).catch((err) => console.error('Registry persist failed:', err));
              return next;
            });
          }
          if (cmd.registryDelta.globalRegistry) {
            const rd = cmd.registryDelta.globalRegistry;
            setGlobalRegistry((prev) => {
              const next = { ...prev, [rd.key]: rd.nextValue };
              saveGlobalRegistry(next).catch((err) => console.error('Global registry persist failed:', err));
              return next;
            });
          }
        }
        break;
      }
      case "EDIT_CUSTOM_CELL": {
        setRows((prev) => {
          const updated = [...prev];
          const idx = updated.findIndex((r) => r.id === cmd.rowId);
          if (idx === -1) return prev;
          const row = { ...updated[idx] };
          row.customFields = { ...(row.customFields || {}), [cmd.columnId]: cmd.nextValue };
          updated[idx] = row;
          return updated;
        });
        break;
      }
      case "PASTE": {
        setRows((prev) => {
          const updated = [...prev];
          for (const edit of cmd.edits) {
            const idx = updated.findIndex((r) => r.id === edit.rowId);
            if (idx !== -1) {
              updated[idx] = { ...updated[idx], ...edit.nextFields };
              if (edit.nextFields.matchedQty !== undefined || edit.nextFields.unitPrice !== undefined) {
                updated[idx].total = updated[idx].matchedQty * updated[idx].unitPrice;
              }
            }
          }
          return updated;
        });
        if (cmd.registryDelta) {
          if (cmd.registryDelta.projectRegistry) {
            setUserRegistry((prev) => {
              const next = { ...prev };
              for (const [key, val] of Object.entries(cmd.registryDelta!.projectRegistry!)) {
                next[key] = val.next;
              }
              saveProjectRegistry(projectId, next).catch((err) => console.error('Registry persist failed:', err));
              return next;
            });
          }
          if (cmd.registryDelta.globalRegistry) {
            setGlobalRegistry((prev) => {
              const next = { ...prev };
              for (const [key, val] of Object.entries(cmd.registryDelta!.globalRegistry!)) {
                next[key] = val.next;
              }
              saveGlobalRegistry(next).catch((err) => console.error('Global registry persist failed:', err));
              return next;
            });
          }
        }
        break;
      }
      case "INSERT_ROW": {
        setRows((prev) => {
          const updated = [...prev];
          updated.splice(cmd.insertIndex, 0, { ...cmd.rowData });
          return updated;
        });
        break;
      }
      case "DELETE_ROW": {
        setRows((prev) => prev.filter((r) => r.id !== cmd.rowId));
        break;
      }
      case "DELETE_COLUMN": {
        setColumnDefs((prev) => prev.filter((col) => col.id !== cmd.columnDef.id));
        break;
      }
      case "ADD_COLUMN": {
        setColumnDefs((prev) => [...prev, cmd.columnDef]);
        break;
      }
      case "TOGGLE_CELL_LOCK": {
        setLockedCells((prev) => ({ ...prev, [cmd.cellKey]: cmd.nextLocked }));
        break;
      }
      case "MERGE_TAKEOFF_DATA": {
        setRows((prev) => {
          const updated = [...prev];
          for (const ns of cmd.nextRowStates) {
            const idx = updated.findIndex((r) => r.id === ns.rowId);
            if (idx !== -1) {
              updated[idx] = { ...updated[idx], ...ns.fields };
              if (ns.fields.rawQuantities) {
                updated[idx].rawQuantities = ns.fields.rawQuantities.map((rq) => ({ ...rq }));
              }
            }
          }
          return updated;
        });
        setUnmappedTakeoffClassifications(cmd.nextUnmapped);
        break;
      }
    }
  }, [projectId, setColumnDefs, setLockedCells]);

  // ---------------------------------------------------------------------------
  // applyCommandInverse — Execute a command's INVERSE (prev) effect on state
  // ---------------------------------------------------------------------------
  const applyCommandInverse = useCallback((cmd: WorkbookCommand) => {
    switch (cmd.type) {
      case "EDIT_CELL": {
        setRows((prev) => {
          const updated = [...prev];
          const idx = updated.findIndex((r) => r.id === cmd.rowId);
          if (idx === -1) return prev;
          const row = { ...updated[idx] };
          (row as Record<string, unknown>)[cmd.field] = cmd.prevValue;
          if (cmd.field === "matchedQty" || cmd.field === "unitPrice") {
            row.total = row.matchedQty * row.unitPrice;
          }
          updated[idx] = row;
          if (cmd.cascadeEffects) {
            for (const effect of cmd.cascadeEffects) {
              const si = updated.findIndex((r) => r.id === effect.rowId);
              if (si !== -1) {
                updated[si] = { ...updated[si], ...effect.prevFields };
                if (effect.prevFields.matchedQty !== undefined || effect.prevFields.unitPrice !== undefined) {
                  updated[si].total = updated[si].matchedQty * updated[si].unitPrice;
                }
              }
            }
          }
          return updated;
        });
        if (cmd.registryDelta) {
          if (cmd.registryDelta.projectRegistry) {
            const rd = cmd.registryDelta.projectRegistry;
            setUserRegistry((prev) => {
              const next = { ...prev, [rd.key]: rd.prevValue };
              saveProjectRegistry(projectId, next).catch((err) => console.error('Registry persist failed:', err));
              return next;
            });
          }
          if (cmd.registryDelta.globalRegistry) {
            const rd = cmd.registryDelta.globalRegistry;
            setGlobalRegistry((prev) => {
              const next = { ...prev, [rd.key]: rd.prevValue };
              saveGlobalRegistry(next).catch((err) => console.error('Global registry persist failed:', err));
              return next;
            });
          }
        }
        break;
      }
      case "EDIT_CUSTOM_CELL": {
        setRows((prev) => {
          const updated = [...prev];
          const idx = updated.findIndex((r) => r.id === cmd.rowId);
          if (idx === -1) return prev;
          const row = { ...updated[idx] };
          row.customFields = { ...(row.customFields || {}), [cmd.columnId]: cmd.prevValue };
          updated[idx] = row;
          return updated;
        });
        break;
      }
      case "PASTE": {
        setRows((prev) => {
          const updated = [...prev];
          // Iterate in reverse for clean undo ordering
          for (let i = cmd.edits.length - 1; i >= 0; i--) {
            const edit = cmd.edits[i];
            const idx = updated.findIndex((r) => r.id === edit.rowId);
            if (idx !== -1) {
              updated[idx] = { ...updated[idx], ...edit.prevFields };
              if (edit.prevFields.matchedQty !== undefined || edit.prevFields.unitPrice !== undefined) {
                updated[idx].total = updated[idx].matchedQty * updated[idx].unitPrice;
              }
            }
          }
          return updated;
        });
        if (cmd.registryDelta) {
          if (cmd.registryDelta.projectRegistry) {
            setUserRegistry((prev) => {
              const next = { ...prev };
              for (const [key, val] of Object.entries(cmd.registryDelta!.projectRegistry!)) {
                next[key] = val.prev;
              }
              saveProjectRegistry(projectId, next).catch((err) => console.error('Registry persist failed:', err));
              return next;
            });
          }
          if (cmd.registryDelta.globalRegistry) {
            setGlobalRegistry((prev) => {
              const next = { ...prev };
              for (const [key, val] of Object.entries(cmd.registryDelta!.globalRegistry!)) {
                next[key] = val.prev;
              }
              saveGlobalRegistry(next).catch((err) => console.error('Global registry persist failed:', err));
              return next;
            });
          }
        }
        break;
      }
      case "INSERT_ROW": {
        setRows((prev) => prev.filter((r) => r.id !== cmd.rowId));
        break;
      }
      case "DELETE_ROW": {
        setRows((prev) => {
          const updated = [...prev];
          // Re-insert at original position with deep-cloned data
          updated.splice(cmd.deletedIndex, 0, {
            ...cmd.rowData,
            rawQuantities: cmd.rowData.rawQuantities.map((rq) => ({ ...rq })),
            customFields: { ...(cmd.rowData.customFields || {}) },
          });
          return updated;
        });
        break;
      }
      case "DELETE_COLUMN": {
        setColumnDefs((prev) => {
          const updated = [...prev];
          updated.splice(cmd.columnIndex, 0, cmd.columnDef);
          return updated;
        });
        setRows((prev) => {
          return prev.map((r) => {
            const cellVal = cmd.cellValues[r.id];
            if (cellVal !== undefined) {
              return { ...r, customFields: { ...(r.customFields || {}), [cmd.columnDef.id]: cellVal } };
            }
            return r;
          });
        });
        break;
      }
      case "ADD_COLUMN": {
        setColumnDefs((prev) => prev.filter((col) => col.id !== cmd.columnDef.id));
        break;
      }
      case "TOGGLE_CELL_LOCK": {
        setLockedCells((prev) => ({ ...prev, [cmd.cellKey]: cmd.prevLocked }));
        break;
      }
      case "MERGE_TAKEOFF_DATA": {
        setRows((prev) => {
          const updated = [...prev];
          for (const ps of cmd.prevRowStates) {
            const idx = updated.findIndex((r) => r.id === ps.rowId);
            if (idx !== -1) {
              updated[idx] = { ...updated[idx], ...ps.fields };
              if (ps.fields.rawQuantities) {
                updated[idx].rawQuantities = ps.fields.rawQuantities.map((rq) => ({ ...rq }));
              }
            }
          }
          return updated;
        });
        setUnmappedTakeoffClassifications(cmd.prevUnmapped);
        break;
      }
    }
  }, [projectId, setColumnDefs, setLockedCells]);

  // ---------------------------------------------------------------------------
  // handleUndo — Pop from undo stack and apply inverse
  // ---------------------------------------------------------------------------
  const handleUndo = useCallback(() => {
    const cmd = commandHistory.undo();
    if (!cmd) return;
    applyCommandInverse(cmd);
  }, [commandHistory, applyCommandInverse]);

  // ---------------------------------------------------------------------------
  // handleRedo — Pop from redo stack and apply forward
  // ---------------------------------------------------------------------------
  const handleRedo = useCallback(() => {
    const cmd = commandHistory.redo();
    if (!cmd) return;
    applyCommandForward(cmd);
  }, [commandHistory, applyCommandForward]);

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
          setColumnDefs(savedColDefs);
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
  // Auto-persist column definitions — handled by useColumnDefinitions hook
  // Auto-persist cell locks — handled by useLockedCells hook
  // ---------------------------------------------------------------------------

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
        },
      });
    }
    const prevUnmapped = [...unmappedRef.current];

    // Compute next state
    const updatedRows = currentRows.map((r) => {
      if (!appendData) {
        return { ...r, matchedQty: 0, total: 0, classification: "", rawQuantities: [] as { qty: number; uom: string }[] };
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
  // Toggle cell lock — delegated to useLockedCells hook
  // ---------------------------------------------------------------------------

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

      if (classification && classification !== "MANUAL ENTRY") {
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
        if (classification && classification !== "MANUAL ENTRY") {
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
      if (classification && classification !== "MANUAL ENTRY") {
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

      if (classification && classification !== "MANUAL ENTRY") {
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
  // Keyboard navigation — delegated to useKeyboardNavigation hook
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Paste handler
  // ---------------------------------------------------------------------------
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>, startRowIdx: number, type: "code" | "desc" | "qty" | "price") => {
    const clipboardData = e.clipboardData;
    const pastedText = clipboardData.getData("text") || "";

    if (pastedText.includes("\t") || pastedText.includes("\n") || pastedText.includes("\r")) {
      e.preventDefault();

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

      // Capture prevFields for each affected row BEFORE mutations
      const pasteEdits: Array<{
        rowId: string;
        field: keyof ProcessedTakeoffRow;
        prevFields: Partial<ProcessedTakeoffRow>;
        nextFields: Partial<ProcessedTakeoffRow>;
      }> = [];
      const prevRegistrySnapshot: Record<string, { prev: string; next: string }> = {};
      const prevGlobalRegistrySnapshot: Record<string, { prev: string; next: string }> = {};

      // Pre-capture row snapshots for all rows that will be affected
      const rowSnapshotsBefore: Record<number, Partial<ProcessedTakeoffRow>> = {};
      for (let i = 0; i < lines.length; i++) {
        const targetRowIdx = startRowIdx + i;
        if (targetRowIdx >= updated.length) break;
        const r = updated[targetRowIdx];
        rowSnapshotsBefore[targetRowIdx] = {
          itemId: r.itemId,
          description: r.description,
          matchedQty: r.matchedQty,
          unitPrice: r.unitPrice,
          total: r.total,
          isMapped: r.isMapped,
          procoreParentCode: r.procoreParentCode,
          uom: r.uom,
          costType: r.costType,
        };
      }
      // Also snapshot all rows for cascade captures (itemId edits cascade to siblings)
      const allRowSnapshotsBefore: Record<number, Partial<ProcessedTakeoffRow>> = {};
      for (let i = 0; i < updated.length; i++) {
        const r = updated[i];
        allRowSnapshotsBefore[i] = {
          itemId: r.itemId,
          description: r.description,
          matchedQty: r.matchedQty,
          unitPrice: r.unitPrice,
          total: r.total,
          isMapped: r.isMapped,
          procoreParentCode: r.procoreParentCode,
          uom: r.uom,
          costType: r.costType,
        };
      }

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

          // Capture registry key prev values before edit
          const row = updated[targetRowIdx];
          const classification = row?.classification;
          if (field === "itemId" && classification && classification !== "MANUAL ENTRY") {
            if (!prevRegistrySnapshot[classification]) {
              prevRegistrySnapshot[classification] = { prev: currentRegistry[classification] || "", next: "" };
            }
            if (!prevGlobalRegistrySnapshot[classification]) {
              prevGlobalRegistrySnapshot[classification] = { prev: currentGlobalRegistry[classification] || "", next: "" };
            }
          }

          const resultRegistry = applyCellEditDirect(updated, targetRowIdx, field, rawValue, currentRegistry);
          if (resultRegistry) {
            currentRegistry = resultRegistry;
            registryChanged = true;

            if (field === "itemId") {
              const r = updated[targetRowIdx];
              if (r) {
                currentGlobalRegistry = {
                  ...currentGlobalRegistry,
                  [r.classification]: String(rawValue).trim(),
                };
                globalRegistryChanged = true;
              }
            }
          }
        }
      }

      // Capture nextFields for all affected rows after mutations
      if (didModify) {
        // Build edits array from all rows that changed
        for (let i = 0; i < updated.length; i++) {
          const before = allRowSnapshotsBefore[i];
          if (!before) continue;
          const after = updated[i];
          // Check if this row was modified
          if (
            before.itemId !== after.itemId ||
            before.description !== after.description ||
            before.matchedQty !== after.matchedQty ||
            before.unitPrice !== after.unitPrice ||
            before.total !== after.total ||
            before.isMapped !== after.isMapped ||
            before.procoreParentCode !== after.procoreParentCode ||
            before.uom !== after.uom ||
            before.costType !== after.costType
          ) {
            // Determine which field to associate — use the first matching direct paste field
            const directLine = i - startRowIdx;
            let pasteField: keyof ProcessedTakeoffRow = "itemId";
            if (directLine >= 0 && directLine < lines.length) {
              const cells = lines[directLine].split("\t");
              if (cells.length > 0 && startColIdx < columnsList.length) {
                pasteField = columnsList[startColIdx];
              }
            }

            pasteEdits.push({
              rowId: after.id,
              field: pasteField,
              prevFields: { ...before },
              nextFields: {
                itemId: after.itemId,
                description: after.description,
                matchedQty: after.matchedQty,
                unitPrice: after.unitPrice,
                total: after.total,
                isMapped: after.isMapped,
                procoreParentCode: after.procoreParentCode,
                uom: after.uom,
                costType: after.costType,
              },
            });
          }
        }

        // Finalize registry delta next values
        for (const key of Object.keys(prevRegistrySnapshot)) {
          prevRegistrySnapshot[key].next = currentRegistry[key] || "";
        }
        for (const key of Object.keys(prevGlobalRegistrySnapshot)) {
          prevGlobalRegistrySnapshot[key].next = currentGlobalRegistry[key] || "";
        }

        const registryDelta: {
          projectRegistry?: Record<string, { prev: string; next: string }>;
          globalRegistry?: Record<string, { prev: string; next: string }>;
        } = {};
        if (registryChanged) {
          registryDelta.projectRegistry = prevRegistrySnapshot;
        }
        if (globalRegistryChanged) {
          registryDelta.globalRegistry = prevGlobalRegistrySnapshot;
        }

        // pushCommand BEFORE state setters (AGENTS.md guardrail)
        commandHistory.pushCommand({
          type: "PASTE",
          edits: pasteEdits,
          registryDelta: Object.keys(registryDelta).length > 0 ? registryDelta : undefined,
        });

        if (registryChanged) {
          setUserRegistry(currentRegistry);
          saveProjectRegistry(projectId, currentRegistry).catch((err) => console.error('Registry persist failed:', err));
        }
        if (globalRegistryChanged) {
          setGlobalRegistry(currentGlobalRegistry);
          saveGlobalRegistry(currentGlobalRegistry).catch((err) => console.error('Global registry persist failed:', err));
        }
        setRows(updated);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Cell edit handler — PURE STATE MUTATOR (no history push)
  // ---------------------------------------------------------------------------
  const handleCellEdit = (index: number, field: keyof ProcessedTakeoffRow, value: string | number) => {
    const updated = [...rows];
    const newRegistry = applyCellEditDirect(updated, index, field, value, userRegistry);

    const classification = updated[index]?.classification;
    if (classification && classification !== "MANUAL ENTRY") {
      if (newRegistry) {
        setUserRegistry(newRegistry);
        saveProjectRegistry(projectId, newRegistry).catch((err) => console.error('Registry persist failed:', err));

        if (classification && field === "itemId") {
          const newGlobalRegistry = {
            ...globalRegistry,
            [classification]: String(value).trim(),
          };
          setGlobalRegistry(newGlobalRegistry);
          saveGlobalRegistry(newGlobalRegistry).catch((err) => console.error('Global registry persist failed:', err));
        }
      }
    }
    setRows(updated);
  };
  // ---------------------------------------------------------------------------
  // commitCellEdit — Build command + push history on blur or direct commit
  //
  // C1 FIX (enterprise): applyCellEditDirect cascades three field types to
  // sibling rows sharing the same classification:
  //   - itemId:     9 fields (itemId, description, procoreParentCode, unitPrice,
  //                 uom, costType, matchedQty, total, isMapped)
  //   - description: 1 field (description)
  //   - unitPrice:  2 fields (unitPrice, total)
  //
  // The cascade may or may not have already been applied to rowsRef.current
  // depending on the call path (button = pre-cascade, blur = post-cascade).
  //
  // To make cascade capture TIMING-INDEPENDENT, we simulate the cascade in
  // BOTH directions by running applyCellEditDirect on cloned row arrays:
  //   1. Clone rows → apply prevValue → capture sibling state = prevFields
  //   2. Clone rows → apply nextValue → capture sibling state = nextFields
  //
  // This produces correct prev/next sibling snapshots regardless of whether
  // the actual mutation has already happened in React state.
  // ---------------------------------------------------------------------------


  const commitCellEdit = useCallback((
    rowId: string,
    field: keyof ProcessedTakeoffRow,
    prevValue: string | number | boolean,
    nextValue: string | number | boolean
  ) => {
    const currentRows = rowsRef.current;
    const idx = currentRows.findIndex((r) => r.id === rowId);
    if (idx === -1) return;

    const row = currentRows[idx];
    const classification = row.classification;

    // Build cascade effects for fields that propagate to sibling rows
    let cascadeEffects: Array<{
      rowId: string;
      prevFields: Partial<ProcessedTakeoffRow>;
      nextFields: Partial<ProcessedTakeoffRow>;
    }> | undefined;

    if (CASCADE_FIELDS.has(field) && classification && classification !== "MANUAL ENTRY") {
      // Deep-clone the rows for simulation. We need two clones:
      // one to simulate the cascade with prevValue, one with nextValue.
      const cloneRows = () => currentRows.map((r) => ({
        ...r,
        rawQuantities: r.rawQuantities.map((rq) => ({ ...rq })),
        customFields: { ...(r.customFields || {}) },
      }));

      const simRegistry = { ...userRegistryRef.current };

      // Simulate cascade with prevValue → gives us the accurate "before" state
      const simPrev = cloneRows();
      applyCellEditDirect(simPrev, idx, field, prevValue as string | number, { ...simRegistry });

      // Simulate cascade with nextValue → gives us the accurate "after" state
      const simNext = cloneRows();
      applyCellEditDirect(simNext, idx, field, nextValue as string | number, { ...simRegistry });

      cascadeEffects = [];
      for (let i = 0; i < currentRows.length; i++) {
        if (i !== idx && currentRows[i].classification === classification) {
          const prevSibling = simPrev[i];
          const nextSibling = simNext[i];

          // Scope captured fields to what the specific cascade actually touches.
          // This keeps command payloads minimal while ensuring full undo/redo.
          let prevCapture: Partial<ProcessedTakeoffRow>;
          let nextCapture: Partial<ProcessedTakeoffRow>;

          if (field === "itemId") {
            // itemId cascade touches: itemId, description, procoreParentCode,
            // unitPrice, uom, costType, matchedQty, total, isMapped
            prevCapture = {
              itemId: prevSibling.itemId,
              description: prevSibling.description,
              procoreParentCode: prevSibling.procoreParentCode,
              unitPrice: prevSibling.unitPrice,
              uom: prevSibling.uom,
              costType: prevSibling.costType,
              matchedQty: prevSibling.matchedQty,
              total: prevSibling.total,
              isMapped: prevSibling.isMapped,
            };
            nextCapture = {
              itemId: nextSibling.itemId,
              description: nextSibling.description,
              procoreParentCode: nextSibling.procoreParentCode,
              unitPrice: nextSibling.unitPrice,
              uom: nextSibling.uom,
              costType: nextSibling.costType,
              matchedQty: nextSibling.matchedQty,
              total: nextSibling.total,
              isMapped: nextSibling.isMapped,
            };
          } else if (field === "description") {
            // description cascade touches: description only
            prevCapture = { description: prevSibling.description };
            nextCapture = { description: nextSibling.description };
          } else {
            // unitPrice cascade touches: unitPrice, total
            prevCapture = {
              unitPrice: prevSibling.unitPrice,
              total: prevSibling.total,
            };
            nextCapture = {
              unitPrice: nextSibling.unitPrice,
              total: nextSibling.total,
            };
          }

          cascadeEffects.push({
            rowId: currentRows[i].id,
            prevFields: prevCapture,
            nextFields: nextCapture,
          });
        }
      }
      if (cascadeEffects.length === 0) cascadeEffects = undefined;
    }

    // Build registry delta (only itemId edits write to registries)
    let registryDelta: {
      projectRegistry?: { key: string; prevValue: string; nextValue: string };
      globalRegistry?: { key: string; prevValue: string; nextValue: string };
    } | undefined;

    if (field === "itemId" && classification && classification !== "MANUAL ENTRY") {
      const curUserReg = userRegistryRef.current;
      const curGlobalReg = globalRegistryRef.current;
      registryDelta = {
        projectRegistry: {
          key: classification,
          prevValue: String(prevValue).trim() || curUserReg[classification] || "",
          nextValue: String(nextValue).trim(),
        },
        globalRegistry: {
          key: classification,
          prevValue: String(prevValue).trim() || curGlobalReg[classification] || "",
          nextValue: String(nextValue).trim(),
        },
      };
    }

    // pushCommand (AGENTS.md guardrail: push before mutation for new edits;
    // here handleCellEdit already applied the edit on each keystroke,
    // so we push the full delta for undo/redo)
    commandHistory.pushCommand({
      type: "EDIT_CELL",
      rowId,
      field,
      prevValue,
      nextValue,
      cascadeEffects,
      registryDelta,
    });
  }, [commandHistory]);

  // ---------------------------------------------------------------------------
  // Custom cell edit — PURE STATE MUTATOR (no history push)
  // ---------------------------------------------------------------------------
  const handleCustomCellEdit = (rowIndex: number, columnId: string, value: string) => {
    setRows((prev) => {
      const updated = [...prev];
      const row = { ...updated[rowIndex] };
      row.customFields = { ...(row.customFields || {}), [columnId]: value };
      updated[rowIndex] = row;
      return updated;
    });
  };

  // ---------------------------------------------------------------------------
  // commitCustomCellEdit — Build command + push history on blur
  // ---------------------------------------------------------------------------
  const commitCustomCellEdit = useCallback((
    rowId: string,
    columnId: string,
    prevValue: string,
    nextValue: string
  ) => {
    // pushCommand (AGENTS.md guardrail)
    commandHistory.pushCommand({
      type: "EDIT_CUSTOM_CELL",
      rowId,
      columnId,
      prevValue,
      nextValue,
    });
  }, [commandHistory]);

  // ---------------------------------------------------------------------------
  // Custom column keyboard navigation — delegated to useKeyboardNavigation hook
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Column management — delegated to useColumnDefinitions hook
  // ---------------------------------------------------------------------------

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
                      onFocus={() => { focusedCellRef.current = { rowId: row.id, field: "itemId", initialValue: row.itemId }; }}
                      onBlur={() => {
                        const fc = focusedCellRef.current;
                        if (fc && fc.rowId === row.id && fc.field === "itemId") {
                          const currentVal = row.itemId;
                          if (currentVal !== fc.initialValue) {
                            commitCellEdit(fc.rowId, "itemId" as keyof ProcessedTakeoffRow, fc.initialValue, currentVal);
                          }
                          focusedCellRef.current = null;
                        }
                      }}
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
                              onClick={() => {
                                commitCellEdit(row.id, "itemId", row.itemId, sugg.itemId);
                                handleCellEdit(index, "itemId", sugg.itemId);
                              }}
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
                    onFocus={() => { focusedCellRef.current = { rowId: row.id, field: "description", initialValue: row.description }; }}
                    onBlur={() => {
                      const fc = focusedCellRef.current;
                      if (fc && fc.rowId === row.id && fc.field === "description") {
                        const currentVal = row.description;
                        if (currentVal !== fc.initialValue) {
                          commitCellEdit(fc.rowId, "description" as keyof ProcessedTakeoffRow, fc.initialValue, currentVal);
                        }
                        focusedCellRef.current = null;
                      }
                    }}
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
                    onFocus={() => { focusedCellRef.current = { rowId: row.id, field: "matchedQty", initialValue: row.matchedQty }; }}
                    onBlur={() => {
                      const fc = focusedCellRef.current;
                      if (fc && fc.rowId === row.id && fc.field === "matchedQty") {
                        const currentVal = row.matchedQty;
                        if (currentVal !== fc.initialValue) {
                          commitCellEdit(fc.rowId, "matchedQty" as keyof ProcessedTakeoffRow, fc.initialValue, currentVal);
                        }
                        focusedCellRef.current = null;
                      }
                    }}
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
                    onFocus={() => { focusedCellRef.current = { rowId: row.id, field: "unitPrice", initialValue: row.unitPrice }; }}
                    onBlur={() => {
                      const fc = focusedCellRef.current;
                      if (fc && fc.rowId === row.id && fc.field === "unitPrice") {
                        const currentVal = row.unitPrice;
                        if (currentVal !== fc.initialValue) {
                          commitCellEdit(fc.rowId, "unitPrice" as keyof ProcessedTakeoffRow, fc.initialValue, currentVal);
                        }
                        focusedCellRef.current = null;
                      }
                    }}
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
                onFocus={() => { focusedCustomCellRef.current = { rowId: row.id, columnId: def.id, initialValue: String(val) }; }}
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
  }, [columnDefs, lockedCells, unitCount, squareFootage, userRegistry, globalRegistry, commitCellEdit, commitCustomCellEdit]);

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
    canUndo: commandHistory.canUndo,
    canRedo: commandHistory.canRedo,
    undoStackSize: commandHistory.undoStackSize,
    redoStackSize: commandHistory.redoStackSize,
    isExportingExcel,
    exportError,
    setExportError,
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
