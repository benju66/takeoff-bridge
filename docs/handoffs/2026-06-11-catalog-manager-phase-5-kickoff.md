# Kickoff — Catalog Manager, Phase 5 (STEP 4 catalog chokepoint — pure refactor, no DDL)

> Paste the prompt at the bottom as the first message of a fresh session. One phase
> per fresh session (per `feedback-one-phase-per-fresh-session`). Plan of record (all
> forks locked): `docs/plans/catalog-manager.md` — re-read it; it is the authority.
> Phase 5 has **NO approval gate** (pure identity refactor, no DDL, no live DB change).
> Do NOT chain into Phase 6 (catalog_additions table DDL) or Phase 7 (Add-code UI).

## Phase 4 BUILD STATUS — DONE (commit `79a4743`, on local main, NOT pushed)

Thin promotion shipped exactly per plan, no scope drift. Suite **591 pass / 55 files**
(was 578/54 — +8 promotion db tests, +5 rateCardEditor enrichment tests, +1 file);
goldens McKenna + synthetic + CARE tie **$0.00**; `npx tsc --noEmit` clean;
`npm run build` clean (all 11 routes generate).

### What shipped
- ⛔ **DDL gate cleared with architect sign-off.** New `rate_card_insert_policy`
  (`FOR INSERT TO authenticated WITH CHECK (true)`) written into `supabase_schema.sql`
  FIRST, then applied live to `nefvkrhbbkiqnpeabyqz`. Verified: `rate_card` now has
  SELECT/UPDATE/INSERT; security advisors = **6 WARN, 0 ERROR** — baseline (5) + the
  single expected `rls_policy_always_true` twin for the new INSERT policy, mirroring
  the cost_code_map / custom_step23_line_defs precedent. Carries the consolidated
  server-side-writes follow-up note.
- **`src/lib/db.ts` → `promoteCustomStep23LineDef(templateName, code, rate=0)`**:
  active codes only; rate validated finite ≥ 0; creates the `rate_card` row
  (`source='manual'`) **exactly once** (pre-check + `23505` race → same clean
  "already promoted" message). Returns the mapped `RateCardEntry`. Writes the
  company-DEFAULT layer only — never a calculator/estimate dollar.
