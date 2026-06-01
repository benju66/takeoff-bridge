"use client";

import React from "react";
import { ProcessedTakeoffRow } from "@/types";

// ---------------------------------------------------------------------------
// useKeyboardNavigation — Grid keyboard navigation handlers
// Extracted from useTakeoffWorkbook.tsx (Phase 2, Item 7)
// ---------------------------------------------------------------------------

export interface UseKeyboardNavigationReturn {
  handleKeyDown: (e: React.KeyboardEvent, rIdx: number, type: "code" | "desc" | "qty" | "price") => void;
  handleCustomKeyDown: (e: React.KeyboardEvent, rIdx: number, colId: string) => void;
}

export function useKeyboardNavigation(
  rowsRef: React.MutableRefObject<ProcessedTakeoffRow[]>
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
        } else if (rIdx < rowsRef.current.length - 1) {
          e.preventDefault();
          document.getElementById(`code-input-${rIdx + 1}`)?.focus();
        }
      }
    }
  };

  const handleCustomKeyDown = (e: React.KeyboardEvent, rIdx: number, colId: string) => {
    if (e.key === "Escape") {
      e.preventDefault();
      (e.target as HTMLElement).blur();
    }
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

  return { handleKeyDown, handleCustomKeyDown };
}
