# GC/Site-Ops Addressability — Phase B1b closure & Phase B2 kickoff
_2026-06-17 · branch `gc-siteops-addressability` · commit `dc9b003` (on top of B1a `57a2e7e` + `feb449a`)_

> Plan of record: `docs/plans/2026-06-16-gc-siteops-addressability-grid-convergence.md`
> (locked decisions D1–D4, ID-1…ID-4). B1b is the **second half of Phase B1** (ID-3) — the
> type-level/contract half that follows B1a's structural extraction. **Phase B1 is now COMPLETE.**
> Predecessor: `docs/handoffs/2026-06-17-gc-siteops-addressability-phase-b1a-closure.md`.

---

## What Phase B1b shipped (the type-level half of ID-3)

B1a lifted the grid machinery into a Step-4-typed `EstimateGridShell`. **B1b made it a genuinely
reusable, generic surface** and replaced the Step-4-specific `TableMeta` vocabulary with a
generalized contract — so Steps 2/3 (B2/B3) can implement the same shape with their own leaner
hooks. **Step 4 (`EstimateTable` via `useTakeoffWorkbook`) remains the SOLE consumer.** This is a
**type-level + structural change; behavior is byte-identical** (goldens $0.00, suite unchanged).

### The generalized host contract — `src/types/index.ts`
- New **`GridHostContract<TRow extends RowData, TCellKind extends string = string>`** holds the
  former meta vocabulary, generalized: `handleCellEdit`/`commitCellEdit` take `field: keyof TRow`
  (was `keyof ProcessedTakeoffRow`); `handleKeyDown` takes `type: TCellKind` and `handlePaste`
  takes `type: Exclude<TCellKind, "uom">` (was the literal `"code"|"desc"|"qty"|"price"[|"uom"]`
  unions). The rest (editing-buffer refs, `lockedCells`, `setContextMenu`, `deleteRow`,
  `insertManualRow`, custom-cell handlers, `selection`/`setSelection`) is unchanged in shape.
- New **`GridCellKind = "code"|"desc"|"qty"|"price"|"uom"`** (the Step-4 cell kinds).
- The TanStack augmentation is now **`interface TableMeta<TData extends RowData> extends
  GridHostContract<TData, GridCellKind> {}`** — i.e. the global meta IS the Step-4 instantiation
  of the contract (Step 4 is the only consumer today), so for `ProcessedTakeoffRow` it resolves
  **exactly** as the hand-written augmentation did. (`keyof TData`, the literal kind unions, the
  paste-minus-`uom` set all match byte-for-byte → tsc-confirmed, every existing call site
  unchanged.) Module augmentation must use `interface`, so the empty-extends form carries a
  justified `// eslint-disable-next-line @typescript-eslint/no-empty-object-type`.

### The generic shell — `EstimateGridShell.tsx` → `GridShell.tsx`
- Renamed (git rename, 69% similar) and made **`GridShell<TRow>`**. `table: Table<TRow>`,
  `rows: TRow[]`. Reads off `table.options.meta` only the generic `setSelection` +
  `handleCustomKeyDown`.
- New **`GridShellConfig<TRow>`** prop bundle = the host's projection of `TRow` onto the grid:
  - `getRowId(row)` — stable identity (selection compare + React keys). _Step 4: `row.id`._
  - `getGroupKey(row)` / `getGroupLabel(key)` / `getRowGroupTotal(row)` — the divider grouping
    (replaces the shell's hard-coded `getDivisionCode`/`DIVISION_LABELS`/`layoutConfigMap` +
    qty×price). `""` group key → no divider. _Step 4: division code; layout-override → labels;
    `matchedQty × unitPrice`._
  - `isRowFlagged(row)` — drives the amber "needs attention" row styling. _Step 4: `!row.isMapped`._
  - `editableColumnIds` / `centerAlignedColumnIds` — the two former inline literal arrays.
  - **`renderCellOverlay?(row, columnId)` — the A+1 per-line override ⚑ HOOK POINT.** A reserved
    per-cell overlay slot rendered after the flexRendered cell. **NOT wired this phase** — Step 4
    omits it (`renderCellOverlay?.(…)` → `undefined` → nothing renders → DOM byte-identical).
    **B2/B3 pass a renderer that returns the ⚑ marker once the type-over gesture lands.**
- Internal divisiony locals renamed to group-oriented (`collapsedGroups`, `groupTotals`); memo
  deps now include the (host-memoized, stable) config fns. Dropped the no-op `"use no compiler"`.

### Other touched files
- **`FilterableColumnHeader.tsx`** — made **generic over the row type** (it only reads `column.id`
  + generic TanStack APIs, so it is row-type-agnostic). `memo(Inner) as typeof Inner` restores the
  generic call signature the memo erases. (Needed because `GridShell<TRow>` passes it
  `Column/Table<TRow>`.)
