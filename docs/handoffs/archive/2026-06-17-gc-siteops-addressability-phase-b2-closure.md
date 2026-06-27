# GC/Site-Ops Addressability — Phase B2 closure & Phase B3 kickoff
_2026-06-17 · branch `gc-siteops-addressability` · commit `dda8149` (on top of B1b `dc9b003`, closure `f6d8b77`)_

> Plan of record: `docs/plans/2026-06-16-gc-siteops-addressability-grid-convergence.md`
> (locked decisions D1–D4, ID-1…ID-4). B2 is the first **Track B** phase to put a real grid +
> authoring gesture on the A-track scaffolding. Predecessor: `…-phase-b1b-closure.md`.

---

## What Phase B2 shipped — Step 2 (GC Personnel) as a grid

Step 2 was a bespoke read-only `<input>` matrix (`PersonnelPricingStep`). It is now a **real
spreadsheet on the shared `GridShell<TRow>`**: per-cell click-to-edit, keyboard nav, in-session
cell locks, provenance section dividers (01.A–01.F), 🔗 engine-Links badges, undo/redo, and an
audited per-line **type-over**. **Imported Step 2 is untouched** — it stays the read-only
`ImportedStep23Panel` (D4).

### Architecture (B2-D1) — the grid is a VENEER, not a re-home
The new `useGcPersonnelGrid` hook owns **only grid concerns** (selection, the
`useReactTable<EstimateSectionLine>` instance, columns, a `useCommandHistory<GcGridCommand>`,
in-session cell-lock, the type-over gesture, and the `meta` satisfying
`GridHostContract<EstimateSectionLine, GridCellKind>` + a `GridShellConfig`). It is a thin layer
over **`usePersonnelCalculations`**, which stays the authoritative owner of the GC inputs, the
legacy blob snapshots, the A3 dual-write/dual-read, and the authoritative `calcResult`:
- **Rows** = `personnel.sectionLines.filter(section==='gc')`, re-sorted for display into 01.A–01.F.
- **Per-row numbers** = `personnel.calcResult`, joined by `code` (the canonical
  `projectAppBornSectionLines` join).
- **An input edit** maps a section-line cell → the matching `personnel` setter (`setUtilization` /
  `handleRateChange`|`resetRate` / `handleEquipmentChange` / `handleManualEntryChange`) **and**
  pushes an `EDIT_SECTION_CELL` command with full inverse data (prev/next). The GC engine is **pure
  from inputs**, so a single prev/next value is full-fidelity — undo/redo just replays the setter.
- **Persistence** rides the existing A3 dual-write (`useEstimatePersistence` saves
  `personnel.sectionLines` via `saveSectionLines`) — no new write path.

_Why a veneer, not section-lines-as-sole-store:_ this is the most downstream-coupled page
(linked-division totals → `takeoffSummary` → export → dual-read tripwire all read `personnel.*`).
Re-homing the authoritative inputs now would add a lines→blob inverse + drift risk against the
**byte-identical / goldens-$0.00** gate, with no payoff until **B6** retires the blobs. B6 is where
section lines become the sole store.

