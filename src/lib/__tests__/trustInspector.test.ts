/**
 * Phase 5, slice 2 — Trust Inspector trace view-model (`buildTraceModel`).
 *
 * The builder is a PURE rearrangement of engine outputs (it computes no dollars).
 * These tests assert the WIRING and STRUCTURE of the trace — which engine value
 * lands on which node, rate origin (✎ project-set vs ⚙ default), row count, the
 * rounding label, and that overrides surface their computed-vs-override pair.
 * They deliberately make NO claims about the arithmetic itself — that is
 * calculations.test.ts's job (the engine stays the sole authority).
 */

import { describe, it, expect } from "vitest";
import { computeTakeoffSummary } from "../calculations";
import type { LinkedDivisionTotal } from "../calculations";
import { ESTIMATE_MODIFIERS } from "../constants";
import { buildTraceModel, buildReconciliationModel, buildFlagsModel, roundingModeLabel, ROUNDING_MODE_LABELS } from "../trustInspector";
import type { TakeoffSummary } from "../calculations";
import { ProcessedTakeoffRow, EstimateOverrideMap, EstimateOverrideRecord } from "@/types";
import type { Project } from "@/types/db";

function makeRow(overrides: Partial<ProcessedTakeoffRow> = {}): ProcessedTakeoffRow {
  return {
    id: overrides.id ?? "row-test",
    classification: "Test",
    itemId: overrides.itemId ?? "03-1000",
    procoreParentCode: "",
    procoreCode: "",
    description: "Test",
    matchedQty: overrides.matchedQty ?? 100,
    uom: "SF",
    unitPrice: overrides.unitPrice ?? 100,
    total: 0,
    isMapped: true,
    rawQuantities: [],
    costType: "M",
    customFields: {},
    source: "template",
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "Test Project",
    location: "Nowhere",
    squareFootage: 1000,
    unitCount: 10,
    bidDate: "2026-06-09",
    createdAt: "2026-06-09",
    ...overrides,
  };
}

const RATES = {
  constructionContingencyRate: 0.1,
  designContingencyRate: 0,
  buildersRiskRate: 0,
  specialInsuranceRate: 0,
  glInsuranceRate: 0.01,
  bondRate: 0,
  feeRate: 0.05,
  roundingRule: "none",
};

const NO_LINKED: LinkedDivisionTotal[] = [];

