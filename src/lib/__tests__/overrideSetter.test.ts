/**
 * Phase 5, slice 4 — override-setter decision logic (`overrideSetter.ts`).
 *
 * These assert the PURE decisions the glass-box editor relies on (the editor's React
 * click flow has no DOM harness here, so the payload-builder + validation + a round-trip
 * through the read-side reducer carry the logic):
 *  (a) the pristine computed value is the engine's value, never a prior override;
 *  (b) revert builds an `overrideValue: null` tombstone;
 *  (c) an override of `0` is a SET, not a revert (INV-3);
 *  (d) input validation (reason required, numeric, empty rejected);
 *  (e) set → active, tombstone → falls back to computed, `0` stays active
 *      (via the same `reduceLatestActiveOverrides` the engine consumes).
 */

import { describe, it, expect } from "vitest";
import { computeTakeoffSummary } from "../calculations";
import type { LinkedDivisionTotal } from "../calculations";
import { reduceLatestActiveOverrides } from "../overrides";
import {
  selectPristineComputedValue,
  validateOverrideInput,
  buildSetPayload,
  buildRevertPayload,
  REVERT_REASON,
} from "../overrideSetter";
import { ProcessedTakeoffRow, EstimateOverrideRecord } from "@/types";

function makeRow(overrides: Partial<ProcessedTakeoffRow> = {}): ProcessedTakeoffRow {
  return {
    id: "row-1",
    classification: "Test",
    itemId: "03-1000",
    procoreParentCode: "",
    procoreCode: "",
    description: "Test",
    matchedQty: 100,
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

const NO_LINKED: LinkedDivisionTotal[] = [];
const ROWS = [makeRow()];

describe("selectPristineComputedValue — the honest-audit trap", () => {
  it("first override of a field returns the live computed value", () => {
    const summary = computeTakeoffSummary(ROWS, 1000, 10, RATES, NO_LINKED);
    expect(selectPristineComputedValue("fee", summary)).toBe(summary.fee);
    expect(selectPristineComputedValue("subtotal", summary)).toBe(summary.subtotal);
  });

  it("re-overriding an already-overridden field returns the engine's computed value, NOT the prior override", () => {
    // Apply a fee override so summary.overrides.fee = { computedValue: <engine>, overrideValue: 999 }.
    const overridden = computeTakeoffSummary(ROWS, 1000, 10, RATES, NO_LINKED, { fee: 999 });
    expect(overridden.overrides?.fee).toBeDefined();
    const pristine = selectPristineComputedValue("fee", overridden);
    // The pristine value is the engine's value retained on the override pair — not 999, not summary.fee (== 999).
    expect(pristine).toBe(overridden.overrides!.fee.computedValue);
    expect(pristine).not.toBe(999);
    expect(overridden.fee).toBe(999); // sanity: the effective value IS the override
  });
});

describe("validateOverrideInput — reason required, numeric, empty rejected", () => {
  it("rejects an empty reason", () => {
    expect(validateOverrideInput("100", "")).toEqual({
      ok: false,
      error: expect.stringContaining("reason"),
    });
    expect(validateOverrideInput("100", "   ")).toMatchObject({ ok: false });
  });

  it("rejects an empty override input (clearing is the explicit Revert button)", () => {
    expect(validateOverrideInput("", "valid reason")).toMatchObject({ ok: false });
    expect(validateOverrideInput("   ", "valid reason")).toMatchObject({ ok: false });
  });

  it("rejects a non-numeric override", () => {
    expect(validateOverrideInput("abc", "valid reason")).toMatchObject({ ok: false });
  });

  it("accepts a finite number with a reason", () => {
    expect(validateOverrideInput("684000.00", "Negotiated fee")).toEqual({ ok: true, value: 684000 });
    expect(validateOverrideInput("-50", "Credit")).toEqual({ ok: true, value: -50 });
  });

  it("accepts 0 — a real override (INV-3), not treated as empty/revert", () => {
    expect(validateOverrideInput("0", "Waived")).toEqual({ ok: true, value: 0 });
  });
});

describe("buildSetPayload / buildRevertPayload", () => {
  it("builds a SET payload carrying field, pristine computed, override value, and reason", () => {
    expect(buildSetPayload("fee", 642166.65, 684000, "Negotiated fee")).toEqual({
      field: "fee",
      computedValue: 642166.65,
      overrideValue: 684000,
      reason: "Negotiated fee",
    });
  });

  it("an override of 0 is a SET (overrideValue 0), never a revert", () => {
    const payload = buildSetPayload("bond", 1000, 0, "Waived");
    expect(payload.overrideValue).toBe(0);
    expect(payload.overrideValue).not.toBeNull();
  });

  it("builds a REVERT tombstone (overrideValue: null) with a default reason", () => {
    expect(buildRevertPayload("fee", 642166.65)).toEqual({
      field: "fee",
      computedValue: 642166.65,
      overrideValue: null,
      reason: REVERT_REASON,
    });
  });
});

describe("round-trip through reduceLatestActiveOverrides (set / revert / 0)", () => {
  const asRecord = (
    p: { field: string; computedValue: number; overrideValue: number | null; reason: string },
    createdAt: string
  ): EstimateOverrideRecord => ({
    projectId: "p1",
    field: p.field,
    computedValue: p.computedValue,
    overrideValue: p.overrideValue,
    reason: p.reason,
    createdAt,
  });

  it("a built SET payload resolves to an active override with that value", () => {
    const set = buildSetPayload("fee", 642166.65, 684000, "Negotiated fee");
    const active = reduceLatestActiveOverrides([asRecord(set, "2026-06-09T10:00:00Z")]);
    expect(active.fee).toBe(684000);
  });

  it("a later revert tombstone makes the field fall back to computed (absent from the active map)", () => {
    const set = buildSetPayload("fee", 642166.65, 684000, "Negotiated fee");
    const revert = buildRevertPayload("fee", 642166.65);
    const active = reduceLatestActiveOverrides([
      asRecord(set, "2026-06-09T10:00:00Z"),
      asRecord(revert, "2026-06-09T11:00:00Z"),
    ]);
    expect(active.fee).toBeUndefined();
  });

  it("a 0 SET stays an active override (not confused with a revert)", () => {
    const set = buildSetPayload("bond", 1000, 0, "Waived");
    const active = reduceLatestActiveOverrides([asRecord(set, "2026-06-09T10:00:00Z")]);
    expect(active.bond).toBe(0);
  });
});
