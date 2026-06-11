# Database Fidelity — Plan of Record
_2026-06-10 · status: PROPOSED · amended 2026-06-11 with the deep-research gap-check
findings (AACE/RSMeans-verified; four amendments + two capture decisions, all
architect-locked) · reconciled 2026-06-11 with the shipped Catalog Manager
(consistency notes in Phases 3–5; no fork changes)_

## Goal
The cost-code / cost-history / line-item database becomes the company's most
dependable pricing asset: every observation that enters it is captured with
enough context to trust later (won/lost, units, "this was a combined line"),
every number reported out of it passes through one set of trust rules, and a
Data Health dashboard shows — company-wide and per project — exactly where the
data is clean and where it needs attention. Estimator friction stays near zero:
one dropdown at import, one optional checkbox per combined line, and everything
else happens on the read side, retroactively, with no re-entry of data. By the
end, the suggestion engine learns from what estimators actually accept, reject,
and override — the training signal a future ML tier needs and that cannot be
backfilled.

## Out of scope / deferred
- **Actual ML / fuzzy / embedding matching** — this workstream makes the data
  ML-ready and the suggestion engine signal-aware, but stays deterministic.
  Revisit once the backlog import push shows the exact-match hit rate.
- **Catalog Manager (import roadmap item 4)** — the *fixing* tool (merge
  near-duplicate codes, retire codes, backfill Procore BLIs, promote to the
  rate card, add STEP 4 codes). **Shipped 2026-06-11 (all 7 phases,
  `/catalog`)** — the division of labor stands: this workstream detects,
  `/catalog` fixes. Phase 4's findings now deep-link to the real page instead
  of a future one.
- **Workspace "mark as combined" context-menu action** — born-in-app lumping is
  real but the immediate threat is the import push. Deferred until backlog
  experience shows it's needed (requires command-history integration per
  AGENTS.md, so it's its own slice).
- **Applying escalation math** — the trust-rules module is BUILT WITH the seam
  for it (Phase 3) and a target-date-picker view exists as an unsequenced
  Phase 6, but no index is chosen and no adjustment ships in Phases 1–5.
  Reports show dates; the human judges. (Amended 2026-06-11: the research
  showed time normalization is the one deferral the literature says to
  revisit — AACE RP 58R-10; RSMeans' index moved ~3.5% in 2025 alone — so
  the deferral is now "apply later", not "never".)
- **Forward escalation** (escalating prices toward a future start date when
  building a bid) — architect confirmed 2026-06-11 this is not part of how
  the team works; permanently out of scope. Phase 6's date picker is bounded
  to published index dates specifically so it cannot become this by accident.
- **Which escalation index** (RSMeans HCI vs ENR vs BLS PPI-by-trade, blanket
  vs per-division) — decided when Phase 6 is sequenced, with real backlog data
  in hand.
- **Location cost-factors** — bids are essentially one metro (architect,
  2026-06-11), so location stays free text and geographic normalization is
  permanently out of scope unless the business changes.
- **AACE RP 114R-20 purchase / maturity self-assessment** — architect declined
  (2026-06-11); proceed on the verified research.
- **Price basis beyond won/lost** (bid vs awarded vs actual cost) — everything
  in the system today is a bid; an "actuals" concept would come with a Procore
  import feature, not this workstream.
- **Server-side write hardening** — the standing "move writes server-side"
  follow-up on corporate tables carries forward unchanged.
- **Import roadmap items 2, 3, 5** (past-vs-active, housekeeping,
  fork-a-past-bid) — untouched; this is a parallel workstream, not a rewrite of
  that roadmap.

## Locked decisions (architect, 2026-06-10)
- **Backlog imports proceed now; this workstream never blocks them.** Won/lost
  is backfillable (project-level fact + edit affordance on the project page);
  duplicate imports that slip in during the push are caught retroactively by
  the Data Health duplicate-detection report.
