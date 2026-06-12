# Procore Cost Codes — Master-List Management — Plan of Record
_2026-06-12 · status: PROPOSED_

## Goal
When this is done, the company's Procore cost codes live in a managed database
table — code, **type** (Labor / Material / Subcontract / Equipment), and
description — instead of a hard-coded file. There is a new admin page where the
team can **import** the Procore export spreadsheet, **export** it back out, and
**view/search** all 217 codes in a table. The existing Cost Code Mapping page
(`/cost-codes`) validates against this managed list, is now **type-aware**, and
surfaces the places where an estimate code's type disagrees with Procore's. The
hard-coded JSON oracle is demoted from "source of truth" to a drift check.

This managed, type-aware Procore list is the foundation (the join key) for a
later, separate workstream that ties **actual final project costs** back to
estimate codes — but that workstream is out of scope here.

## Out of scope / deferred
- **Actuals / final-cost import.** No final-cost ingestion, no actual-vs-estimate
  history, no calibration factor. This plan only builds the Procore master list
  that future work will join against.
- **Correcting the 67 estimate-side type mismatches.** This plan *surfaces* them
  as an advisory; fixing the estimate catalog's `costType` values is a separate
  data-correction effort.
- **Extending the estimate-side type vocabulary to include Equipment.** Noted as
  a known gap; not changed here.
- **Inline single-code editing on the new page.** First version is
  import / export / view only. Add/edit/retire-one-code without re-importing is
  deferred.
- **Procore API integration.** Sync is via spreadsheet import; no live API.

## Locked decisions
- **New DB table is the source of truth.** A new `procore_cost_codes` table holds
  `(code, type, description)` + lifecycle fields. The DB becomes authoritative for
  "what Procore codes exist and their type." _Why: it's the spine for the later
  actuals workstream and must be current, type-aware, and company-managed._
- **JSON oracle demoted to a drift check.** `src/lib/procore-valid-codes.json`
  (224 codes, no type, template-synced via `npm run sync-codes`) stops being the
  source of truth and becomes a cross-check against the DB. _Why: one
  authoritative list, type-aware, not silently regenerated from the template._
- **The 7 dropped codes are resolved per-code, from a report — not auto-deleted.**
  The new list is a strict subset of the old (217 ⊂ 224, 0 added, 0 description
  conflicts). Phase 1 produces a reconciliation report of exactly what references
  each of the 7; the architect decides each. _Why: at least `2-20000.000 Site
  Operations` and `1-10440.000 General Labor` are live rollup/mapping targets —
  blind deletion would break the $0.00 export golden._
- **The oracle flip happens late, after reconciliation.** The table is built and
  managed first; export/mapping validation switches from JSON to DB only in the
  final phase. _Why: keep the golden-touching change isolated and last._
- **Management page is import + export + searchable table view.** _Why: matches
  the stated need; smallest useful slice._

## The reconciliation facts (measured, for reference)
- Current JSON oracle: **224** codes, code + description, **no type**.
- New Procore truth (`docs/reference/Procore Cost Codes.xlsx`): **217** codes,
  code + type + description, no duplicate base codes.
- Diff: **7 codes in JSON but not in the new list** (retire candidates); **0**
  to add; **0** description conflicts. The 7:
  `1-10440.000 General Labor` · `11-110000.000 Equipment` ·
  `2-20000.000 Site Operations` · `2-29406.000 Trash Chute` ·
  `6-66119.000 Quartz Surface` · `60-605000.000 Miscellaneous` ·
  `8-87000.000 Hardware`.
- Type-aware cardinality (estimate granular → Procore typed): ~123 of 148 used
  codes are 1:1; 25 are many-to-one (generic catch-alls).
- **67** estimate-granular codes have a type that disagrees with Procore's type
  for that base; **8** point at a base not in the Procore list. Surfaced, not
  fixed, here.

## Phases

### Phase 1 — Table + seed + reconciliation report
- **Scope:**
  - New `procore_cost_codes` table: `code` (PK), `type`
    (CHECK in Labor/Material/Subcontract/Equipment), `description`, lifecycle
    fields (`created_at`, `updated_at`, and a tombstone/redirect mechanism
    mirroring the Catalog Manager pattern — `retired_at` / `redirect_to` or
    equivalent). Update `supabase_schema.sql` first.
  - A seed script (twin of `scripts/generate-cost-code-map-seed.js`) that reads
    `docs/reference/Procore Cost Codes.xlsx` and loads the 217 typed codes.
  - `getProcoreCostCodes()` read function in `src/lib/db.ts` (no consumer flips
    to it yet — JSON stays the live oracle this phase).
  - A **reconciliation report** (script + written `docs/` output) that cross-
    references the 7 dropped codes against `cost_code_map`, saved
    `estimate_line_items`, and the export rollup targets — showing exactly what
    references each so the architect can decide per-code in Phase 4.
- **Approval gates:** ⛔ **DDL** — invoke the supabase skill, show the exact
  `CREATE TABLE` SQL, and stop for sign-off before applying. ⛔ Seed insert of
  217 rows is data, not DDL, but show the count and a sample before writing.
- **Exit criteria:** `npm run test` green · `npx tsc --noEmit` clean · table live
  with 217 rows · reconciliation report committed · nothing user-facing changed
  (JSON still the oracle) · committed (message via `git commit -F`) · handoff doc
  written via `/handoff`.

