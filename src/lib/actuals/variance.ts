/**
 * Actuals Cost-History — Phase 8 active-project variance / KPI engine
 * (pure; no DB, no React).
 *
 * The SECOND consumer of the budget-snapshot storage spine and the mirror image
 * of the pricing pool. Where the pool (Phases 6–7) reads only FINAL snapshots and
 * looks FORWARD (what closed jobs should cost the next bid), this engine reads
 * **every** snapshot a project has — draft or final — and gives PMs/executives a
 * financial read on the LIVE job:
 *
 *   1. **Budget-vs-EAC variance.** Per Procore code (cost types summed) and per
 *      Procore division: `Original Budget Amount` (the estimate baseline) against
 *      `Estimated Cost at Completion` (EAC = the raw `totalActual`). Variance =
 *      EAC − Original Budget; **positive = over budget** (matches the reconcile
 *      page's sign). The whole job is included — burden (Fee / GL) too — so the
 *      division breakdown ties exactly to the snapshot's grand EAC.
 *   2. **Snapshot-over-snapshot trend.** Snapshots ordered by capture time; the
 *      EAC (and normalized) delta between consecutive uploads shows whether the
 *      projected cost is growing or shrinking over the job's life.
 *   3. **A first executive KPI view** off the latest snapshot.
 *
 * Hard contracts (plan Phase 8 + the Phase-8 handoff):
 *   - Computes from the **Procore numbers themselves** — works for projects that
 *     were never estimated in this app, and works with NO FINAL snapshot.
 *   - **Never reads or writes the pricing pool.** This is the active-job side; the
 *     pool is the forward-pricing side. They share only the storage spine.
 *   - **Raw EAC, not the pool's normalized number, is the variance signal** — a PM
 *     cares about the real money on the real job. `normalized` rides along as the
 *     in-scope contrast (the same number the pool would price on).
 *   - **Division grouping is the Procore tier-1 token** ({@link parseProcoreDivision}),
 *     never `getDivisionCode()` (that reads a CSI division from an estimate itemId,
 *     a different code space — see the conceptPricing note).
 *
 * REPORT-only (AGENTS.md "No AI Autonomy Over Financials"): nothing here writes,
 * and every number is a deterministic function of the frozen snapshot actuals.
 */

import { parseProcoreDivision } from "./conceptPricing";
import type { CodeActual } from "./types";

/** Round to cents — keeps floating-point dust out of reported variances. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Within ±0.5% of the original budget reads "on budget" (the neutral band). */
export const ON_BUDGET_TOLERANCE_PCT = 0.005;
/** Absolute floor (dollars) so a zero/near-zero baseline still gets an honest band. */
export const ON_BUDGET_TOLERANCE_ABS = 1;

/** A project's (or grain's) budget posture relative to its original budget. */
export type BudgetStatus = "over" | "under" | "on";

/** Tunable "on budget" tolerance (defaults to {@link ON_BUDGET_TOLERANCE_PCT}/ABS). */
export interface VarianceOptions {
  /** Fraction of |originalBudget| inside which variance reads "on budget". */
  tolerancePct?: number;
  /** Absolute dollar floor for the "on budget" band. */
  toleranceAbs?: number;
}

// ---------------------------------------------------------------------------
// Inputs (structurally decoupled from the DB types — db.ts passes rows straight
// in, mirroring pricingPool.FinalSnapshotInput / reconcile.EstimateLineLike).
// ---------------------------------------------------------------------------

/**
 * One budget snapshot, as the variance engine consumes it. Unlike the pricing
 * pool's {@link FinalSnapshotInput}, this carries NO event/overlay machinery: the
 * variance read is the raw budget-vs-EAC ledger, not the EFFECTIVE normalized
 * recompute. The caller (db.ts) supplies ALL of a project's snapshots — FINAL or
 * not — since this surface reads the whole history.
 */
export interface ProjectSnapshotInput {
  snapshotId: string;
  /** Per-project sequence (1, 2, 3…). */
  snapshotNumber: number;
  label: string;
  isFinal: boolean;
  /** ISO capture timestamp (the snapshot's `created_at`) — drives timeline order. */
  capturedAt: string;
  /** ISO finalize timestamp ("" when not final). */
  finalizedAt: string;
  /** The snapshot's frozen per code+type actuals (the engine's CodeActual shape). */
  codes: CodeActual[];
}

// ---------------------------------------------------------------------------
// Core variance stat (shared by code / division / snapshot grains)
// ---------------------------------------------------------------------------

