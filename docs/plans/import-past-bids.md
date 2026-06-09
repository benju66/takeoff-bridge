# Import Past Bids as Projects — Plan

> Draft 2026-06-09. Architect: Lochness. Status: PLANNING (approved direction; Phase 1 builds in a
> fresh session). One phase per cold session, green-committed + handoff each time (see
> `[[feedback-one-phase-per-fresh-session]]`).

## Context

The team's history of completed estimates lives in company-template Excel workbooks. We want to bring
those past bids **into the app as real projects** so estimators can reuse them, compare them, and
eventually mine them for pricing. The groundwork already exists: `src/lib/templateExtractor.ts` was
written (and its header explicitly says) to "turn an existing workbook into a project," and the B-1
synthetic-golden work just exercised the full extract path end-to-end. This plan wires that engine to a
new front door and closes the two gaps the architect flagged: **ad-hoc / non-deterministic cost codes**
and **the same cost code used on two lines for different scopes** (e.g. interior vs. exterior
`08-4000.002` storefront).

Intended outcome: drop a past company-template `.xlsx` → see it parsed, enriched, and **proven to tie
to the cent against the original** → save it as a fully editable project — with no dollar ever silently
dropped.

## Locked decisions (architect, 2026-06-09)

1. **Source scope:** **company-template workbooks only** (STEP 1–4 + Budget Line Items). The extractor
   already reads these to the cent. Arbitrary/legacy spreadsheets are explicitly out of scope.
2. **Phasing:** all three goals, phased — **Phase 1 editable import**, then **Phase 2 archive &
   comparison**, then **Phase 3 pricing/learning harvest**.
3. **Same code, different scope = presentation only.** Interior vs. exterior share one cost code → one
   BLI → one Procore line (dollars sum there, which is correct). The distinction is for estimating
   clarity and owner-facing breakdowns, **not** a code, export, or learning dimension. Therefore:
   - Represent the two as **independent lines**; the human distinction rides in the **description**
     ("Aluminum Storefront Doors – Interior" / "– Exterior").
   - **No first-class `scope` field, no schema change.** If structured Interior/Exterior subtotals are
     wanted later, add a **"Scope" custom column** via the app's existing custom-column feature (zero
     schema change), promotable to a typed field additively.
4. **Ad-hoc lines: import everything, never drop a dollar.** Conforming-but-uncatalogued codes import
   as **unmapped** (Flags worklist + B-4 assign). Non-conforming / no-code lines import as **manual
   rows flagged `needsReview`**, dollars preserved, so the total still ties.
5. **Learning stays shallow in Phase 1** (keep recording to `classification_history` as today). Wiring
   a consumer that ranks suggestions from history is **Phase 3**.

## Existing assets we reuse (do not rebuild)

- **Extraction:** `loadTemplateWorkbook` / `extractEstimate` / `toProcessedRows` /
  `linkedTotalsFromExtract` (`src/lib/templateExtractor.ts`).
- **Persistence (single gateway):** `saveProject` + the atomic `saveEstimate` → `save_estimate` RPC
  (`src/lib/db.ts`); line items only via that RPC (AGENTS.md).
- **Enrichment chokepoints:** `resolveProcoreCode` (`src/lib/costCodeResolver.ts`),
  `resolveCatalogPrice` (`src/lib/rateResolver.ts`) — primed at mount the same way
  `useTakeoffWorkbook` does (`getCostCodeMap` / `getRateCard`).
- **Trust/reconciliation:** `validateExportReadiness` + the reconciliation model the Trust Inspector
  already renders (`src/lib/exporter.ts`, `src/lib/trustInspector.ts`), and the cent tolerance
  `RECONCILIATION_TOLERANCE`.
- **Unmapped recovery:** the Flags worklist (`buildFlagsModel`) + B-4 inline assign (`assignCode.ts`).
- **Staged-import UX pattern:** `useFileIngestion` + `ImportPreviewModal` + `mergeTakeoff`
  (preview → confirm → one undoable command).
