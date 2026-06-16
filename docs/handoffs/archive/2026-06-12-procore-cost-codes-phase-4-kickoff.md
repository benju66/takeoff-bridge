# Procore Cost Codes — Phase 4 kickoff (Cutover: resolve the 7, flip the oracle)

_Paste this whole file as the prompt for a fresh session. No prior context assumed._

## Where Phase 3 left off
Phase 3 (type-aware mapping view) is **COMPLETE, committed** on branch
`procore-cost-codes-phase-1` at `b0967aa` (unpushed). `/cost-codes` now READS the
typed Procore master list (`procore_cost_codes`) for the target dropdown,
descriptions, and a Procore Type column, and shows a **read-only** type-mismatch
(67) / missing-base (8) advisory. The Site Ops hard-coded codes are now under a
drift check. **Crucially: NOTHING about validation changed yet** — the export and
the `/cost-codes` persist gate still validate against the JSON oracle
(`src/lib/procoreValidCodes.ts` → `src/lib/procore-valid-codes.json`, 224 codes).
Suite **771/70 green**, `tsc` clean, both goldens tie **$0.00**.

Phase 4 is the cutover that makes the DB the validation authority.

## Read first
- Plan of record: `docs/plans/2026-06-12-procore-cost-codes-master-list.md`
  — read the **Phase 4** section AND the "reconciliation facts" + "Locked
  decisions" sections (esp. the `2-20000.000` linked-division resolution).
- Phase 1 reconciliation report: `docs/plans/2026-06-12-procore-cost-codes-reconciliation.md`
  — the per-code disposition table (all 6 non-Site-Ops dropped codes have ZERO
  references; only `2-20000.000` has mappings, and those are linked-division).

## Phase 4 — Cutover (resolve the 7, flip the oracle)
Scope (all four, in this order):

1. **Tombstone `2-20000.000` — no repoint needed.** All 8 estimate codes mapping
   to it (`02-0000.001`…`02-9500.008`) are `LINKED_DIVISION_ROWS` (display-only
   totals) the Procore export already EXCLUDES via `isLinkedDivisionRow`; their
   dollars travel on the granular STEP 3 Site Ops lines. Retiring it moves **zero**
   export dollars. The real work: **exempt linked-division rows from the
   `/cost-codes` Procore-code validity rule** (extend the existing
   `isLinkedDivisionRow` exemption to validation) so a retired `2-20000.000`
   doesn't flag them. Do NOT invent granular successors.
   - These 8 are exactly the "8 missing-base" the Phase 3 advisory surfaces.
2. **Tombstone the other 6 dropped codes** (`1-10440.000`, `11-110000.000`,
   `2-29406.000`, `6-66119.000`, `60-605000.000`, `8-87000.000`) — the Phase 1
   report already confirmed all 6 are unreferenced. Use the existing lifecycle
   mechanism (status='retired' via `applyProcoreCostCodesImport` retireCodes, or
   a one-off seed/SQL — NO new DDL; lifecycle columns exist from Phase 1).
3. **Flip the export/mapping validation oracle** from
   `src/lib/procore-valid-codes.json` to `procore_cost_codes` (type-aware). The
   shared view is `src/lib/procoreValidCodes.ts` — both consumers (the
   `/cost-codes` persist gate `isValidProcoreCode` AND the export override modal)
   must read the DB list. Watch the **two reference sets**: `cost_code_map`
   (STEP 4) AND the `constants.ts` Site Ops codes (STEP 3) — Phase 3 put the Site
   Ops set under a drift check, but confirm the flip covers both.
4. **Demote `sync-codes` / the JSON to a drift check.** Repurpose
   `src/__tests__/procore-valid-codes-sync.test.ts` to report the known **7-code
   template delta** as an **accepted WARN** (stay green) rather than the JSON
   being canonical. The template still emits 224; eliminating the delta at the
   source is the follow-on Template + Catalog Reconciliation workstream, NOT here.
   Don't break the template-import path that also reads Importer Data Fields.
5. **Re-run BOTH goldens and prove $0.00** — STEP 4 McKenna AND GC/Site-Ops
   (STEP 2/3) export. Expectation: neither moves (the retired code never
   exported); the run proves it.

## ⛔ Approval gates (STOP and confirm with the architect)
- **Oracle flip + goldens** — golden-touching. Confirm **$0.00 on STEP 4 AND
  GC/Site-Ops** before commit.
- **The 7 tombstones + the linked-division validation exemption** — confirm the
  disposition with the architect before applying.
- **Supabase skill** — invoke `supabase:supabase` before any DB code. No new DDL
  expected (lifecycle columns exist), but data writes (retirements) touch the
  table — show what will be written first.

## Exit criteria
- `npm run test` green · `npx tsc --noEmit` clean
- Both goldens tie **$0.00** (STEP 4 + GC/Site-Ops)
- DB (`procore_cost_codes`) is the validation oracle; JSON is a warn-only drift check
- The 7 dropped codes are tombstoned; linked-division rows are exempt from validation
- Committed via `git commit -F <tempfile>` (architect rule: no inline multi-line)
- Handoff doc written via `/handoff` pointing to the **Template + Catalog
  Reconciliation** plan as the natural next workstream
- **Stop at the Phase 4 boundary** — do NOT start the reconciliation workstream
  (removing the 7 dead template codes / fixing the 67 type mismatches / etc.).

## Useful pointers
- DB reads: `getProcoreCostCodes()` in `src/lib/db.ts`; apply/retire:
  `applyProcoreCostCodesImport({ upserts, retireCodes })`.
- Pure type-reconciliation helpers (Phase 3): `src/lib/procoreTypeReconciliation.ts`.
- Site Ops drift check (Phase 3): `src/__tests__/site-ops-procore-codes-drift.test.ts`.
- Linked-division logic: grep `isLinkedDivisionRow` / `LINKED_DIVISION_ROWS`.
- Branch `procore-cost-codes-phase-1` is unpushed — P1 `60eb7e5`, P2 `323173d`,
  P3 `b0967aa`. Architect may want a push/PR after Phase 4.
