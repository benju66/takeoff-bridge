"use client";

import React, { useCallback } from "react";
import { ProcessedTakeoffRow, ColumnDefinition, WorkbookCommand } from "@/types";
import { UseCommandHistoryReturn } from "./useCommandHistory";
import {
  saveProjectRegistry,
  saveGlobalRegistry,
  saveEstimateBinding,
  deleteEstimateBinding,
} from "@/lib/db";
import { evaluateDataFidelity } from "@/lib/calculations";
import { applyMergeForward, applyMergeInverse } from "@/lib/mergeTakeoff";
import type { Binding } from "@/lib/bindings/types";
import { upsertBinding, removeBinding } from "@/lib/bindings/store";
import { applyBuyoutCommandValue, type BuyoutStore, type LensView } from "@/lib/buyout";
import type { EstimateSectionLine } from "@/types/db";
import { applyFeeLineForward, applyFeeLineInverse } from "@/lib/sectionLines/markupCommands";

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
  // Linked Values Phase 4: optimistic binding state for SET_BINDING / CLEAR_BINDING.
  setBindings: React.Dispatch<React.SetStateAction<Binding[]>>,
  // Estimate Buyout Lens Phase 3: the browser-local store EDIT_BUYOUT_CELL undo/redo writes to
  // (localStorage only — never rows/DB), plus the lens setter for the D-A auto-flip.
  buyout: BuyoutStore,
  setLensView: (next: LensView) => void,
  // Fee-Block Addressability Phase 4: the page-owned markup fee-line store the
  // INSERT_FEE_LINE / DELETE_FEE_LINE / EDIT_FEE_LINE commands flip optimistically for
  // undo/redo (owned by useMarkupFeeLines; persisted via the full-replace save_section_lines).
  setMarkupLines: React.Dispatch<React.SetStateAction<EstimateSectionLine[]>> = () => {},
): UseCommandDispatchReturn {

  // Persist a binding write (fire-and-forget, mirrors the registry-delta pattern):
  // the optimistic in-memory state already updated; a DB failure logs but never blocks
  // undo/redo. THROWN errors from the gateway are caught here.
  const persistBinding = useCallback(
    (binding: Binding | null, targetNodeId: string) => {
      if (binding) {
        saveEstimateBinding(projectId, binding).catch((err) =>
          console.error("Failed to persist binding:", err)
        );
      } else {
        deleteEstimateBinding(projectId, targetNodeId).catch((err) =>
          console.error("Failed to delete binding:", err)
        );
      }
    },
    [projectId]
  );

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
        // Apply moveEffect (forward: remove→insert at toIndex)
        if (cmd.moveEffect) {
          setRows((prev) => {
            const arr = [...prev];
            const movingRows = cmd.moveEffect!.moves.map(m => {
              const ri = arr.findIndex(r => r.id === m.rowId);
              return arr[ri];
            });
            const removeIndices = cmd.moveEffect!.moves.map(m => arr.findIndex(r => r.id === m.rowId)).sort((a, b) => b - a);
            removeIndices.forEach(ri => arr.splice(ri, 1));
            const insertAt = cmd.moveEffect!.moves[0].toIndex;
            arr.splice(insertAt, 0, ...movingRows);
            return arr;
          });
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
      case "EDIT_BUYOUT_CELL": {
        // Redo → write the NEXT value to the browser-local buyout store. No setRows, no DB —
        // just the localStorage-backed setter (L-5). Goldens cannot move (Phase 3).
        applyBuyoutCommandValue(buyout, cmd.rowId, cmd.field, cmd.nextValue);
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
        // Redo: re-apply existing-row field state AND re-append off-template rows
        // (pure logic shared with the live merge — src/lib/mergeTakeoff.ts).
        setRows((prev) => applyMergeForward(prev, cmd));
        setUnmappedTakeoffClassifications(cmd.nextUnmapped);
        break;
      }
      case "SET_BINDING": {
        // Forward = create/replace the binding on the target node (Phase 4).
        setBindings((prev) => upsertBinding(prev, cmd.nextBinding));
        persistBinding(cmd.nextBinding, cmd.targetNodeId);
        break;
      }
      case "CLEAR_BINDING": {
        // Forward = remove the binding from the target node (Phase 4).
        setBindings((prev) => removeBinding(prev, cmd.targetNodeId));
        persistBinding(null, cmd.targetNodeId);
        break;
      }
      case "INSERT_FEE_LINE":
      case "DELETE_FEE_LINE":
      case "EDIT_FEE_LINE": {
        // Forward (live-edit / redo) → mutate the page-owned markup store (Fee-Block Phase 4).
        // The pure reducer holds the inverse data; the debounced save_section_lines persists.
        setMarkupLines((prev) => applyFeeLineForward(prev, cmd));
        break;
      }
    }
  }, [projectId, setColumnDefs, setLockedCells, setRows, setUserRegistry, setGlobalRegistry, setUnmappedTakeoffClassifications, globalRegistry, setBindings, persistBinding, buyout, setMarkupLines]);

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
        // Apply moveEffect inverse (reverse: remove→insert at fromIndex)
        if (cmd.moveEffect) {
          setRows((prev) => {
            const arr = [...prev];
            const movingRows = cmd.moveEffect!.moves.map(m => {
              const ri = arr.findIndex(r => r.id === m.rowId);
              return arr[ri];
            });
            const removeIndices = cmd.moveEffect!.moves.map(m => arr.findIndex(r => r.id === m.rowId)).sort((a, b) => b - a);
            removeIndices.forEach(ri => arr.splice(ri, 1));
            // Insert back at original fromIndex (sorted ascending to maintain stable splicing)
            const sorted = [...cmd.moveEffect!.moves].sort((a, b) => a.fromIndex - b.fromIndex);
            sorted.forEach((m) => {
              const row = movingRows.find(r => r.id === m.rowId)!;
              arr.splice(m.fromIndex, 0, row);
            });
            return arr;
          });
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
      case "EDIT_BUYOUT_CELL": {
        // Undo → restore the PREV value to the browser-local buyout store (localStorage only).
        applyBuyoutCommandValue(buyout, cmd.rowId, cmd.field, cmd.prevValue);
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
        // Undo: restore existing-row prev field state AND remove appended off-template rows,
        // so one Ctrl+Z reverses the whole merge (pure logic — src/lib/mergeTakeoff.ts).
        setRows((prev) => applyMergeInverse(prev, cmd));
        setUnmappedTakeoffClassifications(cmd.prevUnmapped);
        break;
      }
      case "SET_BINDING": {
        // Undo = restore the prior binding (prev=null → the target had none, so delete).
        if (cmd.prevBinding) {
          setBindings((prev) => upsertBinding(prev, cmd.prevBinding!));
          persistBinding(cmd.prevBinding, cmd.targetNodeId);
        } else {
          setBindings((prev) => removeBinding(prev, cmd.targetNodeId));
          persistBinding(null, cmd.targetNodeId);
        }
        break;
      }
      case "CLEAR_BINDING": {
        // Undo = re-add the cleared binding verbatim.
        setBindings((prev) => upsertBinding(prev, cmd.prevBinding));
        persistBinding(cmd.prevBinding, cmd.targetNodeId);
        break;
      }
      case "INSERT_FEE_LINE":
      case "DELETE_FEE_LINE":
      case "EDIT_FEE_LINE": {
        // Undo → reverse the fee-line mutation (insert↔delete at the captured index,
        // edit restores the prev field patch) — a single Ctrl+Z, atomically (Fee-Block Phase 4).
        setMarkupLines((prev) => applyFeeLineInverse(prev, cmd));
        break;
      }
    }
  }, [projectId, setColumnDefs, setLockedCells, setRows, setUserRegistry, setGlobalRegistry, setUnmappedTakeoffClassifications, globalRegistry, setBindings, persistBinding, buyout, setMarkupLines]);

  // A buyout edit reverted/replayed while the Estimate lens is active targets a hidden cell —
  // flip to the Buyout lens so the change is visible (D-A). Browser-local; never touches the DB.
  // Setting the lens it's already on is a harmless no-op (React bails out on an unchanged value).
  const flipToBuyoutIfNeeded = useCallback((cmd: WorkbookCommand) => {
    if (cmd.type === "EDIT_BUYOUT_CELL") setLensView("buyout");
  }, [setLensView]);

  // ---------------------------------------------------------------------------
  // handleUndo — Pop from undo stack and apply inverse
  // ---------------------------------------------------------------------------
  const handleUndo = useCallback(() => {
    const cmd = commandHistory.undo();
    if (!cmd) return;
    flipToBuyoutIfNeeded(cmd);
    applyCommandInverse(cmd);
  }, [commandHistory, applyCommandInverse, flipToBuyoutIfNeeded]);

  // ---------------------------------------------------------------------------
  // handleRedo — Pop from redo stack and apply forward
  // ---------------------------------------------------------------------------
  const handleRedo = useCallback(() => {
    const cmd = commandHistory.redo();
    if (!cmd) return;
    flipToBuyoutIfNeeded(cmd);
    applyCommandForward(cmd);
  }, [commandHistory, applyCommandForward, flipToBuyoutIfNeeded]);

  return {
    applyCommandForward,
    applyCommandInverse,
    handleUndo,
    handleRedo,
  };
}