describe("buildTraceModel — trace view-model (Phase 5 slice 2)", () => {
  it("wires the subtotal decomposition to the engine's takeoff/linked split", () => {
    const rows = [makeRow({ matchedQty: 100, unitPrice: 100 })];
    const summary = computeTakeoffSummary(rows, 1000, 10, RATES, NO_LINKED);
    const model = buildTraceModel({
      summary,
      linkedTotals: NO_LINKED,
      project: makeProject(),
      takeoffRowCount: rows.length,
    });

    expect(model.subtotal.value).toBe(summary.subtotal);
    expect(model.subtotal.takeoff.value).toBe(summary.takeoffSubtotal);
    expect(model.subtotal.takeoff.rowCount).toBe(1);
    expect(model.subtotal.linked.value).toBe(summary.linkedDivisionsTotal);
    expect(model.total.value).toBe(summary.totalEstimatedCost);
  });

  it("carries the 10 linked-division rows through for expansion", () => {
    const linked: LinkedDivisionTotal[] = [
      { itemId: "01-0000.001", description: "General Conditions", sourceLabel: "Step 2", total: 1000 },
      { itemId: "02-0000.001", description: "Site Operations", sourceLabel: "Step 3", total: 500 },
    ];
    const rows = [makeRow({ matchedQty: 100, unitPrice: 100 })];
    const summary = computeTakeoffSummary(rows, 1000, 10, RATES, linked);
    const model = buildTraceModel({
      summary,
      linkedTotals: linked,
      project: makeProject(),
      takeoffRowCount: rows.length,
    });
    expect(model.subtotal.linked.rows).toEqual(linked);
    expect(model.subtotal.linked.value).toBe(summary.linkedDivisionsTotal);
  });

  it("emits the 7 template modifiers in template order, each wired to its summary value", () => {
    const rows = [makeRow({ matchedQty: 100, unitPrice: 100 })];
    const summary = computeTakeoffSummary(rows, 1000, 10, RATES, NO_LINKED);
    const model = buildTraceModel({
      summary,
      linkedTotals: NO_LINKED,
      project: makeProject(),
      takeoffRowCount: rows.length,
    });

    expect(model.modifiers.map((m) => m.key)).toEqual(ESTIMATE_MODIFIERS.map((m) => m.key));
    for (const node of model.modifiers) {
      expect(node.value).toBe(summary[node.key as keyof typeof summary]);
      expect(node.code).toBe(ESTIMATE_MODIFIERS.find((m) => m.key === node.key)!.code);
    }
  });

  it("marks rate origin ⚙ default when the project has no explicit rate", () => {
    const rows = [makeRow({ matchedQty: 100, unitPrice: 100 })];
    // Project carries NO rate fields → every modifier falls back to its engine default.
    const summary = computeTakeoffSummary(rows, 1000, 10, RATES, NO_LINKED);
    const model = buildTraceModel({
      summary,
      linkedTotals: NO_LINKED,
      project: makeProject(),
      takeoffRowCount: rows.length,
    });
    for (const node of model.modifiers) {
      expect(node.rateOrigin).toBe("default");
      const def = ESTIMATE_MODIFIERS.find((m) => m.key === node.key)!;
      expect(node.rateDecimal).toBe(def.defaultRate);
    }
  });

  it("marks rate origin ✎ project-set when the project carries an explicit rate (incl. 0)", () => {
    const rows = [makeRow({ matchedQty: 100, unitPrice: 100 })];
    const summary = computeTakeoffSummary(rows, 1000, 10, RATES, NO_LINKED);
    // Explicit fee rate, and an explicit 0 GL rate — both count as project-set.
    const project = makeProject({ feeRate: 0.04, glInsuranceRate: 0 });
    const model = buildTraceModel({
      summary,
      linkedTotals: NO_LINKED,
      project,
      takeoffRowCount: rows.length,
    });
    const fee = model.modifiers.find((m) => m.key === "fee")!;
    expect(fee.rateOrigin).toBe("project");
    expect(fee.rateDecimal).toBe(0.04);
    expect(fee.ratePercent).toBe("4");

    const gl = model.modifiers.find((m) => m.key === "glInsurance")!;
    expect(gl.rateOrigin).toBe("project"); // explicit 0 is project-set, not a default
    expect(gl.rateDecimal).toBe(0);
  });

  it("surfaces a modifier override as a computed-vs-override pair on its node", () => {
    const rows = [makeRow({ matchedQty: 100, unitPrice: 100 })];
    const summary = computeTakeoffSummary(rows, 1000, 10, RATES, NO_LINKED, { fee: 700 });
    const model = buildTraceModel({
      summary,
      linkedTotals: NO_LINKED,
      project: makeProject(),
      takeoffRowCount: rows.length,
    });
    const fee = model.modifiers.find((m) => m.key === "fee")!;
    expect(fee.value).toBe(700);
    expect(fee.overridden).toEqual(summary.overrides!.fee);
    // Non-overridden modifiers carry no override pair.
    expect(model.modifiers.find((m) => m.key === "bond")!.overridden).toBeUndefined();
  });

  it("surfaces subtotal and grand-total overrides on their nodes", () => {
    const rows = [makeRow({ matchedQty: 100, unitPrice: 100 })];
    const sub = computeTakeoffSummary(rows, 1000, 10, RATES, NO_LINKED, { subtotal: 99999 });
    const subModel = buildTraceModel({ summary: sub, linkedTotals: NO_LINKED, project: makeProject(), takeoffRowCount: 1 });
    expect(subModel.subtotal.value).toBe(99999);
    expect(subModel.subtotal.overridden).toEqual(sub.overrides!.subtotal);

    const tot = computeTakeoffSummary(rows, 1000, 10, RATES, NO_LINKED, { totalEstimatedCost: 12345 });
    const totModel = buildTraceModel({ summary: tot, linkedTotals: NO_LINKED, project: makeProject(), takeoffRowCount: 1 });
    expect(totModel.total.value).toBe(12345);
    expect(totModel.total.overridden).toEqual(tot.overrides!.totalEstimatedCost);
  });

  it("passes the focus field through and defaults it to the grand total", () => {
    const rows = [makeRow({ matchedQty: 100, unitPrice: 100 })];
    const summary = computeTakeoffSummary(rows, 1000, 10, RATES, NO_LINKED);
    const base = makeProject();
    expect(buildTraceModel({ summary, linkedTotals: NO_LINKED, project: base, takeoffRowCount: 1 }).focusField)
      .toBe("totalEstimatedCost");
    expect(buildTraceModel({ summary, linkedTotals: NO_LINKED, project: base, takeoffRowCount: 1, focusField: "fee" }).focusField)
      .toBe("fee");
  });

  it("reports the active rounding mode and a human label", () => {
    const rows = [makeRow({ matchedQty: 100, unitPrice: 100 })];
    const summary = computeTakeoffSummary(rows, 1000, 10, RATES, NO_LINKED);

    const none = buildTraceModel({ summary, linkedTotals: NO_LINKED, project: makeProject({ roundingRule: "none" }), takeoffRowCount: 1 });
    expect(none.roundingMode).toBe("none");
    expect(none.roundingLabel).toBe(ROUNDING_MODE_LABELS.none);

    // Engine default when the project leaves roundingRule unset (B-3 slice 6 → "none").
    const unset = buildTraceModel({ summary, linkedTotals: NO_LINKED, project: makeProject(), takeoffRowCount: 1 });
    expect(unset.roundingMode).toBe("none");
    expect(unset.roundingLabel).toBe(ROUNDING_MODE_LABELS.none);
  });

  it("roundingModeLabel falls back to the none label for unknown/unset modes (B-3 slice 6)", () => {
    expect(roundingModeLabel(undefined)).toBe(ROUNDING_MODE_LABELS.none);
    expect(roundingModeLabel("bogus")).toBe(ROUNDING_MODE_LABELS.none);
    expect(roundingModeLabel("ten")).toBe(ROUNDING_MODE_LABELS.ten);
  });
});

