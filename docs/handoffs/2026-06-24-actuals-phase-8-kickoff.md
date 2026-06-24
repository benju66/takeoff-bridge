# Handoff — Actuals Cost-History & Project Budget Snapshots, Phase 8 kickoff
_2026-06-24 · from the Phase 7 (parametric concept pricing — $/SF, $/unit) session_

## Where we are
**Phase 7 is COMPLETE, committed, and pushed.**
- Branch: `actuals-cost-history` (Phase 7 off Phase 6 `e341d60`).
- Plan of record: `docs/plans/2026-06-23-actuals-cost-history-and-budget-snapshots.md`.
- Phase 7 handoff (this phase's kickoff): `docs/handoffs/2026-06-24-actuals-phase-7-kickoff.md`.
- Definition of Done satisfied: `npm run test` green (**113 files / 1388 tests**,
  +17 over Phase 6) · `npx tsc --noEmit` clean · `npm run build` green
  (`/concept-pricing` registers as a static route; `/rates` still registers) ·
  `/code-review` (medium) run — **1 finding found & fixed** (stale-sector on the
  metric toggle; see below) · one feature commit · branch pushed.
  **No DDL this phase (pure read).**

## What landed in code
- **`src/lib/actuals/conceptPricing.ts`** (NEW, pure — no DB/React), exported from
  the `actuals` barrel. The SECOND reader of the actuals pricing pool (after
  `/rates`): it turns the Phase-6 dollars-per-code observations into **$/SF and
  $/unit benchmarks** for napkin-stage budgeting.
  - `parseProcoreDivision(costCode) → { key, label }` — division from the **Procore
    code structure** (the leading tier-1 token before the first `-`:
    `"1-10320.000"` → `"1"`, `"09-9000.002"` → `"09"`), deliberately **NOT**
    `getDivisionCode()` (that reads a CSI division from an estimate `itemId`; the
    same job's Procore tier-1 `1` maps to CSI `01` — a different code space).
  - `buildCodeParametrics(observations, metric) → ParametricObservation[]` — one
    pool observation's EFFECTIVE normalized dollars ÷ the project metric. **Guards
    the denominator:** a project whose SF / unit count is `0` / non-finite yields
    NO parametric datum for that metric (still in the absolute dollars pool);
    negatives (savings / buyout) ride through.
  - `buildDivisionParametrics(observations, metric)` — per (snapshot, division)
    sum of every code's normalized + total dollars ÷ the project metric, with the
    rollup's CO-churn share recomputed from the summed totals. Drops a division
    whose summed normalized nets to zero. Keyed by `snapshotId__division` so jobs
    never blend.
  - `aggregateConceptPricing(observations, { now? }) → ConceptPricingModel` —
    division- and code-level benchmarks for BOTH metrics in one pass, split by
    market sector, each with `median/min/max/mean` $/metric, `medianNormalized`,
    `count`, `latestFinalizedAt`, and an `ActualStrength`. Plus `sectors[]`,
    `hasSf`, `hasUnit` for the view. Groups order by job count desc.
  - **Strength reuse (Non-obvious below):** each benchmark's strength comes from
    Phase-6 `scoreActualStrength`, fed the group's observations with
    `normalizedActual` **swapped to `costPerMetric`** so the spread dimension
    measures $/SF (or $/unit) tightness while the tier/label vocabulary stays
    identical to `/rates`. This required loosening `scoreActualStrength`'s param to
    the new exported `StrengthScorable` (the `Pick` of the three fields it reads).
  - `CONCEPT_METRICS` (metric → project field + labels) and `DIVISION_GRAIN_CODE`
    (`""`, marks a rollup row) are exported for the view.
- **`src/lib/actuals/pricingPool.ts`** — `FinalSnapshotInput` and
  `ActualCostObservation` now carry `squareFootage` / `unitCount` (0 = unknown);
  `buildActualCostObservations` copies them onto every observation. The dollars
  pool itself never divides by them (Phase 6 behavior unchanged; `/rates`
  untouched). Added `StrengthScorable` + loosened `scoreActualStrength`'s signature
  (backward-compatible — `ActualCostObservation[]` still satisfies it).
- **`src/lib/db.ts`** — `getActualCostHistory`'s `projects(...)` join widened to
  `name, market_sector, square_footage, unit_count`; `mapObservationProjectContext`
  return type widened; the two metric fields populated onto `FinalSnapshotInput`
  (`Number(...) || 0`, mirroring `mapProjectFromRow`). **No new DB function** —
  `/rates` and `/concept-pricing` share this one read.
- **`src/app/concept-pricing/page.tsx`** (NEW) — the view: a **basis toggle**
  ($/SF · $/unit, each disabled when `hasSf`/`hasUnit` is false), a **market-sector**
  selector (sector-specific by design — never blends $/SF across building types),
  and a **concept-quantity** input. Renders division rollup rows (expand → code
  rows) with median $/metric, range, strength badge, and **implied dollars**
  (median × concept qty); KPI cards show division count, the blended $/metric
  (Σ division medians), and the rough budget. Fail-soft load via
  `getActualCostHistory` + `aggregateConceptPricing`; honest empty state when the
  pool is empty (no FINAL snapshot yet) or a project lacks SF/unit data.
- **`src/components/layout/Sidebar.tsx`** — a "Concept Pricing" nav link
  (`Calculator` icon) in the Portal Nodes group, between Rate Card and Catalog.
- **`src/lib/actuals/index.ts`** — exports the conceptPricing surface +
  `StrengthScorable`.
- **`src/lib/__tests__/actualsConceptPricing.test.ts`** (NEW, +17) — division parse
  (Procore token, not CSI; blank/dash-less), the code/division builders (zero/
  missing-metric guard, $/SF math, negatives, rollup sum, CO-churn recompute, no
  cross-job blend, net-zero drop), aggregation (sector split, median, hasSf/hasUnit,
  strength tier carry), **a $/SF-spread test proving the value-swap** (equal dollars
  at unequal SF → wide $/SF spread the dollars-only view would miss), and a
  **fixture-grounded** tie-out: per-division $/SF over the real `templates/` export
  equals the engine's per-division normalized sum ÷ a synthetic SF.
- **`src/lib/__tests__/actualsPricingPool.test.ts`** — `snap()` / `obs()` helpers
  default the two new metric fields (no behavior change; Phase-6 suite still 13).

## Non-obvious discoveries / decisions (build Phase 8 to fit these)
1. **Division grouping is the Procore tier-1 token, raw — never zero-padded or
   CSI-normalized.** `parseProcoreDivision("1-10320.000").key === "1"` (not `"01"`).
   If Phase 8 ever groups variance by division, reuse `parseProcoreDivision`, NOT
   `getDivisionCode`.
2. **The strength value-swap is the reusable pattern.** `scoreActualStrength` now
   takes `StrengthScorable` (`Pick<ActualCostObservation, "normalizedActual" |
   "coAdjustmentShare" | "finalizedAt">`). To score a group on a *derived* value
   (here $/metric), map the group's observations with that value in the
   `normalizedActual` slot. Phase 8's variance KPIs can score on a variance ratio
   the same way if they want a confidence badge.
3. **One read feeds both forward-looking surfaces.** `getActualCostHistory` (FINAL-
   only, EFFECTIVE-normalized) now carries project metrics and serves BOTH `/rates`
   and `/concept-pricing`. **Phase 8 must NOT use it** — the variance/KPI dashboard
   reads **ALL** snapshots (not just FINAL) and **never** the pricing pool (plan
   Phase 8 + the "two consumers" split). It needs a NEW reader.
4. **Parametric benchmarks are sector-specific, never blended across sectors.** The
   view filters to one sector; there is intentionally no all-sector pooled $/SF
   (mixing healthcare and multifamily $/SF is misleading). Phase 8 variance is
   per-project so this doesn't constrain it, but keep the same honesty.
5. **The `/concept-pricing` view's only non-obvious bug class is the basis/sector
   coupling.** A two-effect guard keeps the selected sector valid when the user
   toggles SF↔unit (else the `<select>` strands on a sector with no data for the new
   basis). Any future filter coupling on that page needs the same care.
6. **Pool is empty until a snapshot is FINAL + the project has a metric.** $/SF
   needs `projects.square_footage > 0`; $/unit needs `unit_count > 0`. Imported
   past bids and projects that never captured a metric simply contribute no
   parametric datum (fail-soft, visible empty state). The math is proven by the
   fixture test regardless.

## Carry-over notes
1. **Pre-existing working-tree churn STILL present and untouched.** The
   `docs/handoffs|plans → archive/` reorg (unstaged deletions + untracked
   `archive/` copies) predates these sessions and was deliberately left OUT of the
   Phase-7 commits (only the Phase-7 files + this handoff were staged). `git status`
   still shows it, plus untracked `docs/plans/2026-06-23-fee-block-addressability.md`,
   `templates/Company_Bid_Comp_Template.xlsx`,
   `templates/change_event_types_reasons_scope.txt`. Leave them alone.
2. **Phase 8 is the LAST core phase** (Phase 9 — planned-buyout-vs-miss accuracy —
   is explicitly deferred / build-only-if-asked). After Phase 8 the workstream is a
   candidate to merge to `main` (explicit architect approval required — the one
   `main`-push prompt is the gate).

## Phase 8 — Active-project variance / KPI dashboard
Per the plan's Phase 8 scope. The SECOND consumer of the storage spine and the
mirror image of the pricing pool: it reads **ALL** snapshots for a project (not
just FINAL) and computes **budget-vs-EAC** and **snapshot-over-snapshot** variance,
plus a first executive KPI / indicator view. It computes from the Procore data
itself, so it works for projects that were **never estimated in this app**. It
**never reads or writes the pricing pool.**

- **Build on:** the Phase-2 storage spine (`budget_snapshots` /
  `budget_snapshot_actuals`) and `getBudgetSnapshotDetail` / the snapshot list
  readers in `db.ts`. You will need a NEW `db.ts` reader that pulls a project's
  **full snapshot history** (every snapshot, FINAL or not), ordered by capture
  time — distinct from `getActualCostHistory` (FINAL-only, pool-bound). The
  variance math belongs in a NEW pure module (e.g. `src/lib/actuals/variance.ts`),
  unit-tested like the pricing pool.
- **Key numbers:** `Original Budget Amount` (estimate baseline) vs
  `estimatedCostAtCompletion` (EAC) per code → budget-vs-EAC variance; and the
  delta of EAC (and committed / projected) between consecutive snapshots →
  snapshot-over-snapshot trend. `CodeActual` already carries `originalBudget` +
  `totalActual`; the change-event burden split is already available if you want a
  direct-vs-burden cut.
- **Surface:** likely a per-project view (mirror `src/app/projects/[projectId]/
  snapshots/` — the snapshot pages already exist) plus/or a portfolio roll-up. The
  plan allows splitting into **8a** (data/read + variance engine) and **8b**
  (dashboard UI) if it overruns one session.
- **Approval gates:** none anticipated (read-side; the spine columns exist). If the
  dashboard reveals a missing column (plan Risk "DDL shape churn"), that's a STOP
  DDL gate — update `supabase_schema.sql` first and get explicit approval.
- **Exit criteria:** the standard five (test · tsc · build · review · commit) +
  handoff. **One phase per fresh session — stop at the phase boundary.**

## Phase 8 kickoff prompt
> Implement **Phase 8 of the Actuals Cost-History & Project Budget Snapshots**
> workstream, per `docs/plans/2026-06-23-actuals-cost-history-and-budget-snapshots.md`
> and this Phase 8 handoff `docs/handoffs/2026-06-24-actuals-phase-8-kickoff.md`.
> Phase 8 is the **active-project variance / KPI dashboard** — the SECOND consumer
> of the storage spine. Read **ALL** snapshots for a project (not just FINAL) and
> compute **budget-vs-EAC** and **snapshot-over-snapshot** variance, plus a first
> executive KPI view. It computes from the Procore data itself (works for projects
> never estimated in-app) and **never reads or writes the pricing pool**
> (`getActualCostHistory` is FINAL-only and pool-bound — do NOT reuse it; add a NEW
> full-history reader in `db.ts`). Put the variance math in a NEW pure module
> (e.g. `src/lib/actuals/variance.ts`), unit-tested. Reuse `parseProcoreDivision`
> for any division grouping (NOT `getDivisionCode`) and the `StrengthScorable`
> value-swap if a KPI wants a confidence badge. Pure read — no DDL expected (the
> spine columns exist); if the dashboard needs a new column, STOP at the DDL gate
> (update `supabase_schema.sql` + explicit approval). If it overruns, split into 8a
> (read + engine) and 8b (dashboard UI). Take it through the Definition of Done,
> commit one phase to `actuals-cost-history` via `git commit -F`, push, write the
> Phase 9 (or 8b) handoff. Stop at the phase boundary.
