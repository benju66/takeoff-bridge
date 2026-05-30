"use client";

import { useState, useCallback } from "react";
import { WorkbookCommand } from "@/types";

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
