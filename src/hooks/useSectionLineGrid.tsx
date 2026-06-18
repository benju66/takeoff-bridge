"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type { CellContext, ColumnDef, ColumnFiltersState, Table } from "@tanstack/react-table";
import { Flag, Lock } from "lucide-react";
import { NumberCellInput } from "@/components/workspace/NumberCellInput";
import type { GridShellConfig } from "@/components/workspace/GridShell";
import {
  ColumnDefinition,
  ContextMenuState,
  GridSelectionState,
  SectionGridCommand,
} from "@/types";
import type { EstimateSectionLine } from "@/types/db";
import type { OverridePayload } from "@/lib/overrideSetter";
import type { LineOverrideTrace } from "@/lib/calculations";
import { useCommandHistory } from "./useCommandHistory";
import { sectionLineFieldOverrideKey } from "@/lib/sectionLines/ids";
import type { CalcCell, SectionCatalogEntry } from "@/lib/sectionLines/gcGridModel";

/** The overridable section-line fields: the whole line `total` (A+1 type-over) and the
 *  duration/sqft-driven `qty` (B3 — locked-but-overridable derived quantity). */
export type OverrideField = "total" | "qty";

// ---------------------------------------------------------------------------
// useSectionLineGrid — the shared Step-2 / Step-3 grid CORE (Phase B3).
//
// The section-agnostic mechanics extracted from B2's useGcPersonnelGrid so Step 2
// (GC Personnel) and Step 3 (Site Operations) render through ONE uniform surface
// (plan ID-3). The core owns: selection / context-menu / in-session cell locks, an
// undo/redo command history (useCommandHistory<SectionGridCommand>), the click-to-
// toggle cell renderers, keyboard nav, the TanStack instance + the GridHostContract
// `meta`, the per-line type-over commit/revert, and the GridShellConfig (group
// dividers + the override ⚑ overlay).
//
// Each step supplies a leaner `SectionGridSpec` (its display-ordered rows, the
// calc-by-code lookup, its `applyEdit` setter dispatch, its `buildColumns`, and its
// section grouping). It is a VENEER over the step's calc hook — usePersonnelCalculations
// (GC) / useInfrastructureCalculations (Site-Ops) stay the authoritative owners of the
// inputs, the legacy blob snapshots, the A3 dual-write/dual-read, and `calcResult`.
//
// An input edit drives the section setter (`spec.applyEdit`) + pushes an
// EDIT_SECTION_CELL command carrying full inverse data; undo/redo replays the setter
// (both engines are PURE from inputs → a single prev/next value is full-fidelity).
// The per-line type-over (D3 / A+1) is NOT on the undo stack (B2-D2): it is an
// append-only estimate_overrides action recorded via `onSaveOverride`, surfaced as the
// renderCellOverlay ⚑ (set) + a click-to-revert.
//
// §8 invariants (data-table-architecture SKILL) are preserved: click-to-toggle (no
// onDoubleClick), commit-before-unmount via NumberCellInput's own onBlur, cells read
// meta.selection LIVE (never closure), `selection` is NOT in the columns memo deps,
// and keyboard nav uses the single-container owner (useGridKeyboard, in GridShell).
// ---------------------------------------------------------------------------

const fmtUSD = (n: number) =>
  "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtQty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * A heterogeneous section-grid column array. `columnHelper.accessor` infers a specific
 * `TValue` per column (string / number / …), so the array element must accept any
 * `TValue` — this is exactly the shape `useReactTable`'s `columns` option consumes
 * (`ColumnDef<TData, any>[]`). The same pattern useTakeoffWorkbook relies on via inference.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SectionColumnDefs = ColumnDef<EstimateSectionLine, any>[];

/** The shared cell helpers + commit fns handed to a section's `buildColumns`, so a
 *  section authors its columns with identical machinery (no re-implementing the
 *  click-to-toggle select/edit pattern). */