### Phase 2 — Management page (import / export / table view)
- **Scope:**
  - New route `/procore-codes` (sibling of `/cost-codes` and `/catalog`).
  - Searchable / filterable table of all codes from `procore_cost_codes` (filter
    by type, search code/description), with KPI counts per type.
  - **Import**: upload the xlsx (reuse `src/lib/xlsx-reader.ts`), validate the
    3-column shape, preview a diff (added / removed / changed vs current table),
    then apply on confirm.
  - **Export**: download the current table as the same 3-column xlsx (reuse
    `src/lib/exportUtils.ts`).
  - Nav entry alongside the other admin pages.
- **Approval gates:** none (no DDL; reads/writes go through `db.ts`). Import-apply
  writes rows — show the diff preview before committing, no silent overwrite.
- **Exit criteria:** `npm run test` green (incl. import round-trip test) · `tsc`
  clean · page loads, imports the reference file, exports an identical file ·
  committed · handoff written.

### Phase 3 — Type-aware mapping view (additive, non-breaking)
- **Scope:**
  - Wire `/cost-codes` (`src/app/cost-codes/page.tsx`) and the new page to **read**
    `procore_cost_codes`, so the mapping target list and descriptions come from the
    DB — but **export validation still uses the JSON oracle** this phase (no flip
    yet; purely additive).
  - Surface the **67 type mismatches + 8 missing-base** estimate codes as an
    advisory panel/badges on `/cost-codes`: "estimate code says X, Procore says Y."
    Read-only, no auto-fix.
  - Show each Procore code's **type** in the mapping UI.
- **Approval gates:** none (additive, no DDL, no oracle change).
- **Exit criteria:** `npm run test` green · `tsc` clean · mismatch advisory
  visible and accurate against the measured 67/8 · export still validates against
  JSON and golden still ties $0.00 · committed · handoff written.

### Phase 4 — Cutover (resolve the 7, flip the oracle)
- **Scope:**
  - Apply the architect's per-code decisions from the Phase 1 report: repoint any
    `cost_code_map` rows off a retiring code (via existing
    `updateCostCodeMapping`) and/or tombstone the code in `procore_cost_codes`.
  - **Flip the export/mapping validation oracle** from
    `src/lib/procore-valid-codes.json` to `procore_cost_codes` (type-aware).
  - **Demote `sync-codes` / the JSON** to a drift check: repurpose
    `src/__tests__/procore-valid-codes-sync.test.ts` to assert the DB list and the
    JSON agree (or flag drift), rather than the JSON being canonical.
  - Re-run the export golden and prove **$0.00**.
- **Approval gates:** ⛔ **Oracle flip + golden** — this is the golden-touching
  change; run the export golden and confirm $0.00 before commit. ⛔ Confirm the
  per-code resolution of the 7 with the architect before applying repoints/
  tombstones. No new DDL (lifecycle columns already exist from Phase 1).
- **Exit criteria:** `npm run test` green · `tsc` clean · export golden ties
  $0.00 · DB is the validation oracle · drift check passes · committed · handoff
  written (and note the actuals workstream as the natural next plan).

## Risks & unknowns
- **A dropped code is a live rollup target.** Confirmed for at least
  `2-20000.000` / `1-10440.000`. Phase 1's report is what de-risks this; Phase 4
  must repoint before retiring or the golden breaks. _Found in: Phase 1._
- **Lifecycle/tombstone shape.** The exact column design should mirror Catalog
  Manager so the later actuals workstream and historical mappings behave
  consistently. _Settled in: Phase 1 DDL (gated)._
- **Type-vocabulary mismatch (Equipment).** Estimate side carries L/M/S only;
  Procore adds Equipment. Surfaces in the Phase 3 advisory; resolving it is
  deferred. _Found in: Phase 3._
- **`sync-codes` coupling to the template.** Demoting it (Phase 4) must not break
  the template-import path that also reads Importer Data Fields. _Found in:
  Phase 4._

## Phase 1 kickoff prompt
> Implement **Phase 1** of the Procore Cost Codes master-list plan at
> `docs/plans/2026-06-12-procore-cost-codes-master-list.md`. Scope: (1) create the
> new `procore_cost_codes` table — `code` PK, `type` CHECK
> (Labor/Material/Subcontract/Equipment), `description`, plus `created_at`,
> `updated_at`, and a tombstone/redirect lifecycle mechanism mirroring the Catalog
> Manager pattern — updating `supabase_schema.sql` first; (2) write a seed script
> (twin of `scripts/generate-cost-code-map-seed.js`) that loads the 217 typed codes
> from `docs/reference/Procore Cost Codes.xlsx`; (3) add `getProcoreCostCodes()` to
> `src/lib/db.ts` with no consumer flipped to it yet (JSON stays the live oracle);
> (4) produce a reconciliation report (script + `docs/` output) cross-referencing
> the 7 dropped codes (`1-10440.000`, `11-110000.000`, `2-20000.000`,
> `2-29406.000`, `6-66119.000`, `60-605000.000`, `8-87000.000`) against
> `cost_code_map`, saved `estimate_line_items`, and the export rollup targets.
> **Invoke the supabase skill before any DB code. ⛔ Show the exact CREATE TABLE
> SQL and stop for my approval before applying it. Show the seed row count + a
> sample before inserting.** Do not change any export/validation behavior this
> phase. Exit when `npm run test` is green, `npx tsc --noEmit` is clean, the table
> is live with 217 rows, the report is committed, and a handoff doc is written via
> `/handoff`. **Stop at the Phase 1 boundary** — do not start Phase 2.