### Type-over (D3 / A+1), B2-D2 — audited, not on Ctrl+Z
Typing a number over an auto-calc **total** records an append-only `estimate_overrides` event
(`recordEstimateOverride` keyed by `sectionLineTotalOverrideKey(lineId)` = `line:<id>:total`). The
page already loads these into `activeOverrides`; B2 threads `activeOverrides` into
`usePersonnelCalculations` → `computePersonnelCosts(…, lineOverrides)` (the A+1 layer built inert in
Track A). The override layers IN the calc result, so grand total / linked totals / export reflect it
for free; the computed value is retained. It surfaces as the **`GridShellConfig.renderCellOverlay` ⚑**
(the B1b-reserved hook point, now wired) with **click-to-revert**. It is NOT on the undo stack
(mirrors Step 4's Trust override; honors AGENTS.md append-only training-data immutability). Ctrl+Z
covers the input edits.

### Cell locks (B2-D3) — in-session only
Step-2 locks live in the grid hook's own `lockedCells`, are undoable (`TOGGLE_SECTION_CELL_LOCK`),
and are **not persisted** this phase (the shared `project_locked_cells` map is owned by the Step-4
workbook; dual-ownership persistence would race two debounced savers). Keys are section-line-id
namespaced, so persistence drops in cleanly at the B6 sweep.

### Files
- **NEW `src/hooks/useGcPersonnelGrid.tsx`** — the grid state+command hook (the leaner Track-B twin
  of `useTakeoffWorkbook`).
- **NEW `src/components/workspace/GcPersonnelGridStep.tsx`** — the host: title bar, undo/redo,
  summary `<tfoot>` (grand total + `GC_GRAND_TOTAL_NODE_ID` badge), lock/unlock context menu,
  click-outside-deselect, and a **step-local global Ctrl+Z/Y listener** (the page's global listener
  is now guarded to `step4`, so the Step-2 component owns step2 undo; steps mount one at a time).
- **NEW pure `src/lib/sectionLines/gcGridModel.ts`** — the React-free model: 01.A–01.F grouping +
  display order, the calc-by-`code` join (`buildCalcLookup`), `entryValue` per kind, and
  `resolveEntryTarget`/`resolveRoleKey` (section line → personnel setter). Unit-tested.
- **`useCommandHistory<T = WorkbookCommand>`** generalized (default = byte-identical for Step 4);
  **`GcGridCommand`** union added to `types/index.ts`.
- **`usePersonnelCalculations`** gains an optional `lineOverrides` arg (threaded into the engine +
  the dual-read tripwire; default `{}` → inert).
- **`page.tsx`** renders `GcPersonnelGridStep` for app-born step2; passes `activeOverrides` into
  `usePersonnelCalculations`; guards the global undo listener to step4.
- **DELETED `PersonnelPricingStep.tsx`**.
- **SKILL** `data-table-architecture`: Step 2 added as a `GridShell` consumer; **all §8
  anti-patterns kept verbatim**.

## Verification (CLAUDE.md Definition of Done)
- **Unit:** `npm run test` → **95 files / 1135 pass** (baseline 94/1124 + new `gcGridModel.test.ts`
  (11)); all three export goldens (McKenna/synthetic/CARE) tie **$0.00**.
- **Types:** `npx tsc --noEmit` clean. **Build:** `npm run build` green. **Lint:** touched files clean.
- **/code-review (self, high):** one fix applied — `catch` the type-over write rejection (avoids an
  unhandled promise rejection on a failed `estimate_overrides` insert). Otherwise clean.
- **Playwright e2e** `e2e/gc-personnel-grid.spec.ts` **PASSES**: scratch project → Step 2 renders as
  a grid (01.A divider + 🔗 badges), a **dumpsters equipment lump-sum cell edit recomputes** its
  total to $1,500.00 (cell click-to-toggle → input → fill → Enter → command → setter → engine →
  display), **Ctrl+Z restores** $0.00, and a **🔗 badge opens the STEP 4 Trust "Links" tab** focused
  on that STEP 2 engine node (cross-step navigation). (The e2e edits an equipment line, not a staff
  utilization: a scratch project has **duration 0**, so a duration-driven staff total stays $0.00
  regardless of utilization — equipment is duration-independent and proves the same edit→engine path.)
- **Manual /verify caveats (architect spot-check):** the e2e covers render · cell edit · recompute ·
  undo · 🔗 → Step 4 Links. **Cell-lock (right-click → Lock cell), the context menu, and the
  type-over ⚑ set/revert were NOT individually e2e-exercised** (the type-over is best seen on a
  duration>0 staff line; lock/menu use the proven context-menu path). The type-over **engine
  integration** is unit-tested (`gcGridModel.test.ts`: the `line:<id>:total` field key applies in
  `computePersonnelCosts`, retains computed, ignores foreign keys, inert with no overrides). Worth a
  2-minute browser spot-check on a real (duration>0) project: type over a staff total → ⚑ appears +
  grand total moves → click ⚑ to revert; right-click a cell → Lock → it goes read-only.

## Git
Committed to `gc-siteops-addressability` as **`dda8149`** (one commit, message via `git commit -F`).
**Not pushed** (commit-only; push when the architect asks). Track A merged to `main` (PR #9); Track B
follows the same cadence — per-phase PR or one merge at Track B's end, the architect's call. ⚠️ B1b
(`dc9b003`) + its closure (`f6d8b77`) + B2 (`dda8149`) are all **local, NOT pushed**.

## Known limits / notes (carry-forward)
- The old form's **live %-of-estimate $ suggestion** on the two pctHint lines (Safety Consultant /
  Procore) is reduced to the **static % guidance** in the grid (the live $ needs `estimateTotal`,
  not threaded into the grid). Minor advisory-only reduction; re-add later if wanted.
- Keyboard nav under an **active column filter** indexes the filtered row model by data-index (same
  pre-existing pattern as Step 4's `useKeyboardNavigation`); the unfiltered default is correct.
- The pre-existing local e2e **session-refresh flake** (B1a/B1b closures) still affects
  `smoke`/`linked-values-authoring`; the new B2 spec + `engine-graph` spec pass.

---

## NEXT — Phase B3: Step 3 (Site Operations) as a grid

**Goal (plan §"Phase B3"):** the same pattern for **Step 3 (Site Operations)** — the larger ~37-line
catalog across 8 sections. Reuse the B2 hook/command/model pattern. **Imported Step 3 stays read-only
(D4).**

**Concrete starting points**
- B2 is the template end-to-end. Build a `useSiteOpsGrid` (twin of `useGcPersonnelGrid`) + a
  `SiteOpsGridStep` host (twin of `GcPersonnelGridStep`), backed by `useInfrastructureCalculations`
  (the Site-Ops twin of `usePersonnelCalculations`) and `computeSiteOperations` (A1). Rows =
  `infrastructure.sectionLines` (section==='site_ops'); per-row numbers = `infrastructure.calcResult`
  joined by `code`.
- **Thread `lineOverrides` into `useInfrastructureCalculations`** exactly as B2 did for
  `usePersonnelCalculations` (the A+1 layer is already in `computeSiteOperations`, keyed by
  `siteOpsDynamicLineId`/`siteOpsManualLineId`). Type-over uses the same `sectionLineTotalOverrideKey`
  field + `handleSaveOverride`.
- **Section-line edit kinds for Site Ops:** `dynamic` (auto, no input — like operational), and manual
  `qty` / `qtyRate` (typed qty **and** a typed rate) / `lumpSum`. Note `qtyRate` has TWO editable
  inputs (qty + rate) — the GC manual lines were qty/lumpSum only, so the rate column is editable for
  `qtyRate` Site-Ops lines (extend `resolveEntryTarget`/the rate cell accordingly). Build a
  `siteOpsGridModel.ts` mirroring `gcGridModel.ts` (its own grouping by the 8 Site-Ops sections,
  `engineGroup` = `siteops:*` for the EngineLinkBadge node ids — see `InfrastructureStep.tsx` /
  `SITE_OPS_DYNAMIC_DEFAULTS`/`SITE_OPS_MANUAL_DEFAULTS` for the section/labels/units).
- **Generalize, don't copy-paste:** much of `useGcPersonnelGrid` (the cell renderers, keyboard nav,
  lock, gridConfig shape, the GcGridCommand union → a shared `SectionGridCommand`) is section-agnostic.
  Consider lifting the shared mechanics into a common `useSectionLineGrid` core that GC and Site-Ops
  both specialize via a small per-section config (the setters, the model, the engineGroup). Track B's
  whole point (ID-3) is a uniform surface — B3 is the moment to factor the GC/Site-Ops commonality so
  B4/B5 don't fork twice. (If the refactor overruns, ship B3 as a parallel twin and factor later.)
- Wire the page: render `SiteOpsGridStep` for app-born step3 (imported → `ImportedStep23Panel`); pass
  `activeOverrides` into `useInfrastructureCalculations`; the page's global undo listener already
  guards to step4, so add a step3 branch (or have `SiteOpsGridStep` own its listener like Step 2 —
  guard the page listener to step4 only, which it already does).

**Gate:** Step-3 grid edits undoable atomically; totals tie to the cent vs the old form · **both
export goldens $0.00** · a new Playwright e2e + manual `/verify` · `tsc` + `build` + full suite green ·
`/code-review`. Then a `/handoff` sequencing **B4** (removable/re-addable catalog seed, D2). **Stop at
the B3 boundary.**

### Phase B3 kickoff prompt (paste into a fresh session)

> Implement **Phase B3** of GC/Site-Ops Addressability & Grid Convergence — **Step 3 (Site
> Operations) as a grid**. Read the plan (`docs/plans/2026-06-16-gc-siteops-addressability-grid-convergence.md`,
> Phase B3 + decisions ID-1…ID-4, D2/D3/D4) and this B2 closure
> (`docs/handoffs/2026-06-17-gc-siteops-addressability-phase-b2-closure.md`) first. **Branch:**
> continue on `gc-siteops-addressability` (B2 is committed at `dda8149`; ensure current with origin,
> pull if pushed). Do NOT branch off or commit on `main`.
>
> Scope: render Step 3 through the shared **`GridShell<TRow>`** with a Site-Ops state+command hook
> (twin of `useGcPersonnelGrid`) + host (twin of `GcPersonnelGridStep`), backed by
> `useInfrastructureCalculations` + `computeSiteOperations` (A1) and the `site_ops` section lines.
> Group by the 8 Site-Ops sections; row id = section-line id; `getRowGroupTotal` = computed line
> total; `renderCellOverlay` returns the override ⚑ when overridden. Add undo/redo via section-grid
> commands with **full inverse data**; thread `activeOverrides` into `useInfrastructureCalculations`
> as `lineOverrides` (A+1 already in the engine); type-over via `recordEstimateOverride` keyed by
> `sectionLineTotalOverrideKey`. **`qtyRate` manual lines have BOTH an editable qty and rate** (unlike
> GC). **Strongly consider factoring the section-agnostic grid mechanics out of `useGcPersonnelGrid`
> into a shared core** that GC and Site-Ops specialize (ID-3 uniform surface) — if it overruns, ship a
> parallel twin and factor later. **Imported Step 3 stays read-only (D4).** Keep every §8 anti-pattern
> in `.agent/skills/data-table-architecture/SKILL.md` intact. Take it through the CLAUDE.md
> **Definition of Done** (suite green, **both export goldens $0.00**, tsc, build, `/code-review`,
> commit via `git commit -F`, no push unless asked) plus a Step-3 grid e2e + manual `/verify`. Then
> write a `/handoff` sequencing **Phase B4**. **Stop at the B3 boundary.**

## Where this sits
Track A: A1→A5 + A+1 ✅ (merged, PR #9). Track B: **B1a ✅ → B1b ✅ → B2 (Step 2 grid) ✅ (this
session) → B3 (Step 3 grid) → B4 (removable seed, D2) → B5 (validated one-off, D1) → B6 (sweep +
retire blob columns, ⛔DDL).**
