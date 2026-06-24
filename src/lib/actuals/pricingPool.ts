/**
 * Actuals Cost-History — Phase 6 pricing pool (pure; no DB, no React).
 *
 * The FIRST downstream reader of the FINAL budget snapshots. A snapshot becomes
 * eligible for the pricing pool only when a human marks it FINAL (Phase 5 — "the
 * doorway into cost history"); this module turns those FINAL snapshots into a
 * standalone **dollars-per-code actuals history** that estimators consult FORWARD
 * when pricing the next job. It is the actuals-side twin of `historyTrust.ts`
 * (which pools AS-BID unit prices) — but a SEPARATE pool: `actual` provenance is
 * never blended with as-bid, and actuals are dollars-only (no UOM, never adoptable
 * as a unit rate).
 *
 * Two hard contracts (plan "Locked decisions" + Phase-5 handoff Non-obvious #1):
 *
 *   1. **EFFECTIVE normalized, never frozen.** The pricing-relevant per-code
 *      normalized actual is NOT `CodeActual.normalizedActual` read off the frozen
 *      snapshot — it is the result of {@link applyEventClassificationOverrides}
 *      over the frozen actuals + events + the snapshot's `event_classification`
 *      overlay rows. Reading frozen directly would silently ignore every Phase-5
 *      human correction. This module runs that recompute (the function is pure).
 *   2. **Normalized is the pricing signal.** Normalized = EAC − owner extras −
 *      allowance reconciles − net-zero internal reclasses, KEEPING in-scope FP
 *      Contingency/Buyout draws (incl. savings — negatives are retained so the
 *      pool captures full buyout variance). `totalActual` (EAC) rides along only
 *      as the raw-vs-normalized contrast.
 *
 * Grain: the snapshot stores `code + costType` (`1-10320.000.Labor`); the pool
 * REPORTS at the **Procore cost code** level (cost types summed), because that is
 * the level a `/rates` row resolves to via `resolveProcoreCode`. Burden codes
 * (Fee / GL) and the export's blank "None" code carry no pricing signal and are
 * excluded.
 *
 * A **strength/confidence** signal extends the `historyTrust` philosophy
 * (actual-backed > estimate-only; sample size & coverage; CO-cleanliness; recency;
 * spread) so thin or CO-churned coverage is VISIBLE rather than hidden.
 *
 * Guardrails (AGENTS.md "No AI Autonomy Over Financials"): REPORT-only — nothing
 * here writes, and actuals are never adopted into the rate card (no UOM to adopt).
 */

import { applyEventClassificationOverrides, collectEventOverrides } from "./eventReview";
import type { OverlayRowLike } from "./eventReview";
import { median } from "../priceHistory";
import { LOW_CONFIDENCE_BELOW } from "../historyTrust";
import type { CodeActual, ClassifiedChangeEvent } from "./types";

/** Round to cents — keeps floating-point dust out of reported pool numbers. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// ---------------------------------------------------------------------------
// Inputs (structurally decoupled from the DB types — the page/db.ts pass real
// rows straight in, mirroring reconcile.ts's EstimateLineLike / AllocationLike).
// ---------------------------------------------------------------------------

/**
 * One FINAL budget snapshot, as the pool consumes it. The caller (db.ts) is
 * responsible for supplying ONLY FINAL snapshots — promotion is the doorway and
 * this module trusts it. `overlayRows` are the snapshot's full allocation overlay
 * (the `event_classification` rows are filtered out internally by
 * {@link collectEventOverrides}; non-event rows are ignored).
 */
export interface FinalSnapshotInput {
  projectId: string;
  projectName: string;
  snapshotId: string;
  snapshotLabel: string;
  /** ISO finalize timestamp ("" when unset) — drives recency. */
  finalizedAt: string;
  /** Project market sector ("" = legacy unset — its own honest group). */
  marketSector: string;
  /**
   * Project gross square footage (0 = unknown). Carried for Phase-7 parametric
   * ($/SF) concept pricing; the dollars pool itself never divides by it.
   */
  squareFootage: number;
  /**
   * Project unit / key count (0 = unknown). Carried for Phase-7 parametric
   * ($/unit) concept pricing; the dollars pool itself never divides by it.
   */
  unitCount: number;
  /** The snapshot's frozen per code+type actuals. */
  actuals: CodeActual[];
  /** The snapshot's frozen classified change events. */
  events: ClassifiedChangeEvent[];
  /** The snapshot's full overlay rows (Phase-4 + Phase-5). */
  overlayRows: OverlayRowLike[];
}

