# Import Active Estimates + Unblock Export of Imports — Plan of Record
_2026-06-27 · status: PROPOSED_

## Goal
When this is done, the **Import Past Estimate** page offers a choice at upload time:
**"Past bid (frozen, for history)"** — today's behavior, unchanged — or **"Active estimate
(editable)"**. An estimate imported in *active* mode becomes a **fully editable, exportable
project**: its General Conditions / Site Operations (STEP 2/3) detail loads into the live
grids as **editable lump-sum lines** (not the read-only frozen panel), editing a line
re-rolls its division total into STEP 4 and the grand total, and the project **exports** to
both the company XLSX template and the Procore budget — tying out to **$0.00** against the
engine. Past-bid (frozen) imports keep working exactly as they do now, untouched, so the
cost-history / actuals workstreams that depend on stable historical records are unaffected.

This sidesteps the "G-2" wall (a hand-authored bid's STEP 2/3 totals can't be reverse-
engineered into the parametric staffing calculators) by **carrying the captured detail
forward as editable lump sums** — we never reconstruct staffing inputs, we just let the
captured lines *be* the editable source of truth.

## Out of scope / deferred
- **Promoting an existing frozen import to active** (a "Make editable" button on the project
  view) — import-time choice only for v1. Deferred fast-follow. _(Locked decision.)_
- **Generalizing app-born export to the section-line basis** — app-born projects keep their
  proven calculator-based STEP 2/3 export path. Active imports get a new section-line export
  path; the two coexist. Unifying them is a separate, later cleanup. _(Locked decision.)_
- **Re-parametrizing imported detail** — we do NOT map captured lines back onto staff
  roles / drivers so the calculators run them. That is the G-2 problem; out of scope forever
  for this plan.
- **Editing the captured detail's STRUCTURE beyond lump-sum lines** — active STEP 2/3 lines
  are editable lump sums (label / amount / Procore code / insert / delete), reusing the
  shipped GC/Site-Ops one-off + fee-line machinery. Converting a captured line into a live
  parametric staff-role line is not in scope.
- **No new export template tab** — active imports write into the existing STEP 2/3/4 sheets.

## Locked decisions (from architect, 2026-06-27)
- **Data model:** keep `is_imported` = "came from a file"; add a new
  `projects.import_mode TEXT NOT NULL DEFAULT 'frozen' CHECK (import_mode IN ('frozen','active'))`.
  Legacy imports default to `'frozen'` and behave exactly as today. _(Requires DDL — Phase 1.)_
- **Tie reconciliation:** when a section's captured detail does not sum to its section total,
  add ONE visible **"Unitemized balance"** lump line per section = `section total − Σ captured
  detail`, so the section ties on import, the gap is visible/editable, and edits flow to the
  total. (Omitted when the gap is zero.) Mirrors the fee-block "never drop a dollar" pattern.
- **Export basis:** a new section-line STEP 2/3 export path used for **active imports only**;
  app-born stays on the calculator path.
- **Promotion:** import-time choice only for v1; frozen→active promotion deferred.

## How the pieces map to today's code
- **Capture / synth already exists:** `synthesizeImportedSectionLines` (`src/lib/sectionLines/
  imported.ts`) already emits `lumpSum` GC/Site-Ops section lines from the frozen
  `imported_step23_lines` blob, with resolved codes/labels. Active mode **persists these as
  real editable section lines at import save** instead of leaving them to be re-synthesized
  read-only each load.
- **Linked totals:** today imported projects use `linkedTotalsFromRows` (the frozen STEP 4
  linked-row values) as fixed statics; app-born derive from the calculators. Active imports
  derive linked division totals by **summing the editable section lines per division** (with
  the Unitemized-balance line guaranteeing the sum equals the original subtotal on import).
- **Export wall:** `assertNotImported` (`exporter.ts:28`) blocks all imports because
  `writeStep23SheetDetail` / `buildStep23DetailLines` (`exporter.ts:~1301`) source STEP 2/3
  from `gcCalcResult`/`siteOpsCalcResult`. The Procore *rollup* already has an
  `importedLinkedGcSiteOpsLines` path. Active mode adds a section-line source for both the
  sheet detail and the rollup, then relaxes the wall for `import_mode='active'`.

## Phases

