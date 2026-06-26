/**
 * Division 60 Fee-Block Addressability — Phase 4 markup command reducer (PURE, no React).
 *
 * The forward/inverse transforms for the three undoable fee-line commands
 * (INSERT_FEE_LINE / DELETE_FEE_LINE / EDIT_FEE_LINE). Kept here as pure array
 * functions — the React dispatcher (`useCommandDispatch`) only calls
 * `setMarkupLines((prev) => applyFeeLineForward/Inverse(prev, cmd))`, exactly the way
 * the buyout store uses `applyBuyoutCommandValue` and bindings use `upsertBinding` /
 * `removeBinding`. That keeps every state mutation testable without a DOM.
 *
 * INVERSE FIDELITY (AGENTS.md compounding-history): each command holds enough inverse
 * data that a SINGLE undo reverses it atomically —
 *   - INSERT carries the whole new line + its array index → undo removes that id.
 *   - DELETE carries the whole removed line + its original index → undo re-inserts it
 *     at exactly that position (manual fee positions are preserved, like sort_order).
 *   - EDIT carries the prev/next field patch (the CHANGED fields only) → undo merges
 *     `prev`, redo merges `next`.
 */

import type { EstimateSectionLine } from "@/types/db";
import type {
  InsertFeeLineCommand,
  DeleteFeeLineCommand,
  EditFeeLineCommand,
  WorkbookCommand,
} from "@/types";
import { feeLineAmount } from "./markup";

/** The three fee-line command variants this reducer handles. */
export type FeeLineCommand = InsertFeeLineCommand | DeleteFeeLineCommand | EditFeeLineCommand;

/** True for a command this reducer owns (narrows the shared WorkbookCommand union). */
export function isFeeLineCommand(cmd: WorkbookCommand): cmd is FeeLineCommand {
  return cmd.type === "INSERT_FEE_LINE" || cmd.type === "DELETE_FEE_LINE" || cmd.type === "EDIT_FEE_LINE";
}

/** Insert `line` at `index` (clamped into range; append when index ≥ length). */
function insertAt(
  lines: readonly EstimateSectionLine[],
  line: EstimateSectionLine,
  index: number,
): EstimateSectionLine[] {
  const next = [...lines];
  const at = Math.max(0, Math.min(index, next.length));
  next.splice(at, 0, line);
  return next;
}

/** Remove the line with `id` (a no-op when absent). */
function removeById(lines: readonly EstimateSectionLine[], id: string): EstimateSectionLine[] {
  return lines.filter((l) => l.id !== id);
}

/** Shallow-merge a field patch onto the line with `id` (inputs is replaced wholesale —
 *  a fee line's inputs holds only `amount`, so a whole-object swap is full-fidelity). */
function patchById(
  lines: readonly EstimateSectionLine[],
  id: string,
  patch: Partial<EstimateSectionLine>,
): EstimateSectionLine[] {
  return lines.map((l) => (l.id === id ? { ...l, ...patch } : l));
}

/** Apply a fee-line command's FORWARD (redo / live-edit) effect to the markup array. */
export function applyFeeLineForward(
  lines: readonly EstimateSectionLine[],
  cmd: FeeLineCommand,
): EstimateSectionLine[] {
  switch (cmd.type) {
    case "INSERT_FEE_LINE":
      return insertAt(lines, cmd.line, cmd.index);
    case "DELETE_FEE_LINE":
      return removeById(lines, cmd.line.id);
    case "EDIT_FEE_LINE":
      return patchById(lines, cmd.id, cmd.next);
  }
}

/** Apply a fee-line command's INVERSE (undo) effect to the markup array. */
export function applyFeeLineInverse(
  lines: readonly EstimateSectionLine[],
  cmd: FeeLineCommand,
): EstimateSectionLine[] {
  switch (cmd.type) {
    case "INSERT_FEE_LINE":
      return removeById(lines, cmd.line.id);
    case "DELETE_FEE_LINE":
      return insertAt(lines, cmd.line, cmd.index);
    case "EDIT_FEE_LINE":
      return patchById(lines, cmd.id, cmd.prev);
  }
}

/**
 * Builds an EDIT_FEE_LINE command capturing `prev` (the line's CURRENT values for each
 * patched field) and `next` (the patch), so undo/redo restore exactly the changed fields.
 * Returns `null` when the patch changes nothing (no command should be pushed) — the
 * caller skips it so a no-op edit never lands on the undo stack (mirrors assignOneOffCode).
 *
 * Supported fields: `label`, `inputs` (the `{ amount }` object), `procoreCode`, `costType`.
 * `inputs` is compared by its fee amount; other fields by identity.
 */
export function buildFeeLineEdit(
  line: EstimateSectionLine,
  patch: Partial<EstimateSectionLine>,
): EditFeeLineCommand | null {
  const prev: Partial<EstimateSectionLine> = {};
  const next: Partial<EstimateSectionLine> = {};
  let changed = false;

  for (const key of Object.keys(patch) as (keyof EstimateSectionLine)[]) {
    const isNoChange =
      key === "inputs"
        ? feeLineAmount({ ...line, inputs: patch.inputs as Record<string, unknown> }) === feeLineAmount(line)
        : line[key] === patch[key];
    if (isNoChange) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prev as any)[key] = line[key];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (next as any)[key] = patch[key];
    changed = true;
  }

  if (!changed) return null;
  return { type: "EDIT_FEE_LINE", id: line.id, prev, next };
}
