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

// ---------------------------------------------------------------------------
// Lens (Phase 2) — the Estimate | Buyout view toggle.
//
// The lens is a pure VIEW concern: which built-in grid columns are visible. It never
// changes a row, a total, or what gets exported — it only SWAPS columns (L-1). These
// helpers are kept here (pure, React-free) so the swap is unit-testable and so the shared
// types file can import the store shape without reaching into the client hook.
// ---------------------------------------------------------------------------

/** Which grid lens is active. `'estimate'` is the default (first-time + SSR), per D-D. */
export type LensView = "estimate" | "buyout";

/**
 * The three screen-only built-in columns the Buyout lens reveals (L-2). They live as
 * TanStack columns only — never in the persisted/exported `ColumnDefinition[]` model — so
 * the Excel/Procore export stays byte-identical (the goldens tie). Vendor + Actual are
 * editable (→ the browser-local buyout store); Variance is a read-only derived display.
 */
export const BUYOUT_LENS_COLUMN_IDS = ["vendor", "actual", "variance"] as const;

/**
 * The estimating-only columns the Buyout lens hides — the other half of the SWAP (L-1), so
 * the grid never grows wider. Code/Description/Total stay visible in both lenses (Total is
 * reused as the "Estimate" column, D-E).
 */
export const ESTIMATE_ONLY_COLUMN_IDS = [
  "matchedQty",
  "uom",
  "unitPrice",
  "costPerUnit",
  "costPerSf",
] as const;

/** Coerce an untrusted stored value (localStorage is user-writable) to a known lens. */
export function normalizeLensView(raw: unknown): LensView {
  return raw === "buyout" ? "buyout" : "estimate";
}

/**
 * TanStack `columnVisibility` derived from the active lens — the column SWAP (L-1). In the
 * Buyout lens the three buyout columns show and the five estimating-only columns hide; in
 * the Estimate lens it is the exact inverse, so the estimate view is unchanged. Columns not
 * named here (Code/Description/Total/structural) default to visible in both lenses.
 */
export function buyoutColumnVisibility(lens: LensView): Record<string, boolean> {
  const buyout = lens === "buyout";
  const visibility: Record<string, boolean> = {};
  for (const id of BUYOUT_LENS_COLUMN_IDS) visibility[id] = buyout;
  for (const id of ESTIMATE_ONLY_COLUMN_IDS) visibility[id] = !buyout;
  return visibility;
}

/**
 * The buyout store handle exposed on the grid's TanStack table `meta` (Phase 2). Cell
 * renderers read/commit through it; it is the SAME shape `useBuyoutTracking` returns, kept
 * here (in the pure lib) so `types/index.ts` can type `meta.buyout` without importing the
 * client hook. Commits route ONLY to this store (localStorage) — never to rows/DB/export.
 */
export interface BuyoutStore {
  /** This line's annotation, or a blank one if never edited. Always defined. */
  getLine: (rowId: string) => BuyoutLine;
  /** Award (or re-award) a line to a vendor. */
  setVendor: (rowId: string, vendor: string) => void;
  /** Record (or clear, via null) a line's actual cost. */
  setActual: (rowId: string, actual: number | null) => void;
  /** The whole project ledger — fed to computeBuyoutRollup for the footer (Phase 4). */
  map: Record<string, BuyoutLine>;
}

/**
 * Applies an EDIT_BUYOUT_CELL value to the buyout store — the shared core of the dispatcher's
 * redo (pass `nextValue`) and undo (pass `prevValue`) (Phase 3). Pure routing: `vendor` → a
 * string via `setVendor`, `actual` → a `number | null` via `setActual` (a cleared Actual stays
 * `null`, reading as the Estimate per L-3). localStorage only — it NEVER touches rows, the
 * engine, or the export, so an undo/redo can never move a dollar. Kept here (pure, store-typed)
 * so it is unit-testable with a fake `BuyoutStore` and DRY across the forward/inverse cases.
 */
