"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { saveProjectLockedCells } from "@/lib/db";
import { WorkbookCommand } from "@/types";

// ---------------------------------------------------------------------------
// useLockedCells — Cell lock state management
// Extracted from useTakeoffWorkbook.tsx (Phase 2, Item 7)
// ---------------------------------------------------------------------------

export interface UseLockedCellsReturn {
  lockedCells: Record<string, boolean>;
  setLockedCells: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  lockedCellsRef: React.MutableRefObject<Record<string, boolean>>;
  handleToggleCellLock: (rowId: string, columnId: string, onComplete?: () => void) => void;
}

export function useLockedCells(
  projectId: string,
  isLoaded: boolean,
  commandHistory: { pushCommand: (cmd: WorkbookCommand) => void }
): UseLockedCellsReturn {
  const [lockedCells, setLockedCells] = useState<Record<string, boolean>>({});
  const lockedCellsRef = useRef(lockedCells);
  useEffect(() => { lockedCellsRef.current = lockedCells; }, [lockedCells]);

  // Debounced persistence
  const lockedCellsString = JSON.stringify(lockedCells);
  const locksTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isLoaded || !projectId) return;
    if (locksTimerRef.current) clearTimeout(locksTimerRef.current);
    locksTimerRef.current = setTimeout(() => {
      saveProjectLockedCells(projectId, lockedCells).catch((err) => console.error('Locked cells persist failed:', err));
    }, 1500);
    return () => { if (locksTimerRef.current) clearTimeout(locksTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedCellsString, isLoaded, projectId]);

  // Toggle with optional onComplete callback (GAP-4 fix: context menu dismiss)
  const handleToggleCellLock = useCallback((rowId: string, columnId: string, onComplete?: () => void) => {
    const cellKey = `${rowId}::${columnId}`;
    const prevLocked = !!lockedCellsRef.current[cellKey];

    // pushCommand BEFORE state setter (AGENTS.md guardrail)
    commandHistory.pushCommand({
      type: "TOGGLE_CELL_LOCK",
      cellKey,
      prevLocked,
      nextLocked: !prevLocked,
    });

    setLockedCells((prev) => ({ ...prev, [cellKey]: !prev[cellKey] }));
    onComplete?.();
  }, [commandHistory]);

  return {
    lockedCells,
    setLockedCells,
    lockedCellsRef,
    handleToggleCellLock,
  };
}
