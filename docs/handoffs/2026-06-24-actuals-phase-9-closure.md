# Handoff — Actuals Cost-History & Project Budget Snapshots, Phase 9 closure / workstream complete
_2026-06-24 · from the Phase 9 (planned-buyout-vs-miss accuracy lens) session_

## Where we are
**Phase 9 is COMPLETE, committed, and pushed — and it was the LAST phase. The entire
9-phase Actuals Cost-History & Project Budget Snapshots workstream is now done.**
- Branch: `actuals-cost-history` (Phase 9 off Phase 8 `547d8a8`).
- Plan of record: `docs/plans/2026-06-23-actuals-cost-history-and-budget-snapshots.md`.
- Phase 9 implementation plan: `docs/plans/2026-06-24-actuals-phase-9-buyout-accuracy.md`.
- Phase 9 kickoff: `docs/handoffs/2026-06-24-actuals-phase-9-kickoff.md`.
- Definition of Done satisfied: `npm run test` green (**115 files / 1418 tests**, +16
  over Phase 8) · `npx tsc --noEmit` clean · `npm run build` green (`/buyout-accuracy`
  registers as a static route; everything else still registers) · `/code-review` (medium)
  run — **no actionable findings** · one feature commit · branch pushed.
  **No DDL this phase (pure read — reuses existing snapshot + estimate-version columns).**

## What landed in code
- **`src/lib/actuals/buyoutAccuracy.ts`** (NEW, pure — no DB/React), exported from the
  `actuals` barrel. The THIRD reader of the FINAL budget snapshots and the **only one that
  couples to the estimate side**. It grades each closed job's in-scope FP Contingency/Buyout
  draws against the bid-time contingency budget.
  - `buildBuyoutDraws({ events, overlayRows })` — re-resolves each event's disposition under
    the snapshot's Phase-5 overlay (`resolveEffectiveDisposition` per event — lighter than the
    full pool recompute; **no actuals needed**, `fp_buyout` is a change-event signal), keeps
    only EFFECTIVE `fp_buyout` non-duplicate events, sums their detail lines at the cost-code
    grain (blank-code + zero lines skipped exactly as `normalize.ts` does), and **splits direct
    cost from the CO's own Fee/GL burden**. Direct draws roll up to Procore divisions via
    `parseProcoreDivision`. Negatives (savings / buyout returns) are retained. Returns
    `directDrawn` / `burdenDrawn` / `grossDrawn` / `drawCount` / `overriddenCount` /
    `byDivision[]` / `events[]`.
  - `scoreBuyoutAccuracy(drawn, contingencyBudget, options?)` — the core stat:
    `missAmount = max(0, drawn − budget)` (the excess = a miss), `plannedDraw = clamp(drawn, 0,
    budget)`, `savings = max(0, −drawn)`, `utilizationPct`, and a **status** = `within` /
    `miss` / `savings` / `unbudgeted` from a tolerance band = `max($1, 0.5%·|budget|)`
    (`BUYOUT_TOLERANCE_PCT` / `_ABS`, exported + tunable). A `null` budget → honest
    `unbudgeted` (draw still reported, no miss invented).
  - `buildBuyoutAccuracy(input, options?)` — one job's draws + stat.
  - `aggregateBuyoutAccuracy(inputs[], options?) → BuyoutAccuracyPortfolio` — `{ hasData,
    projects (biggest-miss first), totals }`. Budget-relative totals (budget / drawn / planned
    / miss) cover **budgeted jobs only** so the aggregate stays apples-to-apples; unbudgeted
    jobs are counted + listed but never scored. `hitRate = (within + savings) / budgeted`.
- **`src/lib/db.ts`** — `getBuyoutAccuracyInputs() → BuyoutAccuracyInput[]` (NEW reader).
  Reuses the `getActualCostHistory` FINAL-snapshot path (all FINAL snapshots + their detail in
  parallel), then fetches each involved project's SUBMITTED-estimate contingency budget
  (`summary.constructionContingency + designContingency`) in **one batched query** (no N+1). A
  project with no submitted version → `contingencyBudget: null` (unbudgeted). A `Map.has`-style
  `?? null` keeps a real **$0** budget distinct from "no yardstick". RLS confines both reads to
  the tenant.
- **`src/app/buyout-accuracy/page.tsx`** (NEW) — the portfolio dashboard: KPI cards (accuracy
  hit rate · budgeted contingency · contingency drawn · total miss), and a per-project table
  (project · finalized · budget · drawn · planned · miss · status badge) expandable to the
  per-division direct draws. Fail-soft empty state (no FINAL snapshot → honest message).
- **`src/components/layout/Sidebar.tsx`** — a portfolio-wide "Buyout Accuracy" link (Target
  icon) after "Concept Pricing" (it reads all projects' FINAL snapshots, so it is a global
  Sidebar entry like `/concept-pricing` / `/rates`, NOT a per-project tab).
