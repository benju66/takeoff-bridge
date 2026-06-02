"use client";

import React, { useCallback } from "react";
import { ProcessedTakeoffRow, ColumnDefinition, WorkbookCommand } from "@/types";
import { UseCommandHistoryReturn } from "./useCommandHistory";
import { saveProjectRegistry, saveGlobalRegistry } from "@/lib/db";
import { evaluateDataFidelity } from "@/lib/calculations";

// ---------------------------------------------------------------------------
// UseCommandDispatchReturn — Public API surface for the dispatch hook
// ---------------------------------------------------------------------------

export interface UseCommandDispatchReturn {
  applyCommandForward: (cmd: WorkbookCommand) => void;
  applyCommandInverse: (cmd: WorkbookCommand) => void;
  handleUndo: () => void;
  handleRedo: () => void;
}

// ---------------------------------------------------------------------------
// useCommandDispatch — Forward/inverse command application + undo/redo wiring
// ---------------------------------------------------------------------------

export function useCommandDispatch(
  commandHistory: UseCommandHistoryReturn,
  projectId: string,
  setRows: React.Dispatch<React.SetStateAction<ProcessedTakeoffRow[]>>,
  setUserRegistry: React.Dispatch<React.SetStateAction<Record<string, string>>>,
  setGlobalRegistry: React.Dispatch<React.SetStateAction<Record<string, string>>>,
  setColumnDefs: React.Dispatch<React.SetStateAction<ColumnDefinition[]>>,
  setLockedCells: React.Dispatch<React.SetStateAction<Record<string, boolean>>>,
  setUnmappedTakeoffClassifications: React.Dispatch<React.SetStateAction<string[]>>,
  globalRegistry: Record<string, string>,
): UseCommandDispatchReturn {

  // ---------------------------------------------------------------------------
  // applyCommandForward — Execute a command's FORWARD (next) effect on state
  // ---------------------------------------------------------------------------
  const applyCommandForward = useCallback((cmd: WorkbookCommand) => {
    switch (cmd.type) {
      case "EDIT_CELL": {
        const threshold = Number(globalRegistry["__config_threshold"]) || 5000;
        const keywords = globalRegistry["__config_keywords"]
          ? globalRegistry["__config_keywords"].split(",").map(k => k.trim())
          : ["LS", "SUM", "ALLW", "LUMP"];

        setRows((prev) => {
          const updated = [...prev];
          const idx = updated.findIndex((r) => r.id === cmd.rowId);
          if (idx === -1) return prev;
          const row = { ...updated[idx] };
          (row as Record<string, unknown>)[cmd.field] = cmd.nextValue;
          if (cmd.field === "matchedQty" || cmd.field === "unitPrice") {
            row.total = row.matchedQty * row.unitPrice;
          }
          row.dataFidelity = evaluateDataFidelity(row.matchedQty, row.uom, row.total, threshold, keywords);
          updated[idx] = row;
          if (cmd.cascadeEffects) {
            for (const effect of cmd.cascadeEffects) {
              const si = updated.findIndex((r) => r.id === effect.rowId);
              if (si !== -1) {
                updated[si] = { ...updated[si], ...effect.nextFields };
                if (effect.nextFields.matchedQty !== undefined || effect.nextFields.unitPrice !== undefined) {
                  updated[si].total = updated[si].matchedQty * updated[si].unitPrice;
                }
                updated[si].dataFidelity = evaluateDataFidelity(updated[si].matchedQty, updated[si].uom, updated[si].total, threshold, keywords);
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
      case "UPDATE_COLUMN": {
        setColumnDefs((prev) => prev.map((col) => (col.id === cmd.columnId ? { ...cmd.nextDef } : col)));
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
  }, [projectId, setColumnDefs, setLockedCells, setRows, setUserRegistry, setGlobalRegistry, setUnmappedTakeoffClassifications, globalRegistry]);

  // ---------------------------------------------------------------------------
  // applyCommandInverse — Execute a command's INVERSE (prev) effect on state
  // ---------------------------------------------------------------------------
  const applyCommandInverse = useCallback((cmd: WorkbookCommand) => {
    switch (cmd.type) {
      case "EDIT_CELL": {
        const threshold = Number(globalRegistry["__config_threshold"]) || 5000;
        const keywords = globalRegistry["__config_keywords"]
          ? globalRegistry["__config_keywords"].split(",").map(k => k.trim())
          : ["LS", "SUM", "ALLW", "LUMP"];

        setRows((prev) => {
          const updated = [...prev];
          const idx = updated.findIndex((r) => r.id === cmd.rowId);
          if (idx === -1) return prev;
          const row = { ...updated[idx] };
          (row as Record<string, unknown>)[cmd.field] = cmd.prevValue;
          if (cmd.field === "matchedQty" || cmd.field === "unitPrice") {
            row.total = row.matchedQty * row.unitPrice;
          }
          row.dataFidelity = evaluateDataFidelity(row.matchedQty, row.uom, row.total, threshold, keywords);
          updated[idx] = row;
          if (cmd.cascadeEffects) {
            for (const effect of cmd.cascadeEffects) {
              const si = updated.findIndex((r) => r.id === effect.rowId);
              if (si !== -1) {
                updated[si] = { ...updated[si], ...effect.prevFields };
                if (effect.prevFields.matchedQty !== undefined || effect.prevFields.unitPrice !== undefined) {
                  updated[si].total = updated[si].matchedQty * updated[si].unitPrice;
                }
                updated[si].dataFidelity = evaluateDataFidelity(updated[si].matchedQty, updated[si].uom, updated[si].total, threshold, keywords);
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
      case "UPDATE_COLUMN": {
        setColumnDefs((prev) => prev.map((col) => (col.id === cmd.columnId ? { ...cmd.prevDef } : col)));
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
  }, [projectId, setColumnDefs, setLockedCells, setRows, setUserRegistry, setGlobalRegistry, setUnmappedTakeoffClassifications, globalRegistry]);

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

  return {
    applyCommandForward,
    applyCommandInverse,
    handleUndo,
    handleRedo,
  };
}
