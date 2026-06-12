# Database Fidelity — Phase 5 Kickoff (Suggestion signal capture / ML-readiness)

_2026-06-11 · previous phase: Phase 4 complete on local main (`0da41d1`, NOT
pushed) — pure `src/lib/dataHealth.ts` audit engine (8 finding types, flag-only,
conservative named thresholds), read-only `/data-health` company dashboard
grouped by severity with deep links to projects and `/catalog`, compact
`DataHealthStrip` on the project workspace (same engine, filtered via
`findingsForProject`), two READ-only db.ts fuel helpers. Suite 722/65, goldens
tie $0.00, tsc clean, build clean._

## Ready-to-paste prompt for a fresh session

> Read `docs/plans/database-fidelity.md` (plan of record, forks locked) and
> execute **Phase 5 only**: suggestion signal capture (ML-readiness).
> Scope: record what estimators DO with import suggestions — accepted /
> rejected / overridden — as tagged rows in the append-only
> `classification_history` table (distinct `resolved_by` values; the
> documented vocabulary lives in `src/lib/resolvedBy.ts` from Phase 2 —
> EXTEND it there, never invent ad-hoc tags; route every write through the
> one db.ts helper; fire-and-forget `.catch(() => {})` per AGENTS.md).
> Then upgrade suggestion ranking (`getClassificationHistoryBulk` ranking +
> its consumers) to use the signals: keep the current count-ranking as the
> BASE and layer signals as downweights/tiebreakers — downweight pairings
> estimators have rejected, weight recency, dedupe repeat observations from
> the same project. Ranking must resolve Catalog-Manager merge redirects and
> drop retired codes BEFORE scoring (use `src/lib/catalogLifecycle.ts`
> helpers — a signal recorded against a later-merged code refiles under the
> winner; a retired code is never suggested), matching `resolveStep23Line`
> and the import gate's `activeStep23Defs` behavior. No schema changes
> (`resolved_by` is free text). Exit: `npm run test` green (including a test
> proving a repeatedly-rejected pairing stops being suggested first, plus
> before/after ranking regression tests) · goldens tie $0.00 · `npx tsc
> --noEmit` clean · `/code-review` findings resolved · committed via
> `git commit -F <tempfile>` · close with /handoff (do NOT push) **plus the
> plan's closing deliverable: a short written assessment of the exact-match
> hit rate on real backlog data — the input for the go/no-go on a future
> fuzzy/ML tier.** Stop at the phase boundary — Phase 6 is ⛔ UNSEQUENCED
> (architect decision: escalation index choice + likely one small table);
> import-roadmap items 2/3/5 stay out of scope.

## Where Phase 4 left off (context a cold session may need)

- **Plan file:** `docs/plans/database-fidelity.md` — Phase 5 section + its
  post-Catalog-Manager reconciliation note + "Risks" (suggestion-ranking
  regressions: base count-ranking stays, signals layer on top;
  `resolved_by` vocabulary sprawl: Phase 5 extends Phase 2's documented
  vocabulary, never invents).
- **`src/lib/resolvedBy.ts` is the vocabulary module** (Phase 2):
  `TRUSTED_RESOLVED_BY` already gates which training rows count for mining
  (db.ts imports it). New accepted/rejected/overridden tags belong THERE,
  documented, with the mining/ranking filters updated deliberately.
- **Write path:** `recordClassificationResolution` (db.ts) appends to the
  append-only `classification_history` table. Training-table writes from
  hooks are fire-and-forget (`.catch(() => {})`) — AGENTS.md.
- **Ranking today:** `getClassificationHistoryBulk` (db.ts ~line 720)
  returns per-classification code counts sorted by count desc; the import
  flow consumes it for suggestions. Phase 5 layers signals on this.
- **Phase 4 artifacts reusable here:** `src/lib/dataHealth.ts` shows the
  severity/threshold conventions; `useDataHealth` shows the multi-source
  fail-soft loader idiom. The Data Health page will surface nothing new in
  Phase 5 — but if signal capture exposes data-quality artifacts, a new
  finding type in dataHealth.ts is a natural (optional, small) extension.
- **Delete-path answer (Phase 4 task, for the housekeeping roadmap item):**
  a clean unwind for a duplicate past-bid project EXISTS — /projects →
  confirm → `deleteProjectData` → FK cascades remove project_estimates
  (incl. imported_step23_lines), estimate_line_items, estimate_versions,
  estimate_snapshots, estimate_overrides. RESIDUE recorded for housekeeping:
  `classification_history` rows survive with `project_id` SET NULL
  (append-only by design), so a deleted duplicate's training observations
  linger untraceably — Phase 5's per-project dedupe cannot see them, and a
  deliberate decision on neutralizing them belongs to the housekeeping
  roadmap item, NOT this phase.
- **Known accepted cost (do not "fix" in passing):** `DataHealthStrip`
  mounts `useDataHealth` on every workspace load — 7 parallel reads + the
  engine, fresh each mount (matches the /rates fail-soft conventions; fine
  at internal-tool scale). The obvious upgrade path (shared cache/context)
  is deferred until it actually hurts.
- **Uncommitted working tree (pre-existing, NOT this phase's):** the docs
  archive move (deleted `docs/handoffs/*` + `docs/plans/*` with untracked
  copies under `docs/*/archive/`), an untracked
  `scripts/probe-step23-formulas.cjs`, and a stray `C꞉tempfindings.json`
  sit in the working tree. Leave them alone; `git add` specific files only.
- Exit-gate commands: `npm run test` · `npx tsc --noEmit` · commit message
  written to a temp file (Write tool, no BOM) then `git commit -F <file>` —
  never inline multi-line commit text (Windows shell rule).

## Approval gates

None inside Phase 5 (free-text tag values + read-side ranking; no DDL).
Do NOT push. Do NOT chain into Phase 6 — sequencing it is itself an
architect decision (⛔ escalation index choice + likely one small table).
