"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { ProcessedTakeoffRow, WorkbookCommand } from "@/types";
import { ESTIMATE_ITEMS_MASTER } from "@/lib/mock-data";
import { saveProjectRegistry, saveGlobalRegistry } from "@/lib/db";

// ---------------------------------------------------------------------------
// useCellEditing — Cell editing state, handlers, and cascade logic
// Extracted from useTakeoffWorkbook.tsx (Phase 2, Step 2.2)
// ---------------------------------------------------------------------------

/** Fields that applyCellEditDirect cascades to sibling rows */
const CASCADE_FIELDS: Set<keyof ProcessedTakeoffRow> = new Set(["itemId", "description", "unitPrice"]);

export interface UseCellEditingReturn {
  editingValues: Record<string, string>;
  editingCellId: string | null;
  setEditingValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setEditingCellId: React.Dispatch<React.SetStateAction<string | null>>;
  focusedCellRef: React.MutableRefObject<{ rowId: string; field: string; initialValue: string | number | boolean } | null>;
  focusedCustomCellRef: React.MutableRefObject<{ rowId: string; columnId: string; initialValue: string } | null>;
  flushEditingBufferRef: React.MutableRefObject<() => void>;
  applyCellEditDirect: (
    updated: ProcessedTakeoffRow[],
    index: number,
    field: keyof ProcessedTakeoffRow,
    value: string | number,
    currentRegistry: Record<string, string>
  ) => Record<string, string> | null;
  handleCellEdit: (index: number, field: keyof ProcessedTakeoffRow, value: string | number) => void;
  commitCellEdit: (rowId: string, field: keyof ProcessedTakeoffRow, prevValue: string | number | boolean, nextValue: string | number | boolean) => void;
  handleCustomCellEdit: (rowIndex: number, columnId: string, value: string) => void;
  commitCustomCellEdit: (rowId: string, columnId: string, prevValue: string, nextValue: string) => void;
}

