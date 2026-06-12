/**
 * Round-trip recalc golden (Phase 3) — THE proof that the exported workbook
 * is a live projection of the app.
 *
 * CI-safe backbone (committed template + synthetic inputs):
 *   1. Export a rich synthetic estimate, evaluate every formula in the
 *      emitted/kept grammar with the in-repo evaluator, and tie every STEP
 *      2/3 line, section subtotal, STEP 4 linked row, modifier, and the
 *      grand total to the engine at RECONCILIATION_TOLERANCE.
 *   2. TURN THE DIALS in the workbook model (duration, square footage, su
 *      utilization — exactly what an estimator types in Excel), re-evaluate,
 *      and tie against the engine recomputed with the same changed inputs.
 *
 * The evaluator itself is calibrated against genuine Excel cached results in
 * golden-roundtrip-calibration.test.ts (local fixtures), so emitter and
 * evaluator cannot share a blind spot.
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import {
  generateExcelWorkbook,
  RECONCILIATION_TOLERANCE,
} from "../lib/exporter";
import {
  computePersonnelCosts,
  computeSiteOperations,
  computeLinkedDivisionTotals,
  computeTakeoffSummary,
  type PersonnelCalcResult,
  type SiteOpsCalcResult,
} from "../lib/calculations";
import { LINKED_DIVISION_ROWS, ESTIMATE_MODIFIERS } from "../lib/constants";
import { STEP23_PATTERN_BY_CODE } from "../lib/step23FormulaPatterns";
import {
  loadWorkbookModel,
  setInputValue,
  FormulaEvaluator,
  type WorkbookModel,
} from "../lib/formulaEvaluator";
import type { ProcessedTakeoffRow, ColumnDefinition } from "@/types";
import type { Project } from "@/types/db";
import { layoutWithDivisions, MASTER_TEMPLATE_PATH } from "./fixtures/templateLayout";

const STEP2 = "STEP 2 - GCs";
const STEP3 = "STEP 3 - SITE OPS";
const STEP4 = "STEP 4 - ESTIMATE";
const TOL = RECONCILIATION_TOLERANCE;

// ─── Synthetic project: every dial active ────────────────────────────────────

const DURATION = 10; // months — must match expectedStart→expectedFinish below
const SQFT = 10000;

const project: Project = {
  id: "roundtrip-golden",
  name: "Round-Trip Recalc Golden",
  location: "Minneapolis, MN",
  squareFootage: SQFT,
  unitCount: 100,
  bidDate: "2026-06-12",
  expectedStart: "2026-01",
  expectedFinish: "2026-11",
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

const UTILIZATIONS = { su: 100, pm: 50, pe: 25 };
const EQUIPMENT = { dumpsters: 5000, toilets: 2000, electric: 3000 };
const GC_MANUAL = { designArch: 12000, tempOfficeSetup: 1, safetyConsultant: 500 };
const SITE_OPS_QTYS = {
  knox: 2, payrollCleaning: 100, hiredCleaning: 50, soilBorings: 1,
  demolition: 1000, finalCleaning: 2, ffeRelocation: 7500, craneRental: 4000,
};
const SITE_OPS_RATES = { soilBorings: 2500 };

const gcResult = (duration = DURATION, sqft = SQFT, utils: Record<string, number> = UTILIZATIONS) =>
  computePersonnelCosts(duration, sqft, utils, EQUIPMENT, GC_MANUAL);
const siteOpsResult = (duration = DURATION, sqft = SQFT) =>
  computeSiteOperations(duration, sqft, SITE_OPS_QTYS, SITE_OPS_RATES);

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

// $32,400 of takeoff dollars + the 10 linked division rows (qty 0 in the grid)
const step4Rows: ProcessedTakeoffRow[] = [
  baseRow({
    id: "row-03-0000.001", itemId: "03-0000.001",
    procoreParentCode: "3-30000.000", procoreCode: "3-30000.000",
    description: "Cast In-Place Concrete", matchedQty: 150, unitPrice: 120, total: 18000, uom: "CY", costType: "M",
  }),
  baseRow({
    id: "row-03-0000.002", itemId: "03-0000.002",
    procoreParentCode: "3-30000.000", procoreCode: "3-30000.000",
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
const TAKEOFF_TOTAL = 32400;

const summaryRates = {
  constructionContingencyRate: 0.02, designContingencyRate: 0, buildersRiskRate: 0,
  specialInsuranceRate: 0, glInsuranceRate: 0.01, bondRate: 0, feeRate: 0.05,
  roundingRule: "none",
};

// ─── Shared evaluation helpers ───────────────────────────────────────────────

const CODE_RE = /^\d{2}-\d{4}(\.\d{1,3})?$/;

/** code → row, scanned from the model's col C (codes never shift on STEP 2/3). */
function codeRows(model: WorkbookModel, sheet: string): Map<string, number> {
  const rows = new Map<string, number>();
  for (const [ref, cell] of model.get(sheet)!) {
    const col = ref.replace(/\d+$/, "");
    if (col !== "C") continue;
    const text = String(cell.v ?? "").trim();
    if (CODE_RE.test(text)) rows.set(text, parseInt(ref.slice(1), 10));
  }
  return rows;
}

