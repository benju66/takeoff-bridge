# Kickoff — Import Past Bids, Phase 3 (Pricing / Learning Harvest)

> Paste this as the first message of a fresh session to PLAN (then build) Phase 3.
> Phases 1+2 are DONE on `main` (P2 was re-scoped to legacy import & code normalization; the
> original "archive & comparison" remains deferred). One phase per cold session
> ([[feedback-one-phase-per-fresh-session]]): plan first (evidence-probe → local plan →
> ultraplan-refine → architect approval), build in slices, end green-committed + handoff.

## Read first, in order
1. `docs/plans/import-past-bids.md` — canonical plan; Phase 3 = "Pricing / learning harvest".
2. `memory/MEMORY.md` → `[[import-past-bids-plan]]` — full P1/P2 state incl. the **Phase-3 input**
   notes (STEP 2/3 normalization parked here; lump-override history; backlog items).
3. `docs/handoffs/import-past-bids-phase-2-kickoff.md` — P2 build status + the STEP 2/3
   truthfulness follow-up (what data each import now writes).
4. `CLAUDE.md` + `AGENTS.md` — guardrails. Critical here: **No AI Autonomy Over Financials** —
   mining REPORTS history; humans adopt rates/defaults through explicit action. `calculations.ts`
   stays the sole financial authority. Schema changes: file-first + architect approval +
   `supabase:supabase` skill (project `nefvkrhbbkiqnpeabyqz`).

## What Phase 3 consumes (all of this now exists and accumulates per import)
- `estimate_line_items` with `source='imported'` — **as-bid unit prices** kept verbatim, joined to
  `projects` context (bid_date, sqft, unit count, market_sector, `is_imported`).
- `classification_history` (append-only) — every code the estimator confirms in the import review
  table (`recordClassificationResolution(description, itemId, projectId, 'user')`). Recorded since
  P2; **read by nothing yet** — the consumer is this phase's centerpiece.
- `estimate_overrides` (append-only) — legacy lump-sum modifiers with original labels in `reason`
  ("Owner's Rep", "Professional Service Fees") — recurring-item history.
- `project_estimates.imported_step23_lines` (JSONB) — verbatim STEP 2/3 lines incl. **qty + rate**
  (e.g. `01-0410 Sr Superintendent`) — staff-rate history, NOT yet normalized to the deterministic
  staff codes (`01-0410.001`, STAFF_ROLE_DEFAULTS).
- `rate_card` — the 6 manual catalog additions sit at $0 awaiting history-informed defaults.

## SLICE 0 — MANDATORY FIRST, BEFORE ANY BACKLOG IMPORTING: as-bid UOM capture
Architect requirement (2026-06-10): the import must capture **UOM from column G** on
**STEP 2 - GCs, STEP 3 - SITE OPS, and STEP 4 - ESTIMATE** — critical to the pricing database
(as-bid price and as-bid UOM must travel together; the template family uses col G for UOM, same
column the harvest script reads). Today the importer NEVER reads col G: STEP 4 rows get the
CATALOG's targetUom stamped on mapped codes (`enrichOne` + `applyImportMapping` in
`importEstimate.ts`) — potentially MISLABELING an as-bid $/SF price as EA — and STEP 2/3 lines
(`extractSheetLines`, `ImportedSheetLine`) carry no UOM at all.

Build: read col G in `extractStep4` (→ `ExtractedLineItem.uom`) and `extractSheetLines`
(→ `ExtractedSheetLine.uom` + `ImportedSheetLine.uom` in types/db.ts — additive JSONB field, old
payloads degrade fine); imported rows KEEP the as-bid UOM (historical fidelity — same rule as
unitPrice; decide with the architect whether a bid-vs-catalog UOM mismatch gets a visible flag);
show UOM in the import review table + ImportedStep23Panel; extend the legacy fixture + CARE
golden (assert real UOMs survive). Goldens must stay $0.00 (UOM is non-financial; modern path
must stay byte-identical where it matters — check `toProcessedRows` consumers).

