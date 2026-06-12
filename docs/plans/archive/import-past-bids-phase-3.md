# Import Past Bids — Phase 3: Pricing / Learning Harvest — Plan of Record
_2026-06-10 · status: APPROVED (architect skipped ultraplan — evidence-grounded, no schema
work, suite+goldens are the safety net; all four forks locked 2026-06-10, see below)_

## Goal
When this phase is done, every bid imported makes the next one faster and the pricing
database richer — without the app ever inventing a number:

1. **As-bid UOMs are captured** (Slice 0): an imported row's unit of measure is the
   BID's, read from column G of STEP 2 / STEP 3 / STEP 4 — never the catalog's stamp.
   As-bid price and as-bid UOM travel together (a $/SF price is never labeled EA).
2. **The import review learns from history**: lines the team has mapped before show
   "seen in N past bids → this code" suggestions, ranked from `classification_history`
   (398 confirmed mappings recorded today, read by nothing).
3. **As-bid price history is visible where rates are set**: the /rates catalog section
   reports each code's imported unit-price history (count / median / range, with
   project + date + sector context) and offers a one-click ADOPT into the rate card.
   Report-only — a human adopts; nothing auto-applies (No AI Autonomy Over Financials).

## Evidence (probed live + on the CARE file, 2026-06-10)
- **TWO bids are already imported** (not one, as the kickoff assumed): CARE Relocation
  (142 lines, STEP 2/3 detail captured: 19+16 lines) and McKenna Crossing Terrace II
  (114 lines, 21+16). Both predate UOM capture → **both need one re-import after
  Slice 0** (delete the old copy first; classification_history is append-only and just
  accumulates).
- `classification_history`: 398 rows, all `resolved_by='user'`. `estimate_overrides`:
  4 lumps (3 CARE + 1 McKenna "Bond"). Line items: 256 `source='imported'`.
- **CARE column G**: STEP 2 35/35 rows carry a UOM (`mo`,`hr`,`ls`,`ea`,`%`), STEP 3
  42/42, STEP 4 268/275 (7 blank). Values are lowercase; the catalog is uppercase →
  normalize case on read. The harvest script already reads STEP 4 col G as UOM
  (`scripts/harvest-cost-codes.js:367`), confirming the template convention.
- Today's importer NEVER reads col G: `enrichOne`/`applyImportMapping`
  (`src/lib/importEstimate.ts`) stamp the catalog's `targetUom` on mapped rows, and
  `extractSheetLines` (`src/lib/templateExtractor.ts`) carries no UOM at all. The 256
  saved imported rows' UOM distribution (LS/EA/SF…) is catalog-stamped, not as-bid.
- **No schema change is needed anywhere in this phase**: `estimate_line_items.uom`
  already exists; STEP 2/3 UOM rides the existing `imported_step23_lines` JSONB as an
  additive field; learning + mining are pure reads of existing tables.

## Out of scope / deferred
- **Slice 3 — STEP 2/3 code normalization + staff-rate mining** (extend
  `deriveLegacyBridge` to the legacy BLI's 73 STEP-2 SUMIF criteria; map bare GC/SO
  codes to deterministic staff codes; backfillable since raw codes are stored).
  Deferred to its own session — this phase already spans extractor + db + two UI
  surfaces. Raw codes are stored verbatim, so nothing is lost by waiting.
- Archive & comparison, the catalog manager, the Permits section — separate sessions.
- Lump-override mining (only 4 rows exist; revisit with backlog volume).
- Market-sector-specific rate overlays (the deferred rate-card tier).
- Any statistical sophistication beyond count/median/range — with 2 bids the data is
  thin; the value now is the PIPELINE, proven so the backlog imports feed it.

## Locked decisions (carried in from the kickoff / architect)
- **Slice 0 builds FIRST, before any backlog importing** — every bid imported before
  it would need re-importing (architect, 2026-06-10).
- **Historical fidelity**: imported rows keep the BID's UOM, same rule as unit prices.
- **Mining REPORTS history; humans adopt** rates/defaults through explicit action.
- `calculations.ts` is the sole financial authority; UOM is non-financial and must not
  move any total — goldens (McKenna + synthetic + CARE) keep tying $0.00.
- Training tables stay append-only; training reads/writes never block workflows.

## Forks — LOCKED by the architect (2026-06-10)

