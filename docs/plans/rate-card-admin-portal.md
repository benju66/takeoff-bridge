# Planning Brief — Company Rate Card + Admin Portal

> **Status:** PLAN APPROVED 2026-06-07 — design resolved with the user (System Architect) and
> approved; §5 now holds the agreed design + phasing (no longer open questions); §7 holds the
> updated exit criteria. No code written yet — Phase A starts in a fresh window.
> **Authored:** 2026-06-07
> **Predecessor:** the gc-siteops export plan is COMPLETE (`docs/plans/gc-siteops-export-step2-step3.md`).

---

## 1. Objective

Lift the hard-coded default **rates** out of source code into an admin-editable, DB-backed
**company rate card**, so executives/admins can set rates for all rate-bearing line items
without a code change. Estimates become point-in-time documents: a rate-card edit applies to
**future projects only**, never silently to past ones.

This replaces the hard-coded *default* rates; it does **not** remove the per-project override
layer (Phase 6B already made the 8 staff rates project-overridable — that override stays and
sits on top of the card).

## 2. Background — where rates live today (verified 2026-06-07)

| Rate set | Home today | Per-project override today? | Stored per project? |
|---|---|---|---|
| 8 staff hourly rates (`STAFF_ROLE_DEFAULTS`) | `constants.ts` | ✅ yes (Phase 6B, rides `gc_utilization`) | only the sparse override |
| ~13 GC operational/auto lines (`OPERATIONAL_EXPENSE_DEFAULTS`) | `constants.ts` | ❌ no | ❌ no — **read live from constants** |
| GC manual qty lines (`GC_MANUAL_DEFAULTS`, the `entry:"qty"` ones) | `constants.ts` | ❌ no | ❌ no |
| 3 Site Ops dynamic lines (`SITE_OPS_DYNAMIC_DEFAULTS`) | `constants.ts` | ❌ no | ❌ no |
| ~34 Site Ops manual qty lines (`SITE_OPS_MANUAL_DEFAULTS`, `entry:"qty"`) | `constants.ts` | ❌ no | ❌ no |
| 217 STEP 4 takeoff unit prices (`defaultUnitPrice`) | `estimate-catalog.json` | per-row in the grid | row's `unitPrice` persists |

**Critical current behavior:** the non-staff GC/Site Ops rates are recomputed live from
`constants.ts` on every project load — they are **not** snapshotted. So a rate change today
would retroactively move every existing project's totals. The rate card must change this
(see §4.3).

**Not in the card:** lump-sum lines (`entry:"lumpSum"` / `entry:"qtyRate"`, the equipment
dollar entries) have no default unit rate — the estimator types the dollar amount. Nothing to
set on the card for them.

**Precedent to reuse:** the `/cost-codes` mapping editor (gc-siteops Phase 3c) is already a
company-wide settings page backed by a DB table (`cost_code_map`), editable by any
authenticated user, seeded from source, with a resolution chokepoint (`resolveProcoreCode`).
The rate card is architecturally a twin of it — follow that shape.

## 3. Scope & phasing

- **Slice 1 — GC/Site Ops rates (this plan).** The ~60 rate-bearing GC/Site Ops lines above.
  Small, clean, freshly in context. Proves the whole mechanism (table → seed → snapshot →
  resolution chokepoint → editor page).
- **Slice 2 — the 217 STEP 4 catalog unit prices (separate later plan).** Bigger, messier set
  (many $0 placeholders, lives in `estimate-catalog.json` + flows through `parser.ts` /
  catalog row-init). Folds into the *same* rate card and the *same* mechanism once slice 1 is
  proven. Out of scope here — do not start it.
