/**
 * Phase 2 storage-payload shaping: buildBudgetSnapshotPayload turns the Phase 1
 * engine output into the snake_case save_budget_snapshot RPC payload. Run over the
 * real golden fixture so the stored shape is checked end-to-end (engine → payload),
 * catching field renames or a dropped row before they reach the DB.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  computeNormalizedActuals,
  buildBudgetSnapshotPayload,
  type NormalizedActuals,
  type BudgetSnapshotPayload,
} from "@/lib/actuals";
import { loadActualsSource } from "./actualsFixtures";

// Pinned from the sample project (Orchard Path III / 25-117) — mirror actualsGolden.
const GRAND_TOTAL_ACTUAL = 18314218.92;
const GRAND_NORMALIZED_ACTUAL = 18254126.31;
const BURDEN_TOTAL = 181663.28;
const GRAIN_ROW_COUNT = 130; // distinct code+costType rows
const EVENT_COUNT = 162;

let normalized: NormalizedActuals;
let payload: BudgetSnapshotPayload;

beforeAll(async () => {
  const raw = await loadActualsSource().loadRawExport();
  normalized = computeNormalizedActuals(raw);
  payload = buildBudgetSnapshotPayload(normalized, {
    projectId: "proj-test",
    label: "Closeout EAC",
    sourceKind: "csv",
    metadata: { projectNumber: "25-117", projectName: "Orchard Path III" },
  });
});

describe("buildBudgetSnapshotPayload: header", () => {
  it("carries the caller identity/labelling verbatim", () => {
    expect(payload.snapshot.project_id).toBe("proj-test");
    expect(payload.snapshot.label).toBe("Closeout EAC");
    expect(payload.snapshot.source_kind).toBe("csv");
    expect(payload.snapshot.metadata).toEqual({
      projectNumber: "25-117",
      projectName: "Orchard Path III",
    });
  });

  it("copies the engine grand totals to the cent (no re-derivation)", () => {
    expect(payload.snapshot.grand_total_actual).toBeCloseTo(GRAND_TOTAL_ACTUAL, 2);
    expect(payload.snapshot.grand_normalized_actual).toBeCloseTo(GRAND_NORMALIZED_ACTUAL, 2);
    expect(payload.snapshot.burden_total_actual).toBeCloseTo(BURDEN_TOTAL, 2);
    expect(payload.snapshot.direct_total_actual).toBeCloseTo(GRAND_TOTAL_ACTUAL - BURDEN_TOTAL, 2);
  });

  it("freezes the change events + diagnostics onto the header", () => {
    expect(payload.snapshot.events).toBe(normalized.events);
    expect(payload.snapshot.events.length).toBe(EVENT_COUNT);
    expect(payload.snapshot.diagnostics).toBe(normalized.diagnostics);
    expect(payload.snapshot.diagnostics.internalNonZeroEventIds).toEqual(["INT-002"]);
  });

  it("defaults label/source_kind/metadata when omitted", () => {
    const bare = buildBudgetSnapshotPayload(normalized, { projectId: "p2" });
    expect(bare.snapshot.label).toBe("");
    expect(bare.snapshot.source_kind).toBe("csv");
    expect(bare.snapshot.metadata).toEqual({});
  });
});

describe("buildBudgetSnapshotPayload: per-code actuals", () => {
  it("emits exactly one row per codeActual (in engine order)", () => {
    expect(payload.actuals.length).toBe(normalized.codeActuals.length);
    expect(payload.actuals.length).toBe(GRAIN_ROW_COUNT);
    expect(payload.actuals[0].budget_code).toBe(normalized.codeActuals[0].budgetCode);
  });

  it("maps every CodeActual field to its snake_case column", () => {
    const c = normalized.codeActuals[0];
    const a = payload.actuals[0];
    expect(a).toEqual({
      budget_code: c.budgetCode,
      cost_code: c.costCode,
      cost_type: c.costType,
      description: c.description,
      original_budget: c.originalBudget,
      total_actual: c.totalActual,
      normalized_actual: c.normalizedActual,
      is_burden: c.isBurden,
      normalized_out_contributions: c.normalizedOutContributions,
    });
  });

  it("Σ per-row total_actual ties back to the header grand total", () => {
    const sum = payload.actuals.reduce((s, a) => s + a.total_actual, 0);
    expect(sum).toBeCloseTo(payload.snapshot.grand_total_actual, 2);
  });

  it("flags the Fee + GL burden rows (separable burden)", () => {
    const burden = payload.actuals.filter((a) => a.is_burden);
    const burdenSum = burden.reduce((s, a) => s + a.total_actual, 0);
    expect(burden.length).toBeGreaterThan(0);
    expect(burdenSum).toBeCloseTo(BURDEN_TOTAL, 2);
  });
});
