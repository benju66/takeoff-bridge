# Template + Catalog Reconciliation — Plan of Record
_2026-06-12 · status: **COMPLETE** — all 6 phases shipped (Phase 6 closed 2026-06-14)_

> **Phase 6 outcome (2026-06-14):** the 7 dead codes were surgically removed from
> the template's Importer Data Fields sheet (col-A/col-B cells only, preserving the
> per-column dropdown lists; only `xl/worksheets/sheet18.xml` changed). The harvest
> gate now exempts `steps-2-3`-basis (linked-division) rows so the retired
> `2-20000.000` base no longer aborts the harvest. `procore-valid-codes.json` is
> 224→217 and the drift test now asserts a **zero** delta (JSON ≡ template ≡ the 217
> Procore master list). Both goldens stayed **$0.00**. **Two findings the plan did
> not anticipate** (see the closure handoff): (1) `src/lib/estimate-catalog.json` is
> NOT a pure harvest artifact — it carries 6 architect-confirmed manual built-in
> additions (227 = 221 harvested + 6) that `npm run sync-codes` would clobber, so it
> was deliberately **left at HEAD, not re-committed**; (2) removing the 7 dead codes
> aligned the Importer set exactly with the Budget Line Items set (217 ≡ 217), which
> obsoleted one `export-integrity.test.ts` "append a valid-but-missing code" fixture
> (repointed `2-20000.000` → `4-40000.000`). Next workstream = #3 Actuals
> cost-history discovery (`docs/plans/2026-06-12-actuals-cost-history-discovery.md`).

## Goal
When this is done, the estimate side genuinely agrees with the now-authoritative
Procore master list (`procore_cost_codes`, 217 typed codes), with **zero standing
drift**. Concretely: (1) the estimate gains **Equipment** as a real 4th cost type
alongside Labor/Material/Subcontract; (2) the 67 STEP-4 cost-type mismatches — plus
the STEP-3 Site-Ops equipment codes — are corrected so they match Procore's type;
(3) the team can **edit a built-in catalog code's cost type in-app** (persisted to a
DB overlay that survives the template re-harvest); and (4) the 7 dead codes are
removed from the estimate template's Importer Data Fields, so the template stops
emitting the old 224 and the drift check reads a **zero** delta at the source.
Throughout, cost type is a **label only** — every change moves **$0.00** on both
export goldens (STEP-4 McKenna and GC/Site-Ops STEP 2/3).

## Out of scope / deferred
- **Repointing mis-mapped codes.** A few of the 67 may be mismatched because the
  line maps to the *wrong Procore code*, not merely the wrong type. Repointing a
  code moves dollars and changes the export rollup, so it is explicitly **not** done
  here. Those cases are enumerated and handed back to the architect as a separate,
  deliberately dollar-moving review. This workstream is cost-**type-label only**.
- **Actuals / final-cost history.** Workstream #3; untouched here.
- **Migrating existing saved rows.** `estimate_line_items.cost_type` is frozen at
  row birth. Corrections affect the advisory and **new** row births; already-saved
  rows keep their frozen type (label-only, no dollar impact). No backfill.
- **In-app editing of STEP-3 Site-Ops cost types.** Site-Ops defaults are hard-coded
  `constants.ts` source; they are retyped by code edit here and gain a drift
  advisory, but are not made runtime-editable (a later extension if wanted).
- **The `11-110000.000` cosmetic parent label.** It is a display-only
  `procoreParentCode` for 7 div-11 rows (never an export target). Its retirement is
  handled incidentally by the template cleanup; no separate grouping-label work.

## Locked decisions
- **Equipment is added FIRST, before any bulk correction.** Many of the 67 mismatch
  *because* the mapped Procore base is Equipment-typed and the estimate had no
  Equipment to match — they are unfixable until Equipment exists. _Architect-confirmed._
- **Cost-type corrections are label-only; wrong-code mis-maps are flagged, not
  repointed.** Guarantees both goldens stay $0.00 by construction. _Architect-chosen._
- **Built-in cost-type overrides live in a dedicated `catalog_cost_type_overrides`
  table**, layered ON TOP of the harvested built-ins (override wins for the type
  field only) so it survives `npm run sync-codes`. Not folded into
  `catalog_additions` (whose model forbids shadowing a built-in). _Architect-chosen._
- **The in-app cost-type editing UI lives on `/catalog`**, mirroring the existing
  additions cost-type dropdown. _Architect-chosen._
- **The Equipment work reaches the STEP-3 Site-Ops vocabulary too.** The 02.G Site
  Equipment codes (`02-9405/9410/9415/9420/9425/9430.001`) and their summary
  `02-9400.007` are retyped M→E in `constants.ts`, AND the type-mismatch advisory is
  extended to cover the STEP-3 Site-Ops codes so their type can't silently drift from
  Procore again. _Architect-chosen — closes a gap the current 67-only advisory misses._
