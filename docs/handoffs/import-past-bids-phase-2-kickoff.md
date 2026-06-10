# Kickoff — Import Past Bids, Phase 2 (Archive & Comparison)

> Paste this as the first message of a fresh session to BUILD Phase 2 of the import-past-bids feature.
> Phase 1 (editable import + tie-out gate) is DONE and on `main`. One phase per cold session
> ([[feedback-one-phase-per-fresh-session]]): end green-committed with a handoff note; do NOT chain
> into Phase 3.

## Read first, in order
1. `docs/plans/import-past-bids.md` — the canonical plan. **Phase 2 = "Archive & comparison"**
   (section after Phase 1). This is the source of truth for intent.
2. `memory/MEMORY.md` → `[[import-past-bids-plan]]` (Phase 1 SHIPPED status + carry-forward) and
   `[[estimate-versions-feature]]` (the already-planned Estimate Versions & Comparison feature this
   phase leans on — dated snapshots + inline Δ-vs-baseline column = the Excel STEP 4 M/N twin +
   version matrix; read its linked plan file if present).
3. `CLAUDE.md` + `AGENTS.md` — guardrails. Especially: **`estimate_snapshots` is append-only**
   (never UPDATE/DELETE — Training Data Immutability), writes are **fire-and-forget** (`.catch(()=>{})`),
   all DB access via `src/lib/db.ts`, and `calculations.ts` (`computeTakeoffSummary`) is the SOLE
   financial authority — comparison only re-reads/re-derives, never invents totals.

## Branch
`git checkout main && git pull && git checkout -b import-past-bids-phase-2`.
First VERIFY main has Phase 1: `src/lib/importEstimate.ts`, `src/lib/cascade.ts`, `projects.is_imported`,
`/projects/import`. Do NOT branch from the old `import-past-bids-phase-1` branch.

## What already exists (reuse — do NOT rebuild)
- **`estimate_snapshots` table** — built, append-only, indexed `(project_id, snapshot_at DESC)`. No
  migration expected this phase.
- **db.ts snapshot plumbing**: `createEstimateSnapshot(projectId, lineItems, type, label?, summary?, meta?)`,
  `getEstimateSnapshots(projectId)` (lightweight list: id/at/type/label/itemCount), and
  `getSnapshotDetail(snapshotId)` (full `lineItems` + stored `summary`).
- **Phase 1 already writes a snapshot on import save** — type `'milestone'`, label `Imported from <file>`,
  summary `{subtotal, totalEstimatedCost}`. So every imported bid is already archived.
- **Pure engine**: `computeTakeoffSummary` + `computeDivisionBreakdown` / `computeCostTypeBreakdown`
  (for any Δ rollups). Synthetic fixtures in `src/__tests__/fixtures/syntheticTemplate.ts`
  (`buildSyntheticTemplateBuffer`, `buildPastBidTemplateBuffer`) for CI-safe tests.

## Phase 2 intent (from the plan)
Imported bids become **baselines**: a **searchable archive** of past bids and a **side-by-side
Δ-vs-baseline comparison**. UI-leaning; minimal/no schema work.

## Decisions to LOCK with the architect BEFORE building
The architect is a non-developer; per `[[feedback-clarify-fuzzy-forks]]` discuss to sharpen, then use
`AskUserQuestion` with a **(Recommended)** option (`[[feedback-recommend-option]]`). The real forks:
1. **Scope boundary** — build the thin *import-comparison* slice (browse archived bids + compare two),
   OR stand up the broader `[[estimate-versions-feature]]` (per-project version timeline + Δ column)
   now. They overlap; pick the smaller shippable slice unless the architect wants the full feature.
2. **Comparison axis** — compare a bid against (a) **another project/import** (cross-project "reuse a
   past bid as a baseline" — matches the import use-case), or (b) **snapshots within one project's
   timeline** (Excel version-column idiom), or both.
3. **Where it lives** — a dedicated `/projects/compare` (or `/projects/archive`) page vs. an inline
   Δ-vs-baseline column in the workspace.
4. **Stored vs recomputed** — show each side's STORED snapshot `summary`, or RECOMPUTE via
   `computeTakeoffSummary` from the snapshot's `lineItems` on load (authority-faithful; handles older
   snapshots with empty summary). Lean: recompute (single authority), fall back to stored.

## Constraints / gates
- **No new schema migration expected** (reuses `estimate_snapshots`). If one becomes necessary, PAUSE
  for architect approval + invoke the `supabase:supabase` skill and update `supabase_schema.sql` first.
- `estimate_snapshots` stays **append-only + fire-and-forget**. Comparison is **read-only**.
- `npm run test` green before every commit; `/code-review` before delivery. **Golden McKenna AND the
  synthetic golden must keep tying $0.00.**
- Keep ExcelJS OUT of any page that only needs pure helpers — use `import type` for type-only imports
  (the Phase-1 Turbopack-worker lesson, fix `75a36df`).

## Tests (mirror the B-1 / Phase-1 pattern — pure logic in node, no DOM)
- A **pure comparison/diff function** (e.g. `compareEstimates(baseline, candidate)` → per-total,
  per-division, per-code Δ + % ) unit-tested against two synthetic snapshots built from
  `buildSyntheticTemplateBuffer` / `buildPastBidTemplateBuffer` — assert the deltas are exact and that
  identical inputs yield all-zero deltas.
- If recompute-from-snapshot is chosen, assert a recomputed snapshot summary still ties its stored
  oracle to the cent.

## Phase-1 carry-forward (context, not Phase-2 scope unless the architect pulls it in)
1. Export/reconciliation chip for imported projects still reads the zero parametric GC/Site-Ops
   calculators (import tie-out gate is correct; export-of-imports is later).
