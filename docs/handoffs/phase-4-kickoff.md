# Phase 4 Kickoff Prompt — Override + Audit Model

> Paste the block below as the first message of a **fresh** session to start Phase 4 of
> `docs/plans/make-the-math-trustworthy.md`. It is self-contained: every file it names is the
> durable anchor a cold session needs. Companion: `docs/handoffs/phase-3-fail-loud-hardening.md`.
>
> **Phase 4 is the first phase that changes the database.** It has TWO gates before any code:
> the normal plan-mode review gate AND a hard schema-approval gate (no DDL until the architect
> approves `supabase_schema.sql` first).

---

```
Phase 4 — Override + Audit Model for Takeoff Bridge's estimate math.

Read first, in this order:
  1. The approved plan: docs/plans/make-the-math-trustworthy.md (focus on "Phase 4")
  2. The Phase 3 handoff: docs/handoffs/phase-3-fail-loud-hardening.md
  3. The correctness contract: docs/correctness-contract.md
     (INV-3 explicit-zero protection — overrides MUST NOT break it; INV-7 provenance;
      Section 3 "visibility" rows — overrides are how a value becomes explainable)
  4. The carried-forward backlog: docs/backlog-math-trust.md (context only — B-1/B-2/B-3/B-4 are
     NOT Phase 4 work; do not pull them into scope)
  5. CLAUDE.md, AGENTS.md, and everything under memory/ (start with MEMORY.md). Pay attention to:
       - [[math-trust-plan]] (phase status), [[atomic-save-fix]] (the save_estimate RPC),
       - [[code-review-findings-2026-06-08]] + [[schema-drift-reconciliation]]: the live DB does
         NOT have get_auth_tenant_id(); deployed tenant policies INLINE
         (SELECT tenant_id FROM users WHERE id = auth.uid()). Any new RLS you write MUST use that
         inline form so supabase_schema.sql stays provably matching live.
  6. The code / DB you are changing:
       - supabase_schema.sql (CANONICAL schema; study the estimate_snapshots + classification_history
         table defs and their tenant-scoped, append-only RLS — the new table mirrors them)
       - src/lib/db.ts (the SINGLE DB gateway: createEstimateSnapshot / getEstimateSnapshots /
         getSnapshotDetail; saveEstimate via the save_estimate RPC) — all DB access routes here
       - src/lib/calculations.ts (computeTakeoffSummary — where an overrideValue is layered in as an
         INPUT while the computed value is still carried alongside; the arithmetic stays here)
       - src/types/index.ts (ProcessedTakeoffRow incl. the Phase-3 needsReview flag; where an
         override record type would live)
       - the estimate surfaces that will read/write overrides (src/hooks/useTakeoffWorkbook.tsx,
         src/app/projects/[projectId]/page.tsx) — for wiring only, not the glass-box UI (that's Phase 5)

PHASE 4 GOAL: Let an estimator OVERRIDE any computed value when their judgment differs, and
RECORD every override and milestone so a bid can later be explained and defended — without ever
letting an override silently overwrite the computed value. Both the computed value and the
override stay visible (the override is an input layer, not a destructive edit).

Locked decisions / design (recommended):
  - Override record (per overridden value): { field, computedValue, overrideValue, reason, who,
    when }. The engine uses overrideValue IN PLACE of the computed value but ALWAYS carries the
    computed value alongside (Phase 5 glass-box shows both with an "overridden" flag). This
    generalizes the pattern the template already uses for its two hand-typed %-of-estimate lines.
  - Storage — SCHEMA CHANGE, GATED. Recommended: a new APPEND-ONLY `estimate_overrides` table
    (one immutable row per override event — consistent with the append-only audit ethos of
    classification_history / estimate_snapshots). Lighter alternative: a JSONB `overrides` field on
    project_estimates / custom_fields. RECOMMEND the dedicated table for a real audit trail.
  - Change history — REUSE what exists. estimate_snapshots already captures append-only milestones
    and a `pre_import` snapshot already fires on import. Extend the wiring to also snapshot at
    save / export. Session-level edits remain covered by the existing command history.

DB guardrails (CRITICAL — Phase 4 is the first DB-touching phase):
  - INVOKE the `supabase:supabase` skill before touching ANY DB code (CLAUDE.md).
  - supabase_schema.sql is the schema source of truth: update it FIRST and get EXPLICIT architect
    approval BEFORE any DDL / apply_migration (AGENTS.md). HARD STOP at this gate.
  - Write `estimate_overrides` RLS tenant-scoped + APPEND-ONLY, in the live INLINE tenant form
    (SELECT + INSERT TO authenticated via a project→projects.tenant_id join; NO update/delete
    policy) — mirror exactly what the security batch did to classification_history /
    estimate_snapshots. Do NOT reintroduce get_auth_tenant_id().
  - All DB access via src/lib/db.ts ONLY; line-item writes still ONLY via the save_estimate RPC.
  - estimate_snapshots + classification_history are append-only (never UPDATE/DELETE). Audit/training
    writes from hooks are fire-and-forget with .catch(() => {}) so they never block the workflow.
  - calculations.ts stays the SOLE financial authority: an override is layered in as an input
    (override ?? computed), the dollar arithmetic does not move out of calculations.ts.
  - INV-3 must still hold: an explicit 0 (typed or overridden) is honored, never defaulted away.

Scope (data + engine + audit wiring + tests):
  - Override data model + db.ts CRUD: append-only insert + read of estimate_overrides (no update/delete).
  - Engine applies overrideValue while exposing computedValue (so Phase 5 can show both); INV-3 intact.
  - Milestone snapshots at save / export (extend the existing snapshot wiring; append-only).
  - Tests: override round-trip (set -> save -> reload -> still applied AND computed value still shown);
    audit immutability (no update/delete path); supabase_schema.sql matches live.

Workflow (project rules):
  - This touches >1 file AND the database -> enter PLAN MODE first: write the plan to a file and
    present an implementation-plan table. Do NOT modify files or output code until approved.
  - ADDITIONAL schema gate: update supabase_schema.sql first and STOP for explicit architect approval
    BEFORE any DDL / apply_migration (AGENTS.md Schema-Source-of-Truth).
  - After approval: implement, then run `npm run test` to green; run /code-review and address findings.

Definition of done:
  - Override round-trips (set -> save -> reload -> still applied, computed value still shown);
    audit rows immutable; supabase_schema.sql matches live (verify via list_tables / get_advisors).
  - REGRESSION GATE: `npm run test` fully green INCLUDING the McKenna golden harness still tying
    STEP 4 to the cent (it skips cleanly where the fixture is absent), and the Phase 3 import
    behavior (sign-safe parse, off-template append, atomic undo) unchanged.
  - Commit, then write a Phase 5 handoff note (docs/handoffs/) sequencing the next fresh session
    (Phase 5 = Visual Trust UI — DESIGN ONLY: produces an interaction design + a follow-up build
    plan, and PAUSES for an architect design review before any UI is built). Update the
    math-trust-plan memory + MEMORY.md.
  - Stop after Phase 4 — do not begin Phase 5.
```

---

A couple of notes on why it's shaped this way:
- It front-loads **two** gates (plan-mode review + schema approval) because Phase 4 is the first
  phase that mutates the database — AGENTS.md requires `supabase_schema.sql` to be updated and
  approved before any DDL, and CLAUDE.md requires the `supabase:supabase` skill for DB work.
- It explicitly warns about the known **file↔DB drift** (no `get_auth_tenant_id()` live; tenant
  predicates are inlined) so the fresh session writes the new table's RLS in the deployed inline
  form and keeps the schema file provably matching live — rather than reintroducing the phantom
  helper that was already reconciled away.
- It frames the override as an **input layer** (`override ?? computed`) so `calculations.ts` stays
  the sole financial authority and INV-3 (explicit-zero protection) cannot regress.
- The backlog is pointed at as **context only** so Phase 4 doesn't accidentally pull B-1…B-4 into scope.
- The Phase-3 `needsReview` flag is the natural companion: a flagged ambiguous value is exactly the
  kind of value the override surface should let an estimator resolve and record.
