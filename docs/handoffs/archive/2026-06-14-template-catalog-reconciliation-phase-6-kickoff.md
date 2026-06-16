# Template + Catalog Reconciliation — Phase 6 Kickoff

_Written 2026-06-14 at the close of Phase 5. Paste the prompt below into a fresh
session. Phase 6 is the FINAL phase and closes the workstream._

## Where Phase 5 left off

Phase 5 is **complete and committed** on branch `template-catalog-reconciliation`
as `f35731b` (unpushed; other-session docs commits interleave the history).

**What shipped (Phase 5 — in-app built-in cost-type editing on `/catalog`):**
- New `BuiltInCatalogCostTypeSection` + `BuiltInCostTypeRow` in
  `src/app/catalog/page.tsx`: a searchable table of all 227 harvested built-in
  STEP 4 codes (`ESTIMATE_ITEMS_MASTER`), each with an editable cost-type control
  (button → inline `<select>`, mirroring the additions editor; L/M/S/E, Equipment
  selectable). A re-typed code shows a "was M" mark with its harvested original.
- Writes go through `db.ts upsertCatalogCostTypeOverride` →
  `catalog_cost_type_overrides` (the Phase-2 overlay, already LIVE + seeded with
  the Phase-3 bulk fixes). A built-in edit is an OVERRIDE ROW ONLY — it never
  mints a `catalog_additions` row (the gateway rejects a non-built-in code).
- The edit re-primes the chokepoint (`primeCatalogCostTypeOverrides`) so the type
  shows immediately AND survives a reload (overlay re-fetched + primed at mount).
  Display is driven from the overrides **STATE**, not a live `getCatalogItems()`
  read in a memo — sidestepping the render-less-prime stale-memo trap.
- The new section now **owns** the override-overlay lifecycle for `/catalog`; the
  duplicate prime effect was removed from `Step4CatalogSection` (single owner).
- Self-review fix: a row's editor is disabled while ANY row is saving, serializing
  edits so two concurrent saves can't drop an override from the in-session overlay
  (lost update; both writes persist, but one would vanish locally until reload).
- Tests: `src/lib/__tests__/catalogCostTypeOverridesDb.test.ts` (9 tests) —
  persistence round-trip, reload survival (DB read → prime → `getCatalogItems()`
  reflects the corrected type), built-in edit writes ONLY to
  `catalog_cost_type_overrides` (never `catalog_additions`), + non-built-in /
  bad-type guards.

Gates met: suite **795/71** green, `tsc` clean, `eslint` clean on changed files
(the 1 `_a` mock-arg warning matches the accepted sibling idiom in
`catalogAdditionsDb.test.ts`), both goldens **$0.00** (McKenna STEP-4 INV-1 +
the GC/Site-Ops "STEP 2/3 section subtotal → STEP 4 linked row" ties, in
`src/__tests__/golden-mckenna.test.ts`; cost type is label-only by construction).
No DDL.

**Worktree hygiene:** the working tree carries OTHER-session changes — the
`docs/handoffs/2026-06-11-database-fidelity-*` files were moved to
`docs/handoffs/archive/` (deletes + untracked archive copies), plus a modified
`docs/plans/2026-06-12-standalone-formula-template-discovery.md` and untracked
`review.diff`/`scripts/tmp-dump-siteops-types.js`. Keep all of these OUT of the
Phase 6 commit — stage only the Phase 6 files explicitly.

## Phase 6 prompt (paste verbatim)

