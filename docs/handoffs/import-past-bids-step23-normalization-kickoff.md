# Kickoff — Import Past Bids, STEP 2/3 Normalization + Staff-Rate Mining (Phase 3 Slice 3)

> Paste this as the first message of a fresh session. This is the deferred Slice 3 of Phase 3
> (`docs/plans/import-past-bids-phase-3.md`) — the piece that FINALIZES the importer for now
> (architect, 2026-06-10). One phase per cold session: evidence probe → local plan → lock forks
> with the architect (AskUserQuestion, one option marked "(Recommended)") → build in slices →
> end green-committed + handoff. Do NOT chain into archive-&-comparison, the catalog manager,
> or the Permits section.

## Precondition — VERIFY FIRST
Branch `import-past-bids-phase-3` (8 commits, ends `2a88a01`) must be MERGED to main before
building. Check main has: `uomMismatch` in `src/lib/importEstimate.ts`, `uom` on
`ExtractedSheetLine` in `src/lib/templateExtractor.ts`, and `src/lib/priceHistory.ts`. If the
branch is unmerged, STOP and ask the architect.

## Read first, in order
1. `docs/plans/import-past-bids-phase-3.md` — Phase-3 plan of record; this slice is its
   "Out of scope / deferred" item #1.
2. `docs/handoffs/import-past-bids-phase-3-kickoff.md` → BUILD STATUS section — what shipped
   in Slices 0–2 (as-bid UOM capture incl. STEP 2/3, history tier, /rates price report +
   ADOPT pattern, the B-4 grid-assign fidelity fix, editable review-gate UOM).
3. `memory/MEMORY.md` → `[[import-past-bids-plan]]` — full state. NOTE: the architect WIPED
   `classification_history` (0 rows) and deleted all test projects on 2026-06-10; live counts
   at session start reflect whatever backlog has been imported since.
4. `CLAUDE.md` + `AGENTS.md` — guardrails. Critical here: **No AI Autonomy Over Financials**
   (mining REPORTS; humans adopt staff rates via the existing audited /rates path);
   `calculations.ts` sole financial authority; **the as-imported GC/Site-Ops dollars ride the
   linked STEP 4 rows and MUST NOT move** — normalization is labeling, never re-pricing.

## The problem this slice solves
Imported bids' STEP 2/3 lines are captured VERBATIM with legacy bare codes (`01-0410
Sr Superintendent`, qty + rate + uom) in `project_estimates.imported_step23_lines`, shown
read-only. They are NOT normalized to the app's deterministic codes (`01-0410.001`,
STAFF_ROLE_DEFAULTS / the GC + Site-Ops line defs in `src/lib/constants.ts` +
`rateCardEditor.ts` RATE_LINE_DEFS). Until normalized, the bids' staffing/site-ops history
can't be mined ("what did we carry for Sr Supers?") and can't later feed a granular GC
Procore rollup for export-of-imports (still out of scope here).

## Candidate scope (sharpen with the architect before building)
1. **Bare→deterministic mapping for GC/Site-Ops codes.** Mostly mechanical (~1:1 by base
   code). Two sources, in trust order: (a) extend `deriveLegacyBridge`
   (`src/lib/legacyBridge.ts`) to parse the legacy BLI's STEP-2 SUMIF criteria (the CARE
   probe counted ~73 — verify on the file) the same way it parses STEP 4; (b) a static
   base→deterministic table derived from the app's own GC/SO line defs. Never guess; an
   unmappable code stays bare and visible.
2. **Backfill over already-imported bids.** Raw codes are stored, so normalization can be a
   READ-TIME derivation (pure function over the stored lines — no migration, nothing
   persisted, every import past and future benefits) or a persisted backfill. Lean
   READ-TIME: zero schema work, zero write risk to the protected JSONB.
3. **Display**: ImportedStep23Panel shows the resolved deterministic code (+ name) alongside
   the as-bid bare code; unresolved lines clearly marked.
4. **Staff-rate mining**: per deterministic GC/SO line, as-bid rate history (count/median/
   range + project context) from `imported_step23_lines` (qty/rate/uom captured since
   Slice 0) surfaced on /rates next to the GC/Site-Ops card rates, with the SAME UOM-gated
   one-click ADOPT pattern as Slice 2 (`updateRateCardEntry`, confirm, MANUAL stamp).
   Mirror `priceHistory.ts` — likely a sibling pure module or a generalization of it.
5. (Probably out) granular GC rollup / export-of-imports unblocking; lump-override mining.

## Evidence-first prerequisite (probe before designing)
- The CARE fixture (`fixtures/past-bids/2026.04.03 CARE Schematic Design Estimate.LIVE.xlsx`,
  local-only) — parse its BLI STEP-2/3 SUMIFs: how many, do criteria point at STEP 2 AND
  STEP 3 rows, do the referenced Procore codes reverse-map cleanly?
- Compare CARE's bare STEP 2/3 codes against the app's GC/SO line defs: how 1:1 is the base
  match really (e.g. two `02-9010` Progress Cleaning lines — Payroll vs Hired — share a base)?
- Live tables: how many imported bids exist now; `imported_step23_lines` row shapes.

## Gates
- Suite green per commit (490 pass / 49 files at handoff; goldens McKenna + synthetic + CARE
  tie $0.00 — extractor/JSONB changes must keep them tying).
- `imported_step23_lines` payloads: additive-only if touched at all (old payloads degrade).
- Training tables append-only; `import type` discipline (ExcelJS out of pure/page graphs);
- `/code-review` before delivery; `git commit -F` for multi-line messages; NO push without
  the architect's say-so.

Stop at green + committed + handoff (update `[[import-past-bids-plan]]` + this doc's status).
