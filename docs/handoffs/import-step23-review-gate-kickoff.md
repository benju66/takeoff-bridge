# Kickoff — STEP 2/3 Review Gate at Import (Import-module roadmap item 1)

> Paste this as the first message of a fresh session. Workflow per
> [[feedback-one-phase-per-fresh-session]]: evidence probe → local plan → lock forks with the
> architect (AskUserQuestion, one option "(Recommended)") → build in slices → end
> green-committed + handoff. Do NOT chain into roadmap items 2–5 (see "Roadmap context").

## Precondition — VERIFY FIRST
Branch `import-past-bids-slice-3` (Slice 3 + roadmap docs, ends at or after `3ef7e08`) must be
MERGED to main. Check main has `src/lib/step23Normalization.ts` and the roadmap section in
`docs/handoffs/import-past-bids-step23-normalization-kickoff.md`. If unmerged, STOP and ask
the architect (last time they chose fast-forward-merge-then-build; do not assume).

## The problem (architect-confirmed expectation gap, 2026-06-10)
STEP 4 lines get a full review gate at import: every line visible, mapping suggestions,
accept/change per code, editable UOM, leftovers → Flags. **STEP 2/3 (GC/Site-Ops) lines get
NONE of that** — they are captured verbatim and silently into
`project_estimates.imported_step23_lines`; the estimator's first sight is post-save on the
workspace panels. Users expect the same audit at import. What's missing, concretely:
1. **Preview** the captured STEP 2/3 lines (code, description, qty, UOM, rate, total) with
   the resolved deterministic code (Slice 3A resolver) shown pre-save.
2. **Correct a wrong as-bid UOM before it enters the project + the rate history** (STEP 4
   got exactly this — review-table UOM cell, commit `193d606`).
3. **Manually assign a code to an unmapped line** (e.g. CARE's hand-inserted "Demolition -
   Openings in CMU" — today it stays unmapped forever; there is no way to say "that's
   Demolition"). NOTE: requires deciding WHERE an assignment lives — the JSONB payload is
   write-once at import, so an at-import assignment can be applied to the payload BEFORE the
   single `saveImportedStep23Lines` write (no schema change); post-import assignment is a
   different feature (do not chain into it without the architect).

## Read first, in order
1. `docs/handoffs/import-past-bids-step23-normalization-kickoff.md` — Slice 3 BUILD STATUS +
   the ARCHITECT-ORDERED ROADMAP section (this session = item 1; items 2–5 are out of scope,
   especially item 2 past-vs-active and item 5 fork-a-past-bid).
2. `docs/plans/import-past-bids-phase-3-slice-3.md` — the resolver design + locked forks
   (F-A app-defs-only, F-B mining filter) this gate must stay consistent with.
3. `memory/MEMORY.md` → `[[import-past-bids-plan]]` — full state. The architect may have
   begun backlog imports — bids imported BEFORE this gate lands were captured verbatim and
   are fine; this feature works on future imports (re-import remains the recovery path for
   a wrong UOM that already landed).
4. `CLAUDE.md` + `AGENTS.md` — guardrails. Critical: normalization/labeling never moves a
   dollar; the STEP 2/3 dollars ride the linked STEP 4 rows; `imported_step23_lines` is
   written ONCE by the import flow (`saveImportedStep23Lines`) and the workspace must keep
   treating it as read-only.

## Building blocks that already exist (reuse, don't reinvent)
- `src/lib/step23Normalization.ts` — `resolveStep23Line(code, description)` for the
  pre-save match preview; `STEP23_LINE_DEFS` is the assignable-code list for the manual
  assign dropdown (GC/Site-Ops lines only — NOT the STEP 4 catalog).
- `src/lib/importEstimate.ts` — `step23LinesForImport(extracted)` builds the payload the
  gate would preview/amend; `applyAcceptedMappings(originals, accepted, uomOverrides?)` is
  the PATTERN for layering corrections over immutable parsed rows (originals untouched,
  corrections win, dollars can't move) — mirror it for STEP 2/3, don't extend it blindly
  (it is typed for ProcessedTakeoffRow, not sheet lines).
- `/projects/import` page (`src/app/projects/import/page.tsx`) — the STEP 4 review table,
  editable UOM cell w/ violet corrected-state + tooltip original, parsed summary, tie-out
  banner; the STEP 2/3 section slots into this page.
- `ImportedStep23Panel` — the post-save rendering of the same data (keep display
  consistent: violet "→ code", amber "unmapped").
- Synthetic legacy fixture (`src/__tests__/fixtures/syntheticTemplate.ts`,
  `LEGACY_STEP2_DETAIL`/`LEGACY_STEP3_DETAIL` + `LEGACY_PAST_BID_ORACLE.step2Detail`) and the
  local-only CARE fixture (`fixtures/past-bids/`) — extend, don't reshape (CARE golden).

## Candidate forks to sharpen with the architect (draft, re-derive from evidence)
- Does a manual code assignment at import RESOLVE the line in the stored payload (e.g. an
  additive `assignedCode` field on `ImportedSheetLine` — old payloads degrade fine) or
  rewrite `code` itself? (Recommend additive field: preserves the verbatim as-bid code,
  same philosophy as everything else in this module.)
- Do assigned lines feed the /rates mining (step23Observations) — i.e. does an assignment
  count as resolution? (Probably yes; that is the point.)
- Is the STEP 2/3 review REQUIRED (blocks save) or advisory (collapsible section, save
  allowed)? (Recommend advisory: dollars don't ride these lines; the tie-out gate already
  guards the money.)

## Gates
Suite green per commit (505 pass / 51 files at handoff); goldens McKenna + synthetic + CARE
tie $0.00; `imported_step23_lines` payload changes ADDITIVE-ONLY (old payloads degrade);
training tables append-only; `import type` discipline (ExcelJS out of pure/page graphs);
`npx tsc --noEmit` + `npm run build` clean; `/code-review` before delivery; multi-line
commits via a message FILE + `git commit -F` (NEVER inline >965 bytes — architect-enforced);
NO push to origin without the architect's say-so.

## Roadmap context (architect-ordered 2026-06-10 — do not chain)
1. THIS SESSION. 2. Past-vs-ACTIVE import distinction (users may import current estimates
to keep working; reshapes export-of-imports). 3. Housekeeping (6 manual codes → master
template + sync-codes; lump mining later; push on say-so). 4. Catalog Manager (in-app ADD
cost code + pick its Procore BLI). 5. Fork-a-past-bid as a new active project ("re-drive"
is dropped; past bids are never edited).

Stop at green + committed + handoff (update `[[import-past-bids-plan]]` + this doc's status).