- **Combined/lumped lines: record everything, tagged.** A lump is flagged on
  the line (`data_fidelity='macro_lump_sum'`) and its training-table row is
  written with a distinct tag — suggestions and price statistics ignore it, but
  the observation is never discarded (append-only philosophy; future ML can
  still use it).
- **Data Health = one audit engine, two surfaces.** Company-level dashboard is
  the primary view (sprawl, UOM conflicts, and duplicates are only visible
  across projects); each project gets a small health strip showing its own
  findings. Same engine, filtered.
- **ML-ready, not ML yet.** Deterministic exact-match + counts, upgraded with
  accept/reject/override signals and recency — the substrate a smart tier
  plugs into later.
- **One trust-rules authority.** All historical-price reporting flows through a
  single pure module (the analytics twin of `calculations.ts`); no report
  rolls its own filtering or grouping.
- **(2026-06-11) Escalation-ready, not escalation-applied.** Phase 3's module
  takes an optional index-adjustment input (ships inert); the adjusted-dollars
  view is Phase 6, unsequenced. Bid dates become a watched data-quality item.
- **(2026-06-11) Capture delivery method at import.** One more dropdown in
  Phase 1 (`delivery_method` — hard bid / negotiated / GMP / design-build /
  other / unknown): prices under different contract types aren't fully
  comparable, and the fact is knowable now but hard to reconstruct later.
- **(2026-06-11) Statistical screens are flag-only.** The outlier screen
  (Phase 3) and price-jump detector (Phase 4) mark observations and exclude
  them from aggregates; nothing is ever deleted — same record-everything
  philosophy as the lump marker.

## Phases

### Phase 1 — Capture fields: won/lost + delivery method + duplicate-import warning
- **Scope:** two `projects` columns — `bid_outcome` (`'won' | 'lost' |
  'pending' | 'unknown'`, default `'unknown'`) and `delivery_method`
  (`'hard_bid' | 'negotiated' | 'gmp' | 'design_build' | 'other' |
  'unknown'`, default `'unknown'`; value list adjustable at the gate) — two
  dropdowns on the import page (siblings of the existing bid-date/sector
  fields) and editable controls on the project view so the already-imported
  backlog can be backfilled in seconds. Advisory duplicate warning at import:
  before save, check existing projects for a near-match (normalized name,
  same bid date) and show a "this looks like X, imported on Y — continue?"
  banner. Never blocks.
- **Approval gates:** ⛔ DB schema change — `supabase_schema.sql` updated
  first, exact `ALTER TABLE projects ADD COLUMN ...` SQL for BOTH columns
  shown, STOP for sign-off before any live change.
- **Exit criteria:** `npm run test` green · goldens tie $0.00 · `npx tsc
  --noEmit` clean · committed (`git commit -F <tempfile>`) · handoff via
  /handoff.

### Phase 2 — The "combined line" marker at the import review gate
- **Scope:** per-line "combined" toggle on the STEP 4 import review table
  (same corrections-state-map pattern the gate already uses); a marked line
  saves with `data_fidelity='macro_lump_sum'`; its training-table write goes
  in tagged (distinct `resolved_by` value — no schema change needed, the
  column is free text) so `getClassificationHistoryBulk` ranking and the
  /rates price-history mining exclude it.
- **Approval gates:** none (the flag column and the training table already
  exist; this is UI + read-side filtering).
- **Exit criteria:** same gates as Phase 1, plus tests proving a lump-tagged
  observation never surfaces in suggestions or price history.

