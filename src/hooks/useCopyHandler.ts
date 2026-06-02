"use client";

import { useEffect } from "react";
import { ProcessedTakeoffRow, GridSelectionState } from "@/types";

// ---------------------------------------------------------------------------
// useCopyHandler — Clipboard copy capture for Strategy A Grid Selection
// ---------------------------------------------------------------------------

export function useCopyHandler(
  rows: ProcessedTakeoffRow[],
  selection: GridSelectionState,
  squareFootage: number,
  unitCount: number
) {
  useEffect(() => {
    const handleCopy = (e: ClipboardEvent) => {
      // Only capture copy events when not actively typing in an input (isEditing === false)
      if (selection.isEditing) return;
      if (!selection.rowId || !selection.columnId) return;

      const activeElement = document.activeElement;
      // If we are focused on a native text input that is not our cell, let it handle its own copy
      if (activeElement) {
        const tagName = activeElement.tagName.toLowerCase();
        if ((tagName === "input" || tagName === "textarea") && activeElement.id !== `cell-${selection.rowId}-${selection.columnId}`) {
          return;
        }
      }

      const row = rows.find((r) => r.id === selection.rowId);
      if (!row) return;

      let value = "";
      const colId = selection.columnId;

      if (colId === "itemId") {
        value = row.itemId || "";
      } else if (colId === "description") {
        value = row.description || "";
      } else if (colId === "matchedQty") {
        value = String(row.matchedQty);
      } else if (colId === "unitPrice") {
        value = String(row.unitPrice);
      } else if (colId === "uom") {
        value = row.uom || "";
      } else if (colId === "total") {
        value = String(row.total);
      } else if (colId === "costPerUnit") {
        const cpu = unitCount > 0 ? row.total / unitCount : 0;
        value = String(cpu);
      } else if (colId === "costPerSf") {
        const cps = squareFootage > 0 ? row.total / squareFootage : 0;
        value = String(cps);
      } else if (colId.startsWith("custom-")) {
        value = String(row.customFields?.[colId] ?? "");
      }

      if (e.clipboardData) {
        e.preventDefault();
        e.clipboardData.setData("text/plain", value);
      }
    };

    document.addEventListener("copy", handleCopy);
    return () => {
      document.removeEventListener("copy", handleCopy);
    };
  }, [rows, selection, squareFootage, unitCount]);
}
