# Handoff — Actuals Cost-History & Project Budget Snapshots, Phase 5 kickoff
_2026-06-24 · from the Phase 4 (staging-ground reconciliation) session_

## Where we are
**Phase 4 is COMPLETE, committed, and pushed.**
- Branch: `actuals-cost-history`, commit `47840bb` (off Phase 3 `8712c2b`).
- Plan of record: `docs/plans/2026-06-23-actuals-cost-history-and-budget-snapshots.md`
  (now committed — was untracked since Phase 2).
- Phase 4 implementation plan (approved): `.claude/plans/eventual-munching-aho.md`.
- Definition of Done satisfied: `npm run test` green (**110 files / 1340 tests**,
  +23 over Phase 3) · `npx tsc --noEmit` clean · `npm run build` green (the two new
  `/projects/[projectId]/snapshots` routes register) · `/code-review` (medium) run +
  its one finding resolved · one commit · branch pushed. **No DDL this phase.**

## What landed in code
- **`src/lib/actuals/reconcile.ts`** (NEW, pure — no DB/React) — the reconciliation
  engine, exported from the `actuals` barrel:
  - `buildReconciliationModel({ actuals, estimateLines, allocations, thresholds? })`
    — aggregates the frozen per code+type `CodeActual[]` up to the **cost-code grain**,
    groups estimate lines by their resolved Procore code, and buckets each code:
    `oneToOne` (1 line + actual) · `rollup` (≥2 lines + actual) · `unbacked` (actual,
    0 lines) · `estimateOnly` (lines, no actual). Computes value-share / variance /
    `isTargeted` flags, and **derives the disposition (verified/allocated/declined/
    pending + allocated sums + remaining + tiesOut) from the overlay** — frozen rows
    are NEVER mutated (recompute-on-load).
  - Targeting defaults (`DEFAULT_RECONCILIATION_THRESHOLDS`, all params):
    high-value = |normalized| ≥ **2%** of grand normalized; high-variance = |variance|
    ≥ **$5,000** AND |variance%| ≥ **10%**; `tieTolerance` = **$0.01**.
  - Pure overlay-write builders `buildVerifyAllocation` / `buildLineAllocation` /
    `buildDeclineAllocation` + `ALLOCATION_KIND` (`verify` / `allocation` / `declined`).
    Structural `EstimateLineLike` / `AllocationLike` stand-ins (mirrors `ingest.ts`'s
    `ProjectLike`) keep it DB-decoupled and avoid a type-only cycle with `@/types/db`.
- **`src/app/projects/[projectId]/snapshots/page.tsx`** (NEW) — per-project snapshot
  index (`getBudgetSnapshots` + `getProject`); newest-first, totals + FINAL/Draft badge,
  each links to its reconcile page; empty-state → `/projects/import-actuals`.
- **`src/app/projects/[projectId]/snapshots/[snapshotId]/page.tsx`** (NEW) — the
  **staging ground**. Loads `getBudgetSnapshotDetail` + estimate lines + primes the
  resolver (same `primeCostCodeResolver`/`primeCatalogAdditionOverlays` path as
  `useTakeoffWorkbook`). Sections: a **1:1** table (per-row Verify + bulk **Verify all**),
  a **rollups** section (targeted by default; **"Enter all"** toggle) with an expandable
  per-line split editor (live remaining / ties-out, **Save split** / **Decline** /
  **Clear**), and a collapsed **code-only / estimate-only** informational section.
  Writes go through `saveBudgetSnapshotAllocation`/`deleteBudgetSnapshotAllocation` with
  **"replace the code's overlay"** semantics, then refetch + rebuild. **FINAL → read-only.**
- **`src/app/projects/import-actuals/page.tsx`** — success state now leads with a
  **"Reconcile snapshot"** button → the new reconcile route.
- **`src/app/projects/[projectId]/page.tsx`** — an **"Actuals snapshots"** link (Database
  icon) in the workspace header (durable re-entry; no workspace logic touched).
- **`src/lib/__tests__/actualsReconcile.test.ts`** (NEW, +23) — buckets · targeting
  (share / pct+floor, AND gate) · disposition-from-overlay · ties-out tolerance ·
  builders · a **fixture-grounded** test (synthetic estimate lines over the real
  `templates/` normalized actuals → bucket + grand-total cross-checks).

## Non-obvious discoveries / decisions (build Phase 5+ to fit these)
1. **Reconciliation grain = Procore cost code, not code+type.** The estimate resolves
   to a *code* (`ProcessedTakeoffRow.procoreCode`, same string format as
   `CodeActual.costCode`); cost type is a per-line attribute. The snapshot's per-type
   rows are summed up to the code for bucketing, `perType` kept for display.
2. **Manual rollup entry splits the NORMALIZED actual** (the pricing-history number).
   The entered amount is stored in BOTH `allocatedTotal` and `allocatedNormalized`
   (the user attributes the in-scope cost of a line; the code-level total-vs-normalized
   split stays on the frozen snapshot). Ties-out validates Σ entries vs the code's
   normalized actual. Architect approved this in the Phase 4 plan.
   - **DECISION — do not re-litigate (architect-confirmed 2026-06-24):** split the
     NORMALIZED number, single entry per line. Rationale: the ONLY downstream consumer
     of these line-grain splits is forward pricing (P6/P7), which reads normalized;
     splitting raw EAC would let owner/out-of-scope/winter COs poison the pricing history,
     and attributing those down to a specific estimate line is fabrication the app must
     not do. For codes with no out-of-scope COs, raw == normalized anyway. The
     **code-level raw-vs-normalized** distinction (for the P8 variance/KPI dashboard) is
     served by the FROZEN snapshot rows, not this overlay — P8 never reads these splits.
   - **If per-estimate-line RAW-total variance is ever wanted** (only path: a future
     merge with the [[estimate-buyout-lens-plan]] estimate-side per-line tool — explicitly
     deferred, NOT on this 9-phase roadmap), it is a CHEAP additive change, not a redo:
     the overlay already has a distinct `allocated_total` column standing ready — add a
     second entry field and write the true EAC share there. Only the handful of rollup
     codes that BOTH had out-of-scope COs AND were manually split would need re-splitting.