> Implement **Phase 6** (the FINAL phase) of the Template + Catalog Reconciliation
> plan at `docs/plans/2026-06-12-template-catalog-reconciliation.md` (branch
> `template-catalog-reconciliation`, Phase 5 done at `f35731b`). Scope: **template
> cleanup — remove the 7 dead codes from the estimate template's Importer Data
> Fields sheet so the drift check reads a ZERO delta at the source.** This is the
> most golden-sensitive change in the repo and is deliberately isolated to its own
> phase.
>
> 1. Edit the canonical template `templates/Company_Estimate_Template.xlsx`: remove
>    the 7 dead codes' rows from the **Importer Data Fields** sheet —
>    `1-10440.000`, `2-20000.000`, `2-29406.000`, `6-66119.000`, `8-87000.000`,
>    `11-110000.000`, `60-605000.000`.
> 2. Resolve the harvest crux: removing `2-20000.000` trips
>    `scripts/harvest-cost-codes.js`'s invalid-code gate, because the 8
>    linked-division rows resolve to `2-20000.000` via `STEPS_2_3_FALLBACK_CODES`.
>    **Exempt linked-division rows from that harvest gate** (mirror the runtime
>    `isLinkedDivisionRow` export-skip) — do NOT invent a successor base code.
> 3. Re-run `npm run sync-codes`: `src/lib/procore-valid-codes.json` drops 224→217;
>    `src/lib/estimate-catalog.json` is re-harvested.
> 4. Flip `procore-valid-codes-sync.test.ts`: the known 7-code delta assertion
>    becomes a **ZERO** delta (template/JSON == the 217) and the JSON===template
>    assertion still holds.
>
> **Invoke the `supabase:supabase` skill before any DB-touching code** (Phase 6
> likely touches NO DB — it is template + JSON + script + test — but invoke it if
> any DB code is in play). **⛔ Template-edit + goldens gate:** show me the planned
> Importer-sheet row removals, apply them, then confirm **$0.00** on STEP-4 McKenna
> AND GC/Site-Ops STEP 2/3 before commit. **⛔ Harvest-gate-exemption gate:**
> confirm the linked-division exemption approach with me before changing
> `harvest-cost-codes.js`. Exit when `npm run test` is green, `npx tsc --noEmit` is
> clean, lint adds no new findings, both goldens tie $0.00, the drift delta = 0
> (JSON === template at 217), the work is committed via `git commit -F` (stage only
> the Phase 6 files — keep the other-session worktree changes out), and a closure
> `/handoff` is written that **closes this workstream** and points at workstream #3
> (Actuals cost-history discovery, `docs/plans/2026-06-12-actuals-cost-history-discovery.md`)
> as the next plan. **This is the last phase — there is no Phase 7.**

## Non-obvious context for Phase 6

- **Read the plan's "Key architecture facts" and the Phase 6 section** (lines
  ~74–80 and ~183–204) — they spell out the harvest crux precisely. The 6 codes
  other than `2-20000.000` have ZERO catalog references and remove cleanly; only
  `2-20000.000` trips the gate.
- **The harvest gate** is the hard abort in `scripts/harvest-cost-codes.js` that
  fails if any catalog code resolves to a Procore code not in the Importer set.
  The fix is an EXEMPTION for linked-division rows, NOT a replacement base. Find
  the runtime `isLinkedDivisionRow` (export-skip) helper and mirror its logic in
  the harvest gate. Confirm the approach at the ⛔ gate before editing the script.
- **`procore-valid-codes-sync.test.ts`** currently pins the known 7-code delta
  (template/JSON 224 vs the 217 live). After the re-harvest it must assert ZERO
  delta + JSON===template. Do NOT hand-edit `procore-valid-codes.json` — let
  `npm run sync-codes` regenerate it (AGENTS.md: the JSON is a generated drift
  baseline, never hand-edited).
- **Goldens are the proof.** Removing template rows is the one change that COULD
  move dollars if a removed code were a live export target. It is not (these 7 are
  dead), but the ⛔ golden gate exists precisely to prove it: McKenna STEP-4 INV-1
  and the GC/Site-Ops STEP 2/3 linkage must both stay $0.00.
- **`11-110000.000`** is a display-only `procoreParentCode` for 7 div-11 rows
  (never an export target); its removal from the Importer sheet is incidental and
  needs no separate grouping-label work (plan §Out of scope).
- **Editing the .xlsx**: it is a binary workbook. Per CLAUDE.md's Excel rule,
  write cells in ascending column order and double-check column-letter parsing if
  you regenerate any sheet. Prefer a minimal, surgical row removal on the Importer
  Data Fields sheet over a full rewrite. There may be a helper script
  (`scripts/upload-template.js` is for upload, not edit) — inspect how the template
  is structured first; a small Node + a workbook lib (the repo uses ExcelJS) edit
  is the likely path.
- **Reactivation guard bug** (`procore-reactivation-guard-bug` in memory) is
  unrelated to Phase 6 — leave it.

## Exit criteria (repeat)

`npm run test` green (the sync test flipped to a ZERO delta) · `tsc` clean · lint
= no new findings · both goldens $0.00 · drift delta = 0 (JSON === template at 217)
· committed via `git commit -F` (only the Phase 6 files staged) · closure `/handoff`
written that closes the Template + Catalog Reconciliation workstream and sequences
workstream #3 (Actuals cost-history discovery) as the next plan.