/** Budget-vs-EAC for a single grain (a code, a division, or a whole snapshot). */
export interface VarianceStat {
  /** `Original Budget Amount` — the estimate baseline. */
  originalBudget: number;
  /** Estimated Cost at Completion (raw EAC / `totalActual`). */
  eac: number;
  /** Normalized actual (in-scope cost) — the raw-vs-normalized contrast. */
  normalized: number;
  /** EAC − originalBudget; **positive = over budget**. */
  variance: number;
  /** variance ÷ |originalBudget|; null when there is no budget baseline. */
  variancePct: number | null;
  /** over / under / on budget, per the tolerance band. */
  status: BudgetStatus;
}

/**
 * Compute the budget-vs-EAC stat for one grain. The "on budget" band is the wider
 * of the absolute floor and `tolerancePct × |originalBudget|`; a grain with no
 * baseline (originalBudget ≈ 0) reads "over" only once EAC clears the absolute
 * floor, never on rounding dust.
 */
export function computeVarianceStat(
  originalBudget: number,
  eac: number,
  normalized: number,
  options?: VarianceOptions,
): VarianceStat {
  const ob = round2(originalBudget);
  const e = round2(eac);
  const variance = round2(e - ob);
  const variancePct = Math.abs(ob) > 1e-9 ? variance / Math.abs(ob) : null;

  const tolPct = options?.tolerancePct ?? ON_BUDGET_TOLERANCE_PCT;
  const tolAbs = options?.toleranceAbs ?? ON_BUDGET_TOLERANCE_ABS;
  const band = Math.max(tolAbs, Math.abs(ob) * tolPct);

  let status: BudgetStatus;
  if (variance > band) status = "over";
  else if (variance < -band) status = "under";
  else status = "on";

  return { originalBudget: ob, eac: e, normalized: round2(normalized), variance, variancePct, status };
}

// ---------------------------------------------------------------------------
// Code- and division-grain variance
// ---------------------------------------------------------------------------

/** Budget-vs-EAC for one Procore cost code (cost types summed). */
export interface CodeVariance extends VarianceStat {
  costCode: string;
  description: string;
  /** True for the Fee (60-604000.000) / GL insurance (60-602020.000) codes. */
  isBurden: boolean;
}

/** Budget-vs-EAC for one Procore division, with its codes nested. */
export interface DivisionVariance extends VarianceStat {
  /** Procore division key (from {@link parseProcoreDivision}). */
  division: string;
  divisionLabel: string;
  codeCount: number;
  /** True when every code in the division is burden (Fee / GL). */
  isBurden: boolean;
  /** The division's per-code variances, biggest overrun first. */
  codes: CodeVariance[];
}

const COST_TYPE_SUFFIX = /\.(Labor|Material|Subcontract|Equipment|Other)$/;

/** Strip a trailing `.<CostType>` so a code-level row reads cleanly. */
function codeLevelDescription(desc: string): string {
  return desc.replace(COST_TYPE_SUFFIX, "");
}

/**
 * Roll a snapshot's per code+type actuals up to the Procore **cost code** grain
 * (cost types summed), one {@link CodeVariance} per code. EVERYTHING is kept —
 * burden codes and the export's blank "None" code included — so Σ(eac) ties to
 * the snapshot's grand EAC. Rows order by variance (biggest overrun first).
 */
export function buildCodeVariance(
  codes: readonly CodeActual[],
  options?: VarianceOptions,
): CodeVariance[] {
  interface CodeAgg {
    costCode: string;
    description: string;
    originalBudget: number;
    eac: number;
    normalized: number;
    isBurden: boolean;
  }
  const byCode = new Map<string, CodeAgg>();
  for (const a of codes) {
    let agg = byCode.get(a.costCode);
    if (!agg) {
      agg = {
        costCode: a.costCode,
        description: codeLevelDescription(a.description),
        originalBudget: 0,
        eac: 0,
        normalized: 0,
        isBurden: a.isBurden,
      };
      byCode.set(a.costCode, agg);
    }
    agg.originalBudget += a.originalBudget;
    agg.eac += a.totalActual;
    agg.normalized += a.normalizedActual;
    if (agg.description === "" && a.description !== "") {
      agg.description = codeLevelDescription(a.description);
    }
  }

  const out: CodeVariance[] = [];
  for (const agg of byCode.values()) {
    const stat = computeVarianceStat(agg.originalBudget, agg.eac, agg.normalized, options);
    out.push({ ...stat, costCode: agg.costCode, description: agg.description, isBurden: agg.isBurden });
  }
  return sortByVarianceDesc(out);
}

