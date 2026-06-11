# Kickoff — Catalog Manager, Phase 2 (lifecycle DDL ⛔ + db.ts write surface)

> Paste the prompt at the bottom as the first message of a fresh session. Workflow per
> [[feedback-one-phase-per-fresh-session]]. Plan of record (all forks locked):
> `docs/plans/catalog-manager.md` — re-read it; it is the authority. Do NOT chain into
> Phase 3 or any later phase.

## Phase 1 BUILD STATUS — DONE (commit `27fceca`, on local main, NOT pushed)

The pure lifecycle layer is in, exactly per plan, no scope drift, inert until this
phase writes the new fields:

- **`src/types/db.ts`** — `CustomStep23LineDef` gained additive
  `status?: CatalogLifecycleStatus` and `mergedInto?: string | null` (imported as a
  type from `@/lib/catalogLifecycle`). **Absent === 'active'** — every existing row and
  every code path degrades unchanged.
- **`src/lib/catalogLifecycle.ts`** (NEW, pure — no DB, no I/O, no dollars):
  - `type CatalogLifecycleStatus = 'active' | 'retired' | 'merged'` and the minimal
    `LifecycleDef { code; status?; mergedInto? }` shape (both `Step23LineDef` and
    `CustomStep23LineDef` satisfy it structurally).
  - `statusOf` / `isActive` (absent → active).
  - **`transitionError(def, next, winner, isActiveWinner) → string | null`** — the
    legal-transition rule Phase 2's trigger + db.ts must MIRROR: only an active code may
    transition; legal targets are `retired`/`merged`; retired carries no target; merged
    needs a winner that is non-empty, not itself, and active. **`isActiveWinner(code)` is
    a caller-supplied predicate** — keep catalogLifecycle decoupled from the built-in code
    set; db.ts composes `isBuiltInStep23Code(code) || (a live custom row that is active)`.
  - **`redirectsToRepoint(defs, mergedCode) → string[]`** — the chain-collapse sweep:
    returns the codes currently merged into `mergedCode` so the caller re-points them to
    the new winner (keeps redirects one hop). `mergeCustomStep23LineDef` consumes this.
  - **`resolveMergeTarget(def, byCode, maxHops=16)`** — render-time follower with a hop
    guard (used by the resolver; unit-tested for cycles, missing winner, corrupt).
- **`src/lib/step23Normalization.ts`** — `Step23LineDef` gained the same optional
  `status?`/`mergedInto?`. `resolveStep23Line` now follows a merge redirect at EVERY
  return (assignment, deterministic pass-through, base/description) via `resolveMergeTarget`
  — a merged def shows its winner; a retired def still labels its own lines. New
  **`activeStep23Defs(extraDefs?)`** picker helper returns built-ins + only active customs,
  code-ordered, dropping retired/merged/malformed/built-in-shadowing rows. NOTE:
  `suggestNextStep23Code` and `step23Observations` needed NO change — they read the same
  overlay, so retired/merged suffixes are still counted (never reused) and merged history
  refiles under the winner automatically (proven by a test).
- **Tests** — +1 file `src/lib/__tests__/catalogLifecycle.test.ts` (14), +6 cases in
  `src/lib/__tests__/step23Normalization.test.ts` (incl. the no-dollar-moves proof: a
  merge moves the code an observation files under but the mined rate is byte-identical).
  Suite **560 pass / 53 files** (baseline was 540/52); goldens McKenna + synthetic + CARE
  tie $0.00; `npx tsc --noEmit` clean.

## Phase 2 scope (from the plan — re-read it first, it is the authority)

The table `custom_step23_line_defs` ALREADY EXISTS (`supabase_schema.sql` Table 14,
project `nefvkrhbbkiqnpeabyqz`): code PK with the `NN-NNNN.NNN` CHECK, label, unit,
nullable `procore_code`, `source`, `created_at`, `updated_at` (default `now()`, no touch
trigger yet), SELECT policy `USING(true)`, **INSERT-only** write policy (no UPDATE/DELETE
— minted codes are currently immutable from the browser). Phase 2 ADDS the lifecycle:

