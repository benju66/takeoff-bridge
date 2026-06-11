/**
 * historyTrust.ts — THE trust-rules authority for historical price reporting
 * (database fidelity Phase 3): the analytics twin of calculations.ts. Every
 * report of historical prices flows through this module; no consumer rolls
 * its own filtering or grouping (plan-of-record locked decision, 2026-06-10).
 *
 * PURE and READ-side only — nothing here touches the database, so every rule
 * applies retroactively to everything already imported. The pipeline, in the
 * locked order (AACE benchmarking practice screens outliers on RAW prices
 * BEFORE any normalization):
 *
 *   1. validity screen  — combined-line / zero-qty / zero-rate / %-unit rows
 *                         are excluded (observationExclusion, the ONE copy of
 *                         the rules; step23Normalization delegates to it)
 *   2. unit aliasing    — spelling variants fold to a canonical unit
 *                         (architect-approved list, 2026-06-11); NEVER a unit
 *                         conversion — SF and SY stay separate groups
 *   3. outlier screen   — per (code, canonical unit), pooled across sectors,
 *                         on raw prices; FLAG-ONLY: a flagged observation is
 *                         excluded from the math but reported alongside it,
 *                         never deleted (record-everything philosophy)
 *   4. escalation seam  — an optional date-based index adjustment applied to
 *                         the surviving prices; ships INERT (identity) until
 *                         Phase 6 chooses an index
 *   5. aggregation      — group by (code, canonical unit, market sector);
 *                         newest bid first; a minimum-sample-size confidence
 *                         label on every aggregate
 *
 * "Code" is the POST-MERGE resolved code: both producers already resolve —
 * step23Observations through resolveStep23Line (which follows Catalog-Manager
 * merge redirects) and the STEP 4 read through the saved item_id. Raw as-bid
 * codes must never reach this module, or a merge would silently split one
 * item's history in two.
 *
 * Guardrails (AGENTS.md "No AI Autonomy Over Financials"): REPORT-only.
 * Nothing here writes; adopting a figure into the rate card stays an explicit
 * human action through the audited /rates path.
 */

import { median, type PriceObservation } from "./priceHistory";
import { UOM_ALIASES as PARSE_TIME_UOM_ALIASES } from "./uom-aliases";

// ---------------------------------------------------------------------------
// 1. Validity screen
// ---------------------------------------------------------------------------

/** Why an observation does not count (null = it counts). */
export type ExclusionReason =
  /** Line marked "combined" at the import gate (data_fidelity='macro_lump_sum')
   *  — one price lumping several scopes is not a unit-price observation. */
  | "combined_line"
  /** Quantity 0 (or corrupt/non-finite): the line merely echoes that era's
   *  template default — it was never a real bid decision (fork F-B). */
  | "zero_qty"
  /** Rate 0 (or corrupt/non-finite): no price was actually bid. */
  | "zero_rate"
  /** %-UOM pseudo-rates carry the project base in the rate column (e.g.
   *  Safety Consultant 0.0002 × $16,000,000), not a unit rate. */
  | "percent_uom";

/**
 * The ONE copy of the validity rules. `qty === undefined` means the producer
 * has no quantity context (it cannot be judged) and passes; a produced qty of
 * null/NaN/0 is excluded — a corrupt payload must not mint a junk observation.
 */
export function observationExclusion(o: {
  unitPrice: number;
  uom: string;
  qty?: number;
  dataFidelity?: string;
}): ExclusionReason | null {
  if (o.dataFidelity === "macro_lump_sum") return "combined_line";
  if (o.qty !== undefined && (!Number.isFinite(o.qty) || o.qty === 0)) return "zero_qty";
  if (!Number.isFinite(o.unitPrice) || o.unitPrice === 0) return "zero_rate";
  if (o.uom.trim() === "%") return "percent_uom";
  return null;
}

// ---------------------------------------------------------------------------
// 2. Unit aliasing (architect-approved 2026-06-11)
// ---------------------------------------------------------------------------

/**
 * Spelling variants → the canonical unit the app's catalog already uses.
 * STRICTLY same-unit spellings, never conversions: SF ≠ SY ≠ MSF, LS ≠ EA.
 * Unknown units pass through unchanged (e.g. STOP, FLR) — an unrecognized
 * unit forms its own honest group rather than being guessed into another.
 *
 * EXTENDS the parse-time table (uom-aliases.ts, applied to Togal CSV takeoffs
 * at import): a spelling the parser already folds must group identically at
 * read time, or the same unit would split by which door it entered through.
 * The architect-approved additions (2026-06-11) cover the hand-typed variants
 * old BIDS carry that machine exports never produce (SQFT, L.F., LPSM, …).
 */
