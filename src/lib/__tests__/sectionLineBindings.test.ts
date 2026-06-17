/**
 * GC/Site-Ops Addressability Phase A5 — section lines as BindingLines / source nodes.
 *
 * Proves the addressability gap (Linked Values LD-1) is closed: the new A3/A4
 * `EstimateSectionLine` rows project to `line:<id>:total` graph source nodes and fold
 * into `assembleBindingGraphNodes`, so a GC/Site-Ops line can be a binding TARGET and a
 * rollup MEMBER — the same way STEP 4 rows already can. The money-safety law from A4
 * carries through: APP-BORN lines expose the live engine per-line total; IMPORTED lines
 * expose the FROZEN `inputs.value` as a CONSTANT (never recomputed). The fold stays INERT
 * by default, so a project with no user bindings builds zero nodes and the goldens tie.
 */
import { describe, it, expect } from "vitest";
import {
  computePersonnelCosts,
  computeSiteOperations,
  type PersonnelCalcResult,
  type SiteOpsCalcResult,
} from "../calculations";
import {
  recomputeLineBindingValues,
  assembleBindingGraphNodes,
  projectSectionLine,
  projectAppBornSectionLines,
  projectImportedSectionLines,
  GC_GRAND_TOTAL_NODE_ID,
} from "../bindings/registry";
import { lineFieldNodeId } from "../bindings/compile";
import { synthesizeImportedSectionLines } from "../sectionLines/imported";
import type { Binding } from "../bindings/types";
import type { EstimateSectionLine, ImportedStep23Lines, ImportedSheetLine } from "@/types/db";
import type { ProcessedTakeoffRow } from "@/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Real calc results (the engine is the sole total authority — A5 only reads its totals).
const gc: PersonnelCalcResult = computePersonnelCosts(
  12,
  30000,
  { ex: 50, su: 100, srSu: 25 },
  { dumpsters: 1000, toilets: 2000, electric: 3000 },
  { designCivil: 18500 }
);
const siteOps: SiteOpsCalcResult = computeSiteOperations(12, 10000, { knox: 2 }, {});

