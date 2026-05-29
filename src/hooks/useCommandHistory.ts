"use client";

import { useState, useCallback } from "react";
import { ProcessedTakeoffRow, ColumnDefinition } from "@/types";

// ---------------------------------------------------------------------------
// WorkbookCommand — Discriminated union of all undoable commands
// ---------------------------------------------------------------------------

export interface EditCellCommand {
  type: "EDIT_CELL";
  rowId: string;
  field: keyof ProcessedTakeoffRow;
  prevValue: string | number | boolean;
  nextValue: string | number | boolean;
  /** Cascade side-effects for itemId edits that propagate to sibling rows */
  cascadeEffects?: Array<{
    rowId: string;
    prevFields: Partial<ProcessedTakeoffRow>;
    nextFields: Partial<ProcessedTakeoffRow>;
  }>;
  /** Registry write side-effects for undo/redo persistence */
  registryDelta?: {
    projectRegistry?: { key: string; prevValue: string; nextValue: string };
    globalRegistry?: { key: string; prevValue: string; nextValue: string };
  };
}

export interface EditCustomCellCommand {
  type: "EDIT_CUSTOM_CELL";
  rowId: string;
  columnId: string;
  prevValue: string;
  nextValue: string;
}

export interface PasteCommand {
  type: "PASTE";
  /** Ordered list of atomic sub-edits grouped as a single undo unit */
  edits: Array<{
    rowId: string;
    field: keyof ProcessedTakeoffRow;
    prevFields: Partial<ProcessedTakeoffRow>;
    nextFields: Partial<ProcessedTakeoffRow>;
  }>;
  registryDelta?: {
    projectRegistry?: Record<string, { prev: string; next: string }>;
    globalRegistry?: Record<string, { prev: string; next: string }>;
  };
}

export interface InsertRowCommand {
  type: "INSERT_ROW";
  rowId: string;
  insertIndex: number;
  rowData: ProcessedTakeoffRow;
}

export interface DeleteColumnCommand {
  type: "DELETE_COLUMN";
  columnDef: ColumnDefinition;
  columnIndex: number;
  /** Snapshot of all custom field values for this column across rows */
  cellValues: Record<string, string | number>;
}

export interface AddColumnCommand {
  type: "ADD_COLUMN";
  columnDef: ColumnDefinition;
}

export interface ToggleCellLockCommand {
  type: "TOGGLE_CELL_LOCK";
  cellKey: string;
  prevLocked: boolean;
  nextLocked: boolean;
}

export interface MergeTakeoffDataCommand {
  type: "MERGE_TAKEOFF_DATA";
  /** Full row-level diff: previous field values for all rows that changed */
  prevRowStates: Array<{
    rowId: string;
    fields: Partial<ProcessedTakeoffRow>;
  }>;
  nextRowStates: Array<{
    rowId: string;
    fields: Partial<ProcessedTakeoffRow>;
  }>;
  prevUnmapped: string[];
  nextUnmapped: string[];
}

export type WorkbookCommand =
  | EditCellCommand
  | EditCustomCellCommand
  | PasteCommand
  | InsertRowCommand
  | DeleteColumnCommand
  | AddColumnCommand
  | ToggleCellLockCommand
  | MergeTakeoffDataCommand;

// ---------------------------------------------------------------------------
// useCommandHistory — Dual-stack undo/redo engine
// ---------------------------------------------------------------------------

const MAX_HISTORY_DEPTH = 50;

export interface UseCommandHistoryReturn {
  pushCommand: (cmd: WorkbookCommand) => void;
  undo: () => WorkbookCommand | null;
  redo: () => WorkbookCommand | null;
  canUndo: boolean;
  canRedo: boolean;
  undoStackSize: number;
  redoStackSize: number;
}

export function useCommandHistory(): UseCommandHistoryReturn {
  const [undoStack, setUndoStack] = useState<WorkbookCommand[]>([]);
  const [redoStack, setRedoStack] = useState<WorkbookCommand[]>([]);

  const pushCommand = useCallback((cmd: WorkbookCommand) => {
    setUndoStack((prev) => [...prev.slice(-(MAX_HISTORY_DEPTH - 1)), cmd]);
    // Any new forward mutation invalidates the redo timeline
    setRedoStack([]);
  }, []);

  const undo = useCallback((): WorkbookCommand | null => {
    let popped: WorkbookCommand | null = null;
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      popped = prev[prev.length - 1];
      return prev.slice(0, -1);
    });
    if (popped) {
      const cmd = popped;
      setRedoStack((prev) => [...prev, cmd]);
    }
    return popped;
  }, []);

  const redo = useCallback((): WorkbookCommand | null => {
    let popped: WorkbookCommand | null = null;
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      popped = prev[prev.length - 1];
      return prev.slice(0, -1);
    });
    if (popped) {
      const cmd = popped;
      setUndoStack((prev) => [...prev.slice(-(MAX_HISTORY_DEPTH - 1)), cmd]);
    }
    return popped;
  }, []);

  return {
    pushCommand,
    undo,
    redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    undoStackSize: undoStack.length,
    redoStackSize: redoStack.length,
  };
}
