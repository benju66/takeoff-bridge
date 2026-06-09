/// <reference types="vitest" />
/**
 * import-integrity.test.ts — Phase 3 / INV-8 (#3): no silent row drop on import.
 *
 * A parsed row with a VALID itemId but no matching template row must be APPENDED to the grid
 * (visible, provenance 'csv_import', placed in its CSI division) — never dropped — and the
 * whole merge must reverse in ONE undo (AGENTS.md compounding-history). A no-itemId row is
 * surfaced as unmapped, never silently merged. These exercise the REAL pure merge functions
 * (src/lib/mergeTakeoff.ts) that useFileIngestion and useCommandDispatch both call, so the
 * test proves the production undo/redo path, not a re-implementation of it.
 */

import { describe, it, expect } from "vitest";
import { computeMergeResult, applyMergeForward, applyMergeInverse } from "@/lib/mergeTakeoff";
import { parseTogalCSV } from "@/lib/parser";
import { ESTIMATE_ITEMS_MASTER } from "@/lib/mock-data";
import type { ProcessedTakeoffRow, TogalRowPayload } from "@/types";

const THRESHOLD = 5000;
const KEYWORDS = ["LS", "SUM", "ALLW", "LUMP"];

// Codes that exist in the catalog (so the parser resolves a valid itemId).
const TEMPLATE_CODE = "03-0000.001"; // present in the template grid below
const OFF_TEMPLATE_CODE = "09-9000.001"; // valid catalog code, ABSENT from the template

function tRow(overrides: Partial<ProcessedTakeoffRow>): ProcessedTakeoffRow {
  return {
    id: "t",
    classification: "Template Row",
    itemId: "00-0000",
    procoreParentCode: "",
    procoreCode: "",
    description: "Template Row",
    matchedQty: 0,
    uom: "SF",
    unitPrice: 100,
    total: 0,
    isMapped: true,
    rawQuantities: [],
    costType: "M",
    customFields: {},
    source: "template",
    ...overrides,
  };
}

function buildParsed(): ProcessedTakeoffRow[] {
  const file: TogalRowPayload[] = [
    {
      Classification: `${TEMPLATE_CODE} - Concrete`,
      "Quantity 1": "10",
      "Quantity1 UOM": ESTIMATE_ITEMS_MASTER[TEMPLATE_CODE].targetUom,
    },
    {
      Classification: `${OFF_TEMPLATE_CODE} - Painting`,
      "Quantity 1": "5",
      "Quantity1 UOM": ESTIMATE_ITEMS_MASTER[OFF_TEMPLATE_CODE].targetUom,
    },
    { Classification: "Totally Unknown Thing XYZ", "Quantity 1": "7" } as TogalRowPayload,
  ];
  return parseTogalCSV(file);
}

describe("INV-8 #3 — an off-template valid code is appended, not dropped", () => {
  // Template grid: one div-03 row (matched), one div-09 row (so the appended 09 code groups
  // into its division), and NO 09-9000.001.
  const currentRows: ProcessedTakeoffRow[] = [
    tRow({ id: `row-${TEMPLATE_CODE}`, itemId: TEMPLATE_CODE, classification: "Existing Concrete" }),
    tRow({ id: "row-09-1000.001", itemId: "09-1000.001", classification: "Existing Painting Misc" }),
  ];

  const parsed = buildParsed();
  const offParsed = parsed.find((r) => r.itemId === OFF_TEMPLATE_CODE)!;
  const matchParsed = parsed.find((r) => r.itemId === TEMPLATE_CODE)!;

  it("the parser resolves the codes and the imported quantities are non-zero", () => {
    expect(offParsed).toBeDefined();
    expect(offParsed.matchedQty).toBe(5);
    expect(matchParsed.matchedQty).toBe(10);
  });

  const { updatedRows, command, unmappedList } = computeMergeResult(
    currentRows, parsed, [], /* appendData */ true, THRESHOLD, KEYWORDS,
  );

  it("the no-itemId classification is surfaced as unmapped, never silently merged", () => {
    expect(unmappedList).toEqual(["Totally Unknown Thing XYZ"]);
    expect(updatedRows.some((r) => r.classification === "Totally Unknown Thing XYZ")).toBe(false);
  });

  it("the off-template code is APPENDED with its quantity preserved and full provenance", () => {
    const appended = updatedRows.find((r) => r.itemId === OFF_TEMPLATE_CODE);
    expect(appended).toBeDefined();
    expect(appended!.id).toBe(`import-${OFF_TEMPLATE_CODE}`);
    expect(appended!.matchedQty).toBe(offParsed.matchedQty); // visible, preserved
    expect(appended!.source).toBe("csv_import");

    // AGENTS.md Data-Interface-Integrity: every non-nullable field is initialized.
    for (const key of [
      "id", "classification", "itemId", "procoreParentCode", "procoreCode", "description",
      "matchedQty", "uom", "unitPrice", "total", "isMapped", "rawQuantities", "costType",
    ] as const) {
      expect(appended![key]).not.toBeUndefined();
    }
  });

  it("the appended row is placed within its CSI division (right after the div-09 row)", () => {
    const div09Idx = updatedRows.findIndex((r) => r.id === "row-09-1000.001");
    const appendedIdx = updatedRows.findIndex((r) => r.id === `import-${OFF_TEMPLATE_CODE}`);
    expect(appendedIdx).toBe(div09Idx + 1);
  });

  it("only one row is added; the matched code accumulates into its template row", () => {
    expect(updatedRows).toHaveLength(currentRows.length + 1);
    const t03 = updatedRows.find((r) => r.id === `row-${TEMPLATE_CODE}`)!;
    expect(t03.matchedQty).toBe(matchParsed.matchedQty); // 0 + 10
  });

  it("the command carries the appended row separately from the existing-row diffs", () => {
    expect(command.appendedRows).toHaveLength(1);
    expect(command.appendedRows![0].itemId).toBe(OFF_TEMPLATE_CODE);
    expect(command.nextRowStates.some((ns) => ns.rowId === `import-${OFF_TEMPLATE_CODE}`)).toBe(false);
    expect(command.prevRowStates).toHaveLength(currentRows.length);
  });

  it("ONE undo reverses the whole merge (appended row gone, template fields restored)", () => {
    const undone = applyMergeInverse(updatedRows, command);
    expect(undone).toHaveLength(currentRows.length);
    expect(undone.find((r) => r.itemId === OFF_TEMPLATE_CODE)).toBeUndefined();

    const t03 = undone.find((r) => r.id === `row-${TEMPLATE_CODE}`)!;
    expect(t03.matchedQty).toBe(0);
    expect(t03.classification).toBe("Existing Concrete");
  });

  it("redo re-applies the merge faithfully (appended back, in its division, qty intact)", () => {
    const undone = applyMergeInverse(updatedRows, command);
    const redone = applyMergeForward(undone, command);

    expect(redone).toHaveLength(updatedRows.length);
    const appended = redone.find((r) => r.itemId === OFF_TEMPLATE_CODE);
    expect(appended).toBeDefined();
    expect(appended!.matchedQty).toBe(offParsed.matchedQty);

    const div09Idx = redone.findIndex((r) => r.id === "row-09-1000.001");
    const appendedIdx = redone.findIndex((r) => r.id === `import-${OFF_TEMPLATE_CODE}`);
    expect(appendedIdx).toBe(div09Idx + 1);

    const t03 = redone.find((r) => r.id === `row-${TEMPLATE_CODE}`)!;
    expect(t03.matchedQty).toBe(matchParsed.matchedQty);
  });
});