// ---------------------------------------------------------------------------
// Observation (one FINAL snapshot × one Procore cost code)
// ---------------------------------------------------------------------------

/**
 * One closed-job actual for a single Procore **cost code** (cost types summed),
 * carrying the EFFECTIVE normalized dollars (after Phase-5 overrides). The
 * actuals-side analogue of `PriceObservation` — but dollars, not a unit rate,
 * and `actual` provenance by construction.
 */
export interface ActualCostObservation {
  /** Procore cost code, e.g. `"1-10320.000"` (the pool grain). */
  costCode: string;
  description: string;
  /** EFFECTIVE normalized actual (dollars) for this code on this job. */
  normalizedActual: number;
  /** Raw EAC total for this code on this job (the raw-vs-normalized contrast). */
  totalActual: number;
  isBurden: boolean;
  /**
   * How much of this code's EAC was adjudicated away by classification
   * (|total − normalized| ÷ |total|, 0..1). Higher = leaned more on judgment =
   * a weaker pricing signal. 0 when there is no EAC to divide by.
   */
  coAdjustmentShare: number;
  projectId: string;
  projectName: string;
  snapshotId: string;
  snapshotLabel: string;
  /** ISO finalize date ("" when unset). */
  finalizedAt: string;
  marketSector: string;
  /**
   * Project gross square footage (0 = unknown) — the $/SF denominator for
   * Phase-7 concept pricing. Carried verbatim from the snapshot's project; the
   * dollars pool ignores it (a 0 simply yields no parametric datum downstream).
   */
  squareFootage: number;
  /** Project unit / key count (0 = unknown) — the $/unit denominator (Phase 7). */
  unitCount: number;
}

/**
 * Turn FINAL snapshots into per-(snapshot, code) actual-cost observations,
 * honoring every Phase-5 classification override.
 *
 * For each snapshot: collect its event overrides, run the delta-based
 * {@link applyEventClassificationOverrides} recompute (frozen rows never mutated),
 * then aggregate the EFFECTIVE per code+type actuals up to the cost-code grain.
 * Burden codes (Fee / GL), the blank `""` "None" code, and zero-normalized codes
 * (no original-scope signal — mirrors the as-bid `total ≠ 0` rule) are excluded;
 * negatives (savings / buyout) are retained.
 */
export function buildActualCostObservations(
  snapshots: FinalSnapshotInput[],
): ActualCostObservation[] {
  const observations: ActualCostObservation[] = [];

  for (const snap of snapshots) {
    const overrides = collectEventOverrides(snap.overlayRows);
    const effective = applyEventClassificationOverrides({
      actuals: snap.actuals,
      events: snap.events,
      overrides,
    });

    // Aggregate effective code+type actuals to the cost-code grain.
    interface CodeAgg {
      costCode: string;
      description: string;
      total: number;
      normalized: number;
      isBurden: boolean;
    }
    const byCode = new Map<string, CodeAgg>();
    for (const a of effective.effectiveActuals) {
      if (a.costCode === "") continue; // the export's blank "None" header row
      if (a.isBurden) continue; // Fee / GL burden — not a pricing signal
      let agg = byCode.get(a.costCode);
      if (!agg) {
        agg = {
          costCode: a.costCode,
          description: codeLevelDescription(a.description),
          total: 0,
          normalized: 0,
          isBurden: a.isBurden,
        };
        byCode.set(a.costCode, agg);
      }
      agg.total += a.totalActual;
      agg.normalized += a.normalizedActual;
      if (agg.description === "" && a.description !== "") {
        agg.description = codeLevelDescription(a.description);
      }
    }

    for (const agg of byCode.values()) {
      const normalized = round2(agg.normalized);
      if (normalized === 0) continue; // no original-scope cost landed here
      const total = round2(agg.total);
      const coAdjustmentShare =
        Math.abs(total) > 1e-9 ? clamp01(Math.abs(total - normalized) / Math.abs(total)) : 0;
      observations.push({
        costCode: agg.costCode,
        description: agg.description,
        normalizedActual: normalized,
        totalActual: total,
        isBurden: agg.isBurden,
        coAdjustmentShare,
        projectId: snap.projectId,
        projectName: snap.projectName,
        snapshotId: snap.snapshotId,
        snapshotLabel: snap.snapshotLabel,
        finalizedAt: snap.finalizedAt,
        marketSector: snap.marketSector,
        squareFootage: snap.squareFootage,
        unitCount: snap.unitCount,
      });
    }
  }

  return observations;
}