- **`EstimateTable.tsx`** — renders `<GridShell config={gridConfig} …/>`; `gridConfig` is a
  memoized `GridShellConfig<ProcessedTakeoffRow>` with the Step-4 projection. **eslint revisit
  (B1a follow-up):** dropped the no-op `"use no compiler"` (React Compiler is NOT enabled in
  `next.config.ts`, so the directive was inert — only `eslint-plugin-react-hooks` v7's
  compiler-aware *advisories* run statically) and **narrowed B1a's file-level eslint-disable to
  three per-line `eslint-disable-next-line`** at the exact advisory sites (the `openTrust`/
  `handleViewRow` stable-setter `useCallback`s + the one-shot `pendingInspect` setState-in-effect),
  so the rest of the file is linted again. Empirically confirmed `"use no memo"` does NOT gate
  those two rules, so per-line suppression is the correct minimal lever.
- **`.agent/skills/data-table-architecture/SKILL.md`** — `GridShell` added to the hierarchy +
  key-files; **all §8 anti-patterns kept verbatim.**

## Verification (CLAUDE.md Definition of Done + B1 interaction gate)
- **Unit:** `npm run test` → **94 files / 1124 pass** (identical to baseline); all three export
  goldens (McKenna/synthetic/CARE) tie **$0.00**.
- **Types:** `npx tsc --noEmit` clean. **Build:** `npm run build` green.
- **Lint:** `npx eslint` on touched files → **0 errors, 2 warnings**, both pre-existing/relocated
  (the `lockedCells` baseline warning; the `useVirtualizer` `incompatible-library` warning, now in
  `GridShell`). No new findings.
- **/code-review (self, high):** no correctness findings (the change is byte-identical + improves
  cleanup: narrowed disable, generalized contract).
- **Playwright e2e:**
  - **PASS** `linked-values-engine-graph.spec.ts` (×2) — summary-cell → Links tab + Site-Ops
    cross-step badge, through the new shell.
  - `smoke.spec.ts` **and** `linked-values-authoring.spec.ts` **FAIL — but identically on the B1a
    baseline** (verified by `git stash`-ing B1b and re-running: authoring fails at the SAME
    line 106 `ctx-define-link` timeout; the page is stuck on the "Authenticating Session Node…"
    loading state — a **local-environment session-refresh flake**, not a B1b regression). `smoke`
    is the known dblclick-on-read-only-first-row issue.
  - `phase3c-mapping-verify.spec.ts` — **test body passed** (console shows the BLI mapping edit
    AND the revert both ran); only the `finally`-block scratch-project cleanup (line 193) timed
    out — the documented non-regression.
- **Manual `/verify`** (browser, already-authenticated session, scratch Div-06 project): through
  `GridShell` confirmed — grid render (division dividers, provenance glyphs, 🔗 binding badges,
  filterable headers, status-bar **Procore ties**), **cell edit + recompute** (qty 0→5 moved
  subtotal $283.33→$13,995.99, ties held), **undo (Ctrl+Z) + redo (Ctrl+Y)**, **context menu**
  (Lock Cell / Insert Row Above-Below / Define Link… / Delete Row), and the **Trust Inspector
  tabs** (Trace/Links/Reconcile/Flags) all render. (Cell-lock click, multi-cell paste, and the
  override ⚑ were not individually clicked: lock uses the same proven context-menu path; paste's
  handler is unchanged; no overrides exist on a scratch project and the ⚑ is unwired by design.)