export interface SectionColumnContext {
  /** A numeric cell with the click-to-toggle select→edit pattern. `value` feeds the
   *  editor; `display` is the non-editing content (formatted value + any badges).
   *  `editOnClick` (default true) gates whether clicking an editable cell enters edit
   *  mode — the derived-quantity cell passes `false` so it edits ONLY via the explicit
   *  "Override quantity" gesture (the cell reads as locked). */
  renderNumberCell: (
    info: CellContext<EstimateSectionLine, unknown>,
    opts: {
      colId: string;
      value: number;
      display: React.ReactNode;
      editable: boolean;
      onCommit: (n: number) => void;
      align?: "center" | "left";
      editOnClick?: boolean;
    }
  ) => React.ReactNode;
  /** A read-only display cell (code / label / unit / auto entry / non-editable rate). */
  renderDisplayCell: (
    info: CellContext<EstimateSectionLine, unknown>,
    content: React.ReactNode,
    align: "left" | "center",
    extraClass?: string
  ) => React.ReactNode;
  /** Commit an input edit: pushes the command BEFORE driving the setter (guardrail). */
  commitInputEdit: (
    lineId: string,
    target: string,
    key: string,
    prevValue: number | undefined,
    nextValue: number | undefined
  ) => void;
  /** Commit a per-line override (D3) on a field — an append-only override action, NOT a
   *  command. `field` is `"total"` (the type-over) or `"qty"` (the derived-quantity override). */
  commitFieldOverride: (lineId: string, field: OverrideField, code: string, nextValue: number) => void;
  /** True when a `line:<id>:<field>` override is currently recorded (drives the lock vs ⚑). */
  isFieldOverridden: (lineId: string, field: OverrideField) => boolean;
  /** Renders the shared DERIVED-quantity cell (locked, with a lock glyph; overridable via the
   *  gesture). Both Step 2 (staff/operational) and Step 3 (dynamic) use it verbatim → one visual. */
  renderDerivedQtyCell: (info: CellContext<EstimateSectionLine, unknown>) => React.ReactNode;
  /** Live ref to the calc-by-code lookup (read `.current` at render → always fresh). */
  calcLookupRef: React.MutableRefObject<Map<string, CalcCell>>;
  /** Whether an override is possible (i.e. the page passed an `onSaveOverride`). */
  canOverride: boolean;
  /** Live ref to project square footage — the Cost/S.F. column divides each line total
   *  by `.current` (read at render → fresh without recomputing the columns memo). */
  squareFootageRef: React.MutableRefObject<number>;
  /** Assign / re-assign a one-off line's resolved Procore code + cost type (B5 / D1). The
   *  Code column's `OneOffCodeCell` calls this for an estimator-authored one-off row; it
   *  pushes the undoable ASSIGN_ONE_OFF_CODE command (prev captured from the line). */
  assignOneOff: (line: EstimateSectionLine, procoreCode: string, costType: string) => void;
}

/** How a step specializes the shared grid core. */
export interface SectionGridSpec {
  columnDefs: ColumnDefinition[];
  editableColumnIds: readonly string[];
  centerAlignedColumnIds: readonly string[];
  /** Display-ordered section lines (e.g. GC 01.A–01.F / Site-Ops 02.A–02.H). */
  rows: EstimateSectionLine[];
  /** Per-row computed numbers, joined by `code`. */
  calcLookup: Map<string, CalcCell>;
  /** The active line type-over trace (from calcResult.overrides) — drives the ⚑ overlay. */
  overridesTrace?: LineOverrideTrace;
  grandTotal: number;
  /** Drives the matching calc-hook setter for an EDIT_SECTION_CELL `target`/`key`. */
  applyEdit: (target: string, key: string, value: number | undefined) => void;
  /** Builds the TanStack columns using the shared cell helpers + commit fns. */
  buildColumns: (ctx: SectionColumnContext) => SectionColumnDefs;
  /** Section-divider grouping (stable references → keeps the gridConfig memo cheap). */
  getGroupKey: (row: EstimateSectionLine) => string;
  getGroupLabel: (key: string) => string;
  /** Project square footage — threaded into the Cost/S.F. column. */
  squareFootage: number;
  /** True for a line whose Quantity is derived (duration/sqft-driven) → locked-but-
   *  overridable. The host uses it to offer "Override quantity" on a right-clicked
   *  Quantity cell. Manual/lump lines return false (their quantity is a direct input). */
  isDerivedQtyLine: (row: EstimateSectionLine) => boolean;
  /** The full section catalog (B4 / D2) — the universe a removed line can be re-added
   *  from. The core computes `removedLines` = catalog − present for the "+ Add line" picker. */
  catalog: readonly SectionCatalogEntry[];
  /** Removes a catalog line by `code` from the active set (drives the calc hook's
   *  `removeLine`). Bespoke structured lines are removable but not re-inventable (ID-4). */
  applyRemove: (code: string) => void;
  /** Re-adds a removed catalog line by `code` (drives the calc hook's `restoreLine`). */
  applyRestore: (code: string) => void;
  /** Appends a one-off line (B5 / D1) — drives the calc hook's `addOneOff`. */
  applyAddOneOff: (line: EstimateSectionLine) => void;
  /** Removes a one-off line (B5 / D1) — drives the calc hook's `removeOneOff(line.id)`. */
  applyRemoveOneOff: (line: EstimateSectionLine) => void;
  /** Assigns a one-off's resolved Procore code + cost type (B5 / D1) — drives `assignOneOffCode`. */
  applyAssignOneOffCode: (id: string, procoreCode: string, costType: string) => void;
}

