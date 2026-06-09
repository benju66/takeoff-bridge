import { ProcessedTakeoffRow, MergeTakeoffDataCommand } from "@/types";
import { evaluateDataFidelity } from "./calculations";
import { getDivisionCode } from "./division";

// ---------------------------------------------------------------------------
// mergeTakeoff — PURE merge logic for importing parsed takeoff rows into the grid.
//
// Extracted from useFileIngestion so the build (computeMergeResult) and the undo/redo
// application (applyMergeForward / applyMergeInverse) are pure, deterministic, and unit
// testable WITHOUT a React render harness (this repo has no @testing-library/react;
// undo fidelity is proven by exercising these functions directly — see
// src/__tests__/import-integrity.test.ts). useFileIngestion and useCommandDispatch both
// call these, so there is one source of truth for merge semantics.
//
// Phase 3 / INV-8 (#3 no silent row drop): a parsed row with a VALID itemId but no matching
// template row is APPENDED to the grid (never dropped) and recorded on the SAME command via
// `appendedRows`, so one Ctrl+Z reverses the whole merge (AGENTS.md compounding-history).
// ---------------------------------------------------------------------------

export interface MergeResult {
  /** The grid after the merge (existing rows updated + off-template valid codes appended). */
  updatedRows: ProcessedTakeoffRow[];
  /** The single undoable command capturing full inverse data for the whole merge. */
  command: MergeTakeoffDataCommand;
  /** Classifications with no itemId — surfaced to the user, never silently merged. */
  unmappedList: string[];
}

/**
 * Index at which to insert a new row so it sits within its CSI division block: just after
 * the last existing row sharing the division, or at the end if the division is not present.
 * A division-less itemId (shouldn't happen for a valid code) appends at the end.
 */
export function divisionInsertIndex(rows: ProcessedTakeoffRow[], itemId: string): number {
  const div = getDivisionCode(itemId);
  if (!div) return rows.length;
  let lastIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (getDivisionCode(rows[i].itemId) === div) lastIdx = i;
  }
  return lastIdx === -1 ? rows.length : lastIdx + 1;
}

// Field snapshot captured for an existing row's prev/next state. Kept identical between
// prevRowStates and nextRowStates so undo/redo restore exactly the same shape.
function captureMergeFields(
  r: ProcessedTakeoffRow,
  defaultSource: NonNullable<ProcessedTakeoffRow["source"]>,
): Partial<ProcessedTakeoffRow> {
  return {
    matchedQty: r.matchedQty,
    total: r.total,
    classification: r.classification,
    rawQuantities: r.rawQuantities.map((rq) => ({ ...rq })),
    isMapped: r.isMapped,
    dataFidelity: r.dataFidelity,
    source: r.source || defaultSource,
  };
}

/**
 * Compute the forward grid + the single MERGE_TAKEOFF_DATA command for an import.
 * Pure: no React, no I/O. The caller (useFileIngestion) is responsible for pushCommand,
 * the pre-import snapshot, training records, and the state setters.
 */
export function computeMergeResult(
  currentRows: ProcessedTakeoffRow[],
  parsed: ProcessedTakeoffRow[],
  prevUnmapped: string[],
  appendData: boolean,
  threshold: number,
  keywords: string[],
): MergeResult {
  // Unmapped classifications (no itemId) — surfaced, never silently merged into the grid.
  // INV-8 note: the no-itemId row's QUANTITY is not lost — ImportPreviewModal (the override
  // surface) shows every parsed row with its qty before confirm, so the estimator can map &
  // place it. This list is the post-import name-only banner; quantity carry lives in the modal.
  const unmappedList: string[] = [];
  for (const parsedRow of parsed) {
    if (!parsedRow.itemId && !unmappedList.includes(parsedRow.classification)) {
      unmappedList.push(parsedRow.classification);
    }
  }

  // Replace mode discards rows from a PRIOR import (off-template appended rows, source
  // 'csv_import') ENTIRELY — they were previous import data, not part of the template skeleton,
  // so a fresh replace must not leave them behind as phantom blank $0 rows. (Before Phase 3 no
  // 'csv_import' row could exist in the grid, so this only affects rows this feature created.)
  // Recorded in `removedRows` for atomic undo. Template/manual rows keep their prior behavior.
  const removedRows: ProcessedTakeoffRow[] = appendData
    ? []
    : currentRows
        .filter((r) => r.source === "csv_import")
        .map((r) => ({ ...r, rawQuantities: r.rawQuantities.map((rq) => ({ ...rq })) }));
  const baseRows = appendData
    ? currentRows
    : currentRows.filter((r) => r.source !== "csv_import");

  // Snapshot the rows that REMAIN, BEFORE mutation (field-level undo basis). Removed rows are
  // restored from removedRows; appended rows from appendedRows.
  const prevRowStates = baseRows.map((r) => ({
    rowId: r.id,
    fields: captureMergeFields(r, "template"),
  }));

  // Forward grid: replace-mode resets the remaining rows; append-mode carries them.
  const updatedRows: ProcessedTakeoffRow[] = baseRows.map((r) =>
    appendData
      ? { ...r }
      : {
          ...r,
          matchedQty: 0,
          total: 0,
          classification: "",
          rawQuantities: [] as { qty: number; uom: string }[],
          dataFidelity: "discrete_unit" as const,
        },
  );

  const appendedIds = new Set<string>();
  for (const parsedRow of parsed) {
    if (!parsedRow.itemId) continue;
    const targetIdx = updatedRows.findIndex((r) => r.itemId === parsedRow.itemId);
    if (targetIdx !== -1) {
      // Accumulate into the existing row (a template row, or a row appended earlier this merge).
      const t = updatedRows[targetIdx];
      t.matchedQty += parsedRow.matchedQty;
      t.total = t.matchedQty * t.unitPrice;
      t.classification = parsedRow.classification;
      t.rawQuantities = parsedRow.rawQuantities.map((rq) => ({ ...rq }));
      t.dataFidelity = evaluateDataFidelity(t.matchedQty, t.uom, t.total, threshold, keywords);
    } else {
      // Fix #3: a VALID code absent from the template — APPEND it, placed in its division.
      // id `import-${itemId}` is collision-free: we only reach here when no row has this
      // itemId, and template/manual ids use different prefixes (row-… / manual-…).
      const appended: ProcessedTakeoffRow = {
        ...parsedRow,
        id: `import-${parsedRow.itemId}`,
        source: "csv_import",
        rawQuantities: parsedRow.rawQuantities.map((rq) => ({ ...rq })),
      };
      const at = divisionInsertIndex(updatedRows, appended.itemId);
      updatedRows.splice(at, 0, appended);
      appendedIds.add(appended.id);
    }
  }

  // nextRowStates: existing rows only — appended rows ride on command.appendedRows.
  const nextRowStates = updatedRows
    .filter((r) => !appendedIds.has(r.id))
    .map((r) => ({ rowId: r.id, fields: captureMergeFields(r, "csv_import") }));

  const appendedRows = updatedRows
    .filter((r) => appendedIds.has(r.id))
    .map((r) => ({ ...r, rawQuantities: r.rawQuantities.map((rq) => ({ ...rq })) }));

  const command: MergeTakeoffDataCommand = {
    type: "MERGE_TAKEOFF_DATA",
    prevRowStates,
    nextRowStates,
    prevUnmapped,
    nextUnmapped: unmappedList,
    appendedRows: appendedRows.length ? appendedRows : undefined,
    removedRows: removedRows.length ? removedRows : undefined,
  };

  return { updatedRows, command, unmappedList };
}

