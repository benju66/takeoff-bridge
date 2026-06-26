"use client";

/* B1b note (revisits B1a's file-level eslint-disable): the React Compiler is NOT enabled in
   next.config.ts, so the directive that used to sit here ("use no compiler" was a no-op string)
   was inert — only eslint-plugin-react-hooks' compiler-aware ADVISORIES run, statically. Moving
   useVirtualizer into GridShell (B1a) removed this file's compiler bail-out point, surfacing two
   advisories on long-standing, correct code: the stable-setter useCallback deps (openTrust /
   handleViewRow) and the one-shot pendingInspect setState-in-effect. Both are intentional and
   carry no runtime cost (no compiler in the build); each is now suppressed at its exact site with
   eslint-disable-next-line — narrowed from B1a's whole-file disable so the rest of the file stays
   linted. Addressing them "for real" would mean restructuring correct, stable code for no gain. */

import React, { useRef, useState, useMemo, useEffect, useCallback } from "react";
import Link from "next/link";
import { useReactTable } from "@tanstack/react-table";
import type { Column } from "@tanstack/react-table";
import { Upload, AlertTriangle, Activity, RotateCcw, RotateCw, FileDown, ChevronDown, Search, Flag, Link2, Layers, Plus } from "lucide-react";
import { getCatalogItems } from "@/lib/catalog";
import { ProcessedTakeoffRow, ColumnDefinition, ContextMenuState, GridSelectionState, EstimateOverrideRecord } from "@/types";
import { Project, DivisionLayout, EstimateSectionLine } from "@/types/db";
import { feeLineAmount } from "@/lib/sectionLines/markup";
import { NumberCellInput } from "./NumberCellInput";
import { StringCellInput } from "./StringCellInput";
import { OneOffAssignPopover, type OneOffAssignTarget } from "./OneOffAssignPopover";
import { ESTIMATE_MODIFIERS, isLinkedDivisionRow, DIVISION_LABELS } from "@/lib/constants";
import { getDivisionCode } from "@/lib/division";
import { getTerminalProgressBar, roundByRule, TakeoffSummary, LinkedDivisionTotal } from "@/lib/calculations";
import { GridShell } from "./GridShell";
import type { GridShellConfig } from "./GridShell";
import type { PersonnelCalcResult, SiteOpsCalcResult } from "@/lib/calculations";
import { TrustInspector } from "./TrustInspector";
import type { ReconciliationModel, TrustTab, OverridePair } from "@/lib/trustInspector";
import { buildFlagsModel } from "@/lib/trustInspector";
import type { Binding } from "@/lib/bindings/types";
import type { LensView, BuyoutRollup, BuyoutProfit } from "@/lib/buyout";
import { lineFieldNodeId } from "@/lib/bindings/compile";
import type { OverridePayload } from "@/lib/overrideSetter";
import { DivisionAggregation, CostTypeAggregation } from "@/types";
import { SearchBar } from "./SearchBar";
import { ImportPreviewModal } from "./ImportPreviewModal";
import { PendingImport } from "@/hooks/useFileIngestion";
import { ArchParamSuggestion } from "@/lib/archParamDetector";

// ---------------------------------------------------------------------------
// EstimateTable — Step 4 Panel
// Takeoff Workbook Spreadsheet Matrix + Summary Analytics
// ---------------------------------------------------------------------------

const fmtUSD = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Fee-block context-menu button styling (mirrors ContextMenuPortal so the two menus match).
const feeMenuBtnClass =
  "w-full text-left px-3 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded font-sans text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer";
const feeMenuDestructiveClass =
  "w-full text-left px-3 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded font-sans text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer";

// Step-4 grid column sets fed to GridShell's host config (B1b). These were inline arrays
// inside the shell before generalization; they live here now because they are Step-4-specific.
// `vendor`/`actual` are the editable Buyout lens columns (Phase 2). `variance` is read-only
// (omitted here) but center-aligned. They commit to the browser-local buyout store, not rows.
const STEP4_EDITABLE_COLUMN_IDS = ["itemId", "description", "matchedQty", "unitPrice", "uom", "vendor", "actual"] as const;
const STEP4_CENTER_ALIGNED_COLUMN_IDS = ["costType", "uom", "itemId", "matchedQty", "unitPrice", "total", "costPerSf", "costPerUnit", "actual", "variance"] as const;

/** A locked summary total cell: the formatted value plus a 🔍 trace affordance
 *  that opens the Trust Inspector focused on this value (Phase 5). When the field is
 *  overridden, a ⚑ marker is shown with the computed→override pair on hover (5c.2). */
function SummaryTraceCell({
  valueStr,
  onTrace,
  onLinks,
  overridden,
}: {
  valueStr: string;
  onTrace: () => void;
  onLinks?: () => void;
  overridden?: OverridePair;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 justify-center">
      {overridden && (
        // Computed value is never hidden — surfaced on hover (the trace shows it inline too).
        <span
          className="inline-flex shrink-0 text-amber-600 dark:text-amber-400"
          title={`Overridden — computed ${fmtUSD(overridden.computedValue)} → override ${fmtUSD(overridden.overrideValue)}`}
          aria-label="Overridden value"
        >
          <Flag size={11} />
        </span>
      )}
      <span>{valueStr}</span>
      <button
        type="button"
        onClick={onTrace}
        title="Trace this number"
        aria-label="Open Trust Inspector for this value"
        className="text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
      >
        <Search size={12} />
      </button>
      {onLinks && (
        <button
          type="button"
          data-testid="summary-links"
          onClick={onLinks}
          title="Inspect this value's links (what it reads, what feeds off it)"
          aria-label="Open the Links tab for this value"
          className="text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
        >
          <Link2 size={12} />
        </button>
      )}
    </span>
  );
}

/** Always-on Procore reconciliation chip in the status bar (Phase 5 — 5b). Green
 *  ✅ when screen == Procore to the cent; amber ⚠ for export blockers; blue ⓘ for a
 *  deliberate subtotal/total override. Click → Trust Inspector on the Reconcile tab. */
function ReconChip({ reconciliation, onOpen }: { reconciliation: ReconciliationModel; onOpen: () => void }) {
  const { status, grandTotal, blockerCount } = reconciliation;
  const deltaStr = `$${Math.abs(grandTotal.delta).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  let className: string;
  let label: string;
  if (status === "ties") {
    className = "text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/20";
    label = "Procore ✅ ties";
  } else if (status === "override") {
    className = "text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/20";
    label = "Procore ✅ scope ties · ⓘ override";
  } else {
    className = "text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/20";
    label = blockerCount > 0 ? `Procore ⚠ ${blockerCount} unmapped` : `Procore Δ ${deltaStr} ⚠`;
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Open the Procore reconciliation"
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono cursor-pointer transition-colors ${className}`}
    >
      {label}
    </button>
  );
}