// ---------------------------------------------------------------------------
// Phase 5, slice 3 — Reconciliation view-model (`buildReconciliationModel`).
// Pure arrangement + tie-classification over the engine + export-gate outputs.
// ---------------------------------------------------------------------------

/** Σ the 7 effective modifier values exactly as the Procore 60-xxxx rollup does. */
const sumModifiers = (s: TakeoffSummary) =>
  ESTIMATE_MODIFIERS.reduce((t, m) => t + ((s[m.key as keyof TakeoffSummary] as number) ?? 0), 0);

const RATES_NONE = { ...RATES, roundingRule: "none" };
const TOL = 0.01;

describe("buildReconciliationModel — reconciliation view-model (Phase 5 slice 3)", () => {
  it("ties scope AND grand-total to the cent (rounding none, no override)", () => {
    const rows = [makeRow({ matchedQty: 100, unitPrice: 100 })]; // raw subtotal 10,000
    const summary = computeTakeoffSummary(rows, 1000, 10, RATES_NONE, NO_LINKED);
    const mods = sumModifiers(summary);
    const model = buildReconciliationModel({
      reconciliation: { lineItemTotal: 10000, rollupTotal: 10000, delta: 0, ok: true },
      blockerCount: 0,
      summary,
      modifierRollupTotal: mods,
      roundingMode: "none",
      tolerance: TOL,
    });
    expect(model.scope.ok).toBe(true);
    expect(model.grandTotal.totalEstimatedCost).toBe(summary.totalEstimatedCost);
    expect(model.grandTotal.fullProcoreBudgetTotal).toBeCloseTo(10000 + mods, 2);
    expect(model.grandTotal.delta).toBeCloseTo(0, 2);
    expect(model.grandTotal.ok).toBe(true);
    expect(model.status).toBe("ties");
  });

  it("grand-total still ties with a modifier (Fee) override — INV-1, not a direct override", () => {
    const rows = [makeRow({ matchedQty: 100, unitPrice: 100 })];
    const summary = computeTakeoffSummary(rows, 1000, 10, RATES_NONE, NO_LINKED, { fee: 700 });
    const model = buildReconciliationModel({
      reconciliation: { lineItemTotal: 10000, rollupTotal: 10000, delta: 0, ok: true },
      blockerCount: 0,
      summary,
      modifierRollupTotal: sumModifiers(summary), // includes the overridden fee
      roundingMode: "none",
      tolerance: TOL,
    });
    expect(model.status).toBe("ties");
    expect(model.grandTotal.delta).toBeCloseTo(0, 2);
    expect(model.hasDirectOverride).toBe(false);
  });

  it("a broken scope tie → blocked (chip amber)", () => {
    const rows = [makeRow({ matchedQty: 100, unitPrice: 100 })];
    const summary = computeTakeoffSummary(rows, 1000, 10, RATES_NONE, NO_LINKED);
    const model = buildReconciliationModel({
      reconciliation: { lineItemTotal: 10000, rollupTotal: 9500, delta: 500, ok: false },
      blockerCount: 0,
      summary,
      modifierRollupTotal: sumModifiers(summary),
      roundingMode: "none",
      tolerance: TOL,
    });
    expect(model.scope.ok).toBe(false);
    expect(model.status).toBe("blocked");
    expect(model.scope.delta).toBe(500);
  });

  it("unmapped rows carrying dollars → blocked regardless of the grand-total tie", () => {
    const rows = [makeRow({ matchedQty: 100, unitPrice: 100 })];
    const summary = computeTakeoffSummary(rows, 1000, 10, RATES_NONE, NO_LINKED);
    const model = buildReconciliationModel({
      reconciliation: { lineItemTotal: 10000, rollupTotal: 10000, delta: 0, ok: true },
      blockerCount: 2,
      summary,
      modifierRollupTotal: sumModifiers(summary),
      roundingMode: "none",
      tolerance: TOL,
    });
    expect(model.blockerCount).toBe(2);
    expect(model.status).toBe("blocked");
  });

  it("a direct subtotal/total override → override (info), never blocked", () => {
    const rows = [makeRow({ matchedQty: 100, unitPrice: 100 })];
    const directOverrides: EstimateOverrideMap[] = [{ subtotal: 50000 }, { totalEstimatedCost: 99999 }];
    for (const ov of directOverrides) {
      const summary = computeTakeoffSummary(rows, 1000, 10, RATES_NONE, NO_LINKED, ov);
      const model = buildReconciliationModel({
        reconciliation: { lineItemTotal: 10000, rollupTotal: 10000, delta: 0, ok: true },
        blockerCount: 0,
        summary,
        modifierRollupTotal: sumModifiers(summary),
        roundingMode: "none",
        tolerance: TOL,
      });
      expect(model.hasDirectOverride).toBe(true);
      expect(model.grandTotal.ok).toBe(false); // far beyond any rounding band
      expect(model.status).toBe("override");
    }
  });

  it("folds a sub-rounding-unit residual into 'ties' (dollar rounding, no override)", () => {
    const rows = [makeRow({ matchedQty: 100.37, unitPrice: 1 })]; // raw subtotal 100.37
    const summary = computeTakeoffSummary(rows, 1000, 10, { ...RATES, roundingRule: "dollar" }, NO_LINKED);
    expect(summary.subtotal).toBe(100); // rounded to the nearest $1
    const model = buildReconciliationModel({
      reconciliation: { lineItemTotal: 100.37, rollupTotal: 100.37, delta: 0, ok: true },
      blockerCount: 0,
      summary,
      modifierRollupTotal: sumModifiers(summary),
      roundingMode: "dollar",
      tolerance: TOL,
    });
    // screen total (rounded subtotal) − Procore (raw scope) = −0.37, within ½ a dollar.
    expect(model.grandTotal.delta).toBeCloseTo(-0.37, 2);
    expect(model.grandTotal.ok).toBe(true);
    expect(model.status).toBe("ties");
  });

  it("an unexplained grand-total mismatch (no override, beyond rounding) → blocked, never hidden", () => {
    const rows = [makeRow({ matchedQty: 100, unitPrice: 100 })];
    const summary = computeTakeoffSummary(rows, 1000, 10, RATES_NONE, NO_LINKED);
    const model = buildReconciliationModel({
      reconciliation: { lineItemTotal: 10000, rollupTotal: 10000, delta: 0, ok: true },
      blockerCount: 0,
      summary,
      modifierRollupTotal: 0, // inconsistent → large grand-total delta, no override to explain it
      roundingMode: "none",
      tolerance: TOL,
    });
    expect(model.grandTotal.ok).toBe(false);
    expect(model.hasDirectOverride).toBe(false);
    expect(model.status).toBe("blocked");
  });

  it("exposes the active rounding mode + human label (B-3 visibility)", () => {
    const rows = [makeRow({ matchedQty: 100, unitPrice: 100 })];
    const summary = computeTakeoffSummary(rows, 1000, 10, RATES_NONE, NO_LINKED);
    const model = buildReconciliationModel({
      reconciliation: { lineItemTotal: 10000, rollupTotal: 10000, delta: 0, ok: true },
      blockerCount: 0,
      summary,
      modifierRollupTotal: sumModifiers(summary),
      roundingMode: "none",
      tolerance: TOL,
    });
    expect(model.roundingMode).toBe("none");
    expect(model.roundingLabel).toBe(ROUNDING_MODE_LABELS.none);
  });
});

