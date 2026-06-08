"use client";
"use no compiler";

import React, { useRef, useMemo, useEffect, useCallback } from "react";
import { useGridKeyboard } from "@/hooks/useGridKeyboard";
import Link from "next/link";
import { flexRender, useReactTable } from "@tanstack/react-table";
import type { HeaderGroup, Header, Row, Cell, Column } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Upload, AlertTriangle, Activity, RotateCcw, RotateCw, FileDown, ChevronDown } from "lucide-react";
import { ESTIMATE_ITEMS_MASTER } from "@/lib/mock-data";
import { ProcessedTakeoffRow, ColumnDefinition, ContextMenuState, GridSelectionState } from "@/types";
import { Project, DivisionLayout } from "@/types/db";
import { DIVISION_LABELS, ESTIMATE_MODIFIERS } from "@/lib/constants";
import { getDivisionCode } from "@/lib/division";
import { getTerminalProgressBar, TakeoffSummary } from "@/lib/calculations";
import { DivisionAggregation, CostTypeAggregation } from "@/types";
import { SearchBar } from "./SearchBar";
import { FilterableColumnHeader } from "./FilterableColumnHeader";
import { ImportPreviewModal } from "./ImportPreviewModal";
import { PendingImport } from "@/hooks/useFileIngestion";
import { ArchParamSuggestion } from "@/lib/archParamDetector";

