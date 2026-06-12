# Kickoff — Catalog Manager, Phase 4 (Thin promotion: rate_card INSERT ⛔ + /rates enrichment)

> Paste the prompt at the bottom as the first message of a fresh session. One phase
> per fresh session (per `feedback-one-phase-per-fresh-session`). Plan of record (all
> forks locked): `docs/plans/catalog-manager.md` — re-read it; it is the authority.
> Phase 4 carries a ⛔ **DDL approval gate** (a new INSERT policy on `rate_card`).
> Do NOT chain into Phase 5+ (STEP 4 catalog chokepoint / additions table).

## Phase 3 BUILD STATUS — DONE (commit `3792e9e`, on local main, NOT pushed)

The `/catalog` admin page and the picker wiring are in. Exactly per plan, no scope
drift, no DDL. Suite **578 pass / 54 files** (unchanged — this was a UI phase with no
new lib tests); goldens McKenna + synthetic + CARE tie **$0.00**; `npx tsc --noEmit`
clean; `npm run build` clean (the `/catalog` route is generated).

### What shipped
- **New page `src/app/catalog/page.tsx`** twinning the `/cost-codes` idiom — a
  searchable table of custom defs (code, name, unit, Procore BLI, status badge,
  source) over `getCustomStep23LineDefs`, with KPI cards (total / active /
  retired-or-merged). All writes route through Phase 2's db.ts lifecycle surface:
  - inline **name + unit** edit → `updateCustomStep23LineDef` (blur-only commit via a
    cancel ref → single write; active codes only; tombstones render frozen);
  - **Procore BLI picker** over `PROCORE_VALID_CODES` (the scope-2 backfill UI; same
    Importer-list oracle + edit-on-demand `<select>` pattern as `/cost-codes`;
    "— none —" clears the backfill) → `updateCustomStep23LineDef`;
  - **retire** with a plain-language `window.confirm` → `retireCustomStep23LineDef`;
  - **merge** as an inline panel under the row: winner picked from
    `activeStep23Defs(entries)` (built-in + active custom, loser filtered out), with an
    advisory **"N imported bids currently resolve here"** count mined FAIL-SOFT from
    `getImportedStep23History` (outage → empty map, never blocks) → `mergeCustomStep23LineDef`.
    After a merge the page does a full `reload()` so chain-collapsed followers' targets
    re-render correctly.
- **Picker wiring (`src/app/projects/import/page.tsx`)**: the import-gate assign
  dropdown now sources from `activeStep23Defs(customDefs)` (new `step23AssignOptions`
  memo, passed to `Step23ReviewRow` as `assignOptions`), so retired/merged customs leave
  the picker. The built-in/custom optgroups are preserved by partitioning on
  `isBuiltInStep23Code`. The module const `STEP23_ASSIGN_OPTIONS` + the `STEP23_LINE_DEFS`
  import were removed. **`resolveStep23Line` + `suggestNextStep23Code` still receive the
  FULL `customDefs`** — old lines keep their labels and suffix counting still skips dead
  suffixes.
- **`ImportedStep23Panel` deliberately UNCHANGED** — it is read-only display and MUST
  keep resolving with the full defs (merged/retired must still label old lines). It has
  no picker, so there was nothing to switch. (The Phase 3 kickoff listed it; verified
  in-session it needs no change.)
- **Sidebar (`src/components/layout/Sidebar.tsx`)**: new "Catalog Manager" entry
  (`Boxes` icon, `/catalog`) alongside Cost Code Mapping and Company Rate Card.

### Carried notes / watch-fors for Phase 4
- Codes never move dollars held: the three goldens tie $0.00 after this phase. Phase 4
  introduces the FIRST write that touches `rate_card` (an opt-in INSERT) — its tests must
  re-prove the goldens are byte-identical after promote + adopt.
- The merge **before/after counts on /rates** (plan §Risks "Merge-to-built-in display")
  were not separately eyeballed this session — Phase 4 touches `/rates`, so verify there
  that a custom merged into a built-in files its history under the built-in sensibly.
