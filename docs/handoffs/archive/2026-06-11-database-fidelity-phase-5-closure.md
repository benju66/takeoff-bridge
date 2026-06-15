# Database Fidelity — Phase 5 Closure (Suggestion signal capture / ML-readiness)

_2026-06-11 · Phase 5 COMPLETE on local main (`f3deb35`, NOT pushed; sits on top
of the unpushed Phase 4 `0da41d1`/`e3726a4`). Suite 756 pass / 67 files, goldens
tie $0.00 (McKenna + synthetic + CARE), `npx tsc --noEmit` clean, /code-review
(9 finder angles + verification + sweep) findings resolved pre-commit._

**The database-fidelity plan (`docs/plans/database-fidelity.md`) is now
functionally complete: Phases 1–5 all shipped.** Phase 6 (escalation-adjusted
view) is ⛔ UNSEQUENCED by design — sequencing it is itself an architect
decision (escalation index choice: RSMeans HCI vs ENR vs BLS PPI-by-trade,
blanket vs per-division; plus likely one small index table = DDL gate). There
is deliberately NO kickoff prompt for it. When the architect wants it, start a
fresh session from the plan file's Phase 6 section with real backlog data in
hand.

## What Phase 5 shipped

- **`src/lib/resolvedBy.ts`** — vocabulary extended: `suggestion_accepted` /
  `suggestion_rejected` / `suggestion_overridden`. Accepted/overridden stay
  OUT of `TRUSTED_RESOLVED_BY` (each signal is PAIRED with a clean `user` row
  recording the same pairing — counting both would double-count). New
  `RANKING_RESOLVED_BY` = trusted base + rejections, the bulk read's query
  allowlist.
- **`src/lib/importEstimate.ts` → `suggestionSignalsForSave`** — pure signal
  derivation at save: confirmed the primary → accepted; confirmed a different
  code → rejected (against the declined primary) + overridden (against the
  chosen code). CONSERVATIVE: untouched rows, `none`/`similar` tiers (no
  UI-distinguished primary — `similar` renders equal chips, architect F3), and
  combined-marked lump rows emit NOTHING (the Phase 2 quarantine works in both
  directions — a lump line's assignment is scope-lumping, not a judgment on
  the suggested code).
- **`src/lib/db.ts` → `recordClassificationResolutions`** — batched signal
  insert (one request; a rejected/overridden pair lands atomically),
  fire-and-forget at the import save. NOTE: the deployed RLS insert policy
  requires a tenant-owned project id — never pass null in production.
- **`src/lib/suggestionRanking.ts` (new, pure)** — the ranking authority
  behind `getClassificationHistoryBulk`: Phase 3 count-base preserved
  (regression-tested) + distinct-project dedupe (no-identity rows collapse to
  ONE per pairing — deleted-project SET-NULL residue can never amplify) +
  rejection downweight (`REJECTION_DOWNWEIGHT = 1` distinct-project rejection
  cancels one confirmation) + recency tiebreak + lifecycle resolution BEFORE
  scoring (merged → refile under winner including BUILT-IN winners via the
  absent-from-defs = active convention; retired/corrupt/cycle → drop).
- **`db.ts getClassificationHistoryBulk`** — fetches
  `resolved_by/project_id/created_at`, chunks run in parallel, and each chunk
  PAGES past PostgREST's 1000-row response cap under a stable total order
  (`created_at` desc, `id` asc) — ranking needs the complete pool. Signature
  gained optional `lifecycleDefs`; return shape and fail-soft contract
  unchanged.
