# CLOSED — STEP 2/3 Review Gate at Import (roadmap item 1, all 3 phases)

_2026-06-10 · plan of record: `docs/plans/import-step23-review-gate.md` · commits
P1 `e8aa586` · P2 `3c647e7` · P3 `6235a35` (all on LOCAL main — **not pushed**;
pushing remains the architect's call)._

## What shipped (the whole feature, end to end)

When an estimator imports a past bid on `/projects/import`, the GC/Site-Ops
(STEP 2/3) lines now get the same audit treatment STEP 4 lines already had:

- **See** — a collapsible ADVISORY "GC/Site-Ops (STEP 2/3) review" section
  (auto-open while unmapped lines remain; toggle pins it) lists every captured
  dollar line grouped STEP 2 / STEP 3, with the code it will resolve to
  (violet "→ 01-0410.001") or amber "unmapped" — the workspace panel's idiom.
- **Correct** — editable UOM cells (shared `UomBox`: draft commits on
  blur/Enter, Escape cancels, violet corrected-state, original in the tooltip;
  clearing restores the bid's value). Corrections REPLACE the stored unit.
- **Assign** — unmapped lines get a dropdown (custom codes first, then the
  ~120 built-in defs); an assignment writes the ADDITIVE `assignedCode` (the
  as-bid code is never rewritten) and shows a Clear escape hatch.
- **Create** — a "New code" mini-form mints a custom def via
  `createCustomStep23LineDef` and assigns it in one step. Code pre-filled by
  `suggestNextStep23Code` (next free `.NNN` for the base — max+1, gaps never
  filled), name defaults to the line's description (the auto-resolution key),
  unit defaults to the line's EFFECTIVE unit (a UOM correction wins), optional
  Procore BLI picker over `PROCORE_VALID_CODES`. Minted codes label matching
  lines in every stored bid retroactively (resolver overlay, Phase 2).
- **Save wiring** — corrections live in sheet-scoped state maps
  (`step23LineKey`) over the immutable parsed payload; `handleSave` applies
  them via `applyStep23Corrections` immediately before the single
  `saveImportedStep23Lines` write. Only `uom`/`assignedCode` can change;
  dollars are untouched BY CONSTRUCTION; the stored column stays write-once.
  Save is NEVER gated on the review.
- **Counts** — parsed summary gains STEP 2/3 resolved / unmapped / corrected
  via the pure `step23ReviewStats` (corrected = reference identity vs the
  originals; that clone-only-when-changed contract is now documented on
  `applyStep23Corrections` itself).
- **Fixture** — the synthetic legacy bid carries one unmappable STEP 3 line
  (shared base `02-4100`, "Demolition - Openings in CMU" — the CARE case),
  exposed as `LEGACY_PAST_BID_ORACLE.unmappableStep23`.

## Exit-gate evidence (Phase 3 session, 2026-06-10)

- Suite **540 pass / 52 files** (baseline 533/52; +7 new tests); goldens
  McKenna + synthetic + CARE tie $0.00; `npx tsc --noEmit` clean;
  `npm run build` clean.
- `/code-review` (7 finder angles + verification): two findings fixed before
  commit — the mint form's default unit now honors a prior UOM correction, and
  the stats reference-identity contract is documented at its source. Everything
  else refuted from code or accepted by the plan (per-row ~120-option select is
  the plan's stated risk with a named fallback).
- No DDL anywhere in Phase 3; all DB access through `src/lib/db.ts`.

## Carried-forward notes (small, non-blocking)

- The fail-soft `getCustomStep23LineDefs` loading effect is now duplicated in
  THREE consumers (`ImportedStep23Panel`, `/rates`, the import page) — a shared
  `useCustomStep23Defs()` hook is a natural **housekeeping (roadmap item 3)**
  candidate, as is the thrice-defined `money` formatter.
- Custom-code rate history stays report-only (no rate_card row → no ADOPT);
  giving minted codes a card rate, editing/retiring them, and Procore-BLI
  backfill belong to the **Catalog Manager (roadmap item 4)**.
- The accepted single-company INSERT-policy exposure on
  `custom_step23_line_defs` keeps the standing "move writes server-side"
  follow-up (same note as cost_code_map/rate_card).
- Lines needing a manual assignment on an ALREADY-SAVED import still require
  re-import — post-import assignment was explicitly deferred by the plan.

## Next session

Roadmap item 1 is closed. Items 2–5 (past-vs-active distinction · housekeeping
· Catalog Manager · fork-a-past-bid) are deliberately untouched — the architect
picks the next item; start that session with `/plan-phases` for the chosen item
(no kickoff prompt exists yet by design). Backlog imports remain unblocked and
now benefit from the gate: estimators can fix units and assign/mint codes at
import time, and every mint improves all past and future imports at render time.
