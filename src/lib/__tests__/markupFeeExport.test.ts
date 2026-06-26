/**
 * Phase 5 — Division 60 Fee-Block Addressability: EXPORT of markup fee lines (pure, node-only).
 *
 * Proves the non-template export surfaces, with NO DOM and NO XLSX template:
 *   - `effectiveFeeLineAmount` mirrors the engine (roundByRule + per-line `line:<id>:total` override).
 *   - `rollupMarkupLines` sums MAPPED fee lines by code, skips unmapped/blank-coded ones.
 *   - `generateExcelPayload` appends a flat fee row AFTER the 7 modifier rows (the printout fee block).
 *   - `generateProcoreBudget` carries a MAPPED fee line under its code + costType; omits an unmapped one.
 *   - `validateExportReadiness` BLOCKS an unmapped fee line (kind 'feeLine'), passes a mapped one,
 *     and keeps the scope reconciliation (subtotal/BLI sheet) byte-identical (fees excluded from it).
 *   - `buildReconciliationModel` ties to $0.00 when the mapped fee rollup is folded in (feeRollupTotal).
 *
 * The XLSX-template golden (fee row in the sheet + grand-TOTAL tie) lives in export-integrity.test.ts.
 * Every dollar originates in the engine / exporter — never invented (AGENTS.md).
 */

import { describe, it, expect } from "vitest";
import {
  generateExcelPayload,
  generateProcoreBudget,
  validateExportReadiness,
  rollupMarkupLines,
  effectiveFeeLineAmount,
  rollupEffectiveModifiers,
  RECONCILIATION_TOLERANCE,
} from "../exporter";
import { buildReconciliationModel } from "../trustInspector";
import { computeTakeoffSummary, computePersonnelCosts, computeSiteOperations } from "../calculations";
import { newFeeLine } from "../sectionLines/markup";
import { validateOneOffCode } from "../sectionLines/oneOff";
import { sectionLineTotalOverrideKey } from "../sectionLines/ids";
import type { ProcessedTakeoffRow, ColumnDefinition, EstimateOverrideMap } from "@/types";
import type { Project, EstimateSectionLine } from "@/types/db";

const zeroGc = () => computePersonnelCosts(0, 0, {}, { dumpsters: 0, toilets: 0, electric: 0 });
const zeroSo = () => computeSiteOperations(0, 0, { knox: 0, payrollCleaning: 0, hiredCleaning: 0, soilBorings: 0 }, { soilBorings: 0 });

const COLUMNS: ColumnDefinition[] = [
  { id: "costType", header: "TYPE", type: "default" },
  { id: "itemId", header: "Code", type: "default" },
  { id: "description", header: "Description", type: "default" },
  { id: "matchedQty", header: "Quantity", type: "default" },
  { id: "uom", header: "Unit", type: "default" },
  { id: "unitPrice", header: "Rate", type: "default" },
  { id: "total", header: "Total", type: "default" },
];

const PROJECT: Project = {
  id: "fee-export-project",
  name: "Fee Export Test",
  location: "Minneapolis, MN",
  squareFootage: 10000,
  unitCount: 100,
  bidDate: "2026-06-26",
  createdAt: new Date().toISOString(),
  constructionContingencyRate: 0,
  designContingencyRate: 0,
  buildersRiskRate: 0,
  specialInsuranceRate: 0,
  glInsuranceRate: 0.01,
  bondRate: 0,
  feeRate: 0.05,
  roundingRule: "none",
};

const RATES = {
  constructionContingencyRate: 0,
  designContingencyRate: 0,
  buildersRiskRate: 0,
  specialInsuranceRate: 0,
  glInsuranceRate: 0.01,
  bondRate: 0,
  feeRate: 0.05,
  roundingRule: "none",
};

const baseRow = (over: Partial<ProcessedTakeoffRow>): ProcessedTakeoffRow => ({
  id: "row-x",
  classification: "",
  itemId: "",
  procoreParentCode: "",
  procoreCode: "",
  description: "",
  matchedQty: 0,
  uom: "LS",
  unitPrice: 0,
  total: 0,
  isMapped: true,
  rawQuantities: [],
  costType: "M",
  customFields: {},
  source: "template",
  ...over,
});

// One mapped concrete row — subtotal $10,000 on 3-30000.000.
const concreteRow = baseRow({
  id: "row-03", itemId: "03-0000.001",
  procoreParentCode: "3-30000.000", procoreCode: "3-30000.000",
  description: "Cast In-Place Concrete", matchedQty: 100, unitPrice: 100, uom: "CY",
});