let nextId = 0;
function makeRow(over: Partial<ProcessedTakeoffRow> = {}): ProcessedTakeoffRow {
  return {
    id: over.id ?? `row-fixture-${nextId++}`,
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

function makeSectionLine(over: Partial<EstimateSectionLine> = {}): EstimateSectionLine {
  return {
    id: "gc:staff:test",
    projectId: "",
    section: "gc",
    code: "",
    procoreCode: "",
    costType: "",
    label: "",
    entryKind: "staffRole",
    inputs: {},
    sortOrder: 0,
    source: "template",
    updatedAt: "",
    ...over,
  };
}

function makeImportedLine(over: Partial<ImportedSheetLine> = {}): ImportedSheetLine {
  return {
    code: "1-10000.000",
    description: "Project Manager",
    utilization: null,
    qty: 3,
    rate: 100,
    total: 777, // deliberately !== qty*rate (300) — the lump is the authority
    rowNumber: 1,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Projection — the single total-resolution seam
// ---------------------------------------------------------------------------

describe("projectSectionLine", () => {
  it("maps identity onto a BindingLine; unitPrice/matchedQty are 0 (no qty×price decomposition)", () => {
    const line = makeSectionLine({
      id: "gc:staff:ex",
      code: "01-0310.001",
      costType: "L",
      procoreCode: "1-10000.000",
      source: "template",
    });
    const bl = projectSectionLine(line, 4242);
    expect(bl).toEqual({
      id: "gc:staff:ex",
      itemId: "01-0310.001", // itemId IS the section line's code (SetRule-addressable)
      costType: "L",
      source: "template",
      procoreCode: "1-10000.000",
      total: 4242,
      unitPrice: 0,
      matchedQty: 0,
    });
  });
});

describe("projectAppBornSectionLines", () => {
  it("resolves each line's total from the live engine result BY (section, code)", () => {
    const staff0 = gc.staffLines[0];
    const dyn0 = siteOps.dynamicLines[0];
    const gcLine = makeSectionLine({ id: "gc:staff:0", section: "gc", code: staff0.code });
    const soLine = makeSectionLine({ id: "siteops:dynamic:0", section: "site_ops", code: dyn0.code });

    const projected = projectAppBornSectionLines([gcLine, soLine], gc, siteOps);

    expect(projected.find((l) => l.id === "gc:staff:0")!.total).toBeCloseTo(staff0.total, 8);
    expect(projected.find((l) => l.id === "siteops:dynamic:0")!.total).toBeCloseTo(dyn0.total, 8);
  });

  it("resolves an unmatched code to 0 (no fabricated total)", () => {
    const line = makeSectionLine({ id: "gc:staff:ghost", section: "gc", code: "99-9999.999" });
    expect(projectAppBornSectionLines([line], gc, siteOps)[0].total).toBe(0);
  });
});

describe("projectImportedSectionLines", () => {
  it("projects the FROZEN inputs.value as the total — NOT qty×rate (constant, never recomputed)", () => {
    const imported: ImportedStep23Lines = {
      step2Lines: [makeImportedLine({ rowNumber: 1, qty: 3, rate: 100, total: 777 })],
      step3Lines: [],
      linkedSourceSubtotals: [],
    };
    const lines = synthesizeImportedSectionLines(imported);
    const projected = projectImportedSectionLines(lines);

    expect(projected).toHaveLength(1);
    expect(projected[0].total).toBe(777); // the as-bid lump, not 3×100=300
  });

  it("CONSTANTS gate: mutating qty/rate with the frozen total held does NOT move the projected total", () => {
    const base: ImportedStep23Lines = {
      step2Lines: [makeImportedLine({ rowNumber: 1, qty: 3, rate: 100, total: 777 })],
      step3Lines: [],
      linkedSourceSubtotals: [],
    };
    const mutated: ImportedStep23Lines = {
      step2Lines: [makeImportedLine({ rowNumber: 1, qty: 999, rate: 0.5, total: 777 })],
      step3Lines: [],
      linkedSourceSubtotals: [],
    };
    const baseTotal = projectImportedSectionLines(synthesizeImportedSectionLines(base))[0].total;
    const mutatedTotal = projectImportedSectionLines(synthesizeImportedSectionLines(mutated))[0].total;
    expect(mutatedTotal).toBe(baseTotal);
    expect(mutatedTotal).toBe(777);
  });
});

// ---------------------------------------------------------------------------
// Fold — a section line is a binding TARGET and a rollup MEMBER
// ---------------------------------------------------------------------------

describe("section lines folded into the binding engine", () => {
  const staff0 = gc.staffLines[0];
  const staff1 = gc.staffLines[1];
  const lineA = makeSectionLine({ id: "gc:staff:a", section: "gc", code: staff0.code });
  const lineB = makeSectionLine({ id: "gc:staff:b", section: "gc", code: staff1.code });
  const sectionBindingLines = projectAppBornSectionLines([lineA, lineB], gc, siteOps);

  it("a lookup READING a section line resolves to that line's total", () => {
    const target = makeRow({ id: "row-target", total: 0 });
    const binding: Binding = {
      targetNodeId: lineFieldNodeId("row-target", "total"),
      basis: "currency",
      definition: { kind: "lookup", source: lineFieldNodeId("gc:staff:a", "total") },
    };
    const result = recomputeLineBindingValues(
      [binding],
      gc,
      siteOps,
      [target],
      sectionBindingLines
    );
    expect(result.get(lineFieldNodeId("row-target", "total"))).toBeCloseTo(staff0.total, 8);
  });

  it("a rollup AGGREGATING section lines sums their totals (explicitIds membership)", () => {
    const target = makeRow({ id: "row-rollup", total: 0 });
    const binding: Binding = {
      targetNodeId: lineFieldNodeId("row-rollup", "total"),
      basis: "currency",
      definition: {
        kind: "rollup",
        op: "sum",
        field: "total",
        set: { explicitIds: ["gc:staff:a", "gc:staff:b"] },
      },
    };
    const result = recomputeLineBindingValues(
      [binding],
      gc,
      siteOps,
      [target],
      sectionBindingLines
    );
    expect(result.get(lineFieldNodeId("row-rollup", "total"))).toBeCloseTo(
      staff0.total + staff1.total,
      8
    );
  });

  it("a section line is itself a binding TARGET (its constant is replaced by the bound value)", () => {
    // Bind the section line's total node to a STEP 2 source — the cell becomes derived.
    const binding: Binding = {
      targetNodeId: lineFieldNodeId("gc:staff:a", "total"),
      basis: "currency",
      definition: { kind: "lookup", source: GC_GRAND_TOTAL_NODE_ID },
    };
    const result = recomputeLineBindingValues([binding], gc, siteOps, [], sectionBindingLines);
    expect(result.get(lineFieldNodeId("gc:staff:a", "total"))).toBeCloseTo(gc.grandTotal, 8);
  });

  it("an IMPORTED section line is a CONSTANT source (lookup reads its frozen value, not the engine)", () => {
    const imported: ImportedStep23Lines = {
      step2Lines: [makeImportedLine({ rowNumber: 1, qty: 3, rate: 100, total: 4321 })],
      step3Lines: [],
      linkedSourceSubtotals: [],
    };
    const importedBindingLines = projectImportedSectionLines(
      synthesizeImportedSectionLines(imported)
    );
    const importedId = importedBindingLines[0].id; // imported:gc:1

    const target = makeRow({ id: "row-imp", total: 0 });
    const binding: Binding = {
      targetNodeId: lineFieldNodeId("row-imp", "total"),
      basis: "currency",
      definition: { kind: "lookup", source: lineFieldNodeId(importedId, "total") },
    };
    const result = recomputeLineBindingValues(
      [binding],
      gc,
      siteOps,
      [target],
      importedBindingLines
    );
    expect(result.get(lineFieldNodeId("row-imp", "total"))).toBe(4321);
  });
});

// ---------------------------------------------------------------------------
// Inert by default — the goldens-tie guarantee
// ---------------------------------------------------------------------------

describe("section-line fold stays inert by default", () => {
  it("assembleBindingGraphNodes returns [] with no bindings even when section lines are passed", () => {
    const lineA = makeSectionLine({ id: "gc:staff:a", section: "gc", code: gc.staffLines[0].code });
    const sectionBindingLines = projectAppBornSectionLines([lineA], gc, siteOps);
    const nodes = assembleBindingGraphNodes([], gc, siteOps, [makeRow({ id: "r" })], {
      sectionLines: sectionBindingLines,
    });
    expect(nodes).toEqual([]);
  });

  it("recomputeLineBindingValues is an empty map with no bindings (section lines passed)", () => {
    const lineA = makeSectionLine({ id: "gc:staff:a", section: "gc", code: gc.staffLines[0].code });
    const sectionBindingLines = projectAppBornSectionLines([lineA], gc, siteOps);
    const result = recomputeLineBindingValues([], gc, siteOps, [makeRow({ id: "r" })], sectionBindingLines);
    expect(result.size).toBe(0);
  });
});
