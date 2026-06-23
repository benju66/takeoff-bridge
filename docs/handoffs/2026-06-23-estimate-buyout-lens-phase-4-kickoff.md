# Phase 4 kickoff — Estimate Buyout Lens: rollup footer, % committed bar, golden guardrail

Paste the prompt below into a fresh session. It assumes no prior context.

---

Implement **Phase 4 (FINAL) of the Estimate Buyout Lens**, per
`docs/plans/2026-06-22-estimate-buyout-lens.md` (read that plan first — especially the
"Locked decisions" L-1..L-6 and D-A..D-E, the "Out of scope / deferred" list, and the
Phase 4 section).

## Where Phases 1–3 left off
Phases 1 (pure data layer), 2 (lens toggle + columns), and 3 (buyout undo/redo) are **DONE,
committed, and pushed** on branch `estimate-buyout-lens` (Phase 3 = commit `e075983`, off
`main` @ `d47c231`). **Continue on the existing `estimate-buyout-lens` branch — do NOT create a
new branch.** Suite is green at 1224 tests.

What exists now (the pieces Phase 4 builds on):
- `src/lib/buyout.ts` — **the rollup math is already written and fully unit-tested**:
  - `computeBuyoutRollup(rows: BuyoutRollupRow[]): BuyoutRollup` returns
    `{ estimateTotal, projectedCost, projectedVariance, committedEstimate, percentCommitted }`.
    Projected cost = Σ (Actual-or-Estimate); committed = Σ Estimate on lines with a non-blank
    Vendor; `percentCommitted` is guarded against a zero estimate total (L-4).
  - `BuyoutRollupRow = BuyoutLine & { estimate: number }` — one row's input: its computed
    Estimate (line Total) plus its `{ vendor, actual }` annotation.
  - `lineVariance`, `resolveActual`, `isCommitted` (per-line helpers), and the lens helpers
    (`LensView`, `buyoutColumnVisibility`, `normalizeLensView`).
  - **Phase 4 does NOT need new math** — it assembles `BuyoutRollupRow[]` and renders. Only add
    pure code if you find a genuine gap (e.g. a "rollup over filtered rows" variant).
- `src/hooks/useBuyoutTracking.ts` — `useBuyoutTracking(projectId)` → the `BuyoutStore`
  (`getLine`/`setVendor`/`setActual`/`map`), browser-local, fail-soft. Owned by
  `useTakeoffWorkbook`; exposed on the table `meta` as `meta.buyout` (and the Phase 3 undoable
  write helpers `meta.commitBuyoutVendor` / `meta.commitBuyoutActual`).
- `src/hooks/useTakeoffWorkbook.tsx` — owns `lensView`/`setLensView` (localStorage
  `tb.estimate.lensView`), the `buyout` store, and the three screen-only buyout columns. The
  **variance column renderer already resolves a line's Estimate exactly the way the rollup must**
  (so the footer ties to the cells) — copy this, do not re-derive it differently:
  ```ts
  const linked = getLinkedRowState(row);
  const estimate = linked ? (linked.stray ? 0 : linked.value) : row.total;
  ```
  `getLinkedRowState` is internal to `useTakeoffWorkbook`. **Recommendation:** assemble the
  `BuyoutRollupRow[]` (and/or call `computeBuyoutRollup`) INSIDE `useTakeoffWorkbook` where both
  `getLinkedRowState` and `buyout.map` live, and expose the result (a `buyoutRollup` value, or a
  memoized `buyoutRollupRows`) on the hook's return — so the footer and the variance cells share
  ONE estimate source and can never drift. Avoid recomputing per-row estimates in
  `EstimateTable.tsx` from a different code path.
- `src/components/workspace/EstimateTable.tsx` — the segmented `Estimate | Buyout` toolbar
  toggle; `lensView`/`setLensView` are props (threaded from `page.tsx`). This is where the
  footer renders. There is an existing collapsible analytics/status-bar area and a
  `tb.estimate.analyticsCollapsed` localStorage flag (mirror that `tb.estimate.*` convention if
  the footer needs its own collapse state — optional).

