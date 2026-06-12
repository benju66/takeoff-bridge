# Procore Cost Codes — Phase 4 Cutover — Execution Plan
_2026-06-12 · branch `procore-cost-codes-phase-1` · status: **APPROVED to execute** (retire-by-absence + linked-division exemption signed off by architect 2026-06-12; the $0.00 goldens gate still stands before commit)_

Makes the **DB** (`procore_cost_codes`, 217 active) the validation oracle, retires the
7 dropped codes **by absence**, exempts linked-division rows from validation, and demotes
the JSON to a warn-only drift check. No new DDL. Goldens must tie **$0.00**.

## Predecessor state (where Phase 3 left off)
Phase 3 COMPLETE + committed at `b0967aa` (unpushed). `/cost-codes` READS the typed
`procore_cost_codes` (target dropdown, descriptions, Procore Type column) and shows a
read-only type-mismatch (67) / missing-base (8) advisory. Site Ops hard-coded codes are
under a drift check. **Validation has NOT changed yet** — export + the `/cost-codes`
persist gate still validate against the JSON oracle (`procoreValidCodes.ts` →
`procore-valid-codes.json`, 224 codes). Suite 771/70 green, tsc clean, both goldens $0.00.

## Read first
- Plan of record: `docs/plans/2026-06-12-procore-cost-codes-master-list.md` (Phase 4
  section + Locked decisions, esp. the `2-20000.000` linked-division resolution).
- Phase 1 reconciliation report: `docs/plans/2026-06-12-procore-cost-codes-reconciliation.md`
  (per-code disposition table).

## Findings that shape the work (corrects the kickoff's assumptions)

