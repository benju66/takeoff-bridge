# Handoff — Actuals Cost-History & Project Budget Snapshots, Phase 6 kickoff
_2026-06-24 · from the Phase 5 (change-event review + promote to FINAL) session_

## Where we are
**Phase 5 is COMPLETE, committed, and pushed.**
- Branch: `actuals-cost-history` (off Phase 4 `47840bb`).
- Plan of record: `docs/plans/2026-06-23-actuals-cost-history-and-budget-snapshots.md`.
- Phase 5 implementation plan (approved): `.claude/plans/agile-rolling-marshmallow.md`.
- Definition of Done satisfied: `npm run test` green (**111 files / 1358 tests**,
  +18 over Phase 4) · `npx tsc --noEmit` clean · `npm run build` green (the
  `/projects/[projectId]/snapshots/[snapshotId]` route still registers) ·
  `/code-review` (high) run + its one finding resolved · one commit · branch pushed.
  **No DDL this phase.**

## What landed in code
- **`src/lib/actuals/eventReview.ts`** (NEW, pure — no DB/React) — the change-event
  review + recompute engine, exported from the `actuals` barrel:
  - `EVENT_CLASSIFICATION_KIND = "event_classification"` — the overlay `kind` for a
    human classification correction (open-enum; **no DDL**, rides the Phase-2
    `budget_snapshot_allocations` table).
  - `parseEventOverride` / `collectEventOverrides` / `buildEventOverrideAllocation`
    — read/write a correction off the overlay. An override is an EVENT-level row
    (`budgetCode = ""`, `estimateLineItemId = ""`, `$0`) whose `detail` carries
    `{ eventId, scope, type, reason, note? }`. Stored scope/type/reason are
    re-canonicalized on read (`canonicalize*` from `classify.ts`).
  - `resolveEffectiveDisposition(event, override?)` — frozen auto-read passes
    through; an override is re-run through the SAME `classifyChangeEvent` the
    auto-read used, then the SAME net-zero internal-reclass refinement `normalize.ts`
    applies (using the event's frozen `netLatestCost`). Nothing fabricated.
  - `applyEventClassificationOverrides({ actuals, events, overrides })` — the
    **delta-based, idempotent** recompute. Starts from each code's frozen
    `normalizedActual`; for every **non-duplicate** event whose EFFECTIVE
    `isNormalizedOut` differs from frozen, computes that event's per-grain
    contribution exactly the way `normalize.ts` does (`event.lines` → skip
    blank/zero → `buildGrainKey` → `round2(latestCost)`) and **adds it back**
    (out→kept) or **subtracts it** (kept→out). Returns `effectiveActuals`
    (deep copies; frozen rows never mutated), `effectiveEvents` (+ effective
    disposition + `isOverridden`), and the grand breakdown (`grandTotalActual`,
    `baseGrandNormalizedActual`, `grandNormalizedActual`, `normalizedDelta`,
    `burdenTotalActual`/`directTotalActual`/`feeTotalActual`/`glTotalActual`).
- **`src/app/projects/[projectId]/snapshots/[snapshotId]/page.tsx`** — the Phase-4
  reconcile page, extended in place:
  - Collects event overrides from the overlay, runs `applyEventClassificationOverrides`,
    and feeds `effective.effectiveActuals` (NOT the frozen `detail.actuals`) into the
    existing `buildReconciliationModel` — so rollup splits + the summary already
    reflect any correction.
  - A **"Normalized vs total"** breakdown card (EAC total, normalized + override
    delta, Direct, Burden with the **Fee / GL** split).
  - A **"Change-event review"** section: per-event auto-read Scope/Type/Reason, the
    derived bucket, **kept vs normalized-out**, net cost, duplicate/overridden/flagged
    badges; an inline override editor (3 selects → Save / Reset / Cancel) with
    **"replace this event's override"** write semantics. Diagnostics surface here,
    unclassified events prompted first; a "Show all" toggle reveals the kept
    original-budget events + duplicates.
  - A **"Promotion / closeout"** panel: **Mark as FINAL** (two-step inline confirm)
    → `finalizeBudgetSnapshot`, with an amber warning when another snapshot is already
    FINAL and when unclassified events remain; when FINAL, a **Withdraw FINAL**
    (inline confirm) → `withdrawFinalSnapshot`. After either, `getBudgetSnapshotDetail`
    + `getBudgetSnapshots` are refetched so the page flips read-only/editable.
  - All override + promotion controls honor the existing `locked`/`isFinal` gating
    (the DB freeze-guard is the real enforcement; the UI mirrors it).
- **`src/lib/__tests__/actualsEventReview.test.ts`** (NEW, +18) — disposition
  resolution (passthrough / re-derive / net-zero refinement) · recompute
  (idempotence, out→kept add-back, kept→out subtract, synthesize-missing-grain,
  duplicates & no-op overrides, Fee/GL/direct split) · overlay parse/build
  round-trip · a **fixture-grounded** suite (real exports → override a net-non-zero
  out event → grand normalized shifts by exactly what the ledger stripped → revert
  restores the baseline).

## Non-obvious discoveries / decisions (build Phase 6+ to fit these)
1. **⚠️ The pricing-relevant normalized number is the EFFECTIVE one, not the frozen
   one.** A FINAL snapshot's per-code normalized actual that Phase 6 should pool is
   **NOT** `CodeActual.normalizedActual` / `grandNormalizedActual` read straight off
   the frozen rows — it is the result of `applyEventClassificationOverrides(...)`
   over the snapshot's frozen actuals + events + its `event_classification` overlay
   rows. **Phase 6 MUST run that recompute** (the function is pure, in the `actuals`
   barrel) to honor the human's corrections. Reading the frozen actuals directly
   would silently ignore every classification override made in Phase 5.
2. **Event overrides ride the SAME overlay as the Phase-4 code-level rows, and the
   two never collide.** Code-level rows (`verify`/`allocation`/`declined`) carry a
   real `budgetCode`; event overrides carry `budgetCode = ""`. `buildReconciliationModel`
   groups allocations by `budgetCode` and only ever reads real codes, so the `""`
   group is invisible to it — the recompute is the only consumer of event rows.
3. **The recompute is delta-based for provable idempotence.** With zero overrides the
   effective numbers equal the frozen numbers to the cent (a kept event and an out
   event each contribute zero delta unless their disposition flips). This is why the
   page can always feed `effectiveActuals` into the reconcile model without changing
   Phase-4 behavior when nothing is overridden.
4. **Fee/GL/direct is a raw-EAC split, independent of overrides.** Overrides only move
   the NORMALIZED number; `totalActual` (EAC) is the budget-export authority and never
   changes. So `burden/direct/fee/gl` are constant across overrides — correct, and why
   the breakdown shows them from `totalActual`.
5. **`finalize` replaces a prior FINAL atomically** (the `finalize_budget_snapshot`
   RPC withdraws the old + sets the new in one tx, preserving the one-FINAL-per-project
   partial-unique index). `withdraw` is a project-scoped flag flip with no replacement.
   The page detects a competing FINAL via `getBudgetSnapshots` and warns before promoting.
6. **A kept→out override on a code with no budget EAC row synthesizes a zero-total
   `CodeActual`** (mirrors `normalize.ts` — dollars are never dropped). It then appears
   in the reconcile model as an `unbacked` code-only row with a negative normalized.
   Rare (a kept CO line on a code that never had a budget row), but it keeps the books
   balanced. Phase 6 should treat such synthetic codes as ordinary code-grain entries.

## Carry-over notes
1. **Pre-existing working-tree churn still present.** The `docs/handoffs|plans` →
   `archive/` reorg (unstaged deletions + untracked `archive/` copies) predates these
   sessions and was left untouched — NOT part of the Phase-5 commit. `git status`
   shows it. Other untracked non-Phase-5 items also left alone:
   `docs/plans/2026-06-23-fee-block-addressability.md`,
   `templates/Company_Bid_Comp_Template.xlsx`,
   `templates/change_event_types_reasons_scope.txt`.
2. **No pricing-pool read yet (Phase 6)** and **no variance/KPI dashboard yet (Phase
   8).** The reconcile overlay (Phase 4) + the event-classification overlay (Phase 5)
   are both written; Phase 6 is their first downstream READER, and it must read
   **FINAL snapshots only** and apply the recompute per note #1.

## Phase 6 — Actuals pricing pool → read pipeline + `/rates` + strength layer
Per the plan's Phase 6 scope. Build a NEW code-grain **dollars-per-code** actuals
aggregation (distinct from the unit-rate `PriceObservation` shape — actuals have no
UOM), reading only **FINAL** snapshots, tagged `actual` provenance and **never
blended** with as-bid history. Surface it alongside as-bid history on `/rates`. Add a
**strength/confidence** signal (actual-backed > estimate-only; sample size / coverage;
CO-cleanliness; recency; spread) extending the `historyTrust` philosophy.

- **Critical input contract:** for each FINAL snapshot, derive the per-code normalized
  via `applyEventClassificationOverrides` (frozen actuals + events + the snapshot's
  `event_classification` overlay rows) — see Non-obvious #1. Do NOT read
  `CodeActual.normalizedActual` directly.
- **Approval gates:** none anticipated (pure read; no DDL). If a read-perf index or a
  materialized aggregation is wanted, STOP — that's a DDL gate.
- **Surface to reuse:** `getBudgetSnapshots` (filter `isFinal`) + `getBudgetSnapshotDetail`
  per FINAL snapshot, `applyEventClassificationOverrides` + `collectEventOverrides`
  (the `actuals` barrel), the `/rates` page + its history panels, `historyTrust.ts`
  for the strength philosophy.
- **Exit criteria:** the standard five (test · tsc · build · review · commit) + handoff.
  **One phase per fresh session — stop at the phase boundary.**

## Phase 6 kickoff prompt
> Implement **Phase 6 of the Actuals Cost-History & Project Budget Snapshots**
> workstream, per `docs/plans/2026-06-23-actuals-cost-history-and-budget-snapshots.md`
> and this Phase 6 handoff `docs/handoffs/2026-06-24-actuals-phase-6-kickoff.md`.
> Phase 6 is the **actuals pricing pool → read pipeline + `/rates` surfacing + strength
> layer.** Build a NEW code-grain dollars-per-code aggregation that reads ONLY FINAL
> snapshots and, for each, derives the per-code normalized via
> `applyEventClassificationOverrides` (frozen actuals + events + the snapshot's
> `event_classification` overlay rows — NEVER the frozen `normalizedActual` directly).
> Tag it `actual` provenance, never blend it with as-bid history, and surface it
> alongside as-bid on `/rates`. Add a strength/confidence signal extending
> `historyTrust.ts` (actual-backed > estimate-only; sample size/coverage;
> CO-cleanliness; recency; spread). Pure read — no DDL (if a perf index/materialized
> aggregation is wanted, STOP for an approval gate). Take it through the Definition of
> Done, commit one phase to `actuals-cost-history` via `git commit -F`, push, write the
> Phase 7 handoff. Stop at the phase boundary.