export function applyBuyoutCommandValue(
  store: Pick<BuyoutStore, "setVendor" | "setActual">,
  rowId: string,
  field: "vendor" | "actual",
  value: string | number | null,
): void {
  if (field === "vendor") {
    store.setVendor(rowId, (value ?? "") as string);
  } else {
    store.setActual(rowId, value as number | null);
  }
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
 * The read-only derived state a row's Total may carry (a structural subset of
 * `getLinkedRowState`'s shape in useTakeoffWorkbook). `null` = a normal row whose Total is
 * just its own number; non-null = a linked-division or user-bound row showing a live value.
 */
export interface LinkedEstimateState {
  /** The linked/bound live value driving the row's displayed Total. */
  value: number;
  /** A linked-division row carrying stray typed dollars — excluded from every total (reads 0). */
  stray: boolean;
}

/**
 * Resolves the Estimate a buyout line is measured against — the row's *displayed* Total (D-E),
 * including linked/bound rows' live value. A stray linked row reads as 0 (its typed dollars are
 * excluded from every total, matching the grid); a plain row reads as its own `rowTotal`. This
 * is the SINGLE source the Variance cell and the footer rollup both call, so the per-cell
 * variance and the footer's Estimate total can never drift apart.
 */
export function resolveLineEstimate(linked: LinkedEstimateState | null, rowTotal: number): number {
  return linked ? (linked.stray ? 0 : linked.value) : rowTotal;
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

/**
 * The whole-job "how's buyout going" read, mirroring the bottom of the company template's
 * STEP 4 - ESTIMATE sheet (cells P341 / O347 / P347): Total Projected Cost, Projected Profit
 * ($ and %). `bid` is the engine's grand Total Estimated Cost (subtotal + every modifier +
 * fee); `profit` is in dollars; `profitPct` is a ratio (e.g. 0.0495 = 4.95%).
 */
export interface BuyoutProfit {
  /** Total Estimated Cost — the bid, incl. modifiers + fee (engine value; ties to template I341). */
  bid: number;
  /** Total Projected Cost = bid − profit; = Σ actual-or-estimate over lines + contingency/insurance, excl. fee (ties to template P341). */
  projectedCost: number;
  /** Projected Profit $ = fee + buyout savings = bid − projectedCost (ties to template O347). */
  profit: number;
  /** Projected Profit % = profit / projectedCost; 0 when projectedCost is 0 (guarded; ties to template P347). */
  profitPct: number;
}

/**
 * Projected profit, computed exactly the way the company template does (see the STEP 4 bottom
 * block). The Fee is part of the bid but is NOT a cost you pay out (the template marks its
 * Actual "NA"), so it falls straight to profit; every dollar a sub comes in under its estimate
 * (the data-line buyout savings, = `dataLineRollup.projectedVariance`) adds to it. Hence:
 *   profit        = fee + savings
 *   projectedCost = bid − profit            (provably = subtotal-of-actuals + contingency/insurance = template P341)
 *   profitPct     = profit / projectedCost  (zero-guarded)
 * Anchoring on the engine `bid` (rather than re-summing rows) keeps "Total Estimate (Bid)" and
 * "Total Projected Cost" on one basis, so the footer ties to both the grid total and the template.
 * Pure/display-only — it never moves a bid dollar; the savings come from the browser-local ledger.
 */
export function computeBuyoutProfit(args: {
  bid: number;
  fee: number;
  dataLineRollup: BuyoutRollup;
}): BuyoutProfit {
  const savings = args.dataLineRollup.projectedVariance; // Σ (estimate − actual) on data lines
  const profit = args.fee + savings;
  const projectedCost = args.bid - profit;
  return {
    bid: args.bid,
    projectedCost,
    profit,
    profitPct: projectedCost === 0 ? 0 : profit / projectedCost,
  };
}