2. Partial-save orphan project on `saveEstimate` failure.
3. Imported linked rows are read-only ("re-drive" GC/Site-Ops deferred).

Stop at green + committed + a handoff note (update `[[import-past-bids-plan]]` + this kickoff's status).
Do NOT chain into Phase 3 (pricing/learning harvest).

---

# BUILD STATUS — Phase 2 COMPLETE (2026-06-09, branch `import-past-bids-phase-2`)

## The re-scope (architect, 2026-06-09)
The architect redirected this phase before build: **no comparison work** — "we need to focus on
importing past project estimates so we have something to compare." A probe of a REAL legacy bid
(`fixtures/past-bids/2026.04.03 CARE Schematic Design Estimate.LIVE.xlsx`, gitignored) reshaped the
phase into **Legacy-Bid Import & Code Normalization**:

1. Real pre-app bids use **bare base codes** (`09-9000`, no suffix) — 275 codes, 142 dollar lines,
   zero conforming. Phase 1 preserved the dollars but dropped the codes and flagged everything.
2. The grand total missed by exactly **$2,380,850.00** = three hand-typed **lump-sum modifier rows**
   (Construction Contingency $618,103, "Owner's Rep" $309,051, "Professional Service Fees" $1,453,696).
3. **The workbook maps itself**: its Budget Line Items sheet links each Procore code to a STEP 4 bare
   code via SUMIF criteria, and those Procore codes are byte-identical to today's valid-code list.

**Architect-locked:** lumps → audited `estimate_overrides` records (append-only, original label +
file + row in the reason — recurring items build a queryable history for Phase 3); mapping
confirmation = review-at-import + finish later in Flags. Plan of record:
`~/.claude/plans/rustling-petting-ocean.md` (ultraplan-refined).

## What shipped (6 commits)
- `779c44f` s1 extractor: `rawCode` on ad-hoc lines; modifier scan matches by BASE code; `sheetLabel`
  + `isLump` (|I − F×subtotal| > tolerance) + `rowNumber`; `readCell` exported; legacy synthetic
  fixture `buildLegacyPastBidTemplateBuffer` + `LEGACY_PAST_BID_ORACLE`.
- `739bb11` s2 `src/lib/legacyBridge.ts` (BLI SUMIF → `Map<bareCode, procoreCode>`, never guesses) +
  pure tiers in importEstimate: **bridge** (unique reverse-map) > **linked** (GC/Site-Ops description)
  > **similar** (ambiguous family / fuzzy shortlist) > **none**; `applyImportMapping` (keeps
  qty/unitPrice/id/source).
- `a51b840` s3 `lumpOverridesFromExtract` + `overrideMapFromIntents` → rides computeTakeoffSummary's
  existing overrides arg. Tie proven before/after linked mappings + negative control.
- `0e4ba67` s4 `/projects/import` review UI: confidence chips, accept-all-high-confidence (bridge+
  linked only), candidate chips, validated free-entry (`validateAssignInput`); rows in React state;
  tie-out basis switched to `linkedTotalsFromRows(rows)` (load-bearing); save records lumps via
  AWAITED `recordEstimateOverride` + confirmed mappings via fire-and-forget
  `recordClassificationResolution`; "As-bid lump sums" card.
- `3721fac` s5 `golden-care.test.ts` (skipIf, local-only): CARE ties subtotal AND grand total to the
  cent, raw and after accept-all. **Real-file tally: 90 bridge + 9 linked + 43 shortlist + 0 none.**
- `f65d0a5` s6 /code-review findings: duplicate-linked-assignment guard (a linked itemId on two rows
  would drop dollars with no un-map path), `catalogCostCodeEntries()` dedup, regex hoist, test
  derives linked map from `LINKED_DIVISION_ROWS`.

Suite **453 pass / 0 todo (43 files)**; tsc + next build clean; golden McKenna + synthetic + CARE all
tie $0.00.

## Architect's manual e2e (recommended before merging to main)
1. `npm run dev` → `/projects/import` → upload the CARE file.
2. Expect: green banner "ties to the cent" (subtotal $13,487,288.90 / total $16,677,376.23), an
   "As-bid lump sums" card with the three lumps, and a mapping review table (99 one-click lines).
3. Click "Accept all high-confidence", confirm counts move and the banner stays green; save.
4. Reopen the project: totals tie; Trust Inspector shows the three overrides with legacy labels;
   leftover `similar` lines sit in the Flags worklist (B-4 assign works on them).

## Known limitations / carry-forward (not bugs)
- Phase-1 carry-forwards still open: export chip for imported projects reads zero parametric
  calculators; partial-save orphan on failure (now also possible between `saveEstimate` and the
  awaited override writes — the bid looks saved but a lump record failure surfaces an error and the
  project should be deleted/re-imported); imported linked rows read-only.
- A legacy lump row with NO cached number (never-calculated workbook) can't be classified → tie-out
  fails LOUD and save is blocked; fix is opening+saving the file in Excel once.
- `similar`-tier lines (43 on CARE) are deliberately NOT auto-accepted; they save flagged and are
  finished in Flags. Linked-tier matching is exact-description; drift falls back to `similar`.

## Next phase (run in a FRESH session)
**Phase 3 — pricing/learning harvest** (`docs/plans/import-past-bids.md`): mine imported line items
for historical unit prices (rate-card sharpening) and finally CONSUME `classification_history`
(every import now writes it richly) to rank suggestions for unmapped lines. Phase 2's confirmed-
mapping records + lump-override audit trail are its training data. Gate: likely needs a small schema
decision → architect approval + `supabase:supabase` skill first.
