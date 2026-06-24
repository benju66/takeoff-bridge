# Handoff — Actuals Cost-History & Project Budget Snapshots, Phase 7 kickoff
_2026-06-24 · from the Phase 6 (actuals pricing pool → /rates + strength) session_

## Where we are
**Phase 6 is COMPLETE, committed, and pushed.**
- Branch: `actuals-cost-history` (Phase 6 commit `e341d60`, off Phase 5 `f3f843d`).
- Plan of record: `docs/plans/2026-06-23-actuals-cost-history-and-budget-snapshots.md`.
- Phase 6 implementation plan (approved): `.claude/plans/zazzy-dreaming-moon.md`.
- Definition of Done satisfied: `npm run test` green (**112 files / 1371 tests**,
  +13 over Phase 5) · `npx tsc --noEmit` clean · `npm run build` green (`/rates`
  still registers) · `/code-review` (medium) run — **no findings** · one commit ·
  branch pushed. **No DDL this phase (pure read).**

## What landed in code
- **`src/lib/actuals/pricingPool.ts`** (NEW, pure — no DB/React), exported from the
  `actuals` barrel:
  - `buildActualCostObservations(FinalSnapshotInput[]) → ActualCostObservation[]` —
    the FIRST reader of FINAL snapshots. For each snapshot it runs
    `collectEventOverrides` + `applyEventClassificationOverrides` (the **EFFECTIVE**
    normalized — frozen rows never mutated, every Phase-5 correction honored), then
    aggregates `effectiveActuals` to the **Procore cost-code** grain (cost types
    summed). EXCLUDES burden (Fee/GL), the blank `""` "None" code, and
    zero-normalized codes; RETAINS negatives (savings/buyout). Each observation
    carries `normalizedActual`, `totalActual` (EAC), `coAdjustmentShare`
    (|total−normalized|/|total|, the CO-churn signal), and project/snapshot context
    (`projectId/Name`, `snapshotId/Label`, `finalizedAt`, `marketSector`).
  - `aggregateActualCostHistory(observations, { now? }) → Map<costCode, ActualCostStat[]>`
    — pools per **(code, market sector)** (mirrors `historyTrust`'s sector split),
    keyed by Procore code; `median/min/max/mean` normalized + `medianTotal`,
    newest-finalized first, groups ordered by job count desc. No outlier screen
    (actuals are real ledger numbers, not bid quotes — spread is signal, not noise).
  - `scoreActualStrength(observations, { now? }) → ActualStrength` — extends the
    `historyTrust` philosophy: an **`ACTUAL_PROVENANCE_FLOOR` (0.35)** so any
    actual-backed group reads above estimate-only; **sample size** (reuses
    `LOW_CONFIDENCE_BELOW`=3; hard `count ≥ 3` gate for tier `"strong"`);
    **CO-cleanliness** (`1 − mean(coAdjustmentShare)`); **recency** decay
    (`RECENCY_FRESH_MONTHS`=12 → `RECENCY_STALE_MONTHS`=60; null date → neutral
    0.5); **spread** tightness (1 − clamp(CV); count<2 → neutral 0.5). Tiers
    `strong | moderate | thin` + a human `label`. Exported weights/constants.
- **`src/lib/db.ts`** — `getActualCostHistory(): Promise<ActualCostObservation[]>` —
  report-only reader. Queries all FINAL `budget_snapshots` (RLS tenant-scoped) with a
  `projects(name, market_sector)` join, pulls each `getBudgetSnapshotDetail`, assembles
  `FinalSnapshotInput[]`, and returns the pure builder's output. The calc/normalization
  engine stays the sole financial authority (copies engine output, fabricates nothing).
- **`src/app/rates/page.tsx`** — a SEPARATE `actual` line under each rate row
  (`ActualCostStatLine`: teal, `Coins` icon, strength badge, **no ADOPT** — whole-code
  dollars, not a unit rate), joined by `resolveProcoreCode(entry.lineCode)`. State +
  load are fail-soft and independent (mirrors the as-bid `priceHistory` idiom); a new
  effect primes the cost-code resolver (`getCostCodeMap` → `primeCostCodeResolver`,
  catalog fallback) and a `resolverReady` flag forces the `actualByLineCode` join memo
  to recompute once the module-cache prime lands. Info-banner note explains the two
  signals (violet as-bid / teal actual).
- **`src/lib/__tests__/actualsPricingPool.test.ts`** (NEW, +13) — builder (effective
  recompute honored both directions, exclusions, negatives, context), aggregation
  (grouping, median, newest-first, sector split), strength (floor, count gate,
  cleanliness/recency/spread monotonicity, null-date neutral), and a **fixture-grounded**
  tie-out: the pool's per-code normalized equals the engine's per-code sum over the real
  `templates/` export, burden codes absent.

## Non-obvious discoveries / decisions (build Phase 7 to fit these)
1. **The pool grain is the Procore cost code (types summed), NOT code+type.** The
   `/rates` join (`resolveProcoreCode`) resolves to a code only, so the pool reports at
   code level. `ActualCostObservation.costCode` is e.g. `"1-10320.000"`. Phase 7's
   parametric grain (per-code / division / sector) builds on this same code level.
2. **`getActualCostHistory` does NOT yet fetch `square_footage` / `unit_count`.** Its
   `projects(...)` join pulls only `name, market_sector`. Phase 7's $/SF and $/unit need
   those metrics — extend the join to `projects(name, market_sector, square_footage,
   unit_count)` and carry them onto `FinalSnapshotInput` / a parametric observation. The
   columns already exist (`projects.square_footage` / `projects.unit_count`, plan "Data
   realities") — no DDL.
3. **Division grouping must come from the Procore code, NOT `getDivisionCode()`.**
   `getDivisionCode` extracts a 2-digit CSI division from an `itemId` (e.g. `09`); the
   pool's keys are Procore budget codes (`"1-10320.000"`, leading `1 -` = Procore
   division tier1). Don't run `getDivisionCode` over a Procore code. The frozen actuals'
   `description` and the budget export's tier1 carry the Procore division label; derive
   Phase-7 division rollups from the Procore code structure, not the CSI utility.
4. **The strength signal is reusable as-is.** `scoreActualStrength` takes a list of
   `ActualCostObservation` — Phase 7 can score a parametric group (a code/division across
   jobs) by passing its observations straight in. Carry the same tier/label so the
   concept-pricing view speaks the same confidence language as `/rates`.
5. **`now`-relative recency is intentional non-determinism.** `aggregateActualCostHistory`
   / `scoreActualStrength` accept `{ now }` (tests pin it; prod uses real now). Keep that
   injection point if Phase 7 wraps them.
6. **The pool is empty until a snapshot is promoted FINAL.** The math is proven by the
   fixture test, but the live `/rates` actual line only appears once a project has a FINAL
   budget snapshot AND its code resolves via `cost_code_map`. GC/Site-Ops rate-card codes
   are not in `cost_code_map`, so they resolve to `""` and show no actuals — a known,
   fail-soft gap (catalog `itemId` rows do resolve). Phase 7's parametric view is its own
   surface, so this gap does not block it.

## Carry-over notes
1. **Pre-existing working-tree churn STILL present and untouched.** The
   `docs/handoffs|plans → archive/` reorg (unstaged deletions + untracked `archive/`
   copies) predates these sessions and was deliberately left OUT of the Phase-6 commit
   (only the 5 Phase-6 files were staged). `git status` still shows it, plus untracked
   `docs/plans/2026-06-23-fee-block-addressability.md`,
   `templates/Company_Bid_Comp_Template.xlsx`,
   `templates/change_event_types_reasons_scope.txt`. Leave them alone.
2. **No parametric read yet (Phase 7)** and **no variance/KPI dashboard yet (Phase 8).**
   Phase 6 is the pricing pool's first reader; Phase 7 is the second (concept pricing),
   Phase 8 the third (active-project variance, reads ALL snapshots, never the pool).

## Phase 7 — Parametric concept pricing ($/SF, $/unit)
Per the plan's Phase 7 scope. Using existing `projects.square_footage` /
`projects.unit_count`, compute per-code / division / sector **parametric benchmarks**
from the actuals pool (normalizedActual ÷ SF, ÷ unit), and a concept-pricing READ + view
for early / napkin-stage budgeting. Carries the P6 strength signal.

- **Build on:** `buildActualCostObservations` / `aggregateActualCostHistory` /
  `scoreActualStrength` + `getActualCostHistory` (extend its `projects(...)` join to
  add `square_footage, unit_count` — see Non-obvious #2). A parametric observation is a
  pool observation divided by the snapshot's project metric; guard divide-by-zero/missing
  metric (a project with no SF/unit count contributes no parametric datum, but still
  contributes to the absolute pool).
- **Division grouping:** derive from the Procore code, not `getDivisionCode` (Non-obvious
  #3).
- **Approval gates:** none (pure read; no DDL — the metric columns already exist). If a
  perf index/materialized aggregation is wanted, STOP — that's a DDL gate.
- **Exit criteria:** the standard five (test · tsc · build · review · commit) + handoff.
  **One phase per fresh session — stop at the phase boundary.**

## Phase 7 kickoff prompt
> Implement **Phase 7 of the Actuals Cost-History & Project Budget Snapshots**
> workstream, per `docs/plans/2026-06-23-actuals-cost-history-and-budget-snapshots.md`
> and this Phase 7 handoff `docs/handoffs/2026-06-24-actuals-phase-7-kickoff.md`.
> Phase 7 is **parametric concept pricing ($/SF, $/unit)** off the Phase-6 actuals pool.
> Using existing `projects.square_footage` / `projects.unit_count`, compute per-code /
> division / sector parametric benchmarks (normalizedActual ÷ metric) from FINAL
> snapshots, carrying the P6 strength signal, and build a concept-pricing read + view for
> early-stage budgeting. Build on `buildActualCostObservations` /
> `aggregateActualCostHistory` / `scoreActualStrength` and `getActualCostHistory` (extend
> its `projects(...)` join to add `square_footage, unit_count`). Guard
> divide-by-zero/missing metric; derive division grouping from the Procore code, NOT
> `getDivisionCode` (which is for CSI itemIds). Pure read — no DDL (the metric columns
> already exist; a perf index/materialized aggregation would be a STOP gate). Take it
> through the Definition of Done, commit one phase to `actuals-cost-history` via
> `git commit -F`, push, write the Phase 8 handoff. Stop at the phase boundary.
