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

### Phases 4–6 — RESEQUENCED 2026-06-06 (user-approved after Phase 3 close)

> Original "Phase 4 — Optional Polish" is now **Phase 6**. Rationale: writing STEP 2/3 sheet
> detail before full input coverage would emit only the 7 existing lines and be redone after
> the missing ~54 input lines land. User approved: inputs → linkage → polish, with Site Ops
> and GC input coverage combined in one phase.

### Phase 4 — Full GC + Site Ops input coverage (Site Ops + GC together)
- **Goal:** every template STEP 2/3 source line has an input row in the app, so no GC/Site Ops
  BLI row is stuck at $0 for lack of a place to type. Closes findings §6's gap: app covers only
  14/34 GC + 6/38 Site Ops criteria today (~20 GC + ~34 Site Ops lines missing).
- **Do:** extend the Phase 3 constants pattern (`SITE_OPS_*_DEFAULTS` / GC arrays in
  `src/lib/constants.ts`) with the missing lines — codes/descriptions/units/default rates
  harvested forensically from the template STEP 2/3 sheets (never invented); BLI codes from
  findings §4 tables; D2 orphans (`01-5110.002`, `02-4100.002`, `02-9200.002`) → sibling BLI
  codes per the §9 sign-off. UI rows on the Step 2/Step 3 pages (group per the template's
  subtotal sections); persist new quantities via the existing estimate-snapshot JSONB shapes
  (verify no schema change needed; if one is, `supabase_schema.sql` first + approval).
  **Zero exporter changes expected** — Phase 3's rollup/gate/tests are generic; extend test
  coverage counts only.
- ⚠️ Derive the line list from findings §4 / the template, NOT from hand-copied lists — the
  user's 2026-06-06 list was missing `02-9005.001` Final Cleaning.
- **Decisions at session start:** which new lines are dynamic (duration/sqft-driven) vs manual;
  confirm template default rates; the two %-of-estimate-total GC lines (`01-0610.001` Safety
  Consultant, `01-1600.001` Procore — see findings §5.2) need a computation decision.
- **Exit:** build + tests green; export of a project using new lines ties out; commit + handoff.

### Phase 5 — Estimate-page linkage (01-0000.001 / 02-0000.001)
- **Goal:** the STEP 4 estimate page shows GC + Site Ops totals (read-only, linked from the
  Step 2/3 modules) the way the template's STEP 4 rows 12–24 pull STEP 2/3 subtotals — so the
  on-page subtotal, modifiers (fee/contingency/insurance %), and cost-per-SF include them.
- **Financial decision (user must sign off — calculations.ts authority):** whether the modifier
  basis includes GC + Site Ops. The template says yes (modifiers compute on I331, which includes
  rows 12–24); the app today computes modifiers on STEP 4 grid rows only.
- **Guard:** keep linked rows OUT of the Procore rollup (granular rows carry the dollars) and
  close the double-count trap — manually-typed dollars on `01-0000.001`→`1-10000.000` /
  `02-0000.001`→`2-20000.000` currently reach Procore alongside the granular GC/Site Ops rows.
- **Exit:** build + tests green; reconciliation still passes; commit + handoff.

### Phase 6 — Polish (was Phase 4; independently shippable)
- Write GC/Site Ops line detail into STEP 2/3 sheets for estimator reference (§8) — now
  complete in one pass since Phase 4 delivered full input coverage.
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

- **Phase 2 (2026-06-06, commit `5597048`):** B-2 re-sync complete. `sync-codes` + `generate-seed` rerun against the
  finalized template (0 unresolved, 0 invalid, valid-codes steady at 224); catalog verified against
  all Phase 1 expected facts (`scripts/verify-phase2-resync.js`). Migration run on Supabase branch
  first, then production main with user approval; full tie-out passed — all 221 `cost_code_map` rows
  match the regenerated seed (`scripts/phase2-db-tieout.js`). **Corrections vs plan:** (a) net count
  is 221→221, not 221→222 — the old catalog had a `32-1313.000` "Concrete Paving" entry the plan
  missed; it was DELETEd too; (b) `cost_code_map` has no description column, so the "update .001
  description" step became `source: 'sibling'→'template'`. Affected `estimate_line_items`: 5 rows,
  all "Test Project 001", all $0/qty-0 template shells — surfaced to user, left untouched (the
  `32-1313.001` row there still reads "Surmountable Curb"). **Phase 3 must know:** DB + catalog now
  match the template; no schema change (so `supabase_schema.sql` untouched, but its embedded seed
  comment block reflects the new state via `supabase_seed_cost_code_map.sql`); D2 orphan-line
  mappings (findings §9) remain Phase 3 inputs, not yet encoded anywhere.

