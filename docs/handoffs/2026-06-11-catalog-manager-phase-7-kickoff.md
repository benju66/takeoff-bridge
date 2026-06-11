# Kickoff — Catalog Manager, Phase 7 (/catalog "Add STEP 4 code" UI + drift honesty)

> Paste the prompt at the bottom as the first message of a fresh session. One phase
> per fresh session (per `feedback-one-phase-per-fresh-session`). Plan of record (all
> forks locked): `docs/plans/catalog-manager.md` — re-read §Phase 7; it is the
> authority. Phase 7 is the **FINAL** phase of this plan and has **NO ⛔ approval
> gate** (UI + wiring only; no DDL). Close it with the roadmap-memory update.

## Phase 6 BUILD STATUS — DONE (commit `b846bc2`, on local main, NOT pushed)

The `catalog_additions` table + db layer + resolver overlay shipped exactly per plan,
self-contained as locked. Suite **627 pass / 58 files** (was 597/56 — +19 db tests,
+11 overlay tests, +2 files); goldens McKenna + synthetic + CARE tie **$0.00**;
`npx tsc --noEmit` clean; `npm run build` clean (all 11 routes); `/code-review` clean.

### What shipped (the surface Phase 7 builds the UI on top of)
- **⛔ DDL applied live** to `nefvkrhbbkiqnpeabyqz` (schema file first, architect-approved):
  new **Table 15 `catalog_additions`** — `item_id` PK (catalog-code shape CHECK),
  `description` (non-empty), `target_uom`, `default_unit_price` (negatives allowed),
  `cost_type` (L/M/S CHECK), `procore_code` (NOT NULL, app-validated to the Importer
  list), `status` ('active'/'landed'), `source` ('catalog_manager'/'manual'), audit
  cols + an `updated_at` touch trigger (`search_path=''` → advisor clean). RLS
  SELECT + INSERT + UPDATE, modeled on Table 14. **Security advisors 6 → 8 WARN** —
  only the two precedented `rls_policy_always_true` twins (INSERT + UPDATE); SELECT
  USING(true) is intentionally not flagged. No new categories, no ERROR.
- **`src/types/db.ts`**: `CatalogAddition` + `CatalogAdditionStatus` ('active'|'landed').
- **`src/lib/catalog.ts`**: `isBuiltInCatalogCode(itemId)` (built-ins ONLY — the
  collision oracle) + `catalogAdditionToItem(row)` (→ `InternalEstimateItem`; the
  single projection the catalog + both resolver overlays consume).
- **`src/lib/db.ts`** (the db layer Phase 7's UI calls):
  - `getCatalogAdditions()` — throws; **consumers fail-soft** (`.catch(() => [])`).
  - `createCatalogAddition({ itemId, description, targetUom?, defaultUnitPrice?,
    costType?, procoreCode })` — validates shape + non-empty description + L/M/S cost
    type + finite price (negatives OK) + Procore-list membership + built-in/addition
    collision BEFORE the write; 23505 race → clean "already exists". **This is the
    add-form write.**
  - `updateCatalogAddition({ itemId, description?, targetUom?, defaultUnitPrice?,
    costType?, procoreCode?, status? })` — partial patch; same per-field validation;
    `status: 'landed'` is the **mark-landed** write. `updated_at` owned by the trigger.
- **`src/lib/costCodeResolver.ts` / `src/lib/rateResolver.ts`**: SEPARATE additions
  overlay slots (`primeCostCodeAdditions` / `primeCatalogPriceAdditions`) so a
  workspace re-prime from the tables never wipes them; a built-in (`cost_code_map` /
  `rate_card`) ALWAYS wins a code collision; `reset*` clears the overlays. The
  GC/Site-Ops `resolveCompanyRate` path is UNTOUCHED (additions layer only into
  `resolveCatalogPrice`), so all golden math is byte-identical.
- **Prime wiring at the two ROW-BIRTH sites only** — `useTakeoffWorkbook` mount +
  the import page — each fetches additions fail-soft and primes `primeCatalogAdditions`
  + both resolver overlays BEFORE row init.

### Carried notes / watch-fors for Phase 7
- **/cost-codes + /rates are NOT yet primed** (Phase 6 deliberately wired only the
  row-birth sites). Phase 7 adds their prime wiring alongside their read-only
  addition-row display (plan §Phase 7). The prime is a pure 3-call block —
  `primeCatalogAdditions(items)` + `primeCostCodeAdditions(items)` +
  `primeCatalogPriceAdditions(items)` where `items = additions.map(catalogAdditionToItem)`.
  Consider extracting a shared `primeCatalogAdditionOverlays(additions)` helper now
  that there'd be 4 sites (it's currently duplicated at 2; matching the existing
  `primeCostCodeResolver` idiom — a small, optional consolidation).
- **/rates module-load consumers** (`rateCardEditor`'s `RATE_SECTION_ORDER` /
  `RATE_LINE_DEFS`) read `getCatalogItems()` ONCE at import time — they will NOT see
  a later prime. For additions to appear as /rates SECTIONS, Phase 7 must either
  rebuild those defs after priming or use the fail-soft async-refresh idiom on the
  page. This is the plan §Risks "reads at module-load the prime can't reach" item —
  decide it in Phase 7.
