# Actuals Cost-History & Project Budget Snapshots — Plan of Record
_2026-06-23 · status: PROPOSED_

## Goal
When this is done, the team can upload a project's **Procore Budget Detail export**
(plus its change-event exports) into Takeoff Bridge as an **immutable point-in-time
snapshot**. Two things then become possible, from the same uploaded data:

1. **A standalone cost-history asset.** When a user marks a snapshot **FINAL/closeout**,
   its per-code actuals enter a separate `actual` pricing pool — built at the Procore
   cost-code grain, **never written back onto the estimate page**. Estimators consult it
   *forward* (on `/rates` and concept-pricing views) when building the next job. Change
   orders are decomposed by Scope/Type/Reason so the history reflects *what our original
   bid scope actually cost*, not raw final cost.
2. **Active-project variance / KPI visibility.** Any number of in-progress snapshots can
   be uploaded over a project's life. Variance and KPI views read **all** snapshots
   (budget-vs-EAC, snapshot-over-snapshot) and **never touch the pricing pool** — giving
   PMs and executives a financial read on live jobs. This works even for projects that
   were never estimated in this app.

The estimate's finer-than-Procore granularity is recovered **only where a human chooses
to enter it**: where one estimate line maps 1:1 to a code, the actual auto-matches (user
verifies); where many lines roll into one code, manual entry is offered (optional, with an
"enter all" escape hatch); a declined rollup is simply **excluded** from history. Nothing
is ever fabricated.

## Out of scope / deferred
- **Procore API ingestion.** v1 is CSV-upload only. The parser is built behind a swappable
  interface so an API source can be added later without touching the store. (Locked: CSV-now,
  API-later.)
- **Back-writing actuals onto the estimate page.** Explicitly never done — the history is a
  decoupled asset the estimate *queries*, not an overwrite of estimate lines.
- **Planned-buyout-vs-miss accuracy scoring.** Separating an in-scope FP Contingency/Buyout
  draw that was *planned for* from a genuine *miss* needs the estimate's contingency budget
  as a yardstick. Deferred to the final phase (P9), and not required for pricing history.
- **Derived unit rates from actuals ($/UOM).** Actuals are dollars-only; deriving a unit rate
  borrows the estimate's (possibly-unconfirmed) quantity. Deferred beyond this plan.
- **The active-snapshot dashboard's detailed KPI design.** P8 builds the variance spine and a
  first dashboard; the specific executive KPI set is shaped in that phase, not pre-designed here.
- **Merging with the Estimate Buyout Lens.** The Buyout Lens (in-app, per-line, localStorage)
  is the estimate-side sibling of this Procore-sourced, server-side, code-grain tracking. They
  stay separate for now; the plan only notes the relationship so we don't build two competing
  variance surfaces.

## Locked decisions
- **Grain = Procore code + cost type** (e.g. `1-10320.000.Labor`) — the level both the export
  and the actuals report meet at; the resolution ceiling of any Procore-sourced history.
- **Two numbers per code:** `total actual` (raw EAC) and `normalized actual` = EAC − Owner-
  Contingency/Out-of-Scope − Allowance reconciles − net-zero Internal reclasses, **keeping all
  in-scope FP Contingency/Buyout draws.** Normalized feeds pricing history.
- **`actual` = Estimated Cost at Completion (EAC);** estimate baseline = `Original Budget Amount`.
- **Separate `actual` provenance pool**, never blended with as-bid history.
- **Snapshots are append-only, immutable** point-in-time captures (mirrors `estimate_snapshots`).
- **Promotion model:** a snapshot enters the pricing pool only when a user explicitly marks it
  FINAL (mirrors `estimate_versions` submit → "doorway into cost history"; one FINAL per project).
- **Staging ground:** 1:1 code → auto-match + verify; rolled-up code → manual entry, optional +
  targeted (prompt high-value/high-variance) with an "enter all" escape hatch; declined → excluded.
- **Change-event classification auto-read** from the summary export (Scope/Type/Reason); the human
  verifies/overrides in the staging UI. (The summary export carries all three fields.)
- **Project matching:** user picks the project at upload; auto-suggest later from the embedded
  project number (`25-117` / "Orchard Path III").
- **Strength/confidence layer** extends the `historyTrust.ts` philosophy (actual-backed >
  estimate-only; sample size & coverage; CO-cleanliness; recency; spread).
- **One plan, history-first sequencing**; the active-snapshot variance/KPI dashboard is a later
  phase on the same shared spine.

## Data realities this plan is built on (from the six sample exports)
- **Join keys:** change-event **detail** (`Event #`, per-code dollars) ↔ change-event **summary**
  (`#`, Scope/Type/Reason) join on the event id. Budget Detail joins to both by `Budget Code`.
- **Internal reclasses** (`INT-xxx`, Reason = *Internal*) are **net-zero** code shuffles and MUST
  be cancelled, or code-level history is garbage.
- **Change events carry their own Fee (`60-604000.000`) + GL insurance (`60-602020.000`) markup
  lines** — direct cost must be separated from burden/fee.