## Git
Committed to `gc-siteops-addressability` as **`dc9b003`** (one commit, message via `git commit -F`).
**Not pushed** (commit-only; push when the architect asks). Track A already merged to `main`
(PR #9); Track B follows the same cadence — per-phase PR or one merge at Track B's end, the
architect's call.

---

## NEXT — Phase B2: Step 2 (GC Personnel) as a grid

**Goal (plan §"Phase B2"):** render **Step 2 (GC Personnel)** through the shared `GridShell<TRow>`
with its **own** leaner state+command hook implementing the host contract — backed by the
section-lines table (A3, `getSectionLines`/`saveSectionLines`) and the parameterized engine (A1,
`computePersonnelCosts` active-line-set arg). Per-cell editing, keyboard nav, cell locks,
provenance glyphs, 🔗 badges, Trust Inspector, and **undo/redo via `WorkbookCommand`** (command
history does NOT exist on this page today — add the needed command types with **full inverse data**
per AGENTS.md compounding-history). Auto-calc rows derive; **type-over wires to the A+1 override
path** (`recordEstimateOverride` keyed by `sectionLineTotalOverrideKey`/`lineFieldNodeId(id,'total')`
— this is where `GridShellConfig.renderCellOverlay` finally renders the ⚑). Catalog lines render as
the removable seed (full D2 add/remove is B4). **Imported Step 2 stays its read-only view (D4).**

**Concrete starting points**
- `GridShell<TRow>` / `GridShellConfig<TRow>` / `GridHostContract<TRow, TCellKind>` are the sockets
  — Step 2 supplies `TRow = EstimateSectionLine` (`src/lib/sectionLines/`), its own `GridCellKind`,
  and a config whose `getGroupKey`/`getGroupLabel` group by GC section (not division), `getRowId`
  = the section-line id, `getRowGroupTotal` = the line's computed total, `isRowFlagged` per Step-2
  needs, and a **`renderCellOverlay` that returns the override ⚑** when a line has an
  `estimate_overrides` entry.
- The A-track scaffolding is all in place and inert: A1 parameterized engine, A2 table + RPC, A3
  app-born synthesis (`sectionLines/synthesize.ts`), A5 registry projection
  (`projectAppBornSectionLines`), A+1 per-line `override ?? computed` in the engine keyed by
  `sectionLineTotalOverrideKey`. B2 is the first phase to put a **grid + authoring gesture** on top.
- New Step-2 hook: model it on `useTakeoffWorkbook` but leaner — it owns selection,
  column defs, the section-line rows, and a `useCommandHistory`-backed command set. The meta it
  builds must satisfy `GridHostContract<EstimateSectionLine, …>`.
- `.agent/skills/data-table-architecture/SKILL.md` — the invariant bible; keep every §8
  anti-pattern intact (click-to-toggle, single-container keyboard owner, meta-read-in-cell, no
  `selection` in the columns memo, etc.).

**Gate:** Step-2 grid edits undoable atomically; totals tie to the cent vs the old form · **both
export goldens $0.00** · a new Playwright e2e + manual `/verify` · `tsc` + `build` + full suite
green · `/code-review`. Then a `/handoff` sequencing **B3** (Step 3 as a grid). **Stop at the B2
boundary.**

### Phase B2 kickoff prompt (paste into a fresh session)

> Implement **Phase B2** of GC/Site-Ops Addressability & Grid Convergence — **Step 2 (GC Personnel)
> as a grid**. Read the plan (`docs/plans/2026-06-16-gc-siteops-addressability-grid-convergence.md`,
> Phase B2 + decisions ID-1…ID-4, D2/D3/D4) and this B1b closure
> (`docs/handoffs/2026-06-17-gc-siteops-addressability-phase-b1b-closure.md`) first. **Branch:**
> continue on `gc-siteops-addressability` (B1b is committed at `dc9b003`); ensure it's current with
> `origin` (pull if pushed). Do NOT branch off or commit on `main`.
>
> Scope: render Step 2 through the shared **`GridShell<TRow>`** with a **new, leaner Step-2
> state+command hook** that implements **`GridHostContract<EstimateSectionLine, …>`** and supplies a
> **`GridShellConfig<EstimateSectionLine>`** (group by GC section; row id = section-line id;
> `getRowGroupTotal` = computed line total; **`renderCellOverlay` returns the override ⚑** when a
> line is overridden). Back it with the section-lines table (A2/A3 `getSectionLines`/
> `saveSectionLines`) and the parameterized engine (A1). Add **undo/redo** via new `WorkbookCommand`
> types with **full inverse data** (AGENTS.md compounding-history — this page has no history today).
> Auto-calc rows derive; **wire type-over to the A+1 override path** (`recordEstimateOverride` keyed
> by `sectionLineTotalOverrideKey`). Catalog lines = seed; **imported Step 2 stays read-only (D4)**.
> Keep every §8 anti-pattern in `.agent/skills/data-table-architecture/SKILL.md` intact. Take it
> through the CLAUDE.md **Definition of Done** (suite green, **both export goldens $0.00**, tsc,
> build, `/code-review`, commit via `git commit -F`, no push unless asked) plus a Step-2 grid e2e +
> manual `/verify` (cell edit · undo/redo · cell lock · context-menu · type-over ⚑ · 🔗 badge ·
> Trust tabs). Then write a `/handoff` sequencing **Phase B3**. **Stop at the B2 boundary.**

## Where this sits
Track A: A1→A5 + A+1 ✅ (merged, PR #9). Track B: **B1a ✅ → B1b ✅ (this session; Phase B1
COMPLETE) → B2 (Step 2 grid) → B3 (Step 3 grid) → B4 (removable seed, D2) → B5 (validated
one-off, D1) → B6 (sweep + retire blob columns, ⛔DDL).**
