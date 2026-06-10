import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { captureRowFields, ITEM_ID_CASCADE_CAPTURE_FIELDS } from "../commandCapture";
import { ESTIMATE_ITEMS_MASTER } from "../mock-data";
import { applyImportMapping } from "../importEstimate";
import { primeCostCodeResolverFromCatalog, resetCostCodeResolver } from "../costCodeResolver";
import type { ProcessedTakeoffRow } from "@/types";

// ---------------------------------------------------------------------------
// commandCapture.test.ts — EDIT_CELL undo fidelity for the PRIMARY edited row
//
// An itemId edit derives 10 dependent fields on the edited row via
// applyCellEditDirect. The EDIT_CELL inverse only re-applies cmd.field, so the
// command payload must carry a self-cascade entry capturing those fields.
// These tests exercise the real capture helpers and then verify the dispatch
// merge semantics (`{ ...row, ...effect.prevFields }`, mirroring
// useCommandDispatch applyCommandInverse — same approach as
// commandHistory.test.ts, since @testing-library/react is unavailable).
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<ProcessedTakeoffRow> = {}): ProcessedTakeoffRow {
  return {
    id: "row-1",
    classification: "Cast In-Place Concrete",
    itemId: "03-0000.001",
    procoreParentCode: "3-30000.000",
    procoreCode: "3-30000.000",
    description: "Cast In-Place Concrete",
    matchedQty: 100,
    uom: "CY",
    unitPrice: 120,
    total: 12000,
    isMapped: true,
    rawQuantities: [{ qty: 100, uom: "CY" }],
    costType: "S",
    customFields: {},
    dataFidelity: "discrete_unit",
    source: "template",
    ...overrides,
  };
}

describe("ITEM_ID_CASCADE_CAPTURE_FIELDS contract", () => {
  it("covers every field applyCellEditDirect derives on an itemId edit", () => {
    // The mapped branch of applyCellEditDirect writes exactly these fields
    // (plus itemId itself). If this list drifts, undo loses fields silently.
    expect([...ITEM_ID_CASCADE_CAPTURE_FIELDS].sort()).toEqual(
      [
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
        "needsReview", // imported branch clears the ad-hoc flag (Phase 3)
        "dataFidelity",
      ].sort()
    );
  });

  it("includes the granular procoreCode (Phase 1 field)", () => {
    expect(ITEM_ID_CASCADE_CAPTURE_FIELDS).toContain("procoreCode");
  });
});

describe("captureRowFields", () => {
  it("snapshots exactly the named fields", () => {
    const row = makeRow();
    const captured = captureRowFields(row, ITEM_ID_CASCADE_CAPTURE_FIELDS);

    expect(Object.keys(captured).sort()).toEqual([...ITEM_ID_CASCADE_CAPTURE_FIELDS].sort());
    expect(captured.itemId).toBe("03-0000.001");
    expect(captured.procoreCode).toBe("3-30000.000");
    expect(captured.unitPrice).toBe(120);
    // Non-listed fields must not leak into the payload
    expect("classification" in captured).toBe(false);
    expect("rawQuantities" in captured).toBe(false);
  });
});

describe("imported-row grid assign (B-4 path) — as-imported fidelity + undo", () => {
  beforeAll(() => primeCostCodeResolverFromCatalog());
  afterAll(() => resetCostCodeResolver());

  it("keeps the as-bid dollars/description/UOM, clears needsReview, and undo restores the flag", () => {
    // An imported leftover (similar-tier, finished later in Flags): rawQuantities
    // is [] — the generic itemId branch would re-match qty against it and ZERO
    // the row's dollars. The imported branch routes through applyImportMapping.
    const imported = makeRow({
      id: "import-r42",
      source: "imported",
      itemId: "",
      procoreCode: "",
      procoreParentCode: "",
      classification: "Mystery Scope",
      description: "Mystery Scope",
      uom: "SF", // as-bid; catalog says LS for the assigned code
      unitPrice: 10,
      matchedQty: 300,
      total: 3000,
      isMapped: false,
      needsReview: true,
      rawQuantities: [],
    });

    // Exactly what the grid's imported branch applies (Object.assign merge).
    const next = { ...imported, ...applyImportMapping(imported, "06-1753.001") };
    expect(next.itemId).toBe("06-1753.001");
    expect(next.isMapped).toBe(true);
    expect(next.needsReview).toBe(false);
    // Historical fidelity: dollars + as-bid text/unit untouched.
    expect(next.matchedQty).toBe(300);
    expect(next.unitPrice).toBe(10);
    expect(next.total).toBe(3000);
    expect(next.description).toBe("Mystery Scope");
    expect(next.uom).toBe("SF");

    // Undo merge (applyCommandInverse EDIT_CELL idiom) restores the flag too —
    // needsReview is in ITEM_ID_CASCADE_CAPTURE_FIELDS for exactly this case.
    const effect = {
      rowId: imported.id,
      prevFields: captureRowFields(imported, ITEM_ID_CASCADE_CAPTURE_FIELDS),
      nextFields: captureRowFields(next, ITEM_ID_CASCADE_CAPTURE_FIELDS),
    };
    const undone = { ...next, ...effect.prevFields };
    expect(undone.itemId).toBe("");
    expect(undone.isMapped).toBe(false);
    expect(undone.needsReview).toBe(true);
    expect(undone.total).toBe(3000);
  });
});

