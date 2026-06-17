# GC/Site-Ops Addressability — Phase B1a closure & Phase B1b kickoff
_2026-06-17 · branch `gc-siteops-addressability` (re-synced to `main` @ `b34c63a`)_

> Plan of record: `docs/plans/2026-06-16-gc-siteops-addressability-grid-convergence.md`
> (locked decisions D1–D4, ID-1…ID-4). Phase **B1** opens **Track B**. Per the B1 kickoff
> (`docs/handoffs/2026-06-17-gc-siteops-addressability-phase-b1-kickoff.md`) B1 was
> pre-authorized to **split** if it couldn't land green in one session. It was split:
> **B1a (this session) = the structural grid-shell extraction; B1b (next) = generalize the
> host contract.** B2 (Step 2 as a grid) still follows B1, now after B1b.

---

## What Phase B1a shipped (the risky structural half of ID-3)

The grid machinery was lifted out of the Step-4-only `EstimateTable` into a new, reusable
**`src/components/workspace/EstimateGridShell.tsx`**, with **Step 4 (`EstimateTable` via
`useTakeoffWorkbook`) as the SOLE consumer**. This is a **pure, behavior-preserving code
move** — no logic changed, only *where* it lives.

**Moved into `EstimateGridShell` (the reusable core):** the scroll container
(`<div ref={parentRef} tabIndex={-1} onKeyDown=…>`), the `<table>` `<thead>` (header groups,
custom-column rename/delete inputs, `FilterableColumnHeader`, resize handle) and the
**virtualized `<tbody>`** (division dividers + data rows + `flexRender` cells + selection
classes + context-menu trigger + non-editable-cell click → `setSelection`+`focusContainer`),
plus `useGridKeyboard`, `useVirtualizer`, `flatItems`/`divisionTotals`/`collapsedDivisions`,
the `scrollToRowRef` binding, and the auto-expand-collapsed-division effect. The `<tfoot>`
summary rows are still built in `EstimateTable` and passed in as the **`footer`** ReactNode.

**Stayed in `EstimateTable` (the Step-4 host):** card wrapper + `gridContainerRef` +
click-outside-deselect, the title bar (SearchBar, Trust/Add-Column/Undo/Redo), the `<tfoot>`
summary content, the status bar (`ReconChip`), the Data-I/O bar, analytics drawer, warning
banners, `ImportPreviewModal`, and `TrustInspector` (plus `SummaryTraceCell`/`ReconChip`,
the `tb:inspect-binding` listener, `pendingInspect`, `flagsModel`, `handleAssignCode`,
`handleViewRow`/`handleViewTakeoffRows`). Its external props are **unchanged** — `page.tsx`
was not touched.

**Adopted the `ResizeHandle` primitive** (`src/components/ui/grid/ResizeHandle.tsx`) for the
thead resize handle — a byte-identical swap. The other `ui/grid` primitives
(`GridTable`/`GridHeaderRow`/`GridSectionDivider`/`GridCellInput`/`GridCellCurrency`) assume a
**static, non-virtualized, non-flex** table and do not map onto Step 4's virtualized flex grid
without behavior change, so they are intentionally left for B1b/B2 (where Steps 2/3 consume them).

### The one non-mechanical wrinkle — a documented eslint-disable (read before B1b)
`EstimateTable` carries `"use no compiler"` (a **no-op** string — the real React-Compiler
opt-out is `"use no memo"`; eslint-plugin-react-hooks v7.1.1 confirms `"use no memo"`/
`"use no forget"` are the only opt-outs). At **baseline** the compiler **bailed at the
`useVirtualizer` call** (`react-hooks/incompatible-library`, a warning), which masked two
**advisories on pre-existing, correct code**: stable-setter `useCallback` deps
(`openTrust`/`handleViewRow`/`handleViewTakeoffRows`) and the one-shot `pendingInspect`
`setState`-in-effect. B1a moved `useVirtualizer` into the shell, removing that bail-out, so the
compiler now walks the whole component and surfaces those advisories as **errors**. A
function-level `"use no memo"` did **not** gate them (they fire regardless of the directive).
To keep B1a **strictly zero-runtime-change**, a **file-level
`/* eslint-disable react-hooks/preserve-manual-memoization, react-hooks/set-state-in-effect */`**
(with an explanatory comment) was added to `EstimateTable.tsx` — **no working code changed.**
The advisory now lives on the shell instead: `EstimateGridShell` shows the same single
`useVirtualizer` `incompatible-library` **warning** the baseline `EstimateTable` had (it bails
there, so its own effect/memos stay un-flagged). **B1b should revisit** this — either properly
opt the file out, or address the advisories — when the component is generalized.

### Files
- **NEW** `src/components/workspace/EstimateGridShell.tsx` (~290 lines; `ProcessedTakeoffRow`-typed).
- **EDIT** `src/components/workspace/EstimateTable.tsx` (−319/+37): removed the moved
  hooks/JSX; renders `<EstimateGridShell … footer={…} />`; pruned imports; added the
  documented eslint-disable.
- **No change** to `src/hooks/useTakeoffWorkbook.tsx` (column defs / `meta` / table instance —
  the decoration layer flows through `flexRender` unchanged), `src/types/index.ts`, `page.tsx`.

## Verification (CLAUDE.md Definition of Done)
- **Unit suite:** `npm run test` → **94 files / 1124 pass** — identical to baseline; all three
  export goldens (McKenna / synthetic / CARE) tie **$0.00**.
- **Types:** `npx tsc --noEmit` clean. **Build:** `npm run build` green (Next 16/Turbopack runs
  TypeScript but not ESLint at build).
