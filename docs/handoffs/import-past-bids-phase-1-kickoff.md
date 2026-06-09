# Kickoff — Import Past Bids, Phase 1 (Editable import)

> Paste this as the first message of a fresh session to BUILD Phase 1 of the import-past-bids feature.
> The direction is architect-approved (2026-06-09). This session writes code. Stop at a sensible
> green + committed + handoff point — do NOT chain into Phase 2/3.

## Read first, in order
1. `docs/plans/import-past-bids.md` — the full plan (Context, locked decisions, Phase 1 detail,
   same-code/scope handling, ad-hoc-code handling, risks, verification). **This is the source of truth.**
2. `CLAUDE.md` + `AGENTS.md` — guardrails (single DB gateway `src/lib/db.ts`; line items only via the
   `save_estimate` RPC; `source` provenance on every row; `classification_history`/`estimate_snapshots`
   append-only fire-and-forget; `getDivisionCode()` for division placement; `calculations.ts` is the
   sole financial authority — import only READS the sheet's numbers and re-derives via the engine).
3. `memory/MEMORY.md` → `[[import-past-bids-plan]]` and `[[math-trust-plan]]` (the B-1 synthetic-golden
   pattern you will extend for the import tie-out test).

## Branch
Cut a new branch from `main`: `git checkout main && git pull && git checkout -b import-past-bids-phase-1`.
(Main already has Phase 5 + the B-1 synthetic golden + this plan.) Do NOT branch from an old branch.

## Phase 1 scope (build exactly this)
Flow: **Upload → Extract → Enrich → Tie-out gate → Save as project.**
1. **Upload + extract** — a new "Import past estimate" entry on the projects dashboard
   (`src/app/projects/page.tsx`) opening a dedicated import preview (reuse the `ImportPreviewModal`
   idiom — NOT the takeoff CSV parser). Read via `loadTemplateWorkbook` → `extractEstimate`.
2. **Map inputs → Project** — name/sqft/units/dates/7 rates from `extracted.inputs`; persist via
   `saveProject`.
3. **Enrich line items** — start from `toProcessedRows(extracted.lineItems)`, then:
   - `procoreCode = resolveProcoreCode(itemId)` (prime the resolver first, as `useTakeoffWorkbook` does);
     `costType`/`uom` from `ESTIMATE_ITEMS_MASTER` when catalogued.
   - **KEEP the imported `unitPrice`** (historical fidelity — resolve the code, never overwrite the price).
   - **Unique row IDs** for same-code lines (e.g. `import-${itemId}-r${rowNumber}`; the bare
     `import-${itemId}` collides — `mergeTakeoff.ts:138`).
   - **Cascade-independence** — imported rows must not auto-overwrite each other via the
     classification cascade (`useCellEditing.ts` keys it on `classification`). Make imported rows
     cascade-independent. **SURGICAL:** preserve the takeoff-CSV cascade; only stop independently-authored
     rows from cross-linking. Add focused undo tests.
4. **GC/Site-Ops linked values** — import the 10 linked values as STATIC figures
   (`linkedTotalsFromExtract`) so `computeTakeoffSummary` counts them and the total ties (finding G-2:
   can't reconstruct parametric drivers). **Design point to settle this session:** where the static
   linked values persist so a reloaded import still ties (lean: persist on the estimate + feed as
   `linkedTotals`). Flag those sections "review to re-drive."
5. **Tie-out acceptance gate** — before save, run `computeTakeoffSummary` and show
   "Imported total ties your original to the cent ✓" using `RECONCILIATION_TOLERANCE` and
   `extracted.oracle` totals. Don't save silently on a mismatch — surface the delta + unmapped/ad-hoc rows.
6. **Persist** — atomic `saveEstimate(estimate, rows)`; `sort_order` from array index.

## Same-code / ad-hoc handling (architect-locked)
- **Same code, different scope (interior vs exterior `08-4000.002`) = PRESENTATION ONLY** → independent
  lines, distinction in the **description**. NO scope field, NO schema change. Procore/BLI rollup sums
  them into one code (correct). Optional later: a "Scope" custom column (existing feature, no migration).
- **Ad-hoc lines: import everything, never drop a dollar** — uncatalogued codes → unmapped (Flags + B-4
  assign); non-conforming/no-code lines → manual rows flagged `needsReview`, dollars preserved. NOTE the
  extractor currently SKIPS rows not matching `NN-NNNN.NNN` (`templateExtractor.ts` COST_CODE_RE) — close
  that gap so ad-hoc lines are captured.

## Open item to decide in build
- **Provenance value** for imported rows: reuse `csv_import` (no model change) vs. add a clean
  `imported` source + a Phase-5 provenance glyph (clearer owner-facing trust). Lean: add `imported`.

## Constraints / gates
- No new schema migration expected in Phase 1 (reuses projects + estimate_line_items + `save_estimate`).
  If one becomes necessary, PAUSE for architect approval + invoke the `supabase:supabase` skill and
  update `supabase_schema.sql` first.
- `npm run test` green before every commit; `/code-review` before delivery. **Golden McKenna AND the
  synthetic golden must keep tying $0.00.**
- Learning stays shallow (keep recording to `classification_history`); history-ranked suggestions = Phase 3.

## Tests (mirror the B-1 / golden pattern — pure logic in node, no DOM)
- **Import tie-out (CI-safe):** extend `src/__tests__/fixtures/syntheticTemplate.ts` into a synthetic
  past-bid workbook; run the import enrichment + `computeTakeoffSummary`; assert the imported total ties
  the oracle to the cent, AND that an ad-hoc (uncatalogued) line is imported (not dropped) and flagged.
- **Same-code independence (node):** two rows sharing `08-4000.002` with distinct descriptions — editing
  one does not mutate the other; both persist/reload distinct; both roll up to one Procore code.

Stop at green + committed + a handoff note (update `[[import-past-bids-plan]]` + this kickoff's status).