**Sequencing rule: land Slice 0, then the architect re-imports CARE ONCE (collects BOTH the
pending STEP 2/3 detail AND UOMs), and only then starts the backlog** — every bid imported
before Slice 0 would need re-importing.

## Candidate scope (architect locks the order/cut — discuss to sharpen, then AskUserQuestion w/ (Recommended))
1. **Learning consumer**: rank import-review suggestions from `classification_history` (a `history`
   tier in `suggestMapping`, between `bridge`/`linked` and `similar`; `getClassificationHistory`
   already aggregates by count). Makes every bid faster than the last — the felt payoff.
2. **Price mining**: per-code as-bid price history (median/range by sector/size/date) surfaced
   where estimators price (e.g. /rates and/or the grid) — report-only, one-click ADOPT writes the
   rate card via the existing admin path. Never auto-applies.
3. **STEP 2/3 normalization + staff-rate mining**: extend `deriveLegacyBridge` to parse the legacy
   BLI's 73 STEP-2 SUMIF criteria; map bare GC/SO codes (≈1:1 by base) to deterministic codes;
   backfillable over already-imported bids (raw codes stored). Unlocks "what did we carry for Sr
   Supers" + future export-of-imports granular rollup.
4. (Possibly out of scope) lump-override mining; catalog-manager interleave.

## Evidence-first prerequisite (the probe step)
- **How many bids are imported when the session starts?** If only CARE, say so to the architect:
  the consumer (1) can be built and proven against synthetic + CARE data now, but price mining (2)
  is statistically thin until ~10-20 bids — recommend sequencing accordingly rather than guessing.
- Probe the LIVE tables (supabase skill, read-only) for actual row counts/shapes before designing;
  probe CARE's `imported_step23_lines` for the staff-rate mining shape.

## Constraints / gates
- Likely schema work (e.g. price-history views or aggregates) → architect approval BEFORE DDL;
  update `supabase_schema.sql` first; advisors after.
- Training tables stay append-only; reads must not block workflows.
- Suite green per commit (465 pass / 46 files at handoff); goldens McKenna + synthetic + CARE keep
  tying $0.00; `import type` discipline (ExcelJS stays out of pure/page graphs).
- `/code-review` before delivery; `git commit -F` for multi-line messages; do NOT push without the
  architect's say-so.

## Open architect actions carried in (not Phase-3 scope)
- **Re-import CARE once — AFTER Slice 0 lands** (its first save predates both STEP 2/3 capture
  and UOM capture; one re-import collects both).
- Backlog imports continue in parallel **only after Slice 0** (see sequencing rule above).
- Master-template follow-up: add the 6 manual catalog codes as template STEP 4 rows, then
  `npm run sync-codes` (drift guard: catalogManualAdditions.test.ts).
- Push main to origin (≈24 commits ahead) when the architect approves.

