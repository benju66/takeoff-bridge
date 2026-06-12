# Kickoff — Catalog Manager, Phase 3 (/catalog page: manage custom GC/Site-Ops codes)

> Paste the prompt at the bottom as the first message of a fresh session. One phase
> per fresh session (per `feedback-one-phase-per-fresh-session`). Plan of record (all
> forks locked): `docs/plans/catalog-manager.md` — re-read it; it is the authority.
> Do NOT chain into Phase 4+ (thin promotion / rate_card INSERT) or any later phase.

## Phase 2 BUILD STATUS — DONE (commit `ecd0388`, on local main, NOT pushed)

The lifecycle DDL + the db.ts write surface are in and live. Exactly per plan, no
scope drift. Suite **578 pass / 54 files** (baseline was 560/53; +18 lifecycle db
tests); goldens McKenna + synthetic + CARE tie $0.00; `npx tsc --noEmit` clean.

### DDL — applied live to `nefvkrhbbkiqnpeabyqz` and written to `supabase_schema.sql` first
- **ALTER `custom_step23_line_defs`**: `status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active','retired','merged'))` + `merged_into TEXT` (nullable,
  shape CHECK `^\d{2}-\d{4}\.\d{3}$`, **NO FK** — a winner may be a built-in that
  exists only in constants.ts) + a declarative `custom_step23_line_defs_merge_consistency`
  CHECK (merged ⇔ non-self merged_into; non-merged ⇒ NULL).
- **Lifecycle guard trigger** `custom_step23_line_defs_lifecycle_guard_trg` (BEFORE
  UPDATE) — mirrors Phase 1's `catalogLifecycle.transitionError`: code (PK) immutable;
  only active codes transition; only to retired/merged; merged⇔merged_into consistency;
  a `merged → merged` re-point (chain-collapse, status unchanged, new winner) is
  ALLOWED. Function uses `SET search_path = ''` → no `function_search_path_mutable`
  advisor.
- **`updated_at` touch trigger** `custom_step23_line_defs_touch_updated_at_trg` (BEFORE
  UPDATE; fires AFTER the guard by alphabetical name order). NOTE: `now()` is the
  TRANSACTION timestamp, so `updated_at` only advances across separate transactions
  (the real browser case) — it will NOT change inside a single multi-statement txn.
- **UPDATE policy** `custom_step23_line_defs_update_policy` (`USING/WITH CHECK (true)`)
  — THE deliberate widening of the by-design-immutable table; the guard trigger is what
  makes it safe. No DELETE policy (retire/merge are tombstones).
- **Advisors verified**: 4 baseline WARN + exactly one expected
  `rls_policy_always_true` twin for the new UPDATE policy (same kind already accepted on
  `cost_code_map` / `rate_card`). No other new lints. Trigger rules smoke-tested live
  (immutability, every transition, consistency, chain-collapse, updated_at touch) then
  the temp rows were deleted.

### db.ts write surface (`src/lib/db.ts`) — all MIRROR the trigger client-side for clean errors
- `getCustomStep23LineDefs` / `mapCustomStep23LineDefRow` / `CUSTOM_STEP23_LINE_DEF_COLUMNS`
  now **select + map `status` + `merged_into`** (mapped as `status` defaulting to
  `'active'`, `mergedInto` defaulting to `null`).
- **`updateCustomStep23LineDef({ code, label?, unit?, procoreCode? })`** — active-only,
  **partial** (only supplied fields change); `procoreCode` validated against
  `PROCORE_VALID_CODES` (`isValidProcoreCode`), `''`/null clears it. This IS the scope-2
  BLI backfill write. Throws on not-found / non-active / empty-name / invalid-Procore /
  empty-patch BEFORE writing.
- **`retireCustomStep23LineDef(code)`** — active → retired (`transitionError`-gated).
- **`mergeCustomStep23LineDef(code, winner)`** — winner validation via `transitionError`
  + an `isActiveWinner` predicate composed as `isBuiltInStep23Code(c) || (a live active
  custom row)`; then the `redirectsToRepoint` chain-collapse sweep re-points the loser's
  existing followers onto the winner (`.update({ merged_into }).in("code", followers)`),
  keeping redirects one hop.
- Private helper `fetchCustomStep23LineDef(code)` (lifecycle-aware single read) backs the
  active-only checks.
- Tests: existing `customStep23LineDefsDb.test.ts` updated for the new columns/mapping;
  new `customStep23LineDefsLifecycleDb.test.ts` (18 cases) covers update/retire/merge incl.
  chain-collapse, built-in vs custom winners, and every rejection path.

