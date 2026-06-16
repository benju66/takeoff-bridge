# Template + Catalog Reconciliation — Phase 4 Kickoff

_Written 2026-06-12, at the close of Phase 3. Paste the prompt below into a
fresh session._

## Where Phase 3 left off

Phase 3 (bulk-correct the 67 STEP-4 cost-type mismatches) is **complete and
committed** on branch `template-catalog-reconciliation` as `b8b5cf0` + review
follow-up `75ebf3a` (upstream not set, nothing pushed; an unrelated
actuals-discovery docs commit `9b64e21` sits between Phase 2 and Phase 3).

What happened, end to end:
- **Disposition report** (`docs/plans/2026-06-12-catalog-type-disposition.md`,
  regenerate via `npm run type-disposition`): the 67 split into **65 mechanical
  type fixes** (38 S→M, 26 M→S, 1 S→E — Toilet Partitions is the *only*
  Equipment case) and **2 suspected wrong-code mis-maps**, architect-approved
  at the ⛔ gate.
- **65 rows SEEDED LIVE** in `catalog_cost_type_overrides` on
  `nefvkrhbbkiqnpeabyqz` via `npm run seed-type-overrides`
  (`scripts/seed-cost-type-overrides.js` requires `computeDisposition()` from
  the report script — seed = report by construction; gateway-semantics
  validation; idempotent upsert on `item_id`; provenance in `note`). Verified:
  38 M / 26 S / 1 E, the 2 mis-maps absent.
- **The 2-code advisory residual** (NOT touched — repointing moves dollars,
  out of scope; awaiting a separate architect repoint review):
  - `01-0400.002` Supervision (L) → `1-10000.000` General Conditions (M);
    Procore has dedicated 1-103xx/1-104xx Labor supervision codes.
  - `12-3530.002` Residential Casework - Installation (S) → `12-123530.000`
    Residential Casework (M); plausibly belongs on `6-62000.000` Finish
    Carpentry Installation (S).
- **Test re-pin** (`procore-type-reconciliation.test.ts`): RAW count stays 67
  (harvested JSON unchanged — documented as the pre-overlay pin); a NEW test
  derives the seed by the scripts' rule, primes it, and pins the advisory at
  exactly the 2 residuals (missing-base 8 untouched by relabels).
- **/cost-codes stale-memo fix** (the Phase 2 caveat was real): the page now
  snapshots `getCatalogItems()` into `catalogItems` STATE after each overlay
  prime lands; the advisory memo (and, post-review, every catalog read on the
  page) keys on that snapshot. **Render-verified on the live page** via the
  project e2e login flow: banner reads "2 type mismatches, 0 missing bases".
- Suite **782/70** green, tsc clean, lint = pre-existing scratch baseline only,
  goldens $0.00 (McKenna STEP-4 INV-1 + GC/Site-Ops STEP 2/3 ties + synthetic
  + CARE).

## Phase 4 prompt (paste verbatim)

> Implement **Phase 4** of the Template + Catalog Reconciliation plan at
> `docs/plans/2026-06-12-template-catalog-reconciliation.md` (branch
> `template-catalog-reconciliation`, Phase 3 done at `b8b5cf0`+`75ebf3a` — the
> 65 mechanical overrides are seeded live, the STEP-4 advisory residual is the
> 2 enumerated mis-maps). Scope: **retype the STEP-3 Site-Ops equipment codes
> + extend the type advisory to STEP-3** (code-only, no DDL, golden-gated).
> (1) In `src/lib/constants.ts`, retype the 02.G Site Equipment codes
> (`02-9405/9410/9415/9420/9425/9430.001`) and the `02-9400.007` summary row
> from `costType:"M"` → `"E"` — label-only. (2) Extend the type-mismatch
> advisory: compare the STEP-3 Site-Ops codes (`SITE_OPS_MANUAL_DEFAULTS`,
> `LINKED_DIVISION_ROWS`) against the Procore master list via
> `computeTypeReconciliation` or a sibling helper, surfaced on `/cost-codes`,
> so Site-Ops type drift is caught going forward; pin the new count (expect
> the 02.G retype to read E/Equipment with 0 residual). **Invoke the
> `supabase:supabase` skill before any DB-touching code.** ⛔ **Goldens**:
> confirm $0.00 on STEP-4 McKenna AND GC/Site-Ops STEP 2/3 before commit —
> the GC/Site-Ops golden is the proof the Site-Ops retype moved no dollars.
> Exit when `npm run test` is green (new STEP-3 pin), `npx tsc --noEmit`
> clean, lint adds no new findings, both goldens $0.00, committed via
> `git commit -F`, and a handoff is written via `/handoff`. **Stop at the
> Phase 4 boundary** — do not start Phase 5.

## Non-obvious context for Phase 4

- **A STEP-3 drift test already exists**:
  `src/__tests__/site-ops-procore-codes-drift.test.ts` pins that every
  `SITE_OPS_*` procoreCode exists in the master list (existence only, not
  type). The Phase 4 advisory adds the TYPE dimension — extend or sibling it,
  don't duplicate it.
- **Verify the 02.G mapped Procore bases really are Equipment-typed** in
  `docs/reference/Procore Cost Codes.xlsx` / `procore_cost_codes` before
  retyping — the plan asserts it; trust but pin it in the new test
  (AGENTS.md: no fabricated types).
- **/cost-codes advisory pattern (Phase 3)**: anything computed from primed
  overlays or async loads on that page must key on STATE (`catalogItems`
  snapshot / loaded lists), never on a bare module read inside a memo — the
  prime is an effect with no re-render. Follow the existing snapshot pattern
  for the STEP-3 advisory data.
- **STEP-3 cost types are hard-coded source** (`constants.ts`), not DB rows —
  the catalog_cost_type_overrides overlay does NOT reach them (it patches
  STEP-4 built-ins only). The retype is a plain code edit; in-app editing of
  Site-Ops types is explicitly out of scope (plan §Out of scope).
- **Cost type moves no dollars** (not read by `calculations.ts`/`exporter.ts`),
  but the GC/Site-Ops STEP 2/3 export DOES write Site-Ops rows — run the
  goldens anyway; that's the gate's point.
- **Phase 3 scripts are idempotent**: `npm run type-disposition` regenerates
  the report; `npm run seed-type-overrides` re-upserts the same 65 rows. If
  the architect later resolves the 2 mis-maps by repoint, the report's
  `SUSPECTED_MISMAPS` set and the test's `RESIDUAL_MISMAPS` pin both shrink —
  that is a separate, deliberately dollar-moving workstream, NOT Phase 4.
- **Worktree hygiene**: untracked `review.diff` and
  `docs/plans/2026-06-12-standalone-formula-template-discovery.md` belong to
  other sessions — leave them out of Phase 4 commits.
- Lint baseline: ~26 pre-existing errors in old scratch/forensic scripts
  (e.g. `useRateCardSnapshot.ts` setState-in-effect) — not a regression, do
  not chase.

## Exit criteria (repeat)

`npm run test` green (new STEP-3 type pin; STEP-4 pins 67-raw/2-seeded
unchanged) · `tsc` clean · lint = no new findings · both goldens $0.00 ·
STEP-3 advisory accurate (02.G reads E, 0 residual) · committed
(`git commit -F`) · `/handoff` written for Phase 5 (in-app built-in cost-type
editing on `/catalog`).
