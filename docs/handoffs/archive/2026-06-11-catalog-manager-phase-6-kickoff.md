# Kickoff — Catalog Manager, Phase 6 (catalog_additions DDL ⛔ + db layer + resolver overlay)

> Paste the prompt at the bottom as the first message of a fresh session. One phase
> per fresh session (per `feedback-one-phase-per-fresh-session`). Plan of record (all
> forks locked): `docs/plans/catalog-manager.md` — re-read it; it is the authority.
> Phase 6 **HAS a ⛔ approval gate**: the new `catalog_additions` table DDL + its RLS
> policies. Write `supabase_schema.sql` FIRST, show the exact SQL, **STOP for architect
> sign-off**, then apply live. Do NOT chain into Phase 7 (Add-code UI + drift banner).

## Phase 5 BUILD STATUS — DONE (commit `481c92f`, on local main, NOT pushed)

The STEP 4 catalog chokepoint shipped exactly per plan — a **pure identity refactor**,
no scope drift. Suite **597 pass / 56 files** (was 591/55 — +6 catalog identity tests,
+1 file); goldens McKenna + synthetic + CARE tie **$0.00**; `npx tsc --noEmit` clean;
`npm run build` clean (all 11 routes generate); `/code-review` clean (no findings).

### What shipped
- **New `src/lib/catalog.ts`** — the single runtime source for STEP 4 catalog items.
  Built-ins come from `ESTIMATE_ITEMS_MASTER`; primed additions layer in via the
  `primeCostCodeResolver` / `primeRateCard` pattern. **API:**
  - `getCatalogItems(): Record<string, InternalEstimateItem>` — nothing primed ⇒ the
    **exact `ESTIMATE_ITEMS_MASTER` reference** (byte-identical). With additions primed,
    additions layer first and built-ins overwrite colliding codes (**built-in always
    wins**, architect-locked).
  - `primeCatalogAdditions(items)` — empty list treated as nothing-primed (identity holds).
  - `resetCatalog()` — test-only cache clear.
- **~12 consumers migrated** to the chokepoint (was direct `ESTIMATE_ITEMS_MASTER`):
  `parser`, `importEstimate`, `assignCode`, `costCodeResolver` (catalog-fallback path),
  `rateCardEditor` (module-load `RATE_SECTION_ORDER` / `RATE_LINE_DEFS`),
  `useTakeoffWorkbook`, `useCellEditing`, `EstimateTable`, and the `registry` /
  `cost-codes` / `import` pages. `similarity.ts` used it only as a TYPE — its param is
  now `Record<string, InternalEstimateItem>` (no runtime read; dropped the mock-data import).
- **`src/lib/mock-data.ts` unchanged** — still exports `ESTIMATE_ITEMS_MASTER` as the
  built-in source; **test files still import it directly** (they assert against built-ins).
- **New test `src/lib/__tests__/catalog.test.ts`**: identity (reference + deep-equal),
  empty-prime identity, non-colliding overlay, built-in-wins collision, reset restores.

### Carried notes / watch-fors for Phase 6
- **Where to prime (the whole point of Phase 5):** Phase 6 wires `primeCatalogAdditions`
  at the SAME prime sites the existing `primeCostCodeResolver` / `primeRateCard` calls
  live (grep those call sites — workspace mount, import page, /rates, /cost-codes). The
  self-contained-resolution fork means an addition carries its OWN `procore_code` +
  `default_unit_price`, so the **cost-code resolver overlays `procore_code`** and the
  **catalog-price resolver overlays `default_unit_price`** for addition itemIds —
  `cost_code_map` and `rate_card` get **NO** policy widening for adds (only the new
  `catalog_additions` policies are the flagged widening).
- **Module-load consumers** (`rateCardEditor`'s `RATE_SECTION_ORDER` / `RATE_LINE_DEFS`
  consts) read the catalog ONCE at import time — they will NOT see a later prime. This is
  the plan §Risks "reads at module-load the prime can't reach" item. For additions to
  reach /rates sections, Phase 6/7 must either rebuild those defs on prime or use the
  fail-soft async-refresh idiom on the affected page. Decide this in Phase 6/7, not before.
- **Collision ordering nuance** (only matters once primed): when an addition's code
  collides with a built-in, `Object.assign(merged, ESTIMATE_ITEMS_MASTER)` keeps the
  built-in's VALUE (correct — built-in wins) but the key sits at the addition's insertion
  position. Irrelevant to dollars; note it if picker order ever matters.