### Phase 3 — The trust-rules module
- **Scope:** new pure `src/lib/historyTrust.ts` — the single authority on
  which observations count and how they group: group by (code, unit, market
  sector); exclude lump-tagged / zero-qty / zero-rate / %-unit rows; a small
  unit-alias table (SF = SQFT etc. — alias list provided by the architect);
  recency ordering and a minimum-sample-size label ("2 observations — low
  confidence") on every aggregate. Plus the two research amendments:
  a **statistical outlier screen** per (code, unit) group (median-skew/IQR
  style; flags the observation and excludes it from aggregates, never
  deletes — AACE benchmarking practice orders this BEFORE any normalization),
  and the **escalation seam** — the module accepts an optional
  date-based index-adjustment input that ships inert (identity) until
  Phase 6 chooses an index. Rewire the existing /rates imported-price
  and STEP 2/3 history reports through it.
  **(Reconciled 2026-06-11, post-Catalog-Manager:)** the module groups by the
  **post-merge resolved code** — custom codes can now be merged/retired with
  render-time redirects (`resolveStep23Line` follows them), so historyTrust
  consumes resolved codes, never raw as-bid or assigned codes; otherwise a
  merge would silently split one item's history in two. And since a custom
  code can now be *promoted* to a rate-card row (making ADOPT possible on its
  mined history), the trust filters — outlier screen included — now also
  guard what feeds ADOPT, which raises their value.
- **Approval gates:** none (pure module + report rewiring; read-side only, so
  it applies retroactively to everything already imported).
- **Exit criteria:** same gates; goldens tie $0.00; report outputs unchanged
  for already-clean data (proven by test).

### Phase 4 — Data Health: company dashboard + per-project strip
- **Scope:** pure `src/lib/dataHealth.ts` audit engine producing typed
  findings: unmapped lines per project, unit conflicts per code, near-duplicate
  custom code labels, suspected duplicate imports (name/date/total proximity —
  the retroactive net for anything that slipped in during the push), missing
  won/lost and delivery-method answers, lump-share per code, **missing or
  unparseable bid dates** (an observation without a usable date can never be
  escalation-adjusted), and **price-jump detection** — implausible
  discontinuities for the same code+unit across bids over time (flag-only;
  thresholds ship conservative). New read-only `/data-health` page
  (company-wide, grouped by severity, each finding linking to its project);
  compact health strip on the project import/workspace view filtered to that
  project. The page documents the **quarterly review cadence**: a standing
  note that Data Health and any adopted rates get a human pass each quarter —
  derived statistics are re-validated on a schedule, not trusted indefinitely.
  **(Reconciled 2026-06-11, post-Catalog-Manager:)** the engine reads the STEP 4
  catalog through the `src/lib/catalog.ts` chokepoint (never
  `ESTIMATE_ITEMS_MASTER` directly) so in-app `catalog_additions` are covered;
  near-duplicate detection spans custom defs AND additions vs built-ins;
  retired/merged codes are excluded from "near-duplicate" findings (already
  resolved by definition); and every finding deep-links to `/catalog`, where
  merge / retire / BLI-backfill / promote now actually exist.
- **Approval gates:** none (read-only page; no schema changes, no export
  changes). Fix actions deliberately absent — fixing lives in Catalog Manager
  (roadmap item 4) and re-import.
- **Exit criteria:** same gates + `npm run build` clean (new page/route).

### Phase 5 — Suggestion signal capture (ML-readiness)
- **Scope:** record what estimators *do* with import suggestions — accepted /
  rejected / overridden — as tagged rows in the append-only training table
  (distinct `resolved_by` vocabulary, documented in one place; no schema
  change). Upgrade suggestion ranking to use the signals: downweight pairings
  estimators have rejected, weight recency, dedupe repeat observations from
  the same project. **(Reconciled 2026-06-11:)** ranking resolves merge
  redirects and drops retired codes before scoring — a signal recorded against
  a code that later gets merged refiles under the winner, and a retired code
  is never suggested (matching the resolver and the import gate's
  `activeStep23Defs` picker behavior).
- **Approval gates:** none.
- **Exit criteria:** same gates, plus a test showing a repeatedly-rejected
  pairing stops being suggested first. Closes with a short written assessment
  of exact-match hit rate on real backlog data — the input for the
  go/no-go on a future fuzzy/ML tier.

### Phase 6 — Escalation-adjusted view (UNSEQUENCED placeholder)
- **Scope (when sequenced):** choose the index (RSMeans HCI vs ENR vs BLS
  PPI-by-trade; blanket vs per-division — AACE guidance prefers per-account
  indices) with real backlog data in hand; feed it through Phase 3's seam;
  a **target-date picker** on history reports (architect-locked 2026-06-11,
  preferred over a today-only toggle): defaults to today, lets the estimator
  view prices in any chosen date's dollars — e.g. putting two old bids on
  equal footing in the same year — always showing adjusted alongside raw,
  never replacing it. The picker is **bounded to dates the index actually
  covers — no future dates** — so the feature can never drift into
  forecasting (forward escalation is confirmed not part of the team's
  workflow and stays permanently out of scope unless the business changes).
  Index values likely live in a small table refreshed on the quarterly
  cadence.
- **Approval gates:** ⛔ sequencing itself is an architect decision (index
  choice + likely one small table DDL). Not scheduled; do not chain into it.
- **Exit criteria:** defined when sequenced.

## Risks & unknowns
- **Duplicates during the push window** (architect-accepted): Phases 1 and 4
  land after backlog importing starts, so duplicates can enter unguarded.
  Phase 4's detector finds them retroactively; the unwind path (delete the
  duplicate past-bid project) needs confirming in Phase 4 — if no clean delete
  path exists, that becomes a finding for the housekeeping roadmap item.
