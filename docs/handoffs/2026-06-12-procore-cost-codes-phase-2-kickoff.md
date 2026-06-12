# Procore Cost Codes — Phase 2 Kickoff (Management page: import / export / table view)

_2026-06-12 · previous phase: **Phase 1 COMPLETE** on branch
`procore-cost-codes-phase-1` (`a4eb2c9`, NOT pushed, NOT merged to main).
New `procore_cost_codes` table is LIVE on `nefvkrhbbkiqnpeabyqz` with **217 rows**
(Material 98, Subcontract 110, Labor 8, Equipment 1, all `status='active'`).
`getProcoreCostCodes()` ships UNWIRED — `src/lib/procore-valid-codes.json` is
still the live export-validation oracle. Reconciliation report committed. Suite
756/67 green, tsc clean._

## Ready-to-paste prompt for a fresh session

> Read `docs/plans/2026-06-12-procore-cost-codes-master-list.md` (plan of record)
> and execute **Phase 2 only**: the `/procore-codes` management page (import /
> export / searchable table view). Scope: (1) new route `src/app/procore-codes/
> page.tsx`, a sibling of `/cost-codes` and `/catalog` — match their layout,
> nav, and the corporate-data fail-soft loader idiom. (2) Searchable/filterable
> table of ALL codes from `procore_cost_codes` via the existing
> `getProcoreCostCodes()` (filter by type, search code/description) with KPI
> counts per type. (3) **Import**: upload the xlsx (reuse `src/lib/xlsx-reader.ts`
> — but note its `parseTogalXLSX` only keeps rows with a `Classification` column,
> so add a small 3-column reader OR a dedicated parse path for the Cost Code |
> Type | Description shape), validate the 3-column shape + the type vocabulary,
> preview a diff (added / removed / changed vs the current table), then apply on
> confirm. (4) **Export**: download the current table as the same 3-column xlsx
> (reuse `src/lib/exportUtils.ts`). (5) Nav entry alongside the other admin pages.
> The import-apply WRITE goes through a new `db.ts` helper (the table's
> INSERT+UPDATE RLS policies already exist from Phase 1 — NO DDL this phase);
> validate shape + type before the write, mirroring the `createCatalogAddition`
> validation pattern. NO oracle flip, NO type-aware `/cost-codes` changes (those
> are Phase 3/4). Exit: `npm run test` green **including an import round-trip test
> (parse the reference xlsx → apply → export → byte/row-identical)** · `npx tsc
> --noEmit` clean · page loads + imports the reference file + exports an identical
> file · `/code-review` findings resolved · committed via `git commit -F
> <tempfile>` · close with /handoff. Stop at the Phase 2 boundary — do NOT start
> Phase 3.

## Where Phase 1 left off (context a cold session may need)

- **Plan file:** `docs/plans/2026-06-12-procore-cost-codes-master-list.md` —
  4 phases, locked decisions, out-of-scope list. Phase 2 section is the spec.
- **Reconciliation report (Phase 1 deliverable, for Phase 4):**
  `docs/plans/2026-06-12-procore-cost-codes-reconciliation.md`. Headline the
  architect must decide in Phase 4: **only `2-20000.000` Site Operations is a
  live export target** (8 `cost_code_map` mappings — the Division-02 codes
  `02-0000.001`…`02-9500.008` — plus 8 saved `estimate_line_items` rows). It
  MUST be repointed (via `updateCostCodeMapping`) before retiring, or the export
  golden breaks. The other 6 dropped codes have ZERO references and are safe
  retire candidates — INCLUDING `1-10440.000 General Labor`, which the plan had
  assumed was live but the data disproves (the report carries an explicit
  correction callout). `11-110000.000 Equipment` is a display-only
  `procoreParentCode` for 7 Division-11 rows, not an export destination.
- **Table shape (`supabase_schema.sql` Table 17):** `code` PK (CHECK non-empty,
  NO regex — Procore shape varies: `N-NNNNN.000` / `NN-NNNNNN.000`, different
  from the estimate-side `NN-NNNN.NNN`), `type` CHECK
  (Labor/Material/Subcontract/Equipment), `description` (non-empty), lifecycle
  `status` (active/retired/merged) + `merged_into` (no FK, no regex) + merge
  consistency CHECK + a BEFORE UPDATE lifecycle guard trigger
  (`procore_cost_codes_lifecycle_guard`, mirrors `custom_step23_line_defs`) +
  `updated_at` touch trigger. RLS: SELECT/INSERT/UPDATE to `authenticated`, no
  DELETE. The INSERT+UPDATE policies were added in Phase 1 specifically so
  Phases 2 & 4 need NO DDL.
- **Read surface (Phase 1):** `getProcoreCostCodes()` in `db.ts` returns ALL
  rows (incl. retired/merged) ordered by code, mapped to the `ProcoreCostCode`
  type (`src/types/db.ts`: `code/type/description/status/mergedInto`). Throws on
  error — wrap with `.catch(() => [])` at the call site for fail-soft.
- **Seed (Phase 1):** `npm run generate-procore-codes-seed` →
  `supabase_seed_procore_cost_codes.sql` (INSERT-ONLY, ON CONFLICT DO NOTHING)
  from `docs/reference/Procore Cost Codes.xlsx`. Re-run only ADDS new codes; the
  page's import-apply (Phase 2) is the UPDATE path.
- **xlsx reader caveat:** `src/lib/xlsx-reader.ts` `parseTogalXLSX` filters to
  rows with a `Classification` value (Togal-specific) — it will NOT work as-is
  for the 3-column Procore file. Add a focused 3-column parse path. The Phase 1
  seed generator (`scripts/generate-procore-cost-codes-seed.js`) has a clean
  `cellStr()` extractor + header validation you can mirror.
- **Nothing user-facing changed in Phase 1** — `/cost-codes` and export still
  validate against `procore-valid-codes.json`. Keep it that way until Phase 4.
- **Advisors after Phase 1:** exactly 2 new expected `rls_policy_always_true`
  WARNs on `procore_cost_codes` (INSERT + UPDATE `true`), matching the
  `catalog_additions`/`cost_code_map`/`rate_card` precedent. No ERRORs.
- **Uncommitted working tree (pre-existing, NOT this workstream's):** a docs
  archive move (deleted `docs/handoffs/*` + `docs/plans/*` with untracked copies
  under `docs/*/archive/`), a modified `CLAUDE.md`, and a stray
  `C꞉tempfindings.json` sit in the tree. Leave them alone; `git add` specific
  files only.
- Exit-gate commands: `npm run test` · `npx tsc --noEmit` · commit message
  written to a temp file (Write tool, no BOM) then `git commit -F <file>` —
  never inline multi-line commit text (Windows shell rule).

## Approval gates

**None inside Phase 2** — no DDL (the write policies exist from Phase 1); the
import-apply WRITE must show the diff preview before committing (no silent
overwrite). Do NOT push. Do NOT chain into Phase 3 (type-aware mapping view) or
Phase 4 (⛔ oracle flip + golden + per-code resolution of the 7 — the
golden-touching change, gated). Branch `procore-cost-codes-phase-1` is unpushed
and unmerged — the architect decides merge/push timing.