/** Format a dollar amount the same way every total in this grid is formatted. */
function money(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Estimate Buyout Lens footer (Phase 4) — the at-a-glance "how's buyout going" read, shown
 * ONLY in the Buyout lens. It mirrors the bottom of the company template's STEP 4 sheet:
 *  • Total Estimate (Bid)  — the engine's grand Total Estimated Cost (ties to template I341
 *    and to the grid's own "Total Estimated Cost" row).
 *  • Total Projected Cost  — bid − profit (= Σ actual-or-estimate + contingency/insurance,
 *    excl. fee; ties to template P341).
 *  • Projected Profit ($ + %) — fee + buyout savings (green when making money / red when
 *    underwater; ties to template O347 / P347). Profit is NOT a cost — the fee falls straight
 *    to it, and every dollar a sub comes in under estimate adds to it.
 *  • "% of value committed" bar (L-4 — Σ Estimate on lines with a Vendor ÷ Σ Estimate over the
 *    awardable data lines) — a buyout-PROGRESS gauge, distinct from the profit margin %.
 * Pure display: `profit` is derived live (engine bid + browser-local savings) and the rollup
 * reads `buyout.map` — nothing here persists or enters the engine/export, so no dollar can move.
 * Both helpers are zero-guarded → an empty estimate renders $0 / 0%, never NaN/Infinity. When a
 * filter is active the numbers still reflect the WHOLE estimate (so a hidden line still counts),
 * with a note to that effect.
 */
function BuyoutRollupFooter({
  rollup,
  profit,
  isFiltered,
}: {
  rollup: BuyoutRollup;
  profit: BuyoutProfit;
  isFiltered: boolean;
}) {
  const { committedEstimate, estimateTotal, percentCommitted } = rollup;
  // committed is a subset of the total so percent is in [0,1]; clamp defensively for the bar width.
  const pct = Math.min(100, Math.max(0, percentCommitted * 100));
  const inProfit = profit.profit > 0; // making money (fee + savings positive)
  const underwater = profit.profit < 0; // overruns have eaten through the fee
  const profitTone = inProfit
    ? "text-emerald-600 dark:text-emerald-400"
    : underwater
    ? "text-red-600 dark:text-red-400"
    : "text-slate-500 dark:text-slate-400";
  return (
    <div className="buyout-rollup border-t border-grid-border px-4 py-2.5 select-none text-[11px] font-sans">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">Buyout</span>
        <span className="text-slate-500 dark:text-slate-400">
          Total Estimate <span className="ml-1 font-mono font-semibold text-foreground dark:text-slate-200">{money(profit.bid)}</span>
        </span>
        <span className="text-slate-500 dark:text-slate-400">
          Projected Cost <span className="ml-1 font-mono font-semibold text-foreground dark:text-slate-200">{money(profit.projectedCost)}</span>
        </span>
        <span className="text-slate-500 dark:text-slate-400">
          Projected Profit
          <span className={`ml-1 font-mono font-bold ${profitTone}`}>
            {inProfit ? "+" : underwater ? "-" : ""}
            {money(Math.abs(profit.profit))}
            <span className="ml-1 font-sans text-[10px]">({Math.abs(profit.profitPct * 100).toFixed(2)}%)</span>
          </span>
        </span>
        {isFiltered && (
          <span className="text-[10px] italic text-amber-600 dark:text-amber-500">
            Filter active — totals reflect the whole estimate
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <div
          className="relative h-2 w-full max-w-md overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Percent of estimate value committed"
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-blue-500 transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="whitespace-nowrap font-mono text-[11px] text-slate-500 dark:text-slate-400">
          <span className="font-bold text-blue-600 dark:text-blue-400">{pct.toFixed(1)}%</span> committed
          <span className="ml-2 text-slate-400 dark:text-slate-500">
            {money(committedEstimate)} of {money(estimateTotal)}
          </span>
        </span>
      </div>
    </div>
  );
}

interface EstimateTableProps {
  project: Project;
  squareFootage: number;
  unitCount: number;

  // Workbook grid state
  rows: ProcessedTakeoffRow[];
  columnDefs: ColumnDefinition[];
  lockedCells: Record<string, boolean>;
  layoutConfig?: DivisionLayout[] | null;
  table: ReturnType<typeof useReactTable<ProcessedTakeoffRow>>;
  dragActive: boolean;
  appendData: boolean;
  setAppendData: (v: boolean) => void;
  contextMenu: ContextMenuState;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState>>;
  unmappedTakeoffClassifications: string[];
  canUndo: boolean;
  canRedo: boolean;
  undoStackSize: number;
  redoStackSize: number;

  // Handlers
  handleAddCustomColumn: () => void;
  handleDeleteColumn: (id: string) => void;
  handleRenameColumn: (id: string, name: string) => void;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleDrag: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  handleUndo: () => void;
  handleRedo: () => void;

  // Export actions (relocated from the page header into the workbook I/O bar)
  handleExportExcelWorkbook: () => void;
  handleExportExcel: () => void;
  handleExportProcore: () => void;
  isExportingExcel: boolean;

  // Summary data
  takeoffSummary: TakeoffSummary;

  /**
   * Division 60 Fee-Block Addressability Phase 3: the persisted `section: 'markup'`
   * fee lines, rendered as real rows in the Division 60 block of the summary footer
   * (alongside the 7 computed modifier rows). Display-only — their flat amount is
   * already summed into `takeoffSummary.additionalFees` / `totalEstimatedCost` by the
   * engine (Phase 2). `[]` until a fee line exists (the block renders as today).
   */
  markupLines: EstimateSectionLine[];
  /** Insert a blank flat fee line below existing fee lines (Phase 4 — undoable). */
  insertFeeLine: () => void;
  /** Delete a fee line by id (Phase 4 — undoable). */
  deleteFeeLine: (id: string) => void;
  /** Edit a fee line's label / amount / Procore code, a shallow field patch (Phase 4 — undoable). */
  editFeeLine: (id: string, patch: Partial<EstimateSectionLine>) => void;
  divisionBreakdown: DivisionAggregation[];
  costTypeBreakdown: CostTypeAggregation[];

  /** Live linked GC + Site Ops division values (the 10 rows) — fed to the Trust
   *  Inspector trace; a pure view, no engine recompute. */
  linkedDivisionTotals: LinkedDivisionTotal[];

  /** Authored Linked Values bindings — for the Trust Inspector Links tab (Phase 5). */
  bindings: Binding[];
  /** STEP 2/3 calc results — the source values the Links view recomputes from. */
  gcCalcResult: PersonnelCalcResult;
  siteOpsCalcResult: SiteOpsCalcResult;

  /** Live Procore reconciliation (5b) — built from the FULL unfiltered rows + the
   *  same validateExportReadiness the export gate runs (single source). Drives the
   *  status-bar chip and the Reconcile tab. */
  reconciliation: ReconciliationModel;

  /** Append-only override audit trail (newest first) — the Flags-tab audit log (5c.3).
   *  Read-only; sourced from `useEstimateOverrides`, no new fetch. */
  overrideRecords: EstimateOverrideRecord[];

  /** True when a filter/search is active — the on-screen summary is then a partial
   *  (visible-rows-only) view, so the override action is disabled (Amendment F). */
  isFiltered: boolean;

  /** Records an override set/revert (slice 4). Resolves after the DB write + refresh;
   *  rejects on failure. Threaded into the Trust Inspector's override editor. */
  onSaveOverride?: (payload: OverridePayload) => Promise<void>;

  /** Linked division rows carrying stray typed dollars — excluded from all
   *  totals (gc-siteops Phase 5 trap closure); surfaced, never silently dropped. */
  strayLinkedRows?: { itemId: string; description: string; amount: number }[];

  // Selection state (for active cell styling + click-outside-deselect)
  selection: GridSelectionState;

  // Search / Filter (Phase 4)
  globalFilter: string;
  setGlobalFilter: (value: string) => void;

  // Estimate Buyout Lens (Phase 2) — the active grid lens + setter (persisted per browser).
  // The toolbar toggle flips it; useTakeoffWorkbook derives the column SWAP from it.
  lensView: LensView;
  setLensView: (next: LensView) => void;
  /** Phase 4 — the buyout footer rollup (committed dollars + the awardable data-line estimate
   *  base) over the WHOLE estimate. Assembled in useTakeoffWorkbook from the same per-line
   *  Estimate the Variance cells use, so the footer can't drift from the cells. */
  buyoutRollup: BuyoutRollup;
  /** Phase 4 follow-on — Projected Profit for the footer (Total Estimate/Bid · Total Projected
   *  Cost · Projected Profit $/%), mirroring the template's STEP 4 bottom block. Derived from
   *  the whole-estimate bid + the data-line savings; display-only. */
  buyoutProfit: BuyoutProfit;

  scrollToRowRef?: React.MutableRefObject<((index: number) => void) | undefined>;

  // Import modal
  pendingImport: PendingImport | null;
  confirmImport: (archParams: ArchParamSuggestion[], overriddenRows?: ProcessedTakeoffRow[]) => void;
  cancelImport: () => void;
  reParseWithSheet: (sheetName: string) => Promise<void>;
  handleProjectParamChange?: (field: string, value: string | number) => void;

  /**
   * Cross-step Links request (Bucket B Phase 5). When a GC (STEP 2) / Site-Ops (STEP 3)
   * EngineLinkBadge is clicked, the page coordinator navigates here and passes the focused
   * engine node id. The `seq` bumps per request so a repeat click on the same node still
   * reopens the inspector. `onInspectConsumed` clears it once handled (one-shot). When STEP 4
   * is already mounted, EstimateTable's own `tb:inspect-binding` listener handles it instead.
   */
  pendingInspect?: { nodeId: string; seq: number } | null;
  onInspectConsumed?: () => void;
}

export function EstimateTable({
  project,
  squareFootage,
  unitCount,
  rows,
  columnDefs,
  lockedCells,
  layoutConfig,
  table,
  dragActive,
  appendData,
  setAppendData,
  setContextMenu,
  unmappedTakeoffClassifications,
  canUndo,
  canRedo,
  undoStackSize,
  redoStackSize,
  handleAddCustomColumn,
  handleDeleteColumn,
  handleRenameColumn,
  handleFileUpload,
  handleDrag,
  handleDrop,
  handleUndo,
  handleRedo,
  handleExportExcelWorkbook,
  handleExportExcel,
  handleExportProcore,
  isExportingExcel,
  takeoffSummary,
  markupLines,
  insertFeeLine,
  deleteFeeLine,
  editFeeLine,
  divisionBreakdown,
  costTypeBreakdown,
  linkedDivisionTotals,
  bindings,
  gcCalcResult,
  siteOpsCalcResult,
  reconciliation,
  overrideRecords,
  isFiltered,
  onSaveOverride,
  strayLinkedRows,
  selection,
  globalFilter,
  setGlobalFilter,
  lensView,
  setLensView,
  buyoutRollup,
  buyoutProfit,
  scrollToRowRef,
  pendingImport,
  confirmImport,
  cancelImport,
  reParseWithSheet,
  handleProjectParamChange,
  pendingInspect,
  onInspectConsumed,
}: EstimateTableProps) {
  const {
    subtotal,
    constructionContingency,
    designContingency,
    buildersRisk,
    specialInsurance,
    glInsurance,
    bond,
    fee,
    totalEstimatedCost,
    costPerSf,
    costPerUnit
  } = takeoffSummary;

  /** Lookup map from modifier key to its computed value */
  const modifierValues: Record<string, number> = {
    constructionContingency,
    designContingency,
    buildersRisk,
    specialInsurance,
    glInsurance,
    bond,
    fee,
  };

  // ---------------------------------------------------------------------------
  // Trust Inspector (Phase 5 — glass box). Opens focused on a clicked summary
  // field; a persistent button reopens it. Pure view — no engine recompute.
  // ---------------------------------------------------------------------------
  const [trustOpen, setTrustOpen] = React.useState(false);
  const [trustField, setTrustField] = React.useState<string>("totalEstimatedCost");
  const [trustTab, setTrustTab] = React.useState<TrustTab>("trace");
  // Bumped on every open so the inspector remounts fresh (starts on the requested
  // tab, as a slide-over) when a new summary cell's 🔍 / the chip is clicked while
  // it is already open.
  const [trustSeq, setTrustSeq] = React.useState(0);
  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- stable setters only; the empty deps are correct (see top-of-file note)
  const openTrust = useCallback((field: string, tab: TrustTab = "trace") => {
    setTrustField(field);
    setTrustTab(tab);
    setTrustOpen(true);
    setTrustSeq((s) => s + 1);
  }, []);

  // ---------------------------------------------------------------------------
  // Division 60 Fee-Block edit affordances (Phase 4). The fee block renders in the
  // static <tfoot> (not the virtualized grid row model), so it carries its OWN
  // lightweight inline-edit + context-menu + Procore-assign state here — small enough
  // not to warrant the full TanStack selection machinery. Every mutation routes through
  // the undoable workbook creators (insertFeeLine / deleteFeeLine / editFeeLine).
  //   - feeEdit:    which fee line + field is being inline-edited (label | amount).
  //   - feeCtxMenu: the right-click menu (Insert below / Delete) over a fee row.
  //   - feeAssign:  the validated Procore-code assign popover target (reused from one-offs).
  // ---------------------------------------------------------------------------
  const [feeEdit, setFeeEdit] = useState<{ id: string; field: "label" | "amount" } | null>(null);
  const [feeCtxMenu, setFeeCtxMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [feeAssign, setFeeAssign] = useState<OneOffAssignTarget | null>(null);

  // Dismiss the fee context menu on any outside click (mirrors the grid menu's dismiss).
  useEffect(() => {
    if (!feeCtxMenu) return;
    const close = () => setFeeCtxMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [feeCtxMenu]);

  // Phase 5: the grid's 🔗 binding badge dispatches "tb:inspect-binding" to open Trust on
  // the Links tab focused on that cell's total node — decoupled from the cell renderer
  // (which lives in the workbook hook), same pattern as the header's "toggle-sidebar".
  // Bucket B Phase 5 widens it to a raw engine `nodeId` (the GC/Site-Ops EngineLinkBadge,
  // when STEP 4 is already mounted) in addition to the grid's `rowId` → line:<id>:total.
  useEffect(() => {
    const onInspect = (e: Event) => {
      const detail = (e as CustomEvent<{ rowId?: string; nodeId?: string }>).detail;
      if (detail?.nodeId) openTrust(detail.nodeId, "links");
      else if (detail?.rowId) openTrust(lineFieldNodeId(detail.rowId, "total"), "links");
    };
    window.addEventListener("tb:inspect-binding", onInspect);
    return () => window.removeEventListener("tb:inspect-binding", onInspect);
  }, [openTrust]);

  // Bucket B Phase 5 — cross-step Links request: when a GC/Site-Ops badge was clicked on
  // another step, the page coordinator mounted us (STEP 4) and passed the focused engine
  // node. Open the Links tab on it, then notify the parent to clear the one-shot request.
  useEffect(() => {
    if (pendingInspect?.nodeId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot cross-step focus; intentional (see top-of-file note)
      openTrust(pendingInspect.nodeId, "links");
      onInspectConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingInspect?.seq]);

  // The Links view-model is now built INSIDE the Trust Inspector (from the raw inputs below),
  // so it can re-focus on any node as the user walks the graph without a round-trip here.

  // [view rows] — clear any active filter so all contributing takeoff rows are
  // visible, then scroll the grid to the top. Reuses globalFilter + scrollToRowRef.
  const handleViewTakeoffRows = useCallback(() => {
    setGlobalFilter("");
    requestAnimationFrame(() => scrollToRowRef?.current?.(0));
  }, [setGlobalFilter, scrollToRowRef]);

  // Flags-tab worklist jump — close the inspector, clear any filter, then scroll the
  // grid to the flagged row so the estimator can resolve it in place. Same path as
  // [view rows] (setGlobalFilter("") + scrollToRowRef), but targets one row by id.
  const handleViewRow = useCallback(
    // eslint-disable-next-line react-hooks/preserve-manual-memoization -- stable setters only; the manual deps are correct (see top-of-file note)
    (rowId: string) => {
      setTrustOpen(false);
      setGlobalFilter("");
      requestAnimationFrame(() => {
        const idx = table.getRowModel().rows.findIndex((r) => r.original.id === rowId);
        if (idx >= 0) scrollToRowRef?.current?.(idx);
      });
    },
    [setGlobalFilter, table, scrollToRowRef]
  );

  // 5c Flags view-model — needs-review worklist (INV-8), unmapped-import worklist
  // (carried qty, B-4 target), and the append-only override audit log. Pure builder.
  const flagsModel = useMemo(
    () => buildFlagsModel({ rows, overrideRecords }),
    [rows, overrideRecords]
  );

  // B-4 (slice 5b) — assign a Procore code to an unmapped import row from inside the
  // Flags tab, WITHOUT re-importing. Routes through the exact command pair the grid's
  // fuzzy-suggestion buttons use (useTakeoffWorkbook.tsx:863/914): handleCellEdit applies
  // the itemId cascade to the row, then commitCellEdit pushes the EDIT_CELL command with
  // the full self-cascade + cross-division moveEffect (so one Ctrl+Z undoes the assignment
  // AND the relocation atomically — AGENTS.md "Move Effect Atomicity"). No new command, no
  // new write path. The index is resolved against the FULL `rows` array (handleCellEdit
  // indexes rowsRef.current), and the unmapped worklist is built from those same full rows.
  const handleAssignCode = useCallback(
    (rowId: string, newItemId: string) => {
      const meta = table.options.meta;
      if (!meta) return;
      const idx = rows.findIndex((r) => r.id === rowId);
      if (idx < 0) return;
      const currentItemId = rows[idx].itemId;
      if (newItemId === currentItemId) return;
      meta.handleCellEdit(idx, "itemId", newItemId);
      meta.commitCellEdit(rowId, "itemId", currentItemId, newItemId);
    },
    [table, rows]
  );

  // ---------------------------------------------------------------------------
  // Click-outside-to-deselect (E2)
  // ---------------------------------------------------------------------------
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (gridContainerRef.current && !gridContainerRef.current.contains(e.target as Node)) {
      const meta = table.options.meta;
      if (meta?.selection?.rowId) {
        // Defer deselection so the active input's onBlur fires first,
        // allowing StringCellInput to commit the edit before unmounting.
        setTimeout(() => {
          meta.setSelection({ rowId: null, columnId: null, isEditing: false });
        }, 0);
      }
    }
  }, [table]);

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [handleClickOutside]);

  // Current (filtered) table row model — feeds the takeoff-row count below. The
  // virtualization / divider machinery that also consumed this now lives in
  // GridShell (B1a extraction, B1b generalized).
  const tableRows = table.getRowModel().rows;

  // Contributing (non-linked) takeoff rows — the count behind the trace's
  // "Takeoff Σ(qty×price) · N rows". Counts the table's current (filtered) model
  // so it matches the on-screen takeoffSubtotal under an active filter (Amendment F).
  const takeoffRowCount = useMemo(
    () => tableRows.filter((r) => !isLinkedDivisionRow(r.original.itemId)).length,
    [tableRows]
  );

  // Analytics drawer collapse — read-only block, remembered per browser so it stays
  // out of the way once dismissed (single-company tool → one fixed key, no per-project state).
  const [analyticsCollapsed, setAnalyticsCollapsed] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("tb.estimate.analyticsCollapsed") === "1";
  });
  useEffect(() => {
    window.localStorage.setItem("tb.estimate.analyticsCollapsed", analyticsCollapsed ? "1" : "0");
  }, [analyticsCollapsed]);

  // Data I/O bar collapse — remembered per browser, same pattern as the analytics drawer.
  const [ioBarCollapsed, setIoBarCollapsed] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("tb.estimate.ioBarCollapsed") === "1";
  });
  useEffect(() => {
    window.localStorage.setItem("tb.estimate.ioBarCollapsed", ioBarCollapsed ? "1" : "0");
  }, [ioBarCollapsed]);

  // Unmapped rows block every export path; surfaced as a tooltip on the disabled controls.
  const unmappedCount = useMemo(() => rows.filter((r) => !r.isMapped).length, [rows]);
  const exportDisabledReason = unmappedCount > 0 ? `${unmappedCount} unmapped row(s) block export` : undefined;

  // "Export ▾" dropdown — closes on outside click and Escape.
  const [exportMenuOpen, setExportMenuOpen] = React.useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!exportMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExportMenuOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [exportMenuOpen]);

  const layoutConfigMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (layoutConfig) {
      layoutConfig.forEach((cfg) => {
        if (cfg.label) {
          map[cfg.division] = cfg.label;
        }
      });
    }
    return map;
  }, [layoutConfig]);

  // Step-4 projection onto GridShell's generic surface (B1b). The division-code grouping,
  // qty×price divider subtotal, isMapped flag, and column sets that used to be hard-coded in
  // the shell are supplied here. No `renderCellOverlay` yet — the A+1 override ⚑ gesture is
  // Track B (B2/B3); Step 4 renders its ⚑ in its own column defs / summary cells.
  const gridConfig = useMemo<GridShellConfig<ProcessedTakeoffRow>>(() => ({
    getRowId: (row) => row.id,
    getGroupKey: (row) => getDivisionCode(row.itemId || ""),
    getGroupLabel: (k) => layoutConfigMap[k] || DIVISION_LABELS[k] || `DIVISION ${k}`,
    getRowGroupTotal: (row) => (Number(row.matchedQty) || 0) * (Number(row.unitPrice) || 0),
    isRowFlagged: (row) => !row.isMapped,
    editableColumnIds: STEP4_EDITABLE_COLUMN_IDS,
    centerAlignedColumnIds: STEP4_CENTER_ALIGNED_COLUMN_IDS,
  }), [layoutConfigMap]);

  return (
    <>
    <div className="space-y-6 animate-fade-in" {...(pendingImport ? { inert: "" } as Record<string, unknown> : {})}>
      {/* Workbook Data I/O Bar — collapsible: Import (in) left, Export (out) right */}
      <div className="bg-card border border-grid-border text-card-foreground rounded-xl shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => setIoBarCollapsed((v) => !v)}
          aria-expanded={!ioBarCollapsed}
          className={`w-full flex items-center justify-between px-5 py-2.5 bg-background/80 dark:bg-background/50 text-[10px] text-slate-600 dark:text-slate-400 uppercase tracking-widest font-bold hover:text-foreground transition-colors cursor-pointer select-none ${ioBarCollapsed ? "" : "border-b border-grid-border"}`}
        >
          <span className="flex items-center gap-2">
            <span className="text-blue-600 dark:text-blue-400 w-3 text-center">{ioBarCollapsed ? "▶" : "▼"}</span>
            [DATA I/O // IMPORT + EXPORT]
          </span>
          <span className="text-slate-400 dark:text-slate-500">{ioBarCollapsed ? "Show" : "Hide"}</span>
        </button>
        {!ioBarCollapsed && (
        <div className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Left: Import — drop box + Append toggle (Append modifies the next import) */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 min-w-0">
          <div
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            className={`relative flex-1 max-w-md border border-dashed rounded-lg p-4 text-center transition-all ${
              dragActive
                ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20 scale-[1.01]"
                : "border-grid-border bg-background dark:bg-slate-900/40 hover:border-blue-500/50 dark:hover:border-blue-400/50"
            }`}
          >
            <label className="flex flex-col items-center justify-center cursor-pointer select-none">
              <div className="flex items-center gap-2 text-foreground">
                <Upload size={16} className={dragActive ? "text-blue-500 animate-bounce" : "text-slate-600 dark:text-slate-400"} />
                <span className="text-xs font-bold uppercase tracking-wider">Import Takeoff Data</span>
              </div>
              <span className="text-[10px] text-slate-600 dark:text-slate-400 mt-1 uppercase tracking-wide">Drag here or click to browse</span>
              <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>

          <div className="flex items-center gap-2 bg-background dark:bg-slate-900/40 border border-grid-border rounded-lg px-4 py-2.5 text-xs text-foreground transition-colors hover:border-blue-500/50 dark:hover:border-blue-400/50 select-none shrink-0">
            <input
              id="append-checkbox-step4"
              type="checkbox"
              checked={appendData}
              onChange={(e) => setAppendData(e.target.checked)}
              className="w-4 h-4 rounded border-grid-border text-blue-600 focus:ring-blue-500 bg-transparent cursor-pointer"
            />
            <label htmlFor="append-checkbox-step4" className="cursor-pointer font-bold uppercase tracking-wider">
              Append Data
            </label>
          </div>
        </div>

        {/* Right: Export — primary full-workbook download + secondary formats menu */}
        {rows.length > 0 && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => handleExportExcelWorkbook()}
              disabled={unmappedCount > 0 || isExportingExcel}
              title={exportDisabledReason}
              className="flex items-center gap-2 bg-gradient-to-r from-blue-700 to-indigo-700 hover:from-blue-600 hover:to-indigo-600 text-white text-sm px-5 py-2.5 rounded-lg font-bold transition-all duration-300 shadow-lg shadow-blue-500/10 dark:shadow-blue-955/30 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <FileDown size={18} className={isExportingExcel ? "animate-spin" : ""} />
              {isExportingExcel ? "Compiling Workbook..." : "Download Full Estimate Workbook (.xlsx)"}
            </button>

            <div className="relative" ref={exportMenuRef}>
              <button
                onClick={() => setExportMenuOpen((v) => !v)}
                disabled={unmappedCount > 0}
                title={exportDisabledReason}
                aria-haspopup="menu"
                aria-expanded={exportMenuOpen}
                className="flex items-center gap-1.5 bg-card hover:bg-background/80 dark:bg-card dark:hover:bg-background/80 text-foreground border border-grid-border text-sm px-4 py-2.5 rounded-lg font-bold transition-all duration-300 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer hover:shadow-md"
              >
                Export <ChevronDown size={16} className={`transition-transform ${exportMenuOpen ? "rotate-180" : ""}`} />
              </button>

              {exportMenuOpen && (
                <div role="menu" className="absolute right-0 z-20 mt-2 w-56 bg-card border border-grid-border rounded-lg shadow-lg overflow-hidden animate-fade-in">
                  <button
                    role="menuitem"
                    onClick={() => { setExportMenuOpen(false); handleExportExcel(); }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-foreground text-left hover:bg-background/80 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
                  >
                    <FileDown size={15} className="text-slate-500 dark:text-slate-400" /> Export Excel Payload
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => { setExportMenuOpen(false); handleExportProcore(); }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-emerald-700 dark:text-emerald-400 text-left hover:bg-emerald-50/60 dark:hover:bg-emerald-950/20 border-t border-grid-border transition-colors cursor-pointer"
                  >
                    <FileDown size={15} /> Export Procore Budget
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        </div>
        )}
      </div>

      {/* Unmapped Classifications Warning */}
      {unmappedTakeoffClassifications.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 rounded-xl p-4 flex flex-col gap-2 font-sans text-xs text-amber-700 dark:text-amber-500 animate-shake">
          <div className="flex items-center gap-2 font-bold uppercase tracking-wider">
            <AlertTriangle className="text-amber-500 animate-pulse" size={16} />
            <span>Notice: Unmapped Classifications Detected</span>
          </div>
          <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed uppercase">
            The following {unmappedTakeoffClassifications.length} classification(s) from your takeoff CSV were skipped because they are not yet mapped to any corporate code in your registry:
          </p>
          <div className="flex flex-wrap gap-2 mt-1">
            {unmappedTakeoffClassifications.map((cl) => (
              <span key={cl} className="bg-background dark:bg-slate-900 border border-grid-border text-[10px] text-amber-600 dark:text-amber-400 px-2.5 py-1 rounded font-bold">
                {cl}
              </span>
            ))}
          </div>
          <div className="mt-2 text-right">
            <Link href="/registry" className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-blue-600 dark:text-blue-400 hover:underline transition-colors">
              Go to Global Registry to Add Mappings &rarr;
            </Link>
          </div>
        </div>
      )}

      {/* Stray dollars on linked division rows — excluded from all totals
          (gc-siteops Phase 5); surfaced here, never silently dropped. */}
      {strayLinkedRows && strayLinkedRows.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/25 border border-amber-300 dark:border-amber-900/50 rounded-xl p-4 text-amber-800 dark:text-amber-300 text-xs font-sans shadow-sm">
          <div className="font-bold uppercase tracking-wider mb-1">Linked rows carrying manual dollars — excluded from totals</div>
          <p className="mb-2">
            These STEP 4 rows are linked live from the Step 2 / Step 3 modules; amounts typed on them
            do not count anywhere (estimate, export, or Procore). Re-enter the dollars on Step 2/3,
            then clear the row to restore its live link.
          </p>
          <ul className="font-mono list-disc list-inside">
            {strayLinkedRows.map((r) => (
              <li key={r.itemId}>
                {r.itemId} — {r.description}: ${r.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Division Summary Analytics Drawer — collapsible read-only block */}
      {rows.length > 0 && (
        <div className="border border-grid-border bg-card rounded-xl shadow-sm font-sans text-xs overflow-hidden">
          <button
            type="button"
            onClick={() => setAnalyticsCollapsed((v) => !v)}
            aria-expanded={!analyticsCollapsed}
            className="w-full flex items-center justify-between px-5 py-2.5 bg-background/80 dark:bg-background/50 border-b border-grid-border text-[10px] text-slate-600 dark:text-slate-400 uppercase tracking-widest font-bold hover:text-foreground transition-colors cursor-pointer select-none"
          >
            <span className="flex items-center gap-2">
              <span className="text-blue-600 dark:text-blue-400 w-3 text-center">{analyticsCollapsed ? "▶" : "▼"}</span>
              [SYS.ANALYTICS // DIVISIONAL + COST TYPE BREAKDOWN]
            </span>
            <span className="text-slate-400 dark:text-slate-500">{analyticsCollapsed ? "Show" : "Hide"}</span>
          </button>
          {!analyticsCollapsed && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-5">
          {/* Left Column: Divisional Breakdown */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-grid-border pb-2 text-[10px] text-slate-600 dark:text-slate-400 uppercase tracking-widest font-bold">
              <span>[SYS.ANALYTICS // DIVISIONAL BREAKDOWN]</span>
              <span>Subtotal Contribution</span>
            </div>
            {divisionBreakdown.length === 0 ? (
              <div className="text-slate-600 dark:text-slate-400 italic py-4">No active divisions mapped.</div>
            ) : (
              <div className="flex flex-col gap-2.5 max-h-60 overflow-y-auto pr-1">
                {divisionBreakdown.map((div) => (
                  <div key={div.code} className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-blue-600 dark:text-blue-400 font-bold w-6 text-right shrink-0">{div.code}</span>
                      <span className="text-foreground font-semibold truncate shrink-0 max-w-[120px] sm:max-w-[180px]">
                        {layoutConfigMap[div.code] || div.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 font-mono shrink-0 ml-auto">
                      <span className="text-slate-600 dark:text-slate-400 text-[10px] hidden sm:inline font-bold">
                        [{getTerminalProgressBar(div.percentage)}]
                      </span>
                      <span className="text-slate-600 dark:text-slate-400 text-right w-12 font-bold">{div.percentage.toFixed(1)}%</span>
                      <span className="text-emerald-600 dark:text-emerald-400 text-right w-24 font-bold">
                        ${div.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right Column: Cost Type Breakdown */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center border-b border-grid-border pb-2 text-[10px] text-slate-600 dark:text-slate-400 uppercase tracking-widest font-bold">
              <span>[SYS.ANALYTICS // COST TYPE SCOPES]</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {costTypeBreakdown.map((ct) => {
                let accentColor = "border-grid-border text-slate-600 dark:text-slate-400";
                let badgeBg = "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-grid-border";
                if (ct.key === "M") {
                  accentColor = "border-emerald-200 dark:border-emerald-900/60 hover:border-emerald-300 dark:hover:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/5 text-emerald-700 dark:text-emerald-400";
                  badgeBg = "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50";
                } else if (ct.key === "L") {
                  accentColor = "border-cyan-200 dark:border-cyan-900/60 hover:border-cyan-300 dark:hover:border-cyan-800 bg-cyan-50/50 dark:bg-cyan-950/5 text-cyan-700 dark:text-cyan-400";
                  badgeBg = "bg-cyan-100 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-400 border-cyan-200 dark:border-cyan-900/50";
                } else if (ct.key === "S") {
                  accentColor = "border-amber-200 dark:border-amber-900/60 hover:border-amber-300 dark:hover:border-amber-800 bg-amber-50/50 dark:bg-amber-950/5 text-amber-700 dark:text-amber-400";
                  badgeBg = "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-900/50";
                }
                return (
                  <div
                    key={ct.key}
                    className={`flex flex-col justify-between p-4 border rounded-xl transition-all ${accentColor}`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="font-extrabold uppercase text-[10px] tracking-wider">{ct.label}</span>
                      <span className={`text-[9px] px-2 py-0.5 border rounded-md font-bold tracking-widest ${badgeBg}`}>
                        {ct.key}
                      </span>
                    </div>
                    <div className="mt-2">
                      <h4 className="text-foreground text-base font-black">
                        ${ct.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </h4>
                      <p className="text-[10px] text-slate-600 dark:text-slate-400 mt-1 font-bold">
                        {ct.percentage.toFixed(1)}% of subtotal
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          </div>
          )}
        </div>
      )}

      {/* Re-Architected workbook template grid */}
      <div ref={gridContainerRef} className="bg-card border border-grid-border rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 bg-background/80 dark:bg-background/50 border-b border-grid-border flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <h3 className="text-sm font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
              <Activity size={16} className="text-blue-600 dark:text-blue-400 animate-pulse" /> Takeoff Workbook Spreadsheet Matrix
            </h3>
            <SearchBar globalFilter={globalFilter} setGlobalFilter={setGlobalFilter} />
          </div>

          {/* Grid-manipulation controls — grouped with the table they act on */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Estimate | Buyout lens toggle (Phase 2) — swaps the visible columns; the
                estimate math/export is unaffected (buyout lives in browser-local storage). */}
            <div
              className="inline-flex items-center rounded-lg border border-grid-border overflow-hidden select-none"
              role="group"
              aria-label="Grid lens"
            >
              <span className="pl-2.5 pr-1.5 text-slate-400 dark:text-slate-500 hidden sm:inline" aria-hidden="true">
                <Layers size={13} />
              </span>
              {(["estimate", "buyout"] as const).map((lens) => (
                <button
                  key={lens}
                  type="button"
                  onClick={() => setLensView(lens)}
                  aria-pressed={lensView === lens}
                  title={lens === "estimate" ? "Estimating view" : "Buyout view — Vendor, Actual, Variance (saved in this browser only)"}
                  className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                    lensView === lens
                      ? "bg-blue-600 text-white"
                      : "bg-card text-slate-600 dark:text-slate-400 hover:bg-blue-50 dark:hover:bg-blue-950/20"
                  }`}
                >
                  {lens === "estimate" ? "Estimate" : "Buyout"}
                </button>
              ))}
            </div>

            <span className="text-[10px] text-slate-400 dark:text-slate-500 font-sans font-semibold uppercase tracking-wider hidden lg:inline">
              ↑↓ navigate
            </span>

            <button
              onClick={() => openTrust("totalEstimatedCost")}
              type="button"
              title="Open the Trust Inspector — trace how every number is built"
              className="inline-flex items-center gap-1.5 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/15 dark:hover:bg-blue-950/35 text-blue-600 dark:text-blue-400 border border-grid-border rounded-lg px-3 py-1.5 font-bold uppercase transition-all duration-300 text-xs cursor-pointer select-none"
            >
              <Search size={14} /> Trust
            </button>

            <button
              onClick={handleAddCustomColumn}
              type="button"
              className="inline-flex items-center gap-1.5 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/15 dark:hover:bg-blue-950/35 text-blue-600 dark:text-blue-400 border border-grid-border rounded-lg px-3 py-1.5 font-bold uppercase transition-all duration-300 text-xs cursor-pointer select-none"
            >
              + Add Custom Column
            </button>

            <button
              onClick={handleUndo}
              disabled={!canUndo}
              className="inline-flex items-center gap-1.5 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/15 dark:hover:bg-amber-950/35 text-amber-600 dark:text-amber-500 disabled:text-slate-400 border border-grid-border disabled:border-grid-border rounded-lg px-3 py-1.5 font-bold uppercase transition-all duration-300 text-xs cursor-pointer disabled:cursor-not-allowed select-none"
            >
              <RotateCcw size={14} /> Undo ({undoStackSize})
            </button>

            <button
              onClick={handleRedo}
              disabled={!canRedo}
              className="inline-flex items-center gap-1.5 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/15 dark:hover:bg-amber-950/35 text-amber-600 dark:text-amber-500 disabled:text-slate-400 border border-grid-border disabled:border-grid-border rounded-lg px-3 py-1.5 font-bold uppercase transition-all duration-300 text-xs cursor-pointer disabled:cursor-not-allowed select-none"
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
          handleRenameColumn={handleRenameColumn}
          handleDeleteColumn={handleDeleteColumn}
          globalFilter={globalFilter}
          footer={
            rows.length > 0 ? (
              /* Complete Locked-down Summary Row Appendices */
              <tfoot style={{ display: "block" }}>
                {/* Subtotal Row */}
                <tr className="border-t border-l-4 border-l-transparent border-grid-border bg-background/80 dark:bg-slate-900/30 text-xs font-bold text-slate-600 dark:text-slate-400 font-sans" style={{ display: "flex", minWidth: "100%" }}>
                  {table.getVisibleFlatColumns().map((column: Column<ProcessedTakeoffRow>) => {
                    let content: React.ReactNode = "";
                    let alignClass = "text-left font-sans";
                    if (column.id === "costType") { content = "TI"; alignClass = "text-center font-mono"; }
                    else if (column.id === "description") { content = "Estimate Subtotal (incl. GC + Site Ops)"; alignClass = "text-left font-sans"; }
                    else if (column.id === "total") { content = <SummaryTraceCell valueStr={`$${subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} onTrace={() => openTrust("subtotal")} onLinks={() => openTrust("subtotal", "links")} overridden={takeoffSummary.overrides?.subtotal} />; alignClass = "text-center text-foreground font-bold font-mono"; }
                    else if (column.id === "costPerUnit") { content = `$${(subtotal / (unitCount || 1)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; alignClass = "text-center font-mono"; }
                    else if (column.id === "costPerSf") { content = `$${(subtotal / (squareFootage || 1)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; alignClass = "text-center font-mono"; }
                    else if (column.id === "uom" || ["matchedQty", "unitPrice"].includes(column.id)) { alignClass = "text-center font-mono"; }
                    return (<td key={column.id} className={`p-3 border-r border-b border-grid-border ${alignClass}`} style={{ width: column.getSize(), flex: "none" }}>{content}</td>);
                  })}
                  <td className="border-b border-grid-border" style={{ flex: "1 1 auto", minWidth: 0 }} />
                </tr>

                {/* Template-aligned modifier rows (data-driven from ESTIMATE_MODIFIERS) */}
                {ESTIMATE_MODIFIERS.map((mod) => {
                  const modValue = modifierValues[mod.key] ?? 0;
                  const rateField = `${mod.key}Rate` as keyof Project;
                  const rateDecimal = (project[rateField] as number) ?? mod.defaultRate;
                  const ratePercent = (rateDecimal * 100).toFixed(2).replace(/\.?0+$/, '');

                  return (
                    <tr key={mod.key} className="bg-background/80 dark:bg-slate-900/30 text-xs font-bold text-slate-600 dark:text-slate-400 font-sans border-l-4 border-l-transparent" style={{ display: "flex", minWidth: "100%" }}>
                      {table.getVisibleFlatColumns().map((column: Column<ProcessedTakeoffRow>) => {
                        let content: React.ReactNode = "";
                        let alignClass = "text-left font-sans";
                        if (column.id === "itemId") { content = mod.code; alignClass = "text-center font-mono"; }
                        else if (column.id === "costType") { content = "O"; alignClass = "text-center font-mono"; }
                        else if (column.id === "description") { content = `${mod.label} (${ratePercent}%)`; alignClass = "text-left font-sans"; }
                        else if (column.id === "matchedQty") { content = "1.00"; alignClass = "text-center font-mono"; }
                        else if (column.id === "uom") { content = "LS"; alignClass = "text-center font-mono"; }
                        else if (column.id === "unitPrice") { content = `$${modValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; alignClass = "text-center font-mono"; }
                        else if (column.id === "total") { content = <SummaryTraceCell valueStr={`$${modValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} onTrace={() => openTrust(mod.key)} onLinks={() => openTrust(mod.key, "links")} overridden={takeoffSummary.overrides?.[mod.key]} />; alignClass = "text-center text-foreground font-bold font-mono"; }
                        else if (column.id === "costPerUnit") { content = `$${(modValue / (unitCount || 1)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; alignClass = "text-center font-mono"; }
                        else if (column.id === "costPerSf") { content = `$${(modValue / (squareFootage || 1)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; alignClass = "text-center font-mono"; }
                        return (<td key={column.id} className={`p-3 border-r border-b border-grid-border ${alignClass}`} style={{ width: column.getSize(), flex: "none" }}>{content}</td>);
                      })}
                      <td className="border-b border-grid-border" style={{ flex: "1 1 auto", minWidth: 0 }} />
                    </tr>
                  );
                })}

                {/* Division 60 markup fee lines (Fee-Block Phase 3/4) — estimator-authored flat
                    dollars rendered BELOW the 7 computed modifiers and ABOVE the grand total,
                    exactly where they sit in the engine (a below-subtotal, never-marked-up
                    addend, Phase 2). Phase 4 makes them EDITABLE: click the label / amount to
                    inline-edit, click the code cell to assign a validated Procore BLI, right-click
                    the row to insert or delete — each undoable via the workbook creators. An
                    unassigned Procore code shows a "needs review" badge (never guessed). */}
                {markupLines.map((line) => {
                  // Round the displayed amount with the SAME rule the engine summed it (each
                  // fee line is rounded independently into additionalFees) so the row ties to
                  // the Total. Default "none" is the identity — exact in the common case. The
                  // INLINE editor edits the RAW `inputs.amount` (feeLineAmount), not the rounded
                  // display, so the stored input stays exact.
                  const rawAmount = feeLineAmount(line);
                  const amount = roundByRule(rawAmount, project.roundingRule ?? "none");
                  const unmapped = !line.procoreCode;
                  const editingLabel = feeEdit?.id === line.id && feeEdit.field === "label";
                  const editingAmount = feeEdit?.id === line.id && feeEdit.field === "amount";
                  return (
                    <tr
                      key={line.id}
                      className="bg-background/80 dark:bg-slate-900/30 text-xs font-bold text-slate-600 dark:text-slate-400 font-sans border-l-4 border-l-transparent"
                      style={{ display: "flex", minWidth: "100%" }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setFeeCtxMenu({ x: e.clientX, y: e.clientY, id: line.id });
                      }}
                    >
                      {table.getVisibleFlatColumns().map((column: Column<ProcessedTakeoffRow>) => {
                        let content: React.ReactNode = "";
                        let alignClass = "text-left font-sans";
                        if (column.id === "itemId") {
                          // Click → the validated Procore-code assign popover (reused from one-offs).
                          content = (
                            <button
                              type="button"
                              onClick={(e) => setFeeAssign({ line, x: e.clientX, y: e.clientY })}
                              className="cursor-pointer hover:underline decoration-dotted underline-offset-2"
                              title={unmapped ? "Assign a Procore Budget Line Item" : `Procore ${line.procoreCode} — click to reassign`}
                            >
                              {unmapped
                                ? <span className="text-amber-600 dark:text-amber-400">unmapped</span>
                                : line.procoreCode}
                            </button>
                          );
                          alignClass = "text-center font-mono";
                        }
                        else if (column.id === "costType") { content = line.costType || "O"; alignClass = "text-center font-mono"; }
                        else if (column.id === "description") {
                          content = editingLabel ? (
                            <div className="w-full" onBlur={() => setFeeEdit(null)}>
                              <StringCellInput
                                id={`fee-label-${line.id}`}
                                value={line.label}
                                className="w-full px-1.5 py-1 text-xs font-sans border border-blue-400 dark:border-blue-600 rounded bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                                onCommit={(v) => editFeeLine(line.id, { label: v })}
                                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                              />
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setFeeEdit({ id: line.id, field: "label" })}
                                className="cursor-text hover:underline decoration-dotted underline-offset-2 text-left"
                                title="Click to rename this fee line"
                              >
                                {line.label || <span className="italic text-slate-400 dark:text-slate-500">Unnamed fee</span>}
                              </button>
                              {unmapped && (
                                <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded px-1.5 py-0.5" title="No Procore Budget Line Item assigned (needs review)">
                                  <Flag size={9} /> needs review
                                </span>
                              )}
                            </span>
                          );
                          alignClass = "text-left font-sans";
                        }
                        else if (column.id === "matchedQty") { content = "1.00"; alignClass = "text-center font-mono"; }
                        else if (column.id === "uom") { content = "LS"; alignClass = "text-center font-mono"; }
                        else if (column.id === "unitPrice") { content = fmtUSD(amount); alignClass = "text-center font-mono"; }
                        else if (column.id === "total") {
                          content = editingAmount ? (
                            <div className="w-full" onBlur={() => setFeeEdit(null)}>
                              <NumberCellInput
                                id={`fee-amount-${line.id}`}
                                value={rawAmount}
                                className="w-full px-1.5 py-1 text-xs font-mono text-center border border-blue-400 dark:border-blue-600 rounded bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                                onCommit={(v) => editFeeLine(line.id, { inputs: { amount: v } })}
                                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                              />
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setFeeEdit({ id: line.id, field: "amount" })}
                              className="cursor-text hover:underline decoration-dotted underline-offset-2"
                              title="Click to edit this fee amount"
                            >
                              {fmtUSD(amount)}
                            </button>
                          );
                          alignClass = "text-center text-foreground font-bold font-mono";
                        }
                        else if (column.id === "costPerUnit") { content = fmtUSD(amount / (unitCount || 1)); alignClass = "text-center font-mono"; }
                        else if (column.id === "costPerSf") { content = fmtUSD(amount / (squareFootage || 1)); alignClass = "text-center font-mono"; }
                        return (<td key={column.id} className={`p-3 border-r border-b border-grid-border ${alignClass}`} style={{ width: column.getSize(), flex: "none" }}>{content}</td>);
                      })}
                      <td className="border-b border-grid-border" style={{ flex: "1 1 auto", minWidth: 0 }} />
                    </tr>
                  );
                })}

                {/* + Add fee line (Phase 4) — a clear user action (AGENTS.md) covering the empty
                    state + discoverability; right-clicking an existing fee row also offers
                    Insert / Delete. Insert always APPENDS (fee lines are a flat unordered set). */}
                <tr className="bg-background/50 dark:bg-slate-900/20 border-l-4 border-l-transparent" style={{ display: "flex", minWidth: "100%" }}>
                  {table.getVisibleFlatColumns().map((column: Column<ProcessedTakeoffRow>) => (
                    <td key={column.id} className="p-3 border-r border-b border-grid-border text-left" style={{ width: column.getSize(), flex: "none" }}>
                      {column.id === "description" && (
                        <button
                          type="button"
                          onClick={insertFeeLine}
                          className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 cursor-pointer"
                          title="Add a flat fee line to the Division 60 fee block"
                        >
                          <Plus size={12} /> Add fee line
                        </button>
                      )}
                    </td>
                  ))}
                  <td className="border-b border-grid-border" style={{ flex: "1 1 auto", minWidth: 0 }} />
                </tr>

                {/* Total Estimated Cost Row */}
                <tr className="border-t border-double border-l-4 border-l-transparent border-emerald-500/50 bg-emerald-50 dark:bg-emerald-950/15 text-xs font-black text-emerald-600 dark:text-emerald-400 font-sans" style={{ display: "flex", minWidth: "100%" }}>
                  {table.getVisibleFlatColumns().map((column: Column<ProcessedTakeoffRow>) => {
                    let content: React.ReactNode = "";
                    let alignClass = "text-left font-sans";
                    if (column.id === "costType") { content = "TI"; alignClass = "text-center text-emerald-600 dark:text-emerald-500 font-extrabold font-mono"; }
                    else if (column.id === "description") { content = "Total Estimated Cost"; alignClass = "text-left uppercase tracking-wider font-sans"; }
                    else if (column.id === "total") { content = <SummaryTraceCell valueStr={`$${totalEstimatedCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} onTrace={() => openTrust("totalEstimatedCost")} onLinks={() => openTrust("totalEstimatedCost", "links")} overridden={takeoffSummary.overrides?.totalEstimatedCost} />; alignClass = "text-center text-sm text-emerald-600 dark:text-emerald-400 font-black font-mono"; }
                    else if (column.id === "costPerUnit") { content = `$${costPerUnit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; alignClass = "text-center text-sm font-mono"; }
                    else if (column.id === "costPerSf") { content = `$${costPerSf.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; alignClass = "text-center text-sm font-mono"; }
                    else if (column.id === "uom" || ["matchedQty", "unitPrice"].includes(column.id)) { alignClass = "text-center font-mono"; }
                    return (<td key={column.id} className={`p-3 border-r border-b border-grid-border ${alignClass}`} style={{ width: column.getSize(), flex: "none" }}>{content}</td>);
                  })}
                  <td className="border-b border-grid-border" style={{ flex: "1 1 auto", minWidth: 0 }} />
                </tr>
              </tfoot>
            ) : null
          }
        />

        {/* Estimate Buyout Lens rollup footer (Phase 4) — shown only in the Buyout lens, and
            only with data rows present (mirrors the status-bar gate so a brand-new estimate
            shows no footer). Pure display over the whole-estimate rollup; no dollar it shows
            ever enters the engine or the export. */}
        {lensView === "buyout" && rows.length > 0 && (
          <BuyoutRollupFooter rollup={buyoutRollup} profit={buyoutProfit} isFiltered={isFiltered} />
        )}

        {/* Status Bar — Enterprise Excel-style footer info bar */}
        {rows.length > 0 && (
          <div className="status-bar flex items-center justify-between px-4 py-2 text-[10px] font-bold uppercase tracking-wider font-sans select-none">
            <div className="flex items-center gap-4">
              <span className="text-slate-400 dark:text-slate-500">Rows: <span className="text-foreground dark:text-slate-300">{rows.length}</span></span>
              <span className="text-slate-400 dark:text-slate-500">Mapped: <span className="text-emerald-600 dark:text-emerald-400">{rows.filter(r => r.isMapped).length}</span></span>
              <span className="text-slate-400 dark:text-slate-500">Unmapped: <span className="text-amber-600 dark:text-amber-400">{rows.filter(r => !r.isMapped).length}</span></span>
              <span className="text-slate-300 dark:text-slate-700">|</span>
              <span className="text-slate-400 dark:text-slate-500">Subtotal: <span className="text-foreground dark:text-slate-300 font-mono">${subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
              <span className="text-slate-400 dark:text-slate-500">Est. Total: <span className="text-emerald-600 dark:text-emerald-400 font-mono">${totalEstimatedCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
              <span className="text-slate-300 dark:text-slate-700">|</span>
              <ReconChip reconciliation={reconciliation} onOpen={() => openTrust("totalEstimatedCost", "reconcile")} />
            </div>
            <div className="flex items-center gap-3">
              {selection.rowId && (
                <span className="text-blue-500 dark:text-blue-400">
                  Cell: {selection.columnId} {selection.isEditing ? "(editing)" : "(selected)"}
                </span>
              )}
              <span className="text-slate-500 dark:text-slate-600">v{new Date().getFullYear()}</span>
            </div>
          </div>
        )}
      </div>

      {/* Hidden Option Datalist */}
      <datalist id="estimate-items-options">
        {Object.entries(getCatalogItems()).map(([key, item]) => (
          <option key={key} value={key}>
            {item.description}
          </option>
        ))}
      </datalist>
    </div>

      {/* Import Preview Modal */}
      {pendingImport && (
        <ImportPreviewModal
          pendingImport={pendingImport}
          appendData={appendData}
          onImport={(archParams, overriddenRows) => {
            confirmImport(archParams, overriddenRows);
            // Apply accepted architectural parameters to project
            if (handleProjectParamChange) {
              archParams.forEach((param) => {
                handleProjectParamChange(param.projectField, param.value);
              });
            }
          }}
          onClose={cancelImport}
          onSheetChange={reParseWithSheet}
        />
      )}

      {/* Trust Inspector — glass-box trace (Phase 5). Pure view over the summary. */}
      <TrustInspector
        key={trustSeq}
        open={trustOpen}
        onClose={() => setTrustOpen(false)}
        focusField={trustField}
        initialTab={trustTab}
        summary={takeoffSummary}
        linkedTotals={linkedDivisionTotals}
        project={project}
        takeoffRowCount={takeoffRowCount}
        reconciliation={reconciliation}
        flagsModel={flagsModel}
        bindings={bindings}
        gc={gcCalcResult}
        siteOps={siteOpsCalcResult}
        rows={rows}
        onViewRow={handleViewRow}
        onAssignCode={handleAssignCode}
        onViewTakeoffRows={handleViewTakeoffRows}
        isFiltered={isFiltered}
        onSaveOverride={onSaveOverride}
      />

      {/* Division 60 fee-block context menu (Phase 4) — right-click a fee row → insert /
          delete, both undoable. Fixed-positioned; an outside click dismisses it (effect above). */}
      {feeCtxMenu && (
        <div
          className="fixed bg-card border border-grid-border p-1.5 shadow-2xl rounded-lg z-50 flex flex-col gap-1 min-w-[170px] text-card-foreground"
          style={{ top: feeCtxMenu.y, left: feeCtxMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className={feeMenuBtnClass}
            onClick={() => { insertFeeLine(); setFeeCtxMenu(null); }}
          >
            + Insert fee line
          </button>
          <div className="border-t border-grid-border my-1" />
          <button
            type="button"
            className={feeMenuDestructiveClass}
            onClick={() => { deleteFeeLine(feeCtxMenu.id); setFeeCtxMenu(null); }}
          >
            🗑️ Delete fee line
          </button>
        </div>
      )}

      {/* Procore-code assign popover (Phase 4) — reused from the GC/Site-Ops one-off escape
          hatch: validates a free-entry code against the Procore authority (`validateOneOffCode`)
          and assigns the resolved code + cost type via the undoable editFeeLine. Never guesses. */}
      <OneOffAssignPopover
        target={feeAssign}
        onAssign={(line, code, costType) => editFeeLine(line.id, { procoreCode: code, costType })}
        onClose={() => setFeeAssign(null)}
      />
    </>
  );
}