/** Ties every GC + Site Ops line's evaluated I cell to the engine totals. */
function tieAllLines(
  evaluator: FormulaEvaluator,
  model: WorkbookModel,
  gc: PersonnelCalcResult,
  so: SiteOpsCalcResult
) {
  const s2Rows = codeRows(model, STEP2);
  const s3Rows = codeRows(model, STEP3);
  const lines: { sheet: string; rows: Map<string, number>; code: string; total: number; label: string }[] = [
    ...gc.staffLines.map((l) => ({ sheet: STEP2, rows: s2Rows, code: l.code, total: l.total, label: l.role })),
    ...gc.operationalLines.map((l) => ({ sheet: STEP2, rows: s2Rows, code: l.code, total: l.total, label: l.desc })),
    ...gc.equipmentLines.map((l) => ({ sheet: STEP2, rows: s2Rows, code: l.code, total: l.total, label: l.desc })),
    ...gc.manualLines.map((l) => ({ sheet: STEP2, rows: s2Rows, code: l.code, total: l.total, label: l.desc })),
    ...so.dynamicLines.map((l) => ({ sheet: STEP3, rows: s3Rows, code: l.code, total: l.total, label: l.desc })),
    ...so.manualLines.map((l) => ({ sheet: STEP3, rows: s3Rows, code: l.code, total: l.total, label: l.desc })),
  ];
  expect(lines.length).toBeGreaterThan(60);
  for (const line of lines) {
    const row = line.rows.get(line.code);
    expect(row, `${line.code} (${line.label}) row`).toBeDefined();
    const evaluated = evaluator.cellValue(line.sheet, `I${row}`);
    expect(
      Math.abs(Number(evaluated) - line.total),
      `${line.code} (${line.label}): workbook I${row}=${String(evaluated)} vs engine ${line.total}`
    ).toBeLessThanOrEqual(TOL);
  }
}

async function exportModel(gc: PersonnelCalcResult, so: SiteOpsCalcResult): Promise<WorkbookModel> {
  const templateBuffer = fs.readFileSync(MASTER_TEMPLATE_PATH);
  const blob = await generateExcelWorkbook(
    step4Rows, project, columns, layoutWithDivisions("01", "02", "03", "04"),
    templateBuffer as unknown as ArrayBuffer, gc, so
  );
  return loadWorkbookModel(await blob.arrayBuffer());
}

// ─── The golden ──────────────────────────────────────────────────────────────