const COST_TYPE_SUFFIX = /\.(Labor|Material|Subcontract|Equipment|Other)$/;

/** Strip the trailing `.<CostType>` so a code-level row reads cleanly. */
function codeLevelDescription(desc: string): string {
  return desc.replace(COST_TYPE_SUFFIX, "");
}

// ---------------------------------------------------------------------------
// Strength / confidence (extends the historyTrust philosophy)
// ---------------------------------------------------------------------------

/**
 * Months at/above which a single most-recent FINAL snapshot is fully "fresh".
 * Recent closeouts price the next job best; conservative — a year is still fresh.
 */
export const RECENCY_FRESH_MONTHS = 12;
/** Months by which recency has decayed to zero (a 5-year-old closeout). */
export const RECENCY_STALE_MONTHS = 60;

/** Composite-score weights (sum 1) — sample size dominates, then cleanliness. */
export const STRENGTH_WEIGHTS = {
  sampleSize: 0.35,
  coCleanliness: 0.25,
  recency: 0.2,
  spread: 0.2,
} as const;

/**
 * The actual-backed FLOOR. Even a thin, CO-churned single FINAL job is grounded
 * in real money, so its composite never drops below this — keeping any
 * actual-backed group ABOVE an estimate-only as-bid baseline (the locked
 * "actual-backed > estimate-only" rule).
 */
export const ACTUAL_PROVENANCE_FLOOR = 0.35;

/** Composite ≥ this reads "strong"; ≥ {@link STRENGTH_MODERATE} reads "moderate". */
export const STRENGTH_STRONG = 0.7;
export const STRENGTH_MODERATE = 0.5;

export type StrengthTier = "strong" | "moderate" | "thin";

/** The decomposed signals behind a strength score (all 0..1 except as noted). */
export interface ActualStrengthSignals {
  /** Always `"actual"` here — the provenance that earns the floor. */
  provenance: "actual";
  /** Number of FINAL-snapshot jobs backing the group. */
  sampleSize: number;
  /** Sample adequacy: min(count / LOW_CONFIDENCE_BELOW, 1). */
  sampleAdequacy: number;
  /** 1 − mean(coAdjustmentShare): 1 = clean COs, 0 = heavily adjudicated. */
  coCleanliness: number;
  /** Months since the latest FINAL snapshot (null when no date is known). */
  recencyMonths: number | null;
  /** Recency factor 0..1 (1 = fresh, decays to 0 by RECENCY_STALE_MONTHS). */
  recency: number;
  /** Coefficient of variation of normalized across jobs (null when count < 2). */
  spreadCv: number | null;
  /** Spread tightness 0..1 (1 − clamp(cv); neutral 0.5 when unjudgeable). */
  spreadTightness: number;
}

/**
 * The minimal observation shape {@link scoreActualStrength} actually reads. The
 * dollars pool passes full {@link ActualCostObservation}s; Phase-7 concept pricing
 * passes a parametric group whose `normalizedActual` carries the **$/metric**
 * value, so the spread dimension reflects $/SF (or $/unit) tightness while every
 * other dimension (count, CO-cleanliness, recency) and the tier/label vocabulary
 * stay identical to `/rates`.
 */
