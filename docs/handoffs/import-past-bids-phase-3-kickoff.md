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
- **Re-import CARE once** (its first save predates STEP 2/3 capture) — may already be done.
- Backlog imports continue in parallel (each one feeds this phase's data).
- Master-template follow-up: add the 6 manual catalog codes as template STEP 4 rows, then
  `npm run sync-codes` (drift guard: catalogManualAdditions.test.ts).
- Push main to origin (≈24 commits ahead) when the architect approves.

Stop at green + committed + handoff (update `[[import-past-bids-plan]]` + this doc's status).
Do NOT chain into archive-&-comparison, the catalog manager, or the Permits section
([[permits-section-feature]]) — separate sessions.
