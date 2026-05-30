"use client";

import { useState, useEffect, useRef } from "react";
import { ColumnDefinition, WorkbookCommand } from "@/types";
import { saveProjectColumnDefs } from "@/lib/db";

// ---------------------------------------------------------------------------
// useColumnDefinitions — Column definition state & CRUD
// Extracted from useTakeoffWorkbook.tsx (Phase 2, Item 7)
// ---------------------------------------------------------------------------

const DEFAULT_COLUMN_DEFS: ColumnDefinition[] = [
  { id: "costType", header: "TYPE", type: "default" },
  { id: "itemId", header: "Code", type: "default" },
  { id: "description", header: "Description", type: "default" },
  { id: "matchedQty", header: "Quantity", type: "default" },
  { id: "uom", header: "Unit", type: "default" },
  { id: "unitPrice", header: "Rate", type: "default" },
  { id: "total", header: "Total", type: "default" },
  { id: "costPerUnit", header: "Cost/Unit", type: "default" },
  { id: "costPerSf", header: "Cost/S.F.", type: "default" },
];

export interface UseColumnDefinitionsReturn {
  columnDefs: ColumnDefinition[];
  setColumnDefs: React.Dispatch<React.SetStateAction<ColumnDefinition[]>>;
  columnDefsRef: React.MutableRefObject<ColumnDefinition[]>;
  handleAddCustomColumn: () => void;
  handleDeleteColumn: (colId: string) => void;
  handleRenameColumn: (colId: string, newHeader: string) => void;
}

export function useColumnDefinitions(
  projectId: string,
  isLoaded: boolean,
  commandHistory: { pushCommand: (cmd: WorkbookCommand) => void },
  rowsRef: React.MutableRefObject<import("@/types").ProcessedTakeoffRow[]>
): UseColumnDefinitionsReturn {
  const [columnDefs, setColumnDefs] = useState<ColumnDefinition[]>(DEFAULT_COLUMN_DEFS);
  const columnDefsRef = useRef(columnDefs);
  useEffect(() => { columnDefsRef.current = columnDefs; }, [columnDefs]);

  // Debounced persistence
  const columnDefsString = JSON.stringify(columnDefs);
  const colDefsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isLoaded || !projectId) return;
    if (colDefsTimerRef.current) clearTimeout(colDefsTimerRef.current);
    colDefsTimerRef.current = setTimeout(() => {
      saveProjectColumnDefs(projectId, columnDefs).catch((err) => console.error('Column defs persist failed:', err));
    }, 1500);
    return () => { if (colDefsTimerRef.current) clearTimeout(colDefsTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnDefsString, isLoaded, projectId]);

  // Add custom column
  const handleAddCustomColumn = () => {
    const newColId = `custom-${Date.now()}`;
    const newColDef: ColumnDefinition = { id: newColId, header: "NEW COLUMN", type: "custom" };

    // pushCommand BEFORE state setter (AGENTS.md guardrail)
    commandHistory.pushCommand({
      type: "ADD_COLUMN",
      columnDef: newColDef,
    });

    setColumnDefs((prev) => [...prev, newColDef]);
  };

  // Delete custom column (with cell value snapshot for undo)
  const handleDeleteColumn = (colId: string) => {
    const currentColDefs = columnDefsRef.current;
    const colIndex = currentColDefs.findIndex((col) => col.id === colId);
    if (colIndex === -1) return;
    const colDef = currentColDefs[colIndex];

    // Capture all cell values for this column across rows
    const cellValues: Record<string, string | number> = {};
    const currentRows = rowsRef.current;
    for (const r of currentRows) {
      const val = r.customFields?.[colId];
      if (val !== undefined) {
        cellValues[r.id] = val;
      }
    }

    // pushCommand BEFORE state setter (AGENTS.md guardrail)
    commandHistory.pushCommand({
      type: "DELETE_COLUMN",
      columnDef: colDef,
      columnIndex: colIndex,
      cellValues,
    });

    setColumnDefs((prev) => prev.filter((col) => col.id !== colId));
  };

  // Rename custom column header
  const handleRenameColumn = (colId: string, newHeader: string) => {
    setColumnDefs((prev) =>
      prev.map((col) => (col.id === colId ? { ...col, header: newHeader } : col))
    );
  };

  return {
    columnDefs,
    setColumnDefs,
    columnDefsRef,
    handleAddCustomColumn,
    handleDeleteColumn,
    handleRenameColumn,
  };
}
