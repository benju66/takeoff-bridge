# Phase 2 kickoff — Estimate Buyout Lens: lens toggle + buyout columns

Paste the prompt below into a fresh session. It assumes no prior context.

---

Implement **Phase 2 of the Estimate Buyout Lens**, per
`docs/plans/2026-06-22-estimate-buyout-lens.md` (read that plan first — especially the
"Locked decisions" L-1..L-6 and D-A..D-E, and the Phase 2 section).

## Where Phase 1 left off
Phase 1 (the pure data layer) is **DONE, committed, and pushed** on branch
`estimate-buyout-lens` (commit `78e4184`, off `main` @ `d47c231`). It added two files and
their specs — nothing is wired into the UI yet:
- `src/lib/buyout.ts` — pure math: `lineVariance({ estimate, actual })` →
  `{ projectedCost, varianceDollars, variancePct }` (empty `actual` reads as `estimate`,
  L-3); `computeBuyoutRollup(rows)` → `{ estimateTotal, projectedCost, projectedVariance,
  committedEstimate, percentCommitted }` (L-4, zero-denominator guarded); plus
  `resolveActual`, `isCommitted`. Types: `BuyoutLine { vendor: string; actual: number | null }`,
  `BuyoutRollupRow extends BuyoutLine { estimate: number }`.
- `src/hooks/useBuyoutTracking.ts` — `useBuyoutTracking(projectId)` returning
  `{ getLine(rowId) → BuyoutLine, setVendor(rowId, vendor), setActual(rowId, actual|null),
  map }`. localStorage key `tb.buyout.<projectId>`, fail-soft (read/write never throw;
  read boundary sanitizes entries). Hydrates via lazy `useState` initializer +
  adjust-state-on-prop-change (NO hydration effect — keep it that way; an effect trips
  `react-hooks/set-state-in-effect`). Exported pure helpers (already unit-tested):
  `buyoutStorageKey`, `readBuyoutMap`, `writeBuyoutMap`, `setLineField`, `EMPTY_BUYOUT_LINE`.

**Continue on the existing `estimate-buyout-lens` branch — do NOT create a new branch.**
(Per CLAUDE.md, one branch per workstream; every phase commits to it.)

## Phase 2 scope (lens toggle + buyout columns — still no DB, no engine/export changes)
1. **Own the store in `useTakeoffWorkbook`.** Call `useBuyoutTracking(projectId)` inside
   `useTakeoffWorkbook.tsx` and expose it on the TanStack table `meta` so cell renderers —
   and the Phase 3 command dispatcher — can both reach it. (Find the existing `meta` object
   passed to `useReactTable`; add the buyout store handle there.)
2. **Lens state.** Add `lensView: 'estimate' | 'buyout'` in `useTakeoffWorkbook.tsx`,
   persisted to `localStorage` key `tb.estimate.lensView` (D-D; mirror the existing
   `tb.estimate.ioBarCollapsed`/`analyticsCollapsed` lazy-initializer pattern in
   `EstimateTable.tsx`). Default = `'estimate'` so first-time behavior is unchanged. Expose
   it (and a setter) to `EstimateTable`.
3. **Toolbar segmented toggle** `Estimate | Buyout` in `EstimateTable.tsx`, next to
   Search / Add Column / Undo / Redo.
4. **Three new built-in columns** in the `columns` `useMemo` switch in
   `useTakeoffWorkbook.tsx`, and add their defs to `DEFAULT_COLUMN_DEFS`:
   - `vendor` — edit via the **reused** `StringCellInput`; `onCommit` routes to the buyout
     store's `setVendor` (NOT `meta.handleCellEdit`/`commitCellEdit`).
   - `actual` — edit via the **reused** `NumberCellInput`; `onCommit` routes to `setActual`.
   - `variance` — read-only display, `$` and `%`, color-coded favorable/unfavorable (use
     `lineVariance` from `buyout.ts`; the row's Estimate is its existing line `total`, D-E,
     including linked/bound rows' live value).
   The buyout commit path must NOT touch `rows`, call any `db.ts` writer, or push an undo
   command yet (undo is Phase 3).
5. **Column visibility from `lensView`.** Derive TanStack `columnVisibility` (added to the
   table `state`, ~`useTakeoffWorkbook.tsx:1486`): Buyout view shows
   Code/Description/Total/Vendor/Actual/Variance and HIDES
   Quantity/Unit/Rate/Cost-Per-Unit/Cost-Per-SF; Estimate view unchanged (buyout columns
   hidden). This is a column **swap**, not add (L-1) — verify the grid does not get wider.
6. **Keyboard nav.** Add `vendor`/`actual` to the `editableColumns` list so arrow/Tab/Enter
   work. Per D-C every data row is buyout-able (incl. linked/bound rows); only divider/total
   rows have no cells.

## Out of scope for Phase 2 (do NOT build)
- Undo/redo for buyout (Phase 3 — `EDIT_BUYOUT_CELL`).
- The rollup footer + "% of value committed" progress bar (Phase 4).
- Any DB/DDL, engine, or export change. No vendor-picker dropdown (free text v1). No
  multi-cell paste into Vendor/Actual.

## Exit criteria (Definition of Done — CLAUDE.md)
- Flipping the lens swaps columns with **no width growth**.
- Editing Vendor/Actual persists to localStorage and **survives reload**.
- Confirm (devtools or a targeted test) that **no buyout edit mutates `rows` or calls a
  db.ts write** (undo wiring is deferred to Phase 3).
- Variance computes live.
- `npm run test` green · `npx tsc --noEmit` clean · `npm run build` green ·
  new files lint-clean (`npx eslint <changed files>` — repo has pre-existing lint debt;
  add no new problems).
- `/code-review` — resolve findings.
- Commit to `estimate-buyout-lens` via `git commit -F <tempfile>` (one commit for the
  phase) and **push the branch** to back it up.
- Write the Phase 3 handoff doc (via `/handoff`). **STOP at the phase boundary — do not
  start Phase 3.**

## Approval gates
None in Phase 2 (no DDL, no push to `main`). The only `main`-touching step is the
workstream-end merge after Phase 4, which needs explicit architect approval.

## Useful anchors
- localStorage convention: `EstimateTable.tsx` ~lines 450-467 (`tb.estimate.*` lazy
  initializer + persist).
- `ProcessedTakeoffRow.total` is the line's Estimate value (`src/types/index.ts:35`).
- Reused editors `StringCellInput` / `NumberCellInput` and `DEFAULT_COLUMN_DEFS` live in
  the grid/column code under `src/components/workspace/` and `src/hooks/useTakeoffWorkbook.tsx`.