Stop at green + committed + handoff (update `[[import-past-bids-plan]]` + this doc's status).
Do NOT chain into archive-&-comparison, the catalog manager, or the Permits section
([[permits-section-feature]]) — separate sessions.

---

# BUILD STATUS — Phase 3 COMPLETE (2026-06-10, branch `import-past-bids-phase-3`, NOT merged)

Plan of record: `docs/plans/import-past-bids-phase-3.md` (architect skipped ultraplan —
evidence-grounded, no schema work; all four forks locked: F1 catalog-fallback for blank UOM
[moot — the 7 blanks are the 60-xxxx modifier rows, never line items], F2 subtle display-only
mismatch indicator, F3 history NOT in accept-all, F4 price history on /rates). **No DDL anywhere.**

## Probe corrections to this kickoff (live, 2026-06-10)
- **TWO bids already imported**, not one: CARE Relocation (142 lines, STEP 2/3 detail captured)
  AND McKenna Crossing Terrace II (114 lines, 1 lump override). 398 classification_history rows
  (all user), 4 estimate_overrides, 256 imported line items.
- CARE col-G probe: STEP 2 35/35, STEP 3 42/42, STEP 4 268/275 rows carry a UOM (lowercase
  `ls`/`hr`/`mo`…); the 7 blanks = the soft-cost modifier rows. Catalog is uppercase →
  extraction uppercases.

## What shipped (4 commits)
- `5d7fd20` **Slice 0 — as-bid UOM capture**: `ExtractedLineItem.uom`+`ExtractedSheetLine.uom`
  (col G, uppercased; `toProcessedRows` untouched → goldens byte-identical); enrich + mapping:
  as-bid UOM WINS, catalog fills blanks only; `uomMismatch()` + amber indicator in the review
  table + mismatch count in parsed summary; `ImportedSheetLine.uom?` rides the JSONB (old
  payloads → "—"); UOM column in review table + ImportedStep23Panel; fixtures write col G
  lowercase; CARE golden asserts real UOMs (01-0000 LS, Sr Superintendent HR) survive accept-all.
- `d5f3ae0` **Slice 1 — history suggestion tier**: `getClassificationHistoryBulk` (one chunked
  `.in()`, 100/chunk); tier order **bridge > linked > history > similar > none**; exact-
  description match; stale codes skipped (catalogued-or-linked check); violet "Seen in N past
  bids" chip + one-click accept + runner-ups; fail-soft (outage ⇒ pre-history behavior, proven
  identical by test); F3: excluded from accept-all.
- `1449902` **Slice 2 — price mining on /rates**: pure `priceHistory.ts` aggregates per
  **(itemId, uom)** (count/median/min/max + observations newest-first — the reason Slice 0 went
  first); `getImportedPriceHistory()` (imported line items ⋈ projects context); violet history
  line under each catalog rate + per-project tooltip; **ADOPT** (confirm → existing audited
  `updateRateCardEntry`, stamped MANUAL, future projects only) renders ONLY when the bids' UOM
  matches the line's catalog unit. Report-only; loads fail-soft.
- `3499b73` **/code-review finding (real bug, pre-existing)**: the grid itemId path (which B-4
  Flags assign uses — the recommended way to finish leftover similar rows) re-derived everything
  from the catalog on imported rows: rawQuantities=[] → **qty zeroed → dollars dropped**, plus
  catalog price/description/UOM stamped. Fixed: imported rows route through `applyImportMapping`
  (the import-review chokepoint — grid and review can never disagree); unknown-code edits unmap
  without the CSV reset; `needsReview` added to ITEM_ID_CASCADE_CAPTURE_FIELDS (undo restores
  the flag); round-trip test.

Resting state: **suite 489 pass / 49 files**, goldens McKenna + synthetic + CARE tie $0.00,
tsc + next build clean. Branch NOT merged to main; nothing pushed.

## Architect e2e (recommended before merging)
1. `npm run dev` → `/projects/import` → upload CARE. Expect: UOM column in the review table
   (HR/LS/MO…), violet "Seen in N past bids" chips on previously-confirmed lines (398 rows of
   history exist), accept-all still bridge+linked only, banner green, save.
2. Delete the OLD CARE + McKenna projects and re-import both ONCE (collects as-bid UOMs; CARE's
   STEP 2/3 detail now shows a UOM column on the GC/Site-Ops pages).
3. `/rates` → catalog rows that appeared in the imports show "N bids (UOM) · med $X" with
   per-project tooltip; ADOPT only where the unit matches; adopting updates the rate (MANUAL).
4. Flags: assign a leftover similar row a code — its dollars/description/UOM must NOT change;
   Ctrl+Z restores the flag.
5. Then: **backlog importing begins** (every import now feeds UOMs, the history tier, and the
   price report).

## Carried forward (not Phase-3 scope)
- Slice 3 — STEP 2/3 normalization + staff-rate mining (own session; raw codes stored, backfillable).
- Master-template follow-up: 6 manual catalog codes → template STEP 4 rows + `npm run sync-codes`.
- Push main to origin when the architect says so. Archive & comparison; catalog manager; Permits.
- Pre-Slice-0 saved imported rows carry catalog-stamped UOMs until re-imported (step 2 above).
