import { ProcessedTakeoffRow } from "@/types";

// ---------------------------------------------------------------------------
// cascade.ts — the single rule for the classification cascade.
//
// When an estimator edits a row's itemId / description / unitPrice, the workspace
// (useCellEditing.applyCellEditDirect) propagates that edit to every SIBLING row
// sharing the same `classification` string. This is the right behavior for a
// Togal CSV takeoff, where many rows carry the same classification and should
// move together when the estimator maps that classification to a code.
//
// It is the WRONG behavior for IMPORTED past-bid lines (source === 'imported').
// A finished bid's lines are individually authored — two storefront lines can
// share code 08-4000.002 (interior vs exterior, distinguished only in the
// description). They must stay independent: editing one must never rewrite the
// other. So imported rows are cascade-INDEPENDENT — they neither drive a cascade
// nor receive one.
//
// SURGICAL: this only adds a `source !== 'imported'` gate. Template/CSV/manual
// rows keep their exact prior cascade behavior. Learning (classification_history)
// is recorded outside the cascade, so imports can still feed it.
// ---------------------------------------------------------------------------

/**
 * True when an edit to `row` is allowed to drive the classification cascade
 * to siblings. Mirrors the long-standing guard (a real classification, not the
 * "MANUAL ENTRY" sentinel) plus the imported-row exclusion.
 */
export function cascadeEligible(row: ProcessedTakeoffRow): boolean {
  return (
    !!row.classification &&
    row.classification !== "MANUAL ENTRY" &&
    row.source !== "imported"
  );
}

/**
 * True when an edit to `editedRow` should cascade onto `sibling`: the edited row
 * must be cascade-eligible, the sibling must share its classification, and the
 * sibling must not itself be an independently-authored imported line. Callers
 * that must skip the edited row itself keep their own `i !== index` check.
 */
export function cascadesToSibling(
  editedRow: ProcessedTakeoffRow,
  sibling: ProcessedTakeoffRow
): boolean {
  return (
    cascadeEligible(editedRow) &&
    sibling.classification === editedRow.classification &&
    sibling.source !== "imported"
  );
}
