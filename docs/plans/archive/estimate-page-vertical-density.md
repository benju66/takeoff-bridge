# Estimate Page — Vertical Density Cleanup (Scope: A + B)

## Goal
Reclaim ~600px of vertical space above the Step 4 takeoff grid so the spreadsheet is
visible without scrolling, **without removing any information**. Two moves:

- **A** — Make the two largest read-only blocks collapsible (remembered per browser).
- **B** — Delete the redundant "ROWS 2-4" profile card and relocate its 4 unique
  fields into the existing page header.

UI-only. No changes to calculations, persistence, exports, or the grid's data model.

---

## Background (current state)

Five stacked blocks sit above the editable grid, ~700–900px total before the first row:

| # | Block | Source | ~Height | Read-only? |
|---|-------|--------|---------|-----------|
| 1 | Page header (name, ID, metadata, export buttons) | `page.tsx:274–356` | 130px | buttons only |
| 2 | Ingestion tray (CSV drop + Append/Add Col/Undo/Redo) | `EstimateTable.tsx:274–336` | 90px | no |
| 3 | "ROWS 2-4" profile card (3×3 metadata grid) | `EstimateTable.tsx:364–422` | 180px | **yes** |
| 4 | Division Analytics drawer | `EstimateTable.tsx:445–524` | 280px | **yes** |
| 5 | Grid header bar (title + search) | `EstimateTable.tsx:528–538` | 60px | search only |

Block #3 duplicates 5 of its 9 fields with the page header. Net-new fields in #3:
**Expected Start, Expected Finish, Est. Duration, Est. Cost / SF**.

---

## Part A — Collapsible drawers

Target: the **Division Analytics drawer** (#4). (Block #3 is removed in Part B, so it
does not need a collapse toggle.)

### A1. Collapse state with localStorage persistence
In `EstimateTable.tsx`, add a small persisted boolean:

```ts
const [analyticsCollapsed, setAnalyticsCollapsed] = React.useState<boolean>(() => {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem("tb.estimate.analyticsCollapsed") === "1";
});
useEffect(() => {
  window.localStorage.setItem("tb.estimate.analyticsCollapsed", analyticsCollapsed ? "1" : "0");
}, [analyticsCollapsed]);
```

- Fixed key (single-company internal tool; no per-project state needed).
- Default expanded (`false`) so first-time behavior is unchanged.

### A2. Wrap the drawer body in a toggle
- Add a thin header row to the analytics card: a chevron button + label
  (e.g. `[SYS.ANALYTICS]`) that flips `analyticsCollapsed`.
- When collapsed, render only the header row (the two-column body is hidden),
  collapsing ~280px down to ~40px.
- Reuse the existing `▶`/`▼` glyph convention already used by division dividers
  (`EstimateTable.tsx:625`) for visual consistency.
- Keep existing inner `max-h-60 overflow-y-auto` on the divisional list.

---

## Part B — Remove redundant profile card, relocate 4 fields

### B1. Delete block #3
Remove the entire `EstimateTable.tsx:364–422` profile card ("STEP 4 - COMPANY
ESTIMATE WORKBOOK / ROWS 2-4").

### B2. Relocate its 4 unique fields into the page header
In `page.tsx`, the header metadata row (`page.tsx:293–324`) currently shows
Location · Bid · Size · Units · SaveStatus. Add the 4 net-new fields there, matching
the existing pill/separator style:

- **Est. Duration** — `{projectDurationMonths} mo` (already in scope, line 51-52)
- **Expected Start** — `project.expectedStart || "—"`
- **Expected Finish** — `project.expectedFinish || "—"`
- **Est. Cost / SF** — `takeoffSummary.costPerSf` (already computed, `page.tsx:127`)

All four values are already available in `WorkspaceInner` scope — no new props or
data fetching. Keep the existing uppercase/`text-xs`/separator treatment so the row
stays single-line on wide viewports and wraps gracefully (`flex-wrap` already set).

### B3. Prop cleanup (only if now-unused)
After removing block #3, check whether `projectDurationMonths` / `squareFootage` are
still referenced inside `EstimateTable` (they are used elsewhere — footer math at
`EstimateTable.tsx:777,804`). **Expectation: keep all props.** Do not remove props
that remain in use. No prop signature change anticipated.

---

## Files touched
- `src/components/workspace/EstimateTable.tsx` — A1, A2, B1
- `src/app/projects/[projectId]/page.tsx` — B2

(2 files. Non-trivial → this plan + approval gate per CLAUDE.md.)

## Out of scope (deferred)
- C (move analytics below grid), D (flex grid height / kill 70vh double-scroll),
  E (global spacing/title tightening). Revisit after this lands.

## Verification
1. `npm run test` green (no test currently asserts the profile card; confirm none break).
2. Manual: load a project with rows →
   - Page header shows all metadata incl. the 4 relocated fields on one line (wide).
   - "ROWS 2-4" card is gone.
   - Analytics drawer collapses/expands via chevron; state survives reload.
   - Grid first rows visible markedly higher up the page.
3. Empty-state project (no rows): analytics drawer is hidden as before
   (`rows.length > 0` guard unchanged); header still renders.

## Risk
Low. Read-only/presentational only. No financial, persistence, export, or grid-data
changes. Guardrails (db gateway, RPC writes, command history) untouched.

## Commit
Single commit after tests green:
`refactor(estimate): collapsible analytics drawer + dedupe project metadata header`
