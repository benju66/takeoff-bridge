/**
 * Phase 4 — reduceLatestActiveOverrides (pure override-trail resolution).
 *
 * The estimate_overrides table is append-only: every "set" and every "revert" is its own
 * immutable row. These tests lock the reduction to the ACTIVE override per field that the
 * calc engine consumes — latest-wins, revert tombstones drop the field, explicit 0 is kept.
 */

import { describe, it, expect } from "vitest";
import { reduceLatestActiveOverrides } from "../overrides";
import { EstimateOverrideRecord } from "@/types";

function rec(overrides: Partial<EstimateOverrideRecord> = {}): EstimateOverrideRecord {
  // Treat ONLY undefined as "use default" so an explicit null (revert) or 0 is honored —
  // mirrors the very distinction reduceLatestActiveOverrides is being tested for.
  return {
    id: overrides.id ?? "ov-1",
    projectId: overrides.projectId ?? "p1",
    field: overrides.field ?? "fee",
    computedValue: overrides.computedValue === undefined ? 100 : overrides.computedValue,
    overrideValue: overrides.overrideValue === undefined ? 200 : overrides.overrideValue,
    reason: overrides.reason ?? "",
    createdBy: overrides.createdBy ?? "user-1",
    createdAt: overrides.createdAt ?? "2026-06-09T00:00:00.000Z",
  };
}

describe("reduceLatestActiveOverrides", () => {
  it("returns {} for no records", () => {
    expect(reduceLatestActiveOverrides([])).toEqual({});
  });

  it("latest row per field wins — by createdAt, not array order", () => {
    const records = [
      rec({ id: "a", field: "fee", overrideValue: 200, createdAt: "2026-06-09T01:00:00.000Z" }),
      rec({ id: "b", field: "fee", overrideValue: 500, createdAt: "2026-06-09T03:00:00.000Z" }),
      rec({ id: "c", field: "fee", overrideValue: 300, createdAt: "2026-06-09T02:00:00.000Z" }),
    ];
    expect(reduceLatestActiveOverrides(records)).toEqual({ fee: 500 });
    // Order-insensitive: reversing the input yields the same active map.
    expect(reduceLatestActiveOverrides([...records].reverse())).toEqual({ fee: 500 });
  });

  it("a null overrideValue (revert tombstone) drops the field", () => {
    const records = [
      rec({ id: "a", field: "fee", overrideValue: 500, createdAt: "2026-06-09T01:00:00.000Z" }),
      rec({ id: "b", field: "fee", overrideValue: null, createdAt: "2026-06-09T02:00:00.000Z" }),
    ];
    expect(reduceLatestActiveOverrides(records)).toEqual({});
  });

  it("an explicit 0 override is kept (INV-3 — not treated as 'no override')", () => {
    const records = [rec({ field: "glInsurance", overrideValue: 0 })];
    expect(reduceLatestActiveOverrides(records)).toEqual({ glInsurance: 0 });
  });

  it("resolves multiple fields independently", () => {
    const records = [
      rec({ field: "fee", overrideValue: 700, createdAt: "2026-06-09T02:00:00.000Z" }),
      rec({ field: "subtotal", overrideValue: 1000, createdAt: "2026-06-09T01:00:00.000Z" }),
      rec({ field: "subtotal", overrideValue: null, createdAt: "2026-06-09T03:00:00.000Z" }), // reverted
    ];
    expect(reduceLatestActiveOverrides(records)).toEqual({ fee: 700 });
  });

  it("re-applying after a revert restores an active override", () => {
    const records = [
      rec({ field: "fee", overrideValue: 500, createdAt: "2026-06-09T01:00:00.000Z" }),
      rec({ field: "fee", overrideValue: null, createdAt: "2026-06-09T02:00:00.000Z" }),
      rec({ field: "fee", overrideValue: 800, createdAt: "2026-06-09T03:00:00.000Z" }),
    ];
    expect(reduceLatestActiveOverrides(records)).toEqual({ fee: 800 });
  });
});
