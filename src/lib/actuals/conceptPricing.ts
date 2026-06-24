/**
 * Actuals Cost-History — Phase 7 parametric concept pricing (pure; no DB, no React).
 *
 * The SECOND reader of the actuals pricing pool (after `/rates`). It turns the
 * Phase-6 dollars-per-code observations into **$/SF and $/unit benchmarks** for
 * napkin-stage budgeting: when an estimator is sizing a brand-new job and only
 * knows roughly its square footage / unit count, the concept-pricing view shows
 * what each Procore division and code ACTUALLY cost per square foot / per unit on
 * past closed jobs, so a rough budget = benchmark × the concept quantity.
 *
 * Built entirely on the pool (see {@link buildActualCostObservations}): a
 * parametric observation is one pool observation's EFFECTIVE normalized dollars
 * divided by the snapshot's project metric. Hard contracts:
 *
 *   1. **Guard the denominator.** A project with no square footage / unit count
 *      contributes NO parametric datum for that metric (divide-by-zero / missing
 *      is skipped), but still contributes to the absolute dollars pool. Negatives
 *      (savings / buyout) ride through — a negative $/SF is real signal.
 *   2. **Division grouping comes from the Procore code, NOT `getDivisionCode`.**
 *      `getDivisionCode` extracts a CSI division from an estimate `itemId`; the
 *      pool's keys are Procore budget codes (`"1-10320.000"`), whose leading
 *      tier-1 token IS the Procore division. {@link parseProcoreDivision} reads
 *      that token directly (never the CSI utility).
 *   3. **Same confidence language as `/rates`.** Each benchmark carries an
 *      {@link ActualStrength} from {@link scoreActualStrength} — scored on the
 *      $/metric values, so the spread dimension reflects $/SF (or $/unit)
 *      tightness while the tier/label vocabulary stays identical.
 *
 * REPORT-only (AGENTS.md "No AI Autonomy Over Financials"): nothing here writes,
 * and a benchmark is never auto-applied — the view multiplies it by a human-typed
 * concept quantity for an advisory rough order of magnitude.
 */

import { median } from "../priceHistory";
import { scoreActualStrength } from "./pricingPool";
import type { ActualCostObservation, ActualStrength } from "./pricingPool";

/** Round to cents — keeps floating-point dust out of reported benchmarks. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** The two parametric denominators a project carries. */
export type ConceptMetric = "sf" | "unit";

/** Which project field a metric reads, and how it labels itself. */
export const CONCEPT_METRICS: Record<
  ConceptMetric,
  { field: "squareFootage" | "unitCount"; unitLabel: string; perLabel: string }
> = {
  sf: { field: "squareFootage", unitLabel: "SF", perLabel: "$/SF" },
  unit: { field: "unitCount", unitLabel: "unit", perLabel: "$/unit" },
};

// ---------------------------------------------------------------------------
// Procore division (from the code structure — NOT getDivisionCode)
// ---------------------------------------------------------------------------

/** A division rollup carries no single Procore code — this marks the group. */
export const DIVISION_GRAIN_CODE = "";

/**
 * Derive a Procore **division** from a Procore cost code's structure.
 *
 * Procore budget codes are `"<tier1>-<rest>"` (`"1-10320.000"`,
 * `"09-9000.002"`, `"60-604000.000"`); the leading tier-1 token is the division.
 * This is deliberately NOT `getDivisionCode()` — that reads a 2-digit CSI
 * division out of an estimate `itemId`, a different code space (the same job's
 * Procore tier-1 `1` maps to CSI `01`). Grouping by the raw tier-1 token keeps
 * the rollup honest to the Procore ledger the actuals came from.
 *
 * @example parseProcoreDivision("1-10320.000")  // { key: "1",  label: "Division 1" }
 * @example parseProcoreDivision("09-9000.002")  // { key: "09", label: "Division 09" }
 * @example parseProcoreDivision("")             // { key: "",   label: "Unassigned" }
 */