export interface UseSectionLineGridReturn {
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
  /** True for a line whose Quantity is derived (duration/sqft-driven). */
  isDerivedQtyLine: (row: EstimateSectionLine) => boolean;
  /** The catalog lines currently REMOVED (catalog − present), for the "+ Add line" picker
   *  (B4 / D2). Display-ordered + carrying section group labels for grouping. */
  removedLines: readonly SectionCatalogEntry[];
  /** Remove a present catalog line (B4 / D2) — undoable (REMOVE_SECTION_LINE command). */
  removeLine: (line: EstimateSectionLine) => void;
  /** Re-add a removed catalog line by `code` (B4 / D2) — undoable (ADD_SECTION_LINE command). */
  restoreLine: (code: string) => void;
  /** Append a new one-off line (B5 / D1) — undoable (ADD_ONE_OFF_LINE command). */
  addOneOff: (line: EstimateSectionLine) => void;
  /** Remove a one-off line (B5 / D1) — undoable (REMOVE_ONE_OFF_LINE command). */
  removeOneOff: (line: EstimateSectionLine) => void;
  /** Assign / re-assign a one-off's resolved Procore code + cost type (B5 / D1) — undoable
   *  (ASSIGN_ONE_OFF_CODE command; prev values captured from `line`). */
  assignOneOffCode: (line: EstimateSectionLine, procoreCode: string, costType: string) => void;
  /** True when this line's derived Quantity currently carries an audited override. */
  isQtyOverridden: (rowId: string) => boolean;
  /** Begin a Quantity override (the "Override quantity" gesture) — unlocks the cell for edit. */
  beginQtyOverride: (rowId: string) => void;
  /** Revert a Quantity override back to the computed (duration/sqft-driven) value. */
  revertQtyOverride: (rowId: string) => void;
}

