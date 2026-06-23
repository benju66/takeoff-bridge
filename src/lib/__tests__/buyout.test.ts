/**
 * Phase 1 — Estimate Buyout Lens pure math.
 *
 * Locks the variance convention (L-3: Variance = Estimate - Actual, positive = favorable,
 * empty Actual reads as Estimate) and the footer rollup (projected cost = Σ Actual-or-Estimate;
 * "% of value committed" L-4 = Σ Estimate on lines with a Vendor ÷ Σ Estimate, zero-guarded).
 * Nothing here can move a bid dollar — buyout is a display-only side-ledger.
 */

import { describe, it, expect } from "vitest";
import {
  resolveActual,
  lineVariance,
  isCommitted,
  computeBuyoutRollup,
  BuyoutRollupRow,
  normalizeLensView,
  buyoutColumnVisibility,
  BUYOUT_LENS_COLUMN_IDS,
  ESTIMATE_ONLY_COLUMN_IDS,
} from "../buyout";

describe("resolveActual", () => {
  it("reads an empty Actual as the Estimate (L-3)", () => {
    expect(resolveActual(1000, null)).toBe(1000);
  });

  it("uses the Actual when entered", () => {
    expect(resolveActual(1000, 900)).toBe(900);
  });

  it("honors an explicit 0 Actual (not treated as blank)", () => {
    expect(resolveActual(1000, 0)).toBe(0);
  });
});

describe("lineVariance", () => {
  it("empty Actual ⇒ zero variance (L-3)", () => {
    expect(lineVariance({ estimate: 1000, actual: null })).toEqual({
      projectedCost: 1000,
      varianceDollars: 0,
      variancePct: 0,
    });
  });

  it("under-budget Actual is favorable (positive variance)", () => {
    const v = lineVariance({ estimate: 1000, actual: 900 });
    expect(v.varianceDollars).toBe(100);
    expect(v.variancePct).toBeCloseTo(0.1, 10);
    expect(v.projectedCost).toBe(900);
  });

  it("over-budget Actual is unfavorable (negative variance)", () => {
    const v = lineVariance({ estimate: 1000, actual: 1250 });
    expect(v.varianceDollars).toBe(-250);
    expect(v.variancePct).toBeCloseTo(-0.25, 10);
    expect(v.projectedCost).toBe(1250);
  });

  it("guards a zero Estimate — no NaN/Infinity", () => {
    const v = lineVariance({ estimate: 0, actual: 500 });
    expect(v.varianceDollars).toBe(-500);
    expect(v.variancePct).toBe(0);
    expect(Number.isFinite(v.variancePct)).toBe(true);
  });

  it("an explicit 0 Actual on a real Estimate is full favorable variance", () => {
    const v = lineVariance({ estimate: 800, actual: 0 });
    expect(v.varianceDollars).toBe(800);
    expect(v.variancePct).toBe(1);
  });
});

describe("isCommitted", () => {
  it("blank / whitespace vendor is not committed", () => {
    expect(isCommitted({ vendor: "" })).toBe(false);
    expect(isCommitted({ vendor: "   " })).toBe(false);
  });

  it("a named vendor is committed", () => {
    expect(isCommitted({ vendor: "Acme Drywall" })).toBe(true);
  });
});

