# Implementation Plan — GC & Site Ops Export + 32-1613 Re-Sync

> Scope: three workstreams — (A) GC/Site Ops export to Budget Line Items, (B-2) re-sync the
> `32-1313`→`32-1613` curb/site-concrete reclassification, (C) STEP 3 → STEP 4 cross-sheet linkage.
> See §0 for the full breakdown.

- **Project:** Takeoff Bridge (`C:\Users\BUrness\Dev\takeoff-bridge`)
- **Date authored:** 2026-06-05
- **Status:** READY TO START — (1) ✅ Phase 3c committed + merged 2026-06-05 (`0d3484b`, `6543a8e`); (2) ✅ template finalized + closed (no lock file). Remaining: commit the template's pending changes, then run the §11 kickoff.
- **Owner / approver:** System Architect (per `AGENTS.md`, plan must be approved before code delivery)
- **Prerequisite session:** ✅ SATISFIED — Phase 3c fully committed and merged

---

## 0. SCOPE EXPANSION (added 2026-06-05) — READ FIRST

This plan grew beyond the original "export GCs" goal. The user edited
`templates/Company_Estimate_Template.xlsx` directly (it was still open in Excel at authoring
time — a `~$Company_Estimate_Template.xlsx` lock file was present; do NOT commit that lock file).
The edits introduce THREE coupled workstreams:

**A. GC + Site Ops export** (original scope) — write computed values into the 34 STEP-2 and
38 STEP-3 sourced Budget Line Items rows.

**B. STEP 4 cost-code re-sync** (NEW — PARTIALLY reopened 2026-06-05). Two groups:

**B-1 — In sync, no action** (verified against `estimate-catalog.json` 2026-06-05):

| Code (template) | App catalog | Status |
|---|---|---|
| `03-0000.010` | Amenity Deck Topping Slab and Finished Slab | ✅ exact match |
| `03-0000.011` | Post Tension Concrete | ✅ exact match |
| `03-0000.012` | Concrete Patios | ✅ exact match |
| `03-4500.001` | Precast Architectural Concrete | ✅ exact match |

(An earlier draft listed a drift table from a mistaken `.001/.002/.003` listing; corrected to
`.010/.011/.012` — no drift for these four.)

**B-2 — GENUINE DRIFT, re-sync required.** The user reclassified the curb / site-concrete
items out of `32-1313` ("Concrete Paving") into a new `32-1613` ("Site Concrete") group, AND
repurposed the vacated `32-1313.001` slot as a real "Concrete Paving" line. User explicitly
confirmed both rollup targets — this is the AGENTS.md authorization to apply them.

**Moved items** (changed itemId AND rollup → `32-321613.000` Site Concrete):

| Item | OLD itemId | NEW itemId | OLD procoreCode | NEW procoreCode |
|---|---|---|---|---|
| Surmountable Curb | `32-1313.001` | `32-1613.002` | `32-321313.000` | `32-321613.000` |
| B612 Curb | `32-1313.002` | `32-1613.003` | `32-321313.000` | `32-321613.000` |
| Cross Gutter | `32-1313.003` | `32-1613.004` | `32-321313.000` | `32-321613.000` |
| Light Duty Concrete | `32-1313.004` | `32-1613.005` | `32-321313.000` | `32-321613.000` |
| Heavy Duty Concrete | `32-1313.005` | `32-1613.006` | `32-321313.000` | `32-321613.000` |

**Repurposed slot** (itemId retained, description changes, rollup UNCHANGED):

| itemId | OLD description | NEW description | procoreCode (unchanged) |
|---|---|---|---|
| `32-1313.001` | Surmountable Curb | Concrete Paving | `32-321313.000` (Concrete Paving) |

- Parent `32-1613.001` "Site Concrete" already exists in the catalog → the five moved items slot in
  as `.002`–`.006` beneath it.
- `32-1313.001` is NOT removed — it stays, now holding the "Concrete Paving" line (rolls to
  `32-321313.000`). So `32-1313` is NOT an empty group after the move.
