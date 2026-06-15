# Template + Catalog Reconciliation — Phase 3 Kickoff

_Written 2026-06-12, at the close of Phase 2. Paste the prompt below into a
fresh session._

## Where Phase 2 left off

Phase 2 (cost-type override overlay — mechanism only, inert) is **complete and
committed** on branch `template-catalog-reconciliation` as `a3780d6` (history:
plan `6c5c8e1` → Phase 1 `f6a6089` → an unrelated actuals-discovery docs commit
`d054747` → Phase 2 `a3780d6`; upstream not set, nothing pushed). The
architect approved the DDL gate and `catalog_cost_type_overrides` is **LIVE on
`nefvkrhbbkiqnpeabyqz`** (verified: RLS on, named CHECKs
`..._item_id_shape_check` / `..._cost_type_check`, SELECT/INSERT/UPDATE
policies, updated_at touch trigger, **0 rows**). Advisors gained exactly the 2
expected `rls_policy_always_true` WARNs (the new INSERT/UPDATE policies, same
precedent as `catalog_additions`).

What exists and works, end to end (all inert until rows are seeded):
- `db.ts`: `getCatalogCostTypeOverrides()` + `upsertCatalogCostTypeOverride()`
  (validates built-in membership + L/M/S/E; upsert on the `item_id` PK; an
  upsert that omits `note` preserves the stored note).
- `catalog.ts`: `primeCatalogCostTypeOverrides(rows)`; `getCatalogItems()`
  patches each matching BUILT-IN's `costType` (clones only actually-changed
  items; identity contract unit-pinned; non-built-in overrides inert).
- Primed fail-soft at all six overlay sites alongside
  `primeCatalogAdditionOverlays` (workspace mount, /projects/import, /catalog,
  /cost-codes, /rates, useDataHealth).
- Suite 781/70 green (67-mismatch pin unchanged, both goldens $0.00), tsc
  clean, lint = pre-existing scratch-script baseline only.

## Phase 3 prompt (paste verbatim)

> Implement **Phase 3** of the Template + Catalog Reconciliation plan at
> `docs/plans/2026-06-12-template-catalog-reconciliation.md` (branch
> `template-catalog-reconciliation`, Phase 2 done at `a3780d6` — the
> `catalog_cost_type_overrides` table is live and empty, the overlay mechanism
> fully wired). Scope: **bulk-correct the 67 STEP-4 cost-type mismatches**
> (data only, no DDL, golden-gated). (1) Build a disposition report (script +
> `docs/` output, twin of the Phase-1 reconciliation report): each of the 67
> with `internalCode`, mapped `procoreCode`, current estimate type, Procore's
> type, and the proposed correction — separating **mechanical type fixes**
> (overlay `cost_type` = Procore's type) from **suspected wrong-code mis-maps**
> (do NOT touch — enumerate for me). **⛔ Show me the report (counts + the
> split) and stop for sign-off before seeding anything.** (2) After sign-off,
> seed `catalog_cost_type_overrides` with the mechanical corrections only
> (provenance in `note`), via the `db.ts` gateway semantics. (3) Re-pin
> `procore-type-reconciliation.test.ts`: 67 → N, where N = the enumerated,
> explained mis-map residual; confirm the /cost-codes advisory actually
> renders the drop (the prime is an effect — verify the page recomputes after
> priming, and fix the recompute wiring if it reads a stale memo). **Invoke
> the `supabase:supabase` skill before any DB work.** ⛔ **Goldens**: confirm
> $0.00 on STEP-4 McKenna AND GC/Site-Ops before commit. Exit when
> `npm run test` is green (new pin N), `npx tsc --noEmit` clean, lint adds no
> new findings, both goldens $0.00, committed via `git commit -F`, and a
> handoff is written via `/handoff`. **Stop at the Phase 3 boundary** — do not
> start Phase 4.

## Non-obvious context for Phase 3

- **The 67 live in `computeTypeReconciliation`** (`src/lib/
  procoreTypeReconciliation.ts`), pinned in
  `src/__tests__/procore-type-reconciliation.test.ts`. It reads
  `getCatalogItems()` — so priming the seeded overlay in a test (via
  `primeCatalogCostTypeOverrides`) makes the count drop with NO advisory code
  change. Tests that prime must `resetCatalog()` (clears both overlays).
- **/cost-codes recompute caveat (carried from the Phase 2 review):** the page
  primes the overlay in a `useEffect` with no state change; if the advisory is
  computed in render/`useMemo` before the prime lands, the seeded drop may not
  display until a re-render. Phase 3 must verify on-page and, if stale, hold
  the loaded rows in state (mirroring how the page already holds `additions`).
- **Seeding path:** AGENTS.md routes all client DB access through `db.ts`
  (`upsertCatalogCostTypeOverride`, one call per code — it validates built-in
  membership + L/M/S/E). If seeding via SQL at the gate instead (agent-side
  INSERTs, like the Phase-1 procore seed), show the architect the exact rows
  first — same data either way; `note` should carry provenance (e.g.
  "Phase 3 bulk-fix: Procore types this Equipment").
- **Equipment exists everywhere it needs to** (Phase 1): the table CHECK,
  `ESTIMATE_TO_PROCORE_TYPE`, `/catalog` dropdowns, `db.ts` guard all accept
  'E'. Many of the 67 will become E-typed overrides.
- **Wrong-code mis-maps move dollars if repointed — explicitly OUT of scope**
  (plan §Out of scope). They are enumerated, not fixed; expect the architect
  may spin a follow-on repoint review.
- **Worktree hygiene:** uncommitted edits to
  `docs/plans/2026-06-12-actuals-cost-history-discovery.md` + untracked
  `review.diff` belong to a separate actuals session — leave them out of
  Phase 3 commits.
- Lint baseline: ~26 pre-existing errors in old scratch/forensic scripts —
  not a regression, do not chase.

## Exit criteria (repeat)

`npm run test` green (pin re-set 67→N, residual explained) · `tsc` clean ·
lint = no new findings · both goldens $0.00 · ⛔ disposition-report gate
honored before seeding · /cost-codes advisory verified to render the drop ·
committed (`git commit -F`) · `/handoff` written for Phase 4.