/**
 * Group a snapshot's codes into per-division budget-vs-EAC stats, keyed by the
 * Procore tier-1 token. Each division sums its codes' original / EAC / normalized
 * and recomputes its own status; divisions order by variance (biggest overrun
 * first). Σ(division eac) ties to the snapshot's grand EAC because nothing is
 * dropped (burden rolls into division "60", blank-code rows into "Unassigned").
 */
export function buildDivisionVariance(
  codes: readonly CodeActual[],
  options?: VarianceOptions,
): DivisionVariance[] {
  const codeVariances = buildCodeVariance(codes, options);

  interface DivAgg {
    division: string;
    divisionLabel: string;
    originalBudget: number;
    eac: number;
    normalized: number;
    allBurden: boolean;
    codes: CodeVariance[];
  }
  const byDiv = new Map<string, DivAgg>();
  for (const cv of codeVariances) {
    const div = parseProcoreDivision(cv.costCode);
    let agg = byDiv.get(div.key);
    if (!agg) {
      agg = {
        division: div.key,
        divisionLabel: div.label,
        originalBudget: 0,
        eac: 0,
        normalized: 0,
        allBurden: true,
        codes: [],
      };
      byDiv.set(div.key, agg);
    }
    agg.originalBudget += cv.originalBudget;
    agg.eac += cv.eac;
    agg.normalized += cv.normalized;
    agg.allBurden = agg.allBurden && cv.isBurden;
    agg.codes.push(cv);
  }

  const out: DivisionVariance[] = [];
  for (const agg of byDiv.values()) {
    const stat = computeVarianceStat(agg.originalBudget, agg.eac, agg.normalized, options);
    out.push({
      ...stat,
      division: agg.division,
      divisionLabel: agg.divisionLabel,
      codeCount: agg.codes.length,
      isBurden: agg.allBurden,
      codes: agg.codes,
    });
  }
  return sortByVarianceDesc(out);
}

/** Sort variance rows by overrun (variance desc), then EAC desc, then code key. */
function sortByVarianceDesc<T extends VarianceStat & { costCode?: string; division?: string }>(
  rows: T[],
): T[] {
  return rows.sort(
    (a, b) =>
      b.variance - a.variance ||
      b.eac - a.eac ||
      (a.costCode ?? a.division ?? "").localeCompare(b.costCode ?? b.division ?? "", undefined, {
        numeric: true,
      }),
  );
}

// ---------------------------------------------------------------------------
// Snapshot-over-snapshot timeline
// ---------------------------------------------------------------------------

/** One snapshot's point on the budget-vs-EAC timeline, with its delta from prior. */
export interface SnapshotVariancePoint extends VarianceStat {
  snapshotId: string;
  snapshotNumber: number;
  label: string;
  isFinal: boolean;
  capturedAt: string;
  finalizedAt: string;
  /** EAC change from the previous snapshot in capture order; null for the first. */
  eacDeltaFromPrev: number | null;
  /** eacDeltaFromPrev ÷ |prev EAC|; null for the first or when prev EAC ≈ 0. */
  eacDeltaPct: number | null;
  /** Normalized change from the previous snapshot; null for the first. */
  normalizedDeltaFromPrev: number | null;
}

/** Σ originalBudget / totalActual (EAC) / normalizedActual across a snapshot's codes. */
function grandTotals(codes: readonly CodeActual[]): {
  originalBudget: number;
  eac: number;
  normalized: number;
} {
  let originalBudget = 0;
  let eac = 0;
  let normalized = 0;
  for (const a of codes) {
    originalBudget += a.originalBudget;
    eac += a.totalActual;
    normalized += a.normalizedActual;
  }
  return { originalBudget, eac, normalized };
}

/**
 * Build the capture-ordered (oldest → newest) timeline: each snapshot's grand
 * budget-vs-EAC stat plus the EAC / normalized delta from the prior upload. Sort
 * is by `capturedAt`, then `snapshotNumber` as a stable tiebreak (two uploads with
 * the same timestamp keep their sequence order).
 */