- Net itemId removals: only `32-1313.002`, `.003`, `.004`, `.005` (their items moved to `32-1613`).
- Preserve each item's `targetUom` / `defaultUnitPrice` / `costType` from the template during re-harvest
  (do NOT invent values).

Re-sync steps for B-2 (Phase 3c now committed — harvest/seed scripts are the live baseline, see §9;
route all procoreCode assignment through the `resolveProcoreCode` chokepoint):
1. Re-run `npm run sync-codes` against the finalized template → regenerates `estimate-catalog.json`.
   `32-1313.001` description becomes "Concrete Paving" (rollup unchanged); `32-1313.002–.005`
   disappear; `32-1613.002–.006` appear with `procoreCode: 32-321613.000`. ⚠️ Requires the template's
   BLI "Site Concrete" SUMIF criteria to reference the new `32-1613` codes — verify forensically.
2. Re-run `npm run generate-seed` → updated seed.
3. **Migration (present DDL for approval):** INSERT new `32-1613.002–.006` rows into `cost_code_map`,
   UPDATE `32-1313.001` description, and DELETE the obsolete `32-1313.002–.005` rows (seed
   `ON CONFLICT DO NOTHING` does none of these).
4. Query `estimate_line_items` for any rows on `32-1313.001–.005`. Surface count + projects to the
   user. `32-1313.001` rows keep their code but the line meaning shifted (Surmountable Curb →
   Concrete Paving) — flag for review. Do NOT silently rewrite. User decides per project.

→ Remaining work: A (GC/Site Ops export), B-2 (the 32-1313→32-1613 re-sync), C (STEP 3→STEP 4 linkage).

**C. STEP 3 → STEP 4 cross-sheet linkage** (NEW) — the user reports several STEP 3 Site Ops
BLIs are linked to BLIs in STEP 4. This is a cross-sheet dependency: some Site Ops dollars flow
*through* STEP 4 rows rather than rolling up independently. The exact cell-level links MUST be
traced forensically in the FINALIZED template before the export write order can be designed
(you cannot write a STEP 4 BLI value until the STEP 3 contributions feeding it are resolved).

**D. Source of truth — user-confirmed mappings, NOT template SUMIFs** (governs A, B, C).
The user did not author the template's SUMIF formulas and has now stated the correct rollups as
fact (e.g. `32-1613.002` → `32-321613.000`, `32-1313.001` → `32-321313.000`). The architecture
must treat the user's confirmed mapping as authoritative and the legacy SUMIF formulas as merely
advisory. Enforcement rules for the implementation session:

1. **App owns the rollup.** The export computes rollups via `rollupByProcoreCode` from the catalog
   `procoreCode` (= encoded user intent) and writes the computed VALUE into each BLI cell,
   overwriting the formula. After workstream A, no SUMIF survives in the exported file — a wrong
   legacy formula therefore cannot produce a wrong rollup.
2. **Row identification does not trust the SUMIF criterion.** Identify each BLI row by its own
   Procore code column, validated against the "Importer Data Fields" sheet (official Procore code
   registry) and `src/lib/procore-valid-codes.json`. Never derive a row's destination from the
   SUMIF criterion alone.
3. **Diff, don't defer.** During the forensic read, compare what each SUMIF would do against the
   user-confirmed mapping. On ANY disagreement: surface it to the user (do not auto-resolve). The
   user's stated mapping wins; the SUMIF is recorded as a legacy bug. AGENTS.md: no speculative
   financial changes, missing/conflicting mappings trigger user override.
4. **Validate every procoreCode exists in Procore.** Cross-check each catalog `procoreCode` against
   `procore-valid-codes.json` so a mapping can't point at a code Procore doesn't recognize.
