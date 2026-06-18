import type { Binding } from "@/lib/bindings/types";

export interface TogalRowPayload {
  Classification: string;
  "Quantity 1": string | number;
  "Quantity1 UOM"?: string;
  "Quantity 2"?: string | number;
  "Quantity2 UOM"?: string;
  "Quantity 3"?: string | number;
  "Quantity3 UOM"?: string;
}

export interface InternalEstimateItem {
  itemId: string;          // e.g., "04-0000.001"
  procoreParentCode: string; // e.g., "4-40000.000" (coarse division parent, back-compat)
  procoreCode: string;     // e.g., "4-40000.000" granular Budget Line Items code
  description: string;
  targetUom: string;       // e.g., "SF", "FT", "EA"
  defaultUnitPrice: number;
  costType: string;        // "M" (Materials), "S" (Subcontract), "L" (Labor), "E" (Equipment)
}

export interface ProcessedTakeoffRow {
  id: string;
  classification: string;
  itemId: string;
  procoreParentCode: string;
  /** Granular Procore Budget Line Items code (e.g., "3-33543.000"); "" when unmapped */
  procoreCode: string;
  description: string;
  matchedQty: number;
  uom: string;
  unitPrice: number;
  total: number;
  isMapped: boolean;
  // Raw quantities extracted from CSV to enable dynamic target UOM re-matching
  rawQuantities: { qty: number; uom: string }[];
  costType: string;        // Dynamic costType mapped from InternalEstimateItem
  customFields?: Record<string, string | number>;
  dataFidelity?: 'discrete_unit' | 'macro_lump_sum';
  /** Cost code extracted from classification string (e.g., "03-0000.002" from "03-0000.002 - Footings") */
  embeddedCode?: string;
  /**
   * Provenance tracking: where this row originated. `'imported'` = a line read
   * from a finished company-template estimate via the "Import past bids" flow
   * (importEstimate.ts). Imported lines are individually authored, so they are
   * cascade-INDEPENDENT (see src/lib/cascade.ts) — editing one never rewrites a
   * sibling sharing its code/classification.
   */
  source?: 'template' | 'csv_import' | 'manual' | 'ai_suggestion' | 'imported';
  /**
   * Fail-loud flag (Phase 3 / INV-8): set when an imported quantity was genuinely
   * ambiguous (e.g. European format) and was therefore NOT trusted (forced to 0) rather
   * than silently coerced to a wrong positive number. The import override surface
   * (ImportPreviewModal) shows a "Review #" badge so a human resolves it before confirm.
   */
  needsReview?: boolean;
}

// ---------------------------------------------------------------------------
// Estimate Overrides (Phase 4 — Override + Audit Model)
// ---------------------------------------------------------------------------

/**
 * One immutable override-audit record (an `estimate_overrides` row). An estimator
 * override layers `overrideValue` IN PLACE of the engine's `computedValue` while the
 * computed value is always retained (the glass-box UI, Phase 5, shows both). The table
 * is append-only: a "set" and a later "revert" are two rows; the LATEST row per
 * (projectId, field) wins. `overrideValue: null` is a REVERT tombstone (the field falls
 * back to computed). An `overrideValue` of `0` is a REAL override (INV-3: explicit zero
 * is honored, never confused with "no override").
 */
export interface EstimateOverrideRecord {
  /** Present on rows read back from the DB; omit when constructing a new event. */
  id?: string;
  projectId: string;
  /** The overridden computed value — a TakeoffSummary key (see OVERRIDABLE_SUMMARY_FIELDS). */
  field: string;
  /** Engine value at the time of the override (audit trail; null if unknown). */
  computedValue: number | null;
  /** Value used in place of computed; null = revert tombstone (back to computed). */
  overrideValue: number | null;
  reason: string;
  /** auth.uid() of who recorded it; null if that user was later removed. */
  createdBy?: string | null;
  /** ISO timestamp; the latest per (projectId, field) is the active override. */
  createdAt: string;
}

/**
 * Resolved ACTIVE overrides fed to the engine: field → effective override value.
 * Only currently-active (non-reverted) overrides appear; produced by
 * reduceLatestActiveOverrides() (src/lib/overrides.ts) and passed as the optional
 * trailing argument of computeTakeoffSummary().
 */
export type EstimateOverrideMap = Record<string, number>;

