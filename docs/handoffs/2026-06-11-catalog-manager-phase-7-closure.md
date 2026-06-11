# Closure — Catalog Manager, Phase 7 (FINAL) — plan COMPLETE

> The Catalog Manager plan of record (`docs/plans/catalog-manager.md`) is now
> **fully delivered: P1–P7 COMPLETE**. There is no Phase 8. This file closes the
> workstream. Nothing is pushed to origin (per the standing instruction).

## Phase 7 BUILD STATUS — DONE (commit `39bb099`, on local main, NOT pushed)

The `/catalog` "Add STEP 4 code" UI + drift honesty shipped exactly per plan, with
NO DDL / approval gate (UI + wiring only). Suite **633 pass / 59 files** (was
627/58 — +4 drift-oracle tests in `catalog.test.ts`, +2 prime-helper tests in the
new `catalogAdditionOverlays.test.ts`); goldens McKenna + synthetic + CARE tie
**$0.00**; `npx tsc --noEmit` clean; `npm run build` clean (all 11 routes);
`npm run lint` clean for every touched file; `/code-review` run inline.

### What shipped
- **`src/lib/catalog.ts`** — `catalogAdditionDriftState(a)` →
  `'reconciled' | 'landed-ready' | 'drifted'`, read from the BUILT-INS only
  (`isBuiltInCatalogCode`) so the answer is stable regardless of what is primed.
- **`src/lib/catalogAdditionOverlays.ts`** (new) — `primeCatalogAdditionOverlays(additions)`
  primes all three overlays (`primeCatalogAdditions` + `primeCostCodeAdditions` +
  `primeCatalogPriceAdditions`) in one call. The two Phase-6 row-birth sites
  (`useTakeoffWorkbook` mount, import page) were refactored to call it — **5 sites,
  one helper**, so no site can ever prime only some of the three overlays.
- **`src/app/catalog/page.tsx`** — added `Step4CatalogSection` (+ `AddStep4CodeForm`,
  `Step4AdditionRow`, co-located like `MergePanel`), mounted unconditionally below
  the custom-codes table with its own fail-soft load:
  - **Add form** → `createCatalogAddition`. Client-side validation mirrors the db
    gate (shape via `isStep23DeterministicCode`, built-in collision via
    `isBuiltInCatalogCode`, addition collision via the loaded list, non-empty
    description, finite price w/ negatives ok, L/M/S, required Procore BLI over
    `PROCORE_VALID_CODES`) for clean instant messages; db.ts stays authoritative.
  - **List** with ACTIVE/LANDED badges + a drift chip (NOT IN TEMPLATE / IN
    TEMPLATE) and inline edit (description, UOM, price, cost type, Procore BLI) →
    `updateCatalogAddition`. Landed rows are frozen (built-in supersedes).
  - **Drift banner** (rose) lists drifted additions ("add the STEP 4 row to
    `templates/Company_Estimate_Template.xlsx` + re-run `npm run sync-codes`") and
    a reconciliation banner (blue) with one-click **mark landed** →
    `updateCatalogAddition({ status: 'landed' })` for each `landed-ready` code.
  - On create/edit the overlays are re-primed so the change is live in-session.
- **`src/app/cost-codes/page.tsx`** — fail-soft prime + a dedicated READ-ONLY
  "In-app catalog additions" section (code → Procore BLI + description, link to
  /catalog). The divergence banner is now scoped to `isBuiltInCatalogCode` (not the
  primed overlay), so an overlay-resolved addition is never a false "missing from
  map" gap regardless of prime timing, while a LANDED addition that is now a real
  built-in still surfaces if its `cost_code_map` row is missing.
- **`src/app/rates/page.tsx`** — fail-soft prime + a dedicated READ-ONLY "In-app
  catalog additions" section (code, description, unit, default unit price).

### /rates module-load decision (plan §Risks — decided here)
Chose the **page-level read-only section (fail-soft async-refresh idiom)** over
mutating the module-load `RATE_SECTION_ORDER` / `RATE_LINE_DEFS`. Rationale: those
globals are workspace-independent and read `getCatalogItems()` once at import, so a
prime can't reach them — AND a rebuild still wouldn't render addition rows
(additions have no `rate_card` entry). A dedicated read-only section sourced from
the fetched list is simpler, lower-risk, and faithful to "read-only-sourced from
the overlay". The §Risks "reads at module-load the prime can't reach" item is thus
resolved without touching the module globals.

### Carried notes (unchanged by this phase)
- **The 6 pre-plan manual codes** still need their STEP 4 rows hand-added to the
  master template + a `sync-codes` re-run. `catalogManualAdditions.test.ts` keeps
  that loss loud; the new in-app banner is what makes the NEXT batch never recur.
- **Server-side write consolidation** stays ONE future job (now spanning
  cost_code_map, rate_card, custom_step23_line_defs, and catalog_additions).
- **Security advisors** unchanged by Phase 7 (no DDL) — still the two precedented
  `rls_policy_always_true` twins on catalog_additions from Phase 6.

### Pre-existing changes deliberately NOT committed (left in the working tree)
`M .claude/settings.json`, `M .claude/skills/handoff|plan-phases/SKILL.md`,
untracked `docs/plans/database-fidelity.md`, `docs/{handoffs,plans}/archive/`, and
the Phase 7 kickoff/closure docs. The commit `39bb099` is the 9 `src/*` files only.

## The plan is done
P1 lifecycle layer · P2 lifecycle DDL + write surface · P3 manage-custom UI ·
P4 thin promotion · P5 catalog chokepoint · P6 catalog_additions DDL + overlay ·
P7 add-code UI + drift honesty — **all COMPLETE**. The next catalog/import session
starts a NEW workstream (architect picks from the remaining import roadmap: items
2 past-vs-active, 3 housekeeping, 5 fork-a-past-bid) — begin with `/plan-phases`.