// ---------------------------------------------------------------------------
// 5c — Flags view-model (buildFlagsModel). Pure filter/projection over rows +
// the append-only override trail; no math. Tests assert the worklist membership
// and the audit-log projection (incl. revert classification + order).
// ---------------------------------------------------------------------------

function makeOverrideRecord(o: Partial<EstimateOverrideRecord> = {}): EstimateOverrideRecord {
  return {
    projectId: "p1",
    field: o.field ?? "fee",
    computedValue: o.computedValue ?? 1000,
    overrideValue: o.overrideValue !== undefined ? o.overrideValue : 1200,
    reason: o.reason ?? "test reason",
    createdBy: o.createdBy ?? "user-1",
    createdAt: o.createdAt ?? "2026-06-09T12:00:00.000Z",
    ...o,
  };
}

describe("buildFlagsModel — 5c worklists + audit log", () => {
  it("collects only needsReview rows into the needs-review worklist (with carried qty)", () => {
    const rows = [
      makeRow({ id: "ok", needsReview: false }),
      makeRow({ id: "flag1", needsReview: true, matchedQty: 42, uom: "EA" }),
      makeRow({ id: "flag2", needsReview: true }),
    ];
    const model = buildFlagsModel({ rows, overrideRecords: [] });
    expect(model.needsReviewRows.map((r) => r.rowId)).toEqual(["flag1", "flag2"]);
    expect(model.needsReviewRows[0].matchedQty).toBe(42);
    expect(model.needsReviewRows[0].uom).toBe("EA");
  });

  it("collects unmapped rows that carry a classification (B-4), skipping mapped + blank ones", () => {
    const rows = [
      makeRow({ id: "mapped", isMapped: true, classification: "Concrete" }),
      makeRow({ id: "unmapped", isMapped: false, classification: "Mystery item" }),
      makeRow({ id: "blank", isMapped: false, classification: "   " }),
    ];
    const model = buildFlagsModel({ rows, overrideRecords: [] });
    expect(model.unmappedRows.map((r) => r.rowId)).toEqual(["unmapped"]);
  });

  it("projects override records into the audit log, preserving newest-first order", () => {
    const records = [
      makeOverrideRecord({ field: "fee", createdAt: "2026-06-09T13:00:00.000Z" }),
      makeOverrideRecord({ field: "bond", createdAt: "2026-06-09T12:00:00.000Z" }),
    ];
    const model = buildFlagsModel({ rows: [], overrideRecords: records });
    expect(model.auditLog.map((e) => e.field)).toEqual(["fee", "bond"]);
    expect(model.auditLog[0].fieldLabel).toBeTruthy();
  });

  it("classifies a null-overrideValue tombstone as a revert, a number as a set", () => {
    const records = [
      makeOverrideRecord({ field: "fee", overrideValue: 1200 }),
      makeOverrideRecord({ field: "fee", overrideValue: null }),
      makeOverrideRecord({ field: "fee", overrideValue: 0 }),
    ];
    const model = buildFlagsModel({ rows: [], overrideRecords: records });
    expect(model.auditLog.map((e) => e.kind)).toEqual(["set", "revert", "set"]);
  });
});
