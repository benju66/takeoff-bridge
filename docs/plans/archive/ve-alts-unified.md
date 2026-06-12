# Plan — Unified VE / Alternates Page (one model, one combined list, one new export tab)

> **Status:** DRAFT for architect approval (2026-06-08, architect: Lochness).
> Phased-handoff doc — run **one phase per fresh context window** (see "Working agreement").
> Two items need explicit sign-off before any code: the `ve_alternates` schema change
> (Phase 1) and the new VE/ALTS template tab replacing the two existing tabs (Phase 4).

---

## Context — why we are doing this

The company estimate template (`templates/Company_Estimate_Template.xlsx`) carries two
hand-maintained tabs for the same concept — owner-facing **Value Engineering and
Alternates**:

- **`VEs_ALTS_MF`** (multifamily): organized by full **CSI division skeleton** (Div 05→50);
  each line has a direct **Estimated Cost**, a **pricing-confidence legend**
  (P/A/C = Preliminary / Allowance / Confirmed), and a **decision-status matrix**
  (Accepted-in-estimate / Accepted-pending / Pending / Rejected) plus a **Ball-in-Court**
  owner.
- **`VEs_ALTS_COMMERCIAL`**: a **flat list** of Alternate 01–12; pricing is
  **Vendor Cost × (1 + Alt Markup %)** with a single workbook-level markup (10%); no
  confidence legend, no status matrix.

Two facts drive this plan:

1. **Neither tab is touched by the app.** The exporter only injects STEP 4 (+ STEP 2/3
   rollups, Budget Line Items, Importer). Both VE/Alt tabs ride along inert. There is **no
   VE/Alt feature in the app today.**
2. **Neither tab actually distinguishes "VE" from "Alternate."** Both title everything
   "Value Engineering / Project Alternates" and number every line "Alternate 0N." The
   VE-vs-Alt split is something **the app introduces** — which is exactly the architect's
   chosen design: *one combined list with a clear category badge.*

The two tabs diverged only because they serve two **project types** — and the app already
has that dimension as `project.marketSector` (db.ts:31). So we do not need two workbooks or
two pages; we need **one model that is a strict superset of both**, presented with
sector-aware defaults.

## Decisions locked with the architect

- **Export target:** author **one new "VE / ALTS" template tab**; retire the two existing
  tabs. (Chosen over reusing the two tabs or deferring export.)
- **List shape:** **one combined list** containing both VE and Alternate items, with a
  **clear visible category** (badge + filter/group toggle) so they read as distinct without
  living in separate sections.
- **Sector-aware view, not sector-specific data:** one data model; Commercial projects
  default to vendor+markup pricing with division grouping hidden, MF projects default to
  division-grouped + status matrix. Same records underneath.

---

## The unified data model

A single record type, superset of both tabs. Direct cost **or** vendor+markup pricing;
MF's four status columns collapse to one clean enum.

```ts
// src/types/index.ts (new)
export type VeAltCategory = 'value_engineering' | 'alternate';
export type VeAltConfidence = 'preliminary' | 'allowance' | 'confirmed';
export type VeAltStatus =
  | 'accepted_in_estimate'   // accepted AND already folded into STEP 4
  | 'accepted_pending'       // accepted, not yet in the estimate
  | 'pending'                // awaiting owner decision
  | 'rejected';

export interface VeAlternate {
  id: string;                    // stable uuid (client-generated)
  category: VeAltCategory;       // THE combined-list distinguisher (badge + filter)
  divisionCode: string;         // "" when uncategorized (Commercial default)
  label: string;                 // "Alternate 01", "VE-03", free text
  description: string;
  comments: string;

  // Pricing — vendorCost drives total when present, else cost does.
  cost: number;                  // direct estimated cost (MF model)
  vendorCost: number | null;     // vendor quote (Commercial model); null = not used
  markupPct: number | null;      // per-item markup; null falls back to estimate default

  confidence: VeAltConfidence;   // P/A/C legend (default 'preliminary')
  status: VeAltStatus;           // decision lifecycle (default 'pending')
  ballInCourt: string;           // responsible party
  source: 'manual' | 'template' | 'csv_import';  // provenance, matches ProcessedTakeoffRow
}
```

