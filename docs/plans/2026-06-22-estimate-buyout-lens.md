# Estimate Buyout Lens — Plan of Record
_2026-06-22 · status: PROPOSED_

## Goal
When this is done, the STEP 4 estimate grid has a **Buyout lens** — a small
`Estimate | Buyout` toggle in the grid toolbar. Flipping to Buyout *swaps* the
visible columns (it never adds to them, so the grid never gets wider): the
estimating-only columns (Quantity, Unit, Rate, Cost/Unit, Cost/S.F.) step aside
and **Vendor**, **Actual**, and **Variance ($ and %)** appear, alongside Code,
Description, and the line's Estimate total. Each line is where you record who you
awarded the work to and what it actually costs; Variance shows favorable/unfavorable
live. A footer rollup (Estimate total · Projected cost · Projected variance) plus a
"% of value committed" progress bar gives the at-a-glance "how's buyout going" read
the team currently gets from the right edge of the company spreadsheet.

Buyout data lives **only in the browser** (localStorage) for this version — it is a
private side-ledger that never touches the estimate's saved line items, the costing
engine, the Procore/Excel export, or the database. The bid math and exports are
provably unaffected (goldens still tie to $0.00). The path to a real shared
`estimate_buyout` table later is a single function swap.

## Out of scope / deferred
Explicitly NOT built in this plan (hooks/seams preserved for later):
- **No database, no DDL, no RPC.** Buyout never persists server-side in v1.
- **No per-line inspector depth** — multiple competing quotes, award status,
  buyout dates, attachments. (Future fast-follow via the existing `TrustInspector`
  slide-over pattern.)
- **No vendor picker dropdown** — Vendor is free text in v1 (can become a
  `SelectCellInput` backed by a vendor list later).
- **No multi-cell paste into Vendor/Actual** (block paste is deferred — the paste
  handler is multi-cell/multi-column and more entangled than undo; see D-B).
  _(Undo/redo for buyout IS in scope — see Phase 3.)_
- **No change to the export** (full workbook / Procore budget) — buyout columns are
  screen-only; the spreadsheet's own O/P columns are not written by the app.
- **No change to `src/lib/calculations.ts`** or any summary/rollup the engine owns.

## Locked decisions
Settled with the architect (2026-06-22 design session):
- **L-1 — Lens = column SWAP, not column ADD.** A toolbar toggle changes which
  columns are visible; same rows, same order, same row identity. This is the answer
  to "the table gets too wide."
- **L-2 — Buyout view columns:** Code · Description · Estimate (the line Total) ·
  Vendor (text) · Actual (number) · Variance ($ and %, color-coded).
- **L-3 — Variance convention:** `Variance = Estimate − Actual`; positive =
  favorable (came in under). An empty Actual *reads as* the Estimate (zero variance)
  — mirrors the template's `Actual = I` default. No pre-fill, no stored copy to drift.
- **L-4 — "% of value committed":** Σ Estimate on lines that have a Vendor ÷ Σ Estimate.
- **L-5 — Storage is browser-local only:** a standalone `useBuyoutTracking(projectId)`
  hook backed by `localStorage` keyed by line id. NOT `customFields` (which persists
  through `save_estimate_line_items` into the financial table). Decoupled from the
  estimate save entirely; respects AGENTS.md's financial-write / atomic-write /
  db.ts-gateway boundaries by simply never using those paths.
- **L-6 — Reuse the existing grid machinery:** column definitions flow through the
  `columns` `useMemo` in `useTakeoffWorkbook.tsx`; the buyout columns are new built-in
  column types; lens visibility uses TanStack's `columnVisibility` state; the
  `StringCellInput` / `NumberCellInput` editor *components* are reused (only their
  commit target changes — to the buyout store, not the workbook command/DB path).

Decisions settled with the architect (some revised 2026-06-22 after reviewing the
spreadsheet and the command system):
- **D-A — Buyout edits ARE undoable** (revised — was "no undo"). Buyout gets its own
  `EDIT_BUYOUT_CELL` command on the existing undo/redo stack — see Phase 3. It's the
  simplest command shape (single cell, no cascade, no DB). A buyout undo fired while in
  the Estimate lens auto-flips to the Buyout lens so the reverted cell is visible.
  Stays browser-local: undo calls the localStorage setter, never the DB.
- **D-B — Single-cell editing only** for Vendor/Actual in v1 (no block paste — harder
  than undo and left for later).