- **Do BOTH bulk-fix and editing.** Clean the existing mismatches today via a seeded
  overlay AND build the ongoing in-app editing capability. _Architect goal._
- **The template edit is isolated to the final, golden-gated phase.** It is the most
  golden-sensitive change in the codebase and never shares a phase with anything else.

## Key architecture facts (verified against the code)
- **Catalog chokepoint:** `src/lib/catalog.ts` `getCatalogItems()` merges built-ins
  (`ESTIMATE_ITEMS_MASTER` from `estimate-catalog.json`) over primed additions —
  **built-in always wins**. The new cost-type overlay is the inverse: it *patches*
  the built-in's `costType` (override wins for that one field). Identity contract:
  nothing primed ⇒ exact `ESTIMATE_ITEMS_MASTER` reference.
- **Advisory source:** `/cost-codes` calls `computeTypeReconciliation(mappings,
  getCatalogItems(), procoreTypeByCode)` (`src/lib/procoreTypeReconciliation.ts`),
  pinned at **67 mismatches**. Because it reads `getCatalogItems()`, seeding the
  overlay makes the advisory drop automatically.
- **Type vocabulary today:** `ESTIMATE_TO_PROCORE_TYPE` = {L,M,S} only;
  `catalog_additions.cost_type` CHECK = ('L','M','S'); `/catalog` dropdowns +
  `db.ts normalizeAdditionCostType` = L/M/S. Four places must learn 'E'.
- **Two separate cost-type homes:** STEP-4 codes flow through the catalog overlay;
  STEP-3 Site-Ops codes are hard-coded in `constants.ts` `SITE_OPS_MANUAL_DEFAULTS`
  (currently all `costType:"M"`). The 67 advisory only counts STEP-4.
- **Cost type moves no dollars** — confirmed: not read by `calculations.ts` or
  `exporter.ts`; Procore wants the bare code (no type suffix). No export-format change.
- **The harvest crux for the template edit:** `scripts/harvest-cost-codes.js` has a
  hard gate that aborts if any catalog code resolves to a Procore code not in the
  Importer set. The 8 linked-division rows resolve to `2-20000.000` via
  `STEPS_2_3_FALLBACK_CODES`. Removing `2-20000.000` from the Importer sheet trips
  that gate — so Phase 6 must exempt linked-division rows from the harvest gate
  (mirroring the runtime `isLinkedDivisionRow` export-skip), NOT invent a successor.
  The other 6 dead codes have zero catalog references and remove cleanly.

## Phases

### Phase 1 — Equipment as the 4th cost type (vocabulary only, no corrections)
- **Scope:**
  - Widen `catalog_additions.cost_type` CHECK from `('L','M','S')` to
    `('L','M','S','E')`. Update `supabase_schema.sql` first.
  - Add `E: "Equipment"` to `ESTIMATE_TO_PROCORE_TYPE` in
    `procoreTypeReconciliation.ts` (and update its now-stale "Equipment deferred"
    doc comment).
  - Teach the UI/validation about Equipment: `/catalog` `COST_TYPE_OPTIONS` +
    `COST_TYPE_LABELS`, `db.ts` `CATALOG_ADDITION_COST_TYPES` +
    `normalizeAdditionCostType` message, and any other L/M/S dropdown.
  - No data uses 'E' yet ⇒ the 67 count is unchanged and goldens are untouched —
    this phase only *enables* Equipment.
- **Approval gates:** ⛔ **DDL** — invoke the `supabase:supabase` skill, show the
  exact `ALTER TABLE … DROP/ADD CONSTRAINT` SQL, stop for sign-off before applying.
- **Exit criteria:** `npm run test` green (67 still pinned) · `npx tsc --noEmit`
  clean · lint clean · both goldens $0.00 · committed (`git commit -F`) · `/handoff`.

### Phase 2 — Cost-type override overlay (mechanism, inert)
- **Scope:**
  - New `catalog_cost_type_overrides` table: `item_id` PK (catalog-code shape),
    `cost_type` CHECK `('L','M','S','E')`, `created_at`/`updated_at` (+ optional
    `note`). RLS modeled on `catalog_additions`. Update `supabase_schema.sql` first.
  - `db.ts`: `getCatalogCostTypeOverrides()` + `upsertCatalogCostTypeOverride()`
    through the gateway (no direct client access).
  - Compose at the catalog chokepoint: a `primeCatalogCostTypeOverrides` that makes
    `getCatalogItems()` apply the override `costType` to matching built-ins (override
    wins for `costType` only; clone affected items so the identity contract holds when
    nothing is primed). Add it to the existing overlay prime sites alongside
    `primeCatalogAdditionOverlays` (workspace, import, `/catalog`, `/cost-codes`,
    `/rates`).
  - Unit tests proving: empty overlay = identity ($0.00 goldens, 67 unchanged); a
    primed override flips exactly one built-in's type and nothing else.
