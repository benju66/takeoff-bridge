"use client";

import React from "react";
import type { Table } from "@tanstack/react-table";
import { ProcessedTakeoffRow, GridSelectionState } from "@/types";

// ---------------------------------------------------------------------------
// useKeyboardNavigation — Grid keyboard navigation handlers
// Re-engineered for Strategy A: True Selection & Editing Model
// ---------------------------------------------------------------------------

export interface UseKeyboardNavigationReturn {
  handleKeyDown: (e: React.KeyboardEvent, rIdx: number, type: "code" | "desc" | "qty" | "price", table: Table<ProcessedTakeoffRow>) => void;
  handleCustomKeyDown: (e: React.KeyboardEvent, rIdx: number, columnId: string, table: Table<ProcessedTakeoffRow>) => void;
}

/**
 * Focus an element by ID, scrolling it into view first if a scrollToRow callback is provided.
 * Uses requestAnimationFrame to wait for the virtualizer to render the target row.
 */
function focusWithScroll(
  elementId: string,
  targetRowIdx: number,
  scrollToRowRef?: React.MutableRefObject<((index: number) => void) | undefined>
) {
  const scrollToRow = scrollToRowRef?.current;
  if (scrollToRow) {
    scrollToRow(targetRowIdx);
    // Wait for virtualizer to render the row before focusing
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById(elementId)?.focus();
      });
    });
  } else {
    document.getElementById(elementId)?.focus();
  }
}