export function buildTimeline(
  snapshots: readonly ProjectSnapshotInput[],
  options?: VarianceOptions,
): SnapshotVariancePoint[] {
  const ordered = [...snapshots].sort(
    (a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.snapshotNumber - b.snapshotNumber,
  );

  const points: SnapshotVariancePoint[] = [];
  let prev: SnapshotVariancePoint | null = null;
  for (const s of ordered) {
    const { originalBudget, eac, normalized } = grandTotals(s.codes);
    const stat = computeVarianceStat(originalBudget, eac, normalized, options);
    const eacDeltaFromPrev = prev ? round2(stat.eac - prev.eac) : null;
    const eacDeltaPct =
      prev && Math.abs(prev.eac) > 1e-9 ? (stat.eac - prev.eac) / Math.abs(prev.eac) : null;
    const normalizedDeltaFromPrev = prev ? round2(stat.normalized - prev.normalized) : null;
    const point: SnapshotVariancePoint = {
      ...stat,
      snapshotId: s.snapshotId,
      snapshotNumber: s.snapshotNumber,
      label: s.label,
      isFinal: s.isFinal,
      capturedAt: s.capturedAt,
      finalizedAt: s.finalizedAt,
      eacDeltaFromPrev,
      eacDeltaPct,
      normalizedDeltaFromPrev,
    };
    points.push(point);
    prev = point;
  }
  return points;
}

// ---------------------------------------------------------------------------
// Executive KPIs + the full per-project model
// ---------------------------------------------------------------------------

/** The headline executive KPIs (off the latest snapshot + the whole timeline). */
export interface VarianceKpis extends VarianceStat {
  /** Burden (Fee + GL) EAC in the latest snapshot. */
  burdenEac: number;
  /** Direct (non-burden) EAC in the latest snapshot (= eac − burdenEac). */
  directEac: number;
  /** Divisions whose status is "over" in the latest snapshot. */
  divisionsOverBudget: number;
  /** Total divisions in the latest snapshot. */
  divisionCount: number;
  /** Number of snapshots uploaded for the project. */
  snapshotCount: number;
  /** EAC change across the whole timeline (latest − earliest); null when < 2. */
  eacTrend: number | null;
  /** ISO capture timestamp of the latest snapshot. */
  latestCapturedAt: string;
  /** True when the latest snapshot is the project's FINAL closeout. */
  latestIsFinal: boolean;
}

/** The complete variance/KPI read the dashboard consumes for one project. */
export interface ProjectVarianceModel {
  /** False when the project has no snapshots (honest empty state). */
  hasData: boolean;
  /** Every snapshot's point, oldest → newest. */
  timeline: SnapshotVariancePoint[];
  /** The newest snapshot's point (the headline), or null when none. */
  latest: SnapshotVariancePoint | null;
  /** Division breakdown for the latest snapshot (biggest overrun first). */
  divisions: DivisionVariance[];
  /** Executive KPIs off the latest snapshot, or null when none. */
  kpis: VarianceKpis | null;
}

/**
 * Build the full per-project variance model from ALL of the project's snapshots.
 * Pure: the snapshots already carry their frozen per-code actuals (db.ts's
 * getProjectBudgetVariance), so this never touches the database or the pricing
 * pool. An empty input yields an honest `hasData: false` model.
 */
export function buildProjectVariance(
  snapshots: readonly ProjectSnapshotInput[],
  options?: VarianceOptions,
): ProjectVarianceModel {
  const timeline = buildTimeline(snapshots, options);
  if (timeline.length === 0) {
    return { hasData: false, timeline: [], latest: null, divisions: [], kpis: null };
  }

  const latest = timeline[timeline.length - 1];
  const latestSnap = snapshots.find((s) => s.snapshotId === latest.snapshotId);
  const latestCodes = latestSnap?.codes ?? [];

  const divisions = buildDivisionVariance(latestCodes, options);
  const burdenEac = round2(
    latestCodes.filter((a) => a.isBurden).reduce((sum, a) => sum + a.totalActual, 0),
  );
  const directEac = round2(latest.eac - burdenEac);
  const divisionsOverBudget = divisions.filter((d) => d.status === "over").length;
  const eacTrend = timeline.length >= 2 ? round2(latest.eac - timeline[0].eac) : null;

  const kpis: VarianceKpis = {
    originalBudget: latest.originalBudget,
    eac: latest.eac,
    normalized: latest.normalized,
    variance: latest.variance,
    variancePct: latest.variancePct,
    status: latest.status,
    burdenEac,
    directEac,
    divisionsOverBudget,
    divisionCount: divisions.length,
    snapshotCount: timeline.length,
    eacTrend,
    latestCapturedAt: latest.capturedAt,
    latestIsFinal: latest.isFinal,
  };

  return { hasData: true, timeline, latest, divisions, kpis };
}