// ---------------------------------------------------------------------------
// Shared Workspace Interfaces (canonicalized from page.tsx + exporter.ts)
// ---------------------------------------------------------------------------

/** Column definition for dynamic workspace grids and export pipeline */
export interface ColumnDefinition {
  id: string;
  header: string;
  type: "default" | "custom";
  /** Number of decimal places for numeric display. Default: 2 for currency, 2 for quantities. */
  decimalPlaces?: number;
  /** Column width in pixels. Falls back to DEFAULT_COLUMN_SIZES[id] or 150. */
  size?: number;
  /** Minimum column width for resize. */
  minSize?: number;
  /** Maximum column width for resize. */
  maxSize?: number;
}

/** Context menu floating state for grid right-click interactions */
export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  rowIndex: number;
  columnId: string;
}

/** Divisional budget aggregation for analytics display */
export interface DivisionAggregation {
  code: string;
  name: string;
  total: number;
  percentage: number;
}

/** Cost type budget aggregation (Materials/Labor/Subcontract) */
export interface CostTypeAggregation {
  key: string;
  label: string;
  total: number;
  percentage: number;
}

// ---------------------------------------------------------------------------
// Constrained String Unions
// ---------------------------------------------------------------------------

/** Known cost type codes used in the estimation engine */
export type CostType = 'M' | 'L' | 'S';

/** Known units of measure — union with string to accept unknown UOMs from CSVs */
export type UnitOfMeasure = 'SF' | 'LF' | 'EA' | 'LS' | 'CF' | 'CY' | 'SY' | 'GAL' | 'TON' | 'HR' | 'MO' | 'DAY' | 'WK';

// ---------------------------------------------------------------------------
// WorkbookCommand — Discriminated union of all undoable commands
// (Canonical location — imported by useCommandHistory.ts)
// ---------------------------------------------------------------------------

export interface EditCellCommand {
  type: "EDIT_CELL";
  rowId: string;
  field: keyof ProcessedTakeoffRow;
  prevValue: string | number | boolean;
  nextValue: string | number | boolean;
  /**
   * Cascade side-effects applied on undo/redo after cmd.field is set.
   * Entries may target sibling rows (itemId/description/unitPrice cascades)
   * or the edited row itself (self-cascades: itemId derived-field capture,
   * uom matchedQty/total capture) — dispatch merges them by rowId.
   */
  cascadeEffects?: Array<{
    rowId: string;
    prevFields: Partial<ProcessedTakeoffRow>;
    nextFields: Partial<ProcessedTakeoffRow>;
  }>;
  /** Registry write side-effects for undo/redo persistence */
  registryDelta?: {
    projectRegistry?: { key: string; prevValue: string; nextValue: string };
    globalRegistry?: { key: string; prevValue: string; nextValue: string };
  };
  /** Row relocation when an itemId edit changes the division — enables atomic undo */
  moveEffect?: {
    moves: { rowId: string; fromIndex: number; toIndex: number }[];
  };
}

export interface EditCustomCellCommand {
  type: "EDIT_CUSTOM_CELL";
  rowId: string;
  columnId: string;
  prevValue: string;
  nextValue: string;
}

export interface PasteCommand {
  type: "PASTE";
  /** Ordered list of atomic sub-edits grouped as a single undo unit */
  edits: Array<{
    rowId: string;
    field: keyof ProcessedTakeoffRow;
    prevFields: Partial<ProcessedTakeoffRow>;
    nextFields: Partial<ProcessedTakeoffRow>;
  }>;
  registryDelta?: {
    projectRegistry?: Record<string, { prev: string; next: string }>;
    globalRegistry?: Record<string, { prev: string; next: string }>;
  };
}

export interface InsertRowCommand {
  type: "INSERT_ROW";
  rowId: string;
  insertIndex: number;
  rowData: ProcessedTakeoffRow;
}

export interface DeleteColumnCommand {
  type: "DELETE_COLUMN";
  columnDef: ColumnDefinition;
  columnIndex: number;
  /** Snapshot of all custom field values for this column across rows */
  cellValues: Record<string, string | number>;
}

export interface AddColumnCommand {
  type: "ADD_COLUMN";
  columnDef: ColumnDefinition;
}