- **Approval gates:** ⛔ **DDL** — show the exact `CREATE TABLE` + policies, stop for
  sign-off before applying.
- **Exit criteria:** `npm run test` green (67 still pinned; new overlay tests) ·
  `tsc` clean · lint clean · both goldens $0.00 · committed · `/handoff`.

### Phase 3 — Bulk-correct the 67 STEP-4 mismatches (data, golden-gated)
- **Scope:**
  - A disposition report (script + `docs/` output, twin of the Phase-1
    reconciliation report): each of the 67 with `internalCode`, mapped
    `procoreCode`, current estimate type, Procore's type, and the proposed
    correction. It separates **mechanical type fixes** (set overlay `cost_type` =
    Procore's type) from **suspected wrong-code mis-maps** (do NOT touch — list for
    the architect).
  - Seed `catalog_cost_type_overrides` with the mechanical corrections only.
  - Re-pin `procore-type-reconciliation.test.ts`: expected mismatch count drops
    from 67 to N, where N = the enumerated, explained mis-map residual.
- **Approval gates:** ⛔ Show the disposition report (counts + the mechanical vs.
  mis-map split) and get sign-off before seeding. ⛔ **Goldens** — confirm $0.00 on
  STEP-4 *and* GC/Site-Ops before commit (proof the type fixes moved no dollars).
- **Exit criteria:** `npm run test` green · `tsc` clean · lint clean · both goldens
  $0.00 · `/cost-codes` mismatch advisory drops 67→N (residual explained) · committed
  · `/handoff`.

### Phase 4 — Retype STEP-3 Site-Ops equipment + STEP-3 type advisory (golden-gated)

> **DECISION 2026-06-12 (architect): the 02.G retype was DROPPED.** Verification
> against both `docs/reference/Procore Cost Codes.xlsx` and the live
> `procore_cost_codes` table found that all six 02.G bases
> (`2-29405/29410/29415/29420/29425/29430.000`) — and the entire division 02 — are
> typed **Material**, not Equipment. The only Equipment-typed code repo-wide is
> `10-102113.000` Toilet Partitions (already handled in Phase 3). Retyping the
> estimate to `E` would fabricate a type the Procore authority does not record
> (AGENTS.md "No Fabricated Types") and would CREATE 6 new mismatches, not reach 0
> residual. So the estimate keeps the six 02.G lines as Material (they already agree
> with Procore), and Phase 4 ships only the STEP-3 type-drift advisory below, which
> correctly reads **0 drift** today. `constants.ts` is unchanged.

- **Scope (as built):**
  - ~~In `constants.ts`, retype the 02.G Site Equipment codes
    (`02-9405/9410/9415/9420/9425/9430.001`) and the `02-9400.007` summary row from
    `costType:"M"` → `"E"`. Label-only.~~ **Dropped — see decision above.**
  - Extend the type-mismatch advisory: `computeTypeReconciliation` (or a sibling
    helper) also compares the STEP-3 Site-Ops codes (`SITE_OPS_MANUAL_DEFAULTS`,
    `LINKED_DIVISION_ROWS`) against `procore_cost_codes`, surfaced on `/cost-codes`,
    so a Site-Ops type drift is caught going forward. Pin the new count.
- **Approval gates:** ⛔ **Goldens** — confirm $0.00 on STEP-4 *and* GC/Site-Ops
  before commit (the GC/Site-Ops golden is the proof the Site-Ops retype moved no
  dollars). No DDL.
- **Exit criteria:** `npm run test` green · `tsc` clean · lint clean · both goldens
  $0.00 · STEP-3 advisory accurate (Site-Ops equipment reads E/Equipment, 0 residual)
  · committed · `/handoff`.

### Phase 5 — In-app built-in cost-type editing (`/catalog`)
- **Scope:**
  - On `/catalog`, add an editable cost-type control for **built-in** catalog codes
    (today the page edits only additions). Mirror the additions dropdown; Equipment
    selectable. Writes go through `db.ts upsertCatalogCostTypeOverride` →
    `catalog_cost_type_overrides`.
  - The edited type primes the overlay so it shows immediately and **survives a
    reload** (overlay primed at page load).
  - Tests: persistence round-trip + reload survival; a built-in edit does not create
    a `catalog_additions` row.
- **Approval gates:** none (no DDL; writes through the gateway). Editing surfaces a
  type, never a code/price.
