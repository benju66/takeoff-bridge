/**
 * Phase 4 — Division 60 Fee-Block Addressability: undoable insert / delete / edit.
 *
 * The fee-block editing surface lives in the static <tfoot> and the suite runs on node
 * (no DOM), so correctness is proven here at the PURE command layer the React dispatcher
 * delegates to — `applyFeeLineForward` / `applyFeeLineInverse` (the reducer
 * useCommandDispatch calls via setMarkupLines) + `buildFeeLineEdit` (the EDIT command
 * builder the workbook creator uses). This locks the AGENTS.md compounding-history rule:
 * a single command holds enough inverse data that ONE undo reverses it atomically.
 *
 * Procore-code assignment reuses the GC/Site-Ops one-off validator (`validateOneOffCode`,
 * the primed authority oracle) — never a guessed type — so that integration is exercised
 * too: a valid code resolves a cost type, an unknown code is rejected.
 */

import { describe, it, expect } from "vitest";
import {
  applyFeeLineForward,
  applyFeeLineInverse,
  buildFeeLineEdit,
  isFeeLineCommand,
} from "../sectionLines/markupCommands";
import { newFeeLine, feeLineAmount, isMarkupLine } from "../sectionLines/markup";
import { validateOneOffCode } from "../sectionLines/oneOff";
import { primeProcoreValidCodes, resetProcoreValidCodes } from "../procoreValidCodes";
import type { EstimateSectionLine } from "@/types/db";
import type { InsertFeeLineCommand, DeleteFeeLineCommand, WorkbookCommand } from "@/types";

describe("Phase 4 — newFeeLine produces a manual, blank-coded markup lumpSum", () => {
  it("an inserted line is source='manual', section='markup', code BLANK, dollar in inputs.amount", () => {
    const line = newFeeLine({ label: "Preconstruction Fee", amount: 2500 });
    expect(line.source).toBe("manual");
    expect(isMarkupLine(line)).toBe(true);
    expect(line.entryKind).toBe("lumpSum");
    expect(line.procoreCode).toBe(""); // never guessed (AGENTS.md No Speculative Changes)
    expect(line.costType).toBe("");
    expect(feeLineAmount(line)).toBe(2500);
  });
});

describe("Phase 4 — INSERT_FEE_LINE / DELETE_FEE_LINE are exact inverses", () => {
  const fee0 = newFeeLine({ label: "Existing", amount: 1000 });

  it("insert appends at index, undo removes exactly that id; redo re-inserts identically", () => {
    const line = newFeeLine({ label: "New Fee", amount: 2500 });
    const cmd: InsertFeeLineCommand = { type: "INSERT_FEE_LINE", line, index: 1 };

    const afterInsert = applyFeeLineForward([fee0], cmd);
    expect(afterInsert.map((l) => l.id)).toEqual([fee0.id, line.id]);

    // Undo removes the inserted line — back to the original set, untouched.
    const undone = applyFeeLineInverse(afterInsert, cmd);
    expect(undone).toEqual([fee0]);

    // Redo re-inserts the SAME line (id + amount preserved).
    const redone = applyFeeLineForward(undone, cmd);
    expect(redone.map((l) => l.id)).toEqual([fee0.id, line.id]);
    expect(feeLineAmount(redone[1])).toBe(2500);
  });

  it("delete removes by id; undo re-inserts at the ORIGINAL index (position preserved)", () => {
    const a = newFeeLine({ label: "A", amount: 100 });
    const b = newFeeLine({ label: "B", amount: 200 });
    const c = newFeeLine({ label: "C", amount: 300 });
    const lines = [a, b, c];
    const cmd: DeleteFeeLineCommand = { type: "DELETE_FEE_LINE", line: b, index: 1 };

    const afterDelete = applyFeeLineForward(lines, cmd);
    expect(afterDelete.map((l) => l.label)).toEqual(["A", "C"]);

    // A single undo restores B at index 1 — not appended at the end.
    const undone = applyFeeLineInverse(afterDelete, cmd);
    expect(undone.map((l) => l.label)).toEqual(["A", "B", "C"]);
    expect(undone[1]).toEqual(b);
  });
});