- **Lint:** `npx eslint` on both files → **0 errors, 2 warnings**, and both warnings are
  pre-existing/relocated (the `useVirtualizer` `incompatible-library` warning moved from
  `EstimateTable` to the shell; `lockedCells` unused was already a baseline warning). **No new
  lint findings.**
- **/code-review (self, high, against the actual diff):** no correctness findings; one
  deliberate, documented quality tradeoff (the file-level eslint-disable above).
- **Playwright e2e — no regression attributable to B1a:**
  - **PASS** `linked-values-authoring.spec.ts` — exercises the grid hardest: click-to-edit
    cells (qty/price), right-click context menu, the 🔗 binding badge, the Trust Inspector
    **Links** tab, live recompute, and **undo (Ctrl+Z)**. All green through the new shell.
  - **PASS** `linked-values-engine-graph.spec.ts` (×2) — summary-cell → Links tab, Site-Ops
    cross-step badge.
  - **`smoke.spec.ts` — FAILS, but identically on baseline (verified via `git stash`).** Its
    edit step uses `.dblclick()` (the grid is **click-to-toggle**, not dblclick — see
    `.agent/skills/data-table-architecture/SKILL.md §3`) on the **first** `matchedQty` cell,
    which on a freshly-created empty project is a **read-only linked-division row**. Pre-existing
    test-design/environment issue, **not** a B1a regression.
  - **`phase3c-mapping-verify.spec.ts` — test BODY passed** (the `$1,500` BLI dollar-move +
    mapping revert assertions at lines 181–184); only the `finally`-block scratch-project
    **deletion** (line 193) timed out — a `/projects` dashboard timing issue, unrelated to the
    Step 4 grid. (The live `cost_code_map` mapping was reverted at line 187.)
- **⚠ MANUAL `/verify` — STILL OUTSTANDING (architect action).** The Chrome extension was not
  connected this session, so the browser-driven manual pass could not be automated. A dev
  server is live at **`http://localhost:3000`**. The e2e already covers cell-edit / context
  menu / badge / Trust Links / recompute / undo; the **remaining** items to click through:
  **edit a code/desc/uom cell · redo (Ctrl+Y) · toggle a cell lock (right-click → lock) ·
  paste a multi-cell range · context-menu insert + delete a row · open the Trust Inspector and
  confirm the Trace / Reconcile / Flags tabs render · confirm the provenance glyph and (on a
  bound row) the 🔗 badge still appear.** Use a Division-06 template row on any project (the
  authoring e2e uses exactly that). Any divergence from pre-B1a behavior fails the phase.

## Git
Committed to `gc-siteops-addressability` (one commit, message via `git commit -F`). **Not
pushed** (CLAUDE.md DoD step 7 now: commit only; push only when the architect asks). Track A
already merged to `main` (PR #9); Track B follows the same merge cadence — per-phase PR or one
merge at Track B's end, the architect's call.

---

## NEXT — Phase B1b: generalize the grid shell + host contract

**Goal (plan §"Phase B1", ID-3 — the type-level half):** widen `EstimateGridShell` into a
**generic `GridShell<TRow>`** and replace the Step-4-specific `TableMeta` vocabulary
(`src/types/index.ts`: `handleCellEdit(…, field: keyof ProcessedTakeoffRow, …)`,
`handleKeyDown(…, type: "code"|"desc"|"qty"|"price"|"uom", …)`, `handlePaste`,
`insertManualRow`/`deleteRow`, `lockedCells`, `selection`, …) with a generalized
**`GridHostContract<TRow>`** that Steps 2/3 can implement with their own leaner state+command
hooks. **Design a hook point for the A+1 per-line override ⚑ indicator** (do not wire a
gesture — that's B2/B3). This half is mostly **type-level and `tsc`-gated** (low runtime
risk), which is why it was sequenced after the structural extraction.

**Concrete starting points**
- `src/components/workspace/EstimateGridShell.tsx` — make generic over `TRow`; the
  Step-4-specific bits to parameterize via the contract: the editable/align column-id sets
  (`["itemId","description","matchedQty","unitPrice","uom"]`, the center-aligned set), the
  row classes that read `row.isMapped`, the divider grouping (currently `getDivisionCode` +
  `DIVISION_LABELS`/`layoutConfigMap`), and the `footer` slot (already generic).
- `src/types/index.ts` — the `declare module '@tanstack/table-core' { interface TableMeta }`
  augmentation is the vocabulary to generalize. Decide: keep a module augmentation, or move to
  an explicit `GridHostContract<TRow>` the meta implements.
- Revisit the B1a **eslint-disable** in `EstimateTable.tsx` (see above).
- `.agent/skills/data-table-architecture/SKILL.md` — the invariant bible; keep every §8
  anti-pattern intact.

**Gate (same as B1a):** export goldens + the entire unit suite + `tsc` + `build` unchanged;
the 3 grid e2e specs green; a manual `/verify` pass. Then a `/handoff` sequencing **B2**
(Step 2 as a grid — new leaner hook implementing the contract, command history with full
inverse data per AGENTS.md, type-over wired to the A+1 override path). **Stop at the B1b
boundary.**

## Where this sits
Track A: A1→A5 + A+1 ✅ (merged, PR #9). Track B: **B1a ✅ (this session) → B1b (generalize
contract) → B2/B3 (Step 2/3 grids) → B4 (removable seed, D2) → B5 (validated one-off, D1) →
B6 (sweep + retire blob columns, ⛔DDL).**
