import { describe, it, expect } from "vitest";
import { applyBuyoutCommandValue, type BuyoutLine, type BuyoutStore } from "../buyout";
import type { EditBuyoutCellCommand, WorkbookCommand } from "@/types";

// ---------------------------------------------------------------------------
// buyoutCommand.test.ts — EDIT_BUYOUT_CELL undo/redo dispatch (Phase 3)
//
// The dispatch's forward (redo → nextValue) and inverse (undo → prevValue) both route the
// chosen value through the pure `applyBuyoutCommandValue` helper. Since @testing-library/react
// is unavailable (see commandHistory.test.ts), we test that helper directly with a fake
// BuyoutStore, then drive a mixed estimate/buyout command sequence through a tiny dispatcher +
// mock command stack that MIRRORS the real hook — proving the buyout edits interleave correctly
// and estimate edits never touch the buyout store.
// ---------------------------------------------------------------------------

/** A fake BuyoutStore that records every setter call and keeps an in-memory map. */
function makeFakeStore() {
  const map: Record<string, BuyoutLine> = {};
  const calls: Array<{ fn: "setVendor" | "setActual"; rowId: string; value: string | number | null }> = [];
  const store: BuyoutStore = {
    getLine: (rowId) => map[rowId] ?? { vendor: "", actual: null },
    setVendor: (rowId, vendor) => {
      calls.push({ fn: "setVendor", rowId, value: vendor });
      map[rowId] = { vendor, actual: map[rowId]?.actual ?? null };
    },
    setActual: (rowId, actual) => {
      calls.push({ fn: "setActual", rowId, value: actual });
      map[rowId] = { vendor: map[rowId]?.vendor ?? "", actual };
    },
    map,
  };
  return { store, map, calls };
}

describe("applyBuyoutCommandValue — value routing", () => {
  it("routes a vendor value to setVendor only", () => {
    const { store, calls, map } = makeFakeStore();
    applyBuyoutCommandValue(store, "row-1", "vendor", "Acme Concrete");
    expect(calls).toEqual([{ fn: "setVendor", rowId: "row-1", value: "Acme Concrete" }]);
    expect(map["row-1"]).toEqual({ vendor: "Acme Concrete", actual: null });
  });

  it("routes a numeric actual to setActual only", () => {
    const { store, calls, map } = makeFakeStore();
    applyBuyoutCommandValue(store, "row-2", "actual", 12500);
    expect(calls).toEqual([{ fn: "setActual", rowId: "row-2", value: 12500 }]);
    expect(map["row-2"]).toEqual({ vendor: "", actual: 12500 });
  });

  it("passes a cleared actual (null) through unchanged — reads as the Estimate (L-3)", () => {
    const { store, calls, map } = makeFakeStore();
    applyBuyoutCommandValue(store, "row-3", "actual", null);
    expect(calls).toEqual([{ fn: "setActual", rowId: "row-3", value: null }]);
    expect(map["row-3"]).toEqual({ vendor: "", actual: null });
  });

  it("coerces a nullish vendor to an empty string (defensive)", () => {
    const { store, calls } = makeFakeStore();
    applyBuyoutCommandValue(store, "row-4", "vendor", null);
    expect(calls).toEqual([{ fn: "setVendor", rowId: "row-4", value: "" }]);
  });
});

// ---------------------------------------------------------------------------
// Mixed interleaving — estimate edits and buyout edits share ONE undo stack.
// Mirrors useCommandHistory (ref-based dual stack) + useCommandDispatch's
// EDIT_BUYOUT_CELL routing, without React.
// ---------------------------------------------------------------------------

function createMockHistory() {
  let undoStack: WorkbookCommand[] = [];
  let redoStack: WorkbookCommand[] = [];
  return {
    push(cmd: WorkbookCommand) { undoStack = [...undoStack, cmd]; redoStack = []; },
    undo(): WorkbookCommand | null {
      if (undoStack.length === 0) return null;
      const c = undoStack[undoStack.length - 1];
      undoStack = undoStack.slice(0, -1);
      redoStack = [...redoStack, c];
      return c;
    },
    redo(): WorkbookCommand | null {
      if (redoStack.length === 0) return null;
      const c = redoStack[redoStack.length - 1];
      redoStack = redoStack.slice(0, -1);
      undoStack = [...undoStack, c];
      return c;
    },
  };
}

