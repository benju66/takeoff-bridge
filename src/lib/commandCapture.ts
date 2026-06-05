import { ProcessedTakeoffRow } from "@/types";

// ---------------------------------------------------------------------------
// commandCapture — Pure field-capture helpers for WorkbookCommand payloads
// Extracted from useCellEditing so the capture contract is unit-testable
// without React (same approach as commandHistory.test.ts).
// ---------------------------------------------------------------------------

/**
 * Every field applyCellEditDirect derives on a row when its itemId changes.
 * Used for both the edited row's self-capture and sibling cascade captures,
 * so undo/redo restores rows atomically (AGENTS.md: full undo/redo fidelity).
 */
export const ITEM_ID_CASCADE_CAPTURE_FIELDS = [
  "itemId",
  "description",
  "procoreParentCode",
  "procoreCode",
  "unitPrice",
  "uom",
  "costType",
  "matchedQty",
  "total",
  "isMapped",
  "dataFidelity",
] as const satisfies readonly (keyof ProcessedTakeoffRow)[];

/** Snapshot the named fields off a row into a partial for command payloads. */
export function captureRowFields(
  row: ProcessedTakeoffRow,
  fields: readonly (keyof ProcessedTakeoffRow)[]
): Partial<ProcessedTakeoffRow> {
  const captured: Record<string, unknown> = {};
  for (const field of fields) {
    captured[field] = row[field];
  }
  return captured as Partial<ProcessedTakeoffRow>;
}
