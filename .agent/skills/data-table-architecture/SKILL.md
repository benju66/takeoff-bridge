# Skill: Data Table Architecture

Reference this document before modifying any file in the takeoff workbook grid system. It codifies the component hierarchy, state model, selection/editing lifecycle, keyboard navigation, and critical invariants.

---

## 1. Component Hierarchy

```
page.tsx (ProjectWorkspace)
├── useTakeoffWorkbook() hook ← owns ALL grid state
│   ├── useReactTable() ← TanStack table instance
│   ├── useCellEditing() ← edit/commit/cascade logic
│   ├── useKeyboardNavigation() ← all keyboard handlers
│   ├── useColumnDefinitions() ← dynamic column management
│   ├── useCopyHandler() ← Ctrl+C (document-level)
│   ├── usePasteHandler() ← Ctrl+V (input-level)
│   ├── useFileIngestion() ← CSV/XLSX drag-and-drop + staged import
│   ├── useExportHandlers() ← Excel/Procore export
│   └── useCommandHistory() ← undo/redo stack
│
├── EstimateTable ← Step 4 host: title bar, summary <tfoot>, status bar, Trust Inspector
│   ├── GridShell<TRow> ← reusable grid surface (B1a extract, B1b generic): TanStack
│   │   │                  plumbing + virtualized render, parameterized by GridShellConfig<TRow>
│   │   ├── useGridKeyboard() ← single-container keyboard handler + focus safety net
│   │   ├── @tanstack/react-virtual ← row virtualization
│   │   └── flexRender() ← renders cell functions from column defs
│   ├── ImportPreviewModal ← 3-stage import preview (rendered when pendingImport non-null)
│   ├── SearchBar ← global filter input
│   └── Status Bar ← row count, selection info
│
├── ContextMenuPortal ← floating right-click menu
└── ErrorBoundary ← error isolation wrapper
```

### Key Files

| File | Role |
|---|---|
| `src/hooks/useTakeoffWorkbook.tsx` | Master hook: state, column definitions (via `useMemo`), table meta |
| `src/hooks/useCellEditing.ts` | `handleCellEdit` (keystroke), `commitCellEdit` (blur/Enter), cascade logic |
| `src/hooks/useKeyboardNavigation.ts` | All keyboard shortcuts: Enter, Tab, Escape, arrows, F2, Delete, Ctrl+Home/End, PageUp/Down, direct typing |
| `src/hooks/useGridKeyboard.ts` | Reusable grid-level keyboard handler + focus safety net. Single container owner pattern. |
| `src/hooks/useCopyHandler.ts` | Document-level `copy` event listener |
| `src/hooks/usePasteHandler.ts` | Multi-row/multi-col paste from clipboard |
| `src/hooks/useCommandHistory.ts` | Undo/redo stack with `WorkbookCommand` payloads |
| `src/hooks/useColumnDefinitions.ts` | Custom column CRUD, column ordering |
| `src/components/workspace/EstimateTable.tsx` | Step 4 host: title bar, summary `<tfoot>`, status bar, Trust Inspector, click-outside; renders `<GridShell config={…} footer={…}/>` |
| `src/components/workspace/GridShell.tsx` | Reusable `GridShell<TRow>` grid surface (B1b): TanStack instance plumbing + virtualization + rendering, parameterized by a `GridShellConfig<TRow>` host projection (row id, group/divider derivation, flagged-row test, editable/center column sets, `renderCellOverlay` override-⚑ hook point). Consumers: Step 4 (`EstimateTable`) and Step 2 (`GcPersonnelGridStep`, B2). |
| `src/hooks/useGcPersonnelGrid.tsx` | Step 2 (GC Personnel) grid state+command hook (B2): the leaner Track-B twin of `useTakeoffWorkbook` — owns selection, columns, `useReactTable<EstimateSectionLine>`, a `useCommandHistory<GcGridCommand>`, in-session cell-lock, and the `meta` (`GridHostContract<EstimateSectionLine, GridCellKind>`). A veneer over `usePersonnelCalculations` (rows = `personnel.sectionLines`; totals = `personnel.calcResult`); edits drive the personnel setters; the total cell's type-over records an `estimate_overrides` event (NOT on the undo stack). |
| `src/components/workspace/GcPersonnelGridStep.tsx` | Step 2 host: title bar, undo/redo, summary `<tfoot>` (grand total), lock/unlock context menu, click-outside-deselect, step-local Ctrl+Z/Y listener; renders `<GridShell config={…} footer={…}/>`. |
| `src/lib/sectionLines/gcGridModel.ts` | Pure (no-React) Step-2 grid model: the 01.A–01.F grouping/order, the calc-by-`code` join (`buildCalcLookup`), the `entry` value per kind, and the section-line → personnel-setter resolution (`resolveEntryTarget`/`resolveRoleKey`). Unit-tested in `gcGridModel.test.ts`. |
| `src/components/workspace/ImportPreviewModal.tsx` | 3-stage import preview with UOM override dropdowns |
| `src/components/workspace/StringCellInput.tsx` | Buffered text editor for string cells |
| `src/components/workspace/NumberCellInput.tsx` | Buffered numeric editor with `parseFloat` commit |
| `src/components/workspace/SelectCellInput.tsx` | Dropdown select editor for UOM cells |
| `src/components/workspace/ContextMenuPortal.tsx` | Right-click menu: lock/insert/delete |
| `src/types/index.ts` | `GridSelectionState`, `ProcessedTakeoffRow`, `ColumnDefinition`, `GridHostContract<TRow, TCellKind>` (the generalized host vocabulary), and the TanStack meta augmentation (`TableMeta extends GridHostContract<TData, GridCellKind>`) |