describe("INV-8 #3 — replace-mode still appends off-template codes", () => {
  it("appendData=false resets template rows but the off-template code is still appended", () => {
    const currentRows: ProcessedTakeoffRow[] = [
      tRow({ id: `row-${TEMPLATE_CODE}`, itemId: TEMPLATE_CODE, matchedQty: 999, total: 99900 }),
    ];
    const parsed = buildParsed();
    const { updatedRows } = computeMergeResult(
      currentRows, parsed, [], /* appendData */ false, THRESHOLD, KEYWORDS,
    );
    // The off-template code is appended even in replace mode.
    expect(updatedRows.find((r) => r.itemId === OFF_TEMPLATE_CODE)).toBeDefined();
    // The matched template row reflects the imported qty (reset to 0, then + parsed).
    const matchParsed = parsed.find((r) => r.itemId === TEMPLATE_CODE)!;
    const t03 = updatedRows.find((r) => r.id === `row-${TEMPLATE_CODE}`)!;
    expect(t03.matchedQty).toBe(matchParsed.matchedQty);
  });
});

describe("INV-8 #3 — replace mode discards prior imported rows (no phantom $0 rows)", () => {
  const templateRows: ProcessedTakeoffRow[] = [
    tRow({ id: `row-${TEMPLATE_CODE}`, itemId: TEMPLATE_CODE, classification: "Existing Concrete" }),
  ];

  it("a prior append-imported off-template row is removed (not zeroed) on a later replace-import", () => {
    // 1. Append import adds the off-template row to the grid.
    const afterAppend = computeMergeResult(
      templateRows, buildParsed(), [], /* appendData */ true, THRESHOLD, KEYWORDS,
    ).updatedRows;
    expect(afterAppend.find((r) => r.itemId === OFF_TEMPLATE_CODE)).toBeDefined();

    // 2. Replace import of a file that does NOT mention that code.
    const parsedB = parseTogalCSV([
      {
        Classification: `${TEMPLATE_CODE} - Concrete`,
        "Quantity 1": "3",
        "Quantity1 UOM": ESTIMATE_ITEMS_MASTER[TEMPLATE_CODE].targetUom,
      },
    ]);
    const { updatedRows, command } = computeMergeResult(
      afterAppend, parsedB, [], /* appendData */ false, THRESHOLD, KEYWORDS,
    );

    // No phantom: the prior import row is GONE, not left as a blank $0 zombie.
    expect(updatedRows.find((r) => r.itemId === OFF_TEMPLATE_CODE)).toBeUndefined();
    expect(updatedRows.some((r) => r.id.startsWith("import-") && r.classification === "")).toBe(false);
    expect(command.removedRows).toHaveLength(1);
    expect(command.removedRows![0].itemId).toBe(OFF_TEMPLATE_CODE);

    // Atomic both ways: undo restores the prior import row with its quantity; redo discards it.
    const undone = applyMergeInverse(updatedRows, command);
    const restored = undone.find((r) => r.itemId === OFF_TEMPLATE_CODE);
    expect(restored).toBeDefined();
    expect(restored!.matchedQty).toBe(5); // the originally-imported quantity, preserved

    const redone = applyMergeForward(undone, command);
    expect(redone.find((r) => r.itemId === OFF_TEMPLATE_CODE)).toBeUndefined();
  });
});
