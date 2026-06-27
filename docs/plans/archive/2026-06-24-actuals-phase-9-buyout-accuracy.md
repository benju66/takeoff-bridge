# Actuals Cost-History — Phase 9 implementation plan (planned-buyout-vs-miss accuracy lens)
_2026-06-24 · branch `actuals-cost-history` · status: PROPOSED (awaiting architect approval)_

Plan of record: `docs/plans/2026-06-23-actuals-cost-history-and-budget-snapshots.md` (Phase 9).
Kickoff: `docs/handoffs/2026-06-24-actuals-phase-9-kickoff.md`.

## Goal
Compare each FINAL snapshot's in-scope **FP Contingency/Buyout draws** (the `fp_buyout`
normalization bucket, EFFECTIVE after Phase-5 classification overrides) against the
project's **submitted-estimate contingency budget** (Construction Contingency + Design
Contingency, frozen on the submitted estimate version's `summary`). Draws within budget =
**planned**; the excess over budget = a **miss**. A forward-learning accuracy lens, separate
from pricing history (P6/P7) and active-project variance (P8). Pure read; **no DDL**.

## Decisions (resolved, with rationale)
1. **Portfolio-wide, not per-project.** One `/buyout-accuracy` page + a Sidebar entry,
   mirroring `/concept-pricing`. The kickoff says "reuse the FINAL-snapshot reader path"
   (the all-projects `getActualCostHistory` path), and accuracy is a cross-job learning
   question (do we systematically under-budget contingency?). Each comparison is still
   per-project (this job's draws vs this job's budget); the page also rolls them up.
2. **Yardstick = the SUBMITTED estimate version's `summary`, not the live working copy.**
   `summary.constructionContingency + summary.designContingency` (frozen at bid time). A
   project with no submitted version has **no budget** → scored "unbudgeted" (reported
   honestly, never fabricated). This is the deferral reason — it couples to the estimate side.
3. **The "draw" is the DIRECT (non-burden) `fp_buyout` cost**, split out from the change
   event's own Fee/GL markup lines (burden tracked separately for transparency). The
   contingency budget is a direct-cost % set on the takeoff subtotal, so direct-vs-direct is
   apples-to-apples. Negatives (savings / buyout returns) ride through — a net-negative draw
   is a project that came in **under** its contingency.
4. **EFFECTIVE `fp_buyout`, never frozen.** Same hard contract as the pricing pool: run
   `applyEventClassificationOverrides` over each snapshot's frozen actuals + events + overlay,
   then filter to `effectiveBucket === "fp_buyout"` (so a Phase-5 correction that moves an
   event into/out of `fp_buyout` is honored). Per-event draw dollars are extracted from
   `event.lines` exactly the way `normalize.ts` does (skip blank costCode, skip zero).
5. **Division grouping = `parseProcoreDivision`** (the Procore tier-1 token), never
   `getDivisionCode` (AGENTS.md "Division Code Standardization" is scoped to estimate
   `itemId`s). Same call P7/P8 reuse.
6. **REPORT-only.** Nothing writes; every dollar is a deterministic function of the frozen
   snapshot + the frozen submitted summary. No DDL (no scored result persisted). If a future
   phase wants to store the score, that is a ⛔ DDL gate.

## Files

| # | File | Change | Notes |
|---|------|--------|-------|
| 1 | `src/lib/actuals/buyoutAccuracy.ts` | **NEW** pure module | The accuracy math (named distinctly from `src/lib/buyout.ts`, the unrelated Estimate Buyout Lens). |
| 2 | `src/lib/actuals/index.ts` | **EDIT** | Barrel-export the new surface (builders + types + tolerance constants). |
| 3 | `src/lib/db.ts` | **EDIT** | NEW reader `getBuyoutAccuracyInputs(): Promise<BuyoutAccuracyInput[]>` — reuses the `getActualCostHistory` FINAL-snapshot path + one batched submitted-version query for budgets. |
| 4 | `src/app/buyout-accuracy/page.tsx` | **NEW** | Portfolio dashboard (KPI cards + per-project table, expandable to divisions). Fail-soft empty state. |
| 5 | `src/components/layout/Sidebar.tsx` | **EDIT** | Add a "Buyout Accuracy" link (Target icon) after "Concept Pricing". |
| 6 | `src/lib/__tests__/actualsBuyoutAccuracy.test.ts` | **NEW** | Unit + fixture-grounded tests. |

## Pure module API (`buyoutAccuracy.ts`)
Structurally DB-decoupled inputs (mirrors `pricingPool.FinalSnapshotInput`):

- `BuyoutAccuracyInput` — `{ projectId, projectName, snapshotId, snapshotLabel, finalizedAt,
  marketSector, contingencyBudget: number | null, actuals: CodeActual[], events:
  ClassifiedChangeEvent[], overlayRows: OverlayRowLike[] }`.
- `BuyoutDrawBreakdown` — `buildBuyoutDraws(input)`: EFFECTIVE `fp_buyout` events → per-code
  + per-division direct draws (parseProcoreDivision), with `directDrawn` / `burdenDrawn` /
  `grossDrawn` / `drawCount` / `overriddenCount` / `byDivision[]` / `events[]`.
- `BuyoutAccuracyStat` — `scoreBuyoutAccuracy(drawn, contingencyBudget, options?)`:
  `{ contingencyBudget, hasBudget, drawn, plannedDraw, missAmount, savings, utilizationPct,
  status }`. Status: `unbudgeted` (no budget) · `savings` (drawn < −band) · `miss`
  (drawn − budget > band) · `within` (otherwise). Tolerance band = `max(toleranceAbs,
  tolerancePct·|budget|)`, exported + tunable (mirrors `variance.ts`).
- `ProjectBuyoutAccuracy` — `buildBuyoutAccuracy(input, options?)`: one snapshot's stat + draws.
- `BuyoutAccuracyPortfolio` — `aggregateBuyoutAccuracy(inputs[], options?)`: `{ hasData,
  projects[] (biggest miss first), totals: { budgetedProjects, unbudgetedProjects,
  withinCount, missCount, savingsCount, totalContingencyBudget, totalDrawn, totalMiss,
  hitRate, portfolioStatus } }`.

## Tests (`actualsBuyoutAccuracy.test.ts`)
- `scoreBuyoutAccuracy`: within / miss (excess) / savings / unbudgeted / budget=0 / tolerance
  band / utilization pct / no-baseline.
- `buildBuyoutDraws`: `fp_buyout` filter; EFFECTIVE override moves an event into `fp_buyout`
  (counted) and out of it (dropped); direct-vs-burden split; division grouping; duplicate
  exclusion; blank-code + zero-line skip.
- `buildBuyoutAccuracy` / `aggregateBuyoutAccuracy`: portfolio totals, hit rate, miss-first
  sort, unbudgeted handling, honest empty model.
- **Fixture-grounded** over the real `templates/` export: Σ EFFECTIVE `fp_buyout` direct draws
  equals an independently recomputed sum off `computeNormalizedActuals(raw).events`; division
  grouping via `parseProcoreDivision`; pairing it with a synthetic budget yields the correct
  within/miss split.

## Definition of Done
Tests green · `npx tsc --noEmit` clean · `npm run build` green · `/code-review` (medium)
resolved · ONE commit on `actuals-cost-history` via `git commit -F` · push the branch · write
the closing handoff. **No DDL, no approval gate.** Stop at the phase boundary.