export function useKeyboardNavigation(
  rowsRef: React.MutableRefObject<ProcessedTakeoffRow[]>,
  scrollToRowRef?: React.MutableRefObject<((index: number) => void) | undefined>
): UseKeyboardNavigationReturn {

  const processGridNavigation = (
    e: React.KeyboardEvent,
    rIdx: number, // Index in flatItems list
    columnId: string,
    table: Table<ProcessedTakeoffRow>
  ) => {
    const meta = table.options.meta!;
    const selection = meta.selection;
    const isEditing = selection.isEditing;
    const rows = table.getRowModel().rows;
    const totalRows = rows.length;

    // Get exact visible columns
    const visibleCols = table.getVisibleFlatColumns().map((c) => c.id);
    const colIdx = visibleCols.indexOf(columnId);

    // List of editable columns
    const isColumnEditable = (colId: string) => {
      return colId.startsWith("custom-") || ["itemId", "description", "matchedQty", "unitPrice"].includes(colId);
    };

    // Helper to find column input ID
    const getInputId = (cId: string, index: number) => {
      if (cId.startsWith("custom-")) return `custom-${cId}-input-${index}`;
      if (cId === "itemId") return `code-input-${index}`;
      if (cId === "description") return `desc-input-${index}`;
      if (cId === "matchedQty") return `qty-input-${index}`;
      if (cId === "unitPrice") return `price-input-${index}`;
      return `cell-${rows[index]?.original.id}-${cId}`;
    };

    // Helper to find viewer cell ID
    const getCellId = (cId: string, index: number) => {
      const rowId = rows[index]?.original.id;
      return `cell-${rowId}-${cId}`;
    };

    // Key handlers
    if (e.key === "Escape") {
      if (isEditing) {
        e.preventDefault();
        // Trigger cancel state restoration inside the active editor
        const input = e.target as HTMLInputElement;
        if (input) {
          // Trigger custom escape key down inside component if needed
          const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
          input.dispatchEvent(event);
        }
        meta.setSelection((prev: GridSelectionState) => ({ ...prev, isEditing: false }));
        // Refocus standard cell
        requestAnimationFrame(() => {
          document.getElementById(getCellId(columnId, rIdx))?.focus();
        });
      }
    }

    if (e.key === "Enter") {
      e.preventDefault();
      if (!isEditing) {
        // Enters edit mode
        if (isColumnEditable(columnId)) {
          meta.setSelection({ rowId: rows[rIdx]?.original.id, columnId, isEditing: true });
          requestAnimationFrame(() => {
            document.getElementById(getInputId(columnId, rIdx))?.focus();
          });
        }
      } else {
        // Exit editing & commit (done automatically on blur by input element)
        meta.setSelection({ rowId: null, columnId: null, isEditing: false });
        // Excel enters down
        const nextRIdx = rIdx + 1;
        if (nextRIdx < totalRows) {
          const nextRowId = rows[nextRIdx]?.original.id;
          meta.setSelection({ rowId: nextRowId, columnId, isEditing: false });
          focusWithScroll(getCellId(columnId, nextRIdx), nextRIdx, scrollToRowRef);
        }
      }
    }

    if (e.key === "Tab") {
      e.preventDefault();
      meta.setSelection({ rowId: null, columnId: null, isEditing: false });
      if (e.shiftKey) {
        // Shift+Tab: move left
        if (colIdx > 0) {
          const nextColId = visibleCols[colIdx - 1];
          meta.setSelection({ rowId: rows[rIdx]?.original.id, columnId: nextColId, isEditing: false });
          focusWithScroll(getCellId(nextColId, rIdx), rIdx, scrollToRowRef);
        } else if (rIdx > 0) {
          const nextColId = visibleCols[visibleCols.length - 1];
          const prevRowId = rows[rIdx - 1]?.original.id;
          meta.setSelection({ rowId: prevRowId, columnId: nextColId, isEditing: false });
          focusWithScroll(getCellId(nextColId, rIdx - 1), rIdx - 1, scrollToRowRef);
        }
      } else {
        // Tab: move right
        if (colIdx < visibleCols.length - 1) {
          const nextColId = visibleCols[colIdx + 1];
          meta.setSelection({ rowId: rows[rIdx]?.original.id, columnId: nextColId, isEditing: false });
          focusWithScroll(getCellId(nextColId, rIdx), rIdx, scrollToRowRef);
        } else if (rIdx < totalRows - 1) {
          const nextColId = visibleCols[0];
          const nextRowId = rows[rIdx + 1]?.original.id;
          meta.setSelection({ rowId: nextRowId, columnId: nextColId, isEditing: false });
          focusWithScroll(getCellId(nextColId, rIdx + 1), rIdx + 1, scrollToRowRef);
        }
      }
    }

    if (e.key === "ArrowDown") {
      if (!isEditing) {
        e.preventDefault();
        const nextRIdx = rIdx + 1;
        if (nextRIdx < totalRows) {
          const nextRowId = rows[nextRIdx]?.original.id;
          meta.setSelection({ rowId: nextRowId, columnId, isEditing: false });
          focusWithScroll(getCellId(columnId, nextRIdx), nextRIdx, scrollToRowRef);
        }
      }
    }

    if (e.key === "ArrowUp") {
      if (!isEditing) {
        e.preventDefault();
        const prevRIdx = rIdx - 1;
        if (prevRIdx >= 0) {
          const prevRowId = rows[prevRIdx]?.original.id;
          meta.setSelection({ rowId: prevRowId, columnId, isEditing: false });
          focusWithScroll(getCellId(columnId, prevRIdx), prevRIdx, scrollToRowRef);
        }
      }
    }

    if (e.key === "ArrowLeft") {
      const input = e.target as HTMLInputElement;
      const isInput = input instanceof HTMLInputElement && input.type === "text";
      const isCaretAtStart = isInput && input.selectionStart === 0 && input.selectionEnd === 0;

      if (!isEditing || isCaretAtStart) {
        e.preventDefault();
        if (colIdx > 0) {
          meta.setSelection({ rowId: rows[rIdx]?.original.id, columnId: visibleCols[colIdx - 1], isEditing: false });
          focusWithScroll(getCellId(visibleCols[colIdx - 1], rIdx), rIdx, scrollToRowRef);
        }
      }
    }

    if (e.key === "ArrowRight") {
      const input = e.target as HTMLInputElement;
      const isInput = input instanceof HTMLInputElement && input.type === "text";
      const isCaretAtEnd = isInput && input.selectionStart === input.value.length;

      if (!isEditing || isCaretAtEnd) {
        e.preventDefault();
        if (colIdx < visibleCols.length - 1) {
          meta.setSelection({ rowId: rows[rIdx]?.original.id, columnId: visibleCols[colIdx + 1], isEditing: false });
          focusWithScroll(getCellId(visibleCols[colIdx + 1], rIdx), rIdx, scrollToRowRef);
        }
      }
    }

    if (e.key === "F2") {
      if (!isEditing && isColumnEditable(columnId)) {
        e.preventDefault();
        meta.setSelection({ rowId: rows[rIdx]?.original.id, columnId, isEditing: true });
        requestAnimationFrame(() => {
          const input = document.getElementById(getInputId(columnId, rIdx)) as HTMLInputElement;
          if (input) {
            input.focus();
            const len = input.value.length;
            input.setSelectionRange(len, len);
          }
        });
      }
    }

    if (e.key === "Delete" || e.key === "Backspace") {
      if (!isEditing && isColumnEditable(columnId)) {
        e.preventDefault();
        // Clear cell content
        if (columnId.startsWith("custom-")) {
          meta.handleCustomCellEdit(rIdx, columnId, "");
          meta.commitCustomCellEdit(rows[rIdx]?.original.id, columnId, String(rows[rIdx]?.original.customFields?.[columnId] ?? ""), "");
        } else {
          const prevVal = (rows[rIdx]?.original[columnId as keyof ProcessedTakeoffRow] ?? "") as string | number | boolean;
          meta.handleCellEdit(rIdx, columnId as keyof ProcessedTakeoffRow, "");
          meta.commitCellEdit(rows[rIdx]?.original.id, columnId as keyof ProcessedTakeoffRow, prevVal, "");
        }
      }
    }

    // Ctrl+Home: Jump to first editable cell
    if (e.key === "Home" && (e.ctrlKey || e.metaKey)) {
      if (!isEditing) {
        e.preventDefault();
        const firstEditableCol = visibleCols.find((c: string) => isColumnEditable(c));
        if (firstEditableCol && totalRows > 0) {
          meta.setSelection({ rowId: rows[0]?.original.id, columnId: firstEditableCol, isEditing: false });
          focusWithScroll(getCellId(firstEditableCol, 0), 0, scrollToRowRef);
        }
      }
    }

    // Ctrl+End: Jump to last editable cell
    if (e.key === "End" && (e.ctrlKey || e.metaKey)) {
      if (!isEditing) {
        e.preventDefault();
        const editableCols = visibleCols.filter((c: string) => isColumnEditable(c));
        const lastEditableCol = editableCols[editableCols.length - 1];
        const lastIdx = totalRows - 1;
        if (lastEditableCol && lastIdx >= 0) {
          meta.setSelection({ rowId: rows[lastIdx]?.original.id, columnId: lastEditableCol, isEditing: false });
          focusWithScroll(getCellId(lastEditableCol, lastIdx), lastIdx, scrollToRowRef);
        }
      }
    }

    // PageDown: Move selection down by 20 rows
    if (e.key === "PageDown") {
      if (!isEditing) {
        e.preventDefault();
        const targetIdx = Math.min(rIdx + 20, totalRows - 1);
        if (targetIdx !== rIdx && targetIdx >= 0) {
          meta.setSelection({ rowId: rows[targetIdx]?.original.id, columnId, isEditing: false });
          focusWithScroll(getCellId(columnId, targetIdx), targetIdx, scrollToRowRef);
        }
      }
    }

    // PageUp: Move selection up by 20 rows
    if (e.key === "PageUp") {
      if (!isEditing) {
        e.preventDefault();
        const targetIdx = Math.max(rIdx - 20, 0);
        if (targetIdx !== rIdx) {
          meta.setSelection({ rowId: rows[targetIdx]?.original.id, columnId, isEditing: false });
          focusWithScroll(getCellId(columnId, targetIdx), targetIdx, scrollToRowRef);
        }
      }
    }

    // Direct alphanumeric keypress overwrite in Navigation Mode
    if (!isEditing && isColumnEditable(columnId) && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      meta.setSelection({
        rowId: rows[rIdx]?.original.id,
        columnId,
        isEditing: true,
        initialEditChar: e.key,
      });
      requestAnimationFrame(() => {
        const input = document.getElementById(getInputId(columnId, rIdx)) as HTMLInputElement;
        if (input) {
          input.focus();
          input.value = e.key;
          // Trigger input dispatch
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, rIdx: number, type: "code" | "desc" | "qty" | "price", table: Table<ProcessedTakeoffRow>) => {
    const colMapping: Record<string, string> = {
      code: "itemId",
      desc: "description",
      qty: "matchedQty",
      price: "unitPrice",
    };
    processGridNavigation(e, rIdx, colMapping[type], table);
  };

  const handleCustomKeyDown = (e: React.KeyboardEvent, rIdx: number, columnId: string, table: Table<ProcessedTakeoffRow>) => {
    processGridNavigation(e, rIdx, columnId, table);
  };

  return { handleKeyDown, handleCustomKeyDown };
}