- **Summary engine:** `computeTakeoffSummary` (sole financial authority).

---

## Phase 1 — Editable import (the reusable starting point)

Flow: **Upload → Extract → Enrich → Tie-out gate → Save as project.**

### 1. Upload + extract
- A new "Import past estimate" entry point on the projects dashboard (`src/app/projects/page.tsx`),
  opening a dedicated import preview (reuse the `ImportPreviewModal` idiom, not the takeoff parser).
- Read the buffer via `loadTemplateWorkbook` → `extractEstimate` → `ExtractedEstimate`.

### 2. Map inputs → a Project
- From `extracted.inputs`: name, squareFootage, unitCount, expectedStart/Finish, and the 7 modifier
  rates. `location`/`marketSector` default (user can edit); `bidDate` = today. Persist via `saveProject`.

### 3. Enrich line items (the real work)
- Start from `toProcessedRows(extracted.lineItems)`, then enrich each row (today it leaves these blank):
  - `procoreCode` = `resolveProcoreCode(itemId)` (prime the resolver first). Empty → unmapped.
  - `costType` / `uom` from `ESTIMATE_ITEMS_MASTER[itemId]` when catalogued; otherwise carry the sheet
    value / flag for review. **Never overwrite the imported `unitPrice`** — historical fidelity is the
    whole point (resolve the *code*, keep the bid's *price*).
  - `source` = a provenance value for imported rows (see Open items).
- **Unique row IDs for same-code lines.** `toProcessedRows` uses `oracle-r${rowNumber}` (already unique
  by source row) — keep a per-row-unique scheme (e.g. `import-${itemId}-r${rowNumber}`); do **not**
  reuse the bare `import-${itemId}` (it collides for two storefront lines).
- **Cascade-independence (the same-code safety fix).** Imported finished-bid lines are individually
  authored, so they must not auto-overwrite each other via the classification cascade
  (`useCellEditing.ts` keys the cascade on `classification`). Make imported rows cascade-independent
  (e.g. they do not cross-link by classification), so editing one storefront line never clobbers the
  other. **Surgical:** preserve the takeoff-CSV cascade behavior; only prevent independently-authored
  rows from cross-linking. Recording to `classification_history` (learning) stays independent of the
  cascade, so imports can still feed learning.

### 4. GC / Site-Ops linked values (the hand-authored-sheet limitation, finding G-2)
- A real bid's STEP 2/3 are hand-authored, so we cannot reconstruct the parametric drivers. Import the
  **10 linked division values as static figures** (`linkedTotalsFromExtract`) so `computeTakeoffSummary`
  counts them and the imported total ties. Flag these sections "review to re-drive." *(Design point:
  where the static linked values live so they survive reload — the cleanest is to persist them on the
  estimate and feed them as `linkedTotals`; confirm during build.)*

### 5. Tie-out acceptance gate (the trust centerpiece)
- Before saving, run `computeTakeoffSummary` on the enriched rows + static linked totals and **show
  "Imported total $X — ties your original $Y to the cent ✓"** using `RECONCILIATION_TOLERANCE`
  (the workbook's own oracle totals come from `extracted.oracle`). If it doesn't tie, surface the
  delta and the unmapped/ad-hoc lines rather than saving silently.

### 6. Persist
- Save atomically via `saveEstimate(estimate, rows)` (the `save_estimate` RPC); line items carry
  `sort_order` from array index (preserve the sheet's order). Optionally a fire-and-forget
  `createEstimateSnapshot` milestone.

### Critical files (Phase 1)
- `src/lib/templateExtractor.ts` (enrich `toProcessedRows`, or enrich in the import flow), `src/lib/db.ts`
  (reuse `saveProject` / `saveEstimate`), a new import flow/component under `src/components/workspace/`
  or `src/app/projects/`, `src/hooks/useCellEditing.ts` (surgical cascade-independence for imported
  rows), `src/lib/calculations.ts` (read-only; sole authority).

---

## Phase 2 — Archive & comparison

Imported bids become baselines. Turn on the already-planned **Estimate Versions & Comparison** feature
(`[[estimate-versions-feature]]`; the `estimate_snapshots` table is built and unused) — searchable past
bids and a side-by-side Δ-vs-baseline view. UI-leaning; minimal/no schema work.

## Phase 3 — Pricing / learning harvest

Consume the data imports produce: (a) mine imported line items for **historical unit prices** to sharpen
the rate-card defaults and catalog, and (b) finally **consume `classification_history`** (recorded today,
read by nothing) to rank code suggestions for unmapped/ad-hoc lines. Most backend-leaning; the phase most
likely to need a small schema decision (gate for architect approval + `supabase:supabase`).

---

## Cross-cutting constraints (AGENTS.md)

- **Single persistence gateway:** all DB access via `src/lib/db.ts`; line items only via `save_estimate`.
- **Provenance:** every row carries a `source`; capture it in any command's prev/next states.
- **Training-data immutability:** `classification_history` / `estimate_snapshots` are append-only,
  fire-and-forget (`.catch(() => {})`).
- **Division utility:** use `getDivisionCode()` for any division placement (e.g. `divisionInsertIndex`).
- **No invented financials:** `computeTakeoffSummary` stays the sole authority; import only *reads* the
  sheet's own numbers and re-derives via the engine.

## Same-code / scope handling (explicit)

- Two lines, same code, different scope → **independent lines**; distinction in the **description**.
- Estimate grid + owner-facing estimate views show both lines; **Procore/BLI rollup sums them into one
  code** (`exporter.ts` `rollupByProcoreCode`) — correct and intended.
- Safety: imported/manual same-code rows never silently overwrite each other (cascade-independence +
  unique IDs).
- Upgrade path if structured subtotals are wanted: a "Scope" **custom column** (no schema change).

## Ad-hoc / non-deterministic codes (explicit)

- The extractor only reads STEP 4 rows matching `NN-NNNN.NNN` (`templateExtractor.ts` COST_CODE_RE) —
  **today it silently skips ad-hoc lines.** Close this: capture non-conforming lines too and import them
  as `needsReview` manual rows (dollars preserved) so the total ties; conforming-but-uncatalogued codes
  import as unmapped (Flags + B-4). Never drop a dollar.

## Risks / watch-items

- **Cascade change must be surgical** — it touches the heavily-tested undo system. Add focused tests;
  do not broadly rewrite `applyCellEditDirect`.
- **Static GC/Site-Ops linked values** — confirm where they persist so reload still ties.
- **Same-code ID collisions** — verify unique IDs across import + the on-reload `row-${itemId}-N`
  renumbering (`useTakeoffWorkbook.tsx`).

## Open items (decide during build, not blockers)

- **Provenance value:** reuse `csv_import` (no model change) vs. add a clean `imported` source + Phase-5
  glyph (clearer owner-facing trust story). Lean: add `imported`.
- **Optional "Scope" custom column** timing (only if owner reports want structured subtotals).

## Verification

- **Import tie-out test (CI-safe):** extend the B-1 pattern — build a synthetic past-bid workbook
  (`src/__tests__/fixtures/syntheticTemplate.ts`), run the import enrichment + `computeTakeoffSummary`,
  assert the imported total ties the oracle to the cent and that an ad-hoc (uncatalogued) line is
  imported (not dropped) and flagged.
- **Same-code independence test (node):** two rows sharing `08-4000.002` with distinct descriptions —
  editing one does not mutate the other; both persist and reload as distinct rows; both roll up to one
  Procore code.
- **Suite green** (`npm run test`) + `tsc` + `/code-review` before delivery; golden McKenna + synthetic
  golden must keep tying $0.00.
- **Manual e2e:** import a real company-template bid, confirm the tie-out banner, save, reopen the
  project, confirm line order + totals.