export function useSectionLineGrid(
  spec: SectionGridSpec,
  onSaveOverride?: (payload: OverridePayload) => Promise<void>,
): UseSectionLineGridReturn {
  const { rows, grandTotal } = spec;

  // Live refs so the columns memo never depends on per-edit-changing values
  // (cell renderers read .current at render → always fresh, cell identity stable).
  const calcLookup = spec.calcLookup;
  const calcLookupRef = useRef(calcLookup);
  calcLookupRef.current = calcLookup;
  const overridesTrace = spec.overridesTrace;
  const overridesTraceRef = useRef(overridesTrace);
  overridesTraceRef.current = overridesTrace;
  const applyEditRef = useRef(spec.applyEdit);
  applyEditRef.current = spec.applyEdit;
  const applyRemoveRef = useRef(spec.applyRemove);
  applyRemoveRef.current = spec.applyRemove;
  const applyRestoreRef = useRef(spec.applyRestore);
  applyRestoreRef.current = spec.applyRestore;
  const applyAddOneOffRef = useRef(spec.applyAddOneOff);
  applyAddOneOffRef.current = spec.applyAddOneOff;
  const applyRemoveOneOffRef = useRef(spec.applyRemoveOneOff);
  applyRemoveOneOffRef.current = spec.applyRemoveOneOff;
  const applyAssignOneOffCodeRef = useRef(spec.applyAssignOneOffCode);
  applyAssignOneOffCodeRef.current = spec.applyAssignOneOffCode;
  const editableColumnIdsRef = useRef(spec.editableColumnIds);
  editableColumnIdsRef.current = spec.editableColumnIds;
  const squareFootageRef = useRef(spec.squareFootage);
  squareFootageRef.current = spec.squareFootage;
  const isDerivedQtyLine = spec.isDerivedQtyLine;

  const canOverride = !!onSaveOverride;

  // Selection + context menu + in-session cell locks (B2-D3: not persisted).
  const [selection, setSelection] = useState<GridSelectionState>({ rowId: null, columnId: null, isEditing: false });
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0, rowIndex: -1, columnId: "" });
  const [lockedCells, setLockedCells] = useState<Record<string, boolean>>({});
  const lockedCellsRef = useRef(lockedCells);
  lockedCellsRef.current = lockedCells;

  const history = useCommandHistory<SectionGridCommand>();

  const scrollToRowRef = useRef<((index: number) => void) | undefined>(undefined);

  // Contract editing buffers (unused by the section grids — NumberCellInput owns its
  // own buffer + commit-on-blur — but required by GridHostContract).
  const [editingCellId, setEditingCellId] = useState<string | null>(null);
  const [editingValues, setEditingValues] = useState<Record<string, string>>({});
  const flushEditingBufferRef = useRef<() => void>(() => {});
  const focusedCellRef = useRef<{ rowId: string; field: string; initialValue: string | number | boolean } | null>(null);
  const focusedCustomCellRef = useRef<{ rowId: string; columnId: string; initialValue: string } | null>(null);

  // ---------------------------------------------------------------------------
  // Command apply / commit (stable — read the section setter via ref so identity holds)
  // ---------------------------------------------------------------------------
  /** Commit an input edit: push the command BEFORE driving the setter (guardrail). */
  const commitInputEdit = useCallback(
    (lineId: string, target: string, key: string, prevValue: number | undefined, nextValue: number | undefined) => {
      if (prevValue === nextValue) return;
      history.pushCommand({ type: "EDIT_SECTION_CELL", lineId, target, key, prevValue, nextValue });
      applyEditRef.current(target, key, nextValue);
    },
    [history]
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

  // Remove / re-add a catalog line (B4 / D2). Push the command BEFORE driving the section
  // dispatcher (guardrail); the REMOVE command snapshots the removed line for inverse
  // fidelity (AGENTS.md). The calc hook preserves the removed line's blob inputs, so a
  // re-add restores it with its prior values — `code` alone is full inverse data.
  const removeLine = useCallback(
    (line: EstimateSectionLine) => {
      history.pushCommand({ type: "REMOVE_SECTION_LINE", code: line.code, line });
      applyRemoveRef.current(line.code);
    },
    [history]
  );
  const restoreLine = useCallback(
    (code: string) => {
      history.pushCommand({ type: "ADD_SECTION_LINE", code });
      applyRestoreRef.current(code);
    },
    [history]
  );

  // One-off lines (B5 / D1). Push the command BEFORE driving the section dispatcher
  // (guardrail); each command snapshots full inverse data (AGENTS.md compounding-history):
  // ADD/REMOVE carry the whole line (id = code = engine key + typed inputs + assigned code),
  // ASSIGN carries prev/next code+type.
  const addOneOff = useCallback(
    (line: EstimateSectionLine) => {
      history.pushCommand({ type: "ADD_ONE_OFF_LINE", line });
      applyAddOneOffRef.current(line);
    },
    [history]
  );
  const removeOneOff = useCallback(
    (line: EstimateSectionLine) => {
      history.pushCommand({ type: "REMOVE_ONE_OFF_LINE", line });
      applyRemoveOneOffRef.current(line);
    },
    [history]
  );
  const assignOneOffCode = useCallback(
    (line: EstimateSectionLine, procoreCode: string, costType: string) => {
      if (line.procoreCode === procoreCode && line.costType === costType) return; // no-op re-assign
      history.pushCommand({
        type: "ASSIGN_ONE_OFF_CODE",
        id: line.id,
        prevProcoreCode: line.procoreCode,
        prevCostType: line.costType,
        nextProcoreCode: procoreCode,
        nextCostType: costType,
      });
      applyAssignOneOffCodeRef.current(line.id, procoreCode, costType);
    },
    [history]
  );

  // Per-line overrides (D3) — append-only override actions, NOT commands. `field` is
  // "total" (the type-over A+1 built) or "qty" (the B3 derived-quantity override). The
  // retained computed value is that field's computed value (total / qty) from the result.
  const commitFieldOverride = useCallback(
    (lineId: string, field: OverrideField, code: string, nextValue: number) => {
      if (!onSaveOverride) return;
      const key = sectionLineFieldOverrideKey(lineId, field);
      const trace = overridesTraceRef.current?.[key];
      const computedValue = trace
        ? trace.computedValue
        : field === "total"
        ? (calcLookupRef.current.get(code)?.total ?? 0)
        : (calcLookupRef.current.get(code)?.qty ?? 0);
      if (trace && trace.overrideValue === nextValue) return; // no-op re-type
      onSaveOverride({ field: key, computedValue, overrideValue: nextValue, reason: "" }).catch((err) =>
        console.error("Failed to record section line override:", err)
      );
    },
    [onSaveOverride]
  );

  const revertFieldOverride = useCallback(
    (lineId: string, field: OverrideField) => {
      if (!onSaveOverride) return;
      const key = sectionLineFieldOverrideKey(lineId, field);
      const trace = overridesTraceRef.current?.[key];
      if (!trace) return;
      onSaveOverride({ field: key, computedValue: trace.computedValue, overrideValue: null, reason: "" }).catch((err) =>
        console.error("Failed to revert section line override:", err)
      );
    },
    [onSaveOverride]
  );

  const isFieldOverridden = useCallback(
    (lineId: string, field: OverrideField) => !!overridesTraceRef.current?.[sectionLineFieldOverrideKey(lineId, field)],
    []
  );

  // The "Override quantity" gesture (B3): right-click a locked derived-Quantity cell →
  // unlock it for an in-place edit (set the cell editing), whose commit records a `:qty`
  // override. The cell renders read-only otherwise (editOnClick=false), so a plain click
  // never edits it — only this explicit gesture does. Revert returns to the computed value.
  const beginQtyOverride = useCallback((rowId: string) => {
    setSelection({ rowId, columnId: "quantity", isEditing: true });
  }, []);
  const revertQtyOverride = useCallback((rowId: string) => revertFieldOverride(rowId, "qty"), [revertFieldOverride]);
  const isQtyOverridden = useCallback((rowId: string) => isFieldOverridden(rowId, "qty"), [isFieldOverridden]);

  // ---------------------------------------------------------------------------
  // Keyboard navigation — the section-grid copy of useKeyboardNavigation, specialized
  // to the section columns / input-id scheme / editable set + the section-line rows.
  // Routed through meta.handleCustomKeyDown (free string columnId), so it sidesteps
  // the fixed GridCellKind union the augmented TableMeta carries.
  // ---------------------------------------------------------------------------
  const processNav = useCallback(
    (e: React.KeyboardEvent, rIdx: number, columnId: string, table: Table<EstimateSectionLine>) => {
      const isColumnEditable = (colId: string) => (editableColumnIdsRef.current as readonly string[]).includes(colId);
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
  // Cell renderers (the click-to-toggle select/edit pattern, §3). Read meta.selection
  // LIVE from the table; never from closure.
  // ---------------------------------------------------------------------------
  const renderNumberCell = useCallback<SectionColumnContext["renderNumberCell"]>(
    (info, opts): React.ReactNode => {
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

      const editOnClick = opts.editOnClick !== false;
      const editAffordance = editable && editOnClick ? "cursor-text hover:bg-blue-50/50 dark:hover:bg-blue-950/10" : "cursor-default";
      const selectedClass = isSelected ? "outline outline-2 outline-blue-600 outline-offset-[-2px] bg-blue-50/10 dark:bg-blue-900/10 z-10 relative" : "";
      return (
        <div
          id={`cell-${rowId}-${colId}`}
          className={`w-full h-full min-h-[36px] px-3 py-2 flex items-center justify-center ${alignClass} font-mono text-xs text-foreground ${editAffordance} ${selectedClass} ${locked ? "opacity-60 cursor-not-allowed" : ""}`}
          onClick={() => {
            // editOnClick=false (derived-quantity cell) never enters edit mode on click —
            // it unlocks only via the explicit "Override quantity" gesture (which sets editing).
            if (isSelected && editable && editOnClick) meta.setSelection({ rowId, columnId: colId, isEditing: true });
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

  const renderDisplayCell = useCallback<SectionColumnContext["renderDisplayCell"]>(
    (info, content, align, extraClass = ""): React.ReactNode => {
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
  // Columns — delegated to the section's `buildColumns`, given the shared helpers.
  // `selection` is intentionally NOT a dep (§8 #4); cells read meta.selection live.
  // ---------------------------------------------------------------------------
  // The shared DERIVED-quantity cell — locked (a lock glyph), overridable via the gesture.
  // Centralized here so Step 2 (staff/operational) and Step 3 (dynamic) read identically.
  const renderDerivedQtyCell = useCallback(
    (info: CellContext<EstimateSectionLine, unknown>): React.ReactNode => {
      const line = info.row.original;
      const calc = calcLookupRef.current.get(line.code);
      const overridden = !!overridesTraceRef.current?.[sectionLineFieldOverrideKey(line.id, "qty")];
      const display = (
        <span className={`inline-flex items-center gap-1 font-mono ${overridden ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-slate-600 dark:text-slate-400"}`}>
          {fmtQty(calc?.qty ?? 0)}
          {!overridden && <Lock size={9} className="opacity-40" />}
        </span>
      );
      return renderNumberCell(info, {
        colId: "quantity",
        value: calc?.qty ?? 0,
        display,
        editable: canOverride,
        editOnClick: false, // locked: edits only via the "Override quantity" gesture
        onCommit: (n) => commitFieldOverride(line.id, "qty", line.code, Math.max(0, n)),
      });
    },
    [renderNumberCell, commitFieldOverride, canOverride]
  );

  const buildColumns = spec.buildColumns;
  const columns = useMemo(
    () => buildColumns({ renderNumberCell, renderDisplayCell, commitInputEdit, commitFieldOverride, isFieldOverridden, renderDerivedQtyCell, calcLookupRef, canOverride, squareFootageRef, assignOneOff: assignOneOffCode }),
    [buildColumns, renderNumberCell, renderDisplayCell, commitInputEdit, commitFieldOverride, isFieldOverridden, renderDerivedQtyCell, canOverride, assignOneOffCode]
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
      // Section cells commit through core-local fns (commitInputEdit / commitOverride),
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
    if (cmd.type === "EDIT_SECTION_CELL") applyEditRef.current(cmd.target, cmd.key, cmd.prevValue);
    else if (cmd.type === "TOGGLE_SECTION_CELL_LOCK") setLockedCells((prev) => ({ ...prev, [cmd.cellKey]: cmd.prevLocked }));
    else if (cmd.type === "REMOVE_SECTION_LINE") applyRestoreRef.current(cmd.code); // undo a removal = re-add
    else if (cmd.type === "ADD_SECTION_LINE") applyRemoveRef.current(cmd.code); // undo a re-add = remove
    else if (cmd.type === "ADD_ONE_OFF_LINE") applyRemoveOneOffRef.current(cmd.line); // undo add = remove
    else if (cmd.type === "REMOVE_ONE_OFF_LINE") applyAddOneOffRef.current(cmd.line); // undo remove = re-add
    else if (cmd.type === "ASSIGN_ONE_OFF_CODE") applyAssignOneOffCodeRef.current(cmd.id, cmd.prevProcoreCode, cmd.prevCostType);
  }, [history]);

  const handleRedo = useCallback(() => {
    const cmd = history.redo();
    if (!cmd) return;
    if (cmd.type === "EDIT_SECTION_CELL") applyEditRef.current(cmd.target, cmd.key, cmd.nextValue);
    else if (cmd.type === "TOGGLE_SECTION_CELL_LOCK") setLockedCells((prev) => ({ ...prev, [cmd.cellKey]: cmd.nextLocked }));
    else if (cmd.type === "REMOVE_SECTION_LINE") applyRemoveRef.current(cmd.code);
    else if (cmd.type === "ADD_SECTION_LINE") applyRestoreRef.current(cmd.code);
    else if (cmd.type === "ADD_ONE_OFF_LINE") applyAddOneOffRef.current(cmd.line);
    else if (cmd.type === "REMOVE_ONE_OFF_LINE") applyRemoveOneOffRef.current(cmd.line);
    else if (cmd.type === "ASSIGN_ONE_OFF_CODE") applyAssignOneOffCodeRef.current(cmd.id, cmd.nextProcoreCode, cmd.nextCostType);
  }, [history]);

  // ---------------------------------------------------------------------------
  // GridShellConfig — the host projection (section grouping + override ⚑ overlay).
  // ---------------------------------------------------------------------------
  const getGroupKey = spec.getGroupKey;
  const getGroupLabel = spec.getGroupLabel;
  const editableColumnIds = spec.editableColumnIds;
  const centerAlignedColumnIds = spec.centerAlignedColumnIds;
  const gridConfig = useMemo<GridShellConfig<EstimateSectionLine>>(
    () => ({
      getRowId: (row) => row.id,
      getGroupKey,
      getGroupLabel,
      getRowGroupTotal: (row) => calcLookup.get(row.code)?.total ?? 0,
      isRowFlagged: () => false,
      editableColumnIds,
      centerAlignedColumnIds,
      // Override ⚑ — rendered atop the `total` cell (A+1 type-over) AND the `quantity`
      // cell (B3 derived-quantity override) when an override is active. Click to revert
      // to the retained computed value (audited set/revert; the qty/total formatting differs).
      renderCellOverlay: (row, columnId) => {
        const field: OverrideField | null = columnId === "total" ? "total" : columnId === "quantity" ? "qty" : null;
        if (!field) return null;
        const trace = overridesTrace?.[sectionLineFieldOverrideKey(row.id, field)];
        if (!trace) return null;
        const fmt = field === "total" ? fmtUSD : (n: number) => n.toLocaleString();
        return (
          <button
            type="button"
            data-testid={field === "qty" ? "section-qty-override-flag" : "section-override-flag"}
            onClick={(e) => {
              e.stopPropagation();
              revertFieldOverride(row.id, field);
            }}
            title={`Overridden — computed ${fmt(trace.computedValue)} → override ${fmt(trace.overrideValue)}. Click to revert to computed.`}
            aria-label="Overridden value — click to revert to computed"
            className="absolute top-0.5 right-1 z-20 inline-flex shrink-0 text-amber-600 dark:text-amber-400 hover:opacity-70 cursor-pointer"
          >
            <Flag size={11} />
          </button>
        );
      },
    }),
    [calcLookup, overridesTrace, revertFieldOverride, getGroupKey, getGroupLabel, editableColumnIds, centerAlignedColumnIds]
  );

  // The catalog lines currently REMOVED (catalog − present) — the "+ Add line" picker's
  // contents (B4 / D2). `spec.catalog` is display-ordered, so removedLines is too.
  const catalog = spec.catalog;
  const removedLines = useMemo(() => {
    const present = new Set(rows.map((r) => r.code));
    return catalog.filter((c) => !present.has(c.code));
  }, [catalog, rows]);

  return {
    table,
    rows,
    columnDefs: spec.columnDefs,
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
    grandTotal,
    isDerivedQtyLine,
    removedLines,
    removeLine,
    restoreLine,
    addOneOff,
    removeOneOff,
    assignOneOffCode,
    isQtyOverridden,
    beginQtyOverride,
    revertQtyOverride,
  };
}

export { fmtUSD as fmtSectionUSD };
