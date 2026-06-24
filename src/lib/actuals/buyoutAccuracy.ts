/**
 * Actuals Cost-History — Phase 9 planned-buyout-vs-miss accuracy lens
 * (pure; no DB, no React).
 *
 * The THIRD reader of the FINAL budget snapshots (after the pricing pool, P6/P7,
 * and the active-project variance engine, P8) — and the only one that couples
 * back to the ESTIMATE side. It answers a single accuracy question: when our crew
 * drew on a job's in-scope **FP Contingency/Buyout** during construction, did the
 * draws stay inside the contingency we budgeted at bid time?
 *
 *   - **The draw (actual):** the EFFECTIVE `fp_buyout` change-event dollars on a
 *     FINAL snapshot. `fp_buyout` is the one in-scope-buyout bucket the
 *     normalization engine KEEPS (never normalized out), so it is exactly the
 *     contingency/buyout variance the company actually spent. Negatives (savings /
 *     buyout returns — e.g. −$41K Project Insulation) ride through: a net-negative
 *     draw is a job that came in UNDER its contingency.
 *   - **The yardstick (budget):** the project's SUBMITTED estimate version's
 *     contingency = `constructionContingency + designContingency` (frozen on the
 *     version's `summary` at bid time, NOT the live working copy). A project with
 *     no submitted estimate has no yardstick → scored "unbudgeted" and reported
 *     honestly; nothing is fabricated (this estimate coupling is why P9 was deferred).
 *
 * Draws within budget = **planned**; the excess over budget = a **miss**.
 *
 * Hard contracts (mirroring the sibling readers):
 *   1. **EFFECTIVE `fp_buyout`, never frozen.** Each event's disposition is
 *      re-resolved through {@link resolveEffectiveDisposition} under the snapshot's
 *      Phase-5 classification overlay, so a human correction that moves an event
 *      into (or out of) `fp_buyout` is honored — exactly as the pricing pool honors
 *      it for normalized dollars.
 *   2. **The draw is DIRECT cost.** A change event's own Fee/GL burden lines are
 *      split out (tracked separately) because the contingency budget is a
 *      direct-cost percentage; comparing direct draws to a direct-cost budget keeps
 *      it apples-to-apples. Per-line dollars are read the way `normalize.ts` reads
 *      them (skip blank cost code, skip zero `latestCost`).
 *   3. **Division grouping is the Procore tier-1 token** ({@link parseProcoreDivision}),
 *      never `getDivisionCode()` (that reads a CSI division from an estimate itemId
 *      — a different code space; see the conceptPricing note).
 *
 * REPORT-only (AGENTS.md "No AI Autonomy Over Financials"): nothing here writes,
 * and every number is a deterministic function of the frozen snapshot events + the
 * frozen submitted summary.
 */

import { parseProcoreDivision } from "./conceptPricing";
import { round2 } from "./currency";
import { collectEventOverrides, resolveEffectiveDisposition } from "./eventReview";
import type { OverlayRowLike } from "./eventReview";
import { isBurdenCode } from "./normalize";
import type { ClassifiedChangeEvent } from "./types";

/** Within ±0.5% of the contingency budget a draw still reads "within budget". */
export const BUYOUT_TOLERANCE_PCT = 0.005;
/** Absolute floor (dollars) so a zero/near-zero budget still gets an honest band. */
export const BUYOUT_TOLERANCE_ABS = 1;

/** A job's (or the portfolio's) contingency-accuracy posture. */
export type BuyoutAccuracyStatus =
  | "within" // drew on contingency but stayed inside the budget — planned
  | "miss" // the draw cleared the budget — the excess is a genuine miss
  | "savings" // net-negative draw — returned contingency / came in under
  | "unbudgeted"; // no submitted-estimate budget to score against (reported, not scored)

/** Tunable "within budget" tolerance (defaults to {@link BUYOUT_TOLERANCE_PCT}/ABS). */
export interface BuyoutAccuracyOptions {
  /** Fraction of |budget| inside which a draw still reads "within". */
  tolerancePct?: number;
  /** Absolute dollar floor for the "within" band. */
  toleranceAbs?: number;
}