/** Mirrors the real dispatch: only EDIT_BUYOUT_CELL touches the buyout store; everything else
 *  is an estimate command the buyout store must ignore entirely. */
function dispatchBuyout(store: BuyoutStore, cmd: WorkbookCommand, direction: "forward" | "inverse") {
  if (cmd.type !== "EDIT_BUYOUT_CELL") return;
  const value = direction === "forward" ? cmd.nextValue : cmd.prevValue;
  applyBuyoutCommandValue(store, cmd.rowId, cmd.field, value);
}

describe("EDIT_BUYOUT_CELL — interleaved undo/redo on the shared stack", () => {
  it("estimate edit → vendor edit → actual edit, then undo x3 / redo x3", () => {
    const { store, map } = makeFakeStore();
    const history = createMockHistory();
    const rowId = "row-9";

    // 1) Estimate edit (opaque to buyout) — pushed but never written to the buyout store.
    const estimateEdit: WorkbookCommand = {
      type: "EDIT_CELL", rowId, field: "matchedQty", prevValue: 0, nextValue: 100,
    };
    history.push(estimateEdit);

    // 2) Live vendor edit: prev "" → next "Acme" (the commit helper would push then set).
    const vendorCmd: EditBuyoutCellCommand = {
      type: "EDIT_BUYOUT_CELL", rowId, field: "vendor", prevValue: "", nextValue: "Acme",
    };
    history.push(vendorCmd);
    store.setVendor(rowId, "Acme");

    // 3) Live actual edit: prev null → next 5000.
    const actualCmd: EditBuyoutCellCommand = {
      type: "EDIT_BUYOUT_CELL", rowId, field: "actual", prevValue: null, nextValue: 5000,
    };
    history.push(actualCmd);
    store.setActual(rowId, 5000);

    expect(map[rowId]).toEqual({ vendor: "Acme", actual: 5000 });

    // Undo x3 — actual reverts to null, vendor to "", estimate edit is a buyout no-op.
    dispatchBuyout(store, history.undo()!, "inverse"); // actual → null
    expect(map[rowId]).toEqual({ vendor: "Acme", actual: null });
    dispatchBuyout(store, history.undo()!, "inverse"); // vendor → ""
    expect(map[rowId]).toEqual({ vendor: "", actual: null });
    const undoneEstimate = history.undo()!; // EDIT_CELL — ignored by the buyout store
    dispatchBuyout(store, undoneEstimate, "inverse");
    expect(undoneEstimate.type).toBe("EDIT_CELL");
    expect(map[rowId]).toEqual({ vendor: "", actual: null });

    // Redo x3 — estimate no-op, vendor → "Acme", actual → 5000 (back to the start).
    dispatchBuyout(store, history.redo()!, "forward"); // EDIT_CELL — ignored
    expect(map[rowId]).toEqual({ vendor: "", actual: null });
    dispatchBuyout(store, history.redo()!, "forward"); // vendor → "Acme"
    expect(map[rowId]).toEqual({ vendor: "Acme", actual: null });
    dispatchBuyout(store, history.redo()!, "forward"); // actual → 5000
    expect(map[rowId]).toEqual({ vendor: "Acme", actual: 5000 });
  });

  it("undo of an actual edit restores the prior NUMBER, not null (re-award case)", () => {
    const { store, map } = makeFakeStore();
    const rowId = "row-10";
    // Two successive actual edits: 1000 then 2000. Undo of the 2nd must restore 1000.
    store.setActual(rowId, 1000);
    const secondActual: EditBuyoutCellCommand = {
      type: "EDIT_BUYOUT_CELL", rowId, field: "actual", prevValue: 1000, nextValue: 2000,
    };
    store.setActual(rowId, 2000);
    expect(map[rowId].actual).toBe(2000);
    dispatchBuyout(store, secondActual, "inverse");
    expect(map[rowId].actual).toBe(1000);
  });
});