export const TRUST_UOM_ALIASES: Readonly<Record<string, string>> = {
  ...PARSE_TIME_UOM_ALIASES,
  SQFT: "SF", "SQ.FT.": "SF", "S.F.": "SF", "SF.": "SF",
  SQYD: "SY", "S.Y.": "SY",
  "LIN FT": "LF", LINFT: "LF", LNFT: "LF", "L.F.": "LF",
  CUYD: "CY", "C.Y.": "CY",
  LUMP: "LS", LPSM: "LS", "L.S.": "LS",
  MOS: "MO", MNTH: "MO",
  HRS: "HR",
  DAYS: "DAY", DY: "DAY",
  TN: "TON",
  ALLOWANCE: "ALLOW",
};

/** Uppercased, whitespace-collapsed, alias-folded unit ("" stays ""). */
export function canonicalUom(uom: string): string {
  const u = uom.trim().toUpperCase().replace(/\s+/g, " ");
  return TRUST_UOM_ALIASES[u] ?? u;
}

// ---------------------------------------------------------------------------
// 3. Outlier screen (flag-only; tunable constants ship conservative)
// ---------------------------------------------------------------------------

/** Below this many observations in a (code, unit) pool, no screening — the
 *  quartiles of a tiny sample are noise, and a false flag costs trust. */
export const OUTLIER_MIN_GROUP_SIZE = 5;
/** IQR fence multiplier. 1.5 is the textbook "mild" fence; 3 flags only
 *  extreme values (plan lock: flag-only AND conservative). */
export const OUTLIER_IQR_FENCE = 3;
/** A fenced value must ALSO sit at least this fraction away from the median —
 *  guards the degenerate IQR=0 pool (five identical prices) from flagging a
 *  trivially different sixth. */
export const OUTLIER_MIN_MEDIAN_DEVIATION = 0.5;

