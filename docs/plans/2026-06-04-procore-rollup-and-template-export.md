# Implementation Plan — App-Owned Procore Rollup & Bulletproof Template Export

- **Project:** Takeoff Bridge (`C:\Users\BUrness\Dev\takeoff-bridge`)
- **Date:** 2026-06-04
- **Status:** AWAITING APPROVAL — no code written, no migration run
- **Owner / approver:** System Architect (per `AGENTS.md`, plan must be approved before code delivery)

---

## 1. Objective

Move the estimating team off siloed Excel templates and onto the app as the source of truth, while preserving the ability to **export an estimate to `Company_Estimate_Template.xlsx`** that an estimator can keep working in and upload to Procore. Make the Procore budget rollup deterministic, reconciled, and impossible to silently corrupt. Lay groundwork for **per-project-type templates** (Multi-Family / TI / Medical).

---

## 2. Background — how the system works today

### 2.1 The export path
- UI button "Download Full Estimate Workbook (.xlsx)" in `src/app/projects/[projectId]/page.tsx` (~line 307) → `handleExportExcelWorkbook` in `src/hooks/useExportHandlers.ts` (line 54).
- That handler calls `getTemplateConfig("Company_Estimate_Template.xlsx")` (`src/lib/db.ts` line 797), fetches `/templates/Company_Estimate_Template.xlsx` from `public/`, then calls `generateExcelWorkbook(...)` in `src/lib/exporter.ts` (line 688).
- `generateExcelWorkbook` populates the **STEP 4 - ESTIMATE** sheet (codes in column C, description D, qty F, uom G, unit price H, total formula I), inserts unmapped rows, shifts formulas, strips `calcChain.xml`, and writes the file. It does **not** write the Budget Line Items sheet — that sheet's `SUMIF` formulas roll STEP 4 up to Procore codes when Excel recalculates.
- The team uploads the whole workbook to Procore; Procore consumes the **Budget Line Items** sheet (and **Importer Data Fields** as the valid-code list).

### 2.2 The three cost-code systems (root problem)
| # | System | Where it lives | Granularity |
|---|---|---|---|
| 1 | Internal `itemId` | `src/lib/estimate-catalog.json`, STEP 4 col C | 219 granular codes (`03-0000.001`) |
| 2 | `procoreParentCode` | catalog + `generateProcoreBudget` CSV | **25** division parents (`3-30000.000`) |
| 3 | Granular Procore codes | Budget Line Items sheet (col A) | **217** codes (`3-33543.000`) |

Procore needs **#1 → #3**. That mapping exists **only** as `SUMIF` cell-pins inside the .xlsx. The app's `procoreParentCode` (#2) is a different, coarser rollup. So the app cannot reproduce the Procore upload, and the CSV export (`generateProcoreBudget`) and the workbook export disagree at different granularities.

### 2.3 Root cause in code
`scripts/harvest-cost-codes.js` → `resolveProcoreParentCode(code)` (line 63) hardcodes every code to its division parent and never reads the Budget Line Items sheet. That is why the catalog only carries 25 distinct Procore codes.

---

## 3. Verified data findings (forensic extraction from the template, 2026-06-04)

Budget Line Items sheet = 217 data rows (sheet `Budget Line Items`, internal `xl/worksheets/sheet17.xml`). By rollup source:
- **144** rows sourced from STEP 4 - ESTIMATE (estimate line items)
- **34** from STEP 2 - GCs (`STEP 2 - GCs` sheet)
- **38** from STEP 3 - SITE OPS
- **1** broken: `1-10000.000` General Conditions row is `#REF!` at source