- **Phase 3 (2026-06-06, commit `370e66b`):** GC + Site Ops export complete — all 217 BLI rows now carry computed
  values; no live SUMIF survives (verified by test + artifact inspection, 14/14 spot checks).
  Mapping home decision: the 20 GC/Site Ops line configs live in `constants.ts` (template-aligned
  `.001` criteria + user-confirmed BLI codes incl. D2; validated against `procore-valid-codes.json`
  by a new constants test) — NOT in `cost_code_map`, which stays STEP 4-only; `resolveProcoreCode`
  untouched. §7 Option A implemented (gate = Σ line items + GC + Site Ops); Procore CSV also carries
  GC/Site Ops rows (staff as "L", rest "M", per template BLI col B). Deviation from plan §5/§6:
  no separate `gcEquipment` param — equipment lines fold into `PersonnelCalcResult.equipmentLines`.
  Threading runs page.tsx → `useTakeoffWorkbook` → `useExportHandlers` (plan table missed the
  middle hop). **Phase 4 must know:** STEP 2/3 sheets still export blank (§8 deferred); per-project
  staff rates deferred (hook accepts `rateOverrides`); `computeSiteOperations` units for cleaning
  lines changed "ea"→"hr" (display-only); D3 note — the broken `1-10000.000` row gets the STEP 4
  rollup value (normally $0), so estimator-entered dollars on the STEP 4 GC grid rows are preserved,
  not forced to zero.