describe("EDIT_CELL undo restores the primary row's derived fields", () => {
  it("a self-cascade entry round-trips an itemId change across divisions", () => {
    // Simulate: row starts as catalog item 03-0000.001 and is edited to
    // 09-9000.001 (Painting). Build prev/next captures from catalog-derived
    // states exactly as commitCellEdit's simulation does.
    const prevItem = ESTIMATE_ITEMS_MASTER["03-0000.001"];
    const nextItem = ESTIMATE_ITEMS_MASTER["09-9000.001"];
    expect(prevItem).toBeDefined();
    expect(nextItem).toBeDefined();

    const prevState = makeRow({
      itemId: prevItem.itemId,
      description: prevItem.description,
      procoreParentCode: prevItem.procoreParentCode,
      procoreCode: prevItem.procoreCode,
      unitPrice: prevItem.defaultUnitPrice,
      uom: prevItem.targetUom,
      costType: prevItem.costType,
    });
    const nextState = makeRow({
      itemId: nextItem.itemId,
      description: nextItem.description,
      procoreParentCode: nextItem.procoreParentCode,
      procoreCode: nextItem.procoreCode,
      unitPrice: nextItem.defaultUnitPrice,
      uom: nextItem.targetUom,
      costType: nextItem.costType,
    });

    const selfEffect = {
      rowId: "row-1",
      prevFields: captureRowFields(prevState, ITEM_ID_CASCADE_CAPTURE_FIELDS),
      nextFields: captureRowFields(nextState, ITEM_ID_CASCADE_CAPTURE_FIELDS),
    };

    // Mirror applyCommandInverse EDIT_CELL: cmd.field=prevValue, then merge
    // each cascade effect's prevFields by rowId.
    const postEditRow = { ...nextState };
    let undone: ProcessedTakeoffRow = { ...postEditRow, itemId: prevItem.itemId };
    undone = { ...undone, ...selfEffect.prevFields };

    expect(undone.itemId).toBe("03-0000.001");
    expect(undone.description).toBe(prevItem.description);
    expect(undone.procoreParentCode).toBe(prevItem.procoreParentCode);
    expect(undone.procoreCode).toBe(prevItem.procoreCode);
    expect(undone.unitPrice).toBe(prevItem.defaultUnitPrice);
    expect(undone.uom).toBe(prevItem.targetUom);
    expect(undone.costType).toBe(prevItem.costType);
    expect(undone.isMapped).toBe(true);

    // Mirror applyCommandForward (redo): cmd.field=nextValue + nextFields merge.
    let redone: ProcessedTakeoffRow = { ...undone, itemId: nextItem.itemId };
    redone = { ...redone, ...selfEffect.nextFields };
    expect(redone.procoreCode).toBe(nextItem.procoreCode);
    expect(redone.description).toBe(nextItem.description);
  });

  it("restores the unmapped state when undoing a fix of an unknown code", () => {
    // prev state: unknown code (unmapped branch of applyCellEditDirect)
    const prevState = makeRow({
      itemId: "99-9999.999",
      description: "UNMAPPED - RECONCILE CODE",
      procoreParentCode: "",
      procoreCode: "",
      unitPrice: 0,
      total: 0,
      isMapped: false,
      costType: "M",
    });
    const nextItem = ESTIMATE_ITEMS_MASTER["09-9000.001"];
    const nextState = makeRow({
      itemId: nextItem.itemId,
      procoreCode: nextItem.procoreCode,
      unitPrice: nextItem.defaultUnitPrice,
      isMapped: true,
    });

    const selfEffect = {
      rowId: "row-1",
      prevFields: captureRowFields(prevState, ITEM_ID_CASCADE_CAPTURE_FIELDS),
      nextFields: captureRowFields(nextState, ITEM_ID_CASCADE_CAPTURE_FIELDS),
    };

    let undone: ProcessedTakeoffRow = { ...nextState, itemId: "99-9999.999" };
    undone = { ...undone, ...selfEffect.prevFields };
    expect(undone.procoreCode).toBe("");
    expect(undone.isMapped).toBe(false);
    expect(undone.unitPrice).toBe(0);
    expect(undone.description).toBe("UNMAPPED - RECONCILE CODE");
  });
});
