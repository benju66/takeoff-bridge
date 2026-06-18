"use client";

import React, { useCallback, useEffect, useRef } from "react";
import { Activity, RotateCcw, RotateCw, Lock, Unlock, Trash2 } from "lucide-react";
import type { Column } from "@tanstack/react-table";
import { GridShell } from "./GridShell";
import { AddLinePicker } from "./AddLinePicker";
import { EngineLinkBadge } from "./EngineLinkBadge";
import { useSiteOpsGrid } from "@/hooks/useSiteOpsGrid";
import type { UseInfrastructureCalculationsReturn } from "@/hooks/useInfrastructureCalculations";
import type { OverridePayload } from "@/lib/overrideSetter";
import type { EstimateSectionLine } from "@/types/db";
import { SITEOPS_GRAND_TOTAL_NODE_ID } from "@/lib/bindings/types";

// ---------------------------------------------------------------------------
// SiteOpsGridStep — Step 3 (Site Operations) host (Phase B3)
//
// The twin of GcPersonnelGridStep: renders Step 3 through the shared GridShell via
// useSiteOpsGrid (which specializes the useSectionLineGrid core). This component owns
// the chrome (title bar, the summary <tfoot>, the lock/unlock context menu, the
// click-outside-deselect, and the step-local global Ctrl+Z/Y listener); the hook owns
// the grid mechanics + commands.
//
// Imported Step 3 is NOT rendered here — the page keeps the read-only
// ImportedStep23Panel for imported bids (D4).
// ---------------------------------------------------------------------------

const fmtUSD = (n: number) =>
  "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface SiteOpsGridStepProps {
  infrastructure: UseInfrastructureCalculationsReturn;
  durationMonths: number;
  squareFootage: number;
  /** Records a per-line type-over (D3) — the page's handleSaveOverride. */
  onSaveOverride?: (payload: OverridePayload) => Promise<void>;
}