// ---------------------------------------------------------------------------
// Inputs (structurally decoupled from the DB types — db.ts passes rows straight
// in, mirroring pricingPool.FinalSnapshotInput / variance.ProjectSnapshotInput).
// ---------------------------------------------------------------------------

/**
 * One FINAL snapshot paired with its project's bid-time contingency budget, as
 * the accuracy lens consumes it. The draw is derived entirely from `events` +
 * `overlayRows` (the per-code actuals are not needed — `fp_buyout` is a
 * change-event signal), so unlike the pricing pool's input this carries no
 * frozen actuals.
 */
export interface BuyoutAccuracyInput {
  projectId: string;
  projectName: string;
  snapshotId: string;
  snapshotLabel: string;
  /** ISO finalize timestamp ("" when unset). */
  finalizedAt: string;
  /** Project market sector ("" = legacy unset). */
  marketSector: string;
  /**
   * Submitted-estimate contingency budget (`constructionContingency +
   * designContingency`), or `null` when the project has no submitted estimate
   * version — the honest "no yardstick" case.
   */
  contingencyBudget: number | null;
  /** The snapshot's frozen classified change events. */
  events: ClassifiedChangeEvent[];
  /** The snapshot's full overlay rows (Phase-4 + Phase-5) for the override recompute. */
  overlayRows: OverlayRowLike[];
}

// ---------------------------------------------------------------------------
// Draw breakdown (per FINAL snapshot)
// ---------------------------------------------------------------------------

/** One Procore cost code's direct `fp_buyout` draw on a snapshot. */
export interface BuyoutDrawCode {
  costCode: string;
  description: string;
  /** Σ non-burden `latestCost` drawn against this code (signed). */
  directDraw: number;
}

/** One Procore division's direct `fp_buyout` draw, with its codes nested. */
export interface BuyoutDrawDivision {
  /** Procore division key (from {@link parseProcoreDivision}). */
  division: string;
  divisionLabel: string;
  /** Σ direct draw across the division's codes (signed). */
  directDraw: number;
  /** The division's per-code draws, largest first. */
  codes: BuyoutDrawCode[];
}

/** One `fp_buyout` change event's draw (effective classification shown). */
export interface BuyoutDrawEvent {
  eventId: string;
  title: string;
  /** EFFECTIVE scope/type/reason (the override's when corrected, else the auto-read). */
  scope: string;
  type: string;
  reason: string;
  /** True when a Phase-5 human override produced this `fp_buyout` disposition. */
  isOverridden: boolean;
  /** Σ non-burden `latestCost` this event drew (signed). */
  directDraw: number;
  /** Σ Fee/GL burden `latestCost` riding on this event (tracked, not scored). */
  burdenDraw: number;
}

/** A snapshot's full `fp_buyout` draw, split direct vs burden and by division. */
export interface BuyoutDrawBreakdown {
  /** Σ direct (non-burden) draw across all `fp_buyout` events — the scored number. */
  directDrawn: number;
  /** Σ Fee/GL burden draw across all `fp_buyout` events (tracked, not scored). */
  burdenDrawn: number;
  /** directDrawn + burdenDrawn. */
  grossDrawn: number;
  /** Number of EFFECTIVE `fp_buyout` events (non-duplicate). */
  drawCount: number;
  /** How many of those carry a Phase-5 classification override. */
  overriddenCount: number;
  /** Direct draws grouped by Procore division, largest draw first. */
  byDivision: BuyoutDrawDivision[];
  /** Per-event draws, largest direct draw first. */
  events: BuyoutDrawEvent[];
}

const COST_TYPE_SUFFIX = /\.(Labor|Material|Subcontract|Equipment|Other)$/;

/** Strip a trailing `.<CostType>` so a code-level row reads cleanly. */
function codeLevelDescription(desc: string): string {
  return (desc ?? "").replace(COST_TYPE_SUFFIX, "");
}

/**
 * Extract a snapshot's EFFECTIVE in-scope FP Contingency/Buyout draw.
 *
 * Each event's disposition is re-resolved under the snapshot's Phase-5 overlay
 * (so corrections into/out of `fp_buyout` are honored), then the in-scope-buyout
 * events' detail lines are summed at the cost-code grain — direct cost separated
 * from the event's own Fee/GL burden lines, blank-code and zero lines skipped
 * exactly as `normalize.ts` does, duplicates excluded. Codes roll up to Procore
 * divisions via {@link parseProcoreDivision}. Negatives (savings) are retained.
 */