/**
 * Apply a merge command's FORWARD (redo) effect to a rows array (pure). Re-applies existing
 * rows' next field state and re-appends any rows the merge originally added, each placed back
 * in its division. Idempotent on already-present appended ids.
 */
export function applyMergeForward(
  rows: ProcessedTakeoffRow[],
  cmd: MergeTakeoffDataCommand,
): ProcessedTakeoffRow[] {
  let updated = [...rows];
  // Re-apply forward removals first (replace-mode discard of prior imported rows).
  if (cmd.removedRows?.length) {
    const removeIds = new Set(cmd.removedRows.map((r) => r.id));
    updated = updated.filter((r) => !removeIds.has(r.id));
  }
  for (const ns of cmd.nextRowStates) {
    const idx = updated.findIndex((r) => r.id === ns.rowId);
    if (idx !== -1) {
      updated[idx] = { ...updated[idx], ...ns.fields };
      if (ns.fields.rawQuantities) {
        updated[idx].rawQuantities = ns.fields.rawQuantities.map((rq) => ({ ...rq }));
      }
    }
  }
  appendRowsInDivision(updated, cmd.appendedRows);
  return updated;
}

/**
 * Apply a merge command's INVERSE (undo) effect to a rows array (pure). Restores existing
 * rows' prev field state, removes every row the merge appended, AND re-adds every row the
 * merge removed — so one undo reverses the whole merge atomically.
 */
export function applyMergeInverse(
  rows: ProcessedTakeoffRow[],
  cmd: MergeTakeoffDataCommand,
): ProcessedTakeoffRow[] {
  let updated = [...rows];
  for (const ps of cmd.prevRowStates) {
    const idx = updated.findIndex((r) => r.id === ps.rowId);
    if (idx !== -1) {
      updated[idx] = { ...updated[idx], ...ps.fields };
      if (ps.fields.rawQuantities) {
        updated[idx].rawQuantities = ps.fields.rawQuantities.map((rq) => ({ ...rq }));
      }
    }
  }
  if (cmd.appendedRows?.length) {
    const removeIds = new Set(cmd.appendedRows.map((r) => r.id));
    updated = updated.filter((r) => !removeIds.has(r.id));
  }
  // Re-add rows the merge removed (replace-mode discards), placed back in their division.
  appendRowsInDivision(updated, cmd.removedRows);
  return updated;
}

/** Splice each row (deep-cloned) into its CSI division block, skipping ids already present. */
function appendRowsInDivision(
  target: ProcessedTakeoffRow[],
  rows: ProcessedTakeoffRow[] | undefined,
): void {
  if (!rows?.length) return;
  const present = new Set(target.map((r) => r.id));
  for (const r of rows) {
    if (present.has(r.id)) continue;
    const clone: ProcessedTakeoffRow = {
      ...r,
      rawQuantities: r.rawQuantities.map((rq) => ({ ...rq })),
      customFields: { ...(r.customFields || {}) },
    };
    target.splice(divisionInsertIndex(target, clone.itemId), 0, clone);
    present.add(clone.id);
  }
}
