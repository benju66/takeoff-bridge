# Planning Brief — Company Rate Card · Slice 2 (STEP 4 catalog unit prices)

> **Status:** PLAN APPROVED 2026-06-08 — design resolved with the user (System Architect). No code
> written yet — Phase A starts in a fresh window.
> **Predecessor:** Slice 1 (GC/Site Ops rates) is COMPLETE — see
> `docs/plans/rate-card-admin-portal.md` (Phases A/B/C, commits `ff6985c`/`86110c9`/`97630a0`).

---

## 1. Objective

Lift the **221 STEP 4 catalog unit prices** (`defaultUnitPrice` in `src/lib/estimate-catalog.json`)
out of the hard-coded file into the **same** DB-backed company `rate_card`, served by the **same**
`resolveCompanyRate` chokepoint and edited from the **same** `/rates` page (a new section), so an
admin maintains the company price book without a code change — exactly the mechanism Slice 1 proved.

## 2. What's different from Slice 1 (verified — drives the design)

1. **Consumption is at row-birth, not in calc.** `defaultUnitPrice` is read at exactly three places,
   each of which then **persists the price on the row** (`estimate_line_items.unit_price`):
   - `src/hooks/useTakeoffWorkbook.tsx:321` — `initializeDefaultEstimateRows` (new project template rows)
   - `src/lib/parser.ts:115` — CSV import row init
   - `src/hooks/useCellEditing.ts:115,126,137,147` — when an estimator changes a row's `itemId` (incl. the duplicate-cascade block)
   Because the value freezes on the row once saved, **existing estimates cannot move** when an admin
   edits a default → **no per-project snapshot and no backfill** (the big simplification vs Slice 1's
   live-recompute + snapshot). The card only feeds the default into *new* rows.
2. **Keys are disjoint.** The 221 catalog `itemId`s and the 44 Slice-1 line `code`s have **0 overlap**
   (verified), so both coexist in `rate_card` under PK `(template_name, line_code)` and one primed map
   serves both.
3. **Catalog prices can be negative.** `03-5413.002 Gypsum Cement (Subtract Podium Level If Pt) = -$2`
   is an intentional deduction line → catalog validation must allow **any finite number**, while
   GC/Site Ops keeps `>= 0`. Validation becomes **per-rate-kind**.
4. **Seed all 221** including the 64 `$0` rows and 5 `0.001` placeholders, so every line is editable.

## 3. Settled decisions (do not re-litigate)

- Per-kind validation: catalog = finite (negatives allowed); GC/Site Ops = `>= 0` (unchanged).
- No catalog snapshot, no backfill (per-row `unit_price` already freezes saved estimates).
- Seed all 221 catalog lines.
- **No schema change** — reuse `rate_card` (line_code holds the `itemId`), leave `rate_card_snapshot`
  untouched (catalog not added to it), reuse `getRateCard` + the resolver. If a schema need appears,
  STOP and ask.
- Same table + same `/rates` page (new "Catalog" block grouped by CSI division).
- Deferred (still): the market-sector / `project_type` overlay tier (rate-card §3).

## 4. Phasing (one phase per fresh context window, mirrors Slice 1)

| Phase | Scope | Key files | Exit |
|---|---|---|---|
| **A — Infra + seed (no behavior change)** | Extend `generate-rate-card-seed.js` to emit 221 catalog rows (finite-only filter; keep `$0`/neg/`0.001`; combined-key collision guard; insert-only `source='seed'`) → regenerate `supabase_seed_rate_card.sql` (265 rows); apply the 221-row INSERT to `rate_card` (branch→main, approval); add `updateRateCardEntry(…, opts?: { allowNegative? })` (default keeps `>= 0`) | `scripts/generate-rate-card-seed.js`, `supabase_seed_rate_card.sql`, `src/lib/db.ts`, tests | build+test green; DB 265 rows; nothing consumes catalog yet → zero value change; commit + §9 note |
| **B — Wire resolver into row init (byte-identical day one)** | Replace the 3 `defaultUnitPrice` reads with `resolveCompanyRate(itemId, <json default>)` (resolver already primed at mount; `getRateCard` now returns catalog rows too); optional `resolveCatalogPrice` alias. NO snapshot/backfill | `src/hooks/useTakeoffWorkbook.tsx`, `src/lib/parser.ts`, `src/hooks/useCellEditing.ts`, `src/lib/rateResolver.ts` (alias), tests | build+test green; day-one invariant green; export-integrity green; commit + §9 note |
| **C — Editor: Catalog section in `/rates`** | Tag line defs with `kind: 'gcSiteOps'\|'catalog'`; build catalog defs from `ESTIMATE_ITEMS_MASTER` (`@/lib/mock-data`) → label/unit; group by CSI division via `getDivisionCode()` + `DIVISION_LABELS`; extend `RATE_SECTION_ORDER`; `parseRateInput(raw, { allowNegative })`; pass `allowNegative` for catalog rows to input + `updateRateCardEntry`; handle negative currency display | `src/lib/rateCardEditor.ts`, `src/app/rates/page.tsx`, tests | build+test green; 221 catalog lines render + editable (incl. negatives); new project picks up edit, existing unchanged; commit; mark Slice 2 COMPLETE |

