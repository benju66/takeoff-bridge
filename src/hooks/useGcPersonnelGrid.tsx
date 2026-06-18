"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  createColumnHelper,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type { CellContext, ColumnFiltersState, Table } from "@tanstack/react-table";
import { Flag } from "lucide-react";
import { NumberCellInput } from "@/components/workspace/NumberCellInput";
import { EngineLinkBadge } from "@/components/workspace/EngineLinkBadge";
import type { GridShellConfig } from "@/components/workspace/GridShell";
import {
  ColumnDefinition,
  ContextMenuState,
  GcGridCommand,
  GridSelectionState,
} from "@/types";
import type { EstimateSectionLine } from "@/types/db";
import type { OverridePayload } from "@/lib/overrideSetter";
import { useCommandHistory } from "./useCommandHistory";
import type { UsePersonnelCalculationsReturn } from "./usePersonnelCalculations";
import { sectionLineTotalOverrideKey } from "@/lib/sectionLines/ids";
import { ENTRY_KIND } from "@/lib/sectionLines/entryKinds";
import { gcLeafNodeId } from "@/lib/bindings/types";
import {
  GC_GROUP_LABELS,
  GC_MANUAL_BY_CODE,
  GC_ROW_META,
  buildCalcLookup,
  entryValue,
  num,
  resolveEntryTarget,
  resolveRoleKey,
  type GcGroupKey,
} from "@/lib/sectionLines/gcGridModel";

// ---------------------------------------------------------------------------
// useGcPersonnelGrid — Step 2 (GC Personnel) grid state + command hook (Phase B2)
//
// The leaner Track-B twin of useTakeoffWorkbook: it owns ONLY grid concerns
// (selection, the TanStack instance, column defs, an undo/redo command history,
// editing buffers, in-session cell-lock, and the per-line type-over gesture) and
// exposes a `meta` satisfying GridHostContract<EstimateSectionLine, GridCellKind>
// + a GridShellConfig so Step 2 renders through the shared GridShell.
//
// It is a VENEER over usePersonnelCalculations (B2-D1): that hook stays the
// authoritative owner of the GC inputs (utilization / equipment / manual / rate),
// the legacy blob snapshots, the A3 dual-write/dual-read, and the authoritative
// `calcResult`. The grid's ROWS are `personnel.sectionLines` (section==='gc',
// A3-synthesized) and per-row numbers come from `personnel.calcResult` (the A1
// engine), joined by `code`. An input edit drives the matching personnel setter +
// pushes a GcGridCommand carrying full inverse data; undo/redo replays the setter.
//
// The per-line type-over (D3 / A+1) is NOT on the undo stack (B2-D2): it is an
// append-only estimate_overrides action recorded via `onSaveOverride`, surfaced as
// the GridShellConfig.renderCellOverlay ⚑ (set) + a click-to-revert.
//
// §8 invariants (data-table-architecture SKILL) are preserved: click-to-toggle (no
// onDoubleClick), commit-before-unmount via NumberCellInput's own onBlur, cells read
// meta.selection LIVE (never closure), `selection` is NOT in the columns memo deps,
// and keyboard nav uses the single-container owner (useGridKeyboard, in GridShell).
// ---------------------------------------------------------------------------

const fmtUSD = (n: number) =>
  "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Step-2 grid columns (display:flex like Step 4). All accessor columns so the
// shared FilterableColumnHeader (rendered by GridShell) reads a value per column.
const STEP2_COLUMN_DEFS: ColumnDefinition[] = [
  { id: "code", header: "Code", type: "default", size: 120 },
  { id: "description", header: "Staff Role / Operational Scope", type: "default", size: 320 },
  { id: "unit", header: "Unit", type: "default", size: 70 },
  { id: "rate", header: "Rate", type: "default", size: 120 },
  { id: "entry", header: "Utilization / Entry", type: "default", size: 160 },
  { id: "calcQty", header: "Calculated Qty", type: "default", size: 150 },
  { id: "total", header: "Total Cost", type: "default", size: 160 },
];

const STEP2_EDITABLE_COLUMN_IDS = ["rate", "entry", "total"] as const;
const STEP2_CENTER_ALIGNED_COLUMN_IDS = ["code", "unit", "rate", "entry", "calcQty", "total"] as const;

const columnHelper = createColumnHelper<EstimateSectionLine>();

