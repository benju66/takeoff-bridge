# Handoff — Actuals Cost-History & Project Budget Snapshots, Phase 3 kickoff
_2026-06-24 · from the Phase 2 (storage spine + db.ts gateway) session_

## Where we are
**Phase 2 is COMPLETE, committed, and pushed.**
- Branch: `actuals-cost-history`, off Phase 1 (`7b0085a`).
- Plan of record: `docs/plans/2026-06-23-actuals-cost-history-and-budget-snapshots.md`.
- Definition of Done satisfied: ⛔ DDL applied live + advisors clean · `npm run test`
  green (108 files / 1304 tests) · `npx tsc --noEmit` clean · `npm run build` green ·
  `/code-review` (high) run + the one finding resolved · one commit · branch pushed.

### ⛔ DDL applied to the live DB (`nefvkrhbbkiqnpeabyqz`)
Three tables + two RPCs, all RLS-enabled, modeled on `estimate_versions`. The exact SQL
is in `supabase_schema.sql` (source of truth, Tables 23/24/25). Verified live:
`get_advisors(security)` shows **no new findings** (the only WARNs are pre-existing —
`rls_policy_always_true` on catalog/rate tables + the project's leaked-password setting).

- **`budget_snapshots`** — immutable header. Freeze-guard trigger lets only the
  promotion pair (`is_final`, `finalized_at`) change; partial-unique
  `idx_budget_snapshots_one_final` = THE one-FINAL-per-project invariant;
  `UNIQUE (project_id, snapshot_number)`; the four engine grand totals as NUMERIC
  columns + `events`/`diagnostics`/`metadata` JSONB.
- **`budget_snapshot_actuals`** — frozen per `code+costType` row, shaped 1:1 to the
  Phase 1 `CodeActual`. PK `(snapshot_id, budget_code)`. No UPDATE/DELETE policy
  (immutable; CASCADE on snapshot delete).
- **`budget_snapshot_allocations`** — the MUTABLE Phase-4 overlay (manual rollup
  allocation). Open-enum `kind` (free TEXT) + JSONB `detail` so Phase 4/5 grow the
  vocabulary with ZERO new DDL. Freeze-on-final guard (`bool_or` over OLD+NEW parent)
  makes it read-only once its snapshot is FINAL.
- **`save_budget_snapshot(p_snapshot, p_actuals)`** → atomic header+actuals insert,
  per-project `snapshot_number` = MAX+1 (mirrors `save_estimate`). RETURNS the header.
- **`finalize_budget_snapshot(p_project_id, p_snapshot_id)`** → one-FINAL promotion
  (mirrors `submit_estimate_version`): withdraws the prior FINAL, sets the target.

### What landed in code (no consumer UI — gateway only)
- `src/lib/actuals/snapshotPayload.ts` — pure `buildBudgetSnapshotPayload(normalized,
  { projectId, label?, sourceKind?, metadata? })` → `{ snapshot, actuals }` snake_case
  RPC payload. Engine numbers copied verbatim; exported from the `actuals` barrel.
- `src/types/db.ts` — `BudgetSnapshotMeta`, `BudgetSnapshotAllocation`,
  `BudgetSnapshotDetail` (reuse `CodeActual` / `ClassifiedChangeEvent` /
  `ActualsDiagnostics` from `@/lib/actuals` so the stored shape can't drift).
- `src/lib/db.ts` — gateway (mirrors the Estimate Versions section): `saveBudgetSnapshot`,
  `getBudgetSnapshots`, `getBudgetSnapshotDetail`, `finalizeBudgetSnapshot`,
  `withdrawFinalSnapshot`, `getBudgetSnapshotAllocations`, `saveBudgetSnapshotAllocation`
  (insert or update-by-id), `deleteBudgetSnapshotAllocation`. **Unwired** (precedent:
  `getProcoreCostCodes` landed unwired).
- `src/lib/__tests__/actualsSnapshotPayload.test.ts` — golden payload test (130 rows,
  162 events, the three pinned grand totals).

## Non-obvious discoveries / decisions (build Phase 3+ to fit these)
1. **Freeze model = `estimate_versions`, NOT a mutable draft.** The header + per-code
   actuals are frozen at creation; the ONLY mutable header state is the promotion pair.
   All human work products (Phase-4 manual allocations; Phase-5 verifications /
   classification overrides) live in the **mutable `budget_snapshot_allocations`
   overlay**, not on the frozen snapshot. The overlay's open-enum `kind` + JSONB
   `detail` is the deliberate room for Phase 4 AND Phase 5 to write with no new DDL.
2. **Derived values are a baseline, never trusted blindly.** The stored
   `normalized_actual` / grand totals are the engine's upload-time numbers. When Phase 5
   lets a human override an event's classification, recompute normalized from the frozen
   raw (`events` + `normalized_out_contributions`) + the overlay — do NOT mutate the
   frozen rows (codebase ethos: bindings / section-lines recompute on load).
3. **`finalize` mirrors `submit_estimate_version` exactly** — re-finalizing the already-
   FINAL snapshot is a clean no-op; finalizing a new one withdraws the prior FINAL. The
   freeze-guard confines both UPDATEs to the promotion pair, so it's safe.
4. **`save_budget_snapshot` sets `created_by = auth.uid()`**; the allocation gateway
   stamps `created_by` from the session on INSERT and preserves it on UPDATE (mirrors
   `saveEstimateBinding`).
5. **DDL permission gate is real at the action level.** The architect's *plan* approval
   did NOT lift the harness's live-DB DDL boundary — each `execute_sql` DDL call needed
   explicit per-action approval (and a review-driven CHANGE to the approved SQL needed
   re-approval). Budget a round-trip for any future DDL.

## Carry-over notes
1. **Actuals test fixtures — RESOLVED 2026-06-24 (architect-approved).** The six
   `templates/active_project_*.csv` golden exports the whole actuals suite reads are now
   **committed** (they were untracked, inherited from Phase 1 — `7b0085a` never added
   `templates/`). The actuals suite is reproducible on a fresh checkout / CI. Still
   untracked and left local by choice: `templates/change_event_types_reasons_scope.txt`
   (CE-taxonomy reference, not read by any test) and `templates/Company_Bid_Comp_Template.xlsx`
   (unrelated comp template). The plan-of-record `docs/plans/2026-06-23-actuals-...md` is
   also still untracked — commit it whenever convenient.
2. **Unrelated working-tree churn** (a `docs/handoffs|plans` → `archive/` reorg) was
   present before this session and left untouched — not part of the actuals commits.

## Phase 3 — Ingestion UI: upload + project match + save snapshot
Per the plan's Phase 3 scope. A new route (mirror `src/app/projects/import/`): upload the
Budget Detail (+ change-event exports), user picks the target project (auto-suggest from
the embedded `25-117` token carried on the parsed `SubcontractorCommitmentRow`), preview
the parsed `NormalizedActuals`, and save as an **un-promoted** snapshot via
`db.ts/saveBudgetSnapshot`. Minimal end-to-end: upload → parse (`CsvActualsSource` +
`computeNormalizedActuals`) → store. **No reconciliation/promotion yet.**

- **Approval gates:** none (reuses the Phase 2 schema — no DDL).
- **Surface to reuse:** `CsvActualsSource` (from raw CSV strings) → `computeNormalizedActuals`
  → `saveBudgetSnapshot({ projectId, normalized, label?, sourceKind: 'csv', metadata })`.
  Surface `diagnostics` (unjoined / duplicates / unclassified) in the preview so nothing
  is silently dropped.
- **Exit criteria:** the standard five (test · tsc · build · review · commit) + handoff.
  **One phase per fresh session — stop at the phase boundary.**

## Phase 3 kickoff prompt
> Implement **Phase 3 of the Actuals Cost-History & Project Budget Snapshots** workstream,
> per `docs/plans/2026-06-23-actuals-cost-history-and-budget-snapshots.md` and the Phase 3
> handoff `docs/handoffs/2026-06-24-actuals-phase-3-kickoff.md`. Phase 3 is the **ingestion
> UI**: a new route (mirror `src/app/projects/import/`) to upload the Budget Detail +
> change-event CSV exports, pick the target project (auto-suggest from the embedded
> `25-117` token), preview the parsed `NormalizedActuals` incl. diagnostics, and save an
> **un-promoted** snapshot via `db.ts/saveBudgetSnapshot`. Reuse `CsvActualsSource` +
> `computeNormalizedActuals` (Phase 1) and the Phase 2 gateway; NO reconciliation or
> promotion yet, NO DDL. Take it through the Definition of Done, commit one phase to
> `actuals-cost-history`, push, write the Phase 4 handoff. Stop at the phase boundary.