// A MAPPED $2,500 fee line (Preconstruction Fee) — code resolved through the one-off validator,
// so its costType is the real Procore type (never guessed).
const FEE_CODE = "1-10001.000";
const codeCheck = validateOneOffCode(FEE_CODE);
const FEE_COST_TYPE = codeCheck.ok ? codeCheck.costType : "M";
const mappedFee = (): EstimateSectionLine => ({
  ...newFeeLine({ label: "Preconstruction Fee", amount: 2500, procoreCode: FEE_CODE }),
  id: "markup:fee:mapped",
  costType: FEE_COST_TYPE,
});
// An UNMAPPED $1,000 fee line (no Procore code).
const unmappedFee = (): EstimateSectionLine => ({
  ...newFeeLine({ label: "Hand-keyed Fee", amount: 1000 }),
  id: "markup:fee:unmapped",
});

describe("effectiveFeeLineAmount (engine parity)", () => {
  it("rounds the flat amount per the project rule", () => {
    const line = { ...newFeeLine({ label: "x", amount: 2500.4 }), id: "f1" };
    expect(effectiveFeeLineAmount(line, "none")).toBeCloseTo(2500.4, 2);
    expect(effectiveFeeLineAmount(line, "dollar")).toBe(2500);
  });

  it("honors a line:<id>:total type-over (mirrors the engine)", () => {
    const line = { ...newFeeLine({ label: "x", amount: 2500 }), id: "f2" };
    const ov: EstimateOverrideMap = { [sectionLineTotalOverrideKey("f2")]: 3000 };
    expect(effectiveFeeLineAmount(line, "none", ov)).toBe(3000);
  });
});

describe("rollupMarkupLines (mapped-only, accumulating)", () => {
  it("sums mapped fee lines by code and skips unmapped/blank-coded ones", () => {
    const rollup = rollupMarkupLines([mappedFee(), unmappedFee()], "none");
    expect(rollup[FEE_CODE]).toBeCloseTo(2500, 2);
    // Unmapped line contributes to no code.
    expect(Object.keys(rollup)).toEqual([FEE_CODE]);
  });

  it("accumulates two mapped fee lines on the same code", () => {
    const second = { ...mappedFee(), id: "markup:fee:mapped2", inputs: { amount: 1500 } };
    const rollup = rollupMarkupLines([mappedFee(), second], "none");
    expect(rollup[FEE_CODE]).toBeCloseTo(4000, 2);
  });

  it("empty / undefined input is inert", () => {
    expect(rollupMarkupLines(undefined, "none")).toEqual({});
    expect(rollupMarkupLines([], "none")).toEqual({});
  });
});

describe("generateExcelPayload — printout fee block", () => {
  it("appends each fee line as a flat row AFTER the 7 modifier rows", () => {
    const lines = generateExcelPayload(concreteRow ? [concreteRow] : [], COLUMNS, PROJECT, [], {}, [mappedFee()])
      .split("\r\n");
    // header + 1 data + 7 modifiers + 1 fee = 10 lines
    expect(lines).toHaveLength(10);
    const feeRow = lines[lines.length - 1].split(",").map((c) => c.replace(/^"|"$/g, ""));
    // costType, Code, Description, Quantity, Unit, Rate, Total
    expect(feeRow[0]).toBe(FEE_COST_TYPE);
    expect(feeRow[1]).toBe(FEE_CODE);
    expect(feeRow[2]).toBe("Preconstruction Fee");
    expect(feeRow[4]).toBe("LS");
    expect(feeRow[6]).toBe("2500.00");
    // The fee row sits below the last modifier (Fee, 60-4000.001)
    expect(lines[lines.length - 2]).toContain("60-4000.001");
  });

  it("is byte-identical to the no-fee export when no markup lines are passed", () => {
    expect(generateExcelPayload([concreteRow], COLUMNS, PROJECT, [], {}, []))
      .toBe(generateExcelPayload([concreteRow], COLUMNS, PROJECT, [], {}));
  });
});

describe("generateProcoreBudget — mapped fee rolls up; unmapped omitted", () => {
  function byCodeType(csv: string): Map<string, number> {
    const out = new Map<string, number>();
    for (const line of csv.split("\r\n").slice(1)) {
      const cols = line.split(",");
      const code = cols[0].replace(/^"|"$/g, "");
      const costType = cols[1]?.replace(/^"|"$/g, "");
      out.set(`${code}::${costType}`, parseFloat(cols[cols.length - 1].replace(/^"|"$/g, "")));
    }
    return out;
  }

  it("carries a mapped fee line under its assigned code + costType", () => {
    const csv = generateProcoreBudget([concreteRow], PROJECT, zeroGc(), zeroSo(), {}, [mappedFee()]);
    const map = byCodeType(csv);
    expect(map.get(`${FEE_CODE}::${FEE_COST_TYPE}`)).toBeCloseTo(2500, 2);
  });

  it("omits an unmapped fee line (blocked upstream — never mis-routed)", () => {
    const csv = generateProcoreBudget([concreteRow], PROJECT, zeroGc(), zeroSo(), {}, [unmappedFee()]);
    // No blank-coded line and no row carrying the $1,000 under any code.
    for (const line of csv.split("\r\n").slice(1)) {
      const cols = line.split(",");
      expect(cols[0].replace(/^"|"$/g, "")).not.toBe("");
    }
    expect(csv).not.toContain("Hand-keyed Fee");
  });
});

