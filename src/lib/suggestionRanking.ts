/**
 * suggestionRanking.ts — pure signal-aware ranking for the import gate's
 * `history` suggestion tier (database fidelity Phase 5).
 *
 * The BASE is unchanged from Phase 3: exact-description confirmation counts,
 * sorted count desc then code asc. Signals layer ON TOP of that base, never
 * replace it (named risk in docs/plans/database-fidelity.md):
 *
 *  - LIFECYCLE FIRST (Catalog Manager reconciliation): before any scoring, a
 *    code that matches a MERGED def refiles its observations under the
 *    winning code, and a code whose def is retired is dropped entirely (a
 *    retired code is never suggested — matching the import gate's
 *    activeStep23Defs picker). Codes matching no def (the STEP 4 catalog,
 *    linked rows, built-in STEP 2/3 defs) pass through untouched: no def ===
 *    active. See `refileCode` for how that convention also covers a merge
 *    whose winner is a built-in.
 *  - DEDUPE: the count is DISTINCT PROJECTS, not raw rows — one saved bid
 *    can never inflate a pairing however many identical lines it carries.
 *    (A bid imported twice as two projects is two projects here; catching
 *    cross-project duplicates is the Data Health detector's job.) Rows with
 *    no project identity collapse to ONE observation per pairing: deleting a
 *    project SET-NULLs its history rows (Phase 4 finding), and that residue
 *    must never outweigh a live bid in either direction.
 *  - REJECTION DOWNWEIGHT: each distinct project that actively rejected a
 *    pairing cancels one confirmation (REJECTION_DOWNWEIGHT — conservative,
 *    matching dataHealth.ts's named-threshold convention). A pairing with no
 *    trusted confirmation never surfaces at all, however it was rejected. A
 *    project that both confirmed AND rejected a pairing (two lines, same
 *    description, mixed verdicts) deliberately nets to zero for it.
 *  - RECENCY: a tiebreaker only, never a score — equal effective scores rank
 *    the more recently confirmed pairing first. Real time-decay weighting is
 *    the future ML tier's job; this stays deterministic and explainable.
 *
 * Pure: no DB, no I/O. db.ts (getClassificationHistoryBulk) fetches the rows
 * and delegates here; tests exercise this module directly.
 */

import { statusOf, isActive, type LifecycleDef } from "./catalogLifecycle";
import { TRUSTED_RESOLVED_BY, RESOLVED_BY } from "./resolvedBy";

/** One classification_history row, as the ranking sees it. */
export interface ClassificationObservation {
  classification: string;
  resolvedCode: string;
  /** Raw free-text tag from the DB — matched against resolvedBy.ts here. */
  resolvedBy: string;
  /** Source project ('' / null = no identity — see the dedupe rule above). */
  projectId: string | null;
  /** ISO timestamp ('' tolerated → epoch); recency tiebreaks only. */
  createdAt: string;
}

/**
 * One distinct-project rejection cancels one distinct-project confirmation.
 * Conservative on purpose: a single rejection must not overturn a pairing the
 * team has confirmed for years, but repeated rejections steadily sink it.
 */
export const REJECTION_DOWNWEIGHT = 1;

const TRUSTED = new Set<string>(TRUSTED_RESOLVED_BY);

/**
 * Distinct-project counter, shared by the trusted and rejected sides so the
 * dedupe rule can never diverge between them: distinct project ids count one
 * each; ALL no-identity rows together count one.
 */
interface DistinctCount {
  projects: Set<string>;
  sawNoProject: boolean;
}

const distinctCount = (): DistinctCount => ({ projects: new Set(), sawNoProject: false });

function countProject(d: DistinctCount, projectId: string | null): void {
  const p = (projectId ?? "").trim();
  if (p) d.projects.add(p);
  else d.sawNoProject = true;
}

const distinctTotal = (d: DistinctCount): number => d.projects.size + (d.sawNoProject ? 1 : 0);

/** Per-(classification, code) tally while scoring. */
interface Tally {
  trusted: DistinctCount;
  rejected: DistinctCount;
  /** Most recent trusted confirmation (ms since epoch; 0 = unparseable). */
  latestTrustedAt: number;
}

const parseTime = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