export function parseProcoreDivision(costCode: string): { key: string; label: string } {
  const s = (costCode ?? "").trim();
  const dash = s.indexOf("-");
  const key = (dash === -1 ? s : s.slice(0, dash)).trim();
  if (!key) return { key: "", label: "Unassigned" };
  return { key, label: `Division ${key}` };
}

// ---------------------------------------------------------------------------
// Parametric observation (one job × one grain × one metric)
// ---------------------------------------------------------------------------

/**
 * One closed-job parametric datum: a pool observation's normalized dollars over
 * the snapshot's project metric. `grain` distinguishes a single-code datum from a
 * whole-division rollup (the latter sums every code in the division for the job).
 */
export interface ParametricObservation {
  grain: "code" | "division";
  /** Procore cost code (set for `grain="code"`; {@link DIVISION_GRAIN_CODE} for a rollup). */
  costCode: string;
  description: string;
  /** Procore division key (from {@link parseProcoreDivision}). */
  division: string;
  divisionLabel: string;
  marketSector: string;
  metric: ConceptMetric;
  /** The project metric this datum is divided by (always > 0 by construction). */
  metricValue: number;
  /** EFFECTIVE normalized dollars for this grain on this job (the numerator). */
  normalizedActual: number;
  /** Raw EAC total for this grain on this job (the raw-vs-normalized contrast). */
  totalActual: number;
  /** Normalized dollars per metric unit — the parametric benchmark datum. */
  costPerMetric: number;
  /** CO-churn share for this grain (|total − normalized| ÷ |total|, 0..1). */
  coAdjustmentShare: number;
  projectId: string;
  projectName: string;
  snapshotId: string;
  snapshotLabel: string;
  finalizedAt: string;
}