3. **Overlay writes are "replace the code's overlay"** (delete the code's rows, insert
   the new set) — per-row, not atomic (Phase 2 added no multi-row overlay RPC). A
   mid-failure leaves a partial overlay; the UI surfaces the error and a retry fully
   re-writes it. Low-severity (overlay is recoverable, not export-authoritative). If a
   future phase wants atomicity, that's a `save_snapshot_allocations` RPC = **a DDL/RPC
   gate**.
4. **Estimate side prefers the SUBMITTED version, falls back to current saved lines.**
   Codes are re-resolved fresh via `resolveProcoreCode(itemId) || row.procoreCode`, so a
   remapped `cost_code_map` is reflected even on a frozen version (fallback covers misses
   / additions).
5. **`declined` is a zero-dollar code-level marker** (`estimateLineItemId=''`), excluded
   from the allocated sums; it keeps the "reviewed & excluded" state visible and tells
   Phase 6 the code was deliberately left at code-grain.
6. **Snapshots are still UN-PROMOTED.** Phase 4 wrote zero `is_final` changes.
   `finalizeBudgetSnapshot` / `withdrawFinalSnapshot` (db.ts, from Phase 2) are unused so
   far — Phase 5 is their first caller.

## Carry-over notes
1. **Pre-existing working-tree churn still present.** The `docs/handoffs|plans` →
   `archive/` reorg (unstaged deletions + untracked `archive/` copies) predates these
   sessions and was left untouched — NOT part of the actuals commits. `git status` shows
   it. Other untracked non-Phase-4 items also left alone: `docs/plans/2026-06-23-fee-block-
   addressability.md`, `templates/Company_Bid_Comp_Template.xlsx`,
   `templates/change_event_types_reasons_scope.txt`.
2. **No variance/KPI dashboard yet** (Phase 8) and **no pricing-pool read** (Phase 6).
   The reconcile overlay is written but nothing consumes it downstream yet — Phase 6 is
   its first reader (FINAL snapshots only).

## Phase 5 — Change-event review + promote to FINAL
Per the plan's Phase 5 scope. Surface the auto-read **Scope / Type / Reason** per change
event (the snapshot already froze `events: ClassifiedChangeEvent[]` + `diagnostics` —
read via `getBudgetSnapshotDetail`); let the human **verify/override** a classification
(persist overrides through the SAME `budget_snapshot_allocations` overlay — open-enum
`kind` e.g. `event_classification` + JSONB `detail` carrying the eventId + corrected
scope/type/reason, recomputed-on-load; **no DDL**). Show the **normalized-vs-total**
breakdown and the **Fee/GL burden split**. Then the explicit **"mark as FINAL/closeout"**
action via `finalizeBudgetSnapshot(projectId, snapshotId)` (mirrors
`submit_estimate_version`: freezes the snapshot + enforces one-FINAL-per-project; the
DB freeze-guard then makes the overlay read-only — Phase 4 already renders FINAL as
read-only). Offer `withdrawFinalSnapshot` to undo a wrong promotion. Promotion is the
doorway that makes the snapshot's normalized actuals eligible for the Phase 6 pricing pool.

- **Approval gates:** none (reuses the Phase 2 promotion machinery; classification
  overrides ride the existing overlay — no DDL). If you decide event overrides need their
  own column/table, STOP — that's a DDL gate.
- **Surface to reuse:** `getBudgetSnapshotDetail` (events + diagnostics + actuals +
  allocations), the `classify.ts` canonicalizers/`EventDisposition` for re-deriving a
  bucket from an overridden classification, `finalizeBudgetSnapshot` /
  `withdrawFinalSnapshot`, and the Phase 4 reconcile page as the sibling surface (add the
  change-event review as a section/tab on it, or a sibling route).
- **Exit criteria:** the standard five (test · tsc · build · review · commit) + handoff.
  **One phase per fresh session — stop at the phase boundary.**

## Phase 5 kickoff prompt
> Implement **Phase 5 of the Actuals Cost-History & Project Budget Snapshots** workstream,
> per `docs/plans/2026-06-23-actuals-cost-history-and-budget-snapshots.md` and this Phase 5
> handoff `docs/handoffs/2026-06-24-actuals-phase-5-kickoff.md`. Phase 5 is **change-event
> review + promote to FINAL.** Surface the frozen auto-read Scope/Type/Reason per change
> event (from `getBudgetSnapshotDetail`'s `events`/`diagnostics`); let the human
> verify/override a classification, persisting overrides through the SAME mutable
> `budget_snapshot_allocations` overlay (open-enum `kind` + JSONB `detail`, recomputed on
> load — NO DDL). Show the normalized-vs-total breakdown and the Fee/GL split. Then the
> explicit "mark as FINAL/closeout" action via `finalizeBudgetSnapshot` (one FINAL per
> project; the DB freeze-guard makes the overlay read-only, which the Phase 4 reconcile UI
> already honors), plus `withdrawFinalSnapshot` to undo. NO pricing-pool read yet (Phase 6).
> Reuse the Phase 4 reconcile page + the `actuals` classify machinery. Take it through the
> Definition of Done, commit one phase to `actuals-cost-history` via `git commit -F`, push,
> write the Phase 6 handoff. Stop at the phase boundary.
