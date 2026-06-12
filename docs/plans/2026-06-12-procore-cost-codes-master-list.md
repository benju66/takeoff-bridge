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
  as an advisory; fixing the estimate catalog's `costType` values belongs to the
  follow-on reconciliation workstream (below).
- **Extending the estimate-side type vocabulary to include Equipment.** Noted as
  a known gap; deferred to the follow-on reconciliation workstream.
- **Cleaning the estimate template.** Removing the 7 dead codes from the
  template's Importer Data Fields (so it stops emitting the 224) is the
  golden-sensitive change and is deliberately NOT done here — it goes in the
  follow-on workstream so it never shares a phase with the oracle flip.
- **Inline single-code editing on the new page.** First version is
  import / export / view only. Add/edit/retire-one-code without re-importing is
  deferred.
- **Procore API integration.** Sync is via spreadsheet import; no live API.

### Follow-on workstreams (separate plans, in order)
1. **This plan** — managed Procore list + oracle flip (drift = warn interim).
2. **Template + Catalog Reconciliation** (the next `/plan-phases`): drive the
   drift to zero at the source — remove the 7 dead codes from the template's
   Importer Data Fields, correct the **67** type mismatches, repoint the **8**
   missing-base mappings, add the **Equipment** type to the estimate side,
   optionally split the **25** many-to-one catch-alls. This plan builds the
   type-aware tool that workstream uses.
3. **Actuals cost-history** — the original goal; only trustworthy after #2.

## Locked decisions
- **New DB table is the source of truth.** A new `procore_cost_codes` table holds
  `(code, type, description)` + lifecycle fields. The DB becomes authoritative for
  "what Procore codes exist and their type." _Why: it's the spine for the later
  actuals workstream and must be current, type-aware, and company-managed._
- **JSON oracle demoted to a drift check.** `src/lib/procore-valid-codes.json`
  (224 codes, no type, template-synced via `npm run sync-codes`) stops being the
  source of truth and becomes a cross-check against the DB. _Why: one
  authoritative list, type-aware, not silently regenerated from the template._
- **The 217 file is the COMPLETE, authoritative Procore universe** → "not in the
  file = retire" is the correct rule. _Architect-confirmed 2026-06-12._
- **All 7 dropped codes retire — confirmed by the Phase 1 report, all are
  export-safe.** The Phase 1 reconciliation found all 6 of the "unused" codes have
  **zero** references (incl. `1-10440.000 General Labor`, which the plan had
  wrongly assumed was live). The 7th, **`2-20000.000 Site Operations`**, is also
  export-safe: its 8 estimate mappings (`02-0000.001`…`02-9500.008`) are ALL
  `LINKED_DIVISION_ROWS` (display-only totals) that the export already **excludes**
  — the dollars travel on the granular STEP 3 Site Ops lines, which carry their
  own valid Procore codes. So **no repoint to "successors" is needed**; Phase 4
  just tombstones it and exempts linked-division rows from the validity rule.
  _Refined 2026-06-12 via `LINKED_DIVISION_ROWS` + the export's
  `isLinkedDivisionRow` skip._
- **Ongoing import behavior: flag, never auto-retire.** When a re-imported file is
  missing a code that's in the DB, it is shown as a *proposed* retirement for
  confirmation — never auto-tombstoned. _Why: a partial/bad export file must not
  silently nuke live codes._
- **Drift after the flip is a WARN (interim).** The template still emits the 224,
  so the drift check reports the 7-code delta as a known accepted delta and stays
  green. The delta is eliminated at the source by follow-on workstream #2 — not by
  editing the template in this plan.
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
    then apply on confirm. Codes in the DB but **missing from the file are shown as
    *proposed retirements* — never auto-tombstoned** (architect-locked rule).
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
  - **Bring the granular Site Ops Procore codes under validation.** The STEP 3
    Site Ops lines hard-code their `procoreCode` in `constants.ts`
    (`SITE_OPS_MANUAL_DEFAULTS`, ~72 refs) and currently bypass `cost_code_map` /
    the oracle entirely — valid today but unguarded. Add them to the drift check
    against `procore_cost_codes` so a bad hand-edit is caught.
- **Approval gates:** none (additive, no DDL, no oracle change).
- **Exit criteria:** `npm run test` green · `tsc` clean · mismatch advisory
  visible and accurate against the measured 67/8 · export still validates against
  JSON and golden still ties $0.00 · committed · handoff written.

### Phase 4 — Cutover (resolve the 7, flip the oracle)
- **Scope:**
  - **Tombstone `2-20000.000` — no repoint needed.** Confirmed: all 8 estimate
    codes mapping to it (`02-0000.001`…`02-9500.008`) are `LINKED_DIVISION_ROWS`
    (display-only totals) that the Procore export already **excludes**
    (`isLinkedDivisionRow` → skip; their dollars travel on the granular STEP 3
    Site Ops lines). So retiring `2-20000.000` moves **zero** export dollars. The
    fix is to **exempt linked-division rows from the `/cost-codes` Procore-code
    validity rule** (extend the existing `isLinkedDivisionRow` exemption to
    validation) so a retired `2-20000.000` doesn't flag them. Do NOT invent
    granular successors for these summaries.
  - **Tombstone the other 6 dropped codes** once the Phase 1 sweep confirms no
    live mapping/line-item references them (the Phase 1 reconciliation report
    already found all 6 unreferenced, incl. `1-10440.000`).
  - **Flip the export/mapping validation oracle** from
    `src/lib/procore-valid-codes.json` to `procore_cost_codes` (type-aware).
  - **Demote `sync-codes` / the JSON** to a drift check: repurpose
    `src/__tests__/procore-valid-codes-sync.test.ts` to report the known 7-code
    template delta as an **accepted WARN** (stay green), rather than the JSON
    being canonical. (Eliminating the delta at the source = follow-on workstream
    #2, not here.)
  - Re-run **both** goldens and prove **$0.00** as a sanity check — STEP 4 McKenna
    **and** the GC/Site-Ops (STEP 2/3) export. (Expectation: neither moves, since
    the retired code never exported; the run is to *prove* that, not to fix a
    shift.)
- **Approval gates:** ⛔ **Oracle flip + goldens** — golden-touching; confirm
  $0.00 on STEP 4 *and* GC/Site-Ops before commit. ⛔ Confirm the 7 tombstones +
  the linked-division validation exemption with the architect before applying. No
  new DDL (lifecycle columns already exist from Phase 1).
- **Exit criteria:** `npm run test` green · `tsc` clean · both goldens tie $0.00 ·
  DB is the validation oracle · drift check green (warn-only on the known delta) ·
  committed · handoff written (point to the Template + Catalog Reconciliation plan
  as the natural next workstream).

- **`2-20000.000` retirement is export-safe (resolved 2026-06-12).** All 8 estimate
  codes mapping to it are linked-division display rows the export already excludes,
  so no dollars move. The only real work is exempting linked-division rows from the
  validation rule. No granular-successor repoint needed. _Confirmed via
  `LINKED_DIVISION_ROWS` + the export's `isLinkedDivisionRow` skip._
- **Two separate Procore-code reference sets.** `cost_code_map` (STEP 4, validated)
  and `constants.ts` Site Ops (STEP 3, currently unvalidated). The flip must cover
  both or the Site Ops codes silently escape the new oracle. _Addressed in Phase 3._
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