---

## 2. Selection State Model

```typescript
interface GridSelectionState {
  rowId: string | null;        // null = no selection
  columnId: string | null;     // null = no selection
  isEditing: boolean;          // false = selected, true = input visible
  initialEditChar?: string;    // set when direct-typing triggers edit mode
}
```

**State ownership**: `useState` in `useTakeoffWorkbook` → flows to TanStack table via `meta.selection` AND to `EstimateTable` as a prop.

**Cell renderers access selection via**: `info.table.options.meta!.selection` (NOT via closure — the meta is updated each render via `useReactTable.setOptions`).

---

## 3. Selection / Editing Lifecycle

### Click-to-Toggle Pattern (NOT onDoubleClick)

> **CRITICAL INVARIANT**: React 19's synchronous re-render replaces DOM nodes between clicks, preventing the browser from firing `dblclick` events. The grid uses a **click-to-toggle** pattern instead:

```
Unselected cell                    Selected cell (ring visible)
      │                                    │
      ├─── click ──→ setSelection          ├─── click ──→ setSelection
      │              (isEditing: false)     │              (isEditing: true)
      │                                    │
      │              Selected cell         │              Editing cell (input)
      │              (ring visible)        │              │
      │                                    │              ├─── blur/Enter ──→ onCommit → display
      │                                    │              ├─── Escape ──→ revert → display
      │                                    │              └─── Tab/Arrow ──→ commitActiveEdit → navigate
```

### Why NOT `onDoubleClick`

React 19's `flushSyncWorkAcrossRoots_impl` performs synchronous DOM reconciliation in a microtask between the first and second click events. Evidence: `sameNodeAsLastClick: false` on every consecutive click. The browser requires both clicks on the **same DOM node** to fire `dblclick`. Since the node is destroyed and recreated, `dblclick` never fires. **Do NOT reintroduce `onDoubleClick` handlers.**

### Commit-Before-Unmount Pattern

> **CRITICAL INVARIANT**: `StringCellInput.onBlur` calls `onCommit`. If the input is unmounted by a React state change BEFORE blur fires, the edit is lost.