5. **Backstops remain:** completeness gate (every dollar-row has a destination) + reconciliation
   gate (Σ line items == Σ BLI). NOTE: reconciliation catches missing dollars but NOT a dollar sent
   to a wrong-but-valid BLI — rule 3 (diff) + rule 4 (validation) cover that semantic class.

Practical effect: encode the user's confirmed mappings into `cost_code_map` / catalog as the
"expected" set; the forensic read becomes a verification cross-check, never the authority.

---

## 1. Objective

Close the gap where General Conditions (Division 01) and Site Operations (Division 02) costs are
correctly calculated in the app but **never reach the exported Excel workbook or the Procore budget**,
AND bring the app's cost-code catalog back into sync with the corrected template.

After this phase:
- All 217 Budget Line Items rows in the exported workbook carry app-computed values (no live SUMIFs remain)
- The Procore CSV export includes GC and Site Ops dollars
- The reconciliation gate covers GC + Site Ops + STEP 4 estimate rows as a single unified total
- `estimate-catalog.json` + Supabase `cost_code_map` match the corrected template exactly
- Existing project line items carrying re-meaninged codes are surfaced for user review (no silent rewrite)

---

## 2. Background and Current State

### What the app computes today
- `usePersonnelCalculations` → `computePersonnelCosts()` → `totalGCs` (Division 01 grand total)
- `useInfrastructureCalculations` → `computeSiteOperations()` → `siteOperationsTotal` (Division 02 grand total)
- Both are saved to the database and load correctly per project.

### What the export does today
`generateExcelWorkbook()` in `src/lib/exporter.ts` receives only `ProcessedTakeoffRow[]` (STEP 4 data).
It writes computed values into the 144 STEP-4-sourced Budget Line Items rows.
The 34 BLI rows sourced from STEP 2 (GCs) and 38 BLI rows sourced from STEP 3 (Site Ops) are
**preserved as live SUMIFs** that feed on blank sheets → they produce $0 in every export.

### The Phase 2 decision that is now superseded
Phase 2 preserved STEP 2/3 SUMIFs on the assumption that estimators would fill those sheets
manually in Excel after export. That assumption is wrong: the app owns GC and Site Ops data.
The correct architecture is: **the app writes computed values for all 217 BLI rows**.
No SUMIFs need to survive in the exported workbook.

### Template location
`templates/Company_Estimate_Template.xlsx` in the repo root (still present).
This is also uploaded to the private Supabase Storage bucket (`templates` bucket,
object name = `MASTER_TEMPLATE_NAME` from `src/lib/constants.ts`).
The export pipeline downloads from Storage; the repo copy is available for forensic inspection.

---

## 3. Critical Prerequisites — Start of Session Tasks

**The user updated cost codes directly in `templates/Company_Estimate_Template.xlsx`**
(STEP 2 - GCs, STEP 3 - SITE OPS, and 5 STEP 4 codes). These changes are NOT yet reflected in
`src/lib/constants.ts`, `src/lib/estimate-catalog.json`, or the Supabase `cost_code_map`.