- **D-C — Every data line is buyout-able** (revised — was "subset"), including
  linked/bound rows. Vendor/Actual are independent columns that never touch a row's
  computed/linked value, so there's no reason to lock them — and the real spreadsheet
  buys out GC, contingency, and insurance lines (only the Fee row stayed blank). The
  only non-editable rows are the division divider/total rows, which have no cells.
- **D-D — Lens persists per browser** (`localStorage` key `tb.estimate.lensView`,
  matching the existing `tb.estimate.ioBarCollapsed` / `analyticsCollapsed` pattern);
  default = Estimate view, so first-time behavior is unchanged.
- **D-E — "Estimate" column in Buyout view reuses the existing line Total value**
  (including linked/bound rows' live value).

## Phases

### Phase 1 — Buyout data layer (pure logic + hook, no grid changes)
- **Scope:**
  - New `src/lib/buyout.ts` — pure, React-free functions: per-line variance ($ and
    %), the rollup (Estimate total, projected cost = Σ Actual-or-Estimate, projected
    variance), and "% of value committed". Fully unit-tested.
  - New `src/hooks/useBuyoutTracking.ts` — `localStorage`-backed map keyed by project
    + line id → `{ vendor, actual }`, with `getLine`, `setVendor`, `setActual`, and an
    in-memory React state mirror. Fail-soft (a write failure never throws into the UI).
  - No changes to the grid, `useTakeoffWorkbook`, the engine, or the DB.
- **Approval gates:** none (no DDL, no main push).
- **Exit criteria:** new Vitest specs for `buyout.ts` math + the hook pass ·
  `npm run test` green · `npx tsc --noEmit` clean · `npm run build` green ·
  `/code-review` resolved · committed to branch `estimate-buyout-lens` (message via
  `git commit -F`) · push branch · handoff doc written (via `/handoff`).

### Phase 2 — Lens toggle + buyout columns
- **Scope:**
  - Wire the Phase 1 `useBuyoutTracking(projectId)` store into `useTakeoffWorkbook`
    (owned there) and expose it on the table `meta`, so cell renderers — and the
    Phase 3 command dispatcher — can both reach it.
  - Add `lensView: 'estimate' | 'buyout'` state in `useTakeoffWorkbook.tsx`
    (localStorage `tb.estimate.lensView`), exposed to `EstimateTable`.
  - Toolbar **segmented toggle** (`Estimate | Buyout`) in `EstimateTable.tsx`
    (next to Search / Add Column / Undo / Redo).
  - Three new built-in columns in the `columns` `useMemo` switch
    (`useTakeoffWorkbook.tsx`): `vendor` (edit via reused `StringCellInput`),
    `actual` (edit via reused `NumberCellInput`), `variance` (read-only display, $ + %,
    color-coded). Their `onCommit` routes to the buyout store exposed on table `meta`
    (NOT `meta.handleCellEdit`/`commitCellEdit` — so nothing reaches rows or the DB;
    the undo command is added in Phase 3). Add their column defs to `DEFAULT_COLUMN_DEFS`.
  - Derive TanStack `columnVisibility` from `lensView` (added to the table `state` at
    `useTakeoffWorkbook.tsx:1486`): Buyout view shows Code/Description/Total/Vendor/
    Actual/Variance and hides Quantity/Unit/Rate/Cost-Per-Unit/Cost-Per-SF; Estimate
    view is unchanged (buyout columns hidden).
  - Add `vendor`/`actual` to the keyboard-nav `editableColumns` list so arrow/Tab/Enter
    work; per D-C every data row is editable (only divider/total rows have no cells).
- **Approval gates:** none.
- **Exit criteria:** flipping the lens swaps columns with no width growth · editing
  Vendor/Actual persists to localStorage and survives reload · confirmed (devtools or
  a targeted test) that no buyout edit mutates `rows` or calls a db.ts write (undo
  wiring comes in Phase 3) · Variance computes live · test/tsc/build green ·
  `/code-review` · commit + push branch · handoff.

### Phase 3 — Buyout undo/redo
- **Scope:**
  - New `EDIT_BUYOUT_CELL` member on the `WorkbookCommand` union (`src/types/index.ts`):
    `{ rowId, field: 'vendor' | 'actual', prevValue, nextValue }`.
  - At the buyout commit site, `commandHistory.pushCommand()` BEFORE the store setter
    (same "push before mutate" pattern every other edit uses).
  - Two cases in `src/hooks/useCommandDispatch.ts` — redo sets the buyout store to
    `nextValue`, undo to `prevValue`. Simpler than the existing `EDIT_CUSTOM_CELL`
    cases (no `setRows` clone, no DB; just a localStorage setter).
  - Confirm the buyout store is owned by `useTakeoffWorkbook` (done in Phase 2) so the
    dispatcher can reach it.
  - A buyout undo/redo fired while in the Estimate lens auto-flips to the Buyout lens
    so the reverted cell is visible.
- **Approval gates:** none.
- **Exit criteria:** Ctrl+Z / Ctrl+Y reverse Vendor/Actual edits one commit at a time,
  interleaved correctly with estimate edits on the shared stack · undo of a buyout edit
  writes localStorage only (no `rows`/DB touched) · lens auto-flip works · test/tsc/build
  green · `/code-review` · commit + push branch · handoff.

### Phase 4 — Rollup footer, progress bar, edge cases + guardrail verification
- **Scope:**
  - Footer **rollup** in the status-bar / analytics area of `EstimateTable.tsx`,
    shown in Buyout view: Estimate total · Projected cost · Projected variance
    (favorable/unfavorable color) · a **"% of value committed"** progress bar.
  - Edge cases: empty-state (no rows); every data row is buyout-able (D-C) so there's
    no row-exclusion logic — only divider/total rows lack cells; behavior when
    filters/search hide rows (rollup reflects visible vs all — decide and document).
  - **Guardrail verification:** run the golden harness — McKenna / synthetic / CARE
    still tie to **$0.00** (proves buyout is display-only and never enters the
    engine/export); confirm the export payload and Procore budget are byte-unaffected
    by buyout data; no Supabase advisors to run (no DB touched).
- **Approval gates:** none within the phase. **Workstream-end merge to `main`** is the
  one gate (explicit architect approval; the push-to-main prompt is the gate).
- **Exit criteria:** full feature works end-to-end · goldens tie $0.00 · export
  unchanged · test/tsc/build green · `/code-review` · commit + push branch · handoff
  doc proposing the merge-to-main.

## Risks & unknowns
- **Undo is in scope (Phase 3); block-paste stays deferred.** Buyout bypasses the
  workbook command/DB path, so neither comes automatically. Undo is a clean extension
  of the existing command system (a new `EDIT_BUYOUT_CELL` modeled on `EDIT_CUSTOM_CELL`,
  minus cascade and DB) — low risk. Block-paste is harder (the paste handler is
  multi-cell/multi-column) and is left for later (D-B).
- **Rows buyout-able (D-C) — resolved:** every data line, matching the spreadsheet
  (which buys out GC/contingency/insurance). No special-casing; buyout cells never touch
  a row's computed value, so even linked/bound rows are safe to annotate.
- **Column-visibility ↔ filter/search interaction.** Hidden columns must not break
  existing column filters or global search. Phase 2 verifies; low risk (TanStack keeps
  filter state independent of visibility).
- **Rollup over filtered vs all rows.** Phase 4 must pick and document whether the
  rollup/percent reflects the filtered view or the whole estimate (recommend: whole
  estimate, with a note if a filter is active).
- **Nothing here can move a dollar** — the strongest safety property. The Phase 4
  golden run is the proof; if a golden ever moves, the plan is wrong and stops.

## Phase 1 kickoff prompt
```
Implement Phase 1 of the Estimate Buyout Lens, per docs/plans/2026-06-22-estimate-buyout-lens.md.

Scope (Phase 1 ONLY — the pure data layer, no grid changes):
1. Create branch `estimate-buyout-lens` off the latest main.
2. Add src/lib/buyout.ts — pure, React-free functions: per-line variance ($ and %),
   the rollup (estimate total; projected cost = sum of Actual-or-Estimate; projected
   variance), and "% of value committed" (sum of Estimate on lines with a Vendor /
   sum of Estimate). Empty Actual reads as Estimate (zero variance) per L-3.
3. Add src/hooks/useBuyoutTracking.ts — a localStorage-backed map keyed by project +
   line id -> { vendor, actual }, with getLine/setVendor/setActual and an in-memory
   React mirror. Fail-soft: a localStorage write failure must never throw into the UI.
   Mirror the existing tb.estimate.* localStorage convention in EstimateTable.tsx.
4. Do NOT touch the grid, useTakeoffWorkbook, the calculation engine, the export, or
   the database. No DDL. This phase is invisible to the user by design.
5. Write Vitest specs for buyout.ts (variance signs, empty-actual=estimate, rollup,
   % committed incl. zero-estimate guard) and for the hook (set/get/persist).

Take it through the Definition of Done (CLAUDE.md): npm run test green, npx tsc
--noEmit clean, npm run build green, /code-review, then commit to the branch via
git commit -F and push the branch. STOP at the phase boundary — do not start Phase 2.
Close with the /handoff skill sequencing Phase 2.
```