// ---------------------------------------------------------------------------
// EstimateTable — Step 4 Panel
// Takeoff Workbook Spreadsheet Matrix + Summary Analytics
// ---------------------------------------------------------------------------

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
  divisionBreakdown: DivisionAggregation[];
  costTypeBreakdown: CostTypeAggregation[];

  /** Linked division rows carrying stray typed dollars — excluded from all
   *  totals (gc-siteops Phase 5 trap closure); surfaced, never silently dropped. */
  strayLinkedRows?: { itemId: string; description: string; amount: number }[];

  // Selection state (for active cell styling + click-outside-deselect)
  selection: GridSelectionState;

  // Search / Filter (Phase 4)
  globalFilter: string;
  setGlobalFilter: (value: string) => void;

  scrollToRowRef?: React.MutableRefObject<((index: number) => void) | undefined>;

  // Import modal
  pendingImport: PendingImport | null;
  confirmImport: (archParams: ArchParamSuggestion[], overriddenRows?: ProcessedTakeoffRow[]) => void;
  cancelImport: () => void;
  reParseWithSheet: (sheetName: string) => Promise<void>;
  handleProjectParamChange?: (field: string, value: string | number) => void;
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
  divisionBreakdown,
  costTypeBreakdown,
  strayLinkedRows,
  selection,
  globalFilter,
  setGlobalFilter,
  scrollToRowRef,
  pendingImport,
  confirmImport,
  cancelImport,
  reParseWithSheet,
  handleProjectParamChange,
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

  // ---------------------------------------------------------------------------
  // Row Virtualization — Build flat item list interleaving dividers & data rows
  // ---------------------------------------------------------------------------
  const [collapsedDivisions, setCollapsedDivisions] = React.useState<Record<string, boolean>>({});
  const tableRows = table.getRowModel().rows;

  // Analytics drawer collapse — read-only block, remembered per browser so it stays
  // out of the way once dismissed (single-company tool → one fixed key, no per-project state).
  const [analyticsCollapsed, setAnalyticsCollapsed] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("tb.estimate.analyticsCollapsed") === "1";
  });
  useEffect(() => {
    window.localStorage.setItem("tb.estimate.analyticsCollapsed", analyticsCollapsed ? "1" : "0");
  }, [analyticsCollapsed]);

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

  // Auto-expand division if user keyboard-navigates into a collapsed division
  useEffect(() => {
    if (selection.rowId) {
      const selectedRow = rows.find(r => r.id === selection.rowId);
      if (selectedRow) {
        const division = getDivisionCode(selectedRow.itemId);
        if (division && collapsedDivisions[division]) {
          setCollapsedDivisions(prev => ({ ...prev, [division]: false }));
        }
      }
    }
  }, [selection.rowId, rows, collapsedDivisions]);

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

  const divisionTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    tableRows.forEach((row) => {
      const itemId = row.original.itemId || "";
      const currentDivision = getDivisionCode(itemId);
      if (currentDivision) {
        const rowTotal = (Number(row.original.matchedQty) || 0) * (Number(row.original.unitPrice) || 0);
        totals[currentDivision] = (totals[currentDivision] || 0) + rowTotal;
      }
    });
    return totals;
  }, [tableRows]);

  type VirtualItem = { type: "divider"; divisionCode: string; label: string; total: number; isCollapsed: boolean } | { type: "row"; row: Row<ProcessedTakeoffRow>; dataIndex: number };
  const flatItems: VirtualItem[] = useMemo(() => {
    const items: VirtualItem[] = [];
    let lastDivision = "";
    tableRows.forEach((row, idx) => {
      const itemId = row.original.itemId || "";
      const currentDivision = getDivisionCode(itemId);
      if (currentDivision && currentDivision !== lastDivision) {
        lastDivision = currentDivision;
        const total = divisionTotals[currentDivision] || 0;
        const isCollapsed = !!collapsedDivisions[currentDivision];
        const divLabel = layoutConfigMap[currentDivision] || DIVISION_LABELS[currentDivision] || `DIVISION ${currentDivision}`;
        items.push({ type: "divider", divisionCode: currentDivision, label: divLabel, total, isCollapsed });
      }
      if (!currentDivision || !collapsedDivisions[currentDivision]) {
        items.push({ type: "row", row, dataIndex: idx });
      }
    });
    return items;
  }, [tableRows, collapsedDivisions, divisionTotals, layoutConfigMap]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (flatItems[index]?.type === "divider" ? 44 : 40),
    overscan: 10,
    // React 19 compatibility: prevent flushSync inside lifecycle warnings
    useFlushSync: false,
  });

  // Bind virtualizer scrollTo index to the shared Ref so that keyboard navigation can scroll cells into view.
  // Maps data row index → flat item index (accounting for divider rows).
  if (scrollToRowRef) {
    scrollToRowRef.current = (dataRowIndex: number) => {
      const flatIndex = flatItems.findIndex(item => item.type === "row" && item.dataIndex === dataRowIndex);
      if (flatIndex >= 0) virtualizer.scrollToIndex(flatIndex);
    };
  }

  // Grid-level keyboard navigation (single container owner)
  const { handleGridKeyDown, focusContainer } = useGridKeyboard({
    containerRef: parentRef,
    selection,
    table,
    onNavigate: (e, rIdx, columnId, tbl) => {
      tbl.options.meta?.handleCustomKeyDown(e, rIdx, columnId, tbl);
    },
  });

  return (
    <>
    <div className="space-y-6 animate-fade-in" {...(pendingImport ? { inert: "" } as Record<string, unknown> : {})}>
      {/* Workbook Data I/O Bar — Import (in) on the left, Export (out) on the right */}
      <div className="bg-card border border-grid-border text-card-foreground p-4 rounded-xl shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
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
            <span className="text-[10px] text-slate-400 dark:text-slate-500 font-sans font-semibold uppercase tracking-wider hidden lg:inline">
              ↑↓ navigate
            </span>

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

        <div ref={parentRef} tabIndex={-1} onKeyDown={handleGridKeyDown} className="overflow-x-auto overflow-y-auto border-t border-l border-grid-border grid-scroll outline-none" style={{ maxHeight: "70vh" }}>
          <table className="w-full text-left text-xs border-separate border-spacing-0" style={{ tableLayout: "fixed" }}>
            <thead className="thead-shadow" style={{ display: "block", position: "sticky", top: 0, zIndex: 10 }}>
              {table.getHeaderGroups().map((headerGroup: HeaderGroup<ProcessedTakeoffRow>) => (
                <tr
                  key={headerGroup.id}
                  className="bg-[#3057A6] text-white uppercase border-b border-l-4 border-l-transparent border-grid-border tracking-wider font-bold font-sans text-[13px]"
                  style={{ display: "flex", minWidth: "100%", width: table.getTotalSize() }}
                >
                  {headerGroup.headers.map((header: Header<ProcessedTakeoffRow, unknown>) => {
                    const alignClass = "text-center";
                    const colDef = columnDefs.find(c => c.id === header.column.id);
                    const isCustom = colDef && colDef.type === "custom";

                    return (
                      <th
                        key={header.id}
                        className={`px-1.5 py-2 border-r border-b border-grid-border relative group/header font-bold text-white text-[13px] bg-[#3057A6] ${alignClass}`}
                        style={{ width: header.getSize(), flex: "none" }}
                      >
                        {header.isPlaceholder ? null : isCustom ? (
                          <div className="flex items-center gap-1.5 justify-start">
                            <input
                              type="text"
                              value={colDef.header}
                              onChange={(e) => handleRenameColumn(colDef.id, e.target.value)}
                              className="bg-transparent border border-grid-border focus:ring-2 focus:ring-blue-500 focus:z-10 rounded-lg px-2 py-1 text-xs text-foreground font-semibold outline-none uppercase w-28 text-left focus:bg-white dark:focus:bg-slate-900/40"
                            />
                            <button
                              type="button"
                              onClick={() => handleDeleteColumn(colDef.id)}
                              title="Delete Column"
                              className="text-slate-600 dark:text-slate-400 hover:text-red-500 font-bold text-xs p-1 transition-colors cursor-pointer animate-fade-in"
                            >
                              ×
                            </button>
                          </div>
                        ) : (
                          <FilterableColumnHeader
                            column={header.column}
                            table={table}
                            label={flexRender(header.column.columnDef.header, header.getContext())}
                          />
                        )}
                        {header.column.getCanResize() && (
                          <div
                            onMouseDown={header.getResizeHandler()}
                            onTouchStart={header.getResizeHandler()}
                            className={`absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none transition-opacity ${
                              header.column.getIsResizing()
                                ? "bg-blue-600 dark:bg-blue-400 opacity-100 w-1.5"
                                : "bg-grid-border opacity-0 group-hover/header:opacity-100"
                            }`}
                          />
                        )}
                      </th>
                    );
                  })}
                  <th className="border-b border-grid-border bg-[#3057A6]" style={{ flex: "1 1 auto", minWidth: 0 }} />
                </tr>
              ))}
            </thead>
            <tbody style={{ display: "block", position: "relative", height: rows.length > 0 ? (virtualizer.getTotalSize() || 120) : undefined }}>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={table.getVisibleFlatColumns().length} className="p-12 border-r border-b border-grid-border text-center text-slate-600 dark:text-slate-400 italic font-sans uppercase tracking-wider">
                    No takeoff items ingested. Drag and drop a Togal.ai CSV to initialize.
                  </td>
                </tr>
              ) : flatItems.length === 0 ? (
                <tr className="flex w-full" style={{ position: "absolute", top: 0, left: 0, minWidth: "100%", width: table.getTotalSize(), height: 120 }}>
                  <td colSpan={table.getVisibleFlatColumns().length} className="p-12 border-r border-b border-grid-border text-center text-slate-500 dark:text-slate-400 italic font-sans uppercase tracking-wider flex-1 flex items-center justify-center gap-1.5">
                    <span>No takeoff rows match &quot;</span>
                    <span className="text-blue-600 dark:text-blue-400 font-bold not-italic font-mono">{globalFilter}</span>
                    <span>&quot;</span>
                  </td>
                </tr>
              ) : (
                <>
                  {/* Virtual spacer removed — tbody height handles scroll area */}
                  {virtualizer.getVirtualItems().map((virtualRow) => {
                    const item = flatItems[virtualRow.index];
                    if (!item) return null;

                    if (item.type === "divider") {
                      const prefix = item.isCollapsed ? "▶" : "▼";
                      const formattedTotal = item.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                      return (
                        <tr
                          key={`div-header-${item.divisionCode}`}
                          onClick={() => {
                            setCollapsedDivisions((prev) => ({
                              ...prev,
                              [item.divisionCode]: !prev[item.divisionCode],
                            }));
                          }}
                          className="bg-[#3057A6] hover:bg-[#284a8c] cursor-pointer border-y border-l-4 border-l-transparent border-grid-border font-sans select-none transition-colors duration-200"
                          style={{
                            display: "flex",
                            position: "absolute",
                            top: 0,
                            left: 0,
                            minWidth: "100%",
                            width: table.getTotalSize(),
                            height: virtualRow.size,
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        >
                          <td 
                            colSpan={table.getVisibleFlatColumns().length} 
                            className="p-3 border-r border-b border-grid-border text-white text-[13px] font-bold uppercase tracking-wider flex items-center justify-between" 
                            style={{ flex: 1 }}
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-blue-200 w-4 text-center">{prefix}</span>
                              <span>{item.label}</span>
                            </div>
                            <div className="mr-4">
                              ${formattedTotal}
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    // Data row
                    const row = item.row;
                    const idx = item.dataIndex;
                    const isSelectedRow = selection.rowId === row.original.id;
                    const rowHoverClass = !row.original.isMapped ? "group-hover:bg-amber-50/50 dark:group-hover:bg-amber-900/15" : "group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60";

                    // Zebra striping: alternating row backgrounds
                    const zebraClass = idx % 2 === 1
                      ? "bg-slate-50/40 dark:bg-slate-900/15"
                      : "";

                    // Active row highlight when selected
                    const activeRowClass = isSelectedRow
                      ? "bg-blue-50/60 dark:bg-blue-950/15"
                      : zebraClass;

                    return (
                      <tr
                        key={row.original.id || `row-${idx}`}
                        data-index={virtualRow.index}
                        ref={virtualizer.measureElement}
                        className={`group transition-colors ${
                          !row.original.isMapped
                            ? `bg-amber-50/20 dark:bg-amber-950/5 hover:bg-amber-50/40 dark:hover:bg-amber-950/10 border-l-4 border-l-amber-500`
                            : `${activeRowClass} hover:bg-blue-100/50 dark:hover:bg-slate-800/60 border-l-4 ${
                                isSelectedRow ? "border-l-blue-500" : "border-l-transparent"
                              }`
                        }`}
                        style={{
                          display: "flex",
                          position: "absolute",
                          top: 0,
                          left: 0,
                          minWidth: "100%",
                          width: table.getTotalSize(),
                          height: virtualRow.size,
                          transform: `translateY(${virtualRow.start}px)`,
                          zIndex: isSelectedRow ? 2 : undefined,
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({
                            visible: true,
                            x: e.clientX,
                            y: e.clientY,
                            rowIndex: idx,
                            columnId: ""
                          });
                        }}
                      >
                        {row.getVisibleCells().map((cell: Cell<ProcessedTakeoffRow, unknown>) => {
                          let alignClass = "text-left";
                          if (["costType", "uom", "itemId", "matchedQty", "unitPrice", "total", "costPerSf", "costPerUnit"].includes(cell.column.id)) alignClass = "text-center";

                          const colDef = columnDefs.find(c => c.id === cell.column.id);
                          const isCustom = colDef && colDef.type === "custom";
                          const isEditable = isCustom || ["itemId", "description", "matchedQty", "unitPrice", "uom"].includes(cell.column.id);
                          const paddingClass = isEditable ? "p-0" : "p-3";

                          // Active cell indicator — 2px blue ring on td wrapper
                          const isCellSelected = selection.rowId === row.original.id && selection.columnId === cell.column.id;
                          const isCellEditing = isCellSelected && selection.isEditing;
                          const cellSelectionClass = isCellEditing
                            ? "cell-editing cell-transition"
                            : isCellSelected
                            ? "cell-selected cell-transition"
                            : "cell-transition";

                          const editAffordance = isEditable
                            ? "hover:bg-blue-50/50 dark:hover:bg-blue-950/10 cursor-text"
                            : "cursor-default";

                          // Non-editable cell click handler (E1) — set selection but don't enter edit mode
                          const handleNonEditableCellClick = !isEditable ? () => {
                            const meta = table.options.meta;
                            if (meta) {
                              meta.setSelection({ rowId: row.original.id, columnId: cell.column.id, isEditing: false });
                              focusContainer();
                            }
                          } : undefined;

                          return (
                            <td
                              key={cell.id}
                              className={`${paddingClass} border-r border-b border-grid-border ${alignClass} ${rowHoverClass} ${editAffordance} ${cellSelectionClass}`}
                              style={{ width: cell.column.getSize(), flex: "none" }}
                              onClick={handleNonEditableCellClick}
                            >
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                          );
                        })}
                        <td className="border-b border-grid-border bg-card group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60 transition-colors" style={{ flex: "1 1 auto", minWidth: 0 }} />
                      </tr>
                    );
                  })}
                </>
              )}
            </tbody>

            {/* Complete Locked-down Summary Row Appendices */}
            {rows.length > 0 && (
              <tfoot style={{ display: "block" }}>
                {/* Subtotal Row */}
                <tr className="border-t border-l-4 border-l-transparent border-grid-border bg-background/80 dark:bg-slate-900/30 text-xs font-bold text-slate-600 dark:text-slate-400 font-sans" style={{ display: "flex", minWidth: "100%" }}>
                  {table.getVisibleFlatColumns().map((column: Column<ProcessedTakeoffRow>) => {
                    let content: React.ReactNode = "";
                    let alignClass = "text-left font-sans";
                    if (column.id === "costType") { content = "TI"; alignClass = "text-center font-mono"; }
                    else if (column.id === "description") { content = "Estimate Subtotal (incl. GC + Site Ops)"; alignClass = "text-left font-sans"; }
                    else if (column.id === "total") { content = `$${subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; alignClass = "text-center text-foreground font-bold font-mono"; }
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
                        else if (column.id === "total") { content = `$${modValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; alignClass = "text-center text-foreground font-bold font-mono"; }
                        else if (column.id === "costPerUnit") { content = `$${(modValue / (unitCount || 1)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; alignClass = "text-center font-mono"; }
                        else if (column.id === "costPerSf") { content = `$${(modValue / (squareFootage || 1)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; alignClass = "text-center font-mono"; }
                        return (<td key={column.id} className={`p-3 border-r border-b border-grid-border ${alignClass}`} style={{ width: column.getSize(), flex: "none" }}>{content}</td>);
                      })}
                      <td className="border-b border-grid-border" style={{ flex: "1 1 auto", minWidth: 0 }} />
                    </tr>
                  );
                })}

                {/* Total Estimated Cost Row */}
                <tr className="border-t border-double border-l-4 border-l-transparent border-emerald-500/50 bg-emerald-50 dark:bg-emerald-950/15 text-xs font-black text-emerald-600 dark:text-emerald-400 font-sans" style={{ display: "flex", minWidth: "100%" }}>
                  {table.getVisibleFlatColumns().map((column: Column<ProcessedTakeoffRow>) => {
                    let content: React.ReactNode = "";
                    let alignClass = "text-left font-sans";
                    if (column.id === "costType") { content = "TI"; alignClass = "text-center text-emerald-600 dark:text-emerald-500 font-extrabold font-mono"; }
                    else if (column.id === "description") { content = "Total Estimated Cost"; alignClass = "text-left uppercase tracking-wider font-sans"; }
                    else if (column.id === "total") { content = `$${totalEstimatedCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; alignClass = "text-center text-sm text-emerald-600 dark:text-emerald-400 font-black font-mono"; }
                    else if (column.id === "costPerUnit") { content = `$${costPerUnit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; alignClass = "text-center text-sm font-mono"; }
                    else if (column.id === "costPerSf") { content = `$${costPerSf.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; alignClass = "text-center text-sm font-mono"; }
                    else if (column.id === "uom" || ["matchedQty", "unitPrice"].includes(column.id)) { alignClass = "text-center font-mono"; }
                    return (<td key={column.id} className={`p-3 border-r border-b border-grid-border ${alignClass}`} style={{ width: column.getSize(), flex: "none" }}>{content}</td>);
                  })}
                  <td className="border-b border-grid-border" style={{ flex: "1 1 auto", minWidth: 0 }} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

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
        {Object.keys(ESTIMATE_ITEMS_MASTER).map((key) => (
          <option key={key} value={key}>
            {ESTIMATE_ITEMS_MASTER[key].description}
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
    </>
  );
}
