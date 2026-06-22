/**
 * Estimate Buyout Lens — pure math (Phase 1).
 *
 * Zero React / DB / localStorage dependencies — testable in isolation, mirroring
 * overrides.ts. This module owns ONLY the arithmetic of the buyout view: per-line
 * variance (favorable/unfavorable) and the footer rollup. It NEVER touches the costing
 * engine (calculations.ts owns every estimate dollar) — buyout is a private side-ledger
 * layered on top of a line's already-computed Estimate total.
 *
 * Variance convention (L-3): `Variance = Estimate - Actual`; positive = favorable (came
 * in under the estimate). An empty Actual (`null`) *reads as* the Estimate, so an
 * un-bought-out line shows zero variance and contributes its Estimate to the projected
 * cost — no pre-fill, no stored copy to drift.
 */

/** A line's browser-local buyout annotation. `actual === null` means "not yet entered". */
export interface BuyoutLine {
  /** Free-text vendor/subcontractor the work was awarded to ("" = not awarded yet). */
  vendor: string;
  /** Actual committed cost, or `null` when blank (reads as the Estimate per L-3). */
  actual: number | null;
}

/** Per-line variance result, all in dollars except `variancePct` (a ratio, e.g. 0.1 = 10%). */
export interface LineVariance {
  /** Actual when entered, else the Estimate (L-3) — what this line is projected to cost. */
  projectedCost: number;
  /** `Estimate - projectedCost`; > 0 favorable (under), < 0 unfavorable (over). */
  varianceDollars: number;
  /** `varianceDollars / Estimate`; 0 when Estimate is 0 (guarded — never NaN/Infinity). */
  variancePct: number;
}

/** Footer rollup across every data line in the estimate. */
export interface BuyoutRollup {
  /** Σ Estimate (the line Totals) — the engine-owned bid number, unchanged by buyout. */
  estimateTotal: number;
  /** Σ (Actual-or-Estimate) — where the job is projected to land once fully bought out. */
  projectedCost: number;
  /** `estimateTotal - projectedCost`; > 0 favorable, < 0 unfavorable. */
  projectedVariance: number;
  /** Σ Estimate on lines that have a Vendor — the dollars already committed. */
  committedEstimate: number;
  /** `committedEstimate / estimateTotal` (L-4); 0 when estimateTotal is 0 (guarded). */
  percentCommitted: number;
}

/** One line's inputs to the rollup: its engine Estimate total plus its buyout annotation. */
export interface BuyoutRollupRow extends BuyoutLine {
  /** The line's computed Estimate (its Total, including linked/bound rows' live value). */
  estimate: number;
}

/**
 * Resolves an Actual against its Estimate. A blank Actual (`null`) reads as the Estimate
 * (L-3), so it never shows a phantom variance and contributes its Estimate to projected cost.
 */
export function resolveActual(estimate: number, actual: number | null): number {
  return actual === null ? estimate : actual;
}

/**
 * Per-line variance ($ and %). Empty Actual ⇒ zero variance (L-3). The percentage is
 * guarded against a zero Estimate so a $0 line never produces NaN/Infinity.
 */
export function lineVariance(line: { estimate: number; actual: number | null }): LineVariance {
  const projectedCost = resolveActual(line.estimate, line.actual);
  const varianceDollars = line.estimate - projectedCost;
  const variancePct = line.estimate === 0 ? 0 : varianceDollars / line.estimate;
  return { projectedCost, varianceDollars, variancePct };
}

/** True when a line is "committed" — awarded to a vendor (non-blank, non-whitespace). */
export function isCommitted(line: { vendor: string }): boolean {
  return line.vendor.trim() !== "";
}

/**
 * Footer rollup: Estimate total, projected cost (Σ Actual-or-Estimate), projected variance,
 * and "% of value committed" (L-4 — Σ Estimate on lines with a Vendor ÷ Σ Estimate). The
 * percentage is guarded against a zero Estimate total.
 */
export function computeBuyoutRollup(rows: BuyoutRollupRow[]): BuyoutRollup {
  let estimateTotal = 0;
  let projectedCost = 0;
  let committedEstimate = 0;

  for (const row of rows) {
    estimateTotal += row.estimate;
    projectedCost += resolveActual(row.estimate, row.actual);
    if (isCommitted(row)) committedEstimate += row.estimate;
  }

  return {
    estimateTotal,
    projectedCost,
    projectedVariance: estimateTotal - projectedCost,
    committedEstimate,
    percentCommitted: estimateTotal === 0 ? 0 : committedEstimate / estimateTotal,
  };
}