## Phase 4 scope (rollup footer + % committed bar + edge cases + guardrail proof)
1. **Footer rollup**, shown ONLY in the Buyout lens (`lensView === 'buyout'`), in the
   status-bar / analytics area of `EstimateTable.tsx`:
   - **Estimate total** · **Projected cost** · **Projected variance** (favorable green / over
     red, matching the variance column's `varianceDollars > 0 = favorable` convention).
   - A **"% of value committed"** progress bar driven by `rollup.percentCommitted` (L-4 — Σ
     Estimate on lines with a Vendor ÷ Σ Estimate). Show the % and the committed/total dollars.
2. **Edge cases (handle + document in code comments):**
   - **Empty state** — no data rows (e.g. a brand-new estimate): `computeBuyoutRollup([])`
     returns all-zero with `percentCommitted = 0` (already guarded) — render a sensible 0%/$0
     footer, not `NaN`/`Infinity`.
   - **Structural rows** — only DATA lines are buyout-able (D-C); division divider/total rows
     have no cells and must NOT contribute to the rollup. Identify how those rows are flagged in
     the grid (the same set the vendor/actual/variance cells skip or render blank for) and
     exclude them when assembling `BuyoutRollupRow[]`.
   - **Filter/search active** — DECIDE and DOCUMENT whether the rollup reflects the filtered
     view or the whole estimate. The plan **recommends the whole estimate**, with a small note in
     the footer when a filter is active (so a hidden line's commitment still counts). Whichever
     you pick, write the reason in a comment.
3. **Guardrail verification (the safety proof for the whole workstream):**
   - Run the golden harness — **McKenna / synthetic / CARE must still tie to $0.00** (proves
     buyout is display-only and never enters the engine/export). These run inside `npm run test`;
     name the golden spec(s) you confirmed in the handoff. (Note: the McKenna oracle lives in
     gitignored `fixtures/golden/` — if absent locally, state that and rely on the in-repo
     synthetic + CARE goldens.)
   - Confirm the **export payload and Procore budget are byte-unaffected** by buyout data
     (buyout columns are deliberately NOT in `columnDefs`, which the exporter iterates — verify
     no buyout field reaches `exporter.ts` / the Procore path).
   - **No Supabase advisors / no DDL** — buyout never touches the DB.

## Out of scope for Phase 4 (do NOT build)
- Per-line inspector depth (multiple quotes, award status, dates, attachments) — deferred.
- A vendor picker dropdown (Vendor stays free text) — deferred.
- Block-paste into Vendor/Actual (D-B) — deferred.
- Any DB/DDL, engine, or export change. A real shared `estimate_buyout` table is a future
  single-function swap, NOT this phase.

## Exit criteria (Definition of Done — CLAUDE.md)
- Full feature works end-to-end: toggle to Buyout, edit Vendor/Actual, see live per-line
  Variance AND the footer rollup + % committed bar update; undo/redo (Phase 3) still works.
- **Goldens tie $0.00** (McKenna / synthetic / CARE) and the export is unchanged — the proof
  that nothing moved a dollar.
- `npm run test` green · `npx tsc --noEmit` clean · `npm run build` green · changed files
  lint-clean (`npx eslint <files>` — repo has pre-existing lint debt; add no new problems).
  Add/extend tests for any new rollup-assembly logic (the pure `computeBuyoutRollup` is already
  covered; test the new "assemble rows + exclude structural rows + filtered-vs-all" logic if you
  add it as pure code).
- `/code-review` — resolve findings.
- Commit to `estimate-buyout-lens` via `git commit -F <tempfile>` (one commit for the phase)
  and **push the branch**.

## Approval gates
- **None inside Phase 4.** This is the final phase, so the handoff doc you write at the end
  should **propose the workstream-end merge to `main`** — that merge is the ONE gate and needs
  **explicit architect approval** (the push-to-`main` prompt from the push-guard hook IS the
  gate). Do NOT merge or push to `main` yourself. Per CLAUDE.md Git Workflow, default to a direct
  `--no-ff` merge after approval; a PR is opt-in only if the architect asks.

## Useful anchors / gotchas
- The rollup math (`computeBuyoutRollup`) and per-line helpers are DONE and tested in
  `src/lib/buyout.ts` — Phase 4 is assembly + rendering + the golden proof, not new arithmetic.
- **Tie the footer to the cells:** use the SAME per-row Estimate resolution the variance column
  uses (`getLinkedRowState(row) ? (stray ? 0 : value) : row.total`). Assembling the rollup inside
  `useTakeoffWorkbook` (next to `getLinkedRowState` + `buyout.map`) and exposing it is the clean
  way to guarantee that.
- The footer is screen-only state — never persist rollup numbers; always derive from the live
  rows + `buyout.map` so they can't drift.
- Buyout is browser-local (L-5): the footer reads `buyout.map`; it must never call a `db.ts`
  write or enter `calculations.ts`.
- Phases 1–3 left the suite at **1224 green**, `tsc`/`build` clean, lint-clean on changed files.
