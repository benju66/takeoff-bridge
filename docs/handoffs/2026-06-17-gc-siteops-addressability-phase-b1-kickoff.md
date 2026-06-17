# GC/Site-Ops Addressability — Phase B1 kickoff (revised branch strategy)
_2026-06-17 · opens **Track B** (structured-first TanStack grid convergence)_

> Plan of record: `docs/plans/2026-06-16-gc-siteops-addressability-grid-convergence.md`
> (read it first — locked decisions D1–D4, ID-1…ID-4). This **supersedes the B1 kickoff
> embedded in** `docs/handoffs/2026-06-17-gc-siteops-addressability-phase-a1plus-closure.md`
> on ONE point only: the **branch instruction** (Track A was merged to `main`; see below).
> The B1 scope/anchors in that closure remain accurate.

---

## State at this boundary (verified on `main`, 2026-06-17)

- **Track A is COMPLETE and MERGED to `main`** via **PR #9** (merge `e62efc6`): A1 (calc
  parameterized) → A2 (`estimate_section_lines` table, ⛔DDL) → A3 (lazy synthesis, app-born)
  → A4 (imported branch, #1 risk) → A5 (section lines as BindingLines) → A+1 (audited
  type-over on calc rows, D3). The old workstream branch `gc-siteops-addressability` is
  **merged — do not commit to it again.**
- `main` is green against the CLAUDE.md **Definition of Done**: `npm run test` **94 files /
  1124 tests pass**, `npx tsc --noEmit` clean, `npm run build` green. All three export
  goldens (McKenna / synthetic / CARE) tie **$0.00**.
- A+1 is **headless**: the per-line override seam exists in the engine
  (`computePersonnelCosts` / `computeSiteOperations` take a defaulted `lineOverrides`, layered
  via `makeLineOverrideLayer`, forwarded through `src/lib/sectionLines/project.ts`), but
  **nothing on the page creates a type-over yet** — that gesture is a B2/B3 concern. B1 only
  needs to make the host contract *able* to surface the override ⚑, not wire it.

## Branch strategy for Track B (the correction)

Track A was merged to `main` via PR #9, so the **`gc-siteops-addressability` branch is now
behind `main`**. Committing to it as-is — what the A+1 closure's kickoff literally says —
would build on stale, already-merged history. Per the workstream record, that branch is
**PRESERVED for Track B and must be re-synced to `main` first.**

- **Re-sync, then continue (recommended — matches the workstream record):**
  `git switch gc-siteops-addressability` → `git merge main` (or `git rebase main`) so the
  branch carries the PR #9 merge, THEN do B1 on it. Do NOT commit on `main` directly, and do
  NOT build B1 on the un-resynced branch.
- **Alternative (architect's call):** start a fresh branch off the updated `main`
  (e.g. `gc-siteops-grid-convergence`) if you'd rather not reuse the merged branch — equally
  clean. Either way, ensure local `main` is current with `origin/main` first.
- **Merge cadence:** same as Track A — per-phase PR merges, or one merge at Track B's end.
  B1 is zero-behavior-change, so it is safely mergeable on its own.

## Phase B1 — extract the shared grid shell (behavior-preserving)

**Goal (plan §"Phase B1", ID-3):** extract a **generalized grid shell + decoration/Trust
layer** out of `EstimateTable` so Steps 2/3 can later plug in — with **Step 4 as the SOLE
consumer** through this phase. The **riskiest Track B phase** (large, coupled component);
must be **strictly zero-behavior-change**.

### Scope (from the plan, ID-3)
- Adopt/extend the **existing** `src/components/ui/grid/` primitives (which `EstimateTable`
  does **not** yet consume) inside `EstimateTable`.
- Extract the grid shell (TanStack instance plumbing + selection/keyboard + rendering)
  **plus** the decoration/Trust layer (provenance glyph, override ⚑, 🔗 binding badge, cell
  lock, context menu, Trust Inspector) behind a **generalized host contract** that replaces
  today's Step-4-specific `TableMeta` vocabulary (`code|desc|qty|price|uom`,
  `insertManualRow`/`deleteRow`, `lockedCells`, `selection`).
- **Step 4 remains the sole consumer** via `useTakeoffWorkbook` this phase. Steps 2/3 plug
  in only in B2/B3.

### Concrete anchors
- `src/components/workspace/EstimateTable.tsx` (~1,236 lines; the only `useReactTable`
  consumer today) and `src/hooks/useTakeoffWorkbook.tsx` (~1,575 lines).
- `src/components/ui/grid/` — the unused primitives to adopt/extend
  (`GridTable`, `GridHeaderRow`, `GridSectionDivider`, `GridCellInput`, `GridCellCurrency`,
  `ResizeHandle`, `index.ts`).
- Trust-layer surfaces to capture in the host contract so Steps 2/3 reuse them: provenance
  glyph, override ⚑ (today summary-only via `TrustInspector`), 🔗 binding badge
  (`EngineLinkBadge`), Trust Inspector Links tab. The A+1 per-line override seam will hang
  off this contract later — design the contract to allow a per-line override indicator, but
  do not wire a gesture in B1.

