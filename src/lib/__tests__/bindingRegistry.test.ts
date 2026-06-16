/**
 * Phase 2 keystone proof: the value registry + binding engine reproduce the app's
 * existing linked-division behavior EXACTLY, end to end, for BOTH branches — so the
 * page can read the engine's output as a drop-in with zero golden movement.
 *
 *   - APP-BORN: engine === computeLinkedDivisionTotals for all 10 rows (the oracle).
 *   - IMPORTED: engine === linkedTotalsFromRows (linked nodes are CONSTANTS from the
 *     saved rows, NOT lookups into STEP 2/3 — the §6 highest-risk item). The imported
 *     branch is proven to depend ONLY on the saved rows, never on STEP 2/3.
 *
 * Fixtures flow from the calculation authority (computePersonnelCosts /
 * computeSiteOperations) — never invented totals.
 */
import { describe, it, expect } from "vitest";
import {
  computePersonnelCosts,
  computeSiteOperations,
  computeLinkedDivisionTotals,
  type LinkedDivisionTotal,
  type PersonnelCalcResult,
  type SiteOpsCalcResult,
} from "../calculations";
import { linkedTotalsFromRows } from "../importEstimate";
import { LINKED_DIVISION_ROWS } from "../constants";
import type { ProcessedTakeoffRow } from "@/types";
import { evaluateGraph } from "../bindings/graph";
import {
  computeLinkedDivisionTotalsViaEngine,
  computeImportedLinkedDivisionTotalsViaEngine,
  gcSiteOpsSourceNodes,
  linkedDivisionBindings,
  linkedRowTotalNodeId,
  lineFieldSourceNodes,
  projectLine,
  GC_GENERAL_NODE_ID,
  GC_GRAND_TOTAL_NODE_ID,
  GC_SUPERVISION_NODE_ID,
  siteOpsSectionNodeId,
} from "../bindings/registry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Asserts two LinkedDivisionTotal[] match to the cent (and beyond) and in shape. */
function expectLinkedEqual(actual: LinkedDivisionTotal[], expected: LinkedDivisionTotal[]) {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i].itemId).toBe(expected[i].itemId);
    expect(actual[i].description).toBe(expected[i].description);
    expect(actual[i].sourceLabel).toBe(expected[i].sourceLabel);
    // Bit-identical in practice (×1+0 / identical sum order); 8dp is exact past the cent.
    expect(actual[i].total).toBeCloseTo(expected[i].total, 8);
  }
}

let nextId = 0;
function makeRow(over: Partial<ProcessedTakeoffRow> = {}): ProcessedTakeoffRow {
  return {
    id: over.id ?? `row-${nextId++}`,
    classification: "",
    itemId: "",
    procoreParentCode: "",
    procoreCode: "",
    description: "",
    matchedQty: 0,
    uom: "",
    unitPrice: 0,
    total: 0,
    isMapped: false,
    rawQuantities: [],
    costType: "",
    ...over,
  };
}

// App-born fixtures — a populated bid and the all-zero edge case.
const gcPopulated: PersonnelCalcResult = computePersonnelCosts(
  12,
  30000,
  { ex: 50, su: 100, srSu: 25 },
  { dumpsters: 1000, toilets: 2000, electric: 3000 },
  { designCivil: 18500, tempOfficeSetup: 1 }
);
const siteOpsPopulated: SiteOpsCalcResult = computeSiteOperations(
  12,
  10000,
  { knox: 2, demolition: 500, sawcutting: 950, finalCleaning: 3, swpppPermit: 1, surveyLayout: 4000, equipmentRental: 2, materialsTesting: 6000 },
  {}
);
const gcZero = computePersonnelCosts(0, 0, {}, { dumpsters: 0, toilets: 0, electric: 0 });
const siteOpsZero = computeSiteOperations(0, 0, {}, {});

// ---------------------------------------------------------------------------
// App-born equivalence — engine === computeLinkedDivisionTotals
// ---------------------------------------------------------------------------

