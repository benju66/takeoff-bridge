import React from "react";
import { ProcessedTakeoffRow, ContextMenuState } from "@/types";

// ---------------------------------------------------------------------------
// ContextMenuPortal — Floating right-click context menu for the takeoff grid
// ---------------------------------------------------------------------------

interface ContextMenuPortalProps {
  contextMenu: ContextMenuState;
  rows: ProcessedTakeoffRow[];
  lockedCells: Record<string, boolean>;
  onToggleCellLock: (rowId: string, columnId: string) => void;
  onInsertRow: (direction: "above" | "below", targetIndex: number) => void;
  onDismiss: () => void;
}

const menuBtnClass =
  "w-full text-left px-3 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded font-sans text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer";

export function ContextMenuPortal({
  contextMenu,
  rows,
  lockedCells,
  onToggleCellLock,
  onInsertRow,
  onDismiss,
}: ContextMenuPortalProps) {
  if (!contextMenu.visible) return null;

  const currentRow = rows[contextMenu.rowIndex];
  const currentRowId = currentRow ? currentRow.id : "";
  const isCurrentCellLocked =
    currentRowId && contextMenu.columnId
      ? !!lockedCells[`${currentRowId}::${contextMenu.columnId}`]
      : false;

  return (
    <div
      className="fixed bg-card border border-grid-border p-1.5 shadow-2xl rounded-lg z-50 flex flex-col gap-1 min-w-[160px] text-card-foreground"
      style={{ top: contextMenu.y, left: contextMenu.x }}
      onClick={(e) => e.stopPropagation()}
    >
      {contextMenu.columnId && (
        <button
          type="button"
          className={`${menuBtnClass} border-b border-grid-border pb-2 mb-1`}
          onClick={() => onToggleCellLock(currentRowId, contextMenu.columnId)}
        >
          {isCurrentCellLocked ? "🔓 UNLOCK CELL" : "🔒 LOCK CELL"}
        </button>
      )}
      <button
        type="button"
        className={menuBtnClass}
        onClick={() => {
          onInsertRow("above", contextMenu.rowIndex);
          onDismiss();
        }}
      >
        Insert Row Above
      </button>
      <button
        type="button"
        className={menuBtnClass}
        onClick={() => {
          onInsertRow("below", contextMenu.rowIndex);
          onDismiss();
        }}
      >
        Insert Row Below
      </button>
    </div>
  );
}