- **Phase 4 (2026-06-06, commit `73fadf9`):** Full GC + Site Ops input coverage —
  21 new GC lines (10 auto duration/sqft÷3000 lines extending `OPERATIONAL_EXPENSE_DEFAULTS`; 11 manual
  in new `GC_MANUAL_DEFAULTS`) + 34 new Site Ops lines (`SITE_OPS_MANUAL_DEFAULTS` with entry kinds
  qty/qtyRate/lumpSum, grouped by `SITE_OPS_SECTIONS` mirroring the template's 8 subtotal sections).
  All 34 GC + 38 Site Ops BLI codes now reachable (constants test asserts the counts). The two %-lines
  (`01-0610.001`/`01-1600.001`) are typed-$ with a live % hint off totalEstimatedCost — NOT auto-computed
  (avoids the Phase 5 circularity trap). **Cost-type catch:** FFE Relocation `2-25100.000` is "S" per
  template BLI col B (absent from the Phase 3 list — re-verified forensically, encoded + tested).
  Persistence: new GC entries ride `gc_equipment_overrides` JSONB, new Site Ops keys ride
  `site_ops_quantities` (legacy `qty…`/`rate…` keys preserved for saved projects) — NO schema change.
  Exporter: one generic spread (`gcCalcResult.manualLines`) added to `collectGcSiteOpsLines`;
  rollup/gate/CSV machinery untouched. Manual export verified: gate delta $0, 10 new-line spot checks
  tie out across workbook BLI + Procore CSV. **Phase 5 must know:** STEP 4 page still excludes GC/Site Ops
  totals (that linkage IS Phase 5, incl. the modifier-basis decision); per-project editable rates remain
  Phase 6; `computePersonnelCosts` signature now `(duration, sqft, utilizations, equipment, manualEntries, rateOverrides?)`.

- **Phase 5 (2026-06-06):** Estimate-page linkage + double-count closure. User sign-offs: modifier basis
  INCLUDES GC + Site Ops (matches template I331); linked values display ON the 10 STEP 4 grid rows
  (read-only, 🔗 source hint); template codes kept as-is (suffixes are sequence numbers — no re-sync);
  trap closed via exclude + lock. New `LINKED_DIVISION_ROWS`/`SUPERVISION_STAFF_CODES` (constants.ts) +
  `computeLinkedDivisionTotals` (calculations.ts); `computeTakeoffSummary` gains a `linkedTotals` param
  (subtotal/modifiers/cost-per-SF on the whole job; linked rows' typed qty×price counts NOWHERE — stray
  dollars surfaced via amber banner, rows editable until cleared, else hard-locked + undeletable).
  Exporter: linked rows skipped in `rollupByProcoreCode`/gate/CSV (`1-10000.000` = $0, `2-20000.000`
  never appended); STEP 4 sheet rows 12–24 now export qty 1 × computed Step 2/3 subtotals as values, so
  the workbook's I331/modifier formulas match the app. Manual tie-out verified incl. a stray-$25k case
  (gate delta $0; CSV/BLI carry no division-parent dollars). DB query confirmed zero existing projects
  had dollars on the 10 rows. Build + 223 unit tests green. **Phase 6 must know:** STEP 2/3 sheets still
  export blank — once P6 writes their line detail, the template's col-S checks on rows 12–24 will tie out
  against the values P5 writes; per-project staff rates still pending (`rateOverrides` hook param ready);
  test fixture note: `div02Row` in export-integrity.test.ts was re-pointed to a non-linked itemId.

- **Resequencing (2026-06-06, user-approved):** remaining work reordered to Phase 4 (full Site Ops
  + GC input coverage, combined), Phase 5 (estimate-page linkage of GC/Site Ops totals incl. the
  modifier-basis decision), Phase 6 (old Phase 4 polish: STEP 2/3 sheet detail + editable rates).
  Rationale: sheet detail written once against the complete line set; inputs unblock estimators
  soonest. See the resequenced phase definitions above.

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

### → Phase 2 (catalog/DB re-sync — P1 signed off 2026-06-05, ready to run)

> *(Enriched 2026-06-05 with Phase 1 verified facts — supersedes the original generic block.)*

```
Implement PHASE 2 ONLY of the plan at:
docs/plans/gc-siteops-export-step2-step3.md
Read the whole plan first — especially §0.B (B-2 re-sync steps), §9 (Phase 3c
baseline + resolveProcoreCode chokepoint), and §13 (Phase 2 scope). Then read
the Phase 1 findings doc: docs/plans/2026-06-05-gc-siteops-phase1-findings.md
— especially §7 (Phase 2 inputs) and §9 (my sign-off). This is a phased plan:
do Phase 2 and nothing else, then stop.
== CONTEXT ==
Takeoff Bridge is a single-company estimating app. I'm the system architect
(non-developer — explain things plainly, mark a (Recommended) option on every
choice). Phase 1 (commits 461b6dc, e02350f, 4e3407b) forensically verified the
finalized template (committed at 4eab1f1) AGREES with my confirmed mappings.
All discrepancies (D1–D3) are ALREADY SIGNED OFF — findings doc §9. Do not
re-ask them.
== GOAL ==
Re-sync estimate-catalog.json + the Supabase cost_code_map to the corrected
template (the 32-1313 → 32-1613 curb/site-concrete reclassification). The
catalog/DB still hold the OLD state: 32-1313.001–.005 = curb items →
32-321313.000, and no 32-1613.002–.006.
== EXPECTED OUTCOME (verified facts from Phase 1 — use as your check) ==
- 32-1313.001 description becomes "Concrete Paving" (rollup unchanged:
  32-321313.000, authoritative via BLI row 199)
- 32-1313.002–.005 disappear from the catalog
- 32-1613.002–.006 appear, all → procoreCode 32-321613.000 (resolves via
  sibling inference from parent .001 — signed off as D1)
- Preserve template uom/prices: .002 lf/$29, .003 lf/$29, .004 lf/$48,
  .005 sf/$11.5, .006 sf/$14 (harvest reads these — verify, don't invent)
- Net: catalog 221 → 222 entries; sync-codes must exit clean (0 unresolved,
  0 invalid); procore-valid-codes.json should NOT churn (already current, 224)
== STEPS (per plan §0.B) ==
1. npm run sync-codes  → regenerate estimate-catalog.json; verify against the
   expected outcome above
2. npm run generate-seed → regenerate supabase_seed_cost_code_map.sql
3. Migration: the seed is ON CONFLICT DO NOTHING, so present DDL/DML for my
   approval BEFORE running anything: INSERT 32-1613.002–.006 into
   cost_code_map, UPDATE 32-1313.001 description, DELETE 32-1313.002–.005.
   Run on a Supabase branch first per AGENTS.md, then main after I approve.
4. Query estimate_line_items for rows on 32-1313.001–.005 — surface count +
   projects to me. NO silent rewrite (32-1313.001's meaning shifted from
   Surmountable Curb to Concrete Paving). Note: prod likely has only fresh
   test-shell projects with $0 rows, but query and show me anyway.
== GUARDRAILS ==
- Invoke the supabase skill BEFORE touching any DB code.
- Route all procoreCode assignment through resolveProcoreCode
  (src/lib/costCodeResolver.ts) — never bypass the chokepoint.
- Line-item writes only via the save_estimate_line_items RPC; DB access only
  through src/lib/db.ts.
- D2 sign-off (4 orphan source lines → sibling BLI codes) is a PHASE 3 input
  — do not act on it here; it does not affect the STEP 4 catalog harvest.
- Windows + PowerShell: keep inline commands short; script files for anything
  longer than ~one line.
== EXIT CRITERIA ==
- npm run build + npm run test green (fix regressions before delivery)
- Migration verified on branch, applied to main with my approval
- Catalog + cost_code_map match the template; commit everything
- Append a 3–5 line handoff note to §13 "Handoff log" of the plan (what
  landed, commit hash, what Phase 3 must know)
- Then STOP. Do not start Phase 3.
Model: Claude Opus (latest).
```

### → Phase 3 (GC + Site Ops export — P2 complete 2026-06-06, ready to run)

> *(Enriched 2026-06-06 with Phase 1 verified facts + Phase 2 outcomes — supersedes the original
> generic block.)*

```
Implement PHASE 3 ONLY of the plan at:
docs/plans/gc-siteops-export-step2-step3.md
Read the whole plan first — especially §4–§7 (architecture + BLI write logic),
§0.D (source-of-truth rule), §9 (Phase 3c baseline + resolveProcoreCode
chokepoint), and §13 (Phase 3 scope + handoff log). Then read the Phase 1
findings doc: docs/plans/2026-06-05-gc-siteops-phase1-findings.md — especially
§4 (the 34+38 confirmed SUMIF criteria tables), §5 (corrected dependency map),
§6 (constants.ts alignment list), and §9 (sign-offs). This is a phased plan:
do Phase 3 and nothing else, then stop. Phase 4 (STEP 2/3 sheet detail,
editable rates) is separate — do not start it.
== CONTEXT ==
Takeoff Bridge is a single-company estimating app. I'm the system architect
(non-developer — explain things plainly, mark a (Recommended) option on every
choice). Phase 1 (461b6dc) forensically verified the template; Phase 2
(5597048) re-synced estimate-catalog.json + Supabase cost_code_map to it
(full tie-out passed, 221 rows). All discrepancies are SIGNED OFF (findings
§9) — do not re-ask D1–D3.
== GOAL ==
GC (Division 01) and Site Ops (Division 02) dollars are computed in the app
but never reach the exported workbook: the 34 STEP-2 and 38 STEP-3 sourced
Budget Line Items rows export as live SUMIFs over blank sheets → $0. Write
app-computed values into all of them so every one of the 217 BLI rows carries
a computed value and no live SUMIF survives.
== VERIFIED FACTS (Phase 1 — build on these) ==
- NO write-order constraint: nothing flows STEP 3 → STEP 4 → BLI (plan §0.C
  was backwards; the §6 caveat is dropped). The simple "match criterion code
  → write value" loop is sufficient. STEP 4 rows 12–24 pull FROM STEP 2/3
  subtotals and no BLI row references them — no double-counting.
- Findings §4 tables give every BLI row's criterion code. App constants are
  suffix-less (01-0310) vs template criteria (01-0310.001) — align per
  findings §6.
- The app today covers only 14/34 GC + 6/38 Site Ops criteria; the rest
  correctly export $0 (no app input lines exist yet — listed in findings §6).
- D4 legacy template formula bugs (STEP 4 H19/H20/H24) are irrelevant — the
  app computes and overwrites those values.
== SIGNED-OFF DECISIONS TO ENCODE (findings §9 — don't re-ask) ==
- D2: the 4 orphan source lines map to their sibling's BLI code:
  01-5110.002 → 1-15110.000; 02-9010.002 → 2-29010.000 (the app HAS this
  hired-cleaning input line — its dollars need this home); 02-4100.002 →
  2-24100.000; 02-9200.002 → 2-29200.000.
- D3: write $0 to the broken 1-10000.000 BLI row (row 2) — the 34 granular
  GC rows carry the dollars; writing the GC total there would double-count.
== SCOPE (plan §5 files table + §6 logic) ==
1. constants.ts: update STAFF_ROLE_DEFAULTS / OPERATIONAL_EXPENSE_DEFAULTS
   to the .001-suffixed criteria; add EQUIPMENT_DEFAULTS (dumpsters/toilets/
   electric) and the Site Ops codes as a single source of truth.
2. exporter.ts: generateExcelWorkbook gains gcCalcResult / gcEquipment /
   siteOpsCalcResult; build gc + siteOps rollup maps; write values into the
   34+38 BLI rows (same setCellValue pattern as STEP 4 rows); include GC +
   Site Ops in the internal tie-out. NOTE the Phase 3b signature is
   (rows, project, columnDefs, layoutConfig, templateBuffer) — thread the
   new params alongside, don't disturb it.
3. useExportHandlers.ts + projects/[projectId]/page.tsx: thread the calc
   results down from their hooks.
4. validateExportReadiness: extend per §7 — Option A (gate covers
   Σ line items + GC + Site Ops = Σ all BLI) is (Recommended); confirm.
5. Tests per §5: GC/Site Ops values land on expected codes; full 217-row
   reconciliation; no live SUMIFs remain in GC/Site Ops BLI rows.
== GUARDRAILS ==
- AGENTS.md: present an implementation plan table for my approval BEFORE
  writing code; npm run test green before presenting work.
- Route all procoreCode assignment through resolveProcoreCode
  (src/lib/costCodeResolver.ts) — never bypass the chokepoint.
- Never invent financial values; calculations.ts is the sole calculation
  authority. DB access only through src/lib/db.ts.
- Windows + PowerShell: keep inline commands short; script files for
  anything longer than ~one line.
== OPEN DECISIONS TO RESOLVE WITH ME AT START (plan §12) ==
- §7 Option A vs B (A Recommended); confirm STEP 2/3 sheets stay blank
  (§8 — writing line detail there is Phase 4); defer per-project staff-rate
  overrides to Phase 4.
== EXIT CRITERIA ==
- npm run build + npm run test green (fix regressions before delivery)
- Manual export of a known project ties out: BLI shows computed GC +
  Site Ops values, reconciliation gate passes
- Commit; append a 3–5 line handoff note to §13 "Handoff log"; push the
  branch (keeps remote in sync per project practice)
- Then STOP. Do not start Phase 4.
Model: Claude Opus (latest).
```

### → Phase 4 (full GC + Site Ops input coverage — resequenced 2026-06-06, ready to run)

> *(Enriched 2026-06-06 with Phase 1–3 verified facts. P4 = inputs; P5 = estimate-page linkage;
> P6 = polish. See the resequenced phase definitions in §13.)*

```
Implement PHASE 4 ONLY of the plan at:
docs/plans/gc-siteops-export-step2-step3.md
Read the whole plan first — especially §13 "Phases 4–6 — RESEQUENCED" (the
authoritative P4 scope), §0.D (source-of-truth rule), and the §13 handoff log
(P1–P3 outcomes). Then read the Phase 1 findings doc:
docs/plans/2026-06-05-gc-siteops-phase1-findings.md — especially §4 (the
34+38 criterion tables with BLI codes), §5.2 (the two %-of-estimate GC
lines), §6 (which criteria have app inputs today), and §9 (D2 sign-offs).
This is a phased plan: do Phase 4 and nothing else, then stop. Phase 5
(estimate-page linkage) and Phase 6 (sheet detail, editable rates) are
separate — do not start them.
== CONTEXT ==
Takeoff Bridge is a single-company estimating app. I'm the system architect
(non-developer — explain things plainly, mark a (Recommended) option on every
choice). Phase 1 (461b6dc) forensically verified the template; Phase 2
(5597048) re-synced catalog/DB; Phase 3 (370e66b) made the export write
computed values into ALL 217 Budget Line Items rows — no live SUMIF survives,
and the export machinery is GENERIC: any GC/Site Ops line defined in
constants.ts flows to the workbook BLI, the Procore CSV, and the
reconciliation gate automatically. All discrepancies D1–D3 are SIGNED OFF.
== GOAL ==
Every template STEP 2/STEP 3 source line gets an input row in the app, so no
GC/Site Ops BLI row is stuck at $0 for lack of a place to type. Today the app
covers 14/34 GC + 6/38 Site Ops criteria. Missing: ~21 GC lines (the 20 in
findings §6 + orphan 01-5110.002) and ~34 Site Ops lines (the 32 in findings
§6 + orphans 02-4100.002, 02-9200.002). ⚠️ Derive the line list from findings
§4 + a forensic read of the template STEP 2/3 sheets (codes, descriptions,
units, default rates) — NEVER from hand-copied lists (the user's 2026-06-06
list omitted 02-9005.001 Final Cleaning) and NEVER invent rates.
== VERIFIED FACTS (P1–P3 — build on these) ==
- Phase 3 mapping pattern (the home for these lines, user-decided): each line
  config in src/lib/constants.ts carries { code: ".001" template criterion,
  procoreCode: BLI code from findings §4, costType, label, unit, rate }.
  STAFF_ROLE_DEFAULTS / OPERATIONAL_EXPENSE_DEFAULTS / EQUIPMENT_DEFAULTS /
  SITE_OPS_DYNAMIC_DEFAULTS / SITE_OPS_MANUAL_DEFAULTS are the live examples.
- cost types come from the template BLI col B (forensically verified in P3):
  staff rows "L"; Demolition 2-24100.000, Abatement 2-28213.000, Final
  Cleaning 2-29005.000, Temp Access Roads 2-29045.000, Survey & Layout
  2-29200.000 are "S"; everything else "M". Re-verify col B for the rows you
  add during your forensic read.
- D2 orphans map to sibling BLI codes (signed off, findings §9):
  01-5110.002 → 1-15110.000; 02-4100.002 → 2-24100.000;
  02-9200.002 → 2-29200.000. (02-9010.002 already encoded in P3.)
- The constants test (src/lib/__tests__/constants.test.ts) cross-checks every
  procoreCode against src/lib/procore-valid-codes.json (224 codes) — your new
  lines are validated automatically; extend its allLines list.
- ZERO exporter changes expected: rollupGcSiteOps accumulates lines sharing a
  BLI code; validateExportReadiness/generateExcelWorkbook/generateProcoreBudget
  consume the calc results generically. Extend tests' coverage expectations.
- Persistence: GC/Site Ops inputs save via useEstimatePersistence as JSONB
  snapshots (gcUtilization, gcEquipmentOverrides, siteOpsQuantities,
  siteOpsRates). Verify the new quantities fit those shapes WITHOUT a schema
  change; if a schema change is genuinely needed, supabase_schema.sql first +
  my approval + invoke the supabase skill before any DB code.
== OPEN DECISIONS TO RESOLVE WITH ME AT START ==
- Dynamic (duration/sqft-driven) vs manual (typed qty) for each new line —
  propose a table from the template's structure, mark (Recommended) defaults.
- The two %-of-estimate-total GC lines (01-0610.001 Safety Consultant,
  01-1600.001 Procore — findings §5.2: the template has the estimator
  hand-type the amount to break circularity). Propose options (manual entry
  is likely simplest); I decide.
- UI grouping: mirror the template's STEP 2/3 subtotal sections (Recommended)
  or flat list.
== GUARDRAILS ==
- AGENTS.md: present an implementation plan table for my approval BEFORE
  writing code; npm run test green before presenting work.
- calculations.ts is the sole calculation authority; never invent rates or
  financial values — harvest defaults from the template forensically.
- resolveProcoreCode / cost_code_map stay UNTOUCHED — the GC/Site Ops mapping
  home is constants.ts (P3 user decision); these are app-defined inputs, not
  takeoff rows.
- Windows + PowerShell: keep inline commands short; script files for anything
  longer than ~one line.
== EXIT CRITERIA ==
- npm run build + npm run test green (fix regressions before delivery)
- Manual export of a project using several NEW lines ties out: dollars land
  on the right BLI codes in the workbook and Procore CSV; reconciliation gate
  passes
- Commit; append a 3–5 line handoff note to §13 "Handoff log"; push the
  branch
- Then STOP. Do not start Phase 5.
Model: Claude Opus (latest).
```

### → Phase 5 (estimate-page linkage — P4 complete 2026-06-06, ready to run)

> *(Enriched 2026-06-06 with Phase 1–4 verified facts. P5 = estimate-page linkage + modifier-basis
> decision + double-count guard; P6 = polish. See the resequenced phase definitions in §13.)*

```
Implement PHASE 5 ONLY of the plan at:
docs/plans/gc-siteops-export-step2-step3.md
Read the whole plan first — especially §13 "Phases 4–6 — RESEQUENCED" (the
authoritative P5 scope) and the §13 handoff log (P1–P4 outcomes). Then read
the Phase 1 findings doc:
docs/plans/2026-06-05-gc-siteops-phase1-findings.md — especially §5.1 (the
STEP 4 ← STEP 2/3 pull map), §5.3 (no write-order constraint), and §8
(D3 + the D4 legacy formula bugs). This is a phased plan: do Phase 5 and
nothing else, then stop. Phase 6 (STEP 2/3 sheet detail, editable rates)
is separate — do not start it.
== CONTEXT ==
Takeoff Bridge is a single-company estimating app. I'm the system architect
(non-developer — explain things plainly, mark a (Recommended) option on
every choice). Phase 1 (461b6dc) forensically verified the template;
Phase 2 (5597048) re-synced catalog/DB; Phase 3 (370e66b) made all 217
Budget Line Items rows export computed values (no live SUMIFs); Phase 4
(73fadf9) gave every STEP 2/3 source line an app input — all 34 GC + 38
Site Ops BLI codes are reachable and the export ties out (gate delta $0).
Build + 202 unit tests green at P4 close.
== GOAL ==
The STEP 4 estimate page should show GC + Site Ops totals the way the
template's STEP 4 rows 12–24 pull STEP 2/3 subtotals — READ-ONLY, linked
live from the Step 2/3 modules — so the on-page subtotal, the modifiers
(fee/contingency/insurance %), and cost-per-SF reflect the whole job.
Today computeTakeoffSummary() computes from STEP 4 grid rows only;
GC/Site Ops dollars exist only on Steps 2/3 and in the export.
== VERIFIED FACTS (P1–P4 — build on these) ==
- Template pull map (findings §5.1): STEP 4 rows 12–24 take col H from
  STEP 2/3 SUBTOTALS (01-0000.001←STEP2 I58; 01-0400.002←I16;
  02-0000.001←STEP3 I29; 02-4100.002←I35; 02-9200.005←I51; 02-9300.006←I62;
  02-9400.007←I72). D4 legacy bugs: 02-9005.003 / 02-9070.004 / 02-9500.008
  pull line cells I38/I43/blank-I81 instead of subtotals I40/I45/I82 — the
  template's own col-S checks prove the subtotals are the intent; the app
  implements the INTENT, not the bug.
- NO BLI row references STEP 4 rows 12–24 (findings §5.1) — linked rows must
  stay OUT of the Procore rollup; the 34+38 granular GC/Site Ops rows carry
  the dollars.
- DOUBLE-COUNT TRAP to close (P5 scope, §13): the STEP 4 catalog maps
  01-0000.001 / 01-0400.002 → 1-10000.000 and the 02-x division rows →
  2-20000.000; dollars manually typed on those STEP 4 grid rows TODAY reach
  Procore alongside the granular GC/Site Ops rows. Related D3 (P3): the
  broken 1-10000.000 BLI row receives the STEP 4 rollup value — $0 in the
  normal flow, but it preserves estimator-typed dollars on those rows.
- App totals already available in page.tsx and persisted: personnel.totalGCs
  (= PersonnelCalcResult.grandTotal) and infrastructure.siteOperationsTotal
  (project_estimates.general_conditions_total / site_operations_total).
  computeTakeoffSummary(rows, sqft, units, rates) in calculations.ts is the
  modifier engine and SOLE calculation authority.
- Reconciliation gate (§7 Option A, live since P3): validateExportReadiness
  = Σ line items + GC + Site Ops vs Σ BLI rollup. GC/Site Ops dollars must
  keep exactly ONE representation — if linked totals also appear as STEP 4
  rows, lineItemTotal double-counts and the gate breaks.
- P4 note: the two %-line hints (Safety Consultant 0.02% / Procore 0.19%)
  multiply pctHint × takeoffSummary.totalEstimatedCost — if the modifier
  basis changes what that total means, re-check the hint still matches the
  template's reference (STEP 4 I341).
- If uncommitted market-sector changes are in the working tree, leave them
  alone — separate feature, separate commit (see memory).
== FINANCIAL DECISIONS TO RESOLVE WITH ME AT START (sign-off BEFORE code) ==
- Modifier basis: the template computes modifiers and cost-per-SF on I331,
  which INCLUDES GC + Site Ops (rows 12–24). The app today computes
  modifiers on STEP 4 grid rows only. Propose options WITH dollar examples
  (e.g. 5% fee on subtotal-with-GCs vs without on a sample project), mark
  (Recommended = match template). calculations.ts changes only after I
  sign off.
- Estimate-page rendering: read-only pinned division rows (template-like)
  vs a summary strip above the modifier footer — options + (Recommended).
- Double-count closure mechanism: block/ignore typed dollars on the
  division-total STEP 4 rows vs exclude those rows from rollup + gate —
  options + (Recommended). Surface what happens to existing projects that
  already have dollars typed there (no silent rewrite).
== GUARDRAILS ==
- AGENTS.md: present an implementation plan table for my approval BEFORE
  writing code; npm run test green before presenting work.
- calculations.ts is the sole calculation authority; never invent financial
  values. Linked totals are READ-ONLY on STEP 4 — Steps 2/3 remain the
  input surface.
- Prefer a computed/display layer over mutating grid rows; if any STEP 4
  row mutation is unavoidable it MUST go through commandHistory.pushCommand
  with full undo fidelity (AGENTS.md).
- resolveProcoreCode / cost_code_map stay UNTOUCHED; the GC/Site Ops
  mapping home is constants.ts. DB access only through src/lib/db.ts;
  line-item writes only via the save_estimate_line_items RPC. If a schema
  change is genuinely needed: supabase_schema.sql first + my approval +
  invoke the supabase skill before any DB code.
- Windows + PowerShell: keep inline commands short; script files for
  anything longer than ~one line; no emoji in PowerShell scripts.
== EXIT CRITERIA ==
- npm run build + npm run test green (fix regressions before delivery)
- Manual check: estimate page shows the linked GC + Site Ops totals;
  modifiers + cost-per-SF follow the signed-off basis; export of a project
  with GC + Site Ops + STEP 4 dollars still ties out (reconciliation gate
  passes; no double-counted Procore dollars on 1-10000.000 / 2-20000.000)
- Commit; append a 3–5 line handoff note to §13 "Handoff log"; push the
  branch
- Then STOP. Do not start Phase 6.
Model: Claude Opus (latest).
```

### → Phase 6 (polish: STEP 2/3 sheet detail + editable staff rates — P5 complete 2026-06-06, ready to run)

> *(Enriched 2026-06-07 with Phase 1–5 verified facts. P6 is the FINAL phase of this plan.)*

```
Implement PHASE 6 ONLY of the plan at:
docs/plans/gc-siteops-export-step2-step3.md
Read the whole plan first — especially §8 (STEP 2/3 sheets decision), §13
"Phases 4–6 — RESEQUENCED" (the authoritative P6 scope) and the §13 handoff
log (P1–P5 outcomes). Then read the Phase 1 findings doc:
docs/plans/2026-06-05-gc-siteops-phase1-findings.md — especially §4 (the
criterion-cell tables: they give each source line's STEP 2/3 ROW number) and
§5.2 (the two %-lines the estimator hand-types). This is the LAST phase of
this plan: do Phase 6, close out the plan, then stop.
== CONTEXT ==
Takeoff Bridge is a single-company estimating app. I'm the system architect
(non-developer — explain things plainly, mark a (Recommended) option on
every choice). P1 (461b6dc) forensically verified the template; P2 (5597048)
re-synced catalog/DB; P3 (370e66b) made all 217 Budget Line Items rows
export computed values; P4 (73fadf9) gave every STEP 2/3 source line an app
input; P5 (2ee34ac) linked the 10 STEP 4 division rows live from Steps 2/3
(read-only), moved the modifier basis to the whole job (template I331), and
closed the double-count trap (linked rows excluded from rollup/gate/CSV).
Build + 223 unit tests green at P5 close.
== GOAL (two small, independently shippable deliverables — separate commits) ==
A. STEP 2/3 SHEET DETAIL: the exported workbook's "STEP 2 - GCs" and
   "STEP 3 - SITE OPS" sheets currently export BLANK. Write each app
   GC/Site Ops line's qty/rate (computed values) onto its template row so
   an estimator opening the workbook sees where the dollars came from.
   The BLI does NOT depend on these sheets (P3 wrote computed values
   everywhere), so this is purely informational — but it resolves the one
   visible loose end: the template's col-S checks on STEP 4 rows 12–24
   compare P5's written values against the (currently blank) STEP 2/3
   subtotals; once the sheets are filled, those checks tie out.
B. PER-PROJECT EDITABLE STAFF RATES: UI on Step 2 to override the 8
   corporate default hourly rates per project. The calculation engine
   already accepts them — computePersonnelCosts(duration, sqft,
   utilizations, equipment, manualEntries, rateOverrides?) — only UI +
   persistence are missing.
== VERIFIED FACTS (P1–P5 — build on these) ==
- Row map is ALREADY KNOWN: findings §4 criterion cells give each source
  line's sheet row (e.g. 01-0001.001 = STEP 2 row 19; supervision staff =
  STEP 2 rows 12–14; 02-9530.001 = STEP 3 row 80). The 4 D2 orphan lines
  also live on real rows: 01-5110.002 row 42, 02-9010.002 row 16,
  02-4100.002 row 33, 02-9200.002 row 49. The line list = the constants.ts
  configs (P4 covers every template source line; codes are unique per sheet).
- FORENSICALLY VERIFY (don't assume) the STEP 2/3 column layout before
  writing: which columns hold qty/rate/total, whether col I is a live
  F×H-style formula (if so: write qty+rate values, let I recompute —
  fullCalcOnLoad="1" is already set by the exporter), and the utilization
  column for staff rows. Same unzip-and-parse method as P1.
- The two %-lines (STEP 2 H35 Safety Consultant / H39 Procore): the
  template has the estimator hand-type the amount into col H — the app's
  typed dollar amounts land there as values, exactly matching the
  template's own convention (findings §5.2).
- Subtotal cells (STEP 2 I16/I58; STEP 3 I29/I35/I40/I45/I51/I62/I72/I82)
  are SUM formulas — leave them LIVE so they recompute from the written
  line values. P5 wrote STEP 4 rows 12–24 from computeLinkedDivisionTotals,
  whose section sums are identical by construction → the col-S checks will
  tie out. Do NOT touch the STEP 4 rows 12–24 write logic.
- Zero new threading needed: generateExcelWorkbook already receives
  gcCalcResult + siteOpsCalcResult (required since P3); all line values
  come from those results (calculations.ts is the sole authority).
- CLAUDE.md Excel rule: write cells in ascending column order within each
  row (the P3b out-of-order-cell corruption lesson) and reuse the existing
  exporter helpers (getOrCreateCell/setCellValue/setCellInlineString).
- Rate persistence: gc_utilization / gc_equipment_overrides /
  site_ops_quantities / site_ops_rates JSONB columns exist on
  project_estimates. Decide whether rate overrides fit an existing JSONB
  (P4 precedent: new GC entries ride gc_equipment_overrides with a key
  whitelist) or genuinely need a new column — if a schema change is needed:
  supabase_schema.sql FIRST + my approval + invoke the supabase skill
  before any DB code.
- Sawcutting collision reminder (P5): the string "02-4100.002" is BOTH a
  STEP 3 source-line code and a STEP 4 linked-row itemId — STEP 3 sheet
  writes key off the Site Ops config codes/rows, never off STEP 4 itemIds.
- Test fixture note (P5): export-integrity's div02Row was re-pointed to a
  non-linked itemId; don't reintroduce linked itemIds as dollar-carrying
  fixtures.
== DECISIONS TO RESOLVE WITH ME AT START ==
- Sheet-detail write shape: values-only into qty/rate cells with live
  line-total + subtotal formulas recomputing (Recommended — matches the
  template's own structure and the P5 tie-out) vs writing flat values into
  totals too. Propose after the forensic column read.
- Zero-dollar lines: write every line's qty/rate (zeros included, sheet
  looks complete — Recommended) vs only non-zero lines. Confirm.
- Rate-override persistence home (existing JSONB vs new column) + whether
  rate edits also need a "reset to corporate default" affordance.
- Scope check: P4 deferred "auto-line overrides" (making the always-on
  monthly GC lines individually adjustable) — propose in/out, default OUT
  (separate small follow-up if wanted).
== GUARDRAILS ==
- AGENTS.md: present an implementation plan table for my approval BEFORE
  writing code; npm run test green before presenting work.
- calculations.ts is the sole calculation authority; never invent rates —
  defaults stay the constants.ts values harvested from the template.
- Linked STEP 4 rows stay READ-ONLY and excluded (P5 closure is settled —
  do not revisit). resolveProcoreCode / cost_code_map untouched.
- DB access only through src/lib/db.ts; line-item writes only via the
  save_estimate_line_items RPC.
- Windows + PowerShell: keep inline commands short; script files for
  anything longer than ~one line; no emoji in PowerShell scripts.
== EXIT CRITERIA ==
- npm run build + npm run test green (fix regressions before delivery)
- Manual check: export a project with GC + Site Ops + STEP 4 dollars →
  STEP 2/3 sheets show the line detail matching the app's Step 2/3 tables;
  subtotals recompute; STEP 4 rows 12–24 col-S checks tie out; the
  reconciliation gate still passes (sheet detail must not change BLI/CSV
  dollars). Rate overrides: change a staff rate → Step 2 totals, STEP 4
  linked GC row, export, and gate all follow; reload restores the override.
- Commit (A and B separately); append a 3–5 line handoff note to §13
  marking the PLAN COMPLETE; push the branch
- Then STOP. This plan is finished — remaining backlog (per-type templates,
  procoreParentCode removal, suffix alignment, security advisors) lives
  outside it.
Model: Claude Opus (latest).
```

**Resolved (B-1):** `03-0000.010/.011/.012` and `03-4500.001` verified in sync — no changes needed.
**Resolved:** `32-1313` empty-parent question — `32-1313.001` is repurposed as the Concrete Paving line, so the group is not empty.
