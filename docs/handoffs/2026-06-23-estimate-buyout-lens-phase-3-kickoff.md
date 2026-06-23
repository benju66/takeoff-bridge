# Phase 3 kickoff — Estimate Buyout Lens: buyout undo/redo

Paste the prompt below into a fresh session. It assumes no prior context.

---

Implement **Phase 3 of the Estimate Buyout Lens**, per
`docs/plans/2026-06-22-estimate-buyout-lens.md` (read that plan first — especially the
"Locked decisions" L-1..L-6 and D-A..D-E, and the Phase 3 section).

## Where Phase 2 left off
Phase 1 (pure data layer) and Phase 2 (lens toggle + columns) are **DONE, committed, and
pushed** on branch `estimate-buyout-lens` (Phase 2 = commit `7d7c8b0`, off `main` @
`d47c231`). **Continue on the existing `estimate-buyout-lens` branch — do NOT create a new
branch.**

What exists now:
- `src/lib/buyout.ts` — pure math (`lineVariance`, `computeBuyoutRollup`, `resolveActual`,
  `isCommitted`) **plus** the Phase 2 lens helpers: `LensView`, `normalizeLensView`,
  `buyoutColumnVisibility` (the column SWAP), `BUYOUT_LENS_COLUMN_IDS` /
  `ESTIMATE_ONLY_COLUMN_IDS`, and the `BuyoutStore` interface (`getLine`/`setVendor`/
  `setActual`/`map`) — the shape exposed on the grid `meta`.
- `src/hooks/useBuyoutTracking.ts` — `useBuyoutTracking(projectId)`; localStorage-backed,
  fail-soft. Returns the `BuyoutStore`. **Owned by `useTakeoffWorkbook`** (`const buyout =
  useBuyoutTracking(projectId)`) and exposed on the TanStack table `meta` as `meta.buyout`.
- `src/types/index.ts` — `TableMeta` augmentation now carries `buyout?: BuyoutStore`.
- `src/hooks/useTakeoffWorkbook.tsx` — owns `lensView` state + `setLensView`
  (localStorage `tb.estimate.lensView`, default `estimate`), controlled `columnVisibility`,
  and the three screen-only buyout columns (`vendor`/`actual`/`variance`) appended to the
  `columns` array **after `total`**. The cells commit via `meta.buyout.setVendor/setActual`.
- `src/components/workspace/EstimateTable.tsx` — the segmented `Estimate | Buyout` toolbar
  toggle; `lensView`/`setLensView` are props (threaded from `page.tsx`).
- `src/hooks/useKeyboardNavigation.ts` — `vendor`/`actual` are editable; their input ids are
  `vendor-input-${i}` / `actual-input-${i}`; the Delete/Backspace branch clears a buyout cell
  via `meta.buyout` (vendor→`""`, actual→`null`), NOT the row-edit path.
- `src/components/workspace/NumberCellInput.tsx` — gained an opt-in `onCommitEmpty` callback
  (the `actual` cell uses it to clear to `null` instead of committing `$0`; qty/price unchanged).

**Phase 2 is undo-LESS by design — buyout edits do NOT yet enter the command stack. That is
exactly what Phase 3 adds.**

## Phase 3 scope (buyout undo/redo — still no DB/engine/export change)
1. **New command** `EDIT_BUYOUT_CELL` on the `WorkbookCommand` union (`src/types/index.ts`):
   `{ type: "EDIT_BUYOUT_CELL"; rowId: string; field: "vendor" | "actual"; prevValue: string
   | number | null; nextValue: string | number | null }`. (Add it to the union and import it
   into `useCommandHistory` like the other members.) It is the simplest command — single cell,
   no cascade, no DB.
2. **Push-before-mutate at EVERY buyout commit site** (AGENTS.md compounding-history). The
   sites are all in `useTakeoffWorkbook.tsx` + `useKeyboardNavigation.ts`:
   - the `vendor` cell `onCommit` (StringCellInput),
   - the `actual` cell `onCommit` (NumberCellInput) AND its `onCommitEmpty` (clear → null),
   - the keyboard-nav Delete/Backspace branch for `vendor` (→ `""`) and `actual` (→ `null`).
   At each site, read the current value FIRST (`buyout.getLine(rowId).vendor` / `.actual`) as
   `prevValue`, `pushCommand({ type: "EDIT_BUYOUT_CELL", ... })`, THEN call the store setter.
   Recommendation: wrap this in one small helper (e.g. `commitBuyoutVendor(rowId, next)` /
   `commitBuyoutActual(rowId, next)`) in `useTakeoffWorkbook` so all sites share the
   push-then-set path and the keyboard hook can reach it (thread it via `meta`, mirroring how
   `setVendor/setActual` are reached today). Skip the push when `prev === next` (no-op edit).
