# Handoff — Actuals Cost-History & Project Budget Snapshots, Phase 9 / workstream close
_2026-06-24 · from the Phase 8 (active-project variance / KPI dashboard) session_

## Where we are
**Phase 8 is COMPLETE, committed, and pushed — and it was the LAST core phase.**
- Branch: `actuals-cost-history` (Phase 8 off Phase 7 `9b341c6`, which is off Phase 6 `e341d60`).
- Plan of record: `docs/plans/2026-06-23-actuals-cost-history-and-budget-snapshots.md`.
- Phase 8 handoff (this phase's kickoff): `docs/handoffs/2026-06-24-actuals-phase-8-kickoff.md`.
- Definition of Done satisfied: `npm run test` green (**114 files / 1402 tests**,
  +14 over Phase 7) · `npx tsc --noEmit` clean · `npm run build` green
  (`/projects/[projectId]/variance` registers as a dynamic route; everything else
  still registers) · `/code-review` (medium) run — **no actionable findings**
  (guardrails clean, no N+1, no import cycle) · one feature commit · branch pushed.
  **No DDL this phase (pure read — the spine columns already existed).**

## What landed in code
- **`src/lib/actuals/variance.ts`** (NEW, pure — no DB/React), exported from the
  `actuals` barrel. The SECOND consumer of the budget-snapshot spine and the mirror
  image of the pricing pool: it reads **ALL** of a project's snapshots (draft or
  FINAL) and turns them into budget-vs-EAC + snapshot-over-snapshot variance. It
  **never reads or writes the pricing pool** (the active-job side vs the forward-
  pricing side — they share only the storage spine).
  - `computeVarianceStat(originalBudget, eac, normalized, options?) → VarianceStat`
    — the core stat: `variance = eac − originalBudget` (**positive = over budget**,
    matching the reconcile page's sign), `variancePct` (null when no baseline), and
    an over/under/on **status** from a tolerance band = `max($1, 0.5%·|budget|)`
    (`ON_BUDGET_TOLERANCE_PCT` / `_ABS`, both exported + tunable via `options`).
  - `buildCodeVariance(codes, options?)` — rolls a snapshot's per `code+costType`
    actuals up to the Procore **cost code** grain (cost types summed). KEEPS
    EVERYTHING — burden (Fee/GL) and the blank "None" code included — so Σ(eac) ties
    to the snapshot's grand EAC (this is the key contrast with the pricing pool,
    which *excludes* burden/blank because they carry no pricing signal).
  - `buildDivisionVariance(codes, options?)` — groups codes by `parseProcoreDivision`
    (the Procore tier-1 token — burden → division "60", blank → "Unassigned"),
    biggest-overrun-first, codes nested. `isBurden` true only when every code in the
    division is burden.
  - `buildTimeline(snapshots, options?)` — capture-ordered (oldest→newest) points,
    each with `eacDeltaFromPrev` / `eacDeltaPct` / `normalizedDeltaFromPrev` (null
    for the first). Sort key: `capturedAt`, then `snapshotNumber` as a stable tiebreak.
  - `buildProjectVariance(snapshots, options?) → ProjectVarianceModel` — the
    orchestrator: `{ hasData, timeline, latest, divisions, kpis }`. `latest` = newest
    capture; `divisions` = the latest snapshot's breakdown; `kpis` carries
    original/EAC/variance/status + `directEac`/`burdenEac` split, `divisionsOverBudget`,
    `snapshotCount`, `eacTrend` (latest − earliest EAC; null when 1 snapshot),
    `latestIsFinal`. Empty input → honest `hasData: false`.
- **`src/lib/db.ts`** — `getProjectBudgetVariance(projectId) → ProjectSnapshotInput[]`
  (NEW reader). Reads ALL of a project's snapshot headers + every snapshot's per-code
  actuals in **2 queries** (`IN (...)`, no N+1), capture-ordered. Distinct from
  `getActualCostHistory` (FINAL-only, pool-bound): this is full-history and pool-free.
  Returns `[]` when the project has no snapshots. RLS confines both reads to the tenant.
