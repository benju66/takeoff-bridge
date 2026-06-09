# Estimate Page — Unified Data I/O Action Bar

## Goal
Make the workbook's data pipeline legible: a single Step 4 action bar with **Import on the
left, Export on the right** (in → out). Consolidate the three export buttons into one primary
button + an "Export ▾" menu. Lighten the global header.

Approved decisions:
- **Export scope:** Step 4 action bar (moved out of the global header).
- **Export style:** Primary "Download Full Estimate Workbook" + "Export ▾" menu holding
  "Export Excel Payload" and "Export Procore Budget".

## Resulting layout (top of Step 4 panel)
```
[⬆ Import Takeoff Data — drag/click] [☑ Append Data] ······ [⬇ Download Full Workbook] [Export ▾]
```
Grid toolbar (unchanged from last commit): Title · Search · +Add Column · Undo · Redo.

## Files
- `src/app/projects/[projectId]/page.tsx` — remove export buttons from header; thread export
  handlers/state into `<EstimateTable>`; drop now-dead locals + import.
- `src/components/workspace/EstimateTable.tsx` — turn the ingestion tray into the I/O action
  bar (Append joins Import on the left; export cluster on the right); add the Export menu.

## Changes

### page.tsx
1. Delete the header export `<div className="flex flex-wrap gap-4 items-center">…</div>`
   block (the `rows.length > 0` fragment with the 3 buttons), `~347–372`.
2. Remove now-unused `totalRows`, `mappedCount`, `unmappedCount` locals (`~163–165`) and the
   `FileDown` import (`~9`). (Confirmed: used only by the moved buttons.)
3. Pass new props to `<EstimateTable>` (handlers/state already in scope from `workbook`):
   `handleExportExcelWorkbook`, `handleExportExcel`, `handleExportProcore`, `isExportingExcel`.
   (Export-blocker modal + `exportBlockers`/`pendingExportKind` logic stays in page.tsx
   untouched — buttons just call the same handlers.)

### EstimateTable.tsx
4. Extend `EstimateTableProps` with the 4 export props above. Derive
   `const unmappedCount = rows.filter(r => !r.isMapped).length` locally (already done inline in
   the status bar — compute once, reuse).
5. Add `FileDown` to the lucide-react import.
6. Rework the action bar (current ingestion tray):
   - **Left group:** Import drop box + Append Data checkbox (move Append here — it modifies the
     next import, so it belongs with Import).
   - **Right group:** primary `Download Full Estimate Workbook` button (blue gradient, spinner
     on `isExportingExcel`) + an **Export ▾** menu button.
7. **Export ▾ menu** — lightweight dropdown:
   - `const [exportMenuOpen, setExportMenuOpen] = useState(false)` in a `relative` container.
   - Button toggles open; popover lists "Export Excel Payload" → `handleExportExcel` and
     "Export Procore Budget" → `handleExportProcore`; each closes the menu on click.
   - Close on outside click (mousedown listener) and on Escape.
8. **Disabled + reason:** primary button and menu items disable when `unmappedCount > 0` or
   (`isExportingExcel` for the workbook). Add `title={unmappedCount > 0 ? \`${unmappedCount}
   unmapped row(s) block export\` : undefined}` so the disabled state is explained on hover.

## Non-goals
- No change to export logic, blocker modal, or Procore rollup.
- Import affordance stays a drop box (not slimmed to a button — separate deferred item).
- No grid/scroll changes (deferred item D).

## Verification
1. `npm run test` green; `tsc --noEmit` clean.
2. Manual:
   - Step 4 shows Import (left) + Export (right) in one bar; header no longer has export buttons.
   - Primary export downloads the full workbook; spinner shows while compiling.
   - Export ▾ opens, both items fire their handlers, menu closes on select / outside click / Esc.
   - With an unmapped row: all export actions disabled + hover tooltip explains why.
   - Append toggle still controls import mode.
   - Steps 1-3/settings: header has no export buttons (export is Step-4-scoped now).

## Risk
Low-moderate. Presentational relocation + one small new dropdown. Export handlers and the
blocker/override modal are unchanged; only their trigger UI moves. Main watch-item: prop
threading and removing the now-dead header locals cleanly (tsc will catch misses).

## Commit
`refactor(estimate): unified import/export action bar with Export menu`