- **FP Contingency/Buyout goes both directions** — savings as well as adds (e.g. −$41K Project
  Insulation), so the pool captures full buyout variance.
- **Duplicate event rows exist** (events 97/98 identical) — the parser/dedup must tolerate them.
- **`projects.square_footage` and `projects.unit_count` already exist** → the parametric phase
  reuses them; no new metric-capture needed.

## Guardrails this plan must honor (AGENTS.md / CLAUDE.md)
- **All DB access through `src/lib/db.ts`** — no component/hook imports the Supabase client.
- **No AI autonomy over financials** — normalized actuals are a *deterministic* function of the
  human-verified classification; manual rollup actuals are *human-entered*. Nothing guessed.
- **Append-only training/snapshot tables** — no UPDATE/DELETE policy; immutability enforced by a
  freeze-guard trigger, not just policy (mirrors `estimate_versions`).
- **Schema source of truth** — every DDL updates `supabase_schema.sql` first, then stops for
  explicit approval before touching the live DB (`nefvkrhbbkiqnpeabyqz`).
- **One commit per phase**, message via `git commit -F <tempfile>`; branch per workstream; merge
  to `main` only at the end with explicit approval.

## Phases

### Phase 1 — Parser + normalization engine (pure; no DB, no UI)
- **Scope:** New pure modules (e.g. `src/lib/actuals/`): parse the six CSV shapes; join change-event
  detail+summary by event id; classify each event by Scope/Type/Reason into the normalization
  buckets; compute **total** and **normalized** actual per `code+costType`; net out Internal
  reclasses; split direct cost from Fee/GL burden; tolerate duplicate rows and negative (savings)
  values. Behind a swappable `ActualsSource` interface (CSV impl now; API later). Exhaustively
  unit-tested against the real files in `templates/`.
- **Approval gates:** none (pure code, no schema).
- **Exit criteria:** `npm run test` green (new parser/normalization tests, incl. golden totals off
  the sample exports) · `npx tsc --noEmit` clean · `npm run build` green · `/code-review` resolved ·
  committed · handoff written.

### Phase 2 — Storage spine (⛔ DDL) + db.ts gateway
- **Scope:** Design and add the core tables (all DDL in one phase so later phases are DDL-free):
  `budget_snapshots` (append-only, tenant-scoped via the projects join, immutable freeze-guard,
  `is_final` promotion flag + partial-unique "one FINAL per project" index — modeled on
  `estimate_versions`); `budget_snapshot_actuals` (per code+type: total, normalized, CO breakdown);
  storage for the **optional per-line manual allocation** that recovers rollup granularity. Add an
  atomic write RPC (mirrors `save_estimate`) and `db.ts` read/write methods. No consumer UI yet.
- **Approval gates:** ⛔ **DDL** — update `supabase_schema.sql`, present exact SQL, STOP for
  explicit approval before applying to the live DB. ⛔ run the `supabase:supabase` skill first.
- **Exit criteria:** schema file updated + approved + applied · advisors show no new findings ·
  `npm run test` green · `npx tsc --noEmit` clean · `npm run build` green · `/code-review` resolved ·
  committed · handoff written.

### Phase 3 — Ingestion UI: upload + project match + save snapshot
- **Scope:** A new route (mirrors `src/app/projects/import/`): upload the Budget Detail (+ change-event
  exports), user picks the target project (auto-suggest from any embedded project number), preview the
  parsed result, and save as an **un-promoted** snapshot via the P2 gateway. Minimal end-to-end:
  upload → parse → store. No reconciliation/promotion yet.
- **Approval gates:** none (reuses P2 schema).
- **Exit criteria:** the standard five (test · tsc · build · review · commit) + handoff.

### Phase 4 — Staging ground: estimate ↔ code reconciliation
- **Scope:** Reconstruct the project's estimate→code mapping (via `resolveProcoreCode` over the saved
  line items / submitted version); bucket every code as **1:1** (auto-verify) or **rolled-up**; offer
  **targeted** manual actual entry on high-value/high-variance rollups with an **"enter all"** toggle;
  a **declined** rollup is excluded. Persist verifications + manual allocations to the snapshot.
- **Approval gates:** none.
- **Exit criteria:** the standard five + handoff.

### Phase 5 — Change-event review + promote to FINAL
- **Scope:** Surface the auto-read Scope/Type/Reason per change event; let the human verify/override;
  show the normalized-vs-total breakdown and the Fee/GL split; then the explicit **"mark as FINAL/
  closeout"** action (mirrors `submit_estimate_version`: freeze + one-FINAL-per-project). Promotion is
  the doorway that makes the snapshot's normalized actuals eligible for the pricing pool.
- **Approval gates:** none (reuses P2 promotion machinery).
- **Exit criteria:** the standard five + handoff.