describe("registry — app-born engine reproduces computeLinkedDivisionTotals", () => {
  it("matches the oracle for all 10 rows on a populated bid", () => {
    const legacy = computeLinkedDivisionTotals(gcPopulated, siteOpsPopulated);
    const engine = computeLinkedDivisionTotalsViaEngine(gcPopulated, siteOpsPopulated);
    expectLinkedEqual(engine, legacy);
    // Sanity: the populated fixture actually has non-zero linked values to tie.
    expect(engine.some((l) => l.total > 0)).toBe(true);
  });

  it("matches the oracle for the all-zero edge case (every linked total = 0)", () => {
    const legacy = computeLinkedDivisionTotals(gcZero, siteOpsZero);
    const engine = computeLinkedDivisionTotalsViaEngine(gcZero, siteOpsZero);
    expectLinkedEqual(engine, legacy);
    expect(engine.every((l) => l.total === 0)).toBe(true);
  });

  it("matches the oracle when only STEP 2 (GCs) carry dollars", () => {
    const legacy = computeLinkedDivisionTotals(gcPopulated, siteOpsZero);
    const engine = computeLinkedDivisionTotalsViaEngine(gcPopulated, siteOpsZero);
    expectLinkedEqual(engine, legacy);
  });

  it("matches the oracle when only STEP 3 (Site Ops) carry dollars", () => {
    const legacy = computeLinkedDivisionTotals(gcZero, siteOpsPopulated);
    const engine = computeLinkedDivisionTotalsViaEngine(gcZero, siteOpsPopulated);
    expectLinkedEqual(engine, legacy);
  });

  it("preserves the oracle invariant: the 10 linked totals sum to GC + Site Ops grand totals", () => {
    const engine = computeLinkedDivisionTotalsViaEngine(gcPopulated, siteOpsPopulated);
    const sum = engine.reduce((s, l) => s + l.total, 0);
    expect(sum).toBeCloseTo(gcPopulated.grandTotal + siteOpsPopulated.grandTotal, 6);
  });
});

// ---------------------------------------------------------------------------
// Source-node + binding structure (kind-blind graph, derived gc:general)
// ---------------------------------------------------------------------------

describe("registry — source nodes and lookup bindings", () => {
  it("emits the expected STEP 2/3 source node IDs", () => {
    const ids = new Set(gcSiteOpsSourceNodes(gcPopulated, siteOpsPopulated).map((n) => n.id));
    expect(ids.has(GC_GRAND_TOTAL_NODE_ID)).toBe(true);
    expect(ids.has(GC_SUPERVISION_NODE_ID)).toBe(true);
    expect(ids.has(GC_GENERAL_NODE_ID)).toBe(true);
    // One siteops node per section a linked row reads (the 8 02.A–02.H sections).
    for (const cfg of LINKED_DIVISION_ROWS) {
      if (cfg.source.kind === "siteOpsSection") {
        expect(ids.has(siteOpsSectionNodeId(cfg.source.section))).toBe(true);
      }
    }
  });

  it("models gc:general as a DERIVED node (grandTotal − supervision), not a constant", () => {
    const nodes = gcSiteOpsSourceNodes(gcPopulated, siteOpsPopulated);
    const general = nodes.find((n) => n.id === GC_GENERAL_NODE_ID)!;
    // It depends on the other two GC nodes — so the graph orders it after them.
    expect(general.inputs).toEqual([GC_GRAND_TOTAL_NODE_ID, GC_SUPERVISION_NODE_ID]);
    const values = evaluateGraph(nodes);
    const grand = values.get(GC_GRAND_TOTAL_NODE_ID)!;
    const supervision = values.get(GC_SUPERVISION_NODE_ID)!;
    expect(values.get(GC_GENERAL_NODE_ID)).toBeCloseTo(grand - supervision, 8);
  });

  it("expresses exactly the 10 linked rows as lookup bindings, by source.kind", () => {
    const bindings = linkedDivisionBindings();
    expect(bindings).toHaveLength(LINKED_DIVISION_ROWS.length);
    for (let i = 0; i < bindings.length; i++) {
      const cfg = LINKED_DIVISION_ROWS[i];
      const b = bindings[i];
      expect(b.targetNodeId).toBe(linkedRowTotalNodeId(cfg.itemId));
      expect(b.definition.kind).toBe("lookup");
      const expectedSource =
        cfg.source.kind === "gcSupervision"
          ? GC_SUPERVISION_NODE_ID
          : cfg.source.kind === "gcGeneral"
            ? GC_GENERAL_NODE_ID
            : siteOpsSectionNodeId(cfg.source.section);
      expect(b.definition.kind === "lookup" && b.definition.source).toBe(expectedSource);
    }
  });
});

// ---------------------------------------------------------------------------
// Imported equivalence — engine === linkedTotalsFromRows, sourced from saved rows
// ---------------------------------------------------------------------------