### Phase 1 — Data model: the `import_mode` flag (pipe + DDL only)
- **Scope:** Add `projects.import_mode` to `supabase_schema.sql` and the `Project` type
  (`src/types/db.ts`) + the `db.ts` row mappers (read `import_mode`, write it on save).
  Add tiny helpers — `isActiveImport(project)` / `isFrozenImport(project)` — as the single
  predicate the rest of the plan branches on (so no scattered `import_mode === 'active'`
  string checks). **No UI, no behavior change yet** — every existing project reads `'frozen'`,
  so all current behavior is byte-identical. Add a focused test that the mapper round-trips
  the column and defaults legacy rows to `'frozen'`.
- **Approval gates:** ⛔ **DDL** — invoke the `supabase:supabase` skill first; update
  `supabase_schema.sql` FIRST, then present the exact SQL (`ALTER TABLE projects ADD COLUMN
  import_mode TEXT NOT NULL DEFAULT 'frozen' CHECK (import_mode IN ('frozen','active'));`) and
  **STOP** for explicit approval before it touches the live DB.
- **Exit criteria:** `supabase_schema.sql` updated + approved + applied · mapper round-trip
  test green · `npm run test` green · `npx tsc --noEmit` clean · `npm run build` green ·
  `/code-review` resolved · committed via `git commit -F` to the workstream branch + pushed ·
  handoff written (`/handoff`).

### Phase 2 — Import-time mode toggle + persist active section lines
- **Scope:** Add the **"Past bid (frozen)" vs "Active estimate (editable)"** toggle to
  `src/app/projects/import/page.tsx` (default frozen — safe). On save in active mode:
  set `import_mode='active'`; build the editable STEP 2/3 section lines via
  `synthesizeImportedSectionLines` over the (corrections-applied) captured detail; append the
  per-section **Unitemized-balance** lump line (new pure helper in `importEstimate.ts`,
  `balanceImportedSections(...)`, computing `linkedSubtotal − Σ detail` per division, omitted
  when zero); persist them with the fee/markup lines via the existing
  `saveSectionLines(id, [...sectionLines, ...markupLines])` full-replace. Frozen mode still
  writes `imported_step23_lines` and **no** gc/site_ops section lines (unchanged). The tie-out
  gate is unaffected (the balance line makes Σ section lines = the subtotal the engine already
  used).
- **Approval gates:** none.
- **Exit criteria:** unit test — active-mode import produces section lines per division that
  sum to the original subtotal to the cent (incl. the balance line); frozen-mode import is
  byte-identical to today (no gc/site_ops section lines, blob written) · full Definition of Done.

### Phase 3 — Workspace: render active imports as editable STEP 2/3
- **Scope:** In `src/hooks/useProjectWorkspace.ts` + `src/app/projects/[projectId]/page.tsx`,
  branch on `isActiveImport`: load the persisted gc/site_ops section lines as the **editable**
  source (not the read-only `ImportedStep23Panel`), and derive `linkedDivisionTotals` by
  **summing the section lines per division** rather than from `linkedTotalsFromRows`. Active
  imports render the normal editable GC/Site-Ops grids (reusing the shipped one-off /
  section-line grid machinery — `useSectionLineGrid`, `OneOffAssignPopover`, command history)
  so insert / delete / edit / Procore-assign all work and re-roll the total. Frozen imports
  keep the read-only panel + frozen statics, untouched. Confirm a reopened active import still
  ties to the cent before any edit, and that an edit moves STEP 4 + the grand total coherently.
- **Approval gates:** none.
- **Exit criteria:** an active-imported project opens with editable STEP 2/3 grids, ties to
  the cent on load, and an edit to a GC line updates its division total + the grand total;
  frozen imports unchanged · full Definition of Done.

### Phase 4 — Unblock export for active imports
- **Scope:** Add a section-line STEP 2/3 source to `src/lib/exporter.ts`: a
  `sectionLinesToGcSiteOpsLines(...)` (parallel to `collectGcSiteOpsLines` /
  `importedLinkedGcSiteOpsLines`) feeding both the Procore rollup (`rollupGcSiteOps`) and the
  sheet-detail writer (`buildStep23DetailLines` / `writeStep23SheetDetail`, matched by code
  into the template's fixed STEP 2/3 rows — handle codes absent from the template the same way
  the fee block / unmapped lines are handled: skip-with-flag, never silent mis-route). Relax
  `assertNotImported` to allow `import_mode='active'` (frozen still blocked). Thread the active
  basis through `useExportHandlers` + `useTakeoffWorkbook` + the workspace export buttons.
  Unmapped active STEP 2/3 lines follow the existing export-readiness blocker rules.