All navigation paths that exit edit mode MUST trigger commit first:

| Path | Mechanism |
|---|---|
| **Click outside grid** | `setTimeout(0)` defers `setSelection` past blur event |
| **Enter / Tab / Arrow keys** | `commitActiveEdit()` explicitly `blur()`s the active input before `setSelection` |
| **Escape** | `StringCellInput` handles Escape internally (revert buffer + set `isRevertedRef`), then grid handler sets `isEditing: false` |

```typescript
// commitActiveEdit pattern (useKeyboardNavigation.ts)
const commitActiveEdit = () => {
  if (isEditing && document.activeElement instanceof HTMLInputElement) {
    document.activeElement.blur(); // triggers onBlur → onCommit
  }
};
```

---

## 4. Cell Edit Flow

### Keystroke (real-time preview)
```
User types → StringCellInput.onChange → setBuffer(value) [local state only]
```

### Commit (blur or Enter)
```
StringCellInput.onBlur
  → onCommit(buffer)
    → meta.handleCellEdit(index, field, newVal)  [mutates rows clone, stages registry in refs]
    → meta.commitCellEdit(rowId, field, prev, next) [builds WorkbookCommand, pushes history, flushes registry to React state + DB]
```

### Cascade Rules (applyCellEditDirect)
| Field Edited | Fields Cascaded to Sibling Rows (same classification) | Side Effects |
|---|---|---|
| `itemId` | 9 fields: itemId, description, procoreParentCode, unitPrice, uom, costType, matchedQty, total, isMapped | `moveEffect`: if division changes (via `getDivisionCode()`), row group relocates to new division boundary. Classification history recorded via `recordClassificationResolution()`. |
| `description` | 1 field: description | — |
| `unitPrice` | 2 fields: unitPrice, total | — |

### Revert (Escape)
```
StringCellInput.handleKeyDownInternal
  → isRevertedRef = true
  → setBuffer(initialValueRef.current)
  → blur() [handleBlur checks isRevertedRef, skips onCommit]
```

---

## 5. Keyboard Navigation Map

| Key | Not Editing | Editing |
|---|---|---|
| **Enter** | Move down | Commit + move down |
| **Shift+Enter** | Move up | Commit + move up |
| **Tab** | Commit + move right (wraps) | Commit + move right (wraps) |
| **Shift+Tab** | Commit + move left (wraps) | Commit + move left (wraps) |
| **Escape** | — | Revert + exit edit |
| **Arrow ↑** | Move up | — |
| **Arrow ↓** | Move down | — |
| **Arrow ←** | Move left | At caret pos 0: commit + move left |
| **Arrow →** | Move right | At caret end: commit + move right |
| **F2** | Enter edit mode (cursor at end) | — |
| **Delete / Backspace** | Clear cell content (with undo) | Normal input behavior |
| **PageUp** | Move up 20 rows | — |
| **PageDown** | Move down 20 rows | — |
| **Ctrl+Home** | Jump to first editable cell | — |
| **Ctrl+End** | Jump to last editable cell | — |
| **Alphanumeric** | Overwrite entry (initialEditChar) | Normal typing |
| **Ctrl+Z** | Undo (global listener) | Undo (global, suppresses native) |
| **Ctrl+Y / Ctrl+Shift+Z** | Redo | Redo |
| **Ctrl+C** | Copy cell value (document listener) | Native copy behavior |

---

## 6. Cell Types