### Phase 1 recap (commit `27fceca`) — the pure layer Phase 3's UI reads
- `src/lib/catalogLifecycle.ts`: `transitionError`, `redirectsToRepoint`,
  `resolveMergeTarget`, `statusOf`, `isActive`, type `CatalogLifecycleStatus`.
- `src/lib/step23Normalization.ts`: `resolveStep23Line` follows merge redirects;
  **`activeStep23Defs(extraDefs?)`** returns built-ins + only ACTIVE customs, code-ordered
  (drops retired/merged/malformed/built-in-shadowing) — this is the picker source Phase 3
  must switch consumers onto.

## Phase 3 scope (from the plan — re-read `docs/plans/catalog-manager.md` §Phase 3; it is the authority)

UI + wiring over Phase 2's write surface. **No DDL, no approval gates.**
- **New admin page `src/app/catalog/page.tsx`** twinning the `/cost-codes` idiom: a table
  of custom defs (code, name, unit, Procore BLI, status badge, source), with —
  - inline edit of **name** + **unit** → `updateCustomStep23LineDef`;
  - the **Procore BLI picker** over `PROCORE_VALID_CODES` (the scope-2 backfill UI; reuse
    the `/cost-codes` mapping editor / `ExportOverrideModal` picker idiom) →
    `updateCustomStep23LineDef`;
  - **retire** with a plain-language confirm → `retireCustomStep23LineDef`;
  - a **merge** flow: pick the winner from **active defs (built-in + custom)** via
    `activeStep23Defs`, with an advisory "N imported bids currently resolve here" count
    mined from the existing history fetch (the `/rates` STEP 2/3 history source) →
    `mergeCustomStep23LineDef`.
- **Switch existing pickers to `activeStep23Defs`** so retired/merged codes stop being
  offered while old lines keep rendering their labels: the import-gate assign dropdown +
  mint form (`src/app/projects/import/page.tsx`) and `ImportedStep23Panel`
  (`src/components/workspace/ImportedStep23Panel.tsx`). Verify each currently builds its
  own built-ins+customs list and replace that with `activeStep23Defs(customDefs)`.
- **Sidebar/nav entry** alongside `/cost-codes` and `/rates` (find the nav component the
  other two register in).

## Watch-fors (plan §Risks + Phase 2 discoveries)
- **Merge-to-built-in display** (plan §Risks): after merging a custom into a built-in,
  `/rates` history for those lines files under the built-in and gains ADOPT — intended;
  the Phase 3 session should eyeball that the before/after counts read sensibly.
- The "N bids resolve here" count is **advisory only** — it must not block or alter any
  write, and mining it must stay fail-soft (an outage degrades to no count, never an error).
- Codes never move dollars: keep the goldens-tie assertion in mind, though this UI phase
  shouldn't touch the engine at all.

## Gates (unchanged)
Suite green per commit (578/54 at this handoff); goldens tie $0.00; `npx tsc --noEmit`
clean; `/code-review` + `npm run build` clean (plan §Phase 3 exit); multi-line commits via
message FILE + `git commit -F` (per `feedback-commit-via-message-file`); **NO push to
origin** without architect say-so. No DDL this phase.

## Phase 3 kickoff prompt

> Read `docs/plans/catalog-manager.md` (plan of record, forks locked) and
> `docs/handoffs/catalog-manager-phase-3-kickoff.md` (Phase 2 build status), then execute
> **Phase 3 only**: the `/catalog` admin page to manage custom GC/Site-Ops codes (UI +
> picker wiring over Phase 2's db.ts write surface — NO DDL, no chaining into Phase 4+).
> Build `src/app/catalog/page.tsx` twinning the `/cost-codes` idiom: a table of custom
> defs (code, name, unit, Procore BLI, status badge, source) with inline name/unit edit
> and the `PROCORE_VALID_CODES` BLI picker (→ `updateCustomStep23LineDef`), retire-with-
> confirm (→ `retireCustomStep23LineDef`), and a merge flow picking the winner from
> `activeStep23Defs` (built-in + active custom) with an advisory "N imported bids resolve
> here" count mined fail-soft from the existing STEP 2/3 history fetch (→
> `mergeCustomStep23LineDef`). Switch the import-gate assign dropdown + mint form
> (`src/app/projects/import/page.tsx`) and `ImportedStep23Panel` to `activeStep23Defs` so
> retired/merged codes leave every picker while old lines keep their labels. Add the
> sidebar/nav entry alongside `/cost-codes` and `/rates`. Baseline: suite 578 pass / 54
> files; goldens McKenna + synthetic + CARE tie $0.00. Exit: suite + goldens green, `npx
> tsc --noEmit` clean, `/code-review` + `npm run build` clean, committed via `git commit
> -F <tempfile>`, close with /handoff (do NOT push). Stop at the phase boundary.
