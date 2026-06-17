# Catalog Manager — Plan of Record
_2026-06-11 · status: **APPROVED** (architect 2026-06-11; import-module roadmap
item 4) · baseline: suite 540 pass / 52 files · goldens McKenna + synthetic +
CARE tie $0.00_

## Goal
When this is done, the codes the company estimates with are managed inside the app
instead of by agent sessions and spreadsheet surgery. Concretely, on a new **/catalog**
admin page an estimator can: **edit** a minted custom GC/Site-Ops code's name, unit,
and Procore Budget Line Item (the BLI backfill); **retire** a code that should no
longer be offered; **merge** two near-duplicate custom codes so every bid — past and
future — shows the winner with no re-import; **promote** a custom code so /rates gains
the existing audited ADOPT path over its mined rate history; and **add** a brand-new
STEP 4 catalog code (description, UOM, unit price, cost type, Procore BLI) that works
everywhere immediately — pickers, import matching, row birth, mapping, rates — with no
redeploy and no agent session. Codes remain labels, resolver targets, and mining keys:
**no operation on this page ever moves a dollar.**

## Out of scope / deferred
- **Roadmap items 2, 3, 5** — past-vs-active distinction, housekeeping (shared
  `useCustomStep23Defs` hook + money formatter), fork-a-past-bid. Do not chain.
- **The in-flight database-fidelity plan** (`docs/plans/database-fidelity.md`) — no
  overlap; this plan touches only catalog/code tables, none of fidelity's targets.
- **Calculator visibility for promoted codes** (architect-locked 2026-06-11): a
  promoted code gets a rate_card row and ADOPT, nothing more. Putting custom lines
  into the GC/Site-Ops calculators touches the estimate engine and per-project
  snapshots — its own future plan, unblocked by (not part of) this one.
- **Rewriting stored bids** — `imported_step23_lines` stays write-once throughout.
  All merge/retire effects are render-time.
- **Server-side write consolidation** — the standing "move writes server-side
  (service-role only)" follow-up stays ONE consolidated future job, now covering
  cost_code_map, rate_card, custom_step23_line_defs, and the new additions table.
- **Renumbering tooling** — not needed as a feature: renumber = mint the new code,
  then merge the old one into it (Phases 2–3 give this for free).
- **Post-import assignment on already-saved imports; export-of-imports; lump-override
  mining** (unchanged from the review-gate plan).

## Locked decisions (architect, 2026-06-11)
- **Merge/retire = redirects + tombstones.** A merged or retired code's row stays in
  the DB. A merged code carries a pointer to its winner and the resolver follows it at
  render time — every old bid instantly shows the winning code; no stored payload is
  rewritten. A retired code keeps labeling its old lines (history intact) but leaves
  all pickers; its suffix is never reused. A merge target may be any ACTIVE def —
  custom or built-in (merging a redundant custom into the built-in it duplicated is
  the common repair).
- **Write path = browser UPDATE policy + database-side guard** on
  `custom_step23_line_defs`: the code (PK) is immutable, only legal status transitions
  are allowed, enforced by a trigger so no client bug can corrupt lifecycle state.
  Consistent with the cost_code_map / rate_card precedent; accepted single-company
  exposure, flagged loudly at the Phase 2 gate.
- **Promotion is thin: ADOPT only.** Opt-in rate_card row (⛔ one INSERT widening on
  rate_card) so /rates shows the code with its label/unit and the existing audited
  ADOPT path works. The adopted rate is a recorded company default awaiting future
  calculator integration. Promotion is one-way (no DELETE policy); retiring a promoted
  code keeps its card row, visibly flagged.
- **STEP 4 add = runtime catalog overlay.** A new additions table + a primed catalog
  chokepoint (the same prime pattern as `primeCostCodeResolver` / `primeRateCard`).
  In-app additions are **self-contained**: the addition row carries its own Procore
  code and default unit price, and the resolver chokepoints overlay it — so
  cost_code_map and rate_card need **no** policy widening for adds. Template-file
  drift is surfaced by an in-app "not yet in the template file" banner and reconciled
  at harvest time (an addition whose code appears in a fresh harvest is marked landed).