- Pre-existing, NOT mine, leave alone (do not stage in the Phase 6 commit):
  `M .claude/settings.json`, `M .claude/skills/handoff|plan-phases/SKILL.md`,
  untracked `docs/plans/database-fidelity.md` and `docs/{handoffs,plans}/archive/`.

## Phase 6 scope (from the plan — re-read `docs/plans/catalog-manager.md` §Phase 6; it is the authority)

- ⛔ **New table `catalog_additions`** (working name): `item_id` PK (catalog code shape
  CHECK), `description`, `target_uom`, `default_unit_price`, `cost_type` (L/M/S CHECK),
  `procore_code` (NOT NULL — an addition names a valid Procore destination at birth;
  validated app-side against the Importer list), `status` ('active'/'landed'), source +
  audit columns. RLS: SELECT + INSERT + UPDATE (corporate data, modeled on Table 14) —
  the new-table policies ARE the flagged widening. `supabase_schema.sql` first, exact
  SQL, **STOP for sign-off**, then apply live. Verify supabase advisors stay at baseline
  (expect one `rls_policy_always_true` twin per always-true policy, matching precedent).
- **Self-contained resolution (no cost_code_map / rate_card writes):** the cost-code
  resolver overlays an addition's `procore_code`; the catalog-price resolver overlays its
  `default_unit_price` for addition itemIds. Built-in tables stay template-seeded only.
- **`src/lib/db.ts`:** `getCatalogAdditions` (fail-soft consumers — `.catch` to []),
  `createCatalogAddition` (shape + built-in/addition collision + Procore-list validation),
  `updateCatalogAddition`. Prime wiring into Phase 5's `primeCatalogAdditions` chokepoint
  + both resolvers at the existing prime sites.
- **Tests:** db layer (mirror the custom-def db test idiom) + resolver-overlay, including:
  an addition's price reaches row birth via the existing **freeze-at-birth** path and
  **never retro-moves a saved row** — goldens unchanged ($0.00).

## Gates
⛔ **DDL approval gate**: `catalog_additions` table + policies. Schema file FIRST, exact
SQL shown, **STOP** for explicit architect sign-off before ANY live change; carry the
consolidated server-side-writes follow-up note. Then: suite green (**597/56 baseline**);
goldens tie $0.00; `npx tsc --noEmit` clean; `/code-review` + `npm run build` clean;
multi-line commit via message FILE + `git commit -F` (per `feedback-commit-via-message-file`);
**NO push to origin** without architect say-so. Invoke the `supabase:supabase` skill before
touching DB code (per CLAUDE.md). Stop at the phase boundary; do not chain into Phase 7.

## Phase 6 kickoff prompt

> Read `docs/plans/catalog-manager.md` (plan of record, forks locked) and
> `docs/handoffs/2026-06-11-catalog-manager-phase-6-kickoff.md` (Phase 5 build status),
> then execute **Phase 6 only**: the `catalog_additions` table + db layer + resolver
> overlay. Invoke the `supabase:supabase` skill before any DB code. ⛔ This phase has a
> DDL approval gate: write the new `catalog_additions` table + RLS policies (SELECT +
> INSERT + UPDATE, corporate data, modeled on Table 14) into `supabase_schema.sql`
> FIRST, show the exact SQL, and STOP for my explicit sign-off before applying live;
> verify supabase advisors stay at baseline after. Then add `getCatalogAdditions`
> (fail-soft), `createCatalogAddition` (shape + collision + Procore-list validation),
> `updateCatalogAddition` to `src/lib/db.ts`; wire `primeCatalogAdditions` and the
> cost-code + catalog-price resolver overlays at the existing prime sites (additions are
> self-contained — they carry their own `procore_code` + `default_unit_price`, so
> cost_code_map / rate_card get NO widening). Add db + resolver-overlay tests, including
> the freeze-at-birth proof that an addition's price never retro-moves a saved row.
> Baseline: suite 597 pass / 56 files; goldens McKenna + synthetic + CARE tie $0.00.
> Exit: suite + new tests green, `npx tsc --noEmit` clean, `/code-review` + `npm run build`
> clean, committed via `git commit -F <tempfile>`, close with /handoff (do NOT push).
> Stop at the phase boundary; do not chain into Phase 7.