- Pre-existing, NOT mine, leave alone: `M .claude/settings.json`,
  `M .claude/skills/handoff|plan-phases/SKILL.md`, untracked `docs/plans/database-fidelity.md`
  and `docs/{handoffs,plans}/archive/`.

## Phase 4 scope (from the plan — re-read `docs/plans/catalog-manager.md` §Phase 4; it is the authority)

Thin promotion: a promoted custom code gets a `rate_card` row + the existing audited
ADOPT path on `/rates`, **and nothing more** (no calculator visibility — architect-locked,
plan §Out-of-scope). One-way (no DELETE policy). Retiring a promoted code keeps its card
row, visibly flagged.

- ⛔ **DDL GATE — new INSERT policy on `rate_card`** (today UPDATE-only). Update
  `supabase_schema.sql` FIRST, show the exact SQL, **STOP for explicit architect
  sign-off**, then apply live to `nefvkrhbbkiqnpeabyqz`. Verify supabase advisors stay
  at baseline + only the expected new `rls_policy_*` twin (same kind already accepted on
  `cost_code_map` / `rate_card`). Carries the consolidated server-side-writes follow-up note.
- `src/lib/db.ts`: **`promoteCustomStep23LineDef`** — creates the code's `rate_card` row
  (source `'manual'`, unit price validated ≥ 0) exactly once; active codes only; clean
  "already promoted" message on the second call.
- `/rates` + `src/lib/rateCardEditor.ts`: card rows keyed by a custom code enrich their
  label/unit/section from the custom defs instead of the "Unmatched" bucket; the existing
  UOM-gated ADOPT then works on mined custom-code history with **zero new ADOPT code**.
  Retired-after-promotion rows render with the retired badge.
- `/catalog`: a **Promote** button (active codes only) with a plain-language confirm
  (future-projects-only, one-way, no calculator visibility). Likely shows promoted state
  so a code isn't promoted twice.

## Gates (unchanged)
Suite green per commit (578/54 baseline at this handoff); goldens tie $0.00;
`npx tsc --noEmit` clean; `/code-review` + `npm run build` clean (plan §Phase 4 exit);
multi-line commits via message FILE + `git commit -F` (per `feedback-commit-via-message-file`);
**NO push to origin** without architect say-so. ⛔ **ONE DDL gate** this phase — stop for
sign-off before the live `rate_card` INSERT policy.

## Phase 4 kickoff prompt

> Read `docs/plans/catalog-manager.md` (plan of record, forks locked) and
> `docs/handoffs/2026-06-11-catalog-manager-phase-4-kickoff.md` (Phase 3 build status),
> then execute **Phase 4 only**: thin promotion of a custom GC/Site-Ops code — the
> opt-in `rate_card` row + the existing audited ADOPT path on `/rates`, nothing more (no
> calculator visibility; one-way). ⛔ **STOP at the DDL gate**: write the new `rate_card`
> INSERT policy into `supabase_schema.sql` first, show the exact SQL, and get explicit
> architect sign-off BEFORE applying it live; verify advisors stay at baseline + the one
> expected policy twin. Then add `promoteCustomStep23LineDef` to `src/lib/db.ts` (active
> codes only, price ≥ 0, exactly once), enrich `/rates` + `src/lib/rateCardEditor.ts` so
> custom-code card rows show their label/unit/section and the UOM-gated ADOPT works on
> their mined history with no new ADOPT code (retired-after-promotion rows show the
> retired badge), and add a plain-language **Promote** button to `/catalog`. Prove no
> dollar moves: goldens McKenna + synthetic + CARE tie $0.00 after promote + adopt.
> Baseline: suite 578 pass / 54 files. Exit: suite + new promotion/ADOPT tests green,
> `npx tsc --noEmit` clean, `/code-review` + `npm run build` clean, committed via
> `git commit -F <tempfile>`, close with /handoff (do NOT push). Stop at the phase
> boundary; do not chain into Phase 5+.
