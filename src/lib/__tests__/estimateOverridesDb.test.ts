/**
 * Phase 4 — estimate_overrides db gateway (append-only) + round-trip.
 *
 * recordEstimateOverride appends ONE immutable event (no update/delete path); it THROWS
 * on failure (financial intent must persist — unlike fire-and-forget training data).
 * getEstimateOverrides reads the trail newest-first. The round-trip proves: set → reload
 * → the override applies AND the computed value is still shown.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Chainable Supabase mock: from().insert(...) and from().select().eq().order(...)
// plus auth.getSession(). Mirrors estimateAtomicSave.test.ts's mocking approach.
// ---------------------------------------------------------------------------
const mockInsert = vi.fn();
const mockOrder = vi.fn();
const mockEq = vi.fn(() => ({ order: mockOrder }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn((..._args: unknown[]) => ({ insert: mockInsert, select: mockSelect }));
const mockGetSession = vi.fn();

vi.mock("../supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    auth: { getSession: () => mockGetSession() },
  },
}));

import * as db from "../db";
import { recordEstimateOverride, getEstimateOverrides } from "../db";
import { reduceLatestActiveOverrides } from "../overrides";
import { computeTakeoffSummary } from "../calculations";
import { ProcessedTakeoffRow } from "@/types";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: "user-9" } } } });
});

describe("recordEstimateOverride — append-only insert", () => {
  it("inserts a single event with snake_case fields + created_by from the session", async () => {
    mockInsert.mockResolvedValueOnce({ error: null });
    await recordEstimateOverride("p1", "fee", 500, 700, "client pushback");

    expect(mockFrom).toHaveBeenCalledWith("estimate_overrides");
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledWith({
      project_id: "p1",
      field: "fee",
      computed_value: 500,
      override_value: 700,
      reason: "client pushback",
      created_by: "user-9",
    });
  });

  it("passes override_value null for a revert tombstone", async () => {
    mockInsert.mockResolvedValueOnce({ error: null });
    await recordEstimateOverride("p1", "fee", 500, null, "");
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ override_value: null }));
  });

  it("THROWS on error (financial intent must persist — not fire-and-forget)", async () => {
    mockInsert.mockResolvedValueOnce({ error: { message: "permission denied" } });
    await expect(recordEstimateOverride("p1", "fee", 500, 700)).rejects.toThrow(
      "Failed to record estimate override: permission denied"
    );
  });
});

describe("getEstimateOverrides — full trail, newest first", () => {
  it("reads project rows ordered desc and maps them", async () => {
    mockOrder.mockResolvedValueOnce({
      data: [
        { id: "o2", project_id: "p1", field: "fee", computed_value: 500, override_value: 700, reason: "x", created_by: "u1", created_at: "2026-06-09T02:00:00.000Z" },
        { id: "o1", project_id: "p1", field: "fee", computed_value: 500, override_value: 400, reason: "", created_by: "u1", created_at: "2026-06-09T01:00:00.000Z" },
      ],
      error: null,
    });

    const records = await getEstimateOverrides("p1");
    expect(mockFrom).toHaveBeenCalledWith("estimate_overrides");
    expect(mockEq).toHaveBeenCalledWith("project_id", "p1");
    expect(mockOrder).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      id: "o2", projectId: "p1", field: "fee", computedValue: 500, overrideValue: 700, createdBy: "u1",
    });
  });

  it("maps null numeric/uuid columns back to null (revert tombstone)", async () => {
    mockOrder.mockResolvedValueOnce({
      data: [{ id: "o1", project_id: "p1", field: "fee", computed_value: null, override_value: null, reason: "", created_by: null, created_at: "2026-06-09T01:00:00.000Z" }],
      error: null,
    });
    const records = await getEstimateOverrides("p1");
    expect(records[0].overrideValue).toBeNull();
    expect(records[0].computedValue).toBeNull();
    expect(records[0].createdBy).toBeNull();
  });

  it("throws on error", async () => {
    mockOrder.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(getEstimateOverrides("p1")).rejects.toThrow("Failed to fetch overrides: boom");
  });
});

describe("estimate_overrides immutability (append-only surface)", () => {
  it("the db gateway exposes NO update/delete path for overrides", () => {
    const gateway = db as unknown as Record<string, unknown>;
    expect(gateway.updateEstimateOverride).toBeUndefined();
    expect(gateway.deleteEstimateOverride).toBeUndefined();
  });
});

describe("override round-trip (set -> reload -> applied AND computed still shown)", () => {
  const makeRow = (o: Partial<ProcessedTakeoffRow> = {}): ProcessedTakeoffRow => ({
    id: "r1", classification: "", itemId: "03-1000", procoreParentCode: "", procoreCode: "",
    description: "", matchedQty: 100, uom: "SF", unitPrice: 100, total: 0, isMapped: true,
    rawQuantities: [], costType: "M", customFields: {}, source: "template", ...o,
  });
  const RATES = {
    constructionContingencyRate: 0, designContingencyRate: 0, buildersRiskRate: 0,
    specialInsuranceRate: 0, glInsuranceRate: 0, bondRate: 0, feeRate: 0.05, roundingRule: "none",
  };

  it("a recorded override reloads, applies, and still exposes the computed value", async () => {
    mockInsert.mockResolvedValueOnce({ error: null });

    const rows = [makeRow()]; // subtotal 10,000; computed fee = 500
    const computed = computeTakeoffSummary(rows, 1000, 10, RATES);
    expect(computed.fee).toBe(500);

    // SET: record the override (computed 500 -> override 700)
    await recordEstimateOverride("p1", "fee", computed.fee, 700, "client ask");

    // RELOAD: the persisted event comes back from the DB
    mockOrder.mockResolvedValueOnce({
      data: [{ id: "o1", project_id: "p1", field: "fee", computed_value: 500, override_value: 700, reason: "client ask", created_by: "user-9", created_at: "2026-06-09T01:00:00.000Z" }],
      error: null,
    });
    const active = reduceLatestActiveOverrides(await getEstimateOverrides("p1"));
    expect(active).toEqual({ fee: 700 });

    // APPLY: the engine uses the override AND still carries the computed value
    const applied = computeTakeoffSummary(rows, 1000, 10, RATES, undefined, active);
    expect(applied.fee).toBe(700);
    expect(applied.overrides).toEqual({ fee: { computedValue: 500, overrideValue: 700 } });
  });
});