- **Procore BLI picker oracle**: the add form's required BLI picker should consume
  `PROCORE_VALID_CODES` / `isValidProcoreCode` from `src/lib/procoreValidCodes.ts` —
  the same oracle the /cost-codes editor + export override modal use (db.ts already
  validates against it, so an invalid pick is rejected at the write too).
- **/catalog page** already exists (`src/app/catalog/page.tsx`, Phases 3–4 — custom
  GC/Site-Ops management + promotion). Phase 7 ADDS the STEP 4 section to it; mirror
  the existing page idiom (the custom-def table + inline edit + the /cost-codes
  picker pattern). The add form validates code shape + built-in/addition collision
  client-side for clean messages (the same rules `createCatalogAddition` enforces).
- **Drift guard, made honest in-app** (plan §Phase 7): a banner (the /cost-codes
  divergence idiom) lists ACTIVE additions "not yet in
  `templates/Company_Estimate_Template.xlsx` — add the row to STEP 4 and re-run
  `npm run sync-codes`". When a fresh harvest ships an addition's code in
  `estimate-catalog.json` (i.e. `isBuiltInCatalogCode(itemId)` is now true), offer
  one-click **"mark landed"** → `updateCatalogAddition({ itemId, status: 'landed' })`
  (the built-in then wins the overlay by construction). The
  `catalogManualAdditions.test.ts` pattern STAYS for the 6 pre-plan codes; additions
  made through the app need no per-code test — the banner replaces it.
- **The 6 pre-plan manual codes** still need their STEP 4 rows hand-added to
  `templates/Company_Estimate_Template.xlsx` (architect's hands) + a `sync-codes`
  re-run — this plan does NOT absorb that task, but Phase 7's banner machinery is
  built so the NEXT batch never recurs; the drift-guard test keeps the loss loud
  until then.
- **Pre-existing, NOT mine — do NOT stage in the Phase 7 commit:**
  `M .claude/settings.json`, `M .claude/skills/handoff|plan-phases/SKILL.md`,
  untracked `docs/plans/database-fidelity.md` and `docs/{handoffs,plans}/archive/`.

## Phase 7 scope (from the plan — re-read `docs/plans/catalog-manager.md` §Phase 7; it is the authority)
- `/catalog` gains the STEP 4 section: **add form** (code with shape + collision
  validation, description, UOM, default unit price, cost type, required Procore BLI
  picker → `createCatalogAddition`), **list** of additions with status badges +
  inline edit (→ `updateCatalogAddition`).
- **Drift banner** + one-click "mark landed" (as above).
- `/cost-codes` + `/rates` display addition rows **read-only-sourced from the
  overlay** (mapping/price edits for additions happen on /catalog, their home table)
  — including their prime wiring + the /rates module-load decision.

## Gates
**NO DDL / approval gate** (UI + wiring only). Exit: suite green (**627/58 baseline**);
goldens tie $0.00; `npx tsc --noEmit` clean; `/code-review` + `npm run build` clean;
multi-line commit via message FILE + `git commit -F` (per `feedback-commit-via-message-file`);
**NO push to origin** without architect say-so. **Closure handoff** updating the
import-roadmap memory (`catalog-manager-plan.md` → mark P1–P7 COMPLETE; this plan is
then done). Stop at the phase boundary — there is no Phase 8.

## Phase 7 kickoff prompt

> Read `docs/plans/catalog-manager.md` (plan of record, forks locked) and
> `docs/handoffs/2026-06-11-catalog-manager-phase-7-kickoff.md` (Phase 6 build status),
> then execute **Phase 7 only** — the FINAL phase: the `/catalog` "Add STEP 4 code"
> UI + drift honesty. Add to `src/app/catalog/page.tsx` a STEP 4 section: an add form
> (code with shape + built-in/addition collision validation, description, UOM, default
> unit price, cost type, required Procore BLI picker over `PROCORE_VALID_CODES`) wired
> to `createCatalogAddition`, and a list of additions with status badges + inline edit
> wired to `updateCatalogAddition`. Add the drift banner (the /cost-codes divergence
> idiom) listing active additions not yet in `templates/Company_Estimate_Template.xlsx`,
> with one-click "mark landed" (`updateCatalogAddition status='landed'`) once
> `isBuiltInCatalogCode` is true for a code. Wire the `primeCatalogAdditions` + both
> resolver-overlay primes into `/cost-codes` and `/rates` and display addition rows
> read-only there (mapping/price edits stay on /catalog); decide the /rates
> module-load `RATE_SECTION_ORDER` rebuild vs async-refresh (plan §Risks). This phase
> has NO DDL/approval gate. Baseline: suite 627 pass / 58 files; goldens McKenna +
> synthetic + CARE tie $0.00. Exit: suite + new tests green, `npx tsc --noEmit` clean,
> `/code-review` + `npm run build` clean, committed via `git commit -F <tempfile>`
> (do NOT stage `.claude/*` or `docs/*` pre-existing changes), then close with a
> CLOSURE handoff updating the `catalog-manager-plan` memory to mark P1–P7 COMPLETE.
> Do NOT push to origin. Stop at the phase boundary — this plan is then done.
