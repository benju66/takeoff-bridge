"use client";

import React from "react";
import { ProcessedTakeoffRow } from "@/types";

// ---------------------------------------------------------------------------
// useKeyboardNavigation — Grid keyboard navigation handlers
// Extracted from useTakeoffWorkbook.tsx (Phase 2, Item 7)
// Updated in Phase 3 for virtualization: accepts optional scrollToRow callback
// ---------------------------------------------------------------------------

export interface UseKeyboardNavigationReturn {
  handleKeyDown: (e: React.KeyboardEvent, rIdx: number, type: "code" | "desc" | "qty" | "price") => void;
  handleCustomKeyDown: (e: React.KeyboardEvent, rIdx: number, colId: string) => void;
}

/**
 * Focus an element by ID, scrolling it into view first if a scrollToRow callback is provided.
 * Uses requestAnimationFrame to wait for the virtualizer to render the target row.
 */
function focusWithScroll(elementId: string, targetRowIdx: number, scrollToRow?: (index: number) => void) {
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
  scrollToRow?: (index: number) => void
): UseKeyboardNavigationReturn {
  const handleKeyDown = (e: React.KeyboardEvent, rIdx: number, type: "code" | "desc" | "qty" | "price") => {
    const columnsList: ("code" | "desc" | "qty" | "price")[] = ["code", "desc", "qty", "price"];
    const colIdx = columnsList.indexOf(type);

    if (e.key === "Escape") {
      e.preventDefault();
      (e.target as HTMLElement).blur();
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusWithScroll(`${type}-input-${rIdx + 1}`, rIdx + 1, scrollToRow);
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      focusWithScroll(`${type}-input-${rIdx - 1}`, rIdx - 1, scrollToRow);
    }
    if (e.key === "Enter") {
      e.preventDefault();
      focusWithScroll(`${type}-input-${rIdx + 1}`, rIdx + 1, scrollToRow);
    }
    if (e.key === "Tab") {
      if (e.shiftKey) {
        if (colIdx > 0) {
          e.preventDefault();
          focusWithScroll(`${columnsList[colIdx - 1]}-input-${rIdx}`, rIdx, scrollToRow);
        } else if (rIdx > 0) {
          e.preventDefault();
          focusWithScroll(`price-input-${rIdx - 1}`, rIdx - 1, scrollToRow);
        }
      } else {
        if (colIdx < columnsList.length - 1) {
          e.preventDefault();
          focusWithScroll(`${columnsList[colIdx + 1]}-input-${rIdx}`, rIdx, scrollToRow);
        } else if (rIdx < rowsRef.current.length - 1) {
          e.preventDefault();
          focusWithScroll(`code-input-${rIdx + 1}`, rIdx + 1, scrollToRow);
        }
      }
    }
    if (e.key === "F2") {
      e.preventDefault();
      // F2 in Excel enters edit mode — here, move cursor to end of input (deselect all)
      const input = e.target as HTMLInputElement;
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
    if (e.key === "Delete") {
      e.preventDefault();
      // Clear cell content via native input event so React picks up the change
      const input = e.target as HTMLInputElement;
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      nativeInputValueSetter?.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };

  const handleCustomKeyDown = (e: React.KeyboardEvent, rIdx: number, colId: string) => {
    if (e.key === "Escape") {
      e.preventDefault();
      (e.target as HTMLElement).blur();
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusWithScroll(`custom-${colId}-input-${rIdx + 1}`, rIdx + 1, scrollToRow);
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      focusWithScroll(`custom-${colId}-input-${rIdx - 1}`, rIdx - 1, scrollToRow);
    }
    if (e.key === "Enter") {
      e.preventDefault();
      focusWithScroll(`custom-${colId}-input-${rIdx + 1}`, rIdx + 1, scrollToRow);
    }
    if (e.key === "F2") {
      e.preventDefault();
      const input = e.target as HTMLInputElement;
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
    if (e.key === "Delete") {
      e.preventDefault();
      const input = e.target as HTMLInputElement;
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      nativeInputValueSetter?.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };

  return { handleKeyDown, handleCustomKeyDown };
}