export function buildBuyoutDraws(input: {
  events: readonly ClassifiedChangeEvent[];
  overlayRows: OverlayRowLike[];
}): BuyoutDrawBreakdown {
  const overrides = collectEventOverrides(input.overlayRows);

  let burdenDrawn = 0;
  let drawCount = 0;
  let overriddenCount = 0;

  const byCode = new Map<string, BuyoutDrawCode>();
  const drawEvents: BuyoutDrawEvent[] = [];

  for (const ev of input.events) {
    if (ev.isDuplicate) continue; // a duplicate's dollars were already counted
    const override = overrides.get(ev.eventId) ?? null;
    const eff = resolveEffectiveDisposition(ev, override);
    if (eff.bucket !== "fp_buyout") continue; // only in-scope buyout draws

    drawCount += 1;
    if (eff.isOverridden) overriddenCount += 1;

    let evDirect = 0;
    let evBurden = 0;
    for (const line of ev.lines) {
      if (line.costCode === "") continue; // unattributed — no code to draw against
      if (line.latestCost === 0) continue;
      if (isBurdenCode(line.costCode)) {
        evBurden += line.latestCost; // the CO's own Fee/GL markup — tracked, not scored
        continue;
      }
      evDirect += line.latestCost;
      let code = byCode.get(line.costCode);
      if (!code) {
        code = {
          costCode: line.costCode,
          description: codeLevelDescription(line.description),
          directDraw: 0,
        };
        byCode.set(line.costCode, code);
      }
      code.directDraw = round2(code.directDraw + line.latestCost);
      if (code.description === "" && line.description !== "") {
        code.description = codeLevelDescription(line.description);
      }
    }

    burdenDrawn += evBurden;
    drawEvents.push({
      eventId: ev.eventId,
      title: ev.title,
      scope: override?.scope ?? ev.scope,
      type: override?.type ?? ev.type,
      reason: override?.reason ?? ev.reason,
      isOverridden: eff.isOverridden,
      directDraw: round2(evDirect),
      burdenDraw: round2(evBurden),
    });
  }

  // Roll codes up to Procore divisions.
  const byDiv = new Map<string, BuyoutDrawDivision>();
  for (const code of byCode.values()) {
    const div = parseProcoreDivision(code.costCode);
    let agg = byDiv.get(div.key);
    if (!agg) {
      agg = { division: div.key, divisionLabel: div.label, directDraw: 0, codes: [] };
      byDiv.set(div.key, agg);
    }
    agg.directDraw = round2(agg.directDraw + code.directDraw);
    agg.codes.push(code);
  }

  const byDivision = Array.from(byDiv.values());
  for (const d of byDivision) {
    d.codes.sort(
      (a, b) =>
        b.directDraw - a.directDraw ||
        a.costCode.localeCompare(b.costCode, undefined, { numeric: true }),
    );
  }
  byDivision.sort(
    (a, b) =>
      b.directDraw - a.directDraw ||
      a.division.localeCompare(b.division, undefined, { numeric: true }),
  );
  drawEvents.sort((a, b) => b.directDraw - a.directDraw || a.eventId.localeCompare(b.eventId));

  // Derive the scored total from the rounded division draws (themselves rounded
  // sums of the rounded per-code draws) so Σ(byDivision) === directDrawn exactly —
  // the expandable breakdown always reconciles with the headline Drawn figure.
  const directDrawn = round2(byDivision.reduce((sum, d) => sum + d.directDraw, 0));

  return {
    directDrawn,
    burdenDrawn: round2(burdenDrawn),
    grossDrawn: round2(directDrawn + burdenDrawn),
    drawCount,
    overriddenCount,
    byDivision,
    events: drawEvents,
  };
}

// ---------------------------------------------------------------------------
// Accuracy scoring (draw vs budget)
// ---------------------------------------------------------------------------