describe("computeBuyoutRollup", () => {
  it("empty estimate ⇒ all zeros, percent guarded", () => {
    expect(computeBuyoutRollup([])).toEqual({
      estimateTotal: 0,
      projectedCost: 0,
      projectedVariance: 0,
      committedEstimate: 0,
      percentCommitted: 0,
    });
  });

  it("rolls up projected cost as Σ Actual-or-Estimate and variance as the favorable delta", () => {
    const rows: BuyoutRollupRow[] = [
      { estimate: 1000, vendor: "Acme", actual: 900 }, // bought out under
      { estimate: 2000, vendor: "Bolt", actual: 2200 }, // bought out over
      { estimate: 500, vendor: "", actual: null }, // not bought out → reads as estimate
    ];
    const r = computeBuyoutRollup(rows);
    expect(r.estimateTotal).toBe(3500);
    expect(r.projectedCost).toBe(900 + 2200 + 500); // 3600
    expect(r.projectedVariance).toBe(3500 - 3600); // -100 unfavorable
  });

  it("'% of value committed' = Σ Estimate on lines with a Vendor ÷ Σ Estimate (L-4)", () => {
    const rows: BuyoutRollupRow[] = [
      { estimate: 1000, vendor: "Acme", actual: null }, // committed, even with no Actual yet
      { estimate: 3000, vendor: "", actual: null }, // not committed
    ];
    const r = computeBuyoutRollup(rows);
    expect(r.committedEstimate).toBe(1000);
    expect(r.percentCommitted).toBeCloseTo(0.25, 10); // 1000 / 4000
  });

  it("commitment counts the Estimate, not the Actual (an under-bought line still commits full estimate)", () => {
    const rows: BuyoutRollupRow[] = [{ estimate: 1000, vendor: "Acme", actual: 600 }];
    const r = computeBuyoutRollup(rows);
    expect(r.committedEstimate).toBe(1000);
    expect(r.percentCommitted).toBe(1);
  });

  it("zero-estimate guard: lines that sum to 0 never produce NaN percent", () => {
    const rows: BuyoutRollupRow[] = [{ estimate: 0, vendor: "Acme", actual: 0 }];
    const r = computeBuyoutRollup(rows);
    expect(r.percentCommitted).toBe(0);
    expect(Number.isFinite(r.percentCommitted)).toBe(true);
  });
});

describe("normalizeLensView", () => {
  it("defaults to 'estimate' for anything that is not exactly 'buyout' (D-D)", () => {
    expect(normalizeLensView(null)).toBe("estimate");
    expect(normalizeLensView(undefined)).toBe("estimate");
    expect(normalizeLensView("")).toBe("estimate");
    expect(normalizeLensView("Estimate")).toBe("estimate");
    expect(normalizeLensView("garbage")).toBe("estimate");
    expect(normalizeLensView(42)).toBe("estimate");
  });

  it("recognizes the stored 'buyout' value", () => {
    expect(normalizeLensView("buyout")).toBe("buyout");
  });
});

describe("buyoutColumnVisibility (the column SWAP, L-1)", () => {
  it("Buyout lens shows the buyout columns and hides the estimating-only columns", () => {
    const vis = buyoutColumnVisibility("buyout");
    for (const id of BUYOUT_LENS_COLUMN_IDS) expect(vis[id]).toBe(true);
    for (const id of ESTIMATE_ONLY_COLUMN_IDS) expect(vis[id]).toBe(false);
  });

  it("Estimate lens is the exact inverse (buyout columns hidden, estimating columns shown)", () => {
    const vis = buyoutColumnVisibility("estimate");
    for (const id of BUYOUT_LENS_COLUMN_IDS) expect(vis[id]).toBe(false);
    for (const id of ESTIMATE_ONLY_COLUMN_IDS) expect(vis[id]).toBe(true);
  });

  it("only ever touches the swap columns — never Code/Description/Total/structural", () => {
    const swapped = new Set<string>([...BUYOUT_LENS_COLUMN_IDS, ...ESTIMATE_ONLY_COLUMN_IDS]);
    for (const lens of ["estimate", "buyout"] as const) {
      const keys = Object.keys(buyoutColumnVisibility(lens));
      expect(new Set(keys)).toEqual(swapped);
      // No overlap between the two halves of the swap.
      expect(keys.length).toBe(BUYOUT_LENS_COLUMN_IDS.length + ESTIMATE_ONLY_COLUMN_IDS.length);
    }
    // The two lists are disjoint (a column can't be both shown and hidden by the same lens).
    for (const id of BUYOUT_LENS_COLUMN_IDS) {
      expect(ESTIMATE_ONLY_COLUMN_IDS as readonly string[]).not.toContain(id);
    }
  });
});
