# Template + Catalog Reconciliation — Phase 2 Kickoff

_Written 2026-06-12, at the close of Phase 1. Paste the prompt below into a
fresh session._

## Where Phase 1 left off

Phase 1 (Equipment as the 4th estimate cost type, vocabulary only) is
**complete and committed** on branch `template-catalog-reconciliation` as
`f6a6089` (on top of the plan commit `6c5c8e1`; upstream not set, nothing
pushed). Live DDL was architect-approved and applied to `nefvkrhbbkiqnpeabyqz`:
`catalog_additions.cost_type` CHECK is now `('L','M','S','E')` (verified via
`pg_get_constraintdef`; advisors unchanged). The vocabulary sites that learned
'E': `ESTIMATE_TO_PROCORE_TYPE` (procoreTypeReconciliation.ts), `db.ts`
`CATALOG_ADDITION_COST_TYPES`/`normalizeAdditionCostType`, `/catalog`
dropdowns + inline validation, and `computeCostTypeBreakdown` (display-only
Equipment bucket). **No data uses 'E' yet** — the 67-mismatch / 8-missing-base
pins are unchanged, both goldens tie $0.00, suite 774/70, tsc clean, lint adds
zero findings vs baseline (a pre-existing ~26-error baseline lives in old
scratch/forensic scripts — not a regression, do not chase it).

## Phase 2 prompt (paste verbatim)

> Implement **Phase 2** of the Template + Catalog Reconciliation plan at
> `docs/plans/2026-06-12-template-catalog-reconciliation.md` (branch
> `template-catalog-reconciliation`, Phase 1 done at `f6a6089`). Scope: the
> cost-type override overlay **mechanism only — inert, no data seeded**.
> (1) New `catalog_cost_type_overrides` table: `item_id` PK (catalog-code
> shape), `cost_type` CHECK `('L','M','S','E')`, `created_at`/`updated_at`
> (+ optional `note`), RLS modeled on `catalog_additions`; update
> `supabase_schema.sql` FIRST. (2) `db.ts`: `getCatalogCostTypeOverrides()` +
> `upsertCatalogCostTypeOverride()` through the single gateway. (3) Compose at
> the catalog chokepoint (`src/lib/catalog.ts getCatalogItems()`): a
> `primeCatalogCostTypeOverrides` that patches a matching built-in's
> `costType` only (override wins for that one field; clone affected items so
> the identity contract — nothing primed ⇒ exact `ESTIMATE_ITEMS_MASTER`
> reference — still holds). Add it to the existing prime sites alongside
> `primeCatalogAdditionOverlays` (workspace, import, `/catalog`,
> `/cost-codes`, `/rates`). (4) Unit tests: empty overlay = identity (goldens
> $0.00, 67 unchanged); a primed override flips exactly one built-in's type
> and nothing else. **Invoke the `supabase:supabase` skill before any DB
> code. ⛔ Show the exact `CREATE TABLE` + RLS policies SQL and stop for my
> approval before applying.** Exit when `npm run test` is green (67 still
> pinned + new overlay tests), `npx tsc --noEmit` is clean, lint adds no new
> findings, both goldens tie $0.00, the work is committed via `git commit -F`,
> and a handoff is written via `/handoff`. **Stop at the Phase 2 boundary** —
> do not start Phase 3.

## Non-obvious context for Phase 2

- **Identity contract is unit-pinned in `catalog.test.ts`** — `getCatalogItems()`
  must return the exact `ESTIMATE_ITEMS_MASTER` reference when nothing is
  primed. The cost-type patch must clone only when an override actually primes
  (plan §Risks).
- **`primeCatalogAdditionOverlays`** (`src/lib/catalogAdditionOverlays.ts`) is
  the shared fail-soft prime helper pattern to mirror — 5 call sites.
- The live constraint name convention is the Postgres auto-name
  (e.g. `catalog_additions_cost_type_check`); prefer explicit names in new DDL.
- Advisor baseline: 8 documented `rls_policy_always_true` WARNs + leaked-
  password — expected; a new table modeled on `catalog_additions` adds the
  same expected WARNs (call them out at the gate, mirroring the
  `catalog_additions` precedent note in `supabase_schema.sql`).
- Untracked files from a separate actuals-discovery session may exist in the
  worktree (`docs/plans/2026-06-12-actuals-cost-history-discovery.md`,
  `docs/reference/sample-procore-budget-details.csv`, `review.diff`) — leave
  them out of Phase 2 commits.

## Exit criteria (repeat)

`npm run test` green (67 pinned + new overlay tests) · `tsc` clean · lint = no
new findings · both goldens $0.00 · ⛔ DDL gate honored · committed
(`git commit -F`) · `/handoff` written for Phase 3.