export function useCellEditing(
  projectId: string,
  rowsRef: React.MutableRefObject<ProcessedTakeoffRow[]>,
  userRegistryRef: React.MutableRefObject<Record<string, string>>,
  globalRegistryRef: React.MutableRefObject<Record<string, string>>,
  commandHistory: { pushCommand: (cmd: WorkbookCommand) => void },
  setRows: React.Dispatch<React.SetStateAction<ProcessedTakeoffRow[]>>,
  setUserRegistry: React.Dispatch<React.SetStateAction<Record<string, string>>>,
  setGlobalRegistry: React.Dispatch<React.SetStateAction<Record<string, string>>>,
): UseCellEditingReturn {

  // ---------------------------------------------------------------------------
  // String buffer state for number inputs (Fix 1B)
  // Keys are "${rowId}::${field}", values are raw string while editing
  // ---------------------------------------------------------------------------
  const [editingValues, setEditingValues] = useState<Record<string, string>>({});
  const [editingCellId, setEditingCellId] = useState<string | null>(null);

  // Focus tracking refs for blur-based commit
  const focusedCellRef = useRef<{ rowId: string; field: string; initialValue: string | number | boolean } | null>(null);
  const focusedCustomCellRef = useRef<{ rowId: string; columnId: string; initialValue: string } | null>(null);

  // flushEditingBuffer is declared as a ref-based callback because it needs
  // commitCellEdit which is declared later. The ref is populated after commitCellEdit exists.
  const flushEditingBufferRef = useRef<() => void>(() => {});

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
  // Cell edit handler — PURE STATE MUTATOR (no history push)
  // Uses refs for state access to prevent column remount (Fix 1A)
  // Registry writes are deferred to commitCellEdit (blur/Enter) to prevent
  // setUserRegistry/setGlobalRegistry from triggering column useMemo invalidation
  // ---------------------------------------------------------------------------
  const handleCellEdit = useCallback((index: number, field: keyof ProcessedTakeoffRow, value: string | number) => {
    const currentRows = [...rowsRef.current];
    const newRegistry = applyCellEditDirect(currentRows, index, field, value, userRegistryRef.current);

    // Stage registry updates in refs — they are flushed on commitCellEdit (blur/Enter)
    // This prevents setUserRegistry/setGlobalRegistry from firing per-keystroke
    if (newRegistry) {
      userRegistryRef.current = newRegistry;
      const classification = currentRows[index]?.classification;
      if (classification && classification !== "MANUAL ENTRY" && field === "itemId") {
        globalRegistryRef.current = {
          ...globalRegistryRef.current,
          [classification]: String(value).trim(),
        };
      }
    }
    setRows(currentRows);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // Flush deferred registry writes to React state + DB on commit (Fix 1A)
    // This ensures setUserRegistry/setGlobalRegistry only fire once on blur,
    // not on every keystroke, preventing column useMemo invalidation.
    if (field === "itemId" && classification && classification !== "MANUAL ENTRY") {
      const stagedUserReg = userRegistryRef.current;
      const stagedGlobalReg = globalRegistryRef.current;
      setUserRegistry(stagedUserReg);
      saveProjectRegistry(projectId, stagedUserReg).catch((err) => console.error('Registry persist failed:', err));
      setGlobalRegistry(stagedGlobalReg);
      saveGlobalRegistry(stagedGlobalReg).catch((err) => console.error('Global registry persist failed:', err));
    }
  }, [commandHistory, projectId, setUserRegistry, setGlobalRegistry]);

  /** Flush any active editing buffer — commit the pending value before switching cells (Amendment E) */
  const flushEditingBuffer = useCallback(() => {
    if (!editingCellId) return;
    const [buffRowId, buffField] = editingCellId.split("::");
    const buffValue = editingValues[editingCellId];
    if (buffRowId && buffField && buffValue !== undefined) {
      const parsedVal = parseFloat(buffValue);
      const numVal = isNaN(parsedVal) ? 0 : parsedVal;
      const currentRows = rowsRef.current;
      const row = currentRows.find((r) => r.id === buffRowId);
      if (row) {
        const prevVal = (row as unknown as Record<string, unknown>)[buffField];
        if (prevVal !== numVal) {
          const updated = [...currentRows];
          const idx = updated.findIndex((r) => r.id === buffRowId);
          if (idx !== -1) {
            const newRegistry = applyCellEditDirect(updated, idx, buffField as keyof ProcessedTakeoffRow, numVal, userRegistryRef.current);
            if (newRegistry) {
              setUserRegistry(newRegistry);
              saveProjectRegistry(projectId, newRegistry).catch((err) => console.error('Registry persist failed:', err));
              const classification = updated[idx]?.classification;
              if (classification && classification !== "MANUAL ENTRY" && buffField === "itemId") {
                const newGlobalReg = { ...globalRegistryRef.current, [classification]: String(numVal).trim() };
                setGlobalRegistry(newGlobalReg);
                saveGlobalRegistry(newGlobalReg).catch((err) => console.error('Global registry persist failed:', err));
              }
            }
            setRows(updated);
            commitCellEdit(buffRowId, buffField as keyof ProcessedTakeoffRow, prevVal as string | number | boolean, numVal);
          }
        }
      }
    }
    setEditingValues({});
    setEditingCellId(null);
  }, [editingCellId, editingValues, commitCellEdit, projectId, setUserRegistry, setGlobalRegistry, setRows]);

  // Keep the ref current so cell renderers always call the latest version
  useEffect(() => { flushEditingBufferRef.current = flushEditingBuffer; }, [flushEditingBuffer]);

  // ---------------------------------------------------------------------------
  // Custom cell edit — PURE STATE MUTATOR (no history push)
  // ---------------------------------------------------------------------------
  const handleCustomCellEdit = useCallback((rowIndex: number, columnId: string, value: string) => {
    setRows((prev) => {
      const updated = [...prev];
      const row = { ...updated[rowIndex] };
      row.customFields = { ...(row.customFields || {}), [columnId]: value };
      updated[rowIndex] = row;
      return updated;
    });
  }, [setRows]);

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

  return {
    editingValues,
    editingCellId,
    setEditingValues,
    setEditingCellId,
    focusedCellRef,
    focusedCustomCellRef,
    flushEditingBufferRef,
    applyCellEditDirect,
    handleCellEdit,
    commitCellEdit,
    handleCustomCellEdit,
    commitCustomCellEdit,
  };
}
