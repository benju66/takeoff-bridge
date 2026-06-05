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
  costType: string;        // e.g., "M" (Materials), "S" (Subcontract), "L" (Labor)
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
  /** Provenance tracking: where this row originated */
  source?: 'template' | 'csv_import' | 'manual' | 'ai_suggestion';
}

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
  | UpdateColumnCommand;

export interface GridSelectionState {
  rowId: string | null;
  columnId: string | null;
  isEditing: boolean;
  initialEditChar?: string | null;
}

// ---------------------------------------------------------------------------
// TanStack Table Meta — Type augmentation for typed table.options.meta access
// ---------------------------------------------------------------------------

import type { RowData, Table } from '@tanstack/table-core';
import type React from 'react';

declare module '@tanstack/table-core' {
  interface TableMeta<TData extends RowData> {
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
    handleCellEdit: (index: number, field: keyof ProcessedTakeoffRow, value: string | number) => void;
    commitCellEdit: (
      rowId: string, field: keyof ProcessedTakeoffRow,
      prev: string | number | boolean, next: string | number | boolean
    ) => void;
    handleKeyDown: (e: React.KeyboardEvent, rIdx: number, type: "code" | "desc" | "qty" | "price" | "uom", table: Table<TData>) => void;
    handleCustomKeyDown: (e: React.KeyboardEvent, rIdx: number, colId: string, table: Table<TData>) => void;
    handlePaste: (e: React.ClipboardEvent<HTMLInputElement>, startRowIdx: number, type: "code" | "desc" | "qty" | "price") => void;
    setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState>>;
    deleteRow: (rowId: string) => void;
    insertManualRow: (direction: "above" | "below", targetIndex: number) => void;
    handleCustomCellEdit: (rowIndex: number, columnId: string, value: string) => void;
    commitCustomCellEdit: (rowId: string, columnId: string, prevValue: string, nextValue: string) => void;
    selection: GridSelectionState;
    setSelection: React.Dispatch<React.SetStateAction<GridSelectionState>>;
  }
}