- **`resolved_by` vocabulary sprawl**: Phases 2 and 5 both add tag values to a
  free-text column. Phase 2 establishes the documented vocabulary in one
  module; Phase 5 must extend, not invent. The risk is silent typo-tags —
  mitigated by routing every write through one db.ts helper.
- **Unit-alias list correctness**: Phase 3's alias table is domain knowledge
  (does the company ever price the same item in both SF and SY?). The
  architect supplies/approves the alias list inside Phase 3 before it ships.
- **Near-duplicate detection tuning**: Phase 4's similarity thresholds (code
  labels, project names) may need a pass of tuning against real backlog data;
  first version ships conservative (high-confidence findings only) and
  loosens with evidence.
- **Single-source statistical practices**: the outlier-screen ordering and
  price-jump findings each rest on one source (an AACE conference paper;
  a 2025 arXiv preprint). Directionally sound, but thresholds are ours to
  tune — both ship flag-only and conservative for exactly this reason.
  Explicitly NOT adopted from the research: quantity/scale price curves
  (unverified for building trades — the trust rules must not condition on
  project size without our own evidence).
- **Suggestion-ranking regressions**: Phase 5 changes what estimators see
  first at import. Mitigated by keeping the current count-ranking as the base
  and layering signals as tiebreakers/downweights, with before/after tests.

## Phase 1 kickoff prompt
Paste into a fresh session:

> Read `docs/plans/database-fidelity.md` (plan of record, forks locked) and
> execute **Phase 1 only**: the two `projects` capture columns —
> `bid_outcome` ('won'|'lost'|'pending'|'unknown', default 'unknown') and
> `delivery_method` ('hard_bid'|'negotiated'|'gmp'|'design_build'|'other'|
> 'unknown', default 'unknown') — ⛔ update `supabase_schema.sql` FIRST, show
> the exact ALTER TABLE SQL for both, and STOP for architect approval before
> applying anything live; then the two import-page dropdowns (siblings of bid
> date / market sector), the editable controls on the project view for
> backfill, and the advisory duplicate-import warning (near-match on
> normalized name + bid date; banner, never blocks). All DB access through
> `src/lib/db.ts`. Exit: suite + goldens green ($0.00 ties), `npx tsc
> --noEmit` clean, committed via `git commit -F <tempfile>`, close with
> /handoff (do NOT push). Stop at the phase boundary — Phases 2–6 and
> import-roadmap items 2–5 stay out of scope.