### Approval gates
- **None** — but treat the **export goldens + the ENTIRE suite + `tsc` + `build`** as the
  hard gate (zero behavior change). If the extraction can't land green in one session,
  **split it** (an extra handoff is cheap): "adopt ui/grid primitives" then "extract host
  contract".

### Exit criteria
- Per the CLAUDE.md **Definition of Done** (tests green · tsc clean · build green ·
  `/code-review` resolved · committed via `git commit -F` · branch pushed). The
  zero-behavior-change bar means the export goldens, the **entire** test suite, `tsc`, and
  `build` must ALL be unchanged.
- **⚠ Mandatory interaction-verify gate for B1 — the automated suite does NOT cover this.**
  There are **zero component-render tests** for `EstimateTable`: the unit suite (~1,124 tests)
  is pure logic (calc / bindings / db mappers / command-history logic), so "suite green"
  proves the *engine* is intact, **not** that the *grid behaves identically*. A green suite +
  `build` can still hide a broken cell-edit, paste, keyboard-nav, cell-lock, or context-menu
  after this refactor. So B1 is **not done** until BOTH:
  1. The existing **Playwright e2e specs pass** — `e2e/smoke.spec.ts`,
     `e2e/linked-values-authoring.spec.ts`, `e2e/linked-values-engine-graph.spec.ts`,
     `e2e/phase3c-mapping-verify.spec.ts` (they exercise load, binding authoring, and the
     Trust Inspector Links tab).
  2. A **manual `/verify` pass on the Step 4 grid** drives, at minimum: edit a cell
     (code / desc / qty / price / uom) · undo + redo (Ctrl+Z / Ctrl+Y) · toggle a cell lock ·
     paste a multi-cell range · insert + delete a row via the context menu · open the Trust
     Inspector and confirm the Trace / Reconcile / Flags / Links tabs render · confirm the
     provenance glyph, the override ⚑, and the 🔗 binding badge still appear. Any divergence
     from pre-B1 behavior fails the phase.
- Close by writing a `/handoff` sequencing **Phase B2** (Step 2 as a grid). **Stop at the
  Phase B1 boundary.**

### Phase B1 kickoff prompt (paste into a fresh session)

> **Branch first:** Track A was merged to `main` via PR #9. Re-sync the workstream branch and
> continue on it: ensure local `main` is current with `origin/main`, then
> `git switch gc-siteops-addressability` → `git merge main` (bring in the PR #9 merge so the
> branch isn't behind) — THEN do B1. (Or, if you prefer, branch fresh off the updated `main`:
> `git switch -c gc-siteops-grid-convergence`.) Do NOT commit on `main` directly, and do NOT
> build B1 on the un-resynced merged branch. Confirm the plan file
> `docs/plans/2026-06-16-gc-siteops-addressability-grid-convergence.md` and this handoff are
> present.
>
> Implement **Phase B1** of GC/Site-Ops Addressability & Grid Convergence (read the plan's
> Phase B1 + decision ID-3 first). This opens Track B: **extract the shared grid shell +
> decoration/Trust layer** out of `EstimateTable` behind a **generalized host contract** that
> replaces the Step-4-specific `TableMeta` vocabulary — adopting/extending the existing
> (currently unused) `src/components/ui/grid/` primitives. **Step 4 must remain the SOLE
> consumer** via `useTakeoffWorkbook` this phase (Steps 2/3 plug in only in B2/B3). This is
> the **riskiest Track B phase** — keep it **strictly zero-behavior-change**: the export
> goldens, the ENTIRE test suite, `tsc`, and `build` must ALL be unchanged. If it can't land
> green in one session, **split it** ("adopt ui/grid primitives" then "extract host
> contract") and write an extra handoff — don't force it. Take the change through the
> CLAUDE.md **Definition of Done**. NOTE: the unit suite has **no component-render tests** for
> `EstimateTable`, so a green suite does NOT prove the grid behaves the same — B1 is NOT done
> until you ALSO (a) run the existing Playwright e2e specs green (`e2e/smoke.spec.ts`,
> `e2e/linked-values-authoring.spec.ts`, `e2e/linked-values-engine-graph.spec.ts`,
> `e2e/phase3c-mapping-verify.spec.ts`) AND (b) do a manual `/verify` pass on the Step 4 grid
> (cell edit · undo/redo · cell lock · multi-cell paste · context-menu insert/delete · Trust
> Inspector tabs render · provenance glyph / override ⚑ / 🔗 badge still show). Then write a
> `/handoff` doc sequencing **Phase B2**. **Stop at the Phase B1 boundary.**

---

## Where this sits in the workstream
Track A: **A1 ✅ → A2 ✅ → A3 ✅ → A4 ✅ → A5 ✅ → A+1 ✅ (merged to `main`, PR #9)**.
Track B: **B1** (grid-shell extraction — the next phase) → B2/B3 (Step 2 / Step 3 grids) →
B4 (removable/re-addable seed, D2) → B5 (validated one-off escape hatch, D1) → B6
(finish-migration sweep + retire blob columns, ⛔ DDL).
