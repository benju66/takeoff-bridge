# Template + Catalog Reconciliation — Phase 5 Kickoff

_Written 2026-06-14 at the close of Phase 4. Paste the prompt below into a fresh
session._

## Where Phase 4 left off

Phase 4 is **complete and committed** on branch `template-catalog-reconciliation`
as `314a395` (upstream still unset — nothing pushed; other-session docs commits
interleave the history).

**The big Phase 4 event: the 02.G retype was DROPPED by architect decision.** The
plan had Phase 4 retyping the six 02.G Site-Equipment lines
(`02-9405/9410/9415/9420/9425/9430.001`) from `M`→`E`. Verification first — against
**both** `docs/reference/Procore Cost Codes.xlsx` and the live `procore_cost_codes`
table — found all six bases (`2-294xx.000`), and the entire division 02, typed
**Material**, not Equipment. The only Equipment-typed code in the whole 217-code
master list is `10-102113.000` Toilet Partitions (already handled in Phase 3).
Retyping to `E` would have (a) fabricated a type the Procore authority does not
record (AGENTS.md "No Fabricated Types") and (b) created 6 new mismatches instead
of the planned 0 residual. The architect chose **"keep Material, skip retype."**

So Phase 4 shipped **only** the STEP-3 type-drift advisory:
- `constants.ts` is **unchanged** (no retype, `GcCostType` still `M|L|S`).
- New pure helper `computeSiteOpsTypeReconciliation()` in
  `src/lib/procoreTypeReconciliation.ts` runs the SAME type comparison the STEP-4
  advisory uses (reusing `computeTypeReconciliation`'s core) over
  `SITE_OPS_DYNAMIC_DEFAULTS` + `SITE_OPS_MANUAL_DEFAULTS` — the granular Site-Ops
  lines that hard-code their `costType` in `constants.ts` and bypass
  `cost_code_map` + the catalog overlay. `LINKED_DIVISION_ROWS` are intentionally
  excluded (no independent cost type; already covered by the STEP-4 reconciliation's
  exempted `2-20000.000` missing-base set).
- `/cost-codes` shows a slim **green "0 type drift" bar** below the STEP-4 advisory
  (flips to an amber mismatch/missing-base list if drift ever appears). It keys on
  the async-loaded `procoreTypeByCode` state — no stale-memo risk because the
  Site-Ops source is static constants (unlike the STEP-4 advisory, which had to
  snapshot `catalogItems` because its overlay primes are render-less effects).
- Tests (`src/__tests__/procore-type-reconciliation.test.ts`) pin: 0 mismatches /
  0 missing-base across all Site-Ops lines; the six 02.G lines as **Material on both
  sides** (the kickoff's "trust but pin it"); only Toilet Partitions is Equipment
  repo-wide; and a synthetic divergence makes the monitor fire.

Gates: suite **786/70** green, `tsc` clean, `eslint` clean on changed files, both
goldens **$0.00** (McKenna STEP-4 INV-1 + the GC/Site-Ops "STEP 2/3 section subtotal
→ STEP 4 linked row" ties + synthetic + CARE — the proof the decision moved no
dollars).

**Optional future tidy (not a bug):** the new STEP-3 advisory's two-card
mismatch/missing-base grid is near-duplicate JSX of the STEP-4 advisory on the same
page. If a third advisory ever lands, extract a shared `<ReconciliationCards>`
component; not worth it for two.

## Phase 5 prompt (paste verbatim)

> Implement **Phase 5** of the Template + Catalog Reconciliation plan at
> `docs/plans/2026-06-12-template-catalog-reconciliation.md` (branch
> `template-catalog-reconciliation`, Phase 4 done at `314a395`). Scope: **in-app
> cost-type editing for BUILT-IN catalog codes on `/catalog`** (today the page edits
> the cost type of *additions* only). Add an editable cost-type control to the
> built-in catalog rows that mirrors the additions dropdown (`COST_TYPE_OPTIONS`,
> Equipment selectable); writes go through `db.ts upsertCatalogCostTypeOverride` →
> the `catalog_cost_type_overrides` table (the Phase-2 overlay, already LIVE and
> seeded with the Phase-3 65). The edited type must prime the overlay so it shows
> immediately AND survives a reload (the overlay is already primed at page load via
> `getCatalogCostTypeOverrides` → `primeCatalogCostTypeOverrides`). A built-in edit
> MUST NOT create a `catalog_additions` row (that path is for new codes only).
> **Invoke the `supabase:supabase` skill before any DB-touching code.** Tests:
> persistence round-trip + reload survival + "built-in edit creates no addition row".
> **No DDL** (the table exists; writes go through the gateway). ⛔ **Goldens**:
> confirm $0.00 on STEP-4 McKenna AND GC/Site-Ops STEP 2/3 before commit (cost type
> is label-only, but prove it). Exit when `npm run test` is green, `npx tsc --noEmit`
> clean, lint adds no new findings, both goldens $0.00, committed via `git commit -F`,
> and a handoff is written via `/handoff`. **Stop at the Phase 5 boundary** — do not
> start Phase 6 (the template-cleanup phase has its own ⛔ template-edit gate).

## Non-obvious context for Phase 5

- **The write path already exists.** `db.ts`: `getCatalogCostTypeOverrides()`
  (line ~2364) and `upsertCatalogCostTypeOverride({...})` (line ~2390). The overlay
  primer is `primeCatalogCostTypeOverrides` from `@/lib/catalog`. `/catalog` already
  loads + primes the overrides at mount (see how `/cost-codes` does it for the
  pattern). Phase 5 is wiring a UI control to that existing write path — not new
  plumbing.
- **`/catalog` already has the pieces.** `COST_TYPE_OPTIONS` (page.tsx ~line 830,
  includes `E`), `COST_TYPE_LABELS`, `isBuiltInCatalogCode` (imported ~line 44), and
  the additions editor already renders a cost-type `<select>` (~line 1476) you can
  mirror for built-ins. The built-in branch is `isBuiltInCatalogCode(itemId)` (seen
  ~line 931).
- **Built-in vs addition is the core distinction.** Additions live in
  `catalog_additions` (their own row, full code/price/type). Built-ins live in the
  harvested `estimate-catalog.json` and are corrected ONLY via the
  `catalog_cost_type_overrides` overlay (a per-`item_id` cost_type patch — the
  override wins for that field, inverse of additions where the built-in wins). Do not
  route a built-in edit into the additions table.
- **Overlay is label-only** — not read by `calculations.ts`/`exporter.ts`. Goldens
  tie by construction, but the ⛔ gate stands: run them.
- **Site-Ops in-app editing stays OUT of scope** (plan §Out of scope). Phase 5 is
  STEP-4 built-in codes on `/catalog` only. Site-Ops types live in `constants.ts`
  and are guarded by the Phase-4 advisory, not editable in-app.
- **Stale-memo trap (carried from Phase 2/3):** anything on `/catalog` computed from
  the primed overlay must key on a re-snapshotted STATE value after the prime lands,
  never a bare `getCatalogItems()` read inside a memo — the prime is a render-less
  effect. After an edit upserts + re-primes, re-snapshot so the row reflects the new
  type without a reload.
- **Reactivation guard bug** (`[[procore-reactivation-guard-bug]]`) is unrelated to
  Phase 5 — leave it.
- **Worktree hygiene:** untracked `review.diff` and the modified
  `docs/plans/2026-06-12-standalone-formula-template-discovery.md` belong to other
  sessions — keep them out of Phase 5 commits.
- **Lint baseline:** ~26 pre-existing errors in old scratch/forensic scripts —
  "lint clean" = no NEW findings vs HEAD; lint the changed files, not the whole repo.

## Exit criteria (repeat)

`npm run test` green (new built-in-edit persistence + reload + no-addition-row pins)
· `tsc` clean · lint = no new findings · both goldens $0.00 · built-in cost-type edit
persists + survives reload + creates no `catalog_additions` row · committed
(`git commit -F`) · `/handoff` written for Phase 6 (template cleanup — remove the 7
dead codes; ⛔ template-edit + golden gate; the most golden-sensitive change in the
repo; ISOLATED LAST).