## 5. Guardrails (from AGENTS.md / CLAUDE.md)

- DB access only via `src/lib/db.ts`; line items only via the `save_estimate_line_items` RPC
  (untouched). No `supabase.ts` import in the page.
- `calculations.ts` stays the sole calc authority — Slice 2 only changes the *default* a new row is
  born with; never invents/alters a persisted price or total.
- Division extraction only via `getDivisionCode()`; `source` provenance rules unchanged.
- DB writes on a Supabase branch before main, with approval; `supabase_schema.sql` unchanged (no DDL).
- Windows/PowerShell: short inline commands; script files for anything longer; no emoji in scripts.

## 6. Exit criteria (Slice 2)

- 221 catalog prices in `rate_card` (seed == today's `estimate-catalog.json`); export ties out
  unchanged day one (`export-integrity.test.ts` green).
- Day-one invariant test: row init via the primed card == raw-JSON row init (template-init, CSV
  import, itemId-change); `-2` and `0.001` preserved.
- Admin can edit any catalog price at `/rates` (incl. negatives); new projects' rows are born with
  the edit; existing saved estimates are unaffected (per-row persistence).
- All DB via `db.ts`; no DDL; `npm run build` + `npm run test` green before each commit; committed.

## 7. Kickoff prompts (paste into a fresh window per phase)

### → Phase A (infra + seed; safe, no behavior change)
```
Implement PHASE A ONLY of docs/plans/rate-card-slice2-catalog.md. Read the whole file first
(esp. §2 differences, §3 settled decisions, §4 phasing). Slice 1 (docs/plans/rate-card-admin-portal.md)
is COMPLETE and is the pattern to mirror. Do Phase A and nothing else, then STOP.
== SCOPE ==
1. Extend scripts/generate-rate-card-seed.js with a SECOND source: estimate-catalog.json. Emit one
   row per itemId, rate=defaultUnitPrice, filter = FINITE NUMBER ONLY (keep $0, negative, 0.001 — do
   NOT apply the GC/Site Ops >=0 isRateBearing filter to catalog rows). Keep the GC/Site Ops path
   untouched. Collision guard must run across the COMBINED key set (stay 0 collisions). Insert-only,
   source='seed'. Regenerate supabase_seed_rate_card.sql (expect 265 rows).
2. updateRateCardEntry in src/lib/db.ts: add opts?: { allowNegative?: boolean }. Default keeps the
   current >=0 gate (Slice-1 callers unchanged); allowNegative:true relaxes to finite-only. Always
   reject non-finite.
3. Tests: generated catalog rows == all 221 catalog itemIds; -2 / 0 / 0.001 preserved; 0 collision
   with the 44 GC/Site Ops codes.
== DB == Apply the 221-row INSERT to rate_card via the supabase skill, on a branch → verify → main
with my approval (mirror Slice 1). NO DDL — supabase_schema.sql is unchanged. If you think you need a
schema change, STOP and ask.
== GUARDRAILS == DB only via db.ts; no supabase.ts in app code; Windows/PowerShell short commands or
script files; no emoji in scripts.
== EXIT == npm run build + npm run test green; rate_card has 265 rows; nothing consumes catalog yet
(zero value change); commit + 3–5 line §9 handoff note. Then STOP. Model: Claude Opus (latest).
```

### → Phase B (wire resolver into row init; byte-identical day one)
```
Implement PHASE B ONLY of docs/plans/rate-card-slice2-catalog.md. Read the whole file first + the
Phase A §9 note. Do Phase B and nothing else, then STOP.
== ALREADY SHIPPED (Phase A) == 221 catalog rows seeded into rate_card (finite, incl. $0/neg/0.001);
getRateCard returns them; updateRateCardEntry takes { allowNegative }. The resolver
(src/lib/rateResolver.ts, resolveCompanyRate) is already primed at workspace mount and now holds
catalog itemIds too.
== SCOPE == Replace the THREE defaultUnitPrice reads with resolveCompanyRate(itemId, <json default>):
useTakeoffWorkbook.tsx:321 (initializeDefaultEstimateRows), parser.ts:115 (keep the || 0 / ?? 0
fallback), and the four useCellEditing.ts reads incl. the duplicate-cascade block. Optional thin
resolveCatalogPrice = resolveCompanyRate alias for readability; NO new cache. NO snapshot, NO hooks
state, NO backfill (per-row unit_price already freezes saved estimates).
== EXIT == New test (catalogPriceLookup.test.ts): day-one invariant — primed-card row init == raw-JSON
row init across template-init / CSV import / itemId-change; -2 and 0.001 survive. export-integrity
stays green. npm run build + npm run test green; commit + §9 note. Then STOP. Model: Claude Opus.
```

### → Phase C (the /rates Catalog section — LAST phase of Slice 2)
```
Implement PHASE C ONLY of docs/plans/rate-card-slice2-catalog.md. Read the whole file first + the
Phase A+B §9 notes. Do Phase C and nothing else, then STOP. LAST phase of Slice 2.
== ALREADY SHIPPED == rate_card holds 44 GC/Site Ops + 221 catalog rows; catalog is consumed at row
init via resolveCompanyRate (Phase B); updateRateCardEntry takes { allowNegative }. /rates page +
src/lib/rateCardEditor.ts already render GC/Site Ops (grouped, search, inline edit, re-prime).
== SCOPE ==
1. rateCardEditor.ts: tag each line def with kind: 'gcSiteOps' | 'catalog'. Build catalog defs by
   joining itemId -> ESTIMATE_ITEMS_MASTER[itemId] (@/lib/mock-data) for label=description,
   unit=targetUom. Group catalog rows by CSI division via getDivisionCode() (src/lib/division.ts) +
   DIVISION_LABELS/DIVISION_NAMES; extend RATE_SECTION_ORDER with the division groups AFTER the
   GC/Site Ops sections. parseRateInput(raw, { allowNegative }): catalog accepts any finite number;
   GC/Site Ops keeps >=0. A seeded catalog row with no def must still surface (unmatched), not drop.
2. src/app/rates/page.tsx: render the division-grouped catalog sections (mostly data-driven off
   RATE_SECTION_ORDER); pass allowNegative (from the row's kind) to BOTH the input validation and
   updateRateCardEntry; make currency display handle negatives. Reuse the existing save → re-fetch →
   primeRateCard path; no new write path.
== GUARDRAILS == DB only via db.ts; getDivisionCode() is the only division extractor; no supabase.ts
in the page; never touch persisted prices/totals (only the company-default layer).
== EXIT == Tests (extend rateCardEditor.test.ts): catalog join completeness (every seeded itemId has
a def), division grouping order, parseRateInput accepts -2/0 for catalog but rejects them for
GC/Site Ops, catalog edit stamps source='manual'. npm run build + npm run test green; commit; mark
Slice 2 COMPLETE in §9 and note the market-sector overlay as the only remaining tier. Then STOP.
Model: Claude Opus (latest).
```

## 9. Handoff log

### Phase A — DONE (2026-06-08)
- **Seed generator** (`scripts/generate-rate-card-seed.js`): added Source 2 — reads
  `estimate-catalog.json`, emits one row per `itemId` (`rate = defaultUnitPrice`) under a
  **finite-only** filter (the GC/Site Ops `>= 0` gate is NOT applied), so all 221 lines seed incl.
  64 `$0`, the 5 `0.001` placeholders, and the 1 negative deduction (`03-5413.002 = -2`). GC/Site Ops
  path untouched (44 rows). Collision guard now runs across the **combined** key set → 0 collisions.
  Output stays insert-only (`ON CONFLICT DO NOTHING`, `source='seed'`); GC block emitted first then
  catalog, both code-sorted → deterministic (re-run = no diff). `supabase_seed_rate_card.sql` = **265 rows**.
- **`updateRateCardEntry`** (`src/lib/db.ts`): new optional `opts?: { allowNegative?: boolean }`.
  Default unchanged (`>= 0` gate → Slice-1 callers untouched); `allowNegative:true` relaxes to
  finite-only. Non-finite (NaN/Infinity) always rejected.
- **Tests**: `rateCardSeed.test.ts` rescoped to the GC/Site Ops subset (regex now allows negatives;
  the null-rate guard excludes catalog itemIds — note `02-4100.002` is both a GC lump-sum code AND a
  catalog itemId, legitimately seeded as a catalog row). New `catalogRateSeed.test.ts`: all 221 itemIds
  present w/ correct price, `-2`/`0`/`0.001` preserved, 0 collision with the 44 GC codes, combined = 265.
  full `npm run test` = **259 green** (24 files, incl. the new catalog seed tests); `npm run build` green.
- **DB**: applied the 221-row insert-only seed on a Supabase branch (`rate-card-slice2-catalog`),
  verified 265 rows + edit-safe idempotency (a simulated `manual` edit survived a seed re-run), then
  applied to **main** with user approval → `rate_card` = **265** (265 seed / 0 manual; 1 neg, 64 zero,
  5 placeholder). Branch deleted (billing stopped). No DDL; `supabase_schema.sql` unchanged.
- **Zero value change**: nothing consumes the catalog rows yet — that is **Phase B** (wire
  `resolveCompanyRate` into the 3 `defaultUnitPrice` reads). **Phase C** = the `/rates` Catalog section.
