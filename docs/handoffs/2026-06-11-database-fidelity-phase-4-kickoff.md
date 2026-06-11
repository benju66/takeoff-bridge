# Database Fidelity — Phase 4 Kickoff (Data Health: dashboard + project strip)

_2026-06-11 · previous phase: Phase 3 complete on local main (`588304c`, not
pushed) — pure `src/lib/historyTrust.ts` is now THE trust-rules authority
(validity screen, architect-approved unit-alias table, flag-only IQR outlier
screen, inert escalation seam, grouping by post-merge code + canonical unit +
sector with confidence labels); both /rates history reports flow through
`aggregateTrustedHistory`. Suite 670/62, goldens tie $0.00, tsc clean._

## Ready-to-paste prompt for a fresh session

> Read `docs/plans/database-fidelity.md` (plan of record, forks locked) and
> execute **Phase 4 only**: Data Health — one audit engine, two surfaces.
> Scope: new PURE `src/lib/dataHealth.ts` producing typed findings:
> (1) unmapped lines per project; (2) unit conflicts per code (use
> `canonicalUom` from `src/lib/historyTrust.ts` so alias spellings don't
> false-positive); (3) near-duplicate custom code labels — spanning custom
> defs AND catalog additions vs built-ins, EXCLUDING retired/merged codes
> (already resolved by definition); (4) suspected duplicate imports
> (name/date/total proximity — the retroactive net for the push window);
> (5) missing won/lost and delivery-method answers (`bid_outcome` /
> `delivery_method` = 'unknown'); (6) lump-share per code
> (`data_fidelity='macro_lump_sum'` ratio); (7) missing/unparseable bid
> dates (un-escalatable observations); (8) price-jump detection across bids
> over time for the same (code, canonical unit) — FLAG-ONLY, thresholds ship
> conservative as named tunable constants (same philosophy as historyTrust's
> outlier screen — reuse its observation plumbing, don't re-mine). The
> engine reads the STEP 4 catalog ONLY through `src/lib/catalog.ts`
> (`getCatalogItems`), never `ESTIMATE_ITEMS_MASTER` directly, so in-app
> additions are covered. New read-only `/data-health` page: company-wide,
> grouped by severity, every finding deep-linking to its project and to
> `/catalog` (where merge/retire/BLI-backfill/promote actually exist — fix
> actions are deliberately ABSENT here); plus a compact health strip on the
> project import/workspace view filtered to that project. The page documents
> the quarterly review cadence (standing note: Data Health and adopted rates
> get a human pass each quarter). While in Phase 4, confirm whether a clean
> delete path exists for a duplicate past-bid project — if not, record it as
> a finding for the housekeeping roadmap item, do NOT build it. All DB access
> through `src/lib/db.ts`; read-only, no schema changes, no export changes.
> Exit: `npm run test` green · goldens tie $0.00 · `npx tsc --noEmit` clean ·
> `npm run build` clean (new page/route) · `/code-review` findings resolved ·
> committed via `git commit -F <tempfile>` · close with /handoff (do NOT
> push). Stop at the phase boundary — Phases 5–6 and import-roadmap items
> 2/3/5 stay out of scope.

## Where Phase 3 left off (context a cold session may need)

- **Plan file:** `docs/plans/database-fidelity.md` — Phase 4 section + its
  post-Catalog-Manager reconciliation notes + "Locked decisions"
  (flag-only statistical screens; one audit engine, two surfaces).
- **`src/lib/historyTrust.ts` is the trust authority** (Phase 3). Reusable
  for Phase 4: `observationExclusion` (validity rules), `canonicalUom` +
  `TRUST_UOM_ALIASES` (architect-approved 2026-06-11; extends the parse-time
  `uom-aliases.ts` table), `aggregateTrustedHistory` (grouped stats with
  `flaggedOutliers` + confidence labels), tunable constants
  (`OUTLIER_*`, `LOW_CONFIDENCE_BELOW`). The price-jump detector belongs in
  dataHealth (it's an audit finding, not a report rule) but should consume
  the same `PriceObservation` streams: `getBidPriceHistory` (db.ts — POST-MERGE
  NOTE 2026-06-11: the Estimate Versioning merge, `d991f44`, made this the
  full observation pool: imported bids + submitted estimate versions with the
  supersede rule applied; `getImportedPriceHistory` still exists but is the
  imported-only subset. Both carry `qty` + `dataFidelity`) and `step23Observations`
  (step23Normalization.ts, carries `qty`; no lump marker exists on STEP 2/3
  lines today — comment at the producer explains).
- **Grouping is by POST-MERGE resolved code** everywhere; `resolveStep23Line`
  follows Catalog-Manager merge redirects. Near-duplicate detection must use
  lifecycle helpers from `src/lib/catalogLifecycle.ts` (`statusOf`,
  `resolveMergeTarget`) to skip retired/merged customs.
- **Capture fields live** (Phase 1): `projects.bid_outcome` +
  `projects.delivery_method`, both default `'unknown'` — the "missing
  answers" finding is just an equality check; inline backfill editors already
  exist on STEP 1 and /projects.
- **/rates display conventions** (mirror them on /data-health): fail-soft
  page loads (an outage degrades, never blocks), report-only surfaces, the
  established async-refresh idiom.
- **Uncommitted working tree (pre-existing, NOT this phase's):** a docs
  archive move (deleted `docs/handoffs/*` + `docs/plans/*` with untracked
  copies under `docs/*/archive/`) sits in the working tree. Leave it alone;
  `git add` specific files only.
- Exit-gate commands: `npm run test` · `npx tsc --noEmit` · `npm run build`
  · commit message written to a temp file (Write tool, no BOM) then
  `git commit -F <file>` — never inline multi-line commit text (Windows
  shell rule).

## Approval gates

None inside Phase 4 (read-only page; no DDL, no export changes). Do NOT push.
The next hard gate is Phase 6 sequencing (⛔ architect decision: escalation
index choice + likely one small table).