**Computed total** (single helper, lives in `calculations.ts` — the calc authority per
AGENTS.md; never duplicated in UI):
`total = vendorCost != null ? vendorCost * (1 + (markupPct ?? estimateDefaultMarkup)) : cost`

This is lossless against both tabs: MF lines set `vendorCost = null` and use `cost` +
`confidence` + `status`; Commercial lines set `vendorCost` + `markupPct` and leave division
blank / status at defaults.

---

## Phases (one per fresh session)

| Phase | Scope | Deliverable / gate |
|---|---|---|
| **1 — Model + persistence** | `VeAlternate` types; `project_estimates.ve_alternates JSONB DEFAULT '[]'`; fold into `save_estimate` RPC + `db.ts` load; total helper in `calculations.ts` with guard tests | Schema change (**architect approval**), types, round-trip load/save, no UI. Tests green. |
| **2 — Combined-list page** | New `?step=ve` panel + sidebar link; reuse STEP 4 TanStack grid (undo/redo, context-menu insert, provenance); **category badge** + filter/group toggle; status/confidence/ball-in-court; vendor+markup pricing cell; sector-defaulted columns & division grouping (`DIVISION_LABELS`) | Working screen; combined list with clear VE/ALT categorization. Tests green. |
| **3 — Live rollups + promote-to-estimate** | Summary header (total VE savings, accepted-in-estimate vs pending totals, counts by status/category) as live rollups (mirrors MF status matrix); "promote Accepted-in-estimate item → STEP 4" action | Decision data feeds the running estimate. Tests green. |
| **4 — Export to new template tab** | Author one new **VE / ALTS** tab in the template; exporter writer (mini STEP 4-style injection: shared-formula flatten, row insert, cross-sheet refs to STEP 1); retire the two old tabs; reconciliation check | **Architect approval** of the new tab; round-trips to Excel. Tests green. |

### Phase 1 — Model + persistence (cold-start brief)
- Add types above to `src/types/index.ts`.
- Schema: add `ve_alternates JSONB NOT NULL DEFAULT '[]'` to `project_estimates` in
  `supabase_schema.sql` (canonical-first per AGENTS.md), then migrate live after approval.
  Extend `save_estimate(p_estimate, p_items)` to persist it (it already writes the JSONB
  blobs); read it back in `db.ts` alongside `gc_utilization` et al.
- Add the total helper + a markup-default resolver to `calculations.ts`; add guard tests
  covering: vendor+markup path, direct-cost path, null markup → estimate default,
  accounting-negative VE (savings) sign correctness.
- **No UI.** Behavior unchanged for existing projects (empty `[]`).

### Phase 2 — Combined-list page (cold-start brief)
- New panel in `src/app/projects/[projectId]/page.tsx` under `activeTab === "ve"`; sidebar
  link in `src/components/layout/Sidebar.tsx` (follow the step1–4 link pattern).
- Reuse the STEP 4 grid stack (`useTakeoffWorkbook`/command-history) so we inherit undo/redo,
  context-menu row insert, and `source` provenance. Persist via the Phase 1 path.
- **Category is the combined-list distinguisher:** a `rounded-full` badge (reuse existing
  badge styling) — e.g. VE = savings tint, ALT = added-scope tint — plus a header toggle to
  filter/group by category. Single list, grouped by division (`DIVISION_LABELS`) when the
  sector default shows divisions.
- Sector default: Commercial → vendor+markup column visible, division grouping collapsed/off;
  MF → division-grouped, status + confidence visible. User can override the view.

### Phase 3 — Rollups + promote (cold-start brief)
- Summary header computed in `calculations.ts` (counts/totals by status and category; VE
  savings total; accepted-in-estimate vs accepted-pending).
