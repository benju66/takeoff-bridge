/**
 * Round-trip Phase 5 — apply planner + atomic row application + undo fidelity.
 *
 * Repo convention: undo/redo fidelity is proven by exercising the PURE
 * functions the dispatch cases call (applyRoundTripRowsForward/Inverse +
 * the dial prev/next symmetry on the command payload) — no React harness.
 *
 * The end-to-end half drives the REAL pipeline: export → simulated Excel
 * edits (XML mutation) → extract → delta → plan → apply → undo.
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import { generateExcelWorkbook } from "../lib/exporter";
import { computePersonnelCosts, computeSiteOperations } from "../lib/calculations";
import { LINKED_DIVISION_ROWS } from "../lib/constants";
import {
  extractRoundTrip,
  computeRoundTripDelta,
  type RoundTripState,
} from "../lib/roundTrip";
import {
  planRoundTripApply,
  applyRoundTripRowsForward,
  applyRoundTripRowsInverse,
  addMonthsToYearMonth,
  isWorkingCopyCaptured,
  type RoundTripDialSnapshots,
} from "../lib/applyRoundTrip";
import type { ProcessedTakeoffRow, ColumnDefinition } from "@/types";
import type { Project, EstimateVersionMeta } from "@/types/db";
import { layoutWithDivisions, MASTER_TEMPLATE_PATH } from "./fixtures/templateLayout";
import {
  STEP1_FILE,
  STEP2_FILE,
  STEP3_FILE,
  STEP4_FILE,
  mutateWorkbook,
  typeValue,
  deleteRow,
  insertRow,
} from "./helpers/workbookMutation";

// ─── Fixture (same numbers as the Phase 4 delta tests) ──────────────────────

const project: Project = {
  id: "rt-project-1",
  name: "Round-Trip Apply Test Project",
  location: "Minneapolis, MN",
  squareFootage: 10000,
  unitCount: 100,
  bidDate: "2026-06-12",
  expectedStart: "2026-01",
  expectedFinish: "2026-11", // 10 months
  createdAt: new Date().toISOString(),
  constructionContingencyRate: 0.02,
  designContingencyRate: 0,
  buildersRiskRate: 0,
  specialInsuranceRate: 0,
  glInsuranceRate: 0.01,
  bondRate: 0,
  feeRate: 0.05,
  roundingRule: "none",
};

const columns: ColumnDefinition[] = [
  { id: "costType", header: "TYPE", type: "default" },
  { id: "itemId", header: "Code", type: "default" },
  { id: "description", header: "Description", type: "default" },
  { id: "matchedQty", header: "Quantity", type: "default" },
  { id: "uom", header: "Unit", type: "default" },
  { id: "unitPrice", header: "Rate", type: "default" },
  { id: "total", header: "Total", type: "default" },
];

const baseRow = (overrides: Partial<ProcessedTakeoffRow>): ProcessedTakeoffRow => ({
  id: "row-x", classification: "", itemId: "", procoreParentCode: "", procoreCode: "",
  description: "", matchedQty: 0, uom: "LS", unitPrice: 0, total: 0, isMapped: true,
  rawQuantities: [], costType: "S", customFields: {}, source: "template",
  ...overrides,
});

const gridRows = (): ProcessedTakeoffRow[] => [
  baseRow({
    id: "row-1", itemId: "03-0000.001", procoreParentCode: "3-30000.000", procoreCode: "3-30000.000",
    description: "Cast In-Place Concrete", matchedQty: 150, unitPrice: 120, total: 18000, uom: "CY", costType: "M",
  }),
  baseRow({
    id: "row-2", itemId: "03-0000.002", procoreParentCode: "3-30000.000", procoreCode: "3-30000.000",
    description: "Footings", matchedQty: 80, unitPrice: 180, total: 14400, uom: "CY", costType: "M",
  }),
  ...LINKED_DIVISION_ROWS.map((cfg) =>
    baseRow({
      id: `row-${cfg.itemId}`, itemId: cfg.itemId,
      procoreParentCode: cfg.itemId.startsWith("01") ? "1-10000.000" : "2-20000.000",
      procoreCode: cfg.itemId.startsWith("01") ? "1-10000.000" : "2-20000.000",
      description: cfg.description, costType: "L",
    })
  ),
];

const dialSnapshots = (): RoundTripDialSnapshots => ({
  utilizations: { su: 100, pm: 50 },
  rateOverrides: {},
  equipment: { dumpsters: 5000, toilets: 2000, electric: 3000 },
  gcManualEntries: { designArch: 12000, safetyConsultant: 500 },
  siteOpsQuantities: { knox: 2, payrollCleaning: 100, demolition: 1000, craneRental: 4000 },
  siteOpsRates: { soilBorings: 0 },
});

const gc = () =>
  computePersonnelCosts(10, 10000, { su: 100, pm: 50 },
    { dumpsters: 5000, toilets: 2000, electric: 3000 },
    { designArch: 12000, safetyConsultant: 500 });
const so = () =>
  computeSiteOperations(10, 10000,
    { knox: 2, payrollCleaning: 100, demolition: 1000, craneRental: 4000 },
    { soilBorings: 0 });

async function exportBuffer(): Promise<ArrayBuffer> {
  const blob = await generateExcelWorkbook(
    gridRows(), project, columns, layoutWithDivisions("01", "02", "03", "04"),
    fs.readFileSync(MASTER_TEMPLATE_PATH) as unknown as ArrayBuffer, gc(), so()
  );
  return blob.arrayBuffer();
}

function cloneState(state: RoundTripState): RoundTripState {
  return JSON.parse(JSON.stringify(state)) as RoundTripState;
}

let seq = 0;
const idFactory = (itemId: string) => `rt-test-${itemId}-${seq++}`;

// ─── Unit helpers ────────────────────────────────────────────────────────────

describe("round-trip apply helpers (Phase 5)", () => {
  it("addMonthsToYearMonth: rollover, identity, malformed input", () => {
    expect(addMonthsToYearMonth("2026-01", 10)).toBe("2026-11");
    expect(addMonthsToYearMonth("2026-01", 14)).toBe("2027-03");
    expect(addMonthsToYearMonth("2026-11", 2)).toBe("2027-01");
    expect(addMonthsToYearMonth("2026-06", 0)).toBe("2026-06");
    expect(addMonthsToYearMonth("", 5)).toBeNull();
    expect(addMonthsToYearMonth("garbage", 5)).toBeNull();
  });

  it("isWorkingCopyCaptured: summary-proxy comparison", () => {
    const meta = (summary: Record<string, number>): EstimateVersionMeta => ({
      id: "v1", projectId: "p", versionNumber: 1, title: "t", summary,
      isSubmitted: false, submittedAt: null, createdAt: "", createdBy: null,
    });
    expect(isWorkingCopyCaptured(undefined, { subtotal: 100 })).toBe(false);
    expect(isWorkingCopyCaptured(meta({ subtotal: 100, totalEstimatedCost: 110 }), { subtotal: 100, totalEstimatedCost: 110 })).toBe(true);
    expect(isWorkingCopyCaptured(meta({ subtotal: 100, totalEstimatedCost: 110 }), { subtotal: 100, totalEstimatedCost: 111 })).toBe(false);
    expect(isWorkingCopyCaptured(meta({}), { subtotal: 100 })).toBe(false);
  });
});

// ─── End-to-end: pipeline → plan → apply → undo ─────────────────────────────

describe("round-trip apply planner + atomic undo (Phase 5)", () => {
  let buffer: ArrayBuffer;
  let baseline: RoundTripState;
  let step4RowOf: (itemId: string) => number;
  let step2RowOf: (code: string) => number;
  let step3RowOf: (code: string) => number;

  beforeAll(async () => {
    buffer = await exportBuffer();
    const { stamp, state } = await extractRoundTrip(buffer);
    baseline = stamp.baseline;
    void state;
    const { loadWorkbookModel } = await import("../lib/formulaEvaluator");
    const model = await loadWorkbookModel(buffer);
    const rowOf = (sheet: string) => {
      const cells = model.get(sheet)!;
      const map = new Map<string, number>();
      for (const [ref, cell] of cells) {
        if (/^C\d+$/.test(ref) && typeof cell.v === "string") {
          map.set(cell.v.trim(), parseInt(ref.slice(1), 10));
        }
      }
      return (code: string) => {
        const row = map.get(code);
        if (row === undefined) throw new Error(`No C cell for ${code} on ${sheet}`);
        return row;
      };
    };
    step4RowOf = rowOf("STEP 4 - ESTIMATE");
    step2RowOf = rowOf("STEP 2 - GCs");
    step3RowOf = rowOf("STEP 3 - SITE OPS");
  }, 60000);

  it("plans every dial family, refuses unmappable cells, and one undo restores everything", async () => {
    const edited = await mutateWorkbook(buffer, async (zip) => {
      // Row edit + row added + row deleted (STEP 4)
      await typeValue(zip, STEP4_FILE, `F${step4RowOf("03-0000.001")}`, 200);
      await insertRow(zip, STEP4_FILE, 998, { code: "03-9999.001", desc: "Excel-born allowance", qty: 5, price: 100 });
      await deleteRow(zip, STEP4_FILE, step4RowOf("03-0000.002"));
      // Staff dial cells: su utilization + su rate (STEP 2 r13)
      await typeValue(zip, STEP2_FILE, `E${step2RowOf("01-0420.001")}`, 0.5);
      await typeValue(zip, STEP2_FILE, `H${step2RowOf("01-0420.001")}`, 115);
      // Equipment lump sum: Dumpsters H (F stays 1)
      await typeValue(zip, STEP2_FILE, `H${step2RowOf("01-5130.001")}`, 6000);
      // GC manual lump sum: Design - Architecture H
      await typeValue(zip, STEP2_FILE, `H${step2RowOf("01-0130.001")}`, 15000);
      // Unmappable: Cell Phone monthly-line rate (no app input)
      await typeValue(zip, STEP2_FILE, `H${step2RowOf("01-5111.001")}`, 200);
      // %-line basis-only edit (informational, never an estimator entry)
      await typeValue(zip, STEP2_FILE, `H${step2RowOf("01-0610.001")}`, 999999);
      // Su-bound operational E cell alone (staff dial wins)
      await typeValue(zip, STEP2_FILE, `E${step2RowOf("01-1000.001")}`, 0.25);
      // Site ops: knox qty; soil borings qty + rate (qtyRate line)
      await typeValue(zip, STEP3_FILE, `F${step3RowOf("02-9307.001")}`, 4);
      await typeValue(zip, STEP3_FILE, `F${step3RowOf("02-3200.001")}`, 2);
      await typeValue(zip, STEP3_FILE, `H${step3RowOf("02-3200.001")}`, 3000);
      // STEP 1 dials: duration + fee modifier
      await typeValue(zip, STEP1_FILE, "D28", 14);
      await typeValue(zip, STEP1_FILE, "G24", 0.06);
    });

    const { state } = await extractRoundTrip(edited);
    const delta = computeRoundTripDelta(state, baseline, cloneState(baseline));
    expect(delta.hasConflicts).toBe(false);

    const currentRows = gridRows();
    const plan = planRoundTripApply({
      delta, excel: state, currentRows,
      dials: dialSnapshots(), project,
      sourceLabel: "estimate-2026-06-12.xlsx",
      idFactory,
    });

    // ── Dial half resolves to APP-level changes ──
    const dials = plan.command.dialChanges;
    expect(dials.utilizations).toEqual({ su: { prev: 100, next: 50 } });
    expect(dials.rateOverrides).toEqual({ su: { prev: null, next: 115 } });
    expect(dials.equipment).toEqual({ dumpsters: { prev: 5000, next: 6000 } });
    expect(dials.gcManualEntries).toEqual({ designArch: { prev: 12000, next: 15000 } });
    expect(dials.siteOpsQuantities).toEqual({
      knox: { prev: 2, next: 4 },
      soilBorings: { prev: 0, next: 2 },
    });
    expect(dials.siteOpsRates).toEqual({ soilBorings: { prev: 0, next: 3000 } });
    expect(dials.projectFields).toEqual({
      expectedFinish: { prev: "2026-11", next: "2027-03" }, // duration 14 anchored at 2026-01
      feeRate: { prev: 0.05, next: 0.06 },
    });

    // ── Unmappable cells surface, never guess (AGENTS.md) ──
    const inapplicableLabels = plan.inapplicable.map((d) => `${d.label}:${d.field}`).sort();
    expect(inapplicableLabels).toEqual([
      "Cell Phone (Fixed Baseline):H",
      "Safety Consultant:H",
    ]);
    expect(plan.notes.some((n) => n.includes("Superintendent staff dial"))).toBe(true);
    expect(plan.notes.some((n) => n.includes("expected finish 2027-03"))).toBe(true);

    // ── Row half ──
    expect(plan.command.nextRowStates).toEqual([
      { rowId: "row-1", fields: { matchedQty: 200, total: 24000, dataFidelity: expect.anything() } },
    ]);
    // prev dataFidelity is captured verbatim (undefined here — the fixture
    // grid never evaluated fidelity), so undo restores the exact pre-state
    expect(plan.command.prevRowStates).toHaveLength(1);
    expect(plan.command.prevRowStates[0].rowId).toBe("row-1");
    expect(plan.command.prevRowStates[0].fields).toMatchObject({ matchedQty: 150, total: 18000 });
    expect("dataFidelity" in plan.command.prevRowStates[0].fields).toBe(true);
    expect(plan.command.appendedRows).toHaveLength(1);
    expect(plan.command.appendedRows![0]).toMatchObject({
      itemId: "03-9999.001", description: "Excel-born allowance",
      matchedQty: 5, unitPrice: 100, total: 500,
      source: "manual", isMapped: false, procoreCode: "",
    });
    expect(plan.command.removedRows).toHaveLength(1);
    expect(plan.command.removedRows![0]).toMatchObject({ id: "row-2", itemId: "03-0000.002" });
    expect(plan.isEmpty).toBe(false);

    // ── Atomic undo fidelity: forward → inverse == byte-identical grid ──
    const after = applyRoundTripRowsForward(currentRows, plan.command);
    expect(plan.nextRows).toEqual(after);
    const concrete = after.find((r) => r.itemId === "03-0000.001")!;
    expect(concrete.matchedQty).toBe(200);
    expect(concrete.total).toBe(24000);
    expect(after.some((r) => r.itemId === "03-0000.002")).toBe(false);
    // Appended row sits inside its division block (after the last 03 row)
    const appendedIdx = after.findIndex((r) => r.itemId === "03-9999.001");
    expect(appendedIdx).toBe(after.findIndex((r) => r.itemId === "03-0000.001") + 1);

    const restored = applyRoundTripRowsInverse(after, plan.command);
    expect(restored).toEqual(currentRows);

    // Dial symmetry: every change carries a usable prev for the inverse pass
    for (const bucket of Object.values(dials)) {
      for (const change of Object.values(bucket as Record<string, { prev: unknown; next: unknown }>)) {
        expect(change.prev).not.toBeUndefined();
        expect(change.next).not.toBeUndefined();
      }
    }
  }, 60000);

  it("conflict gating: unacknowledged conflicts are skipped, acknowledged ones apply", async () => {
    const edited = await mutateWorkbook(buffer, async (zip) => {
      await typeValue(zip, STEP4_FILE, `F${step4RowOf("03-0000.001")}`, 200);
      await typeValue(zip, STEP1_FILE, "D12", 12000);
    });
    const { state } = await extractRoundTrip(edited);

    // db moved since export: qty 150 → 175 (conflicts with Excel's 200),
    // sqft 10000 → 11000 (conflicts with Excel's 12000)
    const current = cloneState(baseline);
    current.step4Rows.find((r) => r.itemId === "03-0000.001")!.qty = 175;
    current.step1.squareFootage = 11000;
    const currentRows = gridRows();
    currentRows[0] = { ...currentRows[0], matchedQty: 175, total: 175 * 120 };
    const currentProject = { ...project, squareFootage: 11000 };

    const delta = computeRoundTripDelta(state, baseline, current);
    expect(delta.hasConflicts).toBe(true);

    const unacknowledged = planRoundTripApply({
      delta, excel: state, currentRows,
      dials: dialSnapshots(), project: currentProject,
      sourceLabel: "x.xlsx", idFactory,
    });
    expect(unacknowledged.command.nextRowStates).toEqual([]);
    expect(unacknowledged.command.dialChanges).toEqual({});
    expect(unacknowledged.isEmpty).toBe(true);
    expect(unacknowledged.notes.some((n) => n.includes("conflicts not acknowledged"))).toBe(true);

    const acknowledged = planRoundTripApply({
      delta, excel: state, currentRows,
      dials: dialSnapshots(), project: currentProject,
      sourceLabel: "x.xlsx", idFactory, applyConflicts: true,
    });
    expect(acknowledged.command.nextRowStates).toEqual([
      { rowId: "row-1", fields: { matchedQty: 200, total: 24000, dataFidelity: expect.anything() } },
    ]);
    expect(acknowledged.command.prevRowStates[0].fields.matchedQty).toBe(175);
    expect(acknowledged.command.dialChanges.projectFields).toEqual({
      squareFootage: { prev: 11000, next: 12000 },
    });
  }, 60000);

  it("Excel-deleted row that the app edited since export is kept unless acknowledged", async () => {
    const edited = await mutateWorkbook(buffer, async (zip) => {
      await deleteRow(zip, STEP4_FILE, step4RowOf("03-0000.002"));
    });
    const { state } = await extractRoundTrip(edited);

    const current = cloneState(baseline);
    current.step4Rows.find((r) => r.itemId === "03-0000.002")!.unitPrice = 200; // app moved it
    const currentRows = gridRows();
    currentRows[1] = { ...currentRows[1], unitPrice: 200, total: 80 * 200 };

    const delta = computeRoundTripDelta(state, baseline, current);
    const removal = delta.rowDeltas.find((r) => r.kind === "removed");
    expect(removal?.conflict).toBe(true);
    expect(delta.hasConflicts).toBe(true);

    const plan = planRoundTripApply({
      delta, excel: state, currentRows,
      dials: dialSnapshots(), project, sourceLabel: "x.xlsx", idFactory,
    });
    expect(plan.command.removedRows).toBeUndefined();
    expect(plan.notes.some((n) => n.includes("deleted in Excel but edited in the app"))).toBe(true);

    const acknowledged = planRoundTripApply({
      delta, excel: state, currentRows,
      dials: dialSnapshots(), project, sourceLabel: "x.xlsx", idFactory, applyConflicts: true,
    });
    expect(acknowledged.command.removedRows).toHaveLength(1);
  }, 60000);

  it("a no-change upload plans an empty command", async () => {
    const { state } = await extractRoundTrip(buffer);
    const delta = computeRoundTripDelta(state, baseline, cloneState(baseline));
    const plan = planRoundTripApply({
      delta, excel: state, currentRows: gridRows(),
      dials: dialSnapshots(), project, sourceLabel: "x.xlsx", idFactory,
    });
    expect(plan.isEmpty).toBe(true);
    expect(plan.inapplicable).toEqual([]);
  }, 60000);
});
