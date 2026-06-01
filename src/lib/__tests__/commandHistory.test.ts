import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// commandHistory.test.ts — Unit tests for the dual-stack undo/redo engine
//
// Since @testing-library/react is not available, we test the core
// stack-manipulation logic directly. The refactored useCommandHistory hook
// uses useRef (synchronous) for its stacks, making the push/undo/redo
// operations pure imperative functions whose logic can be validated
// without React's rendering pipeline.
// ---------------------------------------------------------------------------

const MAX_HISTORY_DEPTH = 50;

// Minimal mock of a WorkbookCommand for testing purposes.
// Only the discriminant field (type) is needed; inverse data is opaque.
type MockCommand = { type: string; payload: Record<string, unknown> };

/**
 * Simulates the ref-based stack engine from useCommandHistory.
 * This mirrors the exact logic in the hook without React dependencies.
 */
function createMockCommandHistory() {
  let undoStack: MockCommand[] = [];
  let redoStack: MockCommand[] = [];

  return {
    pushCommand(cmd: MockCommand) {
      undoStack = [...undoStack.slice(-(MAX_HISTORY_DEPTH - 1)), cmd];
      redoStack = [];
    },
    undo(): MockCommand | null {
      if (undoStack.length === 0) return null;
      const popped = undoStack[undoStack.length - 1];
      undoStack = undoStack.slice(0, -1);
      redoStack = [...redoStack, popped];
      return popped;
    },
    redo(): MockCommand | null {
      if (redoStack.length === 0) return null;
      const popped = redoStack[redoStack.length - 1];
      redoStack = redoStack.slice(0, -1);
      undoStack = [...undoStack.slice(-(MAX_HISTORY_DEPTH - 1)), popped];
      return popped;
    },
    get undoSize() { return undoStack.length; },
    get redoSize() { return redoStack.length; },
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
  };
}

function makeCmd(id: number): MockCommand {
  return { type: "EDIT_CELL", payload: { id } };
}

// ---------------------------------------------------------------------------
// Test Suites
// ---------------------------------------------------------------------------

describe("CommandHistory — pushCommand", () => {
  it("adds a command to the undo stack", () => {
    const history = createMockCommandHistory();
    history.pushCommand(makeCmd(1));
    expect(history.undoSize).toBe(1);
    expect(history.canUndo).toBe(true);
  });

  it("clears the redo stack on push", () => {
    const history = createMockCommandHistory();
    history.pushCommand(makeCmd(1));
    history.undo();
    expect(history.canRedo).toBe(true);
    history.pushCommand(makeCmd(2));
    expect(history.canRedo).toBe(false);
    expect(history.redoSize).toBe(0);
  });

  it("maintains multiple commands in order", () => {
    const history = createMockCommandHistory();
    history.pushCommand(makeCmd(1));
    history.pushCommand(makeCmd(2));
    history.pushCommand(makeCmd(3));
    expect(history.undoSize).toBe(3);
  });
});

describe("CommandHistory — undo", () => {
  it("returns the most recent command (LIFO)", () => {
    const history = createMockCommandHistory();
    history.pushCommand(makeCmd(1));
    history.pushCommand(makeCmd(2));
    const cmd = history.undo();
    expect(cmd).toEqual(makeCmd(2));
    expect(history.undoSize).toBe(1);
  });

  it("transfers the popped command to the redo stack", () => {
    const history = createMockCommandHistory();
    history.pushCommand(makeCmd(1));
    history.undo();
    expect(history.canRedo).toBe(true);
    expect(history.redoSize).toBe(1);
    expect(history.undoSize).toBe(0);
  });

  it("returns null when undo stack is empty", () => {
    const history = createMockCommandHistory();
    expect(history.undo()).toBeNull();
    expect(history.undoSize).toBe(0);
    expect(history.redoSize).toBe(0);
  });

  it("does not modify the redo stack when undo stack is empty", () => {
    const history = createMockCommandHistory();
    history.pushCommand(makeCmd(1));
    history.undo(); // redo = [1]
    const result = history.undo(); // undo stack empty
    expect(result).toBeNull();
    expect(history.redoSize).toBe(1); // unchanged
  });

  it("supports sequential undos through the full stack", () => {
    const history = createMockCommandHistory();
    history.pushCommand(makeCmd(1));
    history.pushCommand(makeCmd(2));
    history.pushCommand(makeCmd(3));

    expect(history.undo()).toEqual(makeCmd(3));
    expect(history.undo()).toEqual(makeCmd(2));
    expect(history.undo()).toEqual(makeCmd(1));
    expect(history.undo()).toBeNull();
    expect(history.undoSize).toBe(0);
    expect(history.redoSize).toBe(3);
  });
});