1. **The 7 dropped codes are NOT in `procore_cost_codes`.** Phase 1 seeded only the 217
   keep-set. The `type` column is `NOT NULL` + CHECK(Labor/Material/Subcontract/Equipment);
   the JSON oracle carries **no type** for the 7. Inserting them as `status='retired'` rows
   would require **fabricating a Procore type** — forbidden by AGENTS.md ("No Speculative
   Changes... Procore financial data models").
   → **Disposition: retire-by-absence (ARCHITECT-APPROVED).** The flip to "DB-active =
   valid" makes the 7 invalid automatically. No `applyProcoreCostCodesImport` / UPDATE write
   is needed (there is no row to flip). The retirement is realized by the flip and
   **documented** in the repurposed drift test + this plan + the reconciliation report. Live
   DB confirmed: 217 active, 0 rows for any of the 7. (Supersedes the kickoff's Step 2,
   which wrongly assumed `status='retired'` row flips.)

2. **The oracle is consumed far beyond "two pick-points."** `isValidProcoreCode` /
   `PROCORE_VALID_CODES` are called synchronously inside the `db.ts` gateway
   (`db.ts:2152` cost-code-map persist gate; `db.ts:1909` catalog/custom-def writer),
   in `legacyBridge.ts:84`, and on `/cost-codes`, `/catalog`, `/projects/import`, and the
   `ExportOverrideModal`. → Flip via a **primed module overlay** (the established
   `primeCostCodeResolver` / `primeRateCard` / `primeCatalogAdditionOverlays` pattern): keep
   `isValidProcoreCode` synchronous, swap the backing set from JSON → DB-active at load.
   Every call site keeps working unchanged.

3. **The 8 linked-division mappings** (`02-0000.001`…`02-9500.008` → retired `2-20000.000`)
   are exactly the Site-Ops `LINKED_DIVISION_ROWS`; `isLinkedDivisionRow()` already returns
   true for them. They are the "8 missing-base" the Phase 3 advisory surfaces.

4. **`11-110000.000` watch-item.** The Phase 1 report classified it as a display-only
   `procoreParentCode` for 7 Division-11 rows (not an export destination, zero export
   references). Retire-by-absence is still correct, but **confirm** the flip doesn't trip
   validation on those parent-code references — the two $0.00 goldens + the Phase 3 advisory
   staying clean is the proof.

## Steps

### 1. Primed-module flip — `src/lib/procoreValidCodes.ts`
- JSON stays the cold-start/SSR baseline + fallback. Add module-level mutable backing
  (`let` live-binding) + `primeProcoreValidCodes(codes: ProcoreValidCode[])` that swaps the
  active list + description map. `isValidProcoreCode`, `PROCORE_VALID_CODES`,
  `PROCORE_CODE_DESCRIPTIONS` keep their current shapes (no call-site signature changes).
- Fail-safe: DB-active (217) ⊂ JSON (224). An unprimed window can only ever accept one of
  the 7 dropped codes (all unreferenced/retired) — never blocks a legitimate code.

### 2. Prime from the DB at every code-validating surface
Add a `getProcoreCostCodes()` load → `primeProcoreValidCodes(active)` to:
- `/cost-codes` (already loads the list — just add the prime),
- `/catalog`, `/projects/import`,
- `useTakeoffWorkbook` (covers the workspace + `ExportOverrideModal`).
Idempotent + module-global; fail-soft (`.catch` → keep JSON fallback).

### 3. Linked-division validation exemption
- `computeTypeReconciliation` (or its `/cost-codes` caller): skip mappings whose
  `internalCode` `isLinkedDivisionRow(...)`. Drops the missing-base advisory 8 → 0 (all 8
  missing-base ARE the linked-division summaries). Mismatches (67) unaffected.
- Unit test: assert 67 mismatches / 0 missing-base WITH exemption, and pin that WITHOUT
  exemption it is still 8 (so the exemption stays honest/visible).

### 4. Demote JSON to a warn-only drift check — `procore-valid-codes-sync.test.ts`
- KEEP the JSON === template Importer-Data-Fields assertion (the template-import path still
  reads that sheet — must not rot).
- ADD: `template/JSON codes − reference-xlsx (217) === { the 7 known dropped codes }` exactly,
  and `xlsx ⊆ template`. Green today; red only if the delta **changes** (an unexpected
  add/drop) — the real regression risk. Eliminating the delta at the source is the follow-on
  Template + Catalog Reconciliation workstream, not here.

### 5. Prove both goldens tie $0.00
- STEP 4 McKenna **and** GC/Site-Ops (STEP 2/3). Expectation: neither moves (the retired
  code never exported). The run proves it. ⛔ Confirm $0.00 before commit.

## Approval gates (⛔ STOP)
- **Disposition of the 7 + linked-division exemption** — ✅ APPROVED 2026-06-12
  (retire-by-absence, no fabricated-type rows). No further sign-off needed to apply.
- **Oracle flip + goldens** — ⛔ confirm **$0.00 on STEP 4 AND GC/Site-Ops** before commit.
- **Supabase skill** — invoke `supabase:supabase` before touching DB code. No new DDL
  expected (retire-by-absence writes nothing); if any data write appears, show it first.

## Exit criteria
- `npm run test` green · `npx tsc --noEmit` clean · both goldens $0.00
- DB is the validation oracle; JSON is a warn-only drift check; 7 retired-by-absence;
  linked-division rows exempt from validation
- Committed via `git commit -F <tempfile>` (no inline multi-line commit text)
- `/handoff` → point to the **Template + Catalog Reconciliation** workstream as next
- **Stop at the Phase 4 boundary** — do NOT start the reconciliation workstream (removing
  the 7 dead template codes / fixing the 67 type mismatches / etc.).

## Useful pointers
- DB reads: `getProcoreCostCodes()` in `src/lib/db.ts`.
- Pure type-reconciliation helpers (Phase 3): `src/lib/procoreTypeReconciliation.ts`.
- Site Ops drift check (Phase 3): `src/__tests__/site-ops-procore-codes-drift.test.ts`.
- Linked-division logic: grep `isLinkedDivisionRow` / `LINKED_DIVISION_ROWS`.
- Branch `procore-cost-codes-phase-1` unpushed — P1 `60eb7e5`, P2 `323173d`, P3 `b0967aa`,
  P4-kickoff `529984c`. Architect may want a push/PR after Phase 4.