- **Exit criteria:** `npm run test` green · `tsc` clean · lint clean · both goldens
  $0.00 · edit persists + survives reload · committed · `/handoff`.

### Phase 6 — Template cleanup: remove the 7, drift → zero (⛔ golden-gated, isolated)
- **Scope:**
  - Edit the canonical template `templates/Company_Estimate_Template.xlsx`: remove
    the 7 dead codes' rows from the **Importer Data Fields** sheet
    (`1-10440.000`, `2-20000.000`, `2-29406.000`, `6-66119.000`, `8-87000.000`,
    `11-110000.000`, `60-605000.000`).
  - Resolve the harvest crux: removing `2-20000.000` trips
    `harvest-cost-codes.js`'s invalid-code gate for the 8 linked-division
    `STEPS_2_3_FALLBACK_CODES`. Exempt linked-division rows from that gate (mirror
    the runtime `isLinkedDivisionRow` export-skip) — do NOT invent a successor base.
  - Re-run `npm run sync-codes`: `procore-valid-codes.json` drops 224→217;
    `estimate-catalog.json` re-harvested.
  - Flip `procore-valid-codes-sync.test.ts`: the known 7-code delta assertion
    becomes a **zero** delta (template/JSON == the 217) and the JSON===template
    assertion still holds.
- **Approval gates:** ⛔ **Template edit + goldens** — the most golden-sensitive
  change in the repo. Show the planned Importer-sheet row removals, apply, then
  confirm $0.00 on STEP-4 *and* GC/Site-Ops before commit. ⛔ Confirm the harvest-gate
  exemption approach before changing the script.
- **Exit criteria:** `npm run test` green · `tsc` clean · lint clean · both goldens
  $0.00 · drift delta = 0 (JSON === template at 217) · committed · `/handoff` (close
  the workstream; point at #3 Actuals cost-history as the next plan).

## Risks & unknowns
- **Harvest gate vs. `2-20000.000` (Phase 6).** The central template-cleanup risk:
  the 8 linked-division fallbacks resolve to the removed base and abort the harvest.
  Mitigation is the linked-division gate exemption; Phase 6 proves the re-harvest
  succeeds and goldens still tie. _Found in: Phase 6._
- **Residual mismatch count N (Phase 3).** Unknown until the disposition report runs.
  If the "wrong-code mis-map" set is larger than a handful, the architect may want a
  follow-on repoint mini-workstream (out of scope here). _Found in: Phase 3._
- **Overlay clone vs. identity contract (Phase 2).** `getCatalogItems()` must keep
  returning the exact `ESTIMATE_ITEMS_MASTER` reference when nothing is primed; the
  cost-type patch must clone only when an override is actually primed. A unit test
  pins this. _Found in: Phase 2._
- **Freeze-at-birth.** Already-saved line items keep their old frozen `cost_type`;
  only the advisory and new births reflect corrections. Acceptable (label-only), but
  worth stating to the architect so the advisory dropping to ~0 isn't expected to
  retro-relabel historical estimates.
- **Two DDL gates (Phases 1 & 2).** Could be merged into one gated session if the
  architect prefers fewer interruptions; kept separate here to isolate each schema
  change. _Architect's call at kickoff._

## Phase 1 kickoff prompt
> Implement **Phase 1** of the Template + Catalog Reconciliation plan at
> `docs/plans/2026-06-12-template-catalog-reconciliation.md`. Scope: add **Equipment**
> as the 4th estimate cost type, vocabulary only — no data corrections. (1) Widen the
> `catalog_additions.cost_type` CHECK from `('L','M','S')` to `('L','M','S','E')`,
> updating `supabase_schema.sql` first; (2) add `E: "Equipment"` to
> `ESTIMATE_TO_PROCORE_TYPE` in `src/lib/procoreTypeReconciliation.ts` and fix its
> stale "Equipment deferred" doc comment; (3) teach Equipment to the UI/validation —
> `/catalog` `COST_TYPE_OPTIONS` + `COST_TYPE_LABELS`, `db.ts`
> `CATALOG_ADDITION_COST_TYPES` + `normalizeAdditionCostType`, and any other L/M/S
> dropdown. **Invoke the `supabase:supabase` skill before any DB code. ⛔ Show the
> exact `ALTER TABLE` constraint SQL and stop for my approval before applying it.** No
> data should use 'E' yet, so the 67-mismatch count must stay pinned and both export
> goldens must tie $0.00. Exit when `npm run test` is green, `npx tsc --noEmit` is
> clean, lint is clean, both goldens tie $0.00, the work is committed via
> `git commit -F`, and a handoff is written via `/handoff`. **Stop at the Phase 1
> boundary** — do not start Phase 2.