Catalog coverage (219 catalog codes vs the 144 STEP-4 rollup criteria):
- **135** map AUTHORITATIVELY (catalog code is a real SUMIF criterion)
- **84 ORPHANS** — catalog codes with no Procore destination; money entered on them never reaches Procore. Concentrated in Div 03 (12), Div 33 (9), Div 02 (8), Div 32 (7), Div 50 (7), Div 07 (6), Div 04 (6), Div 80 (5), Div 26 (4), Div 05 (4), others.
- **2 template typos** break their lines (criteria don't match catalog): `03-4500.0002` (should be `03-4500.001`, Precast Architectural) and `07-6100.01` (should be `07-6100.001`, Metal Roofing).

Proposed complete mapping (all 219 codes) generated and saved to **`docs/plans/procore-cost-code-mapping.csv`** with columns `internal_code, description, procore_code, confidence, basis`:
- 135 AUTHORITATIVE, 67 INFERRED-sibling (orphan routed to its `XX-YYYY.001` sibling's Procore code), 17 INFERRED-divbase (need human confirmation; 10 of those are actually GC/Site-Ops handled by Steps 2 & 3).

Template internal coordinates (STEP 4 - ESTIMATE): header row 9; division ranges per `DEFAULT_LAYOUT_CONFIG` (`src/lib/exporter.ts` line 271); subtotal row 331; modifier rows 333–339; grand total row 341; reconciliation rows 346–349. Importer Data Fields sheet (`sheet18.xml`) lists 225 valid Procore codes — the validation oracle.

---

## 4. Target architecture

- App owns the internal→granular-Procore mapping as data (catalog field now, DB table for per-type later).
- Procore rollup is **computed** by grouping line items by their granular `procoreCode` and summing — never by cell-pin SUMIFs.
- Two gates guard every export: **completeness** (no unmapped dollars) and **reconciliation** (`Σ line items == Σ Budget Line Items`).
- The template becomes a render target; per-project-type templates select layout + mapping from `template_config`.

---

## 5. Guardrails this plan obeys (`AGENTS.md`, `.agent/skills/database-guardrails/SKILL.md`, `.agent/skills/verify-feature/SKILL.md`)

- No file edits or migrations until this plan is approved.
- DB access only through `src/lib/db.ts`; no component/hook imports `src/lib/supabase.ts`.
- Line-item writes only via the `save_estimate_line_items` RPC; `sort_order` = array index; load with `ORDER BY sort_order ASC`.
- `supabase_schema.sql` is the schema source of truth — update it first, get approval, then migrate; refresh TS types after.
- **No guessed financial mappings.** Missing mappings trigger the interactive user-override interface, never silent AI inference.
- Calculation authority stays in `src/lib/calculations.ts` (`computeTakeoffSummary`). Stored totals are never used as inputs.
- After each phase, run the full verification gate (Section 11) to green before proceeding.

---

## 6. Phase 1 — Granular mapping as app-owned data (foundation; no export behavior change)

**Goal:** the catalog carries the real granular Procore code per item; orphans are reported, not guessed.

| File | Function / location | Change |
|---|---|---|
| `scripts/harvest-cost-codes.js` | `resolveProcoreParentCode` (line 63), `main` (line 87) | Replace division-parent hardcode. Read the **Budget Line Items** sheet, parse each col-H `SUMIF('<sheet>'!$C$..., '<sheet>'!Cnn, ...)`, resolve the criterion cell `Cnn` to the source sheet's column-C internal code, and map internal → col-A Procore code. Apply sibling inference (`XX-YYYY.001`) for orphans. Write a `scripts/output/cost-code-gaps.json` listing every orphan/divbase case (no silent guess). Normalize the two known typos. |
| `src/types/index.ts` | `InternalEstimateItem` (line 11), `ProcessedTakeoffRow` (line 20) | Add `procoreCode: string` (granular). Keep `procoreParentCode` for back-compat until Phase 2 unifies the CSV path. |
| `src/lib/estimate-catalog.json` | whole file | Regenerate via `npm run sync-codes` to include `procoreCode`. |
| `docs/plans/procore-cost-code-mapping.csv` | docs/plans | The reviewed seed; confirmed 17 baked in. Promote to `src/lib/cost-code-map.json` (or keep inside catalog — decided in Phase 3 when DB table lands). |

**Verification (Phase 1):** `npm run sync-codes` runs clean; regenerated `estimate-catalog.json` has 219 entries each with a non-empty `procoreCode`; `cost-code-gaps.json` matches the 17 expected; `npm run build` + `npm run test` green (no behavior change expected).

---

## 7. Phase 2 — Deterministic rollup, gates, template correctness (correctness lands here)

**Goal:** the app computes the Procore numbers and refuses to emit anything that doesn't tie out.

| File | Function / location | Change |
|---|---|---|
| `src/lib/exporter.ts` | new helper `rollupByProcoreCode(rows)` | Group `rows` by `procoreCode`, sum `matchedQty * unitPrice`. Single source for both export paths. |
| `src/lib/exporter.ts` | `generateExcelWorkbook` (line 688), Budget Line Items handling | After populating STEP 4, **write computed values into Budget Line Items column H** by joining on col-A Procore code = `rollupByProcoreCode` key. Append a BLI row for any mapped Procore code missing from the sheet (validated against Importer Data Fields). |
| `src/lib/exporter.ts` | `generateProcoreBudget` (line 167) | Re-point grouping from `procoreParentCode` to granular `procoreCode` so CSV and workbook agree. |
| `src/lib/exporter.ts` | `#REF!` handling (lines 1275, 1293, 1304); typo normalization | Replace "delete the `<f>`" with a correct value-write for `1-10000.000`; normalize `03-4500.0002`/`07-6100.01` on read so they match catalog. |
| `src/lib/exporter.ts` | workbook.xml `<calcPr>` (Phase 3 metadata block, ~line 1238) | Set `fullCalcOnLoad="1"` so the file always recomputes on open. |
| `src/lib/exporter.ts` | new `validateExportReadiness(rows, summary, bliTotals)` | **Completeness gate:** any row with empty/unknown `procoreCode` → return blockers. **Reconciliation gate:** `computeTakeoffSummary` total vs Σ Budget Line Items must match within rounding tolerance → block on mismatch. |
| `src/hooks/useExportHandlers.ts` | `handleExportExcelWorkbook` (line 54), `handleExportProcore` (line 49) | Call `validateExportReadiness` before download; on failure set `exportError` and open the override modal instead of downloading. |
| new `src/components/workspace/ExportOverrideModal.tsx` | — | Lists unmapped codes; lets the user assign a Procore code (persisted per §8) or cancel. Mirrors existing unmapped-classification UX. |
| `src/__tests__/export-integrity.test.ts` | suite | Add: (a) an unmapped code blocks export; (b) reconciliation tie-out passes for a known fixture; (c) a former-orphan code (e.g. `03-0000.002` Footings) now appears in Budget Line Items with the right value; (d) `generateProcoreBudget` and workbook agree on totals. |

**Sub-decision (carry into build):** Budget Line Items as **computed values** (bulletproof; default, recommended) vs **values + retained live SUMIF** (estimator edits reflow in Excel, reintroduces fragility). Recommendation: computed values now + Phase 4 round-trip for the edit case.

**Verification (Phase 2):** full gate (Section 11). Manually open a generated workbook; confirm Budget Line Items column H equals the app's `rollupByProcoreCode`, the reconciliation row (STEP 4 row 349 `E=I`) is TRUE, and no division dollars are missing.

---

## 8. Phase 3 — Persistence, per-type templates, secure storage (requires migration)

**Goal:** per-project-type templates + mappings; manual Procore overrides persisted; template off the public web.

### 8.1 Schema changes — proposed DDL (update `supabase_schema.sql` first, then approve, then migrate)
```
-- New: per-template granular mapping (app-owned)
CREATE TABLE cost_code_map (
  template_name TEXT NOT NULL,
  internal_code TEXT NOT NULL,
  procore_code  TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'template',  -- template | sibling | manual
  PRIMARY KEY (template_name, internal_code)
);
ALTER TABLE cost_code_map ENABLE ROW LEVEL SECURITY;
-- SELECT policy for authenticated, consistent with template_config

-- Persist the resolved Procore code per line item (manual override support)
ALTER TABLE estimate_line_items ADD COLUMN procore_code TEXT NOT NULL DEFAULT '';
-- + update save_estimate_line_items RPC (line 168) to map item->>'procore_code'

-- Project type + template selection
ALTER TABLE projects        ADD COLUMN project_type TEXT NOT NULL DEFAULT 'multifamily';
ALTER TABLE template_config  ADD COLUMN project_type TEXT;
```

### 8.2 Code changes
| File | Function / location | Change |
|---|---|---|
| `src/lib/db.ts` | new `getCostCodeMap(templateName)`, extend `mapLineItemFromRow` (line 74) + `saveEstimateLineItems` payload (line 309), `mapProjectFromRow`/`ToRow` (lines 16/45) | Single-gateway accessors for the map + `procore_code` + `project_type`. |
| `src/lib/exporter.ts` | `DEFAULT_LAYOUT_CONFIG` (line 271) + magic anchors (subtotal `331` line 1097, recon `346` line 1157, modifier offsets line 1107, BLI/Importer sheet names) | Move all of these into `template_config.config_data` so each template type is self-describing; delete the hardcoded fallback (throw if config missing). |
| `src/hooks/useExportHandlers.ts` | `handleExportExcelWorkbook` (line 54) | Resolve template + mapping by `project.project_type`; fetch the .xlsx from a **private Supabase Storage bucket** via `db.ts` instead of `/public`. |
| `public/templates/Company_Estimate_Template.xlsx` | — | Migrate into a private Storage bucket; remove from `/public`. Seed `cost_code_map` + per-type `template_config` rows. |
| `src/lib/constants.ts` | `ESTIMATE_MODIFIERS` (line 140) | Keep modifier codes (`60-*`) authoritative; ensure they are present in `cost_code_map`. |

**Verification (Phase 3):** use Supabase MCP `list_tables` / `apply_migration` against a branch; `generate_typescript_types`; full gate green; export still ties out per Phase 2 checks for at least one project of each `project_type`.

---

## 9. Phase 4 — (optional) Round-trip re-upload

**Goal:** estimator edits the workbook in Excel, re-uploads, and gets a correct Procore import regardless of manual edits.

| File | Change |
|---|---|
| new `src/lib/templateImport.ts` | Parse a re-uploaded workbook's Budget Line Items (Excel-recalculated values), validate against Importer Data Fields, emit the clean Procore import file. |
| `src/hooks/useExportHandlers.ts` / new UI | "Re-upload edited workbook → generate Procore import" action. |

**Verification:** round-trip a workbook with a manual Excel edit; confirm the generated import reflects the edit and still reconciles.

---

## 10. Interactive override interface (AGENTS.md compliance)

When `validateExportReadiness` finds line items with no `procoreCode`, the export is **blocked** and `ExportOverrideModal` lists them. The user assigns a Procore code (validated against the Importer Data Fields list) which is persisted to `estimate_line_items.procore_code` (Phase 3) and offered as a `cost_code_map` addition. No mapping is ever invented by the agent.

---

## 11. Verification gate (run after every phase — `.agent/skills/verify-feature` §5)

1. **Build:** `npm run build` → zero TypeScript/lint/build errors.
2. **Unit:** `npm run test` (vitest) → all suites pass, including `src/__tests__/export-integrity.test.ts`.
3. **E2E:** `npm run test:e2e` (Playwright) → auth → dashboard → workspace → grid calc passes.
4. **Zero-failure enforcement:** any non-zero exit blocks completion; read stderr, fix, re-run from step 1. Pre-existing/out-of-scope failures are documented and flagged for user review.

Plus per-phase manual checks noted above (open the generated .xlsx; confirm Budget Line Items totals and the STEP 4 row 349 reconciliation flag).

---

## 12. Sequencing, risk, rollback

- **Order:** 1 → 2 (full correctness win, no schema change, shippable) → 3 (per-type + migration) → 4 (optional).
- **Risk:** Phase 1 low; Phase 2 medium (export logic); Phase 3 medium-high (migration). Each phase is independently revertable via git; Phase 3 migration runs on a Supabase branch first.
- **Rollback:** the coarse `procoreParentCode` path stays intact until Phase 2 unifies it; the old template stays in `/public` until Phase 3 Storage cutover is verified.

---

## 13. Open items needed before Phase 1 starts

1. Confirm the **10 GC/Site-Ops codes** (`01-*`, `02-*`) roll up from Steps 2 & 3, not the line-item map.
2. Decide the **~4 new destinations**: `12-3570.001` Healthcare Casework & FFE, `22-4129.001` Shower Pans, and the `80-800x` "TBD" allowances (or accept division-base).
3. Review **`docs/plans/procore-cost-code-mapping.csv`** and flag any wrong sibling-inferred routes.
4. Phase 2 sub-decision: **computed values** (recommended) vs **values + live formula** for Budget Line Items.

---

## 14. Artifacts & references

- Reviewable mapping: `docs/plans/procore-cost-code-mapping.csv` (219 rows).
- Forensic scripts (scratch, temp): `%LOCALAPPDATA%\Temp\xlsx_inspect\` — `gap_report.js`, `propose.js`, `mapping.js`, `raw_cells.js` (regenerable; not part of the repo).
- Memory: `procore-rollup-architecture.md`, `takeoff-bridge-product-goals.md` in the project memory dir.
- Key source files: `src/lib/exporter.ts`, `src/hooks/useExportHandlers.ts`, `scripts/harvest-cost-codes.js`, `src/lib/estimate-catalog.json`, `src/lib/db.ts`, `src/types/index.ts`, `src/lib/constants.ts`, `src/lib/calculations.ts`, `supabase_schema.sql`, `src/__tests__/export-integrity.test.ts`.

---

## 15. Approval

Awaiting explicit approval of this plan and the four items in §13. On approval, work begins at **Phase 1**; the Phase 3 schema migration will be re-presented with final DDL before execution. No code or migration will be run before then.