describe("validateExportReadiness — fee-line gate", () => {
  it("passes a mapped fee line and keeps the scope reconciliation unchanged", () => {
    const withFee = validateExportReadiness([concreteRow], zeroGc(), zeroSo(), undefined, [mappedFee()]);
    const without = validateExportReadiness([concreteRow], zeroGc(), zeroSo());
    expect(withFee.ok).toBe(true);
    expect(withFee.blockers).toHaveLength(0);
    // Fees are below-subtotal addends — they never enter the scope tie (subtotal/BLI sheet).
    expect(withFee.reconciliation.lineItemTotal).toBe(without.reconciliation.lineItemTotal);
    expect(withFee.reconciliation.rollupTotal).toBe(without.reconciliation.rollupTotal);
  });

  it("blocks an unmapped fee line carrying dollars (kind 'feeLine')", () => {
    const readiness = validateExportReadiness([concreteRow], zeroGc(), zeroSo(), undefined, [unmappedFee()]);
    expect(readiness.ok).toBe(false);
    expect(readiness.blockers).toHaveLength(1);
    expect(readiness.blockers[0]).toMatchObject({
      rowId: "markup:fee:unmapped",
      description: "Hand-keyed Fee",
      amount: 1000,
      kind: "feeLine",
    });
    // Scope still ties — the fee dollars are NOT smuggled into it.
    expect(readiness.reconciliation.ok).toBe(true);
  });

  it("a zero-dollar unmapped fee line does not block", () => {
    const zeroFee = { ...newFeeLine({ label: "empty", amount: 0 }), id: "markup:fee:zero" };
    const readiness = validateExportReadiness([concreteRow], zeroGc(), zeroSo(), undefined, [zeroFee]);
    expect(readiness.blockers).toHaveLength(0);
  });
});

describe("buildReconciliationModel — grand-total tie with a mapped fee line", () => {
  it("ties to $0.00 once the mapped fee rollup is folded into the budget", () => {
    const rows = [concreteRow];
    const lines = [mappedFee()];
    const summary = computeTakeoffSummary(rows, 10000, 100, RATES, [], {}, lines);
    // Subtotal 10,000 + GL 100 + Fee 500 + additionalFees 2,500 = 13,100
    expect(summary.totalEstimatedCost).toBeCloseTo(13100, 2);
    expect(summary.additionalFees).toBeCloseTo(2500, 2);

    const readiness = validateExportReadiness(rows, zeroGc(), zeroSo(), undefined, lines);
    const feeRollupTotal = Object.values(rollupMarkupLines(lines, "none")).reduce((s, v) => s + v, 0);
    const model = buildReconciliationModel({
      reconciliation: readiness.reconciliation,
      blockerCount: readiness.blockers.length,
      summary,
      modifierRollupTotal: rollupEffectiveModifiers(summary),
      feeRollupTotal,
      roundingMode: "none",
      tolerance: RECONCILIATION_TOLERANCE,
    });
    expect(model.status).toBe("ties");
    expect(model.grandTotal.delta).toBeCloseTo(0, 2);
    expect(model.grandTotal.fullProcoreBudgetTotal).toBeCloseTo(13100, 2);
  });

  it("WITHOUT feeRollupTotal the fee dollars leave a delta (the Phase-4 symptom)", () => {
    const rows = [concreteRow];
    const lines = [mappedFee()];
    const summary = computeTakeoffSummary(rows, 10000, 100, RATES, [], {}, lines);
    const readiness = validateExportReadiness(rows, zeroGc(), zeroSo(), undefined, lines);
    const model = buildReconciliationModel({
      reconciliation: readiness.reconciliation,
      blockerCount: readiness.blockers.length,
      summary,
      modifierRollupTotal: rollupEffectiveModifiers(summary),
      roundingMode: "none",
      tolerance: RECONCILIATION_TOLERANCE,
    });
    expect(model.grandTotal.delta).toBeCloseTo(2500, 2);
  });
});