3. **Dispatch** — two effects in `src/hooks/useCommandDispatch.ts`: redo sets the buyout store
   to `nextValue`, undo to `prevValue`, routing on `field` (`setVendor` for vendor with a
   string; `setActual` for actual with a `number | null`). No `setRows` clone, no DB — just the
   localStorage setter. **`useCommandDispatch` does not currently receive the buyout store** —
   thread it in (it already takes `setRows`, registries, `setColumnDefs`, `setLockedCells`,
   `setBindings`; add the buyout store the same way). The store is owned by `useTakeoffWorkbook`
   (Phase 2), so just pass it down.
4. **Lens auto-flip (D-A)** — when an `EDIT_BUYOUT_CELL` is undone/redone while the Estimate
   lens is active, flip to the Buyout lens so the reverted cell is visible. Thread `setLensView`
   into the dispatch (or handle it in the `handleUndo`/`handleRedo` wrappers by peeking at the
   command about to be applied). Browser-local only — the flip never touches the DB.

## Out of scope for Phase 3 (do NOT build)
- The rollup footer + "% of value committed" progress bar (Phase 4).
- Block-paste into Vendor/Actual (deferred, D-B).
- Any DB/DDL, engine, or export change.

## Exit criteria (Definition of Done — CLAUDE.md)
- Ctrl+Z / Ctrl+Y reverse Vendor/Actual edits one commit at a time, **interleaved correctly
  with estimate edits on the shared stack** (do a mixed sequence: estimate edit → vendor edit →
  actual edit → undo×3 → redo×3).
- Undo/redo of a buyout edit writes **localStorage only** — no `rows` mutation, no `db.ts`
  write (verify via devtools or a targeted test).
- Lens **auto-flips to Buyout** when a buyout edit is undone/redone from the Estimate lens.
- `npm run test` green · `npx tsc --noEmit` clean · `npm run build` green · changed files
  lint-clean (`npx eslint <files>` — repo has pre-existing lint debt; add no new problems).
  Add a unit test for the `EDIT_BUYOUT_CELL` undo/redo dispatch (the dispatch logic is pure
  enough to test by driving the store setters with a fake `BuyoutStore`).
- `/code-review` — resolve findings.
- Commit to `estimate-buyout-lens` via `git commit -F <tempfile>` (one commit for the phase)
  and **push the branch**.
- Write the Phase 4 handoff doc (via `/handoff`). **STOP at the phase boundary — do not start
  Phase 4.**

## Approval gates
None in Phase 3 (no DDL, no push to `main`). The only `main`-touching step is the
workstream-end merge after Phase 4, which needs explicit architect approval.

## Useful anchors / gotchas
- `useCommandHistory.pushCommand` + the dispatch wiring live in `src/hooks/useCommandHistory.ts`
  and `src/hooks/useCommandDispatch.ts`. Model `EDIT_BUYOUT_CELL` on the existing
  `EDIT_CUSTOM_CELL` cases but DROP the `setRows`/DB parts — buyout has neither.
- `meta.buyout` is `BuyoutStore` (`src/lib/buyout.ts`); `EMPTY_BUYOUT_LINE` (blank line) is
  exported from `useBuyoutTracking.ts`. First-edit `prevValue` is `""` (vendor) / `null`
  (actual).
- The `actual` field is `number | null` — `prevValue`/`nextValue` for it can be `null`
  (cleared). The dispatch's `setActual` must pass `null` through unchanged.
- The buyout commit currently happens INSIDE the cell renderers (closures over `meta.buyout`).
  Keep the push-before-set ordering — the cell input fires `onCommit` only when the value
  actually changed, but still capture `prevValue` from the store at commit time, not from a
  stale closure.
- Goldens are untouched by Phase 3 (no engine/export path involved), but the Phase 4 DoD will
  re-run them as the final proof.