describe("Phase 4 — EDIT_FEE_LINE: label / amount / code each restore atomically", () => {
  it("label edit: forward applies next, inverse restores prev", () => {
    const line = newFeeLine({ label: "Old", amount: 2500 });
    const cmd = buildFeeLineEdit(line, { label: "New" });
    expect(cmd).not.toBeNull();
    const fwd = applyFeeLineForward([line], cmd!);
    expect(fwd[0].label).toBe("New");
    const inv = applyFeeLineInverse(fwd, cmd!);
    expect(inv[0].label).toBe("Old");
    expect(inv[0]).toEqual(line); // byte-identical restore
  });

  it("amount edit mutates inputs.amount (the INPUT, not an override) and round-trips", () => {
    const line = newFeeLine({ label: "Fee", amount: 2500 });
    const cmd = buildFeeLineEdit(line, { inputs: { amount: 3000 } });
    expect(cmd).not.toBeNull();
    const fwd = applyFeeLineForward([line], cmd!);
    expect(feeLineAmount(fwd[0])).toBe(3000);
    const inv = applyFeeLineInverse(fwd, cmd!);
    expect(feeLineAmount(inv[0])).toBe(2500);
  });

  it("code assignment edits procoreCode + costType together; undo clears both", () => {
    const line = newFeeLine({ label: "Fee", amount: 2500 }); // procoreCode '' / costType ''
    const cmd = buildFeeLineEdit(line, { procoreCode: "60-4000.002", costType: "S" });
    expect(cmd).not.toBeNull();
    const fwd = applyFeeLineForward([line], cmd!);
    expect(fwd[0].procoreCode).toBe("60-4000.002");
    expect(fwd[0].costType).toBe("S");
    const inv = applyFeeLineInverse(fwd, cmd!);
    expect(inv[0].procoreCode).toBe("");
    expect(inv[0].costType).toBe("");
  });

  it("a no-op edit (same value) builds no command — never lands on the undo stack", () => {
    const line = newFeeLine({ label: "Fee", amount: 2500 });
    expect(buildFeeLineEdit(line, { label: "Fee" })).toBeNull();
    expect(buildFeeLineEdit(line, { inputs: { amount: 2500 } })).toBeNull();
    // A patch that changes only ONE of two fields still records that one (not a no-op).
    const cmd = buildFeeLineEdit(line, { label: "Fee", inputs: { amount: 3000 } });
    expect(cmd).not.toBeNull();
    expect(cmd!.next).toEqual({ inputs: { amount: 3000 } });
    expect(cmd!.prev).toEqual({ inputs: { amount: 2500 } });
  });
});

describe("Phase 4 — a mixed insert/edit/delete history reverses in order (single Ctrl+Z each)", () => {
  it("undoing a 3-command sequence in reverse returns to the starting set", () => {
    const start: EstimateSectionLine[] = [];

    // 1) insert a fee line
    const inserted = newFeeLine({ label: "Precon", amount: 2500 });
    const c1: WorkbookCommand = { type: "INSERT_FEE_LINE", line: inserted, index: 0 };
    // 2) edit its amount
    const c2 = buildFeeLineEdit(inserted, { inputs: { amount: 4000 } })!;
    // 3) insert a second line, then we'll delete it
    const second = newFeeLine({ label: "Allowance", amount: 1500 });
    const c3: WorkbookCommand = { type: "INSERT_FEE_LINE", line: second, index: 1 };

    const history = [c1, c2, c3].filter(isFeeLineCommand);

    // Replay forward (live edits).
    let lines = start as EstimateSectionLine[];
    for (const c of history) lines = applyFeeLineForward(lines, c);
    expect(lines.map((l) => l.label)).toEqual(["Precon", "Allowance"]);
    expect(feeLineAmount(lines[0])).toBe(4000);

    // Undo each in reverse — back to empty.
    for (let i = history.length - 1; i >= 0; i--) lines = applyFeeLineInverse(lines, history[i]);
    expect(lines).toEqual([]);
  });
});

describe("Phase 4 — Procore-code assignment reuses the authority validator (no guessed type)", () => {
  it("rejects an unknown code; resolves a primed code's cost type for the editFeeLine patch", () => {
    resetProcoreValidCodes();
    primeProcoreValidCodes([
      { code: "60-4000.002", description: "Preconstruction Fee", type: "Subcontract" },
    ]);

    expect(validateOneOffCode("99-99999.999").ok).toBe(false); // unknown → rejected, never assigned

    const res = validateOneOffCode("60-4000.002");
    expect(res.ok).toBe(true);
    if (res.ok) {
      // This is exactly the patch the assign popover hands editFeeLine.
      const line = newFeeLine({ label: "Precon", amount: 2500 });
      const cmd = buildFeeLineEdit(line, { procoreCode: res.procoreCode, costType: res.costType });
      expect(cmd!.next).toEqual({ procoreCode: "60-4000.002", costType: "S" });
    }
    resetProcoreValidCodes();
  });
});