- **`src/app/projects/[projectId]/variance/page.tsx`** (NEW) — the dashboard: KPI
  cards (original budget · EAC · variance $/% · status, plus direct/burden/normalized
  + EAC trend), a **snapshot-trend** table (newest first, Δ EAC vs the prior upload),
  and a **division→code** budget-vs-EAC table (expandable). Fail-soft: honest empty
  state when the project has no snapshots (no estimate or FINAL promotion required).
- **`src/app/projects/[projectId]/page.tsx`** + **`.../snapshots/page.tsx`** — a
  "Budget variance" link (`Gauge` icon) in the project header (beside "Actuals
  snapshots") and on the snapshots list header. Per-project, so **no** global Sidebar
  entry (unlike `/concept-pricing`, which is portfolio-wide).
- **`src/lib/actuals/index.ts`** — exports the variance surface (builders + types +
  the tolerance constants).
- **`src/lib/__tests__/actualsVariance.test.ts`** (NEW, +14) — `computeVarianceStat`
  (sign, pct, on/over/under band, no-baseline, custom tolerance); `buildCodeVariance`
  (cost-type sum, burden/blank KEPT, overrun order); `buildDivisionVariance` (Procore
  tier-1 grouping, burden→60, blank→Unassigned, Σ ties to total); `buildTimeline`
  (capture order, number tiebreak, deltas); `buildProjectVariance` (empty model,
  drafts-only still work, KPI tie-outs, single-snapshot trend null, final flag); and a
  **fixture-grounded** tie-out over the real `templates/` export (Σ division EAC =
  engine grand total; budget variance = grand EAC − Σ original budget; GC lands in
  division "1").

## Non-obvious discoveries / decisions
1. **Raw EAC vs Original Budget is the variance signal, NOT the pool's normalized
   number.** A PM cares about the real money on the real job. `normalized` rides along
   as the in-scope contrast (the number the pool would price on), but the headline
   variance is `totalActual − originalBudget`. This is the deliberate split from the
   pricing pool, which prices on normalized.
2. **The variance dashboard KEEPS burden + blank codes; the pricing pool drops them.**
   Including everything is what makes Σ(division EAC) tie to the snapshot's
   `grand_total_actual`. The fixture test pins this tie-out — if a future change starts
   filtering codes here, that test fails (as it should).
3. **`getDivisionCode` is STILL the wrong tool here** (AGENTS.md "Division Code
   Standardization" is scoped to estimate `itemId` strings). The pool's keys are
   Procore budget codes, so division grouping is `parseProcoreDivision` (the Procore
   tier-1 token, raw — "1", not "01"). Same call the concept-pricing phase reuses.
4. **No DDL was needed** — the schema comment on `budget_snapshots` had already
   pre-declared the four `grand_*` NUMERIC columns "so the Phase 8 budget-vs-EAC
   dashboard reads them cheaply," and `budget_snapshot_actuals` already carries
   `original_budget` + `total_actual` per code. Phase 2 designed for both consumers, so
   the "DDL shape churn" risk never materialized.
5. **`committed` / `projected` snapshot-over-snapshot deltas were scoped OUT** (see the
   open item below) — they are NOT in the spine, so adding them is a DDL gate.

## Carry-over notes
1. **Pre-existing working-tree churn STILL present and untouched.** The
   `docs/handoffs|plans → archive/` reorg (unstaged deletions + untracked `archive/`
   copies) predates these sessions and was again left OUT of the Phase-8 commit (only
   the Phase-8 files + this handoff were staged). `git status` still shows it, plus the
   untracked `docs/plans/2026-06-23-fee-block-addressability.md`,
   `templates/Company_Bid_Comp_Template.xlsx`, `templates/change_event_types_reasons_scope.txt`.
   Leave them alone.
2. **The core workstream (Phases 1–8) is now COMPLETE.** Phase 9 below is explicitly
   deferred (build-only-if-asked). With Phase 8 landed, the `actuals-cost-history`
   branch is a **candidate to merge to `main`** — that requires explicit architect
   approval (the one `main`-push prompt is the gate per CLAUDE.md Git Workflow). Do NOT
   merge or push to `main` without it.

## Open follow-ups (optional, not blocking)
- **`committed` / `projected` per-snapshot trend.** The Phase-8 handoff mentioned a
  committed/projected snapshot-over-snapshot cut, but `CodeActual` /
  `budget_snapshot_actuals` only persist `original_budget` + `total_actual` (EAC) +
  `normalized_actual` — committed/projected live on the `BudgetDetailRow` the parser
  reads but were never stored. Adding them = a ⛔ DDL gate (new columns on
  `budget_snapshot_actuals` + the save RPC + `supabase_schema.sql` first). EAC +
  normalized + original-budget deltas are covered today; this is the next column if the
  PM view wants it.
- **Confidence badge on a KPI (the `StrengthScorable` value-swap).** Not used in Phase
  8 (variance is a direct ledger read, not a pooled estimate). If a future "trend
  confidence" indicator is wanted, the swap pattern (map the scored value into
  `normalizedActual`) is available, exactly as concept-pricing did for $/metric.
- **Portfolio roll-up.** Phase 8 is per-project. A cross-project executive variance
  roll-up (which jobs are most over budget, total portfolio exposure) is a natural
  follow-on; it would add a NEW all-projects reader (akin to `getActualCostHistory`'s
  shape but full-history) feeding a global `/variance` page — and still never the pool.

## Phase 9 — (Deferred) Accuracy scoring: planned-buyout-vs-miss
Per the plan's Phase 9 scope — build ONLY if the architect asks.
- **Scope:** Compare in-scope FP Contingency/Buyout draws against the estimate's
  contingency budget; draws within budget = planned, the excess = a genuine miss. An
  accuracy lens separate from both pricing history and active-project variance. Needs
  the estimate's contingency budget as the yardstick (the reason it was deferred — it
  couples back to the estimate side, unlike Phases 6–8 which are Procore-sourced only).