export interface ToggleCellLockCommand {
  type: "TOGGLE_CELL_LOCK";
  cellKey: string;
  prevLocked: boolean;
  nextLocked: boolean;
}

export interface MergeTakeoffDataCommand {
  type: "MERGE_TAKEOFF_DATA";
  /** Full row-level diff: previous field values for all rows that changed */
  prevRowStates: Array<{
    rowId: string;
    fields: Partial<ProcessedTakeoffRow>;
  }>;
  nextRowStates: Array<{
    rowId: string;
    fields: Partial<ProcessedTakeoffRow>;
  }>;
  prevUnmapped: string[];
  nextUnmapped: string[];
  /**
   * Phase 3 / INV-8 (#3 no silent row drop): full rows that were APPENDED to the grid by
   * this merge because they carry a valid itemId absent from the template (targetIdx === -1).
   * They ride on the SAME command so one undo removes them and one redo re-adds them
   * (AGENTS.md compounding-history). Distinct from prev/nextRowStates, which only diff rows
   * that already existed. Optional for back-compat with commands that appended nothing.
   */
  appendedRows?: ProcessedTakeoffRow[];
  /**
   * Phase 3 / INV-8 (#3): rows REMOVED by this merge — in replace mode, prior off-template
   * imported rows (source 'csv_import') are discarded so they don't linger as phantom blank
   * $0 rows. Symmetric to appendedRows: removed on redo, re-added on undo. Optional.
   */
  removedRows?: ProcessedTakeoffRow[];
}

export interface DeleteRowCommand {
  type: "DELETE_ROW";
  rowId: string;
  deletedIndex: number;
  /** Deep-cloned snapshot of the full row data for undo restoration (GAP-3) */
  rowData: ProcessedTakeoffRow;
}

export interface UpdateColumnCommand {
  type: "UPDATE_COLUMN";
  columnId: string;
  prevDef: ColumnDefinition;
  nextDef: ColumnDefinition;
}

/**
 * Linked Values System Phase 4 — create/replace a binding on a target node, undoably.
 * Carries the FULL prev/next binding so undo restores the exact prior state (prev=null
 * when the target had no binding → undo deletes it). `Binding` is pure data (no
 * functions), so the command stays serializable on the history stack.
 */
export interface SetBindingCommand {
  type: "SET_BINDING";
  targetNodeId: string;
  prevBinding: Binding | null;
  nextBinding: Binding;
}

/** Linked Values System Phase 4 — clear the binding on a target node, undoably. */
export interface ClearBindingCommand {
  type: "CLEAR_BINDING";
  targetNodeId: string;
  /** The binding being removed — re-applied verbatim on undo. */
  prevBinding: Binding;
}

export type WorkbookCommand =
  | EditCellCommand
  | EditCustomCellCommand
  | PasteCommand
  | InsertRowCommand
  | DeleteRowCommand
  | DeleteColumnCommand
  | AddColumnCommand
  | ToggleCellLockCommand
  | MergeTakeoffDataCommand
  | UpdateColumnCommand
  | SetBindingCommand
  | ClearBindingCommand;

// ---------------------------------------------------------------------------
// GcGridCommand — the Step-2 (GC Personnel) grid's undo/redo payloads (B2).
//
// Step 2's grid is backed by `EstimateSectionLine` rows, not `ProcessedTakeoffRow`,
// so it carries its OWN command union rather than widening WorkbookCommand with
// foreign-row-typed variants. Consumed by useGcPersonnelGrid via the generic
// useCommandHistory<GcGridCommand>. Each command holds FULL inverse data
// (AGENTS.md compounding-history): the GC engine is PURE from inputs, so a single
// prev/next input value is full-fidelity — every derived qty/total recomputes
// from it, no cascade snapshot needed.
//
// NOTE: the per-line type-over (D3 / Phase A+1) is deliberately NOT a command — it
// is an append-only `estimate_overrides` audit action with its own set/revert
// affordance (B2-D2), so it never enters this undo stack.
// ---------------------------------------------------------------------------

/**
 * A single Step-2 input edit: a utilization %, a staff rate override, an
 * equipment lump sum, or a manual GC entry. `target` selects which
 * usePersonnelCalculations setter the dispatcher drives; `key` is the catalog
 * config key (role/equipment/manual key) the setter expects. A `prevValue` of
 * `undefined` for a `rate` edit means "no override existed" → undo calls
 * `resetRate` (clears the override) rather than setting a number.
 */
