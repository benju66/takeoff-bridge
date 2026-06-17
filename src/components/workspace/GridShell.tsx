"use client";

import React, { useRef, useMemo, useEffect } from "react";
import { flexRender } from "@tanstack/react-table";
import type { Table, HeaderGroup, Header, Row, Cell } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useGridKeyboard } from "@/hooks/useGridKeyboard";
import { ColumnDefinition, ContextMenuState, GridSelectionState } from "@/types";
import { FilterableColumnHeader } from "./FilterableColumnHeader";
import { ResizeHandle } from "@/components/ui/grid";

// ---------------------------------------------------------------------------
// GridShell<TRow> — the reusable grid machinery (B1a extraction, B1b generalized)
//
// The TanStack instance plumbing + selection/keyboard + virtualized rendering, factored
// out of EstimateTable so Steps 2/3 can later plug in their own row sets. Step 4
// (EstimateTable, via useTakeoffWorkbook) is the SOLE consumer this phase. Behavior is
// identical to the pre-extraction grid; see .agent/skills/data-table-architecture/SKILL.md
// for the invariants this code preserves (click-to-toggle, single-container keyboard owner,
// meta.selection read live in cell renderers, virtualization layout).
//
// Everything Step-4-specific is injected via `config` (GridShellConfig): how to group rows
// into section dividers, the row identity, which rows are "flagged", and the editable /
// center-aligned column sets. The shell reads off `table.options.meta` only the generalized
// host contract (GridHostContract): `setSelection` + `handleCustomKeyDown`.
//
// The host owns the card wrapper + click-outside, the title bar, the <tfoot> summary rows
// (passed in as `footer`), the status bar, and the Trust Inspector. This shell owns only the
// scroll container + <table> (thead + virtualized tbody + footer slot).
// ---------------------------------------------------------------------------

/** How a host projects its row type onto the generic grid surface. Step 4 supplies the
 *  division-code grouping + isMapped flag + Step-4 column sets; Steps 2/3 (B2/B3) will supply
 *  their own. */
export interface GridShellConfig<TRow> {
  /** Stable row identity — compared against `selection.rowId` and used for React keys.
   *  (Step 4: `row.id`) */
  getRowId: (row: TRow) => string;
  /** Section/divider grouping key for a row; `""` → the row sits under no divider.
   *  (Step 4: `getDivisionCode(row.itemId)`) */
  getGroupKey: (row: TRow) => string;
  /** Display label for a divider's group key. (Step 4: layout override → DIVISION_LABELS →
   *  `DIVISION <code>`) */
  getGroupLabel: (groupKey: string) => string;
  /** A row's contribution to its group's divider subtotal. (Step 4: `matchedQty × unitPrice`) */
  getRowGroupTotal: (row: TRow) => number;
  /** A row needing attention → amber "flagged" row styling. (Step 4: `!row.isMapped`) */
  isRowFlagged: (row: TRow) => boolean;
  /** Column ids whose data cells are editable (drives padding + edit affordance +
   *  non-editable-cell click-to-select). Custom columns are always editable. */
  editableColumnIds: readonly string[];
  /** Column ids whose data cells render center-aligned. */
  centerAlignedColumnIds: readonly string[];
  /** A+1 per-line override ⚑ hook point — render a per-cell overlay atop the flexRendered
   *  cell content. NOT wired this phase: Step 4 omits it, so nothing renders and the DOM is
   *  byte-identical. Steps 2/3 (B2/B3) will pass a renderer returning the override marker once
   *  the type-over gesture lands. */
  renderCellOverlay?: (row: TRow, columnId: string) => React.ReactNode;
}

interface GridShellProps<TRow> {
  table: Table<TRow>;
  rows: TRow[];
  columnDefs: ColumnDefinition[];
  selection: GridSelectionState;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState>>;
  scrollToRowRef?: React.MutableRefObject<((index: number) => void) | undefined>;
  handleRenameColumn: (id: string, name: string) => void;
  handleDeleteColumn: (id: string) => void;
  globalFilter: string;
  /** The host's summary <tfoot> element (or null when there are no rows). */
  footer: React.ReactNode;
  /** Host-supplied projection of TRow onto the generic grid surface. */
  config: GridShellConfig<TRow>;
}