// Cast the custom filter-fn key to a built-in name so column defs typecheck (the
// same shim useTakeoffWorkbook uses); resolved at runtime by the `filterFns` map below.
const multiSelect = "multiSelect" as "includesString";

export interface UseGcPersonnelGridReturn {
  table: Table<EstimateSectionLine>;
  rows: EstimateSectionLine[];
  columnDefs: ColumnDefinition[];
  selection: GridSelectionState;
  contextMenu: ContextMenuState;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState>>;
  lockedCells: Record<string, boolean>;
  toggleCellLock: (cellKey: string) => void;
  gridConfig: GridShellConfig<EstimateSectionLine>;
  scrollToRowRef: React.MutableRefObject<((index: number) => void) | undefined>;
  handleUndo: () => void;
  handleRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undoStackSize: number;
  redoStackSize: number;
  grandTotal: number;
}

export function useGcPersonnelGrid(
  personnel: UsePersonnelCalculationsReturn,
  onSaveOverride?: (payload: OverridePayload) => Promise<void>,
): UseGcPersonnelGridReturn {
  // Live refs so the columns memo never depends on per-edit-changing values
  // (cell renderers read .current at render → always fresh, cell identity stable).
  const personnelRef = useRef(personnel);
  personnelRef.current = personnel;

  const calcLookup = useMemo(() => buildCalcLookup(personnel.calcResult), [personnel.calcResult]);
  const calcLookupRef = useRef(calcLookup);
  calcLookupRef.current = calcLookup;

  // Display-ordered GC section lines (01.A → 01.F). Persistence order is untouched.
  const rows = useMemo(
    () =>
      personnel.sectionLines
        .filter((l) => l.section === "gc")
        .slice()
        .sort((a, b) => (GC_ROW_META.get(a.code)?.order ?? 999) - (GC_ROW_META.get(b.code)?.order ?? 999)),
    [personnel.sectionLines]
  );

  // Selection + context menu + in-session cell locks (B2-D3: not persisted).
  const [selection, setSelection] = useState<GridSelectionState>({ rowId: null, columnId: null, isEditing: false });
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0, rowIndex: -1, columnId: "" });
  const [lockedCells, setLockedCells] = useState<Record<string, boolean>>({});
  const lockedCellsRef = useRef(lockedCells);
  lockedCellsRef.current = lockedCells;

  const history = useCommandHistory<GcGridCommand>();

  const scrollToRowRef = useRef<((index: number) => void) | undefined>(undefined);

  // Contract editing buffers (unused by Step 2 — NumberCellInput owns its own
  // buffer + commit-on-blur — but required by GridHostContract).
  const [editingCellId, setEditingCellId] = useState<string | null>(null);
  const [editingValues, setEditingValues] = useState<Record<string, string>>({});
  const flushEditingBufferRef = useRef<() => void>(() => {});
  const focusedCellRef = useRef<{ rowId: string; field: string; initialValue: string | number | boolean } | null>(null);
  const focusedCustomCellRef = useRef<{ rowId: string; columnId: string; initialValue: string } | null>(null);

  // ---------------------------------------------------------------------------
  // Command apply / commit (stable — read personnel via ref so identity holds)
  // ---------------------------------------------------------------------------
  const applyEdit = useCallback((target: "utilization" | "rate" | "equipment" | "manual", key: string, value: number | undefined) => {
    const p = personnelRef.current;
    switch (target) {
      case "utilization": p.setUtilization(key, value ?? 0); break;
      case "rate":
        if (value === undefined) p.resetRate(key);
        else p.handleRateChange(key, String(value));
        break;
      case "equipment": p.handleEquipmentChange(key as "dumpsters" | "toilets" | "electric", String(value ?? 0)); break;
      case "manual": p.handleManualEntryChange(key, String(value ?? 0)); break;
    }
  }, []);

  /** Commit an input edit: push the command BEFORE driving the setter (guardrail). */
  const commitInputEdit = useCallback(
    (lineId: string, target: "utilization" | "rate" | "equipment" | "manual", key: string, prevValue: number | undefined, nextValue: number | undefined) => {
      if (prevValue === nextValue) return;
      history.pushCommand({ type: "EDIT_SECTION_CELL", lineId, target, key, prevValue, nextValue });
      applyEdit(target, key, nextValue);
    },
    [history, applyEdit]
  );

  const toggleCellLock = useCallback(
    (cellKey: string) => {
      const prevLocked = !!lockedCellsRef.current[cellKey];
      const nextLocked = !prevLocked;
      history.pushCommand({ type: "TOGGLE_SECTION_CELL_LOCK", cellKey, prevLocked, nextLocked });
      setLockedCells((prev) => ({ ...prev, [cellKey]: nextLocked }));
    },
    [history]
  );

  // The per-line type-over (D3) — an append-only override action, NOT a command.
  const commitOverride = useCallback(
    (lineId: string, code: string, nextValue: number) => {
      if (!onSaveOverride) return;
      const field = sectionLineTotalOverrideKey(lineId);
      const trace = personnelRef.current.calcResult.overrides?.[field];
      const computedValue = trace ? trace.computedValue : (calcLookupRef.current.get(code)?.total ?? 0);
      if (trace && trace.overrideValue === nextValue) return; // no-op re-type
      onSaveOverride({ field, computedValue, overrideValue: nextValue, reason: "" }).catch((err) =>
        console.error("Failed to record GC line type-over:", err)
      );
    },
    [onSaveOverride]
  );

  const revertOverride = useCallback(
    (lineId: string) => {
      if (!onSaveOverride) return;
      const field = sectionLineTotalOverrideKey(lineId);
      const trace = personnelRef.current.calcResult.overrides?.[field];
      if (!trace) return;
      onSaveOverride({ field, computedValue: trace.computedValue, overrideValue: null, reason: "" }).catch((err) =>
        console.error("Failed to revert GC line type-over:", err)
      );
    },
    [onSaveOverride]
  );

  // ---------------------------------------------------------------------------
  // Keyboard navigation — leaner Step-2 copy of useKeyboardNavigation, specialized
  // to the Step-2 columns / input-id scheme / editable set + the section-line rows.
  // Routed through meta.handleCustomKeyDown (free string columnId), so it sidesteps
  // the fixed GridCellKind union the augmented TableMeta carries.
  // ---------------------------------------------------------------------------
  const isColumnEditable = (colId: string) => (STEP2_EDITABLE_COLUMN_IDS as readonly string[]).includes(colId);

  const processNav = useCallback(
    (e: React.KeyboardEvent, rIdx: number, columnId: string, table: Table<EstimateSectionLine>) => {
      const meta = table.options.meta!;
      const isEditing = meta.selection.isEditing;
      const rowModel = table.getRowModel().rows;
      const totalRows = rowModel.length;
      const visibleCols = table.getVisibleFlatColumns().map((c) => c.id);
      const colIdx = visibleCols.indexOf(columnId);
      const rowIdAt = (i: number) => rowModel[i]?.original.id ?? null;
      const cellId = (cId: string, i: number) => `cell-${rowIdAt(i)}-${cId}`;
      const focusCell = (cId: string, i: number) => {
        if (scrollToRowRef.current) scrollToRowRef.current(i);
        requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(cellId(cId, i))?.focus()));
      };
      const commitActiveEdit = () => {
        if (isEditing && document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
      };
      const select = (i: number, cId: string) => {
        const id = rowIdAt(i);
        if (id) { meta.setSelection({ rowId: id, columnId: cId, isEditing: false }); focusCell(cId, i); }
      };

      if (e.key === "Escape") {
        if (isEditing) {
          e.preventDefault();
          meta.setSelection((prev) => ({ ...prev, isEditing: false }));
          requestAnimationFrame(() => document.getElementById(cellId(columnId, rIdx))?.focus());
        }
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        commitActiveEdit();
        const dir = e.shiftKey ? -1 : 1;
        const next = rIdx + dir;
        meta.setSelection({ rowId: null, columnId: null, isEditing: false });
        if (next >= 0 && next < totalRows) select(next, columnId);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        commitActiveEdit();
        meta.setSelection({ rowId: null, columnId: null, isEditing: false });
        if (e.shiftKey) {
          if (colIdx > 0) select(rIdx, visibleCols[colIdx - 1]);
          else if (rIdx > 0) select(rIdx - 1, visibleCols[visibleCols.length - 1]);
        } else {
          if (colIdx < visibleCols.length - 1) select(rIdx, visibleCols[colIdx + 1]);
          else if (rIdx < totalRows - 1) select(rIdx + 1, visibleCols[0]);
        }
        return;
      }
      if (e.key === "ArrowDown" && !isEditing) { e.preventDefault(); if (rIdx + 1 < totalRows) select(rIdx + 1, columnId); return; }
      if (e.key === "ArrowUp" && !isEditing) { e.preventDefault(); if (rIdx - 1 >= 0) select(rIdx - 1, columnId); return; }
      if (e.key === "ArrowLeft") {
        const input = e.target as HTMLInputElement;
        const atStart = input instanceof HTMLInputElement && input.selectionStart === 0 && input.selectionEnd === 0;
        if (!isEditing || atStart) { e.preventDefault(); commitActiveEdit(); if (colIdx > 0) select(rIdx, visibleCols[colIdx - 1]); }
        return;
      }
      if (e.key === "ArrowRight") {
        const input = e.target as HTMLInputElement;
        const atEnd = input instanceof HTMLInputElement && input.selectionStart === input.value.length;
        if (!isEditing || atEnd) { e.preventDefault(); commitActiveEdit(); if (colIdx < visibleCols.length - 1) select(rIdx, visibleCols[colIdx + 1]); }
        return;
      }
      if (e.key === "F2" && !isEditing && isColumnEditable(columnId)) {
        e.preventDefault();
        const id = rowIdAt(rIdx);
        if (id) meta.setSelection({ rowId: id, columnId, isEditing: true });
        return;
      }
      // Direct alphanumeric → enter edit with the typed char
      if (!isEditing && isColumnEditable(columnId) && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const id = rowIdAt(rIdx);
        if (id) meta.setSelection({ rowId: id, columnId, isEditing: true, initialEditChar: e.key });
      }
    },
    []
  );

  // ---------------------------------------------------------------------------
  // Cell renderer (the click-to-toggle select/edit pattern, §3). Reads meta.selection
  // LIVE from the table; never from closure. `value` feeds the editor; `display` is the
  // non-editing content (formatted value + any badges).
  // ---------------------------------------------------------------------------
  const renderNumberCell = useCallback(
    (
      info: CellContext<EstimateSectionLine, unknown>,
      opts: {
        colId: string;
        value: number;
        display: React.ReactNode;
        editable: boolean;
        onCommit: (n: number) => void;
        align?: "center" | "left";
      }
    ): React.ReactNode => {
      const meta = info.table.options.meta!;
      const row = info.row.original;
      const index = info.row.index;
      const rowId = row.id;
      const { colId } = opts;
      const locked = !!meta.lockedCells[`${rowId}::${colId}`];
      const editable = opts.editable && !locked;
      const isSelected = meta.selection.rowId === rowId && meta.selection.columnId === colId;
      const isEditing = isSelected && meta.selection.isEditing && editable;
      const alignClass = opts.align === "left" ? "text-left" : "text-center";

      if (isEditing) {
        return (
          <NumberCellInput
            id={`${colId}-input-${index}`}
            value={opts.value}
            className={`w-full h-full min-h-[36px] px-3 py-2 bg-transparent border-none rounded-none ${alignClass} outline-none font-mono text-xs focus:ring-2 focus:ring-blue-500 focus:z-10 focus:bg-white dark:focus:bg-slate-900/40 text-slate-900 dark:text-white`}
            onCommit={opts.onCommit}
            onKeyDown={(e) => meta.handleCustomKeyDown(e as unknown as React.KeyboardEvent, index, colId, info.table)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              meta.setContextMenu({ visible: true, x: e.clientX, y: e.clientY, rowIndex: index, columnId: colId });
            }}
            initialEditChar={meta.selection.initialEditChar}
          />
        );
      }

      const editAffordance = editable ? "cursor-text hover:bg-blue-50/50 dark:hover:bg-blue-950/10" : "cursor-default";
      const selectedClass = isSelected ? "outline outline-2 outline-blue-600 outline-offset-[-2px] bg-blue-50/10 dark:bg-blue-900/10 z-10 relative" : "";
      return (
        <div
          id={`cell-${rowId}-${colId}`}
          className={`w-full h-full min-h-[36px] px-3 py-2 flex items-center justify-center ${alignClass} font-mono text-xs text-foreground ${editAffordance} ${selectedClass} ${locked ? "opacity-60 cursor-not-allowed" : ""}`}
          onClick={() => {
            if (isSelected && editable) meta.setSelection({ rowId, columnId: colId, isEditing: true });
            else meta.setSelection({ rowId, columnId: colId, isEditing: false });
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            meta.setSelection({ rowId, columnId: colId, isEditing: false });
            meta.setContextMenu({ visible: true, x: e.clientX, y: e.clientY, rowIndex: index, columnId: colId });
          }}
        >
          {opts.display}
        </div>
      );
    },
    []
  );

  // A read-only display cell (code / description / unit / auto entry / non-editable rate).
  const renderDisplayCell = useCallback(
    (info: CellContext<EstimateSectionLine, unknown>, content: React.ReactNode, align: "left" | "center", extraClass = ""): React.ReactNode => {
      const meta = info.table.options.meta!;
      const row = info.row.original;
      const index = info.row.index;
      const rowId = row.id;
      const colId = info.column.id;
      const isSelected = meta.selection.rowId === rowId && meta.selection.columnId === colId;
      const alignClass = align === "left" ? "text-left" : "text-center";
      const selectedClass = isSelected ? "outline outline-2 outline-blue-600 outline-offset-[-2px] bg-blue-50/10 dark:bg-blue-900/10 z-10 relative" : "";
      return (
        <div
          id={`cell-${rowId}-${colId}`}
          className={`w-full h-full min-h-[36px] px-3 py-2 flex items-center ${align === "left" ? "justify-start" : "justify-center"} ${alignClass} text-xs ${extraClass} ${selectedClass}`}
          onClick={() => meta.setSelection({ rowId, columnId: colId, isEditing: false })}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            meta.setSelection({ rowId, columnId: colId, isEditing: false });
            meta.setContextMenu({ visible: true, x: e.clientX, y: e.clientY, rowIndex: index, columnId: colId });
          }}
        >
          {content}
        </div>
      );
    },
    []
  );

  // ---------------------------------------------------------------------------
  // Columns (stable — close over the live refs + the stable commit fns; `selection`
  // is intentionally NOT a dep, §8 anti-pattern #4).
  // ---------------------------------------------------------------------------
  const columns = useMemo(
    () => [
      columnHelper.accessor((l) => l.code, {
        id: "code",
        header: "Code",
        size: 120,
        filterFn: multiSelect,
        cell: (info) => renderDisplayCell(info, info.row.original.code, "center", "text-blue-600 dark:text-blue-400 font-semibold font-mono"),
      }),
      columnHelper.accessor((l) => l.label, {
        id: "description",
        header: "Staff Role / Operational Scope",
        size: 320,
        filterFn: multiSelect,
        cell: (info) => {
          const line = info.row.original;
          const isStaff = line.entryKind === ENTRY_KIND.StaffRole;
          const overridden = isStaff && typeof line.inputs.rate === "number";
          const cfg = GC_MANUAL_BY_CODE.get(line.code);
          const hint =
            cfg && cfg.entry === "qty"
              ? ` (Rate ${fmtUSD(cfg.rate ?? 0)}/${cfg.unit})`
              : cfg && cfg.entry === "lumpSum" && cfg.pctHint === undefined
              ? " (Lump Sum — enter total $)"
              : "";
          return renderDisplayCell(
            info,
            <span className="font-semibold text-foreground">
              {line.label}
              {hint}
              {cfg?.pctHint !== undefined && (
                <span className="block text-[10px] font-normal text-slate-500 dark:text-slate-400 mt-0.5">
                  Template guidance: {(cfg.pctHint * 100).toFixed(2)}% of estimate — enter the final amount
                </span>
              )}
              {overridden && (
                <span className="block text-[10px] font-normal text-amber-600 dark:text-amber-400 mt-0.5">
                  Project rate override{" "}
                  <button
                    type="button"
                    className="underline font-semibold hover:text-amber-700 dark:hover:text-amber-300 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      const roleKey = resolveRoleKey(line);
                      if (roleKey) commitInputEdit(line.id, "rate", roleKey, num(line.inputs.rate), undefined);
                    }}
                  >
                    Reset
                  </button>
                </span>
              )}
            </span>,
            "left"
          );
        },
      }),
      columnHelper.accessor((l) => GC_ROW_META.get(l.code)?.unit ?? "", {
        id: "unit",
        header: "Unit",
        size: 70,
        filterFn: multiSelect,
        cell: (info) =>
          renderDisplayCell(info, GC_ROW_META.get(info.row.original.code)?.unit ?? "", "center", "text-slate-600 dark:text-slate-400 uppercase text-[10px] font-bold font-mono"),
      }),
      columnHelper.accessor((l) => calcLookupRef.current.get(l.code)?.rate ?? 0, {
        id: "rate",
        header: "Rate",
        size: 120,
        filterFn: multiSelect,
        cell: (info) => {
          const line = info.row.original;
          const calc = calcLookupRef.current.get(line.code);
          const cfg = GC_MANUAL_BY_CODE.get(line.code);
          const roleKey = resolveRoleKey(line);
          // Rate is editable only for staff (project rate override). Operational +
          // qty-manual lines show their card rate read-only; equipment / lumpSum show "—".
          if (roleKey) {
            return renderNumberCell(info, {
              colId: "rate",
              value: calc?.rate ?? 0,
              display: fmtUSD(calc?.rate ?? 0),
              editable: true,
              onCommit: (n) => commitInputEdit(line.id, "rate", roleKey, typeof line.inputs.rate === "number" ? num(line.inputs.rate) : undefined, n),
            });
          }
          const showsRate =
            line.entryKind === ENTRY_KIND.OperationalExpense || (cfg && cfg.entry === "qty");
          return renderDisplayCell(info, showsRate ? fmtUSD(calc?.rate ?? 0) : "—", "center", "text-foreground font-mono");
        },
      }),
      columnHelper.accessor((l) => entryValue(l), {
        id: "entry",
        header: "Utilization / Entry",
        size: 160,
        filterFn: multiSelect,
        cell: (info) => {
          const line = info.row.original;
          if (line.entryKind === ENTRY_KIND.OperationalExpense) {
            return renderDisplayCell(info, "auto", "center", "text-slate-600 dark:text-slate-400 uppercase text-[10px] font-bold font-mono");
          }
          const val = entryValue(line);
          const isStaff = line.entryKind === ENTRY_KIND.StaffRole;
          const display = isStaff ? `${val}%` : fmtUSD(val);
          const tgt = resolveEntryTarget(line);
          const clamp = (n: number) => (isStaff ? Math.max(0, Math.min(100, n)) : Math.max(0, n));
          const onCommit = (n: number) => {
            if (tgt) commitInputEdit(line.id, tgt.target, tgt.key, val, clamp(n));
          };
          return renderNumberCell(info, { colId: "entry", value: val, display, editable: !!tgt, onCommit });
        },
      }),
      columnHelper.accessor((l) => calcLookupRef.current.get(l.code)?.qty ?? 0, {
        id: "calcQty",
        header: "Calculated Qty",
        size: 150,
        filterFn: multiSelect,
        cell: (info) => {
          const line = info.row.original;
          const calc = calcLookupRef.current.get(line.code);
          const hasQty = line.entryKind === ENTRY_KIND.StaffRole || line.entryKind === ENTRY_KIND.OperationalExpense;
          const meta = GC_ROW_META.get(line.code);
          const content =
            line.entryKind === ENTRY_KIND.StaffRole
              ? `${(calc?.qty ?? 0).toFixed(1)} hrs`
              : hasQty
              ? `${(calc?.qty ?? 0).toFixed(2)} ${meta?.unit ?? ""}`
              : "—";
          return renderDisplayCell(info, content, "center", "text-slate-600 dark:text-slate-400 font-semibold font-mono");
        },
      }),
      columnHelper.accessor((l) => calcLookupRef.current.get(l.code)?.total ?? 0, {
        id: "total",
        header: "Total Cost",
        size: 160,
        filterFn: multiSelect,
        cell: (info) => {
          const line = info.row.original;
          const calc = calcLookupRef.current.get(line.code);
          const engineGroup = GC_ROW_META.get(line.code)?.engineGroup ?? "manual";
          const display = (
            <span className="inline-flex items-center justify-center text-emerald-600 dark:text-emerald-400 font-bold font-mono">
              {fmtUSD(calc?.total ?? 0)}
              <EngineLinkBadge nodeId={gcLeafNodeId(engineGroup, line.code, "total")} label={line.label} />
            </span>
          );
          return renderNumberCell(info, {
            colId: "total",
            value: calc?.total ?? 0,
            display,
            editable: !!onSaveOverride,
            onCommit: (n) => commitOverride(line.id, line.code, n),
          });
        },
      }),
    ],
    // selection intentionally excluded (§8 #4); cells read meta.selection live.
    [renderNumberCell, renderDisplayCell, commitInputEdit, commitOverride, onSaveOverride]
  );

  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    state: { columnFilters },
    onColumnFiltersChange: setColumnFilters,
    columnResizeMode: "onChange",
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    filterFns: {
      multiSelect: (row, columnId, filterValue: string[]) => {
        if (!filterValue || filterValue.length === 0) return true;
        return filterValue.includes(String(row.getValue(columnId)));
      },
    },
    meta: {
      editingCellId,
      editingValues,
      setEditingCellId,
      setEditingValues,
      flushEditingBufferRef,
      focusedCellRef,
      focusedCustomCellRef,
      lockedCells,
      // Step 2 cells commit through hook-local fns (commitInputEdit / commitOverride),
      // so the generic edit path is unused here. Present to satisfy GridHostContract.
      handleCellEdit: () => {},
      commitCellEdit: () => {},
      handleKeyDown: (e, rIdx, _type, tbl) => processNav(e, rIdx, "", tbl),
      handleCustomKeyDown: (e, rIdx, colId, tbl) => processNav(e, rIdx, colId, tbl),
      handlePaste: () => {},
      setContextMenu,
      deleteRow: () => {},
      insertManualRow: () => {},
      handleCustomCellEdit: () => {},
      commitCustomCellEdit: () => {},
      selection,
      setSelection,
    },
  });

  // ---------------------------------------------------------------------------
  // Undo / redo — replay the setter with the command's prev/next inverse data.
  // ---------------------------------------------------------------------------
  const handleUndo = useCallback(() => {
    const cmd = history.undo();
    if (!cmd) return;
    if (cmd.type === "EDIT_SECTION_CELL") applyEdit(cmd.target, cmd.key, cmd.prevValue);
    else if (cmd.type === "TOGGLE_SECTION_CELL_LOCK") setLockedCells((prev) => ({ ...prev, [cmd.cellKey]: cmd.prevLocked }));
  }, [history, applyEdit]);

  const handleRedo = useCallback(() => {
    const cmd = history.redo();
    if (!cmd) return;
    if (cmd.type === "EDIT_SECTION_CELL") applyEdit(cmd.target, cmd.key, cmd.nextValue);
    else if (cmd.type === "TOGGLE_SECTION_CELL_LOCK") setLockedCells((prev) => ({ ...prev, [cmd.cellKey]: cmd.nextLocked }));
  }, [history, applyEdit]);

  // ---------------------------------------------------------------------------
  // GridShellConfig — the host projection (group by 01.A–01.F, override ⚑ overlay).
  // ---------------------------------------------------------------------------
  const overridesTrace = personnel.calcResult.overrides;
  const gridConfig = useMemo<GridShellConfig<EstimateSectionLine>>(
    () => ({
      getRowId: (row) => row.id,
      getGroupKey: (row) => GC_ROW_META.get(row.code)?.group ?? "",
      getGroupLabel: (key) => GC_GROUP_LABELS[key as GcGroupKey] ?? key,
      getRowGroupTotal: (row) => calcLookup.get(row.code)?.total ?? 0,
      isRowFlagged: () => false,
      editableColumnIds: STEP2_EDITABLE_COLUMN_IDS,
      centerAlignedColumnIds: STEP2_CENTER_ALIGNED_COLUMN_IDS,
      // A+1 override ⚑ — rendered atop the `total` cell when a type-over is active.
      // Click to revert to the retained computed value (B2-D2 audited set/revert).
      renderCellOverlay: (row, columnId) => {
        if (columnId !== "total") return null;
        const trace = overridesTrace?.[sectionLineTotalOverrideKey(row.id)];
        if (!trace) return null;
        return (
          <button
            type="button"
            data-testid="gc-override-flag"
            onClick={(e) => {
              e.stopPropagation();
              revertOverride(row.id);
            }}
            title={`Overridden — computed ${fmtUSD(trace.computedValue)} → override ${fmtUSD(trace.overrideValue)}. Click to revert to computed.`}
            aria-label="Overridden value — click to revert to computed"
            className="ml-1 inline-flex shrink-0 align-middle text-amber-600 dark:text-amber-400 hover:opacity-70 cursor-pointer"
          >
            <Flag size={11} />
          </button>
        );
      },
    }),
    [calcLookup, overridesTrace, revertOverride]
  );

  return {
    table,
    rows,
    columnDefs: STEP2_COLUMN_DEFS,
    selection,
    contextMenu,
    setContextMenu,
    lockedCells,
    toggleCellLock,
    gridConfig,
    scrollToRowRef,
    handleUndo,
    handleRedo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undoStackSize: history.undoStackSize,
    redoStackSize: history.redoStackSize,
    grandTotal: personnel.totalGCs,
  };
}