- **Market sector / project-type overlay — designed-for, NOT built.** A future tier between
  company-default and project-override (e.g. a Medical job's rates differ from Multifamily).
  Design the table so a sector/`project_type` key can slot in later, but slice 1 ships
  company-default + project layer only. (`project_type` column already exists, dormant.)

## 4. Settled decisions (do not re-litigate)

1. **No roles/permissions work up front.** The app has no admin/executive role concept today,
   and the `/cost-codes` editor precedent shows a company-wide setting any authenticated user
   can edit is acceptable for this internal tool. Ship the rate card the same way; add real
   admin gating later as its own concern when restriction is actually wanted.
2. **Build on a single rate-resolution chokepoint**, seeded from today's `constants.ts` values
   so **nothing changes value on day one** (same discipline as the `cost_code_map` seed). One
   insertion point, not the rate threaded into many call sites.
3. **Snapshot-at-creation (point-in-time estimates).** Each project captures the rate card in
   effect when created; calc reads the project's snapshot, not the live card. Card edits apply
   to **future projects only**. Resolution chain:
   `rate = projectOverride ?? projectSnapshot ?? companyCard`.
   - Pre-existing projects (created before the feature) get a one-time backfill snapshot of
     the seeded values, so they freeze at today's numbers and stay consistent. (The `??
     companyCard` fallback means an un-backfilled project still reads the seeded card, which
     equals today's constants — so backfill is for consistency, not correctness.)
   - **Deferred nicety:** an explicit per-project "refresh rates to current card" action so an
     estimator can *choose* to pull updates into an active draft. Nothing changes silently.
4. **The card replaces the *default* layer only.** Phase 6B's per-project staff override stays
   as the top layer; the card sources its default. Lump-sum lines stay code/estimator-owned.
5. **Structure stays in code; only values move to the card.** The line definitions (key, code,
   procoreCode, costType, unit, quantityDriver, section) remain in `constants.ts` as the
   structural skeleton — the card keys off those, so we don't create a fourth source of truth
   to keep in sync (template ↔ catalog ↔ cost_code_map ↔ constants).

## 5. Agreed design + phasing (resolved & approved 2026-06-07)

The six former open questions are resolved below. This is architecturally a **twin of the
`/cost-codes` mapping feature** (`cost_code_map` → insert-only seed → `resolveProcoreCode`
chokepoint → editor). Each user decision was confirmed (all "Recommended" options).

### 5.1 Snapshot storage shape — **full copy on the project**
New JSONB column `project_estimates.rate_card_snapshot` = `Record<line_code, rate>`, a full
snapshot of all rate-bearing lines. Self-contained — immune to later card edits and even
card-row deletion. (Versioned-card reference rejected: needs card-versioning machinery for a
~44-row card.)

### 5.2 Rate card table shape — **exact twin of `cost_code_map`**
```sql
CREATE TABLE rate_card (
  template_name TEXT NOT NULL,
  line_code     TEXT NOT NULL,          -- constants.ts line `code`, e.g. "01-0310.001"
  rate          NUMERIC NOT NULL,
  source        TEXT NOT NULL DEFAULT 'seed' CHECK (source IN ('seed','manual')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (template_name, line_code)
);
-- RLS mirrors cost_code_map: authenticated SELECT USING(true); write FOR ALL USING/CHECK(true).
```
**Key namespace = the line `code`** (unique across `STAFF_ROLE_DEFAULTS`,
`OPERATIONAL_EXPENSE_DEFAULTS`, the `entry:"qty"` rows of `GC_MANUAL_DEFAULTS`,
`SITE_OPS_DYNAMIC_DEFAULTS`, and the `entry:"qty"` rows of `SITE_OPS_MANUAL_DEFAULTS`). Lump-sum
/ qty-rate / equipment lines (rate `null` / estimator-typed) carry **no** card entry. The future
sector dimension is added later via migration when that feature is built — **no dormant column
now** (matches the `cost_code_map` precedent and its documented "add the dimension later" note).
Staff per-project overrides keep keying by `role.key` (unchanged top layer).

### 5.3 Seed + sync discipline — **insert-only generator, twin of `generate-cost-code-map-seed.js`**
New `scripts/generate-rate-card-seed.js` emits `supabase_seed_rate_card.sql` with
`INSERT … ON CONFLICT (template_name, line_code) DO NOTHING` (never clobbers `source='manual'`
editor edits; generated rows `source='seed'`). Source of rates = the `constants.ts` typed arrays,
imported directly by running the generator via **`tsx`** (`node --import tsx`) — no second source
of truth, no regex parsing (fallback: `node --experimental-strip-types`). Add
`"generate-rate-card-seed"` to `package.json`. A newly-added constants rate line reaches the card
by re-running the generator + applying the INSERT — identical discipline to `cost_code_map`.

### 5.4 Editor page — **standalone `/rates`**, twin of `/cost-codes`
`src/app/rates/page.tsx`: load via new `getRateCard(templateName)`; group rows by the configs'
`section` fields + `SITE_OPS_SECTIONS`; instant search; inline single-row edit; save via new
`updateRateCardEntry(templateName, lineCode, rate)` (stamps `source='manual'`, update-only);
re-prime `primeRateCard` after save; `visibilitychange` re-prime; add a Sidebar link. Validation:
rate must be a finite number ≥ 0.

### 5.5 Resolution chokepoint — **`src/lib/rateResolver.ts`** (twin of `costCodeResolver.ts`), `calculations.ts` stays pure
Module cache for the **company layer only**: `primeRateCard(entries)` → `Map<line_code, rate>`;
`resolveCompanyRate(code, fallback)` → card rate or `fallback`; `resetRateCard()` test helper.
Primed at workspace mount (added to the existing `Promise.all` in `useTakeoffWorkbook.tsx` next to
`getCostCodeMap`), re-primed on `visibilitychange`, and after an editor save.

`computePersonnelCosts` / `computeSiteOperations` gain an **injected** lookup param
`rateLookup: (code, fallback) => number = (_, fb) => fb`. Every direct rate read
(`role.defaultRate`, `expense.rate`, `cfg.rate`) becomes `rateLookup(line.code, <constants
default>)`. calc imports nothing from the resolver — the formula stays in calc; only the scalar
default is sourced through the injected function. The **default param returns the fallback**, so
existing callers/tests are unchanged and day-one behavior is byte-identical.

The calc hooks (`usePersonnelCalculations` / `useInfrastructureCalculations`) compose the layered
lookup: `lookup = (code, fallback) => projectSnapshot[code] ?? resolveCompanyRate(code,
fallback)`. Full chain (staff): `rateOverrides[role.key] ?? projectSnapshot[code] ??
companyCard[code] ?? constantsDefault`.

**Snapshot write timing (freeze-at-creation):** `project_estimates` is created lazily on first
estimate save. The hook holds `rateCardSnapshot` state (init from loaded estimate; if empty and
the card is primed, capture a copy of the current card; persist every save, idempotent once
frozen). A new project freezes the live card at first save; thereafter immutable (the deferred
"refresh to current card" action is the only future way to update it).

### 5.6 Pre-existing-project backfill — **one-time migration at rollout (branch first)**
Because seed == constants == card on day one, the snapshot JSON is the same full card object for
every row: `UPDATE project_estimates SET rate_card_snapshot = '<full seeded card JSON>' WHERE
rate_card_snapshot = '{}' OR rate_card_snapshot IS NULL;`. Run on a Supabase branch, verify, then
main with approval — before the editor goes live, so no existing project can shift when the first
card edit lands.

### 5.7 What needs no change (verified)
- **Exporter** consumes calc *results* (`PersonnelCalcResult` etc.), not rates → snapshotted
  rates flow to the workbook BLI, Procore CSV, and reconciliation gate automatically.
- **STEP 2/3 sheet detail** (gc-siteops Phase 6A) writes each line's `.rate` from the calc
  result → automatically the effective (snapshot/card) rate.
- `cost_code_map` / `resolveProcoreCode` untouched (different concern: *where* dollars land).

### 5.8 Phasing — one phase per fresh context window

| Phase | Scope | Key files | Exit |
|---|---|---|---|
| **A — Infra (no behavior change)** | `rate_card` table + RLS + `rate_card_snapshot` column in `supabase_schema.sql` (approval → supabase skill → branch); `generate-rate-card-seed.js` + `package.json` + seed applied on branch; `rateResolver.ts`; `RateCardEntry` type; `getRateCard`/`updateRateCardEntry` in db.ts | `supabase_schema.sql`, `scripts/generate-rate-card-seed.js`, `src/lib/rateResolver.ts`, `src/types/db.ts`, `src/lib/db.ts` | build+test green; DB seeded; nothing consumes it → zero value change; commit |
| **B — Wire in + snapshot (no value change day one)** | inject `rateLookup` into `calculations.ts`; prime card + compose snapshot/card lookup in the calc hooks + `useTakeoffWorkbook` mount/visibility; persist/load `rate_card_snapshot` (db.ts + types); freeze-at-first-save; **backfill migration** (branch→main w/ approval) | `src/lib/calculations.ts`, `src/hooks/usePersonnelCalculations.ts`, `src/hooks/useInfrastructureCalculations.ts`, `src/hooks/useTakeoffWorkbook.tsx`, `src/lib/db.ts` | build+test green; existing-project export ties out unchanged; snapshot freezes + survives reload; commit |
| **C — Editor** | `/rates` page (twin of `/cost-codes`); Sidebar link; `updateRateCardEntry` validation; re-prime after save | `src/app/rates/page.tsx`, `src/components/layout/Sidebar.tsx` | build+test green; edit a rate → new project picks it up, existing unaffected, reload restores; commit + Slice-2 handoff |

> **Step 0 of Phase A:** this §5/§7 rewrite (done 2026-06-07). Each phase ends with build+test
> green → commit → a 3–5 line handoff note in §9 for the next fresh window.

## 6. Guardrails (from AGENTS.md / CLAUDE.md)

- Plan mode → write plan to file → **user approval before any code**.
- Any schema change: **`supabase_schema.sql` first + user approval + invoke the supabase
  skill**; migrations run on a Supabase branch before main.
- DB access only through `src/lib/db.ts`; line-item writes only via the
  `save_estimate_line_items` RPC.
- `calculations.ts` is the sole calculation authority — never invent rates; the seed defaults
  ARE today's `constants.ts` values (no value drift on day one).
- Windows + PowerShell: short inline commands, script files for anything longer; no emoji in
  PowerShell scripts.

## 7. Exit criteria (slice 1)

- `rate_card` table seeded from `constants.ts`; `rateResolver.ts` chokepoint is the single source
  for default rates; **export ties out unchanged on day one** (seed == constants; existing
  `export-integrity.test.ts` reconciliation stays green).
- New tests: `rateResolver.test.ts` (prime/miss/unprimed/reset); day-one invariant
  (card-primed calc == constants-only calc); snapshot lifecycle (freeze on first save → edit card
  → reload → totals unchanged; staff `rateOverride` still wins on top); seed integrity (generated
  rows == rate-bearing constants lines, no null-rate lines).
- Admin can edit a rate at `/rates`; new projects pick it up; existing projects are unaffected;
  reload restores per-project snapshot + overrides.
- All DB via `db.ts`; schema change in `supabase_schema.sql` first; migration + backfill on a
  Supabase branch before main. `npm run build` + `npm run test` green before each commit.
- Committed; handoff note for Slice 2 (the 217 `estimate-catalog.json` unit prices).

## 9. Handoff log

### Phase A — Infra (no behavior change) — DONE 2026-06-07 (commit `4939409`)
- **Landed:** `rate_card` table + RLS (exact twin of `cost_code_map`) and
  `project_estimates.rate_card_snapshot` JSONB column in `supabase_schema.sql`;
  `scripts/generate-rate-card-seed.js` + `npm run generate-rate-card-seed` →
  `supabase_seed_rate_card.sql` (**44 rows**, all `source='seed'`, = today's constants);
  `src/lib/rateResolver.ts` (`primeRateCard` / `resolveCompanyRate(code, fallback)` /
  `resetRateCard`); `RateCardEntry` type; `getRateCard` / `updateRateCardEntry` (update-only,
  stamps `source='manual'`, validates rate finite ≥ 0) in `db.ts`. Tests: `rateResolver.test.ts`
  (6) + `rateCardSeed.test.ts` (4, drift guard vs constants). **Build + 239 tests green.**
- **DB state:** verified on a preview branch, then **applied to MAIN** (`nefvkrhbbkiqnpeabyqz`)
  as migration `rate_card_phase_a` (version `20260608023852`) + seed: 44 seed rows, 0 manual, 0 bad
  rates, snapshot column present, the 1 existing estimate untouched (snapshot = `{}`). Preview
  branch deleted (billing stopped). NOTE: branch changes were raw `execute_sql` (no migration
  recorded there), so the move-to-main was a direct apply of the identical verified SQL — not a
  Supabase branch-merge.
- **Next phase (B) must know:** nothing consumes the resolver or snapshot column yet (zero value
  change confirmed). Seed import uses Node 24 native TS type-stripping (no `tsx` dep added; harmless
  MODULE_TYPELESS warning on generate). The only new security advisor is `rate_card_write_policy`
  `USING(true)` — intentional, identical to `cost_code_map_write_policy` (plan §4.1). Phase B wires
  `rateLookup` into `calculations.ts` + composes the snapshot/card chain in the calc hooks and must
  run the §5.6 backfill (branch→main) BEFORE the Phase C editor goes live.

### Phase B — Wire-in + snapshot (no value change day one) — DONE 2026-06-08
- **Landed:** injected `RateLookup` param (default `(_, fb) => fb`) on `computePersonnelCosts` /
  `computeSiteOperations` — calc stays pure; the 4 rate-bearing reads now route through it.
  Calc hooks compose `lookup = (code, fb) => projectSnapshot[code] ?? resolveCompanyRate(code, fb)`
  (staff `rateOverrides[role.key]` still wins on top). `rateResolver.snapshotRateCard()`; new
  `useRateCardSnapshot` hook (freeze-at-first-save, idempotent); `getRateCard` added to the
  `useTakeoffWorkbook` mount `Promise.all` → `primeRateCard` + visibilitychange re-prime;
  `rate_card_snapshot` wired through `ProjectEstimate` type + `db.ts` load/save + persistence.
  Tests: `calculationsRateLookup.test.ts` (day-one invariant + freeze/override lifecycle) +
  `snapshotRateCard` cases in `rateResolver.test.ts`. **Build + 247 tests green** (was 239; +8).
- **DB state:** §5.6 backfill applied to MAIN (`nefvkrhbbkiqnpeabyqz`) as a value-neutral data-only
  UPDATE (sourced the JSON straight from the 44 seeded `rate_card` rows, no transcription). The 1
  existing estimate now has a 44-key snapshot `= ` the seeded card (verified `matches_seeded_card`).
  No DDL — the column already shipped in Phase A.
- **Next phase (C) must know:** the snapshot freezes on a NEW project's FIRST save (capture-at-save,
  not at mount — robust because saves fire well after the mount prime). `updateRateCardEntry`
  (db.ts) already validates + stamps `source='manual'`; the `/rates` editor only needs to call it,
  then `primeRateCard` with the refreshed `getRateCard` rows (mirror `/cost-codes`). Editing a rate
  affects FUTURE projects only — existing snapshots are immune (verified by the lifecycle test).

### Phase C — Editor (/rates page) — DONE 2026-06-08 — **SLICE 1 COMPLETE**
- **Landed:** `src/app/rates/page.tsx` — a grouped twin of `/cost-codes`. Loads via
  `getRateCard(MASTER_TEMPLATE_NAME)`, joins each card row back to the constants line defs
  (`src/lib/rateCardEditor.ts`: `RATE_LINE_DEFS` + `groupRateCardRows`) for label/unit/section,
  groups by the GC `section` fields + `SITE_OPS_SECTIONS` (unmatched card rows surface in a trailing
  group, never dropped), instant client-side search, inline numeric rate edit. Saves through the
  EXISTING `updateRateCardEntry` (no second write path); the UI mirrors its finite >= 0 gate via
  `parseRateInput` BEFORE writing; after save it re-fetches + `primeRateCard`s, plus a
  `visibilitychange` re-prime. Sidebar link added (`DollarSign`, next to Cost Code Mapping). NO
  schema change (table + column already on main). New tests: `rateCardEditor.test.ts` (join
  completeness, grouping order, unmatched surfacing, `parseRateInput` gate). **Build + 255 tests
  green** (was 247; +8). The new-project-picks-up / existing-frozen / override-wins lifecycle was
  already proven in Phase B's `calculationsRateLookup.test.ts`.
- **Slice 1 exit (§7) met:** card seeded from constants; `rateResolver` is the single company-default
  chokepoint; export ties out unchanged (export-integrity stays green); admin can edit at `/rates`,
  future projects pick it up, existing are immune. All DB via `db.ts`; no `supabase.ts` import in the
  page.

### → Slice 2 handoff (separate later plan — NOT started)
- **Scope:** the **217 STEP 4 takeoff unit prices** (`defaultUnitPrice` in
  `src/data/estimate-catalog.json`, flowing through `parser.ts` / catalog row-init), folded into the
  SAME `rate_card` table + SAME mechanism (seed → snapshot → `resolveCompanyRate` chokepoint →
  `/rates` editor). Bigger/messier: many `$0` placeholders; the key namespace must extend cleanly
  (catalog `itemId` vs the GC/Site Ops line `code` used in slice 1 — confirm no collision before
  seeding). Reuse `generate-rate-card-seed.js` (add a catalog source) and extend the `/rates` editor
  grouping (a STEP 4 / catalog section). The market-sector / `project_type` overlay tier (plan §3) is
  still designed-for, NOT built — add it as its own migration when wanted.

---

## 8. Kickoff prompt (paste into a fresh window, then it enters plan mode)

```
Plan the Company Rate Card + Admin Portal — SLICE 1 (GC/Site Ops rates) ONLY.
Enter plan mode. Read docs/plans/rate-card-admin-portal.md in full first
(esp. §2 current-state table, §4 settled decisions, §5 open questions).
Then read the gc-siteops handoff for context on the rate homes and the
chokepoint/seed precedent: the §13 handoff log of
docs/plans/gc-siteops-export-step2-step3.md (P3c resolveProcoreCode +
/cost-codes editor; P6 per-project staff overrides).

== CONTEXT ==
Takeoff Bridge is a single-company, estimate-only construction estimating
app (no Procore actuals feedback loop — confirmed). I'm the system architect
(non-developer — explain things plainly, mark a (Recommended) option on
every choice). The gc-siteops plan is COMPLETE; the next sprint lifts the
hard-coded default RATES out of constants.ts into an admin-editable,
DB-backed company rate card.

== ALREADY DECIDED (do not re-ask — see brief §4) ==
- No roles/permissions work up front (any authenticated user edits the card,
  like the existing /cost-codes editor); real admin gating is a later, separate
  concern.
- Build on a single rate-resolution chokepoint, seeded from today's
  constants.ts so NOTHING changes value on day one.
- Snapshot-at-creation: rate = projectOverride ?? projectSnapshot ??
  companyCard. Card edits apply to FUTURE projects only; pre-existing projects
  get a one-time backfill. An explicit per-project "refresh to current rates"
  action is a DEFERRED nicety.
- The card replaces the DEFAULT layer only; Phase 6B's per-project staff
  override stays on top. Lump-sum lines have no card rate.
- Line STRUCTURE stays in constants.ts; only VALUES move to the card.
- Slice 1 = GC/Site Ops rate-bearing lines ONLY. The 217 STEP 4 catalog unit
  prices are SLICE 2 (separate later plan) — do not start them. A market
  sector / project_type overlay is designed-for but NOT built in slice 1.

== WHAT TO PRODUCE IN PLAN MODE ==
Resolve the §5 open questions WITH me (snapshot storage shape; rate-card
table shape + future sector key; seed/sync script; the /rates editor page;
chokepoint placement keeping calculations.ts pure; pre-existing-project
backfill). Present an implementation plan table for my approval BEFORE any
code. Any schema change: supabase_schema.sql first + my approval + invoke the
supabase skill; migrations on a Supabase branch before main. npm run build +
npm run test green before delivery.

Then write the detailed slice-1 plan into docs/plans/rate-card-admin-portal.md
(replacing this brief's §5/§7 with the agreed design + phasing), get my
approval, and stop — do not implement until I approve the plan.
Model: Claude Opus (latest).
```

### → Phase A (infra — schema + seed + chokepoint; safe, no behavior change)

```
Implement PHASE A ONLY of docs/plans/rate-card-admin-portal.md. Read the whole
file first — especially §4 (settled decisions) and §5 (agreed design + phasing).
This is a phased plan: do Phase A and nothing else, then stop. Phase B (wire-in
+ snapshot) and Phase C (/rates editor) are separate fresh windows.
== CONTEXT ==
Takeoff Bridge is a single-company, estimate-only construction estimating app.
I'm the system architect (non-developer — explain plainly, mark a (Recommended)
option on every choice). Slice 1 lifts the ~44 hard-coded GC/Site Ops default
rates out of constants.ts into a DB-backed company rate card, built as a twin of
the /cost-codes feature. Seed values ARE today's constants → nothing changes
value on day one.
== PHASE A SCOPE (per §5.2/§5.3/§5.5) ==
1. supabase_schema.sql FIRST: add the `rate_card` table + RLS (twin of
   cost_code_map) and the `project_estimates.rate_card_snapshot` JSONB column.
   Present the DDL for my approval; invoke the supabase skill; run the migration
   on a Supabase branch before main.
2. scripts/generate-rate-card-seed.js (twin of generate-cost-code-map-seed.js):
   insert-only (ON CONFLICT DO NOTHING), source='seed', imports the constants.ts
   typed arrays via tsx. Add the npm script. Generate supabase_seed_rate_card.sql
   and apply it on the branch.
3. src/lib/rateResolver.ts (twin of costCodeResolver.ts): primeRateCard /
   resolveCompanyRate(code, fallback) / resetRateCard. RateCardEntry type in
   src/types/db.ts. getRateCard / updateRateCardEntry in src/lib/db.ts
   (update-only, stamps source='manual', validate rate is finite ≥ 0).
4. Tests: rateResolver.test.ts; seed-integrity (generated rows == rate-bearing
   constants lines; no null-rate lines).
== GUARDRAILS ==
- DB access only through src/lib/db.ts; schema change in supabase_schema.sql
  first + my approval; migration on a branch before main.
- Do NOT wire the resolver into calculations.ts or the hooks yet (that is Phase
  B) — Phase A adds the infra but nothing consumes it, so zero value change.
- Windows + PowerShell: short inline commands; script files for anything longer.
== EXIT ==
- npm run build + npm run test green; DB has rate_card seeded on the branch;
  commit; append a 3–5 line handoff note to §9. Then STOP.
Model: Claude Opus (latest).
```

### → Phase B (wire-in + snapshot; still no value change day one)

```
Implement PHASE B ONLY of docs/plans/rate-card-admin-portal.md. Read the whole
file first — especially §4 (settled decisions), §5.5/§5.6 (chokepoint + snapshot
+ backfill), the §5.8 phasing table, and the §9 Phase A handoff note. This is a
phased plan: do Phase B and nothing else, then stop. Phase C (/rates editor) is a
separate fresh window.
== CONTEXT ==
Takeoff Bridge is a single-company, estimate-only construction estimating app.
I'm the system architect (non-developer — explain plainly, mark a (Recommended)
option on every choice). Slice 1 lifts the ~44 hard-coded GC/Site Ops default
rates into a DB-backed company rate card. The seed equals today's constants, so
NOTHING changes value on day one — Phase B must preserve that exactly.
== WHAT PHASE A ALREADY SHIPPED (commit ff6985c; do NOT redo) ==
- rate_card table (44 seeded rows) + project_estimates.rate_card_snapshot JSONB
  column are LIVE ON MAIN (migration rate_card_phase_a). Schema source of truth
  supabase_schema.sql already updated.
- src/lib/rateResolver.ts exists: primeRateCard(entries) /
  resolveCompanyRate(code, fallback) / resetRateCard. Company layer ONLY; returns
  fallback on miss/unprimed. calculations.ts still imports NOTHING from it.
- db.ts: getRateCard(templateName) + updateRateCardEntry(...) exist; RateCardEntry
  type in src/types/db.ts. Nothing consumes any of it yet.
== PHASE B SCOPE (per §5.5/§5.6) ==
1. calculations.ts stays PURE: give computePersonnelCosts / computeSiteOperations
   an injected `rateLookup: (code, fallback) => number = (_, fb) => fb` param.
   Replace every direct rate read (role.defaultRate, expense.rate, cfg.rate) with
   rateLookup(line.code, <constants default>). Default param returns fallback, so
   existing callers/tests stay byte-identical.
2. Calc hooks compose the layered lookup: in usePersonnelCalculations /
   useInfrastructureCalculations build
   lookup = (code, fallback) => projectSnapshot[code] ?? resolveCompanyRate(code, fallback).
   Full staff chain: rateOverrides[role.key] ?? projectSnapshot[code] ??
   companyCard[code] ?? constantsDefault (staff overrides ride gc_utilization, Phase 6B).
3. Prime the card: add getRateCard to the existing Promise.all in
   useTakeoffWorkbook.tsx (next to getCostCodeMap) → primeRateCard; re-prime on
   visibilitychange (mirror the cost-code resolver wiring).
4. Snapshot persistence + freeze-at-first-save: add rate_card_snapshot to the
   ProjectEstimate type + db.ts load/save mapping. Hook holds rateCardSnapshot
   state (init from loaded estimate; if empty and card primed, capture a copy of
   the current card; persist every save, idempotent once frozen).
5. Backfill (data-only — schema already on main): UPDATE project_estimates SET
   rate_card_snapshot = '<full seeded card JSON>' WHERE rate_card_snapshot = '{}'
   OR rate_card_snapshot IS NULL. Only ~1 existing estimate; seed==constants so
   value-neutral. supabase skill; verify on main (no branch dance needed since
   the schema already landed there in Phase A — but confirm with me first).
== GUARDRAILS ==
- DB access only through src/lib/db.ts; line items only via save_estimate_line_items.
- calculations.ts is the sole calc authority — never invent rates; the injected
  default MUST return the fallback so day-one totals are byte-identical.
- No new schema change expected (the column already exists). If you think you need
  one, stop and ask.
- Windows + PowerShell: short inline commands; script files for anything longer.
== EXIT (per §5.8 + §7) ==
- npm run build + npm run test green. New tests: day-one invariant (card-primed
  calc == constants-only calc); snapshot lifecycle (freeze on first save → edit
  card → reload → totals unchanged; staff rateOverride still wins on top). Existing
  export-integrity reconciliation stays green (ties out unchanged).
- Backfill applied + verified on main; commit; append a 3–5 line handoff note to
  §9 for Phase C. Then STOP.
Model: Claude Opus (latest).
```

### → Phase C (the /rates editor — pure UI on finished infra; LAST phase of Slice 1)

```
Implement PHASE C ONLY of docs/plans/rate-card-admin-portal.md. Read the whole
file first — especially §4 (settled decisions), §5.4 (the /rates editor design),
the §5.8 phasing table, §7 (exit criteria), and the §9 Phase A + Phase B handoff
notes. This is a phased plan: do Phase C and nothing else, then stop. This is the
LAST phase of Slice 1 — finish with the Slice-2 handoff note.
== CONTEXT ==
Takeoff Bridge is a single-company, estimate-only construction estimating app.
I'm the system architect (non-developer — explain plainly, mark a (Recommended)
option on every choice). Slice 1 lifts the ~44 hard-coded GC/Site Ops default
rates into a DB-backed company rate card. Phase C adds the admin-facing /rates
editor — built as a TWIN of the existing /cost-codes page. Editing a rate must
affect FUTURE projects only; existing estimates are frozen by their snapshot
(already proven in Phase B).
== WHAT PHASES A+B ALREADY SHIPPED (commits ff6985c + 86110c9; do NOT redo) ==
- rate_card table (44 seeded rows, source='seed', = today's constants) live on
  MAIN; project_estimates.rate_card_snapshot column + backfill done. No schema
  change is expected in Phase C — if you think you need one, stop and ask.
- db.ts: getRateCard(templateName) (read) and updateRateCardEntry(templateName,
  lineCode, rate) ALREADY EXIST. updateRateCardEntry is update-only, stamps
  source='manual', and ALREADY validates the rate is a finite number >= 0 and
  throws on no-row-updated. Do NOT add a second write path.
- rateResolver.ts: primeRateCard / resolveCompanyRate / snapshotRateCard /
  resetRateCard. The workspace (useTakeoffWorkbook) already re-primes the card on
  visibilitychange, so a /rates save in another tab propagates to open projects
  automatically — no workspace changes needed in Phase C.
- The card is consumed by calc as of Phase B. Phase C is PURE UI on top of
  finished infrastructure.
== PHASE C SCOPE (per §5.4) ==
1. src/app/rates/page.tsx — a near-clone of src/app/cost-codes/page.tsx:
   - Load rows via getRateCard(MASTER_TEMPLATE_NAME).
   - The card keys by line `code`; JOIN each card row back to the constants line
     definitions (STAFF_ROLE_DEFAULTS, OPERATIONAL_EXPENSE_DEFAULTS, the
     entry:"qty" rows of GC_MANUAL_DEFAULTS, SITE_OPS_DYNAMIC_DEFAULTS, the
     entry:"qty" rows of SITE_OPS_MANUAL_DEFAULTS) to show label / unit / section.
     A card row with no matching constants line should surface, not silently drop.
   - Group rows by section: the GC configs' `section` fields + SITE_OPS_SECTIONS
     (Site Ops). Instant client-side search. Inline single-row rate edit.
   - Save via updateRateCardEntry(...); mirror the editor's finite >= 0 validation
     in the input UI BEFORE calling (no unvalidated writes); after a successful
     save, re-prime via primeRateCard(await getRateCard(...)). Add a
     visibilitychange re-prime (mirror /cost-codes).
2. Add a Sidebar link to /rates in src/components/layout/Sidebar.tsx (next to the
   /cost-codes link).
== GUARDRAILS ==
- DB access only through src/lib/db.ts; line items only via save_estimate_line_items
  (not touched here). Do NOT import supabase.ts directly in the page.
- calculations.ts is the sole calc authority — the /rates page only edits the
  company-default layer via the existing updateRateCardEntry; never invent rates
  and never touch the per-project snapshot or staff-override layers.
- No schema change expected (table + column already on main). If you think you
  need one, stop and ask.
- Windows + PowerShell: short inline commands; script files for anything longer.
== EXIT (per §5.8 + §7) ==
- npm run build + npm run test green. New tests: editing a rate at /rates updates
  the card (source becomes 'manual'); a NEW project picks the edit up; an existing
  project is unaffected (snapshot wins); reload restores the per-project snapshot +
  overrides. Existing export-integrity reconciliation stays green.
- Commit; then append a 3–5 line §9 handoff note that (a) records Phase C done +
  Slice 1 COMPLETE, and (b) hands off Slice 2 (the 217 estimate-catalog.json STEP 4
  unit prices — same mechanism, separate later plan). Then STOP.
Model: Claude Opus (latest).
```