export interface EditSectionCellCommand {
  type: "EDIT_SECTION_CELL";
  lineId: string;
  target: "utilization" | "rate" | "equipment" | "manual";
  key: string;
  prevValue: number | undefined;
  nextValue: number | undefined;
}

/** Toggle a Step-2 cell lock (in-session only for B2 — not persisted). */
export interface ToggleSectionCellLockCommand {
  type: "TOGGLE_SECTION_CELL_LOCK";
  cellKey: string;
  prevLocked: boolean;
  nextLocked: boolean;
}

export type GcGridCommand =
  | EditSectionCellCommand
  | ToggleSectionCellLockCommand;

export interface GridSelectionState {
  rowId: string | null;
  columnId: string | null;
  isEditing: boolean;
  initialEditChar?: string | null;
}

// ---------------------------------------------------------------------------
// Grid host contract (B1b) — the generalized vocabulary every grid-host hook
// exposes to the shared GridShell + decoration/Trust layer via table.options.meta.
//
// Step 4's useTakeoffWorkbook is the SOLE consumer today; Steps 2/3 will implement
// this same shape with their own leaner state+command hooks (Track B). It generalizes
// the former Step-4-specific TableMeta vocabulary: `keyof ProcessedTakeoffRow` → `keyof
// TRow`, and the cell-edit literal union → the `TCellKind` parameter (paste excludes the
// dropdown-only UOM kind). GridShell itself reads only `selection`, `setSelection`, and
// `handleCustomKeyDown` from this; the rest is consumed by the host's own cell
// renderers / context menu / keyboard hooks.
// ---------------------------------------------------------------------------

import type { RowData, Table } from '@tanstack/table-core';
import type React from 'react';

/** The cell-edit "kinds" Step 4's input components dispatch on. Steps 2/3 will define
 *  their own when they implement {@link GridHostContract} (B2/B3). */
export type GridCellKind = "code" | "desc" | "qty" | "price" | "uom";

export interface GridHostContract<TRow extends RowData, TCellKind extends string = string> {
  editingCellId: string | null;
  editingValues: Record<string, string>;
  setEditingCellId: React.Dispatch<React.SetStateAction<string | null>>;
  setEditingValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  flushEditingBufferRef: React.MutableRefObject<() => void>;
  focusedCellRef: React.MutableRefObject<{
    rowId: string; field: string; initialValue: string | number | boolean;
  } | null>;
  focusedCustomCellRef: React.MutableRefObject<{
    rowId: string; columnId: string; initialValue: string;
  } | null>;
  lockedCells: Record<string, boolean>;
  handleCellEdit: (index: number, field: keyof TRow, value: string | number) => void;
  commitCellEdit: (
    rowId: string, field: keyof TRow,
    prev: string | number | boolean, next: string | number | boolean
  ) => void;
  handleKeyDown: (e: React.KeyboardEvent, rIdx: number, type: TCellKind, table: Table<TRow>) => void;
  handleCustomKeyDown: (e: React.KeyboardEvent, rIdx: number, colId: string, table: Table<TRow>) => void;
  handlePaste: (e: React.ClipboardEvent<HTMLInputElement>, startRowIdx: number, type: Exclude<TCellKind, "uom">) => void;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState>>;
  deleteRow: (rowId: string) => void;
  insertManualRow: (direction: "above" | "below", targetIndex: number) => void;
  handleCustomCellEdit: (rowIndex: number, columnId: string, value: string) => void;
  commitCustomCellEdit: (rowId: string, columnId: string, prevValue: string, nextValue: string) => void;
  selection: GridSelectionState;
  setSelection: React.Dispatch<React.SetStateAction<GridSelectionState>>;
}

// TanStack Table Meta — typed `table.options.meta` access. The global augmentation IS the
// Step-4 instantiation of the contract (Step 4 is the sole consumer), so `keyof TData` and
// the GridCellKind union resolve exactly as the pre-B1b hand-written augmentation did.
declare module '@tanstack/table-core' {
  // Module augmentation must use `interface` (a type alias cannot augment a module), so the
  // empty-extends form is intentional here — it pins TableMeta to the Step-4 contract.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface TableMeta<TData extends RowData> extends GridHostContract<TData, GridCellKind> {}
}