/** Planned-vs-miss accuracy for one job's contingency draw against its budget. */
export interface BuyoutAccuracyStat {
  /** The bid-time contingency budget (yardstick); null when unbudgeted. */
  contingencyBudget: number | null;
  /** True when a submitted-estimate budget exists to score against. */
  hasBudget: boolean;
  /** Σ direct `fp_buyout` draw (signed; negative = net savings). */
  drawn: number;
  /** The within-budget portion of a positive draw: clamp(drawn, 0, budget). */
  plannedDraw: number;
  /** The excess over budget: max(0, drawn − budget) — the genuine miss. */
  missAmount: number;
  /** Net contingency returned: max(0, −drawn) — a job that came in under. */
  savings: number;
  /** drawn ÷ budget; null when unbudgeted or budget ≈ 0. */
  utilizationPct: number | null;
  /** within / miss / savings / unbudgeted, per the tolerance band. */
  status: BuyoutAccuracyStatus;
}

/**
 * Score one job's direct buyout draw against its contingency budget. The
 * "within" band is the wider of the absolute floor and `tolerancePct × |budget|`
 * (mirrors `variance.ts`), so a draw reads "miss" only once it clears the budget
 * by more than rounding dust. A null budget yields an honest `unbudgeted` stat
 * that still reports the draw (and any savings) without inventing a miss.
 */
export function scoreBuyoutAccuracy(
  drawn: number,
  contingencyBudget: number | null,
  options?: BuyoutAccuracyOptions,
): BuyoutAccuracyStat {
  const d = round2(drawn);

  if (contingencyBudget === null) {
    return {
      contingencyBudget: null,
      hasBudget: false,
      drawn: d,
      plannedDraw: 0,
      missAmount: 0,
      savings: d < 0 ? round2(-d) : 0,
      utilizationPct: null,
      status: "unbudgeted",
    };
  }

  const budget = round2(contingencyBudget);
  const tolPct = options?.tolerancePct ?? BUYOUT_TOLERANCE_PCT;
  const tolAbs = options?.toleranceAbs ?? BUYOUT_TOLERANCE_ABS;
  const band = Math.max(tolAbs, Math.abs(budget) * tolPct);
  const utilizationPct = Math.abs(budget) > 1e-9 ? d / budget : null;

  // Status first; then derive planned/miss/savings FROM the band-based status so
  // the three never contradict the badge (a draw inside the tolerance band is
  // fully "planned" with zero miss — never a non-zero miss beside a "within" badge).
  let status: BuyoutAccuracyStatus;
  if (d - budget > band) status = "miss";
  else if (d < -band) status = "savings";
  else status = "within";

  const missAmount = status === "miss" ? round2(d - budget) : 0;
  const plannedDraw = status === "miss" ? budget : round2(Math.max(0, d));
  const savings = status === "savings" ? round2(-d) : 0;

  return {
    contingencyBudget: budget,
    hasBudget: true,
    drawn: d,
    plannedDraw,
    missAmount,
    savings,
    utilizationPct,
    status,
  };
}

// ---------------------------------------------------------------------------
// Per-project accuracy + portfolio roll-up
// ---------------------------------------------------------------------------

/** One closed job's full buyout-accuracy read (its stat + the draw breakdown). */
export interface ProjectBuyoutAccuracy {
  projectId: string;
  projectName: string;
  snapshotId: string;
  snapshotLabel: string;
  finalizedAt: string;
  marketSector: string;
  stat: BuyoutAccuracyStat;
  draws: BuyoutDrawBreakdown;
}

/**
 * Build one project's accuracy read: derive its EFFECTIVE direct draw, then score
 * it against the project's submitted-estimate contingency budget.
 */
export function buildBuyoutAccuracy(
  input: BuyoutAccuracyInput,
  options?: BuyoutAccuracyOptions,
): ProjectBuyoutAccuracy {
  const draws = buildBuyoutDraws(input);
  const stat = scoreBuyoutAccuracy(draws.directDrawn, input.contingencyBudget, options);
  return {
    projectId: input.projectId,
    projectName: input.projectName,
    snapshotId: input.snapshotId,
    snapshotLabel: input.snapshotLabel,
    finalizedAt: input.finalizedAt,
    marketSector: input.marketSector,
    stat,
    draws,
  };
}