- **Codes never move dollars.** Every phase carries tests proving estimate totals and
  all three goldens are byte-identical before/after catalog operations.

## How it fits the guardrails
- Every DDL/RLS change lands in `supabase_schema.sql` FIRST, the exact SQL is shown,
  and the session **stops for sign-off** before any live change (⛔ gates below).
  Three widenings exist in this plan and each is flagged at its own gate:
  UPDATE on custom_step23_line_defs (Phase 2), INSERT on rate_card (Phase 4),
  the new catalog_additions table's policies (Phase 6).
- All DB access through `src/lib/db.ts`; `calculations.ts` stays the sole financial
  authority; resolver and lifecycle logic stay pure modules.
- `classification_history`, `estimate_snapshots`, `estimate_overrides` untouched;
  `imported_step23_lines` stays write-once (redirects make rewriting unnecessary).
- Suite + goldens green at every phase boundary; one phase per fresh session; close
  each phase with /handoff.

## Phases

### Phase 1 — Pure lifecycle layer (no DDL, no UI)
- **Scope:**
  - `src/types/db.ts`: additive `status?: 'active' | 'retired' | 'merged'` and
    `mergedInto?: string | null` on `CustomStep23LineDef` (absent = active — every
    existing row and code path degrades unchanged).
  - New pure module `src/lib/catalogLifecycle.ts`: legal-transition validation
    (active→retired, active→merged; merged requires a winner; winner must be an
    active def, custom or built-in, never itself), and the chain-collapse rule
    (merging X into Y re-points any existing redirect aimed at X to Y, so redirects
    are always one hop; the resolver still carries a hop guard).
  - `src/lib/step23Normalization.ts`: the overlay follows a merge redirect to the
    winning def; retired defs still resolve (old lines keep their label) but a new
    `activeStep23Defs` helper feeds pickers so retired/merged codes leave every
    dropdown; `suggestNextStep23Code` keeps counting retired/merged suffixes (never
    reused); `step23Observations` files merged codes' history under the winner and
    retired codes' history under themselves (report-only, unchanged).
  - Tests: lifecycle validation, redirect resolution, picker exclusion, suffix
    non-reuse, observation re-filing — plus the no-dollar-moves proof (goldens
    byte-identical with lifecycle states present).
- **Approval gates:** none (pure code + additive type fields, inert until Phase 2
  writes them).
- **Exit criteria:** `npm run test` green (540/52 baseline) · goldens tie $0.00 ·
  `npx tsc --noEmit` clean · committed (`git commit -F <tempfile>`) · /handoff.

### Phase 2 — Lifecycle DDL ⛔ + db.ts write surface
- **Scope:**
  - ⛔ **ALTER `custom_step23_line_defs`**: add `status` (NOT NULL DEFAULT 'active',
    CHECK in ('active','retired','merged')) and `merged_into` (nullable TEXT, shape
    CHECK; no FK — a winner may be a built-in that exists only in constants.ts);
    a trigger enforcing code immutability, legal transitions, and
    merged ⇔ merged_into consistency; an `updated_at` touch trigger.
  - ⛔ **New UPDATE policy** on `custom_step23_line_defs` — THE deliberate widening
    of the by-design-immutable table. Update `supabase_schema.sql` first, show the
    exact SQL, STOP for sign-off, then apply live. Carries the consolidated
    server-side-writes follow-up note.
  - `src/lib/db.ts`: `updateCustomStep23LineDef` (label/unit/procoreCode — active
    codes only; procoreCode validated against `PROCORE_VALID_CODES`; this IS the
    scope-2 BLI backfill write), `retireCustomStep23LineDef`,
    `mergeCustomStep23LineDef` (winner validation via Phase 1's pure rules + the
    chain-collapse sweep). All mirror the trigger's rules client-side for clean
    error messages; db tests mirror the existing custom-def test file.
- **Approval gates:** ⛔ the ALTER + trigger + UPDATE policy (exact SQL, explicit
  sign-off before any live change).
- **Exit criteria:** same gates as Phase 1 + new db tests green.

