# Estimate Page — Toolbar Reorganization

## Goal
Group controls by mental model: ingestion controls with the importer, grid-manipulation
controls with the grid. Reclaims a little more vertical space and improves discoverability
(Undo/Redo next to where edits happen). UI-only, single file.

## Scope (approved: "Move + trim pill")
1. **Move** `+ Add Custom Column`, `Undo (n)`, `Redo (n)` from the ingestion tray into the
   grid toolbar (the bar holding the title + SearchBar).
2. **Keep** Append Data checkbox with the Import drop box (it modifies the next import).
3. **Trim** the verbose "Keyboard Engine Online | Use Arrow Keys ↑↓..." pill — replace with a
   short hint ("↑↓ to navigate") so the moved buttons have room. (Cell/selection state already
   lives in the bottom status bar.)

## Current state (`src/components/workspace/EstimateTable.tsx`)
- Ingestion tray (`~282–339`): drop box (left) + right cluster = Append, Add Column, Undo, Redo.
- Grid toolbar (`~491–501`): left = title + SearchBar; right = keyboard pill.

## Changes (one file: `EstimateTable.tsx`)

### 1. Ingestion tray → drop box + Append only
- Remove the Add Custom Column, Undo, Redo buttons from the right cluster (`~320–339`).
- Right cluster keeps only the Append Data checkbox.
- Update the stale comment "Append Data toggler, Undo Action, and Add Custom Column buttons".

### 2. Grid toolbar → add the three buttons
- In the toolbar's right region (currently just the pill, `~498–500`), add an action group:
  `[+ Add Custom Column] [↺ Undo (n)] [↻ Redo (n)]` reusing the existing button markup/handlers
  (`handleAddCustomColumn`, `handleUndo`/`canUndo`/`undoStackSize`, `handleRedo`/`canRedo`/`redoStackSize`).
- Wrap right region in `flex flex-wrap items-center gap-3` so it wraps on medium screens.
- Reduce button padding `py-2.5 → py-1.5` so they fit the toolbar's height band.

### 3. Trim the keyboard pill
- Replace the long text with a compact hint (e.g. `↑↓ navigate`), or fold it to the left of the
  action group as small muted text. Keep it lightweight.

## Non-goals
- No handler/logic/state changes — all callbacks already exist as props.
- Append behavior unchanged. Search behavior unchanged. No grid/scroll changes (deferred item D).

## Verification
1. `npm run test` green; `tsc --noEmit` clean.
2. Manual: Add Custom Column / Undo / Redo work from the new toolbar location; disabled states
   and (n) counts still render; Append still toggles import mode; toolbar wraps cleanly at md.

## Risk
Low — presentational relocation within one file; handlers untouched.

## Commit
`refactor(estimate): group grid controls into the table toolbar`
