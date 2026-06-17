# Estimate Grid — Density, Excel Focus Behaviors + Freeze Panes — Plan of Record
_2026-06-15 · status: PROPOSED_

## Goal
Make the estimate grid feel more like Excel for laptop-bound estimators, in
three independent, view-and-input-only improvements (no numbers, database,
exports, or calculation logic change):

1. **Tighter cell density.** Trim the generous in-cell white space so noticeably
   more construction lines fit on a laptop screen, without shrinking the text.
2. **Sharper cell focus / data-entry feel.** Typing a value then pressing an
   arrow key commits and moves (Excel rapid-entry), while F2 gives in-cell cursor
   editing; Enter consistently commits-and-moves-down; Ctrl+Arrow jumps to the
   edge of the data.
3. **Freeze panes (column freezing).** Keep the left-hand identity columns in
   place while the cost columns scroll horizontally.

These are ordered by cost/value: density and focus are cheap, low-risk, daily
wins; freezing carries the only real technical risk and is split so the valuable
part ships first and the flexible part is optional.

## Re-weighting note (2026-06-15)
After review, the freeze work was **re-weighted**. The earlier draft led with a
user-adjustable draggable freeze line; for a single-company tool with one
workflow that is gold-plating. The plan now ships an **always-on fixed freeze**
as the default deliverable, and treats the **adjustable freeze line as optional /
on-demand** — build it only if estimators actually ask to move the boundary.

## Out of scope / deferred
- **Fill-down (Ctrl+D)** — deferred by the architect. No new write path anywhere
  in this plan, so undo/redo is untouched.
- **Rectangular / block cell selection** and block copy-paste — still deferred.
- **Adjustable freeze line + persistence** — moved to an **optional** phase
  (Phase 4); not part of the committed scope unless requested.
- **A density toggle (Normal/Compact switch).** We ship one good dense default
  rather than a user setting; a toggle can come later only if the tighter default
  proves too tight for someone.
- **Any database, schema, RPC, or export-template change.**
- **Shrinking the font** — the text is already ~Excel size; density comes from
  padding/row-height only.

## Locked decisions
- **Density = one new tighter default**, no toggle. Target ~30px rows (down from
  ~40px), keep `text-xs` (12px) font. Tunable during the phase.
- **Focus behaviors:** two-mode arrows keyed off the existing `initialEditChar`
  flag; uniform Enter = commit-and-move-down; Ctrl+Arrow = jump to first/last
  row/column. **No fill-down.**
- **Freeze = always-on fixed set by default** (frozen through `itemId`), built on
  TanStack v8 `columnPinning`. Adjustable line is optional (Phase 4).
- **Build on TanStack, do not fork.**
- **`.agent/skills/data-table-architecture/SKILL.md` is the governing contract** —
  every phase respects its invariants (commit-before-unmount, no `onDoubleClick`,
  single-container keyboard owner, never add `selection` to the column `useMemo`
  deps, never add `tabIndex`/`onKeyDown` to cell divs) and updates the relevant
  section.
- **EstimateTable is the only TanStack grid in the app** (verified) — other pages
  are untouched.

## Phases

> Phases are independent and ordered cheapest-first. Each is one fresh session.
> Phase 4 is **optional** — only run it if the always-on freeze proves
> insufficient.

### Phase 1 — Cell density tightening
- **Scope:** pure CSS / sizing, no logic.
  - Reduce the per-cell padding that creates the white space. Concretely, the
    `min-h-[36px] px-3 py-2` classes on the editable inputs and the matching
    display `<div>`s in `useTakeoffWorkbook.tsx` column defs (~lines 699–1241),
    and the `p-3` display-cell padding in `EstimateTable.tsx`. Proposed starting
    point: `py-2 → py-1` (8px → 4px vertical), `px-3 → px-2` (12px → 8px),
    `min-h-[36px] → min-h-[28px]`. Tune to taste.
  - Drop the virtualizer row-height estimate to match:
    `estimateSize: 40 → ~30` for data rows, `44 → ~36` for dividers
    (`EstimateTable.tsx:473`).
  - Keep font at `text-xs` (12px). Verify the icon/button cells (trash 16px,
    status dot, notes button, suggestion chips) still center cleanly in the
    shorter row.
  - Result target: ~30px rows → roughly 50 visible rows on a laptop vs ~35 today,
    a ~40% density gain, while staying a touch airier than raw Excel (~20px) for
    web hit-targets and antialiasing.