### Phase 3 — /catalog page: manage custom GC/Site-Ops codes (UI)
- **Scope:**
  - New admin page `src/app/catalog/page.tsx` twinning the /cost-codes idiom:
    table of custom defs (code, name, unit, Procore BLI, status badge, source),
    inline edit of name/unit, the Procore BLI picker over `PROCORE_VALID_CODES`
    (scope-2 backfill UI), retire with confirm, and a merge flow (pick the winner
    from active defs — built-in + custom — with an advisory "N imported bids
    currently resolve here" count mined from the existing history fetch).
  - Existing consumers switch their pickers to `activeStep23Defs` (import-gate
    assign dropdown + mint form, ImportedStep23Panel) so retired/merged codes stop
    being offered while old lines keep rendering their labels.
  - Sidebar/nav entry alongside /cost-codes and /rates.
- **Approval gates:** none (UI + wiring over Phase 2's surface; no DDL).
- **Exit criteria:** Phase 1 gates + `/code-review` + `npm run build` clean.

### Phase 4 — Thin promotion (rate_card INSERT ⛔ + /rates enrichment)
- **Scope:**
  - ⛔ **New INSERT policy on `rate_card`** (today UPDATE-only) — flagged widening,
    same consolidated follow-up note. `supabase_schema.sql` first, exact SQL, STOP.
  - `src/lib/db.ts`: `promoteCustomStep23LineDef` — creates the code's rate_card
    row (source 'manual', validated ≥ 0) exactly once; active codes only.
  - `/rates` + `src/lib/rateCardEditor.ts`: card rows keyed by a custom code enrich
    their label/unit/section from the custom defs instead of falling into the
    "Unmatched" bucket; the existing UOM-gated ADOPT then works on mined custom-code
    history with zero new ADOPT code. Retired-after-promotion rows render with the
    retired badge.
  - Promote button on /catalog (with a plain-language confirm: future-projects-only,
    one-way, no calculator visibility).
- **Approval gates:** ⛔ the rate_card INSERT policy.
- **Exit criteria:** Phase 1 gates + promotion/ADOPT tests (including: promoting and
  adopting moves no estimate dollar — goldens unchanged).

### Phase 5 — STEP 4 catalog chokepoint (pure refactor, no DDL)
- **Scope:**
  - New `src/lib/catalog.ts`: the single runtime source for STEP 4 catalog items —
    built-ins from `estimate-catalog.json` merged with primed additions (the
    `primeCostCodeResolver` pattern; built-in always wins a code collision). With
    nothing primed it is exactly `ESTIMATE_ITEMS_MASTER` — this phase is an identity
    refactor.
  - Migrate the direct `ESTIMATE_ITEMS_MASTER` consumers (~12 src modules: parser,
    importEstimate, similarity, assignCode, costCodeResolver, rateCardEditor,
    useTakeoffWorkbook, useCellEditing, EstimateTable, registry/cost-codes/import
    pages) to the chokepoint. Mechanical but wide — deliberately its own phase.
  - Tests: chokepoint identity (no additions ⇒ byte-identical catalog), goldens tie.
- **Approval gates:** none (pure refactor).
- **Exit criteria:** Phase 1 gates + `npm run build` clean (this phase touches the
  workspace hot path).

### Phase 6 — catalog_additions DDL ⛔ + db layer + resolver overlay
- **Scope:**
  - ⛔ **New table `catalog_additions`** (working name): `item_id` PK (catalog code
    shape CHECK), description, `target_uom`, `default_unit_price`, `cost_type`
    (L/M/S CHECK), `procore_code` (NOT NULL — an addition must name a valid Procore
    destination at birth; validated app-side against the Importer list), `status`
    ('active'/'landed' — landed = now present in the harvested template), source +
    audit columns. RLS: SELECT + INSERT + UPDATE (edit + landed-marking), corporate
    data, modeled on Table 14 — the new-table policies are themselves the flagged
    widening. `supabase_schema.sql` first, exact SQL, STOP, then apply.
  - **Self-contained resolution (no cost_code_map/rate_card writes):** the
    cost-code resolver overlays an addition's `procore_code` and the catalog-price
    resolver overlays its `default_unit_price` for addition itemIds — built-in
    tables stay template-seeded only.
  - `src/lib/db.ts`: `getCatalogAdditions` (fail-soft consumers),
    `createCatalogAddition` (shape, built-in/addition collision, Procore-list
    validation), `updateCatalogAddition`; prime wiring into Phase 5's chokepoint +
    both resolvers at the existing prime sites.
- **Approval gates:** ⛔ the table DDL + policies.
- **Exit criteria:** Phase 1 gates + db/resolver-overlay tests (including: an
  addition's price reaches row birth via the existing freeze-at-birth path and
  never retro-moves a saved row — goldens unchanged).

### Phase 7 — /catalog "Add STEP 4 code" UI + drift honesty
- **Scope:**
  - /catalog gains the STEP 4 section: add form (code with shape + collision
    validation, description, UOM, default unit price, cost type, required Procore
    BLI picker), list of additions with status badges and inline edit.
  - **Drift guard, made honest in-app:** a banner (the /cost-codes divergence
    idiom) lists active additions "not yet in templates/Company_Estimate_Template.xlsx
    — add the row to STEP 4 and re-run `npm run sync-codes`"; when a fresh harvest
    ships an addition's code in `estimate-catalog.json`, the page offers one-click
    "mark landed" (built-in now wins the overlay by construction). The
    `catalogManualAdditions.test.ts` pattern stays for the 6 pre-plan codes;
    additions made through the app need no per-code test — the banner replaces it.
  - /cost-codes + /rates display addition rows read-only-sourced from the overlay
    (mapping/price edits for additions happen on /catalog, their home table).
- **Approval gates:** none (UI + wiring; no DDL).
- **Exit criteria:** Phase 1 gates + `/code-review` + `npm run build` clean +
  closure handoff updating the import roadmap memory.

## Risks & unknowns
- **Three policy widenings** (Phases 2, 4, 6). Each is individually small and
  precedented, but together they grow the browser write surface — the consolidated
  server-side-writes follow-up gets MORE valuable as this plan lands, and each gate
  restates it. If the architect ever flips to server-side first, Phases 2/4/6 absorb
  the change at their gates without resequencing.
- **Phase 5 width** — touching ~12 modules including the workspace hot path is the
  largest mechanical risk. Mitigated: identity refactor with no behavior change, its
  own phase, build + full suite + goldens as the gate. If a session overruns, the
  consumer migration splits cleanly in two (lib modules first, hooks/components
  second).
- **Trigger-enforced lifecycle** (Phase 2) is the first DB trigger in the schema;
  the Phase 2 session must verify supabase advisors stay at baseline after applying.
- **Merge-to-built-in display** — after merging a custom into a built-in, /rates
  history for those lines files under the built-in code and gains ADOPT (it has a
  card row). That is the intended outcome but the Phase 3 session should verify the
  before/after counts read sensibly on /rates.
- **The 6 pre-plan manual codes** still need their STEP 4 rows added to
  `templates/Company_Estimate_Template.xlsx` (an xlsx edit, architect's hands) and a
  `sync-codes` re-run — this plan does not absorb that task, but Phase 7's banner
  machinery is built so the NEXT such batch never recurs. The drift-guard test keeps
  the loss loud until then.
- **Unknown discovered late**: whether any consumer reads `ESTIMATE_ITEMS_MASTER` at
  module-load time in a way the prime pattern can't reach (Phase 5 finds out; the
  fallback is a fail-soft async refresh on the affected page, the established idiom).

## Phase 1 kickoff prompt
Paste into a fresh session:

> Read `docs/plans/catalog-manager.md` (plan of record, all forks locked) and execute
> **Phase 1 only**: the pure custom-code lifecycle layer — additive `status?` /
> `mergedInto?` on `CustomStep23LineDef`, the pure `catalogLifecycle.ts` transition +
> chain-collapse rules, redirect-following + `activeStep23Defs` picker filtering +
> suffix non-reuse + observation re-filing in `step23Normalization.ts`. No DDL, no UI,
> no chaining into Phases 2–7. Baseline: suite 540 pass / 52 files; goldens McKenna +
> synthetic + CARE tie $0.00. Exit: suite + goldens green, `npx tsc --noEmit` clean,
> committed via `git commit -F <tempfile>`, close with /handoff (do NOT push to
> origin). Stop at the phase boundary.