- **Approval gates:** none (no new template tab). **Flag:** matching variable imported codes
  into the fixed-row STEP 2/3 template is the highest-risk piece — see Risks.
- **Exit criteria:** an active import exports the XLSX template + Procore budget; the STEP 2/3
  sheets carry the imported detail; unmapped lines are flagged not mis-routed; frozen imports
  still refuse export · full Definition of Done.

### Phase 5 — Tie-out goldens + end-to-end proof
- **Scope:** A CI-safe golden (extend `src/__tests__/fixtures/syntheticTemplate.ts` with an
  active-import fixture incl. a deliberate detail-vs-subtotal gap) proving: active import →
  editable section lines that tie → an export whose engine-vs-template delta is **$0.00** and
  whose Procore rollup equals the engine's GC/Site-Ops total. Add an edit-then-export golden
  (change one line → total moves → still ties). Confirm the frozen-import goldens and the
  app-born `export-integrity` goldens are byte-identical (regression). Check
  `git diff --stat templates/` before blaming new code (the "template fixture tests read the
  working copy" memory).
- **Approval gates:** none. After this phase the workstream is complete →
  **⛔ merge to `main` requires explicit architect approval** (the one main-push prompt is the
  gate, per CLAUDE.md Git Workflow).
- **Exit criteria:** active-import export golden delta **$0.00**; edit-then-export golden ties;
  frozen + app-born goldens unchanged · full Definition of Done · propose merge-to-`main`, stop.

## Risks & unknowns
- **Highest risk — STEP 2/3 sheet export (Phase 4).** The template's STEP 2/3 sheets are
  fixed-row, code-keyed. Imported lines may carry codes with no matching template row
  (unmappable / bare / custom codes, or the Unitemized-balance line). Phase 4 must decide how
  those render on the printout (skip-with-flag like unmapped fee lines, or reserve a spare
  block). The Procore rollup + grand-total tie do NOT depend on the sheet rows (the Budget
  Line Items sheet is authoritative), so a code missing a sheet row is a *printout* gap, not a
  tie-out failure — but it must be surfaced, never silent. Phase 4 finds out.
- **Reconciliation edge (Phase 2).** If a captured section has detail but a zero/blank
  subtotal cell (or vice-versa), `balanceImportedSections` must behave sanely (a balance line
  of the full subtotal, or none). Phase 2 pins this with tests.
- **Linked-total derivation switch (Phase 3).** Active imports change `linkedDivisionTotals`
  from frozen statics to a section-line sum. This must reproduce the original subtotal exactly
  on load (the balance line guarantees it) — verified before any edit. If a bid's STEP 4
  linked row value disagrees with its captured section subtotal, Phase 3 surfaces which is
  authoritative (the STEP 4 linked row is the import tie-out oracle, so it wins; the balance
  line absorbs the difference).
- **Editing depth (Phase 3).** Whether the existing section-line grid (`useSectionLineGrid`)
  cleanly hosts imported lump lines, or needs a small adapter, is confirmed in Phase 3 (the
  shapes match — both are `EstimateSectionLine` lumpSum rows).

## Phase 1 kickoff prompt
> Implement **Phase 1 of the Import Active Estimates plan**
> (`docs/plans/2026-06-27-import-active-estimates.md` — read it first). Scope is the **data-
> model flag only**: add `projects.import_mode` (`'frozen' | 'active'`, default `'frozen'`) to
> `supabase_schema.sql`, the `Project` type (`src/types/db.ts`), and the `db.ts` row mappers
> (read + write), plus tiny `isActiveImport(project)` / `isFrozenImport(project)` predicate
> helpers. **No UI, no behavior change** — every existing project reads `'frozen'`, so all
> current behavior stays byte-identical. Add a focused mapper round-trip test.
>
> This is DDL work: invoke the `supabase:supabase` skill FIRST, update `supabase_schema.sql`
> BEFORE touching the live DB, then present the exact SQL (`ALTER TABLE projects ADD COLUMN
> import_mode TEXT NOT NULL DEFAULT 'frozen' CHECK (import_mode IN ('frozen','active'));`) and
> **STOP for explicit approval** before applying it live. Do not apply un-approved DDL.
>
> Take the phase through the full Definition of Done (test green · `tsc --noEmit` clean ·
> `npm run build` green · `/code-review` resolved · commit via `git commit -F` to a NEW
> workstream branch off latest `main` named `import-active-estimates` + push). **Stop at the
> phase boundary** and write the Phase 2 handoff with the `/handoff` skill. Run only this one
> phase.
