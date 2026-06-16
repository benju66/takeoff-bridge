import React from "react";
import { ProcessedTakeoffRow, ContextMenuState } from "@/types";
import { isBindableRow } from "@/lib/bindings/authoring";

// ---------------------------------------------------------------------------
// ContextMenuPortal — Floating right-click context menu for the takeoff grid
// ---------------------------------------------------------------------------

interface ContextMenuPortalProps {
  contextMenu: ContextMenuState;
  rows: ProcessedTakeoffRow[];
  lockedCells: Record<string, boolean>;
  /** Rows whose total is user-bound (Linked Values) — toggles Define vs Edit. */
  boundRowIds: Set<string>;
  onToggleCellLock: (rowId: string, columnId: string) => void;
  onInsertRow: (direction: "above" | "below", targetIndex: number) => void;
  onDeleteRow: (rowId: string) => void;
  /** Open the "Define link…" authoring panel for this row (Linked Values Phase 5). */
  onDefineLink: (rowId: string) => void;
  onDismiss: () => void;
}

const menuBtnClass =
  "w-full text-left px-3 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded font-sans text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer";

const destructiveBtnClass =
  "w-full text-left px-3 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded font-sans text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer";

export function ContextMenuPortal({
  contextMenu,
  rows,
  lockedCells,
  boundRowIds,
  onToggleCellLock,
  onInsertRow,
  onDeleteRow,
  onDefineLink,
  onDismiss,
}: ContextMenuPortalProps) {
  if (!contextMenu.visible) return null;

  const currentRow = rows[contextMenu.rowIndex];
  const currentRowId = currentRow ? currentRow.id : "";
  const isCurrentCellLocked =
    currentRowId && contextMenu.columnId
      ? !!lockedCells[`${currentRowId}::${contextMenu.columnId}`]
      : false;

  // Linked Values Phase 5 — "Define link…" / "Edit link…" opens the authoring panel.
  // Shown only on bindable rows (non-linked-division, stable id — the §6 gate); the
  // reserved linked-division rows stay system-managed. Label flips to Edit when bound.
  const canBind = !!currentRow && isBindableRow(currentRow);
  const isBound = currentRowId ? boundRowIds.has(currentRowId) : false;

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
      {currentRowId && canBind && (
        <>
          <div className="border-t border-grid-border my-1" />
          <button
            type="button"
            data-testid={isBound ? "ctx-edit-link" : "ctx-define-link"}
            className={menuBtnClass}
            onClick={() => {
              onDefineLink(currentRowId);
              onDismiss();
            }}
          >
            {isBound ? "🔗 Edit link…" : "🔗 Define link…"}
          </button>
        </>
      )}
      {currentRowId && (
        <>
          <div className="border-t border-grid-border my-1" />
          <button
            type="button"
            className={destructiveBtnClass}
            onClick={() => {
              if (window.confirm("Delete this row? This action can be undone with Ctrl+Z.")) {
                onDeleteRow(currentRowId);
                onDismiss();
              }
            }}
          >
            🗑️ Delete Row
          </button>
        </>
      )}
    </div>
  );
}