| Column ID | Editable | Input Component | Notes |
|---|---|---|---|
| `actions` | No | Button (trash) | Row deletion |
| `validationStatus` | No | Icon div | Status indicator |
| `costType` | No | Display div | Read-only classification |
| `itemId` | Yes | StringCellInput | Cascades 9 fields on commit |
| `description` | Yes | StringCellInput | Cascades to siblings |
| `matchedQty` | Yes | NumberCellInput | Numeric with parseFloat |
| `unitPrice` | Yes | NumberCellInput | Cascades unitPrice + total |
| `uom` | Yes | SelectCellInput | Dropdown with UOM_OPTIONS; supports cell locking |
| `total` | No | Display div | Computed: matchedQty × unitPrice |
| `costPerUnit` | No | Display div | Computed metric |
| `costPerSf` | No | Display div | Computed metric |
| `notes` | No | Button (prompt) | Opens dialog |
| `custom-*` | Yes | StringCellInput | User-defined columns |

### Editable Column IDs (for navigation)
```typescript
const editableColumns = ["itemId", "description", "matchedQty", "unitPrice", "uom"];
// Plus any column starting with "custom-"
```

---

## 7. Visual Indicators

### CSS Classes (applied to `<td>` elements)

| Class | When Applied | Visual Effect |
|---|---|---|
| `cell-transition` | Always | `transition: outline, background-color, box-shadow 120ms` |
| `cell-selected` | Selected, not editing | `outline: 2px solid blue-600, box-shadow: 0 0 0 3px blue glow` |
| `cell-editing` | Editing | `outline: 2px solid blue-500, inset box-shadow, stronger glow` |

### Cell Div Classes (applied to inner `<div>`)

| State | Classes |
|---|---|
| **Unselected** | `text-slate-900 dark:text-slate-100 font-medium` |
| **Selected** | `outline outline-2 outline-blue-600 outline-offset-[-2px] bg-blue-50/10 z-10 relative` |
| **Hard-locked** | `text-slate-600 cursor-not-allowed opacity-60` |

### Row Highlight
Active row (matching `selection.rowId`): `bg-blue-50/60 dark:bg-blue-950/40` + `border-l-2 border-blue-600`

---

## 8. Anti-Patterns (Do NOT Do These)

1. **Do NOT use `onDoubleClick`** — React 19 replaces DOM nodes between clicks. Use click-to-toggle via `isSelected` check in `onClick`.

2. **Do NOT call `setSelection` synchronously before `blur`** — The input will be unmounted before `onBlur` fires, losing the edit. Always `commitActiveEdit()` first or defer with `setTimeout(0)`.

3. **Do NOT dispatch synthetic `KeyboardEvent` into inputs** — This causes infinite recursion because the synthetic event bubbles back through React's event system into the same handler. `StringCellInput` handles Escape internally.

4. **Do NOT add `selection` to the `columns` `useMemo` dependency array** — This would cause all column definitions to recompute on every selection change, destroying cell component identity and causing massive re-renders.

5. **Do NOT read selection from closure variables in cell functions** — Cell functions are defined inside `useMemo` and captured at memo time. Always read selection from `info.table.options.meta!.selection` which is updated via `useReactTable.setOptions` on every render.

6. **Do NOT add `tabIndex` or `onKeyDown` to individual cell display divs** — Per-cell focus management is fragile: non-editable columns have no focusable elements, stale closures capture wrong coordinates, and focus is lost during virtualizer re-renders. Use the single-container pattern via `useGridKeyboard` instead.

---

## 9. Row Virtualization

- **Library**: `@tanstack/react-virtual` via `useVirtualizer`
- **Layout**: Flat list interleaving division dividers and data rows (`VirtualItem = divider | row`)
- **Positioning**: Absolute positioning with `transform: translateY(${virtualItem.start}px)`
- **Overscan**: 10 rows
- **Row height estimate**: 42px data rows, 52px dividers
- **Key function**: `getItemKey` returns `divider-{code}` or `row-{rowId}`
- **Division derivation**: Division codes for divider rows are extracted via `getDivisionCode()` from `src/lib/division.ts` (NOT inline `split` or `substring`). Division labels come from `DIVISION_NAMES` in `src/lib/constants.ts`.