- **Approval gates:** none beyond no-push-to-main. No DDL, no export.
- **Exit criteria:** `npm run test` green · `npx tsc --noEmit` clean · lint no new
  warnings · both goldens `$0.00` · committed (`git commit -F`) · handoff written.

### Phase 2 — Excel focus behaviors
- **Scope:** all in `useKeyboardNavigation.ts` (+ possibly the cell-input
  components); **no command-history, persistence, or layout changes.**
  - **(a) Two-mode arrow keys**, using the existing `initialEditChar` flag as the
    discriminator: cell entered by typing → arrows commit-and-move; cell entered
    by F2 → Left/Right move the caret (already works), Up/Down stay in the cell.
    Today Up/Down are swallowed while editing (`useKeyboardNavigation.ts:184`–`206`).
  - **(b) Uniform Enter = commit-and-move-down** — already true in the generic
    path (`:107`–`151`); verify for every editable column and fix the likely
    exception (the UOM `SelectCellInput` may capture Enter for option selection).
  - **(c) Ctrl+Arrow jump-to-edge** — Ctrl+Up/Down → first/last row,
    Ctrl+Left/Right → first/last column (every row is populated, so edge =
    first/last). Pure navigation reusing `focusWithScroll` + `setSelection`.
  - Update the Keyboard Navigation Map (SKILL.md §5).
- **Approval gates:** none beyond no-push-to-main.
- **Exit criteria:** tests green (add coverage for the new arrow/Enter behaviors)
  · tsc clean · lint clean · goldens `$0.00` · SKILL.md §5 updated · committed ·
  handoff written.

### Phase 3 — Column freeze (always-on) + de-risk spike
- **Scope:**
  - **Open with a throwaway spike:** does `position: sticky; left: …` hold on
    cells inside the grid's absolutely-positioned, `translateY`-transformed virtual
    rows (`EstimateTable.tsx:798`–`1088`)? Prove it on the header + one data row.
    - ⛔ **Decision gate:** if sticky holds → continue. If not → **STOP and hand
      back to the architect**; the two-table split-grid fallback is a larger
      architecture change deserving its own re-plan, not a same-session overrun.
  - Enable TanStack `columnPinning`; pin a **fixed** left set (default: frozen
    through `itemId`) via a constant `frozenColumnCount`.
  - Apply the live sticky-left offset (`column.getStart('left')`, so it survives
    column resizing) to the frozen cells in **all five** column-mapping sites: the
    sticky **header**, the **data** rows, the **division divider** rows, and the
    **three tfoot summary** rows (subtotal, modifiers, grand total). Missing any
    one misaligns the freeze.
  - Settle **z-index** against the existing layers (sticky header `z-10`,
    selected-cell glow, dropdowns `z-20`).
  - Add **horizontal scroll-into-view** so a cell scrolled *behind* the frozen
    pane scrolls clear of it — today `focusWithScroll` (`useKeyboardNavigation.ts:21`)
    only scrolls vertically.
  - Verify left/right + Tab navigation still reads correct column order (pinned
    columns are already leftmost, so order is unchanged).
- **Approval gates:** ⛔ the spike decision gate. No DDL, no export, no push to main.
- **Exit criteria:** tests green · tsc clean · lint clean · goldens `$0.00` ·
  new "Column Pinning" section in SKILL.md · committed · handoff written.

