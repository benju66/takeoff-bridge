# Kickoff — Template + Catalog Reconciliation (new workstream)

_Paste this whole file as the first prompt of a fresh session. No prior context is assumed._

## Where the previous work left off

The **Procore Cost Codes** workstream is COMPLETE through Phase 4.

- Branch `procore-cost-codes-phase-1` (UNPUSHED). Commits: P1 `60eb7e5`, P2 `323173d`,
  P3 `b0967aa`, P4-kickoff `529984c`, **P4 `20a9f3c`**.
- **Phase 4 (oracle flip) is done.** The live `procore_cost_codes` table (217 active)
  is now the validation oracle. `src/lib/procoreValidCodes.ts` exposes
  `primeProcoreValidCodes()`, which swaps the backing set JSON → DB-active IN PLACE
  (stable array/Map refs; `isValidProcoreCode` stays synchronous). The DB load is
  `src/lib/procoreValidCodesPrime.ts` (`primeProcoreValidCodesFromDb` /
  `primeProcoreValidCodesFromList`), primed fail-soft at `/cost-codes`, `/catalog`,
  `/projects/import`, and `useTakeoffWorkbook` (workspace + ExportOverrideModal).
- The **7 dropped codes are retired BY ABSENCE** — no DDL, no row writes. They simply
  aren't in the table, so the flip makes them invalid. The 7:
  `1-10440.000`, `2-20000.000`, `2-29406.000`, `6-66119.000`, `8-87000.000`,
  `11-110000.000`, `60-605000.000`.
- The JSON (`src/lib/procore-valid-codes.json`, 224) is now only a cold-start fallback
  + a warn-only drift baseline (`src/__tests__/procore-valid-codes-sync.test.ts` pins
  JSON − reference-xlsx === exactly those 7).
- Linked-division summaries (the 8 div-02 rows → retired `2-20000.000`) are exempt from
  the `/cost-codes` missing-base advisory (8 → 0); the 67 type-mismatch count is
  unchanged. See `src/lib/procoreTypeReconciliation.ts` (`exemptLinkedDivision`).
- State at handoff: suite 773/70 green, `npx tsc --noEmit` clean, eslint clean, both
  goldens tie **$0.00** (STEP 4 McKenna + GC/Site-Ops STEP 2/3 in `golden-mckenna.test.ts`).
- AGENTS.md now carries a **"Procore Cost Code Authority"** section codifying: the table
  is the source of truth, the JSON is a drift baseline only, never fabricate a Procore
  `type`. Honor it.

## This workstream: Template + Catalog Reconciliation

The flip retired the 7 codes and made the DB authoritative, but it deliberately did NOT
clean up the SOURCES that still carry the old/mismatched data. That cleanup is this
workstream. Scope (the architect will confirm/sequence — start with `/plan-phases`):

1. **Remove the 7 dead codes from the template + JSON.** The Importer Data Fields sheet
   in the canonical template (and therefore `procore-valid-codes.json` via
   `npm run sync-codes`) still lists all 224. Dropping the 7 makes the drift check go to
   a zero delta. ⛔ Touches the canonical template `.xlsx` — architect approval gate.
2. **Resolve the 67 type mismatches.** Estimate catalog `costType` (L/M/S) disagrees
   with Procore's type for 67 mapped codes. Decide per-code: fix the catalog costType,
   or accept the difference. Pure helper + counts live in
   `src/lib/procoreTypeReconciliation.ts` / `src/__tests__/procore-type-reconciliation.test.ts`.
3. **The Equipment-type gap.** The estimate vocabulary has no Equipment; any estimate
   code mapped to an Equipment-typed Procore base reads as a mismatch by construction.
   Decide whether to extend the estimate cost-type vocabulary. (Per AGENTS.md, never
   fabricate a Procore type — this is about the ESTIMATE side.)
4. **Optional: `11-110000.000` display label.** It was a display-only `procoreParentCode`
   for 7 div-11 rows; now retired. Decide if those rows need a retained parent label or
   if the cosmetic grouping is dropped. Zero export impact either way.

Read first:
- `docs/plans/2026-06-12-procore-cost-codes-master-list.md` (the master plan + Locked decisions)
- `docs/plans/2026-06-12-procore-cost-codes-reconciliation.md` (per-code disposition table)
- `docs/plans/2026-06-12-procore-cost-codes-phase-4-cutover.md` (what Phase 4 did)

## Known issue carried forward (from code review 2026-06-12)

**Re-activating a retired Procore code via the `/procore-codes` import is rejected by the
DB lifecycle guard — fix when the retire/merge lifecycle work is done.**

- Path: the import diff (`diffProcoreCostCodes`) classifies a code that exists in the DB
  as **non-active** but reappears in the imported file as a `changed` "re-activation"
  (the UI even renders "re-activate"). `applyProcoreCostCodesImport` (db.ts) upserts it
  with `status:'active'` via `ON CONFLICT DO UPDATE`.
- But `procore_cost_codes_lifecycle_guard` (BEFORE UPDATE, supabase_schema.sql) raises
  `Code % is %; only active codes can be retired or merged.` for any `retired/merged →
  active` transition. ON CONFLICT DO UPDATE fires BEFORE-UPDATE triggers, so the guard
  rejects it — and because the upsert is one atomic statement, **a single reappearing
  retired code blocks the entire import** (all adds/changes in that file fail too).
- **Severity: low today, medium once codes are retired.** Unreachable right now (zero
  codes are retired). It only bites after you've ticked a "proposed retirement" and then
  re-import a file where that code returns.
- **Fix (architect's call, ~1 file + test):** either relax the guard to allow
  `retired/merged → active` reactivation, or route reactivations through a dedicated
  path and stop the diff/UI/tests promising automatic reactivation. Natural fit for
  whichever phase finishes the retire/merge lifecycle.

## How to run it

- This is a NEW multi-phase plan. **Start with `/plan-phases`** — write the plan to
  `docs/plans/`, get architect approval, then execute one phase per fresh session.
- Invoke the `supabase:supabase` skill before any DB-adjacent code.
- Per-phase exit criteria: `npm run test` green · `npx tsc --noEmit` clean · eslint clean
  · **both goldens tie $0.00** · committed via `git commit -F <tempfile>` · handoff written.
- ⛔ Approval gates: editing the canonical template `.xlsx`; any DDL; pushing the branch.
- The Phase-4 branch is unpushed — the architect may want to push / open a PR for
  Phases 1–4 before (or alongside) starting this workstream. Confirm before pushing.

## One-line summary

Procore Cost Codes Phase 4 (oracle flip, retire-by-absence) is done and committed
(`20a9f3c`, unpushed); next is Template + Catalog Reconciliation — clean the 7 dead
template/JSON codes and resolve the 67 type mismatches — started via `/plan-phases`.