- **`src/lib/rateCardEditor.ts`**: new `CUSTOM_SECTION_ID`
  ("Promoted Custom GC/Site-Ops Codes") inserted into `RATE_SECTION_ORDER` AFTER the
  GC/Site-Ops block and BEFORE the catalog divisions (so the existing "GC precedes
  catalog" invariant holds). `groupRateCardRows(entries, customDefs?)` now enriches a
  promoted custom-code card row with the def's label/unit/section (kind `gcSiteOps`)
  + carries lifecycle `status` — it leaves the "Unmatched" bucket. `RateLineDef`
  gained an optional `status?`. Built-in always wins a code collision (tested).
- **`/rates` (`src/app/rates/page.tsx`)**: hoisted `customDefs` into state, passes
  them to `groupRateCardRows`, extends search to custom label/unit, and renders a
  RETIRED/MERGED badge on a promoted-then-retired row. The existing UOM-gated ADOPT
  works on the mined custom-code history with **zero new ADOPT code** (the enriched
  unit gates it; `allowNegative` stays false for custom GC/Site-Ops via the static
  `RATE_LINE_DEFS` lookup miss).
- **`/catalog` (`src/app/catalog/page.tsx`)**: plain-language **Promote** button
  (active, not-yet-promoted codes) with a confirm (future-projects-only · one-way ·
  no calculator visibility) → `promoteCustomStep23LineDef`. Promoted state loaded
  FAIL-SOFT from `getRateCard`; a "Promoted ✓" pill replaces the button and prevents
  a double promote.
- **Tests**: `src/lib/__tests__/customStep23LineDefsPromoteDb.test.ts` (two-table mock:
  custom-def fetch + rate_card existence check via queued maybeSingle, then insert);
  enrichment cases added to `rateCardEditor.test.ts`.

### Carried notes / watch-fors for Phase 5
- **No-dollar-moves held** through Phase 4 — Phase 5 is a pure identity refactor of
  the STEP 4 catalog source, so the bar is the same: the three goldens stay byte-
  identical and `npm run build` is clean (this phase touches the workspace hot path).
- The merge before/after read on /rates (plan §Risks "Merge-to-built-in display") was
  reasoned-through in Phase 4 but not eyeballed live; not a Phase 5 concern.
- Pre-existing, NOT mine, leave alone (do not stage in the Phase 5 commit):
  `M .claude/settings.json`, `M .claude/skills/handoff|plan-phases/SKILL.md`,
  untracked `docs/plans/database-fidelity.md` and `docs/{handoffs,plans}/archive/`.

## Phase 5 scope (from the plan — re-read `docs/plans/catalog-manager.md` §Phase 5; it is the authority)

A pure refactor introducing the single runtime source for STEP 4 catalog items, so a
later phase can overlay in-app additions at one chokepoint. **No DDL, no behavior
change, no live DB change.** With nothing primed the chokepoint is byte-identical to
`ESTIMATE_ITEMS_MASTER` — this is an identity refactor.

- **New `src/lib/catalog.ts`**: the single runtime source for STEP 4 catalog items —
  built-ins from `estimate-catalog.json` (via `ESTIMATE_ITEMS_MASTER`) merged with
  primed additions (the `primeCostCodeResolver` / `primeRateCard` pattern; **built-in
  always wins a code collision**). With nothing primed it returns exactly
  `ESTIMATE_ITEMS_MASTER`.
- **Migrate the ~12 direct `ESTIMATE_ITEMS_MASTER` consumers** to the chokepoint:
  parser, importEstimate, similarity, assignCode, costCodeResolver, rateCardEditor,
  useTakeoffWorkbook, useCellEditing, EstimateTable, and the registry / cost-codes /
  import pages. Grep `ESTIMATE_ITEMS_MASTER` to find the live set; mechanical but
  wide — that width is why it is its own phase.
- **Tests**: chokepoint identity (no additions ⇒ byte-identical catalog), goldens tie.
- **Watch-for (plan §Risks)**: a consumer that reads `ESTIMATE_ITEMS_MASTER` at
  module-load time the prime pattern can't reach. Phase 5 finds out; the fallback is a
  fail-soft async refresh on the affected page (the established idiom). If the session
  overruns, the consumer migration splits cleanly: lib modules first, hooks/components
  second.

## Gates
NO DDL / NO approval gate this phase. Suite green per commit (**591/55 baseline** at
this handoff); goldens tie $0.00; `npx tsc --noEmit` clean; `/code-review` +
`npm run build` clean (plan §Phase 5 exit — build matters, this touches the hot path);
multi-line commit via message FILE + `git commit -F` (per
`feedback-commit-via-message-file`); **NO push to origin** without architect say-so.
Stop at the phase boundary; do not chain into Phase 6+.

## Phase 5 kickoff prompt

> Read `docs/plans/catalog-manager.md` (plan of record, forks locked) and
> `docs/handoffs/2026-06-11-catalog-manager-phase-5-kickoff.md` (Phase 4 build status),
> then execute **Phase 5 only**: the STEP 4 catalog chokepoint — a pure identity
> refactor, NO DDL and NO live DB change. Create `src/lib/catalog.ts` as the single
> runtime source for STEP 4 catalog items (built-ins from `ESTIMATE_ITEMS_MASTER`
> merged with primed additions via the `primeCostCodeResolver` / `primeRateCard`
> pattern; built-in always wins a code collision; nothing primed ⇒ byte-identical to
> `ESTIMATE_ITEMS_MASTER`). Migrate the ~12 direct `ESTIMATE_ITEMS_MASTER` consumers
> (grep for them: parser, importEstimate, similarity, assignCode, costCodeResolver,
> rateCardEditor, useTakeoffWorkbook, useCellEditing, EstimateTable, registry /
> cost-codes / import pages) to the chokepoint. Add a chokepoint-identity test (no
> additions ⇒ byte-identical catalog). Prove no dollar moves: goldens McKenna +
> synthetic + CARE tie $0.00. Baseline: suite 591 pass / 55 files. Exit: suite + the
> new identity test green, `npx tsc --noEmit` clean, `/code-review` + `npm run build`
> clean, committed via `git commit -F <tempfile>`, close with /handoff (do NOT push).
> Stop at the phase boundary; do not chain into Phase 6+.
