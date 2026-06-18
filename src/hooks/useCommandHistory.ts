"use client";

import { useState, useCallback, useRef } from "react";
import { WorkbookCommand } from "@/types";

// ---------------------------------------------------------------------------
// useCommandHistory — Dual-stack undo/redo engine
//
// Stacks are stored in refs for synchronous, deterministic access.
// A lightweight `sizes` state triggers re-renders so that UI elements
// (canUndo/canRedo) stay in sync without relying on undocumented React
// state-updater timing.
//
// Generic over the command payload type (B2): Step 4 uses the default
// `WorkbookCommand`; Step 2's grid (useGcPersonnelGrid) instantiates it with
// its own leaner `GcGridCommand` union. The default keeps every existing
// caller byte-identical — `useCommandHistory()` resolves exactly as before.
// ---------------------------------------------------------------------------

const MAX_HISTORY_DEPTH = 50;

export interface UseCommandHistoryReturn<T = WorkbookCommand> {
  pushCommand: (cmd: T) => void;
  undo: () => T | null;
  redo: () => T | null;
  canUndo: boolean;
  canRedo: boolean;
  undoStackSize: number;
  redoStackSize: number;
}

export function useCommandHistory<T = WorkbookCommand>(): UseCommandHistoryReturn<T> {
  const undoStackRef = useRef<T[]>([]);
  const redoStackRef = useRef<T[]>([]);
  const [sizes, setSizes] = useState({ undo: 0, redo: 0 });

  const pushCommand = useCallback((cmd: T) => {
    undoStackRef.current = [
      ...undoStackRef.current.slice(-(MAX_HISTORY_DEPTH - 1)),
      cmd,
    ];
    redoStackRef.current = [];
    setSizes({ undo: undoStackRef.current.length, redo: 0 });
  }, []);

  const undo = useCallback((): T | null => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return null;

    const popped = stack[stack.length - 1];
    undoStackRef.current = stack.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current, popped];
    setSizes({
      undo: undoStackRef.current.length,
      redo: redoStackRef.current.length,
    });
    return popped;
  }, []);

  const redo = useCallback((): T | null => {
    const stack = redoStackRef.current;
    if (stack.length === 0) return null;

    const popped = stack[stack.length - 1];
    redoStackRef.current = stack.slice(0, -1);
    undoStackRef.current = [
      ...undoStackRef.current.slice(-(MAX_HISTORY_DEPTH - 1)),
      popped,
    ];
    setSizes({
      undo: undoStackRef.current.length,
      redo: redoStackRef.current.length,
    });
    return popped;
  }, []);

  return {
    pushCommand,
    undo,
    redo,
    canUndo: sizes.undo > 0,
    canRedo: sizes.redo > 0,
    undoStackSize: sizes.undo,
    redoStackSize: sizes.redo,
  };
}