/** A finite, strictly-positive metric value is the only valid denominator. */
function usableMetric(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Code-grain parametric observations for one metric: each pool observation
 * divided by its project's SF (or unit count). Observations whose project lacks
 * the metric (0 / non-finite) are SKIPPED — no fabricated denominator — but they
 * remain in the absolute dollars pool elsewhere.
 */
export function buildCodeParametrics(
  observations: readonly ActualCostObservation[],
  metric: ConceptMetric,
): ParametricObservation[] {
  const field = CONCEPT_METRICS[metric].field;
  const out: ParametricObservation[] = [];
  for (const o of observations) {
    const metricValue = o[field];
    if (!usableMetric(metricValue)) continue;
    const div = parseProcoreDivision(o.costCode);
    out.push({
      grain: "code",
      costCode: o.costCode,
      description: o.description,
      division: div.key,
      divisionLabel: div.label,
      marketSector: o.marketSector,
      metric,
      metricValue,
      normalizedActual: o.normalizedActual,
      totalActual: o.totalActual,
      costPerMetric: round2(o.normalizedActual / metricValue),
      coAdjustmentShare: o.coAdjustmentShare,
      projectId: o.projectId,
      projectName: o.projectName,
      snapshotId: o.snapshotId,
      snapshotLabel: o.snapshotLabel,
      finalizedAt: o.finalizedAt,
    });
  }
  return out;
}

/**
 * Division-grain parametric observations for one metric: per (job, division),
 * sum every code's normalized (and total) dollars, then divide the job's
 * division subtotal by the project metric. Because a job's metric is constant
 * across its codes, this equals Σ(code $/metric) — but summing the raw dollars
 * first lets the rollup recompute its own honest CO-churn share from totals.
 */
export function buildDivisionParametrics(
  observations: readonly ActualCostObservation[],
  metric: ConceptMetric,
): ParametricObservation[] {
  const field = CONCEPT_METRICS[metric].field;

  interface DivAgg {
    division: string;
    divisionLabel: string;
    marketSector: string;
    metricValue: number;
    normalized: number;
    total: number;
    projectId: string;
    projectName: string;
    snapshotId: string;
    snapshotLabel: string;
    finalizedAt: string;
  }
  // Key by snapshot + division: one rollup datum per job per division.
  const byJobDivision = new Map<string, DivAgg>();

  for (const o of observations) {
    const metricValue = o[field];
    if (!usableMetric(metricValue)) continue;
    const div = parseProcoreDivision(o.costCode);
    const key = `${o.snapshotId}__${div.key}`;
    let agg = byJobDivision.get(key);
    if (!agg) {
      agg = {
        division: div.key,
        divisionLabel: div.label,
        marketSector: o.marketSector,
        metricValue,
        normalized: 0,
        total: 0,
        projectId: o.projectId,
        projectName: o.projectName,
        snapshotId: o.snapshotId,
        snapshotLabel: o.snapshotLabel,
        finalizedAt: o.finalizedAt,
      };
      byJobDivision.set(key, agg);
    }
    agg.normalized += o.normalizedActual;
    agg.total += o.totalActual;
  }

  const out: ParametricObservation[] = [];
  for (const agg of byJobDivision.values()) {
    const normalized = round2(agg.normalized);
    if (normalized === 0) continue; // no original-scope cost in this division
    const total = round2(agg.total);
    const coAdjustmentShare =
      Math.abs(total) > 1e-9 ? clamp01(Math.abs(total - normalized) / Math.abs(total)) : 0;
    out.push({
      grain: "division",
      costCode: DIVISION_GRAIN_CODE,
      description: agg.divisionLabel,
      division: agg.division,
      divisionLabel: agg.divisionLabel,
      marketSector: agg.marketSector,
      metric,
      metricValue: agg.metricValue,
      normalizedActual: normalized,
      totalActual: total,
      costPerMetric: round2(normalized / agg.metricValue),
      coAdjustmentShare,
      projectId: agg.projectId,
      projectName: agg.projectName,
      snapshotId: agg.snapshotId,
      snapshotLabel: agg.snapshotLabel,
      finalizedAt: agg.finalizedAt,
    });
  }
  return out;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// ---------------------------------------------------------------------------
// Benchmark stat (a grain group pooled across jobs)
// ---------------------------------------------------------------------------

/** A pooled $/metric benchmark for one (grain, sector, metric) group. */
export interface ConceptPricingStat {
  grain: "code" | "division";
  /** Procore division key. */
  division: string;
  divisionLabel: string;
  /** Procore code (set for `grain="code"`; {@link DIVISION_GRAIN_CODE} for a rollup). */
  costCode: string;
  description: string;
  marketSector: string;
  metric: ConceptMetric;
  /** Number of FINAL-snapshot jobs backing the benchmark. */
  count: number;
  /** Median normalized $/metric across jobs — the headline benchmark. */
  medianCostPerMetric: number;
  minCostPerMetric: number;
  maxCostPerMetric: number;
  meanCostPerMetric: number;
  /** Median absolute normalized dollars across jobs (the dollars-vs-$/metric contrast). */
  medianNormalized: number;
  /** ISO date of the most recent FINAL snapshot in the group ("" when unknown). */
  latestFinalizedAt: string;
  /** Confidence — scored on the $/metric values (spread = $/metric tightness). */
  strength: ActualStrength;
  /** The group's parametric observations, newest-finalized first. */
  observations: ParametricObservation[];
}

/** Newest finalize first; ISO dates localeCompare correctly ("" sorts last). */
function newestFinalizedFirst(
  list: readonly ParametricObservation[],
): ParametricObservation[] {
  return [...list].sort((a, b) => b.finalizedAt.localeCompare(a.finalizedAt));
}

/**
 * Pool parametric observations into per-(group, sector) benchmark stats. Groups
 * order by job count (desc) so the best-backed reads first. Strength is scored on
 * the $/metric values (each observation's `costPerMetric` mapped onto the
 * scorer's `normalizedActual` slot) so the spread dimension measures $/metric
 * tightness — see the module note and {@link StrengthScorable}.
 */
function poolBenchmarks(
  parametrics: readonly ParametricObservation[],
  keyOf: (o: ParametricObservation) => string,
  options?: { now?: Date },
): ConceptPricingStat[] {
  const groups = new Map<string, ParametricObservation[]>();
  for (const o of parametrics) {
    const key = keyOf(o);
    const arr = groups.get(key) ?? [];
    arr.push(o);
    groups.set(key, arr);
  }

  const stats: ConceptPricingStat[] = [];
  for (const group of groups.values()) {
    const perMetric = group.map((o) => o.costPerMetric);
    const normals = group.map((o) => o.normalizedActual);
    const latestFinalizedAt = group.reduce(
      (latest, o) => (o.finalizedAt > latest ? o.finalizedAt : latest),
      "",
    );
    const head = group[0];
    stats.push({
      grain: head.grain,
      division: head.division,
      divisionLabel: head.divisionLabel,
      costCode: head.costCode,
      description: group.find((o) => o.description !== "")?.description ?? head.description,
      marketSector: head.marketSector,
      metric: head.metric,
      count: group.length,
      medianCostPerMetric: median(perMetric),
      minCostPerMetric: Math.min(...perMetric),
      maxCostPerMetric: Math.max(...perMetric),
      meanCostPerMetric: round2(perMetric.reduce((s, v) => s + v, 0) / group.length),
      medianNormalized: median(normals),
      latestFinalizedAt,
      // Score on $/metric: spread then reflects $/SF (or $/unit) tightness.
      strength: scoreActualStrength(
        group.map((o) => ({
          normalizedActual: o.costPerMetric,
          coAdjustmentShare: o.coAdjustmentShare,
          finalizedAt: o.finalizedAt,
        })),
        options,
      ),
      observations: newestFinalizedFirst(group),
    });
  }
  stats.sort(
    (a, b) =>
      b.count - a.count ||
      a.division.localeCompare(b.division) ||
      a.costCode.localeCompare(b.costCode) ||
      a.marketSector.localeCompare(b.marketSector),
  );
  return stats;
}

// ---------------------------------------------------------------------------
// The full concept-pricing model (both metrics, both grains)
// ---------------------------------------------------------------------------

/**
 * The complete parametric read the concept-pricing view consumes. Division- and
 * code-level benchmarks for BOTH metrics are computed in one pass; the view
 * filters by the active metric + sector and nests codes under their division.
 */
export interface ConceptPricingModel {
  /** Division-level $/metric benchmarks (every metric × sector). */
  divisions: ConceptPricingStat[];
  /** Code-level $/metric benchmarks (every metric × sector). */
  codes: ConceptPricingStat[];
  /** Distinct market sectors present in any benchmark (for the view's filter). */
  sectors: string[];
  /** True when at least one project contributed square footage (enables $/SF). */
  hasSf: boolean;
  /** True when at least one project contributed a unit count (enables $/unit). */
  hasUnit: boolean;
}

/**
 * Build the parametric concept-pricing model from the actuals pool. Pure: the
 * observations already carry each project's `squareFootage` / `unitCount` (the
 * db.ts reader's `projects(...)` join), so this never touches the database.
 */
export function aggregateConceptPricing(
  observations: readonly ActualCostObservation[],
  options?: { now?: Date },
): ConceptPricingModel {
  const divisions: ConceptPricingStat[] = [];
  const codes: ConceptPricingStat[] = [];
  let hasSf = false;
  let hasUnit = false;

  for (const metric of ["sf", "unit"] as const) {
    const codeParametrics = buildCodeParametrics(observations, metric);
    const divisionParametrics = buildDivisionParametrics(observations, metric);
    if (codeParametrics.length > 0) {
      if (metric === "sf") hasSf = true;
      else hasUnit = true;
    }
    codes.push(
      ...poolBenchmarks(codeParametrics, (o) => `${o.costCode}__${o.marketSector}`, options),
    );
    divisions.push(
      ...poolBenchmarks(divisionParametrics, (o) => `${o.division}__${o.marketSector}`, options),
    );
  }

  const sectors = [...new Set([...divisions, ...codes].map((s) => s.marketSector))].sort();

  return { divisions, codes, sectors, hasSf, hasUnit };
}
