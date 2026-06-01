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
  const undoStackRef = useRef<WorkbookCommand[]>([]);
  const redoStackRef = useRef<WorkbookCommand[]>([]);
  const [sizes, setSizes] = useState({ undo: 0, redo: 0 });

  const pushCommand = useCallback((cmd: WorkbookCommand) => {
    undoStackRef.current = [
      ...undoStackRef.current.slice(-(MAX_HISTORY_DEPTH - 1)),
      cmd,
    ];
    redoStackRef.current = [];
    setSizes({ undo: undoStackRef.current.length, redo: 0 });
  }, []);

  const undo = useCallback((): WorkbookCommand | null => {
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

  const redo = useCallback((): WorkbookCommand | null => {
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