- **Build on:** the FINAL-snapshot normalized actuals (the FP Buyout bucket is already
  isolated in the normalization engine — `bucket: "fp_buyout"`, kept in normalized) +
  the project's submitted estimate version's contingency lines.
- **Approval gates:** none anticipated (read-side). If it needs to persist a scored
  result, that's a DDL gate.
- **Exit criteria:** the standard five (test · tsc · build · review · commit) + handoff.

## Phase 9 kickoff prompt (use only if the architect greenlights Phase 9)
> Implement **Phase 9 (deferred) of the Actuals Cost-History & Project Budget
> Snapshots** workstream, per `docs/plans/2026-06-23-actuals-cost-history-and-budget-snapshots.md`
> and the Phase 9 handoff `docs/handoffs/2026-06-24-actuals-phase-9-kickoff.md`. Phase 9
> is the **planned-buyout-vs-miss accuracy lens**: compare each FINAL snapshot's in-scope
> FP Contingency/Buyout draws (the `fp_buyout` normalization bucket) against the project's
> submitted-estimate contingency budget — draws within budget = planned, the excess = a
> miss. It is separate from pricing history (Phase 6/7) and active-project variance (Phase
> 8). Put the accuracy math in a NEW pure module (unit-tested); reuse the FINAL-snapshot
> reader path and `parseProcoreDivision` for any division grouping (NOT `getDivisionCode`).
> Pure read — no DDL unless a scored result must be persisted (then STOP at the DDL gate:
> update `supabase_schema.sql` + explicit approval). Take it through the Definition of
> Done, commit one phase to `actuals-cost-history` via `git commit -F`, push, write the
> closing handoff. Stop at the phase boundary.
>
> If the architect instead wants to **close the workstream**, the branch is ready to
> merge to `main` (Phases 1–8 complete) — that needs explicit approval and is the only
> step that touches `main`.