export type StrengthScorable = Pick<
  ActualCostObservation,
  "normalizedActual" | "coAdjustmentShare" | "finalizedAt"
>;

/** A group's strength/confidence verdict. */
export interface ActualStrength {
  /** 0..1 composite (≥ ACTUAL_PROVENANCE_FLOOR for any actual-backed group). */
  score: number;
  tier: StrengthTier;
  /** Human label, e.g. "3 jobs · clean COs · recent" / "1 job · low confidence". */
  label: string;
  signals: ActualStrengthSignals;
}

/** Months between two ISO dates (now − then); null when `then` is unparseable. */
function monthsSince(isoDate: string, now: Date): number | null {
  if (!isoDate) return null;
  const then = new Date(isoDate);
  if (Number.isNaN(then.getTime())) return null;
  const ms = now.getTime() - then.getTime();
  return ms <= 0 ? 0 : ms / (1000 * 60 * 60 * 24 * 30.4375);
}

/** Population coefficient of variation (stddev ÷ |mean|); null when count < 2. */
function coefficientOfVariation(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (Math.abs(mean) < 1e-9) return null;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

/**
 * Score one (code, sector) group's strength. Actual-backed earns a floor; sample
 * size, CO-cleanliness, recency, and spread refine it upward. `strong` additionally
 * requires `count ≥ LOW_CONFIDENCE_BELOW` (the hard low-confidence gate mirrored
 * from `historyTrust`) — one clean job is real, but never "strong".
 */
export function scoreActualStrength(
  observations: readonly StrengthScorable[],
  options?: { now?: Date },
): ActualStrength {
  const now = options?.now ?? new Date();
  const count = observations.length;

  const sampleAdequacy = clamp01(count / LOW_CONFIDENCE_BELOW);

  const meanCoShare =
    count > 0 ? observations.reduce((s, o) => s + o.coAdjustmentShare, 0) / count : 0;
  const coCleanliness = clamp01(1 - meanCoShare);

  const latestFinalizedAt = observations.reduce(
    (latest, o) => (o.finalizedAt > latest ? o.finalizedAt : latest),
    "",
  );
  const recencyMonths = monthsSince(latestFinalizedAt, now);
  let recency: number;
  if (recencyMonths === null) recency = 0.5; // unknown date — neutral, not punished
  else if (recencyMonths <= RECENCY_FRESH_MONTHS) recency = 1;
  else if (recencyMonths >= RECENCY_STALE_MONTHS) recency = 0;
  else
    recency =
      1 - (recencyMonths - RECENCY_FRESH_MONTHS) / (RECENCY_STALE_MONTHS - RECENCY_FRESH_MONTHS);

  const spreadCv = coefficientOfVariation(observations.map((o) => o.normalizedActual));
  const spreadTightness = spreadCv === null ? 0.5 : clamp01(1 - spreadCv);

  const weighted =
    STRENGTH_WEIGHTS.sampleSize * sampleAdequacy +
    STRENGTH_WEIGHTS.coCleanliness * coCleanliness +
    STRENGTH_WEIGHTS.recency * recency +
    STRENGTH_WEIGHTS.spread * spreadTightness;

  const score = round2(ACTUAL_PROVENANCE_FLOOR + (1 - ACTUAL_PROVENANCE_FLOOR) * clamp01(weighted));

  let tier: StrengthTier;
  if (score >= STRENGTH_STRONG && count >= LOW_CONFIDENCE_BELOW) tier = "strong";
  else if (score >= STRENGTH_MODERATE) tier = "moderate";
  else tier = "thin";

  return {
    score,
    tier,
    label: strengthLabel(count, coCleanliness, recency, recencyMonths),
    signals: {
      provenance: "actual",
      sampleSize: count,
      sampleAdequacy,
      coCleanliness,
      recencyMonths,
      recency,
      spreadCv,
      spreadTightness,
    },
  };
}

function strengthLabel(
  count: number,
  coCleanliness: number,
  recency: number,
  recencyMonths: number | null,
): string {
  const jobs = `${count} job${count === 1 ? "" : "s"}`;
  const parts = [jobs];
  if (count < LOW_CONFIDENCE_BELOW) parts.push("low confidence");
  parts.push(coCleanliness >= 0.85 ? "clean COs" : coCleanliness >= 0.5 ? "some CO churn" : "heavy CO churn");
  if (recencyMonths !== null) parts.push(recency >= 0.999 ? "recent" : recency <= 0.001 ? "stale" : "aging");
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Aggregation (per Procore code, split by market sector — mirrors historyTrust)
// ---------------------------------------------------------------------------

/** Report for one (code, market sector) group of closed-job actuals. */
export interface ActualCostStat {
  /** Procore cost code (the join key on `/rates`). */
  costCode: string;
  description: string;
  /** Market sector ("" = legacy unset — its own honest group). */
  marketSector: string;
  /** Number of FINAL-snapshot jobs in this group. */
  count: number;
  /** Median EFFECTIVE normalized actual (dollars) across jobs — the headline. */
  medianNormalized: number;
  minNormalized: number;
  maxNormalized: number;
  meanNormalized: number;
  /** Median raw EAC total across jobs (the raw-vs-normalized contrast). */
  medianTotal: number;
  isBurden: boolean;
  /** ISO date of the most recent FINAL snapshot in the group ("" when unknown). */
  latestFinalizedAt: string;
  strength: ActualStrength;
  /** The group's observations, newest-finalized first. */
  observations: ActualCostObservation[];
}

/** Newest finalize first; ISO dates localeCompare correctly ("" sorts last). */
function newestFinalizedFirst(
  list: readonly ActualCostObservation[],
): ActualCostObservation[] {
  return [...list].sort((a, b) => b.finalizedAt.localeCompare(a.finalizedAt));
}

/**
 * Pool actual-cost observations into per-(code, sector) stats, keyed by Procore
 * code. Within a code, groups order by job count (desc) so the best-backed sector
 * reads first, then by sector. The actuals-side twin of
 * `historyTrust.aggregateTrustedHistory` — but dollars, `actual` provenance, and
 * its own strength signal. No outlier screen: actuals are real ledger numbers,
 * not bid quotes, so a high-variance job is signal (the spread strength shows it),
 * not noise to fence off.
 */
export function aggregateActualCostHistory(
  observations: readonly ActualCostObservation[],
  options?: { now?: Date },
): Map<string, ActualCostStat[]> {
  // code → sector → observations
  const pools = new Map<string, Map<string, ActualCostObservation[]>>();
  for (const o of observations) {
    if (!o.costCode) continue;
    const bySector = pools.get(o.costCode) ?? new Map<string, ActualCostObservation[]>();
    const arr = bySector.get(o.marketSector) ?? [];
    arr.push(o);
    bySector.set(o.marketSector, arr);
    pools.set(o.costCode, bySector);
  }

  const out = new Map<string, ActualCostStat[]>();
  for (const [costCode, bySector] of pools) {
    const stats: ActualCostStat[] = [];
    for (const [marketSector, group] of bySector) {
      const normals = group.map((o) => o.normalizedActual);
      const totals = group.map((o) => o.totalActual);
      const latestFinalizedAt = group.reduce(
        (latest, o) => (o.finalizedAt > latest ? o.finalizedAt : latest),
        "",
      );
      stats.push({
        costCode,
        description: group.find((o) => o.description !== "")?.description ?? "",
        marketSector,
        count: group.length,
        medianNormalized: median(normals),
        minNormalized: Math.min(...normals),
        maxNormalized: Math.max(...normals),
        meanNormalized: round2(normals.reduce((s, v) => s + v, 0) / group.length),
        medianTotal: median(totals),
        isBurden: group.some((o) => o.isBurden),
        latestFinalizedAt,
        strength: scoreActualStrength(group, options),
        observations: newestFinalizedFirst(group),
      });
    }
    stats.sort(
      (a, b) => b.count - a.count || a.marketSector.localeCompare(b.marketSector),
    );
    out.set(costCode, stats);
  }
  return out;
}
