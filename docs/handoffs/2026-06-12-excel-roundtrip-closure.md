# Excel Round-Trip — Closure (Phases 1–7)

_2026-06-12 · Phases 1–6 SHIPPED + Phase 7 code-review pass complete on
`claude/excel-roundtrip-export-wfezu4` (PR #3). Suite 774 pass / 70 files,
`npx tsc --noEmit` clean, eslint clean on all touched files. The 7-angle
/code-review (line-by-line, removed-behavior, cross-file, reuse,
simplification, efficiency, altitude) surfaced ~35 candidates; 12 confirmed
findings fixed in `09b38ed` — including three shipped correctness bugs
(multi-field project edits lost to a stale closure; blank-itemId rows
deletable by an untouched re-upload; YYYY-MM dates blanking the Expected
Finish input)._

## ⛔ Remaining before SHIPPED — architect-machine items (cannot run remotely)

1. **Calibration golden** (validates the evaluator against genuine Excel):
   `npx vitest run src/__tests__/golden-roundtrip-calibration.test.ts`
2. **Manual end-to-end in real Excel** (Phase 7 §scope): export a real
   project → confirm the stamp survives an Excel open→edit→save cycle
   (customXml part — empirically expected, never proven against a real
   save) → turn duration/sqft/utilization dials → watch STEP 2/3/4 recalc →
   re-upload → preview → confirm → Ctrl+Z → versions panel shows
   "Pre-upload baseline" + "Excel re-upload — <file>".
3. **`npm run build`** locally (remote sandbox lacks Supabase env at
   prerender — pre-existing).
4. Flip the plan status to SHIPPED after 1–3 pass.

## Review findings deliberately DEFERRED (documented decisions, not misses)

- **xlsx XML parsing trio**: exporter.ts, formulaEvaluator.ts, and the probe
  script each own shared-string/shift/col-index parsing. Consolidation into
  one `xlsxXml` module is sequenced naturally with import roadmap item 2
  (which will touch all three). The shift implementations differ in scope
  (rows-only vs rows+cols) — unify carefully.
- **Permit pass generality**: PERMIT_HOME_CODES is a 3-code special case for
  the template's cross-division PERMITS block. The general fix (sheet-global
  code→row map so ANY cross-division row writes in place) is a Phase-sized
  exporter refactor; loud guards now cover the failure modes (dollars with
  no home row throw; duplicates overflow-insert).
- **Division attribution**: permit dollars now appear in the Division-80
  block's header subtotal (their native PERMITS home) instead of Division
  01's. Grand total/BLI unaffected. This follows from the approved
  disposition; revisit only if estimators compare per-division headers.
- **Su tri-cell binding** is expressed in three modules (exporter write,
  extraction issue, planner fall-through). A `dialSourceFor()` on the
  pattern module would make it structural — bundle with item 2.
- **Evaluator MIN/MAX/ROUND/ABS** are kept for real-bid calibration coverage
  but are untested in CI; the calibration golden is their validation.
- **`getEstimateVersions` full-list fetch** on confirm could become a
  limit-1 db variant (touches db.ts — invoke the database-guardrails skill).
- **workbookMutation test helper** pins physical sheetN.xml ordinals; if the
  template's sheet order ever changes, update STEP*_FILE there (the sync
  tests will scream first).

## Where everything lives (for item 2 and future maintenance)

- Write grammar + sign-offs + subtotal coordinates: `src/lib/step23FormulaPatterns.ts`
- Stamp read/write + RoundTripState + comparable-code predicate: `src/lib/roundTripStamp.ts`
- Extraction + three-way delta: `src/lib/roundTrip.ts`
- Apply planner + row appliers + duration reverse-map + version-capture
  checks: `src/lib/applyRoundTrip.ts`
- Evaluator + workbook model loader: `src/lib/formulaEvaluator.ts`
- Confirm flow: `src/hooks/useRoundTripUpload.ts`; modal:
  `src/components/workspace/RoundTripUploadModal.tsx`
- Probe: `node scripts/probe-step23-formulas.cjs [workbook]`