describe("round-trip recalc golden (synthetic, CI-safe)", () => {
  let model: WorkbookModel;
  let evaluator: FormulaEvaluator;
  const gc = gcResult();
  const so = siteOpsResult();
  const linked = computeLinkedDivisionTotals(gc, so);
  const linkedByItemId = new Map(linked.map((l) => [l.itemId, l.total]));
  const summary = computeTakeoffSummary(step4Rows, SQFT, 100, summaryRates, linked);

  beforeAll(async () => {
    model = await exportModel(gc, so);
    evaluator = new FormulaEvaluator(model);
  }, 60000);

  it("dial cells evaluate to the engine inputs", () => {
    expect(evaluator.cellValue(STEP2, "J5")).toBe(DURATION); // ← 'STEP 1'!D28
    expect(evaluator.cellValue(STEP2, "J8")).toBe(SQFT);     // ← 'STEP 1'!D12
    expect(evaluator.cellValue(STEP3, "J5")).toBe(DURATION);
    expect(evaluator.cellValue(STEP3, "J8")).toBe(SQFT);     // ← STEP 4 K8 ← D12
  });

  it("every STEP 2/3 line recomputes to the engine total", () => {
    tieAllLines(evaluator, model, gc, so);
  });

  it("section subtotals + STEP 4 linked rows recompute to the linked division totals", () => {
    const subtotalCells: { itemId: string; sheet: string; cell: string; step4Row: number }[] = [
      { itemId: "01-0000.001", sheet: STEP2, cell: "I58", step4Row: 12 },
      { itemId: "01-0400.002", sheet: STEP2, cell: "I16", step4Row: 13 },
      { itemId: "02-0000.001", sheet: STEP3, cell: "I29", step4Row: 17 },
      { itemId: "02-4100.002", sheet: STEP3, cell: "I35", step4Row: 18 },
      { itemId: "02-9005.003", sheet: STEP3, cell: "I40", step4Row: 19 },
      { itemId: "02-9070.004", sheet: STEP3, cell: "I45", step4Row: 20 },
      { itemId: "02-9200.005", sheet: STEP3, cell: "I51", step4Row: 21 },
      { itemId: "02-9300.006", sheet: STEP3, cell: "I62", step4Row: 22 },
      { itemId: "02-9400.007", sheet: STEP3, cell: "I72", step4Row: 23 },
      { itemId: "02-9500.008", sheet: STEP3, cell: "I82", step4Row: 24 },
    ];
    for (const sub of subtotalCells) {
      const engineTotal = linkedByItemId.get(sub.itemId)!;
      const subtotal = Number(evaluator.cellValue(sub.sheet, sub.cell));
      expect(Math.abs(subtotal - engineTotal), `${sub.itemId} subtotal ${sub.cell}`).toBeLessThanOrEqual(TOL);
      const step4I = Number(evaluator.cellValue(STEP4, `I${sub.step4Row}`));
      expect(Math.abs(step4I - engineTotal), `${sub.itemId} STEP 4 I${sub.step4Row}`).toBeLessThanOrEqual(TOL);
    }
  });

  it("the template's own col-S cross-sheet checks evaluate TRUE", () => {
    for (const row of [12, 13, 17, 18, 19, 20, 21, 22, 23, 24]) {
      expect(evaluator.cellValue(STEP4, `S${row}`), `S${row}`).toBe(true);
    }
  });

  it("STEP 4 subtotal, modifiers, and grand total recompute to the engine summary", () => {
    const subtotal = Number(evaluator.cellValue(STEP4, "I331"));
    expect(Math.abs(subtotal - summary.subtotal)).toBeLessThanOrEqual(TOL);
    expect(summary.subtotal).toBeCloseTo(TAKEOFF_TOTAL + gc.grandTotal + so.grandTotal, 2);

    // Modifier rows 333–339 (anchor offsets 2..8): I = F × $I$331
    const modifierValues: Record<string, number> = {
      constructionContingency: summary.constructionContingency,
      designContingency: summary.designContingency,
      buildersRisk: summary.buildersRisk,
      specialInsurance: summary.specialInsurance,
      glInsurance: summary.glInsurance,
      bond: summary.bond,
      fee: summary.fee,
    };
    ESTIMATE_MODIFIERS.forEach((mod, idx) => {
      const row = 333 + idx;
      const evaluated = Number(evaluator.cellValue(STEP4, `I${row}`));
      expect(
        Math.abs(evaluated - modifierValues[mod.key]),
        `${mod.label} I${row}`
      ).toBeLessThanOrEqual(TOL);
    });

    const grandTotal = Number(evaluator.cellValue(STEP4, "I341"));
    expect(Math.abs(grandTotal - summary.totalEstimatedCost)).toBeLessThanOrEqual(TOL);
  });

  it("DIAL TURN: duration, square footage, and su utilization edits recompute to the re-run engine", async () => {
    const NEW_DURATION = 14;
    const NEW_SQFT = 20000;
    const NEW_SU = 50; // percent

    // Fresh model (the evaluator memoizes — mutate a clean copy)
    const turned = await exportModel(gc, so);

    // What an estimator types in Excel:
    setInputValue(turned, "STEP 1 - PROJECT DATA", "D28", NEW_DURATION);
    setInputValue(turned, "STEP 1 - PROJECT DATA", "D12", NEW_SQFT);
    const s2Rows = codeRows(turned, STEP2);
    const suRow = s2Rows.get("01-0420.001")!;       // Superintendent staff line
    setInputValue(turned, STEP2, `E${suRow}`, NEW_SU / 100);
    // The su-bound operational lines carry their own E dial cells (the
    // template's native design) — the estimator turns them in step:
    for (const code of ["01-1000.001", "01-1200.001"]) {
      expect(STEP23_PATTERN_BY_CODE.get(code)!.write).toBe("superQty");
      setInputValue(turned, STEP2, `E${s2Rows.get(code)!}`, NEW_SU / 100);
    }

    // Engine re-run with the same changed inputs
    const gcTurned = gcResult(NEW_DURATION, NEW_SQFT, { ...UTILIZATIONS, su: NEW_SU });
    const soTurned = siteOpsResult(NEW_DURATION, NEW_SQFT);

    const evalTurned = new FormulaEvaluator(turned);
    expect(evalTurned.cellValue(STEP2, "J5")).toBe(NEW_DURATION);
    expect(evalTurned.cellValue(STEP3, "J8")).toBe(NEW_SQFT);

    // Every live line follows the dials. The frozen exceptions hold their
    // exported values BY DESIGN and the engine mirrors that: equipment trio,
    // typed manual/lump-sum lines, %-lines, progress-cleaning hours — none of
    // them are duration/sqft-driven in the engine either, so the per-line tie
    // holds across the whole sheet.
    tieAllLines(evalTurned, turned, gcTurned, soTurned);

    // Linked chain follows too
    const linkedTurned = computeLinkedDivisionTotals(gcTurned, soTurned);
    const linkedTurnedById = new Map(linkedTurned.map((l) => [l.itemId, l.total]));
    for (const { itemId, cell, sheet } of [
      { itemId: "01-0400.002", sheet: STEP2, cell: "I16" },
      { itemId: "01-0000.001", sheet: STEP2, cell: "I58" },
      { itemId: "02-0000.001", sheet: STEP3, cell: "I29" },
      { itemId: "02-9400.007", sheet: STEP3, cell: "I72" },
    ]) {
      const evaluated = Number(evalTurned.cellValue(sheet, cell));
      expect(
        Math.abs(evaluated - linkedTurnedById.get(itemId)!),
        `${itemId} after dial turn`
      ).toBeLessThanOrEqual(TOL);
    }

    // Whole-workbook roll-up: STEP 4 grand total ties the re-run engine.
    // (%-lines hold their frozen dollar amounts; the engine's manual lines
    // are equally unchanged, so both sides move identically.)
    const summaryTurned = computeTakeoffSummary(
      step4Rows, NEW_SQFT, 100, summaryRates,
      linkedTurned
    );
    const grandTotal = Number(evalTurned.cellValue(STEP4, "I341"));
    expect(Math.abs(grandTotal - summaryTurned.totalEstimatedCost)).toBeLessThanOrEqual(TOL);
  }, 60000);
});