export function SiteOpsGridStep({
  infrastructure,
  durationMonths,
  squareFootage,
  onSaveOverride,
}: SiteOpsGridStepProps) {
  const grid = useSiteOpsGrid(infrastructure, squareFootage, onSaveOverride);
  const {
    table,
    rows,
    columnDefs,
    selection,
    contextMenu,
    setContextMenu,
    lockedCells,
    toggleCellLock,
    gridConfig,
    scrollToRowRef,
    handleUndo,
    handleRedo,
    canUndo,
    canRedo,
    undoStackSize,
    redoStackSize,
    grandTotal,
    isDerivedQtyLine,
    removedLines,
    removeLine,
    restoreLine,
    isQtyOverridden,
    beginQtyOverride,
    revertQtyOverride,
  } = grid;

  // Step-local global undo/redo (mounted only on step3; the page's listener is
  // guarded to step4). Mirrors GcPersonnelGridStep's Ctrl+Z / Ctrl+Y handler.
  const undoRef = useRef(handleUndo);
  const redoRef = useRef(handleRedo);
  useEffect(() => { undoRef.current = handleUndo; }, [handleUndo]);
  useEffect(() => { redoRef.current = handleRedo; }, [handleRedo]);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === "z" && !e.shiftKey) { e.preventDefault(); undoRef.current(); }
      else if (e.key === "y" || (e.key === "z" && e.shiftKey)) { e.preventDefault(); redoRef.current(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Click-outside-to-deselect (E2) — defer past the active input's onBlur so the
  // edit commits before unmount (§3 commit-before-unmount).
  const containerRef = useRef<HTMLDivElement>(null);
  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      const meta = table.options.meta;
      if (meta?.selection?.rowId) {
        setTimeout(() => meta.setSelection({ rowId: null, columnId: null, isEditing: false }), 0);
      }
    }
  }, [table]);
  useEffect(() => {
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [handleClickOutside]);

  // Context-menu cell-lock target (in-session lock, B2-D3). rowIndex is the data-array
  // index (info.row.index), so rows[rowIndex] resolves the line directly.
  const ctxLine: EstimateSectionLine | undefined =
    contextMenu.columnId ? rows[contextMenu.rowIndex] : undefined;
  const ctxCellKey = ctxLine ? `${ctxLine.id}::${contextMenu.columnId}` : "";
  const ctxLocked = ctxCellKey ? !!lockedCells[ctxCellKey] : false;
  const dismissCtx = () => setContextMenu((prev) => ({ ...prev, visible: false }));

  // Dismiss the menu on an OUTSIDE mousedown — but ignore mousedowns inside the menu (a
  // ref check, not stopPropagation, which does not reliably stop this document listener),
  // so a menu item's click lands before the menu closes.
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!contextMenu.visible) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      dismissCtx();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismissCtx(); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextMenu.visible]);

  return (
    <div ref={containerRef} className="bg-card border border-grid-border text-card-foreground rounded-xl overflow-hidden shadow-sm animate-fade-in">
      {/* Title bar */}
      <div className="p-4 bg-background/80 dark:bg-background/50 border-b border-grid-border flex flex-col md:flex-row md:items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
          <Activity size={16} className="text-blue-600 dark:text-blue-400" /> Division 02 Site Operations Calculation Module
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-[10px] bg-background dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-3 py-1 rounded-full border border-grid-border font-sans font-semibold">
            Active SF: {squareFootage.toLocaleString()} SF | Duration: {durationMonths} Mos
          </span>
          <AddLinePicker removedLines={removedLines} onAdd={restoreLine} />
          <button
            onClick={handleUndo}
            disabled={!canUndo}
            className="inline-flex items-center gap-1.5 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/15 dark:hover:bg-amber-950/35 text-amber-600 dark:text-amber-500 disabled:text-slate-400 border border-grid-border rounded-lg px-3 py-1.5 font-bold uppercase transition-all text-xs cursor-pointer disabled:cursor-not-allowed select-none"
          >
            <RotateCcw size={14} /> Undo ({undoStackSize})
          </button>
          <button
            onClick={handleRedo}
            disabled={!canRedo}
            className="inline-flex items-center gap-1.5 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/15 dark:hover:bg-amber-950/35 text-amber-600 dark:text-amber-500 disabled:text-slate-400 border border-grid-border rounded-lg px-3 py-1.5 font-bold uppercase transition-all text-xs cursor-pointer disabled:cursor-not-allowed select-none"
          >
            <RotateCw size={14} /> Redo ({redoStackSize})
          </button>
        </div>
      </div>

      <GridShell
        table={table}
        rows={rows}
        columnDefs={columnDefs}
        selection={selection}
        setContextMenu={setContextMenu}
        scrollToRowRef={scrollToRowRef}
        config={gridConfig}
        handleRenameColumn={() => {}}
        handleDeleteColumn={() => {}}
        globalFilter=""
        footer={
          rows.length > 0 ? (
            <tfoot style={{ display: "block" }}>
              <tr
                className="bg-background/80 dark:bg-slate-900/80 border-t border-l-4 border-l-transparent border-grid-border text-xs font-bold text-foreground"
                style={{ display: "flex", minWidth: "100%" }}
              >
                {table.getVisibleFlatColumns().map((column: Column<EstimateSectionLine>) => {
                  let content: React.ReactNode = "";
                  let alignClass = "text-left font-sans";
                  if (column.id === "code") { content = "TOTAL"; alignClass = "text-center font-bold font-mono"; }
                  else if (column.id === "description") { content = "Cumulative Division 02 Site Operations Cost"; alignClass = "text-left uppercase tracking-wider text-[10px] text-slate-600 dark:text-slate-400 font-bold"; }
                  else if (column.id === "total") {
                    content = (
                      <span className="inline-flex items-center justify-center text-emerald-600 dark:text-emerald-400 font-black font-mono">
                        {fmtUSD(grandTotal)}
                        <EngineLinkBadge nodeId={SITEOPS_GRAND_TOTAL_NODE_ID} label="Site Operations grand total" />
                      </span>
                    );
                    alignClass = "text-center text-sm text-emerald-600 dark:text-emerald-400 font-black font-mono";
                  }
                  else if (column.id === "costPerSf") {
                    content = squareFootage > 0 ? fmtUSD(grandTotal / squareFootage) : "—";
                    alignClass = "text-center text-emerald-600 dark:text-emerald-400 font-black font-mono";
                  }
                  return (
                    <td key={column.id} className={`p-3 border-r border-b border-grid-border ${alignClass}`} style={{ width: column.getSize(), flex: "none" }}>
                      {content}
                    </td>
                  );
                })}
                <td className="border-b border-grid-border" style={{ flex: "1 1 auto", minWidth: 0 }} />
              </tr>
            </tfoot>
          ) : null
        }
      />

      {/* Cell context menu: the derived-Quantity override (B3) + the in-session cell lock (B2-D3) */}
      {contextMenu.visible && ctxLine && ctxCellKey && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-card border border-grid-border rounded-lg shadow-lg overflow-hidden animate-fade-in min-w-[180px] text-xs"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* "Override quantity" — only on a derived (duration/sqft-driven) Quantity cell. */}
          {onSaveOverride && contextMenu.columnId === "quantity" && isDerivedQtyLine(ctxLine) && (
            isQtyOverridden(ctxLine.id) ? (
              <button
                type="button"
                onClick={() => { revertQtyOverride(ctxLine.id); dismissCtx(); }}
                className="w-full flex items-center gap-2 px-4 py-2.5 font-bold text-amber-600 dark:text-amber-400 text-left hover:bg-background/80 dark:hover:bg-slate-800/60 transition-colors cursor-pointer border-b border-grid-border"
              >
                <RotateCcw size={14} /> Revert quantity to computed
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { beginQtyOverride(ctxLine.id); dismissCtx(); }}
                className="w-full flex items-center gap-2 px-4 py-2.5 font-bold text-foreground text-left hover:bg-background/80 dark:hover:bg-slate-800/60 transition-colors cursor-pointer border-b border-grid-border"
              >
                <Unlock size={14} className="text-slate-500" /> Override quantity
              </button>
            )
          )}
          <button
            type="button"
            onClick={() => { toggleCellLock(ctxCellKey); dismissCtx(); }}
            className="w-full flex items-center gap-2 px-4 py-2.5 font-bold text-foreground text-left hover:bg-background/80 dark:hover:bg-slate-800/60 transition-colors cursor-pointer border-b border-grid-border"
          >
            {ctxLocked ? <Unlock size={14} className="text-slate-500" /> : <Lock size={14} className="text-slate-500" />}
            {ctxLocked ? "Unlock cell" : "Lock cell"}
          </button>
          {/* Remove this catalog line (B4 / D2) — re-add it anytime from "+ Add line". */}
          <button
            type="button"
            onClick={() => { removeLine(ctxLine); dismissCtx(); }}
            className="w-full flex items-center gap-2 px-4 py-2.5 font-bold text-red-600 dark:text-red-400 text-left hover:bg-background/80 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
          >
            <Trash2 size={14} /> Remove line
          </button>
        </div>
      )}
    </div>
  );
}
