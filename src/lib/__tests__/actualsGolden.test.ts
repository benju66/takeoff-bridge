/**
 * Golden totals for the actuals engine, pinned off the real `templates/` exports.
 * These catch parser/column drift (a renamed or reordered column, a broken
 * join, a sign flip) by tying Σ(per-code) back to the export's grand total and
 * to Procore's own internal accounting identities.
 *
 * If a sample file is re-exported and these numbers change, update the constants
 * deliberately — do not loosen the tolerance.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  computeNormalizedActuals,
  type NormalizedActuals,
  type RawActualsExport,
} from "@/lib/actuals";
import { loadActualsSource } from "./actualsFixtures";

// Pinned grand totals (dollars) — computed from the real exports.
const GRAND_TOTAL_ACTUAL = 18314218.92; // Σ Estimated Cost at Completion
const GRAND_NORMALIZED_ACTUAL = 18254126.31; // after stripping owner/oos/allowance/reclass
const BURDEN_TOTAL = 181663.28; // Fee (60-604000.000) + GL (60-602020.000)
const TOLERANCE = 0.01;

let raw: RawActualsExport;
let result: NormalizedActuals;

beforeAll(async () => {
  raw = await loadActualsSource().loadRawExport();
  result = computeNormalizedActuals(raw);
});

describe("golden: grand total reconciliation", () => {
  it("Σ totalActual ties to the budget export grand total to the cent", () => {
    const directSum = raw.budget.reduce((s, b) => s + b.estimatedCostAtCompletion, 0);
    expect(result.grandTotalActual).toBeCloseTo(GRAND_TOTAL_ACTUAL, 2);
    // Independent re-sum off the raw rows must agree (parser self-consistency).
    expect(directSum).toBeCloseTo(GRAND_TOTAL_ACTUAL, 2);
  });

  it("Σ normalizedActual is the pinned normalized grand total", () => {
    expect(result.grandNormalizedActual).toBeCloseTo(GRAND_NORMALIZED_ACTUAL, 2);
  });

  it("normalization strips exactly the expected amount from EAC", () => {
    const stripped = result.grandTotalActual - result.grandNormalizedActual;
    expect(stripped).toBeCloseTo(GRAND_TOTAL_ACTUAL - GRAND_NORMALIZED_ACTUAL, 2);
    expect(stripped).toBeGreaterThan(0); // owner/oos/allowance net to a real strip
  });

  it("Fee + GL burden total is pinned and separable from direct cost", () => {
    expect(result.burdenTotalActual).toBeCloseTo(BURDEN_TOTAL, 2);
    expect(result.directTotalActual).toBeCloseTo(GRAND_TOTAL_ACTUAL - BURDEN_TOTAL, 2);
  });
});

describe("golden: Procore internal accounting identities (column-drift guard)", () => {
  it("Revised Budget == Original + Budget Modifications + Approved COs (per row)", () => {
    for (const b of raw.budget) {
      expect(b.revisedBudget).toBeCloseTo(
        b.originalBudget + b.budgetModifications + b.approvedCos,
        2,
      );
    }
  });

  it("Projected Budget == Revised Budget + Pending COs (per row)", () => {
    for (const b of raw.budget) {
      expect(b.projectedBudget).toBeCloseTo(b.revisedBudget + b.pendingCos, 2);
    }
  });

  it("Projected over Under == Projected Budget − EAC (per row)", () => {
    for (const b of raw.budget) {
      expect(b.projectedOverUnder).toBeCloseTo(
        b.projectedBudget - b.estimatedCostAtCompletion,
        2,
      );
    }
  });
});

describe("golden: change-event join completeness", () => {
  it("every detail event resolves to a summary classification", () => {
    expect(result.diagnostics.unjoinedDetailEventIds).toEqual([]);
    expect(result.events.length).toBe(162);
  });

  it("net-zero internal reclasses are cancelled; INT-002 is the only kept internal", () => {
    expect(result.diagnostics.internalNonZeroEventIds).toEqual(["INT-002"]);
  });

  it("the 97/98 duplicate is the only suppressed event", () => {
    const suppressed = result.diagnostics.duplicateEventGroups.flatMap(
      (g) => g.suppressedEventIds,
    );
    expect(suppressed).toEqual(["97"]);
  });
});