**F1 — Blank as-bid UOM → RESOLVED BY DOMAIN KNOWLEDGE.** The architect identified the
7 blank col-G rows as the 60-xxxx modifier rows (Construction Contingency, Owner's Rep,
Professional Service Fees, Builder's Risk/Special Insurance, GL Insurance, Bond, Fee) —
soft-cost rows that deliberately carry no unit. Those rows sit below SUBTOTAL and import
as MODIFIERS, never as line items, so every real line item carries a UOM. Behavior:
catalog-UOM fallback kept as a harmless safety net for a blank line-item cell (in
practice it won't fire on template-family bids).

**F2 — Mismatch → subtle display-only indicator** (review table marker + tooltip naming
both UOMs; never blocks, never enters Flags). Architect-confirmed editability: after
save, `uom` is an editable grid cell (`EstimateTable.tsx`) with undo, and imported rows
are cascade-independent — any UOM is correctable later like any other cell.

**F3 — History tier does NOT join "Accept all high-confidence"** — one click per row;
accept-all stays bridge+linked only. Revisit once history depth grows.

**F4 — Price history surfaces on /rates** (catalog section), with one-click ADOPT via
the existing audited rate-card admin write path.

## Slices (all in THIS session, in order; each ends green + committed)

### Slice 0 — As-bid UOM capture (MANDATORY FIRST)
- **Scope:**
  - `src/lib/templateExtractor.ts`: `ExtractedLineItem.uom` + `ExtractedSheetLine.uom`
    — read col G (trim, uppercase) in `extractStep4` (conforming AND ad-hoc paths) and
    `extractSheetLines`. `toProcessedRows` is NOT touched (golden byte-identity).
  - `src/lib/importEstimate.ts`: `enrichOne` and `applyImportMapping` — as-bid UOM
    wins; catalog `targetUom` only fills a blank (per F1). Mapping a code never
    overwrites a non-empty as-bid UOM.
  - `src/types/db.ts`: `ImportedSheetLine.uom?: string` (additive JSONB field; the two
    existing payloads degrade fine).
  - UI: UOM column in the import review table + `ImportedStep23Panel`; F2 indicator.
  - Fixtures: write col G (mixed case, to prove normalization) in the synthetic legacy
    + past-bid builders; extend `LEGACY_PAST_BID_ORACLE`/`PAST_BID_ORACLE`; extend the
    CARE golden to assert real UOMs survive (e.g. STEP 2 `01-0410 Sr Superintendent →
    HR`) and that accept-all does NOT stamp catalog UOMs over them.
- **Tests:** extractor reads UOM on all 3 sheets; enrich keeps as-bid UOM; mapping
  preserves it; db round-trip of the JSONB field; all goldens still tie $0.00.
- **Approval gates:** none (no DDL, no template change, no push).
- **After it lands:** the architect re-imports CARE and McKenna once each (collects
  STEP 2/3 UOMs + McKenna's missing nothing — both get as-bid UOMs), then backlog
  importing begins in parallel with the rest of the phase.

### Slice 1 — Learning consumer (the `history` suggestion tier)
- **Scope:**
  - `src/lib/db.ts`: `getClassificationHistoryBulk(classifications)` — ONE chunked
    `.in()` read of `classification_history`, grouped to
    `Map<classification, {resolvedCode, count}[]>`. Read-only; no schema change.
  - `src/lib/importEstimate.ts`: `suggestMapping` takes an optional history map (pure
    module stays sync); new tier order **bridge > linked > history > similar > none**.
    A history suggestion must still exist in today's catalog (stale codes skipped).
    Chip: "Seen in N past bids" + code name; candidates ranked by count.
  - `/projects/import`: after parse, bulk-fetch history for the ad-hoc descriptions
    (fail-soft: on error, empty map — import works without history).
  - Accept-all behavior per F3.
- **Tests:** pure tier precedence with an injected history map; count ranking; stale-
  code skip; fail-soft (no history ⇒ identical to today's suggestions).
- **Approval gates:** none.

### Slice 2 — Price mining (report-only + one-click ADOPT)
- **Scope:**
  - `src/lib/db.ts`: `getImportedPriceHistory()` — `estimate_line_items` where
    `source='imported'` and mapped, joined to `projects` (name, bid_date,
    market_sector, square_footage). Read-only.
  - NEW pure `src/lib/priceHistory.ts`: aggregate per **(itemId, uom)** — prices are
    only comparable within a UOM (this is WHY Slice 0 is first) — count, median, min,
    max + the observation list (project, date, sector, price).
  - `/rates` catalog section: history badge per code (count); expand → observations +
    median; "Adopt median as default" writes through the EXISTING rate-card admin
    update path. Never auto-applies; the 6 manual $0 codes are the first customers.
- **Tests:** pure aggregation (median, mixed-UOM separation, empty history); the
  adopt path reuses the already-tested rate-card update.
- **Approval gates:** none (rate_card writes go through the existing admin path the
  architect already uses).

## Risks & unknowns
- **CARE golden drift**: the golden asserts exact extraction shapes; adding `uom`
  must extend, not reshape, assertions. Found immediately by the suite (local CARE
  golden + CI synthetic twin).
- **Old `imported_step23_lines` payloads** lack `uom` — the panel must render "—"
  and the type must keep it optional. Found by the db round-trip test.
- **History keyed on exact description strings**: legacy bids vary wording, so early
  hit-rates will be partial (CARE↔McKenna overlap is real but not total). Exact-match
  is the honest v1; fuzzy history matching is a later sharpening if hit-rate
  disappoints on the backlog.
- **Two-bid statistics**: median-of-2 is just a midpoint. Mitigated by report-only +
  visible observation count; the surface gets statistically meaningful as the backlog
  lands — which Slice 0 unblocks.
- **/rates page size**: if the catalog-section change balloons, the history popover
  ships behind the badge with the simplest possible expand (no new page).

## Sequencing rule (architect actions interleaved)
1. Slice 0 lands (green, committed) → **architect re-imports CARE + McKenna once**
   (delete the stale copies first), then starts backlog imports in parallel.
2. Slices 1–2 build while the backlog grows; every new import immediately feeds both
   the history tier and the price report.
3. Slice 3 (STEP 2/3 normalization + staff-rate mining) = next fresh session.

## Gates (every commit)
`npm run test` green (465 pass / 46 files at start) · `npx tsc --noEmit` clean ·
goldens McKenna + synthetic + CARE tie $0.00 · append-only tables untouched ·
`import type` discipline (ExcelJS stays out of pure/page graphs) · multi-line commits
via `git commit -F` · `/code-review` before delivery · NO push to origin without the
architect's say-so.