/** Portfolio totals across every scored (budgeted) job. */
export interface BuyoutAccuracyTotals {
  /** Jobs with a contingency budget (scorable). */
  budgetedProjects: number;
  /** Jobs with no submitted-estimate budget (reported, not scored). */
  unbudgetedProjects: number;
  /** Budgeted jobs whose draw stayed within budget. */
  withinCount: number;
  /** Budgeted jobs whose draw cleared the budget (a miss). */
  missCount: number;
  /** Budgeted jobs that came in under (net savings). */
  savingsCount: number;
  /** Σ contingency budget across budgeted jobs. */
  totalContingencyBudget: number;
  /** Σ direct draw across budgeted jobs (signed). */
  totalDrawn: number;
  /** Σ within-budget (planned) draw across budgeted jobs. */
  totalPlanned: number;
  /** Σ miss (excess over budget) across budgeted jobs. */
  totalMiss: number;
  /** (within + savings) ÷ budgeted jobs — the headline accuracy rate; null when none. */
  hitRate: number | null;
  /** The aggregate posture (Σ draw vs Σ budget); "unbudgeted" when no scored jobs. */
  portfolioStatus: BuyoutAccuracyStatus;
}

/** The complete buyout-accuracy read the portfolio dashboard consumes. */
export interface BuyoutAccuracyPortfolio {
  /** False when there are no FINAL snapshots at all (honest empty state). */
  hasData: boolean;
  /** Every closed job, biggest miss first. */
  projects: ProjectBuyoutAccuracy[];
  totals: BuyoutAccuracyTotals;
}

/**
 * Roll a set of FINAL snapshots' buyout draws up into a portfolio accuracy view:
 * each job scored against its own budget, ordered biggest-miss-first, plus the
 * aggregate hit rate and Σ-draw-vs-Σ-budget posture. Budget-relative totals
 * (budget / drawn / planned / miss) cover only budgeted jobs so the aggregate is
 * apples-to-apples; unbudgeted jobs are counted and listed but never scored.
 */
export function aggregateBuyoutAccuracy(
  inputs: readonly BuyoutAccuracyInput[],
  options?: BuyoutAccuracyOptions,
): BuyoutAccuracyPortfolio {
  const projects = inputs.map((i) => buildBuyoutAccuracy(i, options));

  projects.sort(
    (a, b) =>
      b.stat.missAmount - a.stat.missAmount ||
      b.stat.drawn - a.stat.drawn ||
      a.projectName.localeCompare(b.projectName),
  );

  let budgetedProjects = 0;
  let unbudgetedProjects = 0;
  let withinCount = 0;
  let missCount = 0;
  let savingsCount = 0;
  let totalContingencyBudget = 0;
  let totalDrawn = 0;
  let totalPlanned = 0;
  let totalMiss = 0;

  for (const p of projects) {
    const s = p.stat;
    if (!s.hasBudget) {
      unbudgetedProjects += 1;
      continue;
    }
    budgetedProjects += 1;
    totalContingencyBudget += s.contingencyBudget ?? 0;
    totalDrawn += s.drawn;
    totalPlanned += s.plannedDraw;
    totalMiss += s.missAmount;
    if (s.status === "miss") missCount += 1;
    else if (s.status === "savings") savingsCount += 1;
    else withinCount += 1;
  }

  const hitRate =
    budgetedProjects > 0 ? round2((withinCount + savingsCount) / budgetedProjects) : null;
  const portfolioStatus =
    budgetedProjects > 0
      ? scoreBuyoutAccuracy(round2(totalDrawn), round2(totalContingencyBudget), options).status
      : "unbudgeted";

  return {
    hasData: projects.length > 0,
    projects,
    totals: {
      budgetedProjects,
      unbudgetedProjects,
      withinCount,
      missCount,
      savingsCount,
      totalContingencyBudget: round2(totalContingencyBudget),
      totalDrawn: round2(totalDrawn),
      totalPlanned: round2(totalPlanned),
      totalMiss: round2(totalMiss),
      hitRate,
      portfolioStatus,
    },
  };
}
