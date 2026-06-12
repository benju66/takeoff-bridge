# Excel Round-Trip — Phase 4 Kickoff (export stamp + extraction/delta engine)

_2026-06-12 · Phases 1–3 (the EXPORT half) COMPLETE on `claude/excel-roundtrip-export-wfezu4`
(`931f12a` → `0b92b8f` → `3b4b869`). Suite 755 pass / 67 files, `npx tsc --noEmit`
clean. Plan of record: `docs/plans/2026-06-12-excel-roundtrip.md` (status ACTIVE)._

**The exported workbook is now a live, verified projection of the app.** Turn
duration (STEP 1 D28), square footage (D12), a utilization (col E), or a rate
(col H) in Excel and STEP 2/3 → STEP 4 recalculates to the engine's numbers —
proven by an in-repo formula evaluator, not by inspection.

## What Phases 1–3 shipped

- **`src/lib/step23FormulaPatterns.ts`** (P1) — typed per-line native/write
  classification for all 74 STEP 2/3 lines, keyed by col-C criterion code.
  `inputCellsFor(write)` is the shared contract: input cells are VALUES
  (written on export, read back on re-upload); everything else is computed and
  must never be read back. 8 engine↔template divergences signed off
  (dispositions A–D in the plan's findings table); pinned to the committed
  template by `step23-formula-patterns-sync.test.ts`. Probe:
  `node scripts/probe-step23-formulas.cjs [workbook]`.
- **Live export** (P2, `exporter.ts`) — pattern-driven STEP 2/3 writes;
  section-subtotal SUMs stay native (cache refreshed via
  `setCachedFormulaValue`); STEP 4 linked rows 12–24 carry the native pull
  formulas again (`'STEP 2 - GCs'!I58` …) cached at engine totals; STEP 1 D28
  = engine `durationMonths` VALUE (the duration dial; YEARFRAC replaced —
  it was already broken by D10/D11-as-text). Frozen by design: BLI sheet,
  %-lines (01-0610.001/01-1600.001, F=pct H=basis), override-active summary.
- **`src/lib/formulaEvaluator.ts`** (P3) — pure scoped evaluator
  (`loadWorkbookModel` → `FormulaEvaluator`; `setInputValue` simulates Excel
  typing). Loud `UnsupportedFormulaError` outside the grammar.
  `golden-roundtrip-recalc.test.ts` is the CI proof incl. the DIAL-TURN test;
  `golden-roundtrip-calibration.test.ts` (local-only, skipIf) validates the
  evaluator against CARE/McKenna Excel-cached results — **not yet run against
  the real fixtures: run it on the architect machine before trusting a real
  export in anger.**
- **Permit phantom closed** (P3 discovery, architect-approved): template STEP 4
  row 327 (`01-0230.001` Building Permit, PERMITS block inside the Div-80
  rows) natively pulls `H='STEP 1'!F48` (a STEP 1 permit-fee calculator the
  app doesn't model) — today's exports silently gained a phantom fee on
  recalc. Grid permit rows (01-0230/0250/0260.001) now write onto their native
  rows 327–329 as values (never Div-01 overflow); unpriced homes neutralize
  to 0/0 (`PERMIT_HOME_CODES` in exporter.ts).

## Non-obvious discoveries (Phase 4 will care)

- **ExcelJS omits `result` for a cached 0** — tests compare `result ?? 0`.
- **Su-utilization is ONE dial in the app, THREE cells in Excel** (E13 staff +
  E36 Small Tools + E37 Fuel — the template's own native design). The dial
  extractor should read suUtilization from the STAFF line (01-0420.001 E) and
  the preview should FLAG when E36/E37 disagree with E13.
- **Duration is derived in-exporter** via `getMonthsBetween(expectedStart,
  expectedFinish)` — same derivation as `useProjectWorkspace`. Test fixtures
  must keep project dates consistent with the engine's durationMonths
  (export-integrity fixtures now carry `2026-01 → 2026-11` = 10 months).
- **`computePersonnelCosts` must receive the real squareFootage** or the Fire
  Extinguishers cached qty disagrees with its live `J8/3000` formula (older
  zero-sqft fixtures hide this).
- **STEP 3's J8 routes via `'STEP 4 - ESTIMATE'!K8`** (→ STEP 1 D12); STEP 4
  J8 is unit count (D58), K8 is sqft.
- The evaluator needed AND/OR (template natives around the %-line area use
  `IF(AND(...))`) — grammar additions are calibrated by the local golden.

## Phase 4 scope (from the plan — read it first)

Export stamp (projectId, exportedAt, compact baseline snapshot in a custom
workbook part) + pure `src/lib/roundTrip.ts`: read stamp; extract STEP 4 lines
(reuse `templateExtractor`) + STEP 2/3 dials (via the pattern map's
`inputCellsFor` — input cells only); produce `RoundTripDelta` (row changes
matched by itemId, dial changes, project-field changes, conflicts vs the
embedded baseline). Typed errors for unstamped / wrong-project /
imported-project uploads. No DDL. Simulated-Excel-edit tests (XML mutation,
stale caches) per the plan's Phase 4 test list.

## Kickoff prompt

> Read `docs/plans/2026-06-12-excel-roundtrip.md` and
> `docs/handoffs/2026-06-12-excel-roundtrip-phase-4-kickoff.md`. Execute
> **Phase 4 only** (export stamp + round-trip extraction/delta engine, pure —
> no UI, no command, no DDL). Exit: `npm run test` green, `npx tsc --noEmit`
> clean, committed, handoff for Phase 5. Do not start Phase 5.