1. ⛔ **ALTER `custom_step23_line_defs`** — add `status TEXT NOT NULL DEFAULT 'active'
   CHECK (status IN ('active','retired','merged'))` and `merged_into TEXT` (nullable, shape
   CHECK `merged_into ~ '^\d{2}-\d{4}\.\d{3}$'` since a winner may be a built-in that
   exists only in constants.ts — **NO FK**). Add a **trigger** enforcing: code (PK) is
   immutable on UPDATE; only legal transitions (active→retired, active→merged; no
   un-retire/re-merge); `merged ⇔ merged_into` consistency (merged requires a non-self
   `merged_into`; non-merged requires NULL). Add an **`updated_at` touch trigger**. This
   is the FIRST trigger in the schema — the session MUST verify supabase advisors stay at
   baseline after applying (plan §Risks).
2. ⛔ **New UPDATE policy** on `custom_step23_line_defs` — THE deliberate widening of the
   by-design-immutable table (the trigger is what makes it safe). Carry the SAME
   consolidated "move writes server-side (service-role only)" follow-up note now shared by
   cost_code_map / rate_card / custom_step23_line_defs.
3. **`supabase_schema.sql` FIRST** — write the exact ALTER + trigger + function + policy
   SQL into the file, **show it, and STOP for explicit architect sign-off before any live
   change**. Invoke the `supabase:supabase` skill + run the
   `.agent/skills/database-guardrails/SKILL.md` checks before touching db code.
4. **`src/lib/db.ts`** write surface, all mirroring the trigger rules client-side for
   clean error messages (use Phase 1's `transitionError` + `redirectsToRepoint`):
   - `updateCustomStep23LineDef` — label/unit/procoreCode edits, **active codes only**;
     procoreCode validated against `PROCORE_VALID_CODES` (this IS the scope-2 BLI backfill
     write).
   - `retireCustomStep23LineDef`.
   - `mergeCustomStep23LineDef` — winner validation via `transitionError` (winner must be
     an active built-in or active custom), THEN the `redirectsToRepoint` chain-collapse
     sweep that re-points X's old followers to the new winner.
   - Update the read mapper / `COLUMNS` constant in `getCustomStep23LineDefs` to select +
     map `status` and `merged_into` (the resolver overlay now needs them).
   - db tests mirror `src/lib/__tests__/customStep23LineDefsDb.test.ts`.

## Gates (unchanged)
Suite green per commit (560/53 at this handoff); goldens tie $0.00; new db tests mirror
`customStep23LineDefsDb.test.ts`; `npx tsc --noEmit` clean; multi-line commits via message
FILE + `git commit -F` (per [[feedback-commit-via-message-file]]); **NO push to origin**
without architect say-so; schema change lands in `supabase_schema.sql` before any live DDL
and waits for the ⛔ gate; verify supabase advisors stay at baseline after the trigger.

## Phase 2 kickoff prompt

> Read `docs/plans/catalog-manager.md` (plan of record, forks locked) and
> `docs/handoffs/catalog-manager-phase-2-kickoff.md` (Phase 1 build status), then execute
> **Phase 2 only**: the lifecycle DDL + db.ts write surface for `custom_step23_line_defs`.
> ⛔ Update `supabase_schema.sql` FIRST with the exact ALTER (status + merged_into),
> transition-enforcing trigger, updated_at touch trigger, and new UPDATE policy; show the
> SQL and STOP for my approval before applying live (project `nefvkrhbbkiqnpeabyqz`); then
> verify advisors stay at baseline. Add `updateCustomStep23LineDef` (BLI backfill, active
> only, validated vs PROCORE_VALID_CODES), `retireCustomStep23LineDef`, and
> `mergeCustomStep23LineDef` (winner validation via Phase 1's `transitionError` +
> `redirectsToRepoint` chain-collapse) in `src/lib/db.ts`, all mirroring the trigger rules
> for clean errors; extend `getCustomStep23LineDefs` to select/map status + merged_into.
> Invoke the supabase skill before db code. Baseline: suite 560 pass / 53 files; goldens
> McKenna + synthetic + CARE tie $0.00. Exit: suite + goldens + new db tests green, `npx
> tsc --noEmit` clean, committed via `git commit -F <tempfile>`, close with /handoff (do
> NOT push). Stop at the phase boundary.
