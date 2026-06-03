"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { ProcessedTakeoffRow, WorkbookCommand, EditCellCommand } from "@/types";
import { ESTIMATE_ITEMS_MASTER } from "@/lib/mock-data";
import { saveProjectRegistry, saveGlobalRegistry, recordClassificationResolution } from "@/lib/db";
import { evaluateDataFidelity } from "@/lib/calculations";
import { getDivisionCode } from "@/lib/division";

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
  const applyCellEditDirect = useCallback((
    updated: ProcessedTakeoffRow[],
    index: number,
    field: keyof ProcessedTakeoffRow,
    value: string | number,
    currentRegistry: Record<string, string>
  ): Record<string, string> | null => {
    const threshold = Number(globalRegistryRef.current["__config_threshold"]) || 5000;
    const keywords = globalRegistryRef.current["__config_keywords"]
      ? globalRegistryRef.current["__config_keywords"].split(",").map(k => k.trim())
      : ["LS", "SUM", "ALLW", "LUMP"];

    const originalRow = updated[index];
    if (!originalRow) return null;

    // Shallow-clone the row to prevent in-place mutation and ensure React/TanStack re-renders
    const row = {
      ...originalRow,
      rawQuantities: originalRow.rawQuantities.map((rq) => ({ ...rq })),
      customFields: { ...(originalRow.customFields || {}) },
    };
    updated[index] = row;

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
              updated[i].dataFidelity = evaluateDataFidelity(q, targetItem.targetUom, updated[i].total, threshold, keywords);
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
            updated[i].dataFidelity = evaluateDataFidelity(updated[i].matchedQty, updated[i].uom, updated[i].total, threshold, keywords);
          }
        }
      }
    } else if (field === "uom") {
      // UOM change is ROW-LOCAL — no cascade to same-classification rows
      const newUom = String(value).toUpperCase();
      row.uom = newUom;

      // Re-match quantity from rawQuantities using normalized comparison
      // rawQuantities are already normalized at parse time (uom-aliases.ts)
      const matched = row.rawQuantities.find(
        (m) => m.uom?.trim().toUpperCase() === newUom
      );
      if (matched) {
        row.matchedQty = matched.qty;
      }
      // Recalculate total
      row.total = row.matchedQty * row.unitPrice;
    }

    row.dataFidelity = evaluateDataFidelity(row.matchedQty, row.uom, row.total, threshold, keywords);

    return newRegistry;
  }, [globalRegistryRef]);

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
            // unitPrice, uom, costType, matchedQty, total, isMapped, dataFidelity
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
              dataFidelity: prevSibling.dataFidelity,
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
              dataFidelity: nextSibling.dataFidelity,
            };
          } else if (field === "description") {
            // description cascade touches: description only
            prevCapture = { description: prevSibling.description };
            nextCapture = { description: nextSibling.description };
          } else {
            // unitPrice cascade touches: unitPrice, total, dataFidelity
            prevCapture = {
              unitPrice: prevSibling.unitPrice,
              total: prevSibling.total,
              dataFidelity: prevSibling.dataFidelity,
            };
            nextCapture = {
              unitPrice: nextSibling.unitPrice,
              total: nextSibling.total,
              dataFidelity: nextSibling.dataFidelity,
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

    // Build UOM self-cascade: UOM edits are row-local but change matchedQty + total
    // as side effects. Capture these in cascadeEffects on the SAME row so undo/redo
    // reverts all three fields atomically (GAP-1 fix).
    if (field === "uom") {
      const cloneRows = () => currentRows.map((r) => ({
        ...r,
        rawQuantities: r.rawQuantities.map((rq) => ({ ...rq })),
        customFields: { ...(r.customFields || {}) },
      }));

      const simRegistry = { ...userRegistryRef.current };

      // Simulate with prevValue → accurate "before" matchedQty/total
      const simPrev = cloneRows();
      applyCellEditDirect(simPrev, idx, field, prevValue as string | number, { ...simRegistry });

      // Simulate with nextValue → accurate "after" matchedQty/total
      const simNext = cloneRows();
      applyCellEditDirect(simNext, idx, field, nextValue as string | number, { ...simRegistry });

      cascadeEffects = [{
        rowId,
        prevFields: {
          matchedQty: simPrev[idx].matchedQty,
          total: simPrev[idx].total,
          dataFidelity: simPrev[idx].dataFidelity,
        },
        nextFields: {
          matchedQty: simNext[idx].matchedQty,
          total: simNext[idx].total,
          dataFidelity: simNext[idx].dataFidelity,
        },
      }];
    }

    // --- Division-aware row relocation (moveEffect) ---
    // When an itemId edit changes the division code, relocate the edited row
    // (and cascade siblings) to be contiguous with the target division group.
    // Paste operations do NOT trigger relocation (by design — see deep review §4).
    let moveEffect: EditCellCommand['moveEffect'] = undefined;

    if (field === "itemId") {
      const oldDiv = getDivisionCode(String(prevValue));
      const newDiv = getDivisionCode(String(nextValue));

      if (oldDiv && newDiv && oldDiv !== newDiv) {
        // Collect all row IDs that need to move (edited row + cascade siblings)
        const movingRowIds = new Set<string>([rowId]);
        if (cascadeEffects) {
          cascadeEffects.forEach(ce => movingRowIds.add(ce.rowId));
        }

        // Find the insertion point: after the last row in the target division
        // that is NOT one of the rows we're about to move
        const currentRows = rowsRef.current;
        let targetInsertIndex = -1;
        for (let i = currentRows.length - 1; i >= 0; i--) {
          if (!movingRowIds.has(currentRows[i].id) && getDivisionCode(currentRows[i].itemId) === newDiv) {
            targetInsertIndex = i + 1;
            break;
          }
        }

        // If no existing rows in target division, find where it should be inserted
        // by scanning for the first division that sorts after newDiv
        if (targetInsertIndex === -1) {
          for (let i = 0; i < currentRows.length; i++) {
            const rowDiv = getDivisionCode(currentRows[i].itemId);
            if (rowDiv && rowDiv > newDiv && !movingRowIds.has(currentRows[i].id)) {
              targetInsertIndex = i;
              break;
            }
          }
          // If still not found (e.g., new division is largest), append after everything
          if (targetInsertIndex === -1) {
            targetInsertIndex = currentRows.length;
          }
        }

        // Build the moves array: record from/to for each moving row
        const moves: { rowId: string; fromIndex: number; toIndex: number }[] = [];
        const movingIndices: { rowId: string; fromIndex: number }[] = [];
        currentRows.forEach((r, i) => {
          if (movingRowIds.has(r.id)) {
            movingIndices.push({ rowId: r.id, fromIndex: i });
          }
        });

        // Calculate the effective to-index for each row after all removes
        // We process removes from highest index to lowest to keep indices stable
        const sortedByIndex = [...movingIndices].sort((a, b) => a.fromIndex - b.fromIndex);
        let insertOffset = targetInsertIndex;
        // Adjust insert offset: for each moving row that's before the insert point,
        // the insert point shifts down by 1 after removal
        const removedBeforeTarget = sortedByIndex.filter(m => m.fromIndex < targetInsertIndex).length;
        insertOffset -= removedBeforeTarget;

        sortedByIndex.forEach((m, i) => {
          moves.push({
            rowId: m.rowId,
            fromIndex: m.fromIndex,
            toIndex: insertOffset + i,
          });
        });

        // Only create moveEffect if rows actually move
        const hasActualMoves = moves.some(m => m.fromIndex !== m.toIndex);
        if (hasActualMoves) {
          moveEffect = { moves };
        }
      }
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
      moveEffect,
    });

    // Apply moveEffect to the current rows
    if (moveEffect) {
      const current = [...rowsRef.current];
      // Extract moving rows (by ID, preserving order)
      const movingRows = moveEffect.moves.map(m => {
        const ri = current.findIndex(r => r.id === m.rowId);
        return current[ri];
      });
      // Remove all moving rows first (highest index first to keep stable indices)
      const removeIndices = moveEffect.moves.map(m => current.findIndex(r => r.id === m.rowId)).sort((a, b) => b - a);
      removeIndices.forEach(ri => current.splice(ri, 1));
      // Insert at the computed target position
      const insertAt = moveEffect.moves[0].toIndex;
      current.splice(insertAt, 0, ...movingRows);
      setRows(current);
    }

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

      // Record classification resolution for AI training data pipeline
      recordClassificationResolution(classification, String(nextValue).trim(), projectId, 'user')
        .catch(() => { /* silent — training data loss is non-critical */ });
    }
  }, [commandHistory, projectId, setUserRegistry, setGlobalRegistry, setRows, applyCellEditDirect, globalRegistryRef, rowsRef, userRegistryRef]);

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
  }, [editingCellId, editingValues, commitCellEdit, projectId, setUserRegistry, setGlobalRegistry, setRows, applyCellEditDirect, globalRegistryRef, rowsRef, userRegistryRef]);

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