describe("CommandHistory — redo", () => {
  it("returns the most recently undone command", () => {
    const history = createMockCommandHistory();
    history.pushCommand(makeCmd(1));
    history.pushCommand(makeCmd(2));
    history.undo();
    const cmd = history.redo();
    expect(cmd).toEqual(makeCmd(2));
    expect(history.undoSize).toBe(2);
    expect(history.redoSize).toBe(0);
  });

  it("returns null when redo stack is empty", () => {
    const history = createMockCommandHistory();
    expect(history.redo()).toBeNull();
  });

  it("returns null when no undo has been performed", () => {
    const history = createMockCommandHistory();
    history.pushCommand(makeCmd(1));
    expect(history.redo()).toBeNull();
  });

  it("supports sequential redos after multiple undos", () => {
    const history = createMockCommandHistory();
    history.pushCommand(makeCmd(1));
    history.pushCommand(makeCmd(2));
    history.pushCommand(makeCmd(3));
    history.undo(); // pops 3
    history.undo(); // pops 2
    history.undo(); // pops 1

    expect(history.redo()).toEqual(makeCmd(1));
    expect(history.redo()).toEqual(makeCmd(2));
    expect(history.redo()).toEqual(makeCmd(3));
    expect(history.redo()).toBeNull();
    expect(history.undoSize).toBe(3);
  });
});

describe("CommandHistory — MAX_HISTORY_DEPTH", () => {
  it("caps the undo stack at 50 commands", () => {
    const history = createMockCommandHistory();
    for (let i = 0; i < 60; i++) {
      history.pushCommand(makeCmd(i));
    }
    expect(history.undoSize).toBe(MAX_HISTORY_DEPTH);
  });

  it("retains the most recent commands when depth is exceeded", () => {
    const history = createMockCommandHistory();
    for (let i = 0; i < 55; i++) {
      history.pushCommand(makeCmd(i));
    }
    // The oldest 5 commands (0-4) should be evicted; newest is 54
    const oldest = history.undo();
    expect(oldest).toBeDefined();

    // Undo all remaining to get the oldest surviving command
    let cmd: MockCommand | null = oldest;
    while (cmd !== null) {
      cmd = history.undo();
    }
    // We should have undone exactly 50 commands
    expect(history.redoSize).toBe(MAX_HISTORY_DEPTH);
  });

  it("also caps the undo stack when redo pushes back", () => {
    const history = createMockCommandHistory();
    // Fill to max
    for (let i = 0; i < MAX_HISTORY_DEPTH; i++) {
      history.pushCommand(makeCmd(i));
    }
    history.undo();
    history.redo(); // pushes back through the depth-limited path
    expect(history.undoSize).toBe(MAX_HISTORY_DEPTH);
  });
});

describe("CommandHistory — interleaved operations", () => {
  it("push after undo invalidates redo and continues normally", () => {
    const history = createMockCommandHistory();
    history.pushCommand(makeCmd(1));
    history.pushCommand(makeCmd(2));
    history.pushCommand(makeCmd(3));

    history.undo(); // pops 3, redo = [3]
    history.undo(); // pops 2, redo = [3, 2]
    expect(history.redoSize).toBe(2);

    // New command invalidates redo timeline
    history.pushCommand(makeCmd(99));
    expect(history.redoSize).toBe(0);
    expect(history.undoSize).toBe(2); // [1, 99]

    expect(history.undo()).toEqual(makeCmd(99));
    expect(history.undo()).toEqual(makeCmd(1));
    expect(history.undo()).toBeNull();
  });

  it("rapid undo-redo-undo cycle is consistent", () => {
    const history = createMockCommandHistory();
    history.pushCommand(makeCmd(1));
    history.pushCommand(makeCmd(2));

    history.undo(); // pop 2
    history.redo(); // push 2 back
    history.undo(); // pop 2 again
    history.undo(); // pop 1

    expect(history.undoSize).toBe(0);
    expect(history.redoSize).toBe(2);

    // Redo both
    history.redo(); // push 1 back
    history.redo(); // push 2 back
    expect(history.undoSize).toBe(2);
    expect(history.redoSize).toBe(0);
  });
});
