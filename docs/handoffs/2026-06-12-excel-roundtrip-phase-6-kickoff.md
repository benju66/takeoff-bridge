# Excel Round-Trip — Phase 6 Kickoff (re-upload UI)

_2026-06-12 · Phase 5 COMPLETE on `claude/excel-roundtrip-export-wfezu4`
(`0e6a446`; PR #3 carries Phases 1–5). Suite 771 pass, `npx tsc --noEmit`
clean. (`npm run build` fails in the remote sandbox on missing Supabase env at
prerender — pre-existing/environmental; verify build locally.)
Plan: `docs/plans/2026-06-12-excel-roundtrip.md`._

## What Phase 5 shipped (everything below is wired and tested — UI only remains)

- **`ApplyRoundTripCommand`** (+ `RoundTripDialChanges`) in `src/types`:
  one upload = one undoable unit. Dispatch cases live in `useCommandDispatch`;
  `useTakeoffWorkbook` exposes **`applyRoundTripCommand(cmd)`** (push +
  forward); `page.tsx` already threads **`applyRoundTripDials`** (the dial
  prev/next applier over personnel/infrastructure/project setters).
- **`planRoundTripApply(inputs)`** (`src/lib/applyRoundTrip.ts`, pure) —
  the UI's whole brain: takes `{ delta, excel, currentRows, dials, project,
  sourceLabel, applyConflicts, idFactory? }`, returns
  `{ command, nextRows, inapplicable, notes, isEmpty }`. Dial snapshots come
  from `personnel.utilizations/rateOverrides/equipment/manualEntries` and
  `infrastructure.quantities/rates` (note: planner wants PERCENT utilizations
  — the hook's unit — and the hook's own keys).
- **`isWorkingCopyCaptured(newestVersion, summary)`** — the Pre-upload
  baseline pre-check (summary-proxy vs `useEstimateVersions().versions[0]`).
- Phase 4 surface for errors/extraction: `extractRoundTrip`,
  `assertRoundTripAllowed`, `computeRoundTripDelta`, typed errors
  (`UnstampedWorkbookError`, `WrongProjectError`, `StampSchemaError`,
  `ImportedProjectRoundTripError`).

## Phase 6 scope — the confirm flow IS this sequence

1. Upload entry in the workspace data-I/O action bar (app-born projects only;
   hide/disable for `project.isImported`). Accept .xlsx; read into ArrayBuffer.
2. `extractRoundTrip(buffer)` → catch typed errors into clear UI messages;
   `assertRoundTripAllowed(stamp, project)`.
3. Build `current: RoundTripState` via **`buildRoundTripBaseline`**
   (exported from exporter.ts — same shape guaranteed) over the live grid +
   calc results + summary basis; `computeRoundTripDelta(excel, baseline,
   current)`.
4. `RoundTripPreviewModal` (patterns: `ImportPreviewModal` + `VersionsPanel`/
   versionDiff rendering): row deltas, dial deltas (group by scope), planner
   `notes` + `inapplicable` (informational section), extraction `issues`,
   staleness banner when `delta.isStale`, conflict acknowledgment checkbox
   gating `applyConflicts` (locked decision 3 — never blocks, never silent).
   Disable Apply when `plan.isEmpty`.
5. On confirm:
   a. `summary` = current engine summary (page already computes it);
      if `!isWorkingCopyCaptured(versions[0], summary)` →
      `await createVersion("Pre-upload baseline", rows, summary)` — ABORT on
      failure (the safety net must exist before mutating).
   b. `workbook.applyRoundTripCommand(plan.command)`.
   c. Post-apply version: wait for state to settle (effect keyed on
      `rowVersion`/summary change, or recompute purely from `plan.nextRows` +
      next dial values), then
      `createVersion(\`Excel re-upload — ${filename}\`, …)`. Title from
      `command.sourceLabel`. Failure here = warning toast, NOT rollback
      (versions are audit, the apply already has one-step undo).
6. Tests: pure pieces only (modal render untestable here) — any new helper
   logic extracted pure + covered.

## Watch-outs

- `buildRoundTripBaseline` needs `estimateTotalBasis` =
  `summary.totalEstimatedCost` (the %-line basis the exporter used).
- Dial snapshot keys: utilizations are the hook's Record (percent), NOT
  fractions; `rateOverrides` absent-key = corporate default (planner emits
  `prev: null` → inverse calls `resetRate`).
- `applyRoundTripDials` saves project fields immediately
  (`handleProjectParamChange` persists per call); Step 2/3 dials ride the
  existing estimate auto-save.
- Su tri-cell disagreement arrives in `extractRoundTrip(...).issues` — show
  it; the planner already ignores the operational E cells.

## Kickoff prompt

> Read `docs/plans/2026-06-12-excel-roundtrip.md` and
> `docs/handoffs/2026-06-12-excel-roundtrip-phase-6-kickoff.md`. Execute
> **Phase 6 only** (upload entry + RoundTripPreviewModal + confirm flow with
> the two auto-versions). Exit: `npm run test` green, `npx tsc --noEmit`
> clean, committed, handoff for Phase 7. Do not start Phase 7.