**Gate checks before ANY code is written:**
1. **Template finalized?** ✅ Confirmed 2026-06-05 — saved, closed, no `~$` lock file. (Commit the
   template's pending changes before re-harvesting so the harvest runs against the tracked baseline.)
2. **Phase 3c committed?** ✅ SATISFIED — Phase 3c merged 2026-06-05 (`0d3484b`, `6543a8e`). The
   harvest/seed scripts and `resolveProcoreCode` chokepoint are now the committed baseline (see §9).
3. **Forensic read** of the FINALIZED `templates/Company_Estimate_Template.xlsx` (unzip + parse XML,
   same method as Phase 1):
   - STEP 2 BLI SUMIF criteria (column G) for the 34 STEP-2-sourced rows
   - STEP 3 BLI SUMIF criteria for the 38 STEP-3-sourced rows
   - **STEP 3 → STEP 4 cross-sheet references** (which STEP 3 cells/formulas point at STEP 4 cells,
     and which BLI rows depend on that chain) — see §0.C
   - The 5 corrected STEP 4 codes and their current descriptions/positions
4. **Confirm with the user**, code by code, the `procoreCode` (granular Procore BLI) each
   re-meaninged STEP 4 code should map to. Do not infer. AGENTS.md: no speculative financial mappings.

> **Do not proceed past these gates without explicit user confirmation of every re-meaninged mapping.**

### STEP 4 code re-sync (B-1 resolved; B-2 required)

- **B-1** (`03-0000.010/.011/.012`, `03-4500.001`): verified in sync — no action.
- **B-2** (`32-1313.001–.005` → `32-1613.002–.006`, rollup → `32-321613.000` Site Concrete):
  GENUINE drift, re-sync required. Full mapping table and the 4 re-sync steps are in §0.B.
  Phase 3c committed — harvest/seed scripts are the live baseline; route procoreCode assignment
  through `resolveProcoreCode`. Step 3 needs a migration (present DDL for approval); step 4 surfaces
  affected `estimate_line_items` for user review — no silent rewrite.

---

## 4. Architecture Decision (pre-approved)

### Chosen approach: Direct BLI value write for all 217 rows

The app will write a computed dollar value into **every** BLI column-H cell:

| BLI source | Rows | Current | Target |
|---|---|---|---|
| STEP 4 — Estimate | 144 | App computes ✅ | No change |
| STEP 2 — GCs | 34 | Live SUMIF → $0 ❌ | App computes ✅ |
| STEP 3 — Site Ops | 38 | Live SUMIF → $0 ❌ | App computes ✅ |
| Broken #REF! row | 1 | Already fixed ✅ | No change |

### Why not inject synthetic STEP 4 rows for `01-0000.001` / `02-0000.001`

That shortcut was considered and rejected: it would correctly feed the one BLI row for the
division total but leave the 33 other granular GC BLI rows (and 37 Site Ops BLI rows) at $0.
Those granular rows have individual Procore BLI codes that the Procore import needs separately.

### GC line items → BLI mapping

Each computed GC line maps to one BLI row via its cost code matching the SUMIF criterion.
The GC lines are:
- 8 staff roles (`STAFF_ROLE_DEFAULTS`) — codes in `src/lib/constants.ts`
- 3 operational expenses (`OPERATIONAL_EXPENSE_DEFAULTS`) — codes in `src/lib/constants.ts`
- 3 equipment overrides (dumpsters, toilets, electric) — codes in `PersonnelPricingStep.tsx`

The Site Ops lines are:
- 3 dynamic rows (safety, temp protection, material hoist) — codes in `InfrastructureStep.tsx`
- 4 manual rows (knox, payroll cleaning, hired cleaning, soil borings) — codes in `InfrastructureStep.tsx`

**After the forensic step, update all codes in `src/lib/constants.ts` to match the confirmed
SUMIF criteria exactly.**

---

## 5. Files to Touch

| File | Change |
|---|---|
| `src/lib/constants.ts` | Update `STAFF_ROLE_DEFAULTS` and `OPERATIONAL_EXPENSE_DEFAULTS` codes to match confirmed STEP 2 SUMIF criteria. Add `EQ_DISPLAY` items (dumpsters/toilets/electric) to a new `EQUIPMENT_DEFAULTS` export so they have a single source of truth. Add Site Ops codes to `SAFETY_RATE_*`, `KNOX_BOX_*` etc. constants. |
| `src/lib/calculations.ts` | Ensure `computePersonnelCosts()` and `computeSiteOperations()` return result objects that include the per-line `{ code, total }` pairs — these are already in `PersonnelCalcResult.staffLines` / `operationalLines`. Verify the return shapes include all codes needed for BLI writing. |
| `src/lib/exporter.ts` | `generateExcelWorkbook()`: add `gcCalcResult: PersonnelCalcResult`, `gcEquipment: { dumpsters: number; toilets: number; electric: number }`, and `siteOpsCalcResult: SiteOpsCalcResult` parameters. Build a `gcRollup: Map<string, number>` and `siteOpsRollup: Map<string, number>` from those inputs. In the BLI write loop, when a BLI row's SUMIF criterion matches a code in `gcRollup` or `siteOpsRollup`, write the computed value (replacing the live SUMIF) exactly as done for STEP 4 rows. |
| `src/hooks/useExportHandlers.ts` | Thread `gcCalcResult`, `gcEquipment`, and `siteOpsCalcResult` from the hook's parameters into `generateExcelWorkbook()`. The hook already receives `project` — add the calc results alongside it. |
| `src/app/projects/[projectId]/page.tsx` | Pass `gcCalcResult`, `equipment`, and `siteOpsCalcResult` from their respective hooks down to `useExportHandlers`. |
| `src/__tests__/export-integrity.test.ts` | Add tests: (a) GC subtotal appears in BLI for each expected GC code; (b) Site Ops subtotal appears in BLI for each expected code; (c) full 217-row reconciliation tie-out with GC+Site Ops included; (d) confirm no live SUMIFs remain in the GC/Site Ops BLI rows after export. |

---

## 6. BLI Write Logic Change (exporter.ts detail)

The existing BLI write loop in `generateExcelWorkbook()` (around line 1391) currently:
- Builds `procoreRollup` from STEP 4 rows only
- Writes values for STEP-4-sourced rows, skips STEP-2/3-sourced rows

The change:
```typescript
// Build combined rollup: STEP 4 rows + GC lines + Site Ops lines
const gcLineRollup = new Map<string, number>();
for (const line of gcCalcResult.staffLines) gcLineRollup.set(line.code, line.total);
for (const line of gcCalcResult.operationalLines) gcLineRollup.set(line.code, line.total);
gcLineRollup.set(EQUIPMENT_DEFAULTS.dumpsters.code, gcEquipment.dumpsters);
gcLineRollup.set(EQUIPMENT_DEFAULTS.toilets.code, gcEquipment.toilets);
gcLineRollup.set(EQUIPMENT_DEFAULTS.electric.code, gcEquipment.electric);

const siteOpsLineRollup = new Map<string, number>();
// ... similar, from siteOpsCalcResult lines

// In the BLI write loop:
// Instead of "skip STEP 2/3 rows", write from gcLineRollup / siteOpsLineRollup
// when the criterion code matches. Same setCellValue pattern as STEP 4 rows.
```

The internal tie-out (line ~1499) must be updated to include GC and Site Ops totals in
`rollupTotal` so the reconciliation gate covers the full estimate.

> **⚠️ Cross-sheet linkage caveat (§0.C):** the simple "match criterion code → write value" loop
> above assumes each BLI row's dollars come from exactly one source sheet. The STEP 3 → STEP 4
> links break that assumption for some Site Ops rows. The forensic read (§3.3) must produce a
> dependency map FIRST; the write order then resolves STEP 3 contributions before any STEP 4 BLI
> row that depends on them. Do not finalize this loop until the linkage is mapped.

---

## 7. Reconciliation Gate Update

`validateExportReadiness()` currently only validates STEP 4 `ProcessedTakeoffRow[]`.
It does not know about GC or Site Ops totals.

Two options — choose at implementation time with user approval:

**Option A (Recommended):** Extend `validateExportReadiness()` to accept optional
`gcTotal` and `siteOpsTotal` parameters and include them in the reconciliation sum.
The gate becomes: Σ(line items) + gcTotal + siteOpsTotal = Σ(all BLI rows).

**Option B:** Keep the gate STEP-4-only and rely solely on the exporter's internal
tie-out (which already throws on mismatch). Simpler but the gate no longer represents
the full estimate.

Option A is preferred for transparency.

---

## 8. STEP 2 / STEP 3 Sheets in the Exported Workbook

Once the app writes all 34 + 38 BLI values directly, the STEP 2 and STEP 3 sheets
in the exported workbook become informational only (the BLI no longer depends on them).

**Decision for implementation session:** leave STEP 2/3 blank (current behavior) OR
write the GC/Site Ops line items into STEP 2/3 for the estimator's reference.

Leaving them blank is simpler and safe. Writing them is nicer UX (the estimator sees
where the numbers came from) but requires mapping each line to the correct STEP 2/3
row — more work. Defer to user at session start.

---

## 9. Phase 3c Baseline — Now Committed (was "do not touch")

Phase 3c merged 2026-06-05 (`0d3484b`, `6543a8e`). The files below were off-limits while 3c was
in flight; they are now the **committed baseline** and may be modified by this work as needed:

```
src/lib/db.ts
src/lib/parser.ts
src/hooks/useCellEditing.ts
src/hooks/useTakeoffWorkbook.tsx
src/components/workspace/ExportOverrideModal.tsx
src/components/layout/Sidebar.tsx
scripts/harvest-cost-codes.js          ← used by B-2 re-sync (`npm run sync-codes`)
scripts/generate-cost-code-map-seed.js ← used by B-2 re-sync (`npm run generate-seed`)
src/app/cost-codes/                     ← the mapping-editor UI (the cost_code_map UPDATE path)
src/lib/costCodeResolver.ts             ← resolveProcoreCode chokepoint — single source for procoreCode
src/lib/procore-valid-codes.json        ← Procore-code validation oracle (§0.D rule 4)
e2e/*mapping-verify*.spec.ts            ← gated behind `npm run test:e2e:mapping`
```

**Important — build on the chokepoint, don't bypass it:** Phase 3c introduced
`resolveProcoreCode` (`src/lib/costCodeResolver.ts`) as the single source of truth for a row's
`procoreCode`, backed by `cost_code_map`. The B-2 re-sync and any new procoreCode assignment MUST
go through it — do not reintroduce direct catalog lookups (that was the dual-source-of-truth risk
3c was built to close).

---

## 10. Verification Gate

Run after every sub-step. All must pass before delivery.

1. `npm run build` → zero TypeScript/lint/build errors
2. `npm run test` → all suites green (no regressions; new tests added in §5 must pass)
3. Manual: export a project with known GC inputs → open workbook → Budget Line Items sheet →
   confirm GC rows show computed values (not formula strings or $0)
4. Manual: export → Procore CSV → confirm GC and Site Ops dollars appear under correct BLI codes
5. Manual: confirm reconciliation gate passes (no export-blocked error for GC/Site Ops mismatch)
6. If STEP 2/3 writing is implemented: open exported workbook → STEP 2 → confirm line items
   match what the app's GC table shows

---

## 11. Session Kickoff Prompts

**Run ONE phase per fresh context window** (per project convention — fresh context yields higher
implementation quality). Each phase ends with: tests green → commit → a short handoff note appended
to §13 for the next phase. Do not start the next phase in the same window.

The per-phase scope, dependencies, exit criteria, and copy-paste kickoff prompts live in
**§13 — Phasing & Sequencing**. Start with **Phase 1 (read-only forensic verify)** — it is safe to
run immediately and de-risks everything downstream.

---

## 12. Open Decisions (resolve at session start)

| # | Decision | Status / Options |
|---|---|---|
| 1 | Confirm finalized STEP 2 / STEP 3 codes | Forensic read of finalized template (closed 2026-06-05) |
| 2 | Map STEP 3 → STEP 4 cross-sheet links | Forensic read (§0.C) drives the export write order |
| 3 | B-2 re-sync: migration DDL for `cost_code_map` (add `32-1613.002–.006`, update `32-1313.001` desc, drop `32-1313.002–.005`) | Present DDL for approval (§0.B) |
| 4 | Existing line items on `32-1313.001–.005` | Surface for user review — no silent rewrite (`.001` meaning shifted) |
| 5 | Reconciliation gate: Option A or B | Recommend A (full coverage) |
| 6 | Write GC/Site Ops detail into STEP 2/3 sheets | Blank (simple) vs written (better UX) |
| 7 | Make GC staff rates editable per project | Scope in or defer — hook already supports `rateOverrides` |

---

## 13. Phasing & Sequencing

**One phase per fresh context window.** Each phase: implement → `npm run build` + `npm run test`
green → commit → append a 3–5 line handoff note under "Handoff log" below. Workstream **D**
(source-of-truth rule, §0.D) governs every phase — it is a principle, not a phase.

Dependency order: **P1 → P2 → P3 → P4**. P1 is read-only and can run today. P2 depends on P1's
confirmed mapping. P3 depends on P2's corrected catalog + P1's linkage map. P4 is optional polish.

### Phase 1 — Forensic Verification (READ-ONLY, no source changes)
- **Goal:** prove the template's formulas agree with the user's confirmed mappings BEFORE any code.
- **Do:**
  1. Encode the §0.B confirmed mappings as an "expected" table (scratch/doc artifact, not source yet).
  2. Forensic read of `templates/Company_Estimate_Template.xlsx` (unzip + parse XML, Phase 1 method):
     STEP 2 BLI SUMIF criteria (34 rows), STEP 3 BLI SUMIF criteria (38 rows), the STEP 3→STEP 4
     cross-sheet references (§0.C), and the 32-1313 / 32-1613 codes.
  3. DIFF expected vs actual; validate every procoreCode against `src/lib/procore-valid-codes.json`.
  4. Produce a findings doc: confirmed mapping table + STEP 3→STEP 4 dependency map + discrepancy
     list. Surface discrepancies to the user; user signs off (their mapping wins, §0.D).
- **Exit:** findings doc written under `docs/plans/` and committed (DOCS ONLY — zero source/catalog/DB
  changes). User has signed off on any discrepancy.
- **Output for next phase:** the confirmed mapping + dependency map P2/P3 build on.

### Phase 2 — B-2 Catalog / DB Re-Sync
- **Goal:** bring `estimate-catalog.json` + `cost_code_map` in line with the corrected template.
- **Do (per §0.B B-2 steps):** `npm run sync-codes` → `npm run generate-seed` → migration
  (present DDL for approval: INSERT `32-1613.002–.006`, UPDATE `32-1313.001` desc, DELETE
  `32-1313.002–.005`) → query + surface affected `estimate_line_items` (no silent rewrite).
  Route all procoreCode assignment through `resolveProcoreCode` (do not bypass the chokepoint).
- **Guardrails:** migration runs on a Supabase branch first (AGENTS.md); `supabase_schema.sql`
  updated first if schema changes; line-item writes only via the RPC.
- **Exit:** build + test green; migration verified on branch then applied; committed. Catalog +
  `cost_code_map` match the template; SQL tie-out passes.

### Phase 3 — GC + Site Ops Export (workstreams A + C)
- **Goal:** write GC + Site Ops computed values into all 34 + 38 BLI rows; no surviving SUMIFs.
- **Do (per §4–§7):** thread `gcCalcResult` / `gcEquipment` / `siteOpsCalcResult` into
  `generateExcelWorkbook` (§5); write the BLI rows using the §6 logic and the P1 dependency map for
  STEP 3→STEP 4 write order; update `constants.ts` GC/Site Ops codes to the P1-confirmed criteria;
  extend `validateExportReadiness` to include GC + Site Ops (§7 Option A); add the §5 tests.
- **Exit:** build + test green; manual export of a known project ties out (BLI shows computed GC +
  Site Ops values, reconciliation passes); committed.

### Phase 4 — Optional Polish (independently shippable)
- Write GC/Site Ops line detail into STEP 2/3 sheets for estimator reference (§8).
- Make GC staff rates editable per project (hook already accepts `rateOverrides`).
- Each is its own small phase/commit; do only if the user wants them.

### Handoff log
(Each phase appends 3–5 lines here on completion: what landed, commit hash, anything the next
phase must know. Empty until Phase 1 runs.)

- **Phase 1 (2026-06-05, commit `461b6dc`):** Forensic verify complete — findings in
  `docs/plans/2026-06-05-gc-siteops-phase1-findings.md`. Template AGREES with user mappings
  (B-1 in sync; B-2 fully present; all 217 BLI codes valid; valid-codes artifact current at 224).
  §0.C direction was backwards: STEP 4 rows 12–24 pull FROM STEP 2/3 subtotals; no BLI row references
  them → **no BLI write-order constraint** (drop §6 caveat). Discrepancies D1–D3 await user sign-off
  (D1: 32-1613 children resolve via sibling inference; D2: 4 source lines lack BLI rows, incl. the
  app's hired-cleaning line 02-9010.002; D3: write $0 to broken 1-10000.000). Phase 2 inputs in
  findings §7. **D1–D3 ALL SIGNED OFF by user 2026-06-05** (recorded in findings §9) — Phase 2 may
  start with no open questions.

---

## 14. Per-Phase Kickoff Prompts

Copy the block for the phase you are starting into a fresh window.

### → Phase 1 (read-only forensic verify — safe to run now)

> Implement **Phase 1 only** of `docs/plans/gc-siteops-export-step2-step3.md`. Read the whole plan
> first (esp. §0, §3, §13). Phase 1 is READ-ONLY: do not change any source, catalog, or DB.
> Encode my confirmed mappings (§0.B) as an expected table, forensically read
> `templates/Company_Estimate_Template.xlsx` (STEP 2 + STEP 3 BLI SUMIF criteria, the STEP 3→STEP 4
> cross-sheet links, and the 32-1313/32-1613 codes), DIFF expected vs actual, validate every
> procoreCode against `src/lib/procore-valid-codes.json`, and write a findings doc under `docs/plans/`
> with a discrepancy list for my sign-off. My mapping is authoritative; the SUMIFs are advisory (§0.D).
> Commit the findings doc only, then append a handoff note to §13. Model: Claude Opus (latest).

### → Phase 2 (catalog/DB re-sync — after P1 sign-off)

> Implement **Phase 2 only** of `docs/plans/gc-siteops-export-step2-step3.md` (§0.B B-2, §13).
> Read the plan and the Phase 1 findings/handoff first. Re-sync the catalog + `cost_code_map` to the
> corrected template via `npm run sync-codes` → `npm run generate-seed` → a migration (present the
> DDL for my approval BEFORE running it; run on a Supabase branch first per AGENTS.md). Surface any
> existing `estimate_line_items` on `32-1313.001–.005` for my review — no silent rewrite. Route all
> procoreCode assignment through `resolveProcoreCode`. Get build + tests green, commit, append a
> handoff note to §13. Invoke the supabase skill before touching DB code. Model: Claude Opus (latest).

### → Phase 3 (GC + Site Ops export — after P2)

> Implement **Phase 3 only** of `docs/plans/gc-siteops-export-step2-step3.md` (workstreams A + C;
> §4–§7, §13). Read the plan and the Phase 1 + Phase 2 handoffs first. Thread the GC and Site Ops
> calc results into `generateExcelWorkbook`, write computed values into all 34 GC + 38 Site Ops BLI
> rows (use the Phase 1 STEP 3→STEP 4 dependency map for write order), update `constants.ts` codes to
> the Phase 1-confirmed criteria, extend `validateExportReadiness` to cover GC + Site Ops (§7 Option
> A), and add the §5 tests. Present a plan table for my approval before editing. Get build + tests
> green, verify a manual export ties out, commit, append a handoff note. Model: Claude Opus (latest).

**Resolved (B-1):** `03-0000.010/.011/.012` and `03-4500.001` verified in sync — no changes needed.
**Resolved:** `32-1313` empty-parent question — `32-1313.001` is repurposed as the Concrete Paving line, so the group is not empty.
