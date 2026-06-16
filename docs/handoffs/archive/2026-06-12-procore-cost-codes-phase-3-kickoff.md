# Procore Cost Codes — Phase 3 Kickoff

> Paste-ready prompt for a cold, fresh session. No assumed context.

## Where Phase 2 left off (2026-06-12)

Phase 2 (the `/procore-codes` management page) is **DONE and committed** on branch
`procore-cost-codes-phase-1` at `323173d` (unpushed). Phase 1 before it
(`60eb7e5`) created the live `procore_cost_codes` table (217 typed rows + lifecycle)
and the UNWIRED `getProcoreCostCodes()` read function.

What Phase 2 shipped:
- **New route `src/app/procore-codes/page.tsx`** — sibling of `/cost-codes` and
  `/catalog`: fail-soft loader, per-type KPI counts, searchable/filterable table
  (type filter + show-retired toggle), spreadsheet **Import** (upload → validate →
  diff preview → confirm-apply) and **Export** (download the live list as a
  3-column .xlsx).
- **`src/lib/xlsx-reader.ts`** → `parseProcoreCostCodesXLSX(file)`: dedicated
  3-column (Cost Code | Type | Description) parse path with a fail-loud header
  check (`parseTogalXLSX` only keeps rows with a `Classification` column, so it
  can't read this file).
- **`src/lib/procoreCostCodes.ts`** (pure, unit-tested): `validateProcoreImportRows`
  (shape + `Labor/Material/Subcontract/Equipment` vocabulary, mirrors the seed +
  DB CHECK), `diffProcoreCostCodes` (added / changed / proposed-retirement /
  unchanged), `buildProcoreCostCodesWorkbookBuffer` (order-preserving lossless
  export), `PROCORE_COST_CODE_TYPES`.
- **`src/lib/db.ts`** → `applyProcoreCostCodesImport({ upserts, retireCodes })`:
  upserts added/changed rows, retires ONLY the codes the user explicitly ticks
  (architect-locked: never auto-tombstone a code missing from the file).
  Re-validates before the write; routes through the table's existing INSERT/UPDATE
  RLS policies. **No new DDL.**
- **`src/components/layout/Sidebar.tsx`** — nav entry (FileSpreadsheet icon).
- **Test** `src/lib/__tests__/procoreCostCodes.test.ts` (10 tests): the
  round-trip (parse reference → validate → export → re-parse, row-identical, 217
  codes) + validation + diff unit tests.

Verified: suite **766 pass / 68 files**, `tsc` clean, lint clean. Page confirmed
loading against live data (KPIs match the reference exactly: 217 active —
Material 98, Subcontract 110, Labor 8, Equipment 1).

**Notes for Phase 3 / nice-to-knows:**
- The page **export orders active codes by code (string sort)**, which differs
  from the reference file's row order. Content is identical (same 217 codes); the
  automated round-trip proves losslessness on a controlled order. If a byte-exact
  re-export of the original Procore order is ever required, that's a future tweak.
- The MCP browser `file_upload` can no longer read host paths, so the live
  import-apply click was NOT exercised in-browser; it is covered by the automated
  round-trip + diff tests. A manual upload of `docs/reference/Procore Cost
  Codes.xlsx` on `/procore-codes` should show an all-unchanged diff (no-op).
- `procore_cost_codes` is still **UNWIRED to export validation** —
  `src/lib/procore-valid-codes.json` remains the live oracle until Phase 4.

---

## Phase 3 prompt (paste this)

> Implement **Phase 3** of the Procore Cost Codes master-list plan at
> `docs/plans/2026-06-12-procore-cost-codes-master-list.md` (read it first — esp.
> the "Phases" + "reconciliation facts" sections). Phase 3 is **type-aware mapping
> view — additive and non-breaking. NO oracle flip, NO DDL, golden must still tie
> $0.00.** Scope:
> 1. Wire `/cost-codes` (`src/app/cost-codes/page.tsx`) and `/procore-codes` to
>    **read** `procore_cost_codes` via `getProcoreCostCodes()` so the mapping
>    target list + descriptions come from the DB — but **export validation STILL
>    uses the JSON oracle** this phase (purely additive; do not touch
>    `procoreValidCodes.ts` as the export gate).
> 2. Surface the **67 type mismatches + 8 missing-base** estimate codes as a
>    read-only advisory panel/badges on `/cost-codes` ("estimate code says X,
>    Procore says Y"). No auto-fix. Verify the counts against the measured 67/8.
> 3. Show each Procore code's **type** in the mapping UI.
> 4. **Bring the granular Site Ops Procore codes under the drift check.** The
>    STEP 3 Site Ops lines hard-code `procoreCode` in `constants.ts`
>    (`SITE_OPS_MANUAL_DEFAULTS`, ~72 refs) and currently bypass `cost_code_map` /
>    the oracle. Add them to a drift check against `procore_cost_codes` so a bad
>    hand-edit is caught (check only — no behavior change).
>
> **Approval gates:** none (additive, no DDL, no oracle change) — but if anything
> tempts you toward flipping the oracle or editing the template, STOP: that's
> Phase 4.
>
> **Exit criteria:** `npm run test` green · `npx tsc --noEmit` clean · the
> mismatch advisory is visible and accurate against the measured 67/8 · export
> still validates against the JSON oracle and **both goldens tie $0.00** ·
> committed via `git commit -F <tempfile>` · handoff doc written via `/handoff`.
> **Stop at the Phase 3 boundary** — do NOT start Phase 4 (the oracle flip +
> the 7 tombstones).