describe("registry — imported engine reproduces linkedTotalsFromRows", () => {
  // A finished-bid row set: linked rows carry hand-authored lump sums (qty × price),
  // interleaved with a normal takeoff row and a DUPLICATE linked itemId (first wins).
  const importedRows: ProcessedTakeoffRow[] = [
    makeRow({ itemId: "09-2100.001", matchedQty: 10, unitPrice: 99, description: "Takeoff line" }),
    makeRow({ itemId: "01-0400.002", matchedQty: 1, unitPrice: 48250.75, description: "row desc Supervision" }),
    makeRow({ itemId: "02-0000.001", matchedQty: 1, unitPrice: 12000 }),
    makeRow({ itemId: "01-0000.001", matchedQty: 1, unitPrice: 250000 }),
    makeRow({ itemId: "01-0400.002", matchedQty: 1, unitPrice: 99999 }), // dup — must be ignored
    makeRow({ itemId: "02-4100.002", matchedQty: 2, unitPrice: 3025 }),
  ];

  it("matches linkedTotalsFromRows exactly (order, dedupe, description/sourceLabel fallback)", () => {
    const legacy = linkedTotalsFromRows(importedRows);
    const engine = computeImportedLinkedDivisionTotalsViaEngine(importedRows);
    expectLinkedEqual(engine, legacy);
  });

  it("sources each linked total from the saved row's matchedQty × unitPrice", () => {
    const engine = computeImportedLinkedDivisionTotalsViaEngine(importedRows);
    const byId = new Map(engine.map((l) => [l.itemId, l.total]));
    expect(byId.get("01-0400.002")).toBeCloseTo(48250.75, 8); // first occurrence, not the dup
    expect(byId.get("01-0000.001")).toBeCloseTo(250000, 8);
    expect(byId.get("02-4100.002")).toBeCloseTo(6050, 8);
  });

  it("returns an empty list when no linked rows are present", () => {
    const rows = [makeRow({ itemId: "09-2100.001", matchedQty: 1, unitPrice: 100 })];
    expect(computeImportedLinkedDivisionTotalsViaEngine(rows)).toEqual([]);
    expect(computeImportedLinkedDivisionTotalsViaEngine([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §6 highest-risk item: imported linked nodes are CONSTANTS from saved rows,
// NOT lookups into STEP 2/3 — proven by branch divergence.
// ---------------------------------------------------------------------------

describe("registry — imported branch never re-derives from STEP 2/3 (the §6 trap)", () => {
  // The same itemIds, but the saved-row dollars deliberately DIFFER from whatever
  // STEP 2/3 would parametrically compute for them.
  const savedRows: ProcessedTakeoffRow[] = [
    makeRow({ itemId: "01-0400.002", matchedQty: 1, unitPrice: 11111 }),
    makeRow({ itemId: "01-0000.001", matchedQty: 1, unitPrice: 22222 }),
    makeRow({ itemId: "02-0000.001", matchedQty: 1, unitPrice: 33333 }),
  ];

  it("imported totals equal the saved-row dollars, regardless of STEP 2/3", () => {
    const imported = computeImportedLinkedDivisionTotalsViaEngine(savedRows);
    const byId = new Map(imported.map((l) => [l.itemId, l.total]));
    expect(byId.get("01-0400.002")).toBe(11111);
    expect(byId.get("01-0000.001")).toBe(22222);
    expect(byId.get("02-0000.001")).toBe(33333);
  });

  it("imported and app-born branches DIVERGE for the same itemIds (different source)", () => {
    // App-born derives these from the populated STEP 2/3 calc results...
    const appBorn = computeLinkedDivisionTotalsViaEngine(gcPopulated, siteOpsPopulated);
    const appById = new Map(appBorn.map((l) => [l.itemId, l.total]));
    // ...the imported branch ignores STEP 2/3 entirely and uses the saved rows.
    const imported = computeImportedLinkedDivisionTotalsViaEngine(savedRows);
    const impById = new Map(imported.map((l) => [l.itemId, l.total]));
    // Supervision is non-trivial app-born, but fixed at 11111 imported — they must differ,
    // proving the imported branch is NOT a STEP 2/3 lookup.
    expect(appById.get("01-0400.002")).not.toBeCloseTo(impById.get("01-0400.002")!, 2);
  });
});

// ---------------------------------------------------------------------------
// STEP 4 line-field source nodes — Phase 3 rollup groundwork
// ---------------------------------------------------------------------------

describe("registry — line-field source nodes (rollup groundwork)", () => {
  it("emits a constant node per field for every line a SetRule could match", () => {
    const lines = [
      projectLine(makeRow({ id: "a", itemId: "03-0000.001", matchedQty: 10, unitPrice: 25, total: 250 })),
      projectLine(makeRow({ id: "b", itemId: "03-1000.002", matchedQty: 4, unitPrice: 100, total: 400 })),
    ];
    const nodes = lineFieldSourceNodes(lines);
    expect(nodes).toHaveLength(lines.length * 3);
    const values = evaluateGraph(nodes);
    expect(values.get("line:a:total")).toBe(250);
    expect(values.get("line:a:unitPrice")).toBe(25);
    expect(values.get("line:a:matchedQty")).toBe(10);
    expect(values.get("line:b:total")).toBe(400);
  });

  it("projectLine maps the row's SetRule-addressable + numeric fields (absent source → \"\")", () => {
    const line = projectLine(
      makeRow({ id: "x", itemId: "09-2100.001", costType: "L", procoreCode: "9-90000.000", matchedQty: 3, unitPrice: 7, total: 21 })
    );
    expect(line).toEqual({
      id: "x",
      itemId: "09-2100.001",
      costType: "L",
      source: "",
      procoreCode: "9-90000.000",
      total: 21,
      unitPrice: 7,
      matchedQty: 3,
    });
  });
});
