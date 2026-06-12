# Excel Round-Trip — Phase 5 Kickoff (apply command + automatic versions)

_2026-06-12 · Phase 4 COMPLETE on `claude/excel-roundtrip-export-wfezu4`
(`8559bce`; PR #3 carries Phases 1–4). Suite 765 pass / 68 files,
`npx tsc --noEmit` clean. Plan: `docs/plans/2026-06-12-excel-roundtrip.md`._

## What Phase 4 shipped

- **`src/lib/roundTripStamp.ts`** — stamp write/read as a customXml part
  (`customXml/item5.xml` + itemProps + rels + content-type override). Excel
  preserves customXml across edit/save (the template's own four foreign parts
  are the proof — final confirmation is a Phase 7 manual item). Stamp =
  projectId, projectName, exportedAt, baseline (base64 JSON of
  `RoundTripState`). Typed errors: `UnstampedWorkbookError`,
  `WrongProjectError`, `StampSchemaError` (schema gate v1).
- **`RoundTripState`** is the single comparison shape everywhere: stamped
  baseline == extractor output == the "current" adapter Phase 5 must build:
  `{ step4Rows (linked rows excluded; itemId/desc/qty/unitPrice/uom),
  step23Inputs (code → {E?,F?,H?} per inputCellsFor), step1 (durationMonths,
  squareFootage, unitCount, modifierRates) }`.
- **`src/lib/roundTrip.ts`** — `extractRoundTrip(buffer)` → stamp + state +
  issues (su tri-cell disagreement, non-numeric inputs);
  `assertRoundTripAllowed(stamp, project)` (imported/wrong-project gates);
  `computeRoundTripDelta(excel, baseline, current)` → `RoundTripDelta`
  (rowDeltas changed/added/removed + per-field three-way classification
  edited/conflict; dialDeltas step23/step1/modifier; isStale; hasConflicts).
  Convergent edits (excel == current ≠ baseline) are silent by design.
  Born-in-Excel rows surface only when they carry dollars (template ships
  furniture rows: default rates at qty 0 AND 0.001-qty nudge rows at $0).

## Phase 5 scope (plan + locked decisions 2, 5, 7)

1. **Current-state adapter**: build a `RoundTripState` from live app state
   (grid rows + the same inputs `buildRoundTripBaseline` uses — consider
   extracting a shared helper from exporter.ts so the two can't drift).
2. **`ApplyRoundTripCommand`** in `src/types/index.ts`, dispatched in
   `useCommandDispatch`: row prev/next states + appended/removed rows
   (mirror `MergeTakeoffDataCommand`, capture `source` provenance) PLUS dial
   prev/next (gc utilization/equipment/manual via `usePersonnelCalculations`
   setters, site-ops via `useInfrastructureCalculations`, project fields).
   ONE `pushCommand`, ONE Ctrl+Z (AGENTS.md history rule). Apply rules:
   "edited" fields apply; conflicts apply ONLY after the UI's acknowledgment
   (Phase 6 passes the resolved set); su dial: Superintendent staff E wins
   (extraction already documents this).
3. **Duration reverse-map** (locked decision 7, flagged minor): D28 edits
   anchor `expectedStart`, recompute `expectedFinish`; show the derived date
   change in the preview payload.
4. **Auto-versions** via existing `createEstimateVersion` (db.ts): if the
   working copy isn't captured by the newest version → "Pre-upload baseline"
   first; post-apply version titled from filename/exportedAt. Neither
   submitted. Persistence rides the existing save path. **No DDL** — ⛔ stop
   at the approval gate if any schema change appears.
5. **Tests**: undo-fidelity in the import-integrity style (apply → undo →
   byte-identical state incl. dials + provenance), version-creation ordering.

## Watch-outs

- `BaselineRow` has NO costType (col A isn't rewritten on mapped rows) —
  apply must not touch costType.
- Added rows from Excel need catalog/procore mapping resolution — missing
  mappings trigger the interactive user-override interface (AGENTS.md), never
  a guess.
- `%`-line H (basis) deltas: an Excel edit to H35 is almost always the stale
  basis, not an estimator intent — treat as informational, not applicable
  (the engine recomputes the basis).

## Kickoff prompt

> Read `docs/plans/2026-06-12-excel-roundtrip.md` and
> `docs/handoffs/2026-06-12-excel-roundtrip-phase-5-kickoff.md`. Execute
> **Phase 5 only** (current-state adapter, ApplyRoundTripCommand + dispatch,
> duration reverse-map, auto-versions; no UI). Exit: `npm run test` green,
> `npx tsc --noEmit` clean, committed, handoff for Phase 6. Do not start
> Phase 6.