- **`src/lib/actuals/index.ts`** — exports the buyout-accuracy surface (builders + types +
  tolerance constants).
- **`src/lib/__tests__/actualsBuyoutAccuracy.test.ts`** (NEW, +16) — `scoreBuyoutAccuracy`
  (within / miss / savings / unbudgeted / zero-budget / tolerance band / utilization);
  `buildBuyoutDraws` (fp_buyout filter, direct-vs-burden split, division grouping, duplicate +
  blank/zero skip, override INTO and OUT of fp_buyout); `buildBuyoutAccuracy` /
  `aggregateBuyoutAccuracy` (totals, hit rate, miss-first sort, empty); and a **fixture-grounded**
  tie-out over the real `templates/` export (Σ EFFECTIVE fp_buyout direct draw equals an
  independent recompute off `computeNormalizedActuals(raw).events`; divisions sum back to it;
  grouping is the Procore tier-1 token; a synthetic budget yields the right planned/miss split).

## Non-obvious discoveries / decisions
1. **The yardstick is the SUBMITTED estimate version's frozen `summary`, not the live working
   copy.** `summaryNumbers()` (VersionsPanel) copies every numeric `TakeoffSummary` field —
   including `constructionContingency` + `designContingency` — into the version's `summary`
   JSONB at submit time. That is the bid-time contingency budget; the live `project_estimates`
   row can drift post-bid, so it is the wrong number. This estimate coupling is exactly why P9
   was deferred (Phases 6–8 are Procore-sourced only).
2. **The draw is DIRECT cost, not gross.** A change event carries its own Fee (`60-604000.000`)
   + GL (`60-602020.000`) markup lines; the contingency budget is a direct-cost percentage, so
   the scored draw excludes burden (tracked separately as `burdenDrawn`). Comparing direct
   draws to a direct-cost budget keeps it apples-to-apples.
3. **EFFECTIVE `fp_buyout`, never frozen** — same hard contract as the pricing pool. A Phase-5
   classification correction that moves an event into (or out of) `fp_buyout` is honored via
   `resolveEffectiveDisposition`. The tie-out test exercises both override directions.
4. **`parseProcoreDivision`, never `getDivisionCode`** — same reason as P7/P8 (the pool's keys
   are Procore budget codes, a different code space from estimate `itemId`s).
5. **Budget-relative totals are budgeted-only by design.** Σ drawn / planned / miss / budget
   cover only jobs with a budget so the aggregate hit-rate is meaningful; unbudgeted jobs are
   visible in the table but never folded into the scored totals (a reviewer reconciling the
   table's Drawn column against the "Contingency drawn" KPI will see budgeted-only — intended).
6. **No DDL needed** — events live on `budget_snapshots.events`, the overlay on
   `budget_snapshot_allocations`, the budget on `estimate_versions.summary`. All three already
   existed; the reader only joins them.

## Carry-over notes
1. **Pre-existing working-tree churn STILL present and untouched.** The
   `docs/handoffs|plans → archive/` reorg (unstaged deletions + untracked `archive/` copies)
   predates these sessions and was again left OUT of this commit (only the Phase-9 files + the
   plan doc + this handoff were staged). `git status` still shows it, plus the untracked
   `docs/plans/2026-06-23-fee-block-addressability.md`, `templates/Company_Bid_Comp_Template.xlsx`,
   `templates/change_event_types_reasons_scope.txt`. Leave them alone.
2. **The full workstream (Phases 1–9) is now COMPLETE.** The `actuals-cost-history` branch is
   ready to **merge to `main`** — that requires explicit architect approval (the one
   `main`-push prompt is the gate per CLAUDE.md Git Workflow). Do NOT merge or push to `main`
   without it. Default to a direct merge; a PR is opt-in (e.g. to run cloud `/code-review ultra`
   first).

## Optional follow-ups (not blocking, build-only-if-asked)
- **Persist a scored accuracy result.** Today everything is read-derived. If a future view
  wants a stored/queryable accuracy score per snapshot, that is a ⛔ DDL gate (new column on
  `budget_snapshots` or a small scores table + `supabase_schema.sql` first + approval).
- **Per-project buyout-accuracy tab.** The lens is portfolio-wide; a per-project cut beside the
  `/projects/[id]/variance` dashboard (this job's draws vs its budget, division detail) would
  reuse `buildBuyoutAccuracy` directly — just a new per-project reader + a tab.
- **Confidence/recency weighting on the hit rate.** The portfolio hit-rate weights every
  budgeted job equally; a dollar-weighted or recency-weighted rate (older closeouts decayed,
  per the pricing pool's recency model) could be added if the headline should favor recent jobs.
- **Strength badge on the draw.** Like the pool's `StrengthScorable`, a thin-sample indicator
  could flag jobs whose buyout draw rests on very few events.