export function GridShell<TRow>({
  table,
  rows,
  columnDefs,
  selection,
  setContextMenu,
  scrollToRowRef,
  handleRenameColumn,
  handleDeleteColumn,
  globalFilter,
  footer,
  config,
}: GridShellProps<TRow>) {
  const {
    getRowId,
    getGroupKey,
    getGroupLabel,
    getRowGroupTotal,
    isRowFlagged,
    editableColumnIds,
    centerAlignedColumnIds,
    renderCellOverlay,
  } = config;

  // ---------------------------------------------------------------------------
  // Row Virtualization — Build flat item list interleaving group dividers & data rows
  // ---------------------------------------------------------------------------
  const [collapsedGroups, setCollapsedGroups] = React.useState<Record<string, boolean>>({});
  const tableRows = table.getRowModel().rows;

  // Auto-expand a group if the user keyboard-navigates into a collapsed group
  useEffect(() => {
    if (selection.rowId) {
      const selectedRow = rows.find(r => getRowId(r) === selection.rowId);
      if (selectedRow) {
        const groupKey = getGroupKey(selectedRow);
        if (groupKey && collapsedGroups[groupKey]) {
          setCollapsedGroups(prev => ({ ...prev, [groupKey]: false }));
        }
      }
    }
  }, [selection.rowId, rows, collapsedGroups, getRowId, getGroupKey]);

  const groupTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    tableRows.forEach((row) => {
      const groupKey = getGroupKey(row.original);
      if (groupKey) {
        totals[groupKey] = (totals[groupKey] || 0) + getRowGroupTotal(row.original);
      }
    });
    return totals;
  }, [tableRows, getGroupKey, getRowGroupTotal]);

  type VirtualItem = { type: "divider"; groupKey: string; label: string; total: number; isCollapsed: boolean } | { type: "row"; row: Row<TRow>; dataIndex: number };
  const flatItems: VirtualItem[] = useMemo(() => {
    const items: VirtualItem[] = [];
    let lastGroup = "";
    tableRows.forEach((row, idx) => {
      const groupKey = getGroupKey(row.original);
      if (groupKey && groupKey !== lastGroup) {
        lastGroup = groupKey;
        const total = groupTotals[groupKey] || 0;
        const isCollapsed = !!collapsedGroups[groupKey];
        const label = getGroupLabel(groupKey);
        items.push({ type: "divider", groupKey, label, total, isCollapsed });
      }
      if (!groupKey || !collapsedGroups[groupKey]) {
        items.push({ type: "row", row, dataIndex: idx });
      }
    });
    return items;
  }, [tableRows, collapsedGroups, groupTotals, getGroupKey, getGroupLabel]);

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
    getRowId,
    onNavigate: (e, rIdx, columnId, tbl) => {
      tbl.options.meta?.handleCustomKeyDown(e, rIdx, columnId, tbl);
    },
  });

  return (
    <div ref={parentRef} tabIndex={-1} onKeyDown={handleGridKeyDown} className="overflow-x-auto overflow-y-auto border-t border-l border-grid-border grid-scroll outline-none" style={{ maxHeight: "70vh" }}>
      <table className="w-full text-left text-xs border-separate border-spacing-0" style={{ tableLayout: "fixed" }}>
        <thead className="thead-shadow" style={{ display: "block", position: "sticky", top: 0, zIndex: 10 }}>
          {table.getHeaderGroups().map((headerGroup: HeaderGroup<TRow>) => (
            <tr
              key={headerGroup.id}
              className="bg-[#3057A6] text-white uppercase border-b border-l-4 border-l-transparent border-grid-border tracking-wider font-bold font-sans text-[13px]"
              style={{ display: "flex", minWidth: "100%", width: table.getTotalSize() }}
            >
              {headerGroup.headers.map((header: Header<TRow, unknown>) => {
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
                      <ResizeHandle
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        isResizing={header.column.getIsResizing()}
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
                      key={`div-header-${item.groupKey}`}
                      onClick={() => {
                        setCollapsedGroups((prev) => ({
                          ...prev,
                          [item.groupKey]: !prev[item.groupKey],
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
                const flagged = isRowFlagged(row.original);
                const isSelectedRow = selection.rowId === getRowId(row.original);
                const rowHoverClass = flagged ? "group-hover:bg-amber-50/50 dark:group-hover:bg-amber-900/15" : "group-hover:bg-blue-100/50 dark:group-hover:bg-slate-800/60";

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
                    key={getRowId(row.original) || `row-${idx}`}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    className={`group transition-colors ${
                      flagged
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
                    {row.getVisibleCells().map((cell: Cell<TRow, unknown>) => {
                      let alignClass = "text-left";
                      if (centerAlignedColumnIds.includes(cell.column.id)) alignClass = "text-center";

                      const colDef = columnDefs.find(c => c.id === cell.column.id);
                      const isCustom = colDef && colDef.type === "custom";
                      const isEditable = isCustom || editableColumnIds.includes(cell.column.id);
                      const paddingClass = isEditable ? "p-0" : "p-3";

                      // Active cell indicator — 2px blue ring on td wrapper
                      const isCellSelected = selection.rowId === getRowId(row.original) && selection.columnId === cell.column.id;
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
                          meta.setSelection({ rowId: getRowId(row.original), columnId: cell.column.id, isEditing: false });
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
                          {renderCellOverlay?.(row.original, cell.column.id)}
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

        {footer}
      </table>
    </div>
  );
}