- "Promote to estimate" sets status → `accepted_in_estimate` and inserts/links the item into
  STEP 4 via the existing command pipeline (must `pushCommand` for undo fidelity per AGENTS.md).

### Phase 4 — Export (cold-start brief)

**Feasibility — verified against the exporter (2026-06-08).** The writer follows the proven
`writeStep23SheetDetail` pattern ([exporter.ts:1086](../../src/lib/exporter.ts)), NOT the
hard STEP 4 row-insertion path:
- `resolveSheetFile(wbXml, relsXml, "VE / ALTS")` resolves any tab by literal name — STEP 2/3
  aren't in the `sheetNames` config either, so **no layoutConfig plumbing is required**.
- Parse `<sheetData>` → `flattenSharedFormulas` → locate rows → `getOrCreateCell` +
  `setCellValue` → rebuild → `zip.file()`. `fullCalcOnLoad="1"` recomputes all formulas on
  open; the final cross-sheet cached-error sweep handles a new tab generically.
- **No row insertion.** Author a fixed, generous block of pre-styled rows (target 200) and
  write the first N; leave the rest blank — mirrors STEP 2/3 and avoids the
  shared-formula-flatten / ref-shift / print-area machinery entirely (the riskiest exporter
  code). The exporter copies styles via `getStyleFromRow`, so pre-styled rows carry format.
- **Hard requirement:** the exporter mutates existing sheet XML; it cannot create a sheet.
  The VE/ALTS tab MUST be authored in `Company_Estimate_Template.xlsx` first (manual Excel
  step — **architect approval gate**). Nothing in `src` references the two old tabs (grep:
  one comment only), so deleting them from the template is safe.

**Concrete tab layout** (columns written ascending per CLAUDE.md; J + summaries as VALUES to
match the STEP 2/3 col-S tie-out discipline):

| Col | Field | | Col | Field |
|---|---|---|---|---|
| A | Category (VE / ALT) | | G | Ball-in-Court |
| B | Division ("09 — Finishes"; blank=Commercial) | | H | Vendor Cost (blank = direct-cost) |
| C | Item # / Label | | I | Markup % (blank = estimate default) |
| D | Description | | J | **Total** (app-computed VALUE) |
| E | Confidence (P/A/C) | | K | Comments |
| F | Status (Acc-In / Acc-Pending / Pending / Rejected) | | | |

Header rows 1–8: title + project name/location/date referencing STEP 1 (like old tabs) +
P/A/C legend. Summary rows: Total VE Savings, Total Accepted-in-Estimate, Total Pending.

**Steps:**
- Author the VE/ALTS tab in the template (get architect approval on layout); delete the two
  legacy tabs.
- Add a `writeVeAltsSheetDetail` writer in `exporter.ts` on the STEP 2/3 pattern above.
- **Fixed-capacity cap:** if item count exceeds the pre-authored rows, **fail loud** (throw,
  matching the codebase discipline) — never silently truncate.
- Reconciliation assertion: app totals == written tab totals (col-S tie-out discipline).

---

## Working agreement (per CLAUDE.md / AGENTS.md)

- One phase per fresh context window; each phase ends **green-committed** with a handoff note
  in `docs/handoffs/` that supplies the next phase's kickoff prompt.
- DB access only through `src/lib/db.ts`; schema change is canonical-first in
  `supabase_schema.sql` with explicit approval before live DDL.
- All math in `calculations.ts` (sole authority); never invent markup/totals elsewhere.
- All grid mutations push a `WorkbookCommand` for undo/redo fidelity.
- `npm run test` green before presenting each phase.

## Out of scope (deferred)

- Per-project-type *template files* (this plan keeps one workbook, sector-aware view).
- Importing VE/Alts from CSV (model supports `source: 'csv_import'`; no importer UI yet).
- Procore push of VE/Alts beyond the Excel tab.