/**
 * Resolves an observed code through the lifecycle defs to the code ranking
 * scores it under:
 *  - no def, or an ACTIVE def → the code itself ("no def === active" — the
 *    STEP 4 catalog, linked rows, and built-in STEP 2/3 defs carry no
 *    lifecycle rows);
 *  - MERGED → the winner's code, following redirects with the same hop guard
 *    as resolveMergeTarget. A winner ABSENT from the defs map is active by
 *    the same no-def convention: the lifecycle rules guarantee a merge
 *    target was an active def, and it may be a BUILT-IN the caller's custom
 *    overlay never contains — the case resolveStep23Line resolves via its
 *    built-in lookups. (resolveMergeTarget instead KEEPS a merged def whose
 *    winner it cannot find — right for labeling old lines, wrong for
 *    suggesting, so this module redirects rather than delegates.)
 *  - RETIRED after redirects, a merge naming no winner, or a redirect cycle
 *    → null (never suggested — fail closed, matching activeStep23Defs
 *    dropping every non-active def from pickers).
 */
function refileCode(
  code: string,
  byCode: ReadonlyMap<string, LifecycleDef>,
  maxHops = 16
): string | null {
  let current = code;
  for (let hops = 0; hops <= maxHops; hops++) {
    const def = byCode.get(current);
    if (!def || isActive(def)) return current;
    if (statusOf(def) === "retired") return null; // never suggest a retired code
    const winner = (def.mergedInto ?? "").trim();
    if (!winner) return null; // merged with no target = corrupt — fail closed
    current = winner;
  }
  return null; // hop guard — a redirect cycle never loops, never suggests
}

/**
 * Ranks raw classification_history rows into the import gate's suggestion
 * shape: `classification → [{resolvedCode, count}]`, best first. `count` is
 * the deduped trusted-confirmation count (the review UI's "× N" badge);
 * ORDER additionally reflects rejection downweights and recency. Codes with
 * zero trusted confirmations never appear, classifications with no surviving
 * codes are absent (not empty) — exactly the Phase 3 contract.
 */
export function rankClassificationHistory(
  observations: readonly ClassificationObservation[],
  lifecycleDefs?: readonly LifecycleDef[]
): Map<string, { resolvedCode: string; count: number }[]> {
  const byCode = new Map<string, LifecycleDef>((lifecycleDefs ?? []).map((d) => [d.code, d]));

  const tallies = new Map<string, Map<string, Tally>>();
  for (const obs of observations) {
    const code = refileCode(obs.resolvedCode, byCode);
    if (code === null) continue;

    const isTrusted = TRUSTED.has(obs.resolvedBy);
    const isRejection = obs.resolvedBy === RESOLVED_BY.SUGGESTION_REJECTED;
    if (!isTrusted && !isRejection) continue; // allowlist — unknown tags never rank

    const codes = tallies.get(obs.classification) ?? new Map<string, Tally>();
    tallies.set(obs.classification, codes);
    const tally = codes.get(code) ?? {
      trusted: distinctCount(),
      rejected: distinctCount(),
      latestTrustedAt: 0,
    };
    codes.set(code, tally);

    if (isTrusted) {
      countProject(tally.trusted, obs.projectId);
      tally.latestTrustedAt = Math.max(tally.latestTrustedAt, parseTime(obs.createdAt));
    } else {
      countProject(tally.rejected, obs.projectId);
    }
  }

  const out = new Map<string, { resolvedCode: string; count: number }[]>();
  for (const [classification, codes] of tallies) {
    const scored = [...codes.entries()]
      .map(([resolvedCode, t]) => {
        const count = distinctTotal(t.trusted);
        return {
          resolvedCode,
          count,
          score: count - REJECTION_DOWNWEIGHT * distinctTotal(t.rejected),
          latestTrustedAt: t.latestTrustedAt,
        };
      })
      // Never suggest a pairing nobody has confirmed — rejections alone must
      // not introduce a code (it would be absent under the Phase 3 base too).
      .filter((s) => s.count > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.latestTrustedAt - a.latestTrustedAt ||
          a.resolvedCode.localeCompare(b.resolvedCode)
      )
      .map(({ resolvedCode, count }) => ({ resolvedCode, count }));
    if (scored.length > 0) out.set(classification, scored);
  }
  return out;
}