/** Linear-interpolation quantile over an ASCENDING-sorted array. */
function quantileSorted(sorted: readonly number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Flags statistical outliers in ONE (code, canonical unit) pool — pooled
 * across sectors, on RAW prices (the locked AACE ordering: screen before any
 * normalization). Returns the flagged observations; never mutates or drops.
 */
function flagOutliers(pool: readonly PriceObservation[]): Set<PriceObservation> {
  const flagged = new Set<PriceObservation>();
  if (pool.length < OUTLIER_MIN_GROUP_SIZE) return flagged;
  const prices = pool.map((o) => o.unitPrice).sort((a, b) => a - b);
  const q1 = quantileSorted(prices, 0.25);
  const q3 = quantileSorted(prices, 0.75);
  const iqr = q3 - q1;
  // Already sorted — the 0.5 quantile IS the standard median (no re-sort).
  const mid = quantileSorted(prices, 0.5);
  const lo = q1 - OUTLIER_IQR_FENCE * iqr;
  const hi = q3 + OUTLIER_IQR_FENCE * iqr;
  for (const o of pool) {
    const fenced = o.unitPrice < lo || o.unitPrice > hi;
    const skewed = Math.abs(o.unitPrice - mid) > OUTLIER_MIN_MEDIAN_DEVIATION * Math.abs(mid);
    if (fenced && skewed) flagged.add(o);
  }
  return flagged;
}

// ---------------------------------------------------------------------------
// 4. Escalation seam (INERT until Phase 6 chooses an index)
// ---------------------------------------------------------------------------

/**
 * Adjusts one raw unit price given its bid date ("YYYY-MM-DD", "" when unset).
 * Phase 6 supplies a real index-based adjuster; until then the identity ships
 * and every aggregate equals the raw math exactly.
 */
export type EscalationAdjuster = (unitPrice: number, bidDate: string) => number;

export const IDENTITY_ESCALATION: EscalationAdjuster = (unitPrice) => unitPrice;

// ---------------------------------------------------------------------------
// 5. Aggregation
// ---------------------------------------------------------------------------

/** Below this many trusted observations an aggregate is labeled low-confidence. */
export const LOW_CONFIDENCE_BELOW = 3;

/** Report for one (code, canonical unit, market sector) group. */
export interface TrustedHistoryStat {
  /** Post-merge resolved code. */
  itemId: string;
  /** Canonical unit (after aliasing). */
  uom: string;
  /** Market sector ("" = legacy unset — its own honest group). */
  marketSector: string;
  /** Trusted observations only (outliers and invalid rows not counted). */
  count: number;
  median: number;
  min: number;
  max: number;
  confidence: "low" | "normal";
  /** e.g. "2 observations — low confidence" / "7 observations". */
  confidenceLabel: string;
  /** The trusted observations, newest bid first (ties keep input order). */
  observations: PriceObservation[];
  /** Flag-only outliers: shown, never deleted, excluded from the stats. */
  flaggedOutliers: PriceObservation[];
}

function confidenceLabelFor(count: number): string {
  const noun = count === 1 ? "observation" : "observations";
  return count < LOW_CONFIDENCE_BELOW
    ? `${count} ${noun} — low confidence`
    : `${count} ${noun}`;
}

/** Newest bid first; localeCompare on ISO dates sorts correctly. */
function newestFirst(list: readonly PriceObservation[]): PriceObservation[] {
  return [...list].sort((a, b) => b.bidDate.localeCompare(a.bidDate));
}

/**
 * The single consumer-facing aggregation: runs the full pipeline above and
 * returns per-(code, unit, sector) stats keyed by code. Within a code, groups
 * order by count (desc) so the dominant unit reads first, then unit, then
 * sector. Observations with no code are skipped (unmapped rows have nothing
 * to file under — they stay visible in their own worklists instead).
 */
export function aggregateTrustedHistory(
  observations: readonly PriceObservation[],
  options?: { escalate?: EscalationAdjuster }
): Map<string, TrustedHistoryStat[]> {
  const escalate = options?.escalate ?? IDENTITY_ESCALATION;

  // 1+2: validity screen, then pool the survivors per (code, canonical unit).
  const pools = new Map<string, Map<string, PriceObservation[]>>(); // code → unit → pool
  for (const o of observations) {
    if (!o.itemId) continue;
    if (observationExclusion(o) !== null) continue;
    const unit = canonicalUom(o.uom);
    const byUnit = pools.get(o.itemId) ?? new Map<string, PriceObservation[]>();
    const pool = byUnit.get(unit) ?? [];
    pool.push(o);
    byUnit.set(unit, pool);
    pools.set(o.itemId, byUnit);
  }

  const out = new Map<string, TrustedHistoryStat[]>();
  for (const [itemId, byUnit] of pools) {
    const stats: TrustedHistoryStat[] = [];
    for (const [uom, pool] of byUnit) {
      // 3: outlier screen on the RAW (code, unit) pool, across sectors.
      const outliers = flagOutliers(pool);

      // 5: split the pool by sector; flagged outliers ride their sector group.
      const bySector = new Map<string, { trusted: PriceObservation[]; flagged: PriceObservation[] }>();
      for (const o of pool) {
        const g = bySector.get(o.marketSector) ?? { trusted: [], flagged: [] };
        (outliers.has(o) ? g.flagged : g.trusted).push(o);
        bySector.set(o.marketSector, g);
      }

      for (const [marketSector, g] of bySector) {
        if (g.trusted.length === 0 && g.flagged.length === 0) continue;
        // 4: escalation applies AFTER the screen, to the trusted prices only.
        const adjusted = g.trusted.map((o) => escalate(o.unitPrice, o.bidDate));
        const count = g.trusted.length;
        stats.push({
          itemId,
          uom,
          marketSector,
          count,
          median: median(adjusted),
          min: adjusted.length ? Math.min(...adjusted) : 0,
          max: adjusted.length ? Math.max(...adjusted) : 0,
          confidence: count < LOW_CONFIDENCE_BELOW ? "low" : "normal",
          confidenceLabel: confidenceLabelFor(count),
          observations: newestFirst(g.trusted),
          flaggedOutliers: newestFirst(g.flagged),
        });
      }
    }
    stats.sort(
      (a, b) =>
        b.count - a.count ||
        a.uom.localeCompare(b.uom) ||
        a.marketSector.localeCompare(b.marketSector)
    );
    out.set(itemId, stats);
  }
  return out;
}
