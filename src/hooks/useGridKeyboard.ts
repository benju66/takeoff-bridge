import { useCallback, useEffect } from "react";
import type React from "react";
import type { Table } from "@tanstack/react-table";
import type { GridSelectionState } from "@/types";

// ---------------------------------------------------------------------------
// useGridKeyboard — Reusable grid-level keyboard navigation hook.
//
// Provides a single onKeyDown handler and focus safety net for any TanStack
// Table that uses GridSelectionState. Attach the returned handler and
// tabIndex={-1} to the table's scroll container div.
//
// The hook does NOT handle editing-mode key events (inputs handle their own).
// It skips events from interactive child elements (INPUT, TEXTAREA, BUTTON,
// SELECT) so action buttons and edit inputs continue to work normally.
// ---------------------------------------------------------------------------

interface UseGridKeyboardOptions<TData = unknown> {
  /** Ref to the grid scroll container div */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Current grid selection state */
  selection: GridSelectionState;
  /** TanStack Table instance */
  table: Table<TData>;
  /** Keyboard navigation handler — receives (event, rowIndex, columnId, table).
   *  Typically wired to meta.handleCustomKeyDown from useKeyboardNavigation. */
  onNavigate: (
    e: React.KeyboardEvent,
    rIdx: number,
    columnId: string,
    table: Table<TData>
  ) => void;
  /** Extract the row ID from a row's original data. Defaults to `row.id`. */
  getRowId?: (row: TData) => string;
}

interface UseGridKeyboardReturn {
  /** Attach to the grid container's onKeyDown */
  handleGridKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  /** Call to programmatically focus the grid container (e.g., after clicks) */
  focusContainer: () => void;
}

export function useGridKeyboard<TData = unknown>({
  containerRef,
  selection,
  table,
  onNavigate,
  getRowId = (row) => (row as { id: string }).id,
}: UseGridKeyboardOptions<TData>): UseGridKeyboardReturn {

  // Focus the container (single rAF for click responsiveness)
  const focusContainer = useCallback(() => {
    requestAnimationFrame(() => {
      containerRef.current?.focus({ preventScroll: true });
    });
  }, [containerRef]);

  // Grid-level keyboard handler — single owner for all nav-mode key events.
  const handleGridKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Skip events from interactive child elements (editing inputs, action buttons)
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "BUTTON" ||
        target.tagName === "SELECT"
      )
        return;

      // Skip if no active selection or if in editing mode
      if (!selection.rowId || !selection.columnId || selection.isEditing) return;

      // Compute row index from selection.rowId
      const rows = table.getRowModel().rows;
      const rIdx = rows.findIndex(
        (r) => getRowId(r.original) === selection.rowId
      );
      if (rIdx < 0) return;

      // Delegate to the navigation handler
      onNavigate(e, rIdx, selection.columnId, table);
    },
    [selection, table, onNavigate, getRowId]
  );

  // Focus safety net — after every selection change, ensure the container has
  // focus so keyboard events are captured. Uses double-rAF to run after any
  // pending focusWithScroll attempts have completed.
  useEffect(() => {
    if (!selection.rowId || selection.isEditing) return;

    let innerTimer: number;

    const outerTimer = requestAnimationFrame(() => {
      innerTimer = requestAnimationFrame(() => {
        if (!containerRef.current) return;
        if (document.activeElement !== containerRef.current) {
          containerRef.current.focus({ preventScroll: true });
        }
      });
    });

    return () => {
      cancelAnimationFrame(outerTimer);
      if (innerTimer) {
        cancelAnimationFrame(innerTimer);
      }
    };
  }, [selection.rowId, selection.columnId, selection.isEditing, containerRef]);

  return { handleGridKeyDown, focusContainer };
}