### Phase 4 — Adjustable freeze line + persistence *(OPTIONAL — on demand)*
- **Run only if estimators ask to move the freeze boundary.**
- **Scope:** replace the Phase-3 constant with a user-controlled boundary
  (Excel-style freeze line; documented fallback = a per-header "Freeze up to this
  column / Unfreeze" context-menu action). Persist the choice in `localStorage`
  keyed per project. Verify column resize keeps the freeze offsets consistent.
- **Approval gates:** none beyond no-push-to-main.
- **Exit criteria:** same bar as the other phases.

## Impact on the rest of the app
- **Undo / redo:** **no impact** — fill-down deferred, no new `WorkbookCommand`,
  no change to `commitCellEdit` / `useCommandHistory`. Density, focus, and pinning
  never mutate row data.
- **Persistence & database:** **no impact** — the only possible new stored state
  is the optional Phase-4 freeze boundary in `localStorage`. Line-item saves,
  registries, and RLS are untouched.
- **Exports & goldens:** **no impact** — all three changes are view/input only;
  exporters read row data, not the DOM. `$0.00` on both goldens is an exit gate
  every phase.
- **Calculation engine:** untouched.
- **Other pages:** none affected — the estimate grid is the only TanStack table,
  and `useGridKeyboard` / `useKeyboardNavigation` are imported only by the workbook
  (verified).
- **Watch within the grid:** (1) density — icon/button cells must still center in
  the shorter row, and the row-height estimate must match the new padding or
  virtual scrolling jitters; (2) freeze — column **resize** feeds the offset math,
  the new **horizontal scroll-into-view** must not regress vertical scroll-to-row,
  and dividers + tfoot rows must render frozen cells in lockstep with data rows;
  (3) the two-mode arrow change alters mid-edit muscle memory — covered by the
  SKILL.md nav-map update and tests.

## Risks & unknowns
- **Sticky-vs-virtualization (Phase 3 spike).** The load-bearing unknown. If
  sticky won't hold inside transformed absolute rows, Phase 3's gate stops and we
  re-plan toward a split two-table layout. Phases 1–2 are unaffected by this.
- **Density too tight?** Subjective. Mitigated by shipping a tuned default and
  keeping a toggle as a cheap later fallback if anyone objects.
- **UOM Enter capture (Phase 2).** Small unknown found at build time; isolated to
  `SelectCellInput`.
- **Draggable freeze ergonomics (Phase 4, optional).** Header-context-menu
  fallback delivers the same capability if the drag handle is fiddly.

## Phase 1 kickoff prompt
> Implement **Phase 1** of
> `docs/plans/2026-06-15-estimate-grid-freeze-panes-and-excel-focus.md` (Cell
> density tightening) in this fresh session. First read that plan and
> `.agent/skills/data-table-architecture/SKILL.md`.
>
> This is a pure CSS/sizing pass — no logic, no data, no new behavior. Reduce the
> in-cell white space: in `src/hooks/useTakeoffWorkbook.tsx` the editable inputs
> and matching display divs use `min-h-[36px] px-3 py-2` (~lines 699–1241), and
> `src/components/workspace/EstimateTable.tsx` uses `p-3` on display cells.
> Starting point: `py-2 → py-1`, `px-3 → px-2`, `min-h-[36px] → min-h-[28px]`, and
> drop the virtualizer `estimateSize` from 40→~30 (data) and 44→~36 (divider) at
> `EstimateTable.tsx:473`. Keep the `text-xs` font. Tune for a clean ~30px row.
> Verify the icon/button cells (trash, status dot, notes, suggestion chips) still
> center cleanly and that virtual scrolling stays smooth (row-height estimate must
> match the new real height).
>
> Do **not** touch the database, exports, the calculation engine, undo/redo, or
> keyboard logic. Exit criteria: `npm run test` green, `npx tsc --noEmit` clean,
> lint no new warnings, both goldens `$0.00`, commit via `git commit -F`, and write
> a handoff doc sequencing Phase 2. **Stop at the phase boundary.**