- **Import page** — passes lifecycle defs into the bulk read (inline fallback
  fetch if a fast file-drop beats the mount load, cached via
  `customDefsLoadedRef`; customs shadowing built-in STEP 2/3 / linked /
  catalog codes filtered out — the resolver's collision rule, mirrored).

## Closing deliverable: exact-match hit-rate assessment

**The live DB cannot answer the question yet.** Checked 2026-06-11:
`classification_history` is EMPTY; 1 project total, 0 imported. The backlog
import push has not started on live, so "hit rate on real backlog data" was
measured on the only real backlog artifacts available — the two real bids on
disk, run through the real extraction pipeline:

| Bid | STEP 4 rows | Ad-hoc (suggestion-eligible) | Distinct descriptions |
|---|---|---|---|
| McKenna (modern format) | 219 | **0** | — |
| CARE (true legacy) | 142 | **142** | 137 |

- **Cross-bid exact-description overlap: 0 of 137, both directions — zero
  even after lowercase/alphanumeric normalization.** Two different sectors,
  different authors: not one line repeats verbatim.
- **CARE's tier mix with no history available:** bridge 87 (61%) · linked 9
  (6%) · similar 46 (32%) · none 0. The workbook's own BLI bridge already
  resolves ~⅔ near-certainly; the history tier's incremental value is
  concentrated in the ~⅓ `similar` remainder.

**Reading for the go/no-go:** n=2 is weak evidence, but it points one way —
verbatim repeats across heterogeneous projects are likely RARE, so the
deterministic exact-match tier alone will probably not cover the `similar`
third. Exact-match value should concentrate in re-bids/forks of the same
project family, same-estimator recurring scope lines, and very common scopes
once the pool reaches tens of bids. If the measured hit rate on `similar`-tier
lines stays low after the push (<20–30%), the fuzzy/ML tier is the lever — and
Phase 5's accepted/rejected/overridden stream is exactly its training set,
already accumulating from the first backlog import. Per the plan, hold the
decision until the push provides the real number.

**Ready-to-run measurement once the backlog lands** (time-ordered simulation:
of each project's confirmed descriptions, how many had a prior exact match
from an earlier project):

```sql
WITH t AS (
  SELECT classification, project_id, MIN(created_at) AS first_seen
  FROM classification_history
  WHERE resolved_by IN ('user','global','seed','ai') AND project_id IS NOT NULL
  GROUP BY classification, project_id
)
SELECT
  COUNT(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM t prior
    WHERE prior.classification = t1.classification
      AND prior.first_seen < t1.first_seen
      AND prior.project_id <> t1.project_id
  )) AS lines_with_prior_exact_match,
  COUNT(*) AS confirmed_lines
FROM t t1;
```

## Review findings consciously DECLINED (with rationale)

- **A heavily-rejected SOLE pairing still surfaces as the history primary**
  (score can go negative with no competitor). Kept: the plan's flag-only,
  conservative philosophy — showing the only known pairing with its honest
  "× N" badge beats falling to a fuzzy guess. A "drop below score X" rule is a
  tuning decision for after the backlog push.
- **Plain `localeCompare` code tiebreak (no `numeric: true`)** — kept to
  preserve the Phase 3 base ordering byte-for-byte (the before/after
  regression mandate outranks picker-style consistency for ranking ties).
- **`parseTime` (Date.parse) vs the ISO-string-compare convention** in
  priceHistory/historyTrust — kept: it validates garbage to epoch instead of
  trusting it; second mechanism risk noted.
- **Clean-row loop and signal loop stay separate in handleSave** — the
  paired-signal invariant is documented by cross-reference comments instead of
  restructuring the Phase 2/3 clean-write path inside Phase 5.
- **Pre-existing, NOT worsened (housekeeping candidates):** PostgREST `.in()`
  quote-escaping can 400 a whole chunk when a description contains `"` plus
  `,`/`(` (the caller degrades fail-soft, losing the history tier for that
  bid); `getClassificationHistory` (singular) is a legacy reader with no
  production consumers — docstring now warns it lacks the Phase 5 semantics.

## State a fresh session may need

- **Unpushed local commits on main:** Phase 4 `0da41d1` + handoff `e3726a4` +
  Phase 5 `f3deb35` + this closure doc. Push remains an architect decision.
- **Uncommitted working tree (pre-existing, leave alone):** docs archive moves
  (deleted `docs/handoffs/*`/`docs/plans/*` with untracked copies under
  `docs/*/archive/`), untracked `scripts/probe-step23-formulas.cjs`, stray
  `C꞉tempfindings.json`. Always `git add` specific files.
- **Remaining roadmap (separate workstreams, fresh sessions via /plan-phases):**
  import items 2 (past-vs-active) / 3 (housekeeping — now also carrying the
  `.in()` escaping note and the SET-NULL residue neutralization decision) / 5
  (fork-a-past-bid); Excel round-trip feature (architect priority, unplanned);
  math-trust B-2 + B-5.
