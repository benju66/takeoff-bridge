"use client";
"use no compiler";

import React, { useRef, useMemo, useEffect } from "react";
import { flexRender, useReactTable } from "@tanstack/react-table";
import type { HeaderGroup, Header, Row, Cell } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useGridKeyboard } from "@/hooks/useGridKeyboard";
import { ProcessedTakeoffRow, ColumnDefinition, ContextMenuState, GridSelectionState } from "@/types";
import { DIVISION_LABELS } from "@/lib/constants";
import { getDivisionCode } from "@/lib/division";
import { FilterableColumnHeader } from "./FilterableColumnHeader";
import { ResizeHandle } from "@/components/ui/grid";

// ---------------------------------------------------------------------------
// EstimateGridShell — the reusable grid machinery (B1a)
//
// The TanStack instance plumbing + selection/keyboard + virtualized rendering,
// extracted verbatim from EstimateTable so Steps 2/3 can later plug in. Step 4
// (EstimateTable) is the SOLE consumer this phase. Behavior is identical to the
// pre-extraction grid; see .agent/skills/data-table-architecture/SKILL.md for the
// invariants this code preserves (click-to-toggle, single-container keyboard owner,
// meta.selection read live in cell renderers, virtualization layout).
//
// The host owns the card wrapper + click-outside, the title bar, the <tfoot> summary
// rows (passed in as `footer`), the status bar, and the Trust Inspector. This shell
// owns only the scroll container + <table> (thead + virtualized tbody + footer slot).
// ---------------------------------------------------------------------------

interface EstimateGridShellProps {
  table: ReturnType<typeof useReactTable<ProcessedTakeoffRow>>;
  rows: ProcessedTakeoffRow[];
  columnDefs: ColumnDefinition[];
  selection: GridSelectionState;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState>>;
  scrollToRowRef?: React.MutableRefObject<((index: number) => void) | undefined>;
  /** division → display label, built once in the host (shared with the analytics drawer). */
  layoutConfigMap: Record<string, string>;
  handleRenameColumn: (id: string, name: string) => void;
  handleDeleteColumn: (id: string) => void;
  globalFilter: string;
  /** The Step-4 summary <tfoot> element (or null when there are no rows). */
  footer: React.ReactNode;
}

export function EstimateGridShell({
  table,
  rows,
  columnDefs,
  selection,
  setContextMenu,
  scrollToRowRef,
  layoutConfigMap,
  handleRenameColumn,
  handleDeleteColumn,
  globalFilter,
  footer,
}: EstimateGridShellProps) {
  // ---------------------------------------------------------------------------
  // Row Virtualization — Build flat item list interleaving dividers & data rows
  // ---------------------------------------------------------------------------
  const [collapsedDivisions, setCollapsedDivisions] = React.useState<Record<string, boolean>>({});
  const tableRows = table.getRowModel().rows;

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

        {footer}
      </table>
    </div>
  );
}