### Scroll-to-Row Pattern
```typescript
// Maps data row index → flat item index (accounting for divider rows)
scrollToRowRef.current = (dataRowIndex: number) => {
  const flatIndex = flatItems.findIndex(item => item.type === "row" && item.dataIndex === dataRowIndex);
  if (flatIndex >= 0) virtualizer.scrollToIndex(flatIndex);
};
// Used by keyboard navigation for off-screen cell focus:
focusWithScroll(cellId, rowIndex, scrollToRowRef);
```

---

## 10. Undo/Redo Architecture

- **Stack**: `useCommandHistory` maintains `undoStack` and `redoStack` of `WorkbookCommand` objects
- **Global listener**: `page.tsx` registers `Ctrl+Z` / `Ctrl+Y` on `document`, calls `e.preventDefault()` to suppress native input undo
- **Command types**: `EDIT_CELL` (with optional `moveEffect` for division-aware row relocation), `EDIT_CUSTOM_CELL`, `PASTE`, `INSERT_ROW`, `DELETE_ROW`, `TOGGLE_LOCK`, `ADD_COLUMN`, `DELETE_COLUMN`, `UPDATE_COLUMN`, `MERGE_TAKEOFF_DATA`
- **Cascade capture**: `commitCellEdit` simulates cascade in both directions (prev→next) to produce timing-independent undo snapshots
- **Move effect**: When an `itemId` edit changes the division code, `moveEffect` captures `{ moves: [{ rowId, fromIndex, toIndex }] }` on the `EDIT_CELL` command. Forward applies remove→insert at `toIndex`; inverse reverses to `fromIndex`. Single Ctrl+Z undoes both edit and relocation.
- **Import merge**: `MERGE_TAKEOFF_DATA` captures per-row `prevRowStates`/`nextRowStates` diffs (including `source` provenance) for full undo/redo of bulk import operations

---

## 11. Keyboard Architecture — Single Container Owner

Grid keyboard navigation uses the **single-container owner** pattern via `useGridKeyboard`:

```
Nav Mode:   Container has focus → Container onKeyDown → processGridNavigation
Edit Mode:  Input has focus    → Input onKeyDown      → processGridNavigation
```

### How It Works

- The scroll container div has `tabIndex={-1}` and `onKeyDown={handleGridKeyDown}`.
- ALL nav-mode keyboard events (arrows, Enter, Tab, F2, Delete, direct typing) are processed by the container's handler, which delegates to `processGridNavigation` via `meta.handleCustomKeyDown`.
- The handler skips events from interactive child elements (`INPUT`, `TEXTAREA`, `BUTTON`, `SELECT`), so editing inputs and action buttons work normally.
- A `useEffect` focus safety net runs after every selection change: after double-rAF timing, it ensures the container has focus. This catches all focus-loss scenarios (virtualizer re-renders, non-editable cell clicks, React DOM reconciliation).
- Cell display divs do NOT have `tabIndex` or `onKeyDown`. Selection visuals are class-driven (`.cell-selected`, `.cell-editing`), completely independent of DOM focus.

### Applying to a New Table

```typescript
import { useGridKeyboard } from "@/hooks/useGridKeyboard";

// In your table component:
const { handleGridKeyDown, focusContainer } = useGridKeyboard({
  containerRef: scrollContainerRef,
  selection,
  table,
  onNavigate: (e, rIdx, columnId, tbl) => {
    tbl.options.meta?.handleCustomKeyDown(e, rIdx, columnId, tbl);
  },
  // Optional: override row ID extraction for different data shapes
  // getRowId: (row) => row.uuid,
});

// Attach to scroll container:
<div ref={scrollContainerRef} tabIndex={-1} onKeyDown={handleGridKeyDown}
     className="... outline-none">
  <table>...</table>
</div>

// Call focusContainer() after non-editable cell clicks:
onClick={() => {
  meta.setSelection({ rowId, columnId, isEditing: false });
  focusContainer();
}}
```