### Phase 6 — Actuals pricing pool → read pipeline + `/rates` + strength layer
- **Scope:** A NEW code-grain **dollars-per-code** actuals aggregation (distinct from the unit-rate
  `PriceObservation` shape — actuals have no UOM), reading only FINAL snapshots, tagged `actual`
  provenance and never blended with as-bid. Surface alongside as-bid history on `/rates`. Add a
  **strength/confidence** signal (actual-backed > estimate-only; sample size/coverage; CO-cleanliness;
  recency; spread) extending the `historyTrust` philosophy.
- **Approval gates:** none (pure read; no DDL).
- **Exit criteria:** the standard five + handoff.

### Phase 7 — Parametric concept pricing ($/SF, $/unit)
- **Scope:** Using existing `projects.square_footage` / `projects.unit_count`, compute per-code/
  division/sector parametric benchmarks from the actuals pool; a concept-pricing read + view for
  early/napkin-stage budgeting. Carries the strength signal from P6.
- **Approval gates:** none.
- **Exit criteria:** the standard five + handoff.

### Phase 8 — Active-project variance / KPI dashboard
- **Scope:** The second consumer of the spine: read **all** snapshots for a project (not just FINAL)
  → budget-vs-EAC and snapshot-over-snapshot variance, plus a first executive KPI/indicator view.
  Computes from the Procore data itself, so it works for projects never estimated in-app. Never reads
  or writes the pricing pool. (If this overruns, split into 8a data/read + 8b dashboard UI.)
- **Approval gates:** none.
- **Exit criteria:** the standard five + handoff.

### Phase 9 — (Deferred) Accuracy scoring: planned-buyout-vs-miss
- **Scope:** Compare in-scope FP Contingency/Buyout draws against the estimate's contingency budget;
  draws within budget = planned, the excess = miss. An accuracy lens separate from pricing history.
  Built only if/when the architect wants it.
- **Approval gates:** none anticipated (read-side).
- **Exit criteria:** the standard five + handoff.

## Risks & unknowns
- **Classification completeness (found in P1/P5).** Historical projects may have change events with
  blank Scope/Type/Reason. P1 must treat "unclassified" as an explicit bucket the human resolves in
  P5; it must never silently include/exclude.
- **Estimate→code mapping availability (found in P4).** Reconstructing 1:1-vs-rollup needs the
  project's saved line items / a submitted version. For imported past bids that are lump-sum, almost
  everything is "rollup" → manual or excluded. P4 must degrade gracefully when the estimate side is thin.
- **Project matching ambiguity (found in P3).** The Budget Detail itself has no project-id column.
  v1 leans on the user's pick; if that proves error-prone, the embedded `25-117` token in contract
  numbers becomes the auto-suggest source.
- **Manual-entry fatigue (found in P4/P6).** If too many rollups are prompted, users skip them and the
  richest data thins out. The "targeted prompts" heuristic (high-value/high-variance) is the mitigation;
  P6's strength layer must make thin/declined coverage visible rather than hidden.
- **Reconciliation to the cent (found in P1).** Σ(per-code totals) must tie to the export's grand total
  within tolerance; P1 ships a golden test off the sample files to catch parser/column drift.
- **DDL shape churn (found in P2).** If P4's manual-allocation needs or P8's dashboard reveal a missing
  column, that's a second DDL gate. P2 designs for both consumers up front to minimize this.

## Phase 1 kickoff prompt
> Implement **Phase 1 of the Actuals Cost-History & Project Budget Snapshots** workstream, per
> `docs/plans/2026-06-23-actuals-cost-history-and-budget-snapshots.md` (read that plan first —
> especially "Locked decisions", "Data realities", "Guardrails", and the Phase 1 scope).
>
> Phase 1 is the **pure parser + normalization engine only — no DB, no UI.** Build pure modules
> (suggest `src/lib/actuals/`) that: parse the six sample CSV exports in `templates/`; join the
> change-event **detail** and **summary** by event id; classify each event by Scope/Type/Reason;
> compute **total** and **normalized** actual per `code+costType` (normalized = EAC − Owner-
> Contingency/Out-of-Scope − Allowance reconciles − net-zero Internal reclasses, keeping in-scope
> FP Contingency/Buyout draws); net out `INT-xxx` Internal reclasses; split direct cost from Fee
> (`60-604000.000`) + GL (`60-602020.000`); tolerate duplicate rows and negative (savings) values.
> Put it behind a swappable `ActualsSource` interface (CSV impl now). Unit-test exhaustively against
> the real `templates/` files, including a **golden total** test (Σ per-code ties to the export grand
> total within tolerance).
>
> Honor the guardrails: pure/no-DB this phase, no financial fabrication, ascending-column discipline
> if any spreadsheet parsing touches column letters. Take it through the **Definition of Done**
> (CLAUDE.md): tests green · `npx tsc --noEmit` clean · `npm run build` green · `/code-review`
> resolved · ONE commit on a new workstream branch (`git commit -F`) · push the branch · write the
> Phase 2 handoff. **Stop at the phase boundary — do not start Phase 2.** This phase has no DDL and
> no approval gate.
