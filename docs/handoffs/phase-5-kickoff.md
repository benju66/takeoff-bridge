# Phase 5 kickoff prompt (paste as the first message of a fresh session)

> Phase 5 of `docs/plans/make-the-math-trustworthy.md`. Phases 1–4 are DONE on `main`
> (Phase 4 = `94114f5`). Phase 5 is **DESIGN ONLY** — it produces an interaction design +
> a follow-up build plan and PAUSES for an architect design review before any UI is built.

---

Phase 5 — Visual Trust UI (glass box) for Takeoff Bridge's estimate math. DESIGN ONLY.

This phase produces (1) an interaction design and (2) a follow-up build plan — it does
NOT ship UI. It PAUSES for an architect design review before any UI is built.

Read first, in this order:
  1. The approved plan: docs/plans/make-the-math-trustworthy.md (focus on "Phase 5")
  2. The Phase 4 handoff: docs/handoffs/phase-4-override-audit.md
     (the override data layer the glass box reads/writes, AND the carried-forward
      "export must apply overrides / INV-1" build requirement)
  3. The correctness contract: docs/correctness-contract.md — especially:
       - INV-1 single total (on-screen == saved == exported) — 5b reconciliation view shows this
       - INV-7 provenance completeness (the remaining it.todo — 5c makes the badge real)
       - Section 3 "silent-escape register" visibility rows: unset-modifier defaulting
         (⚙ system default vs ✎ project-set) and card-price defaulting — these are
         "make it visible, not silent" Phase 5 fixes, NOT math changes
  4. The backlog: docs/backlog-math-trust.md — B-3 (rounding-mode visibility → 5b) and
     B-4 (inline-recoverable unmapped import rows → 5c) land in Phase 5; B-1/B-2 do not
  5. CLAUDE.md, AGENTS.md, and memory/ (start with MEMORY.md): [[math-trust-plan]]
     (phase status — Phases 1-4 DONE on main), [[code-review-findings-2026-06-08]]
  6. The code you are designing OVER (read-only — no math moves; calculations.ts stays
     the sole financial authority):
       - src/app/projects/[projectId]/page.tsx (where takeoffSummary, divisionBreakdown,
         costTypeBreakdown, strayLinkedRows, activeOverrides are assembled)
       - src/components/workspace/EstimateTable.tsx + src/hooks/useTakeoffWorkbook.tsx
         (the grid; cells already carry row.source and the linked-row state)
       - src/lib/calculations.ts — computeTakeoffSummary ALREADY EXPOSES the data the
         glass box renders: takeoffSubtotal, linkedDivisionsTotal, the 7 modifiers, and
         (Phase 4) summary.overrides[field] = { computedValue, overrideValue }; plus
         computeDivisionBreakdown / computeCostTypeBreakdown
       - src/lib/exporter.ts — validateExportReadiness already returns the reconciliation
         object (lineItemTotal / rollupTotal / delta / ok) that runs SILENTLY today
       - The Phase 4 override layer to wire the SETTER onto: db.recordEstimateOverride
         (append, throws), db.getEstimateOverrides, useEstimateOverrides (activeOverrides
         + overrideRecords + refresh), OVERRIDABLE_SUMMARY_FIELDS, types
         EstimateOverrideRecord + ProcessedTakeoffRow.source/needsReview

PHASE 5 GOAL: make every number's construction VISIBLE so trust is earned by looking.
Three surfaces, each largely a VIEW over data the engine already returns:
  5a — Click-to-trace: click any total → a panel unfolds it to its inputs
       (Total → Subtotal → Takeoff Σqty×price [N rows] + Linked divisions [GC+SiteOps];
        each modifier with its rate and whether the rate is project-set ✎ or default ⚙).
  5b — Reconciliation view: surface the already-running validateExportReadiness result
       (on-screen total vs exported Procore rollup vs Δ, ✅ ties), instead of hiding it
       behind the export gate. Also surface the active rounding mode (B-3).
  5c — Provenance & override flags: badge every cell by source
       (▦ template / ⬚ imported / ✎ manual / ⚑ overridden / ⚙ system default); an
       overridden value shows computed-vs-override (Phase 4 summary.overrides) on hover;
       needsReview rows and inline-recoverable unmapped import rows are surfaced (B-4).

This phase ALSO designs the override SETTER interaction (the click-to-override flow that
calls db.recordEstimateOverride then useEstimateOverrides().refresh(); revert = record
with overrideValue: null; audit log = overrideRecords). The build plan it produces MUST
include the carried-forward INV-1 task: the export path (exporter.ts —
generateExcelPayload / generateProcoreBudget / generateExcelWorkbook) must apply
overrides (write override VALUES instead of the recomputing modifier formula) so that
on-screen == saved == exported once the setter ships. Today that is latent only because
there is no setter; Phase 5 ends that.

Guardrails (unchanged): calculations.ts is the SOLE financial authority — Phase 5 is a
VIEW + a setter that records an override as an input; no totals/markups/formulas are
invented elsewhere. All DB access via db.ts; overrides are append-only (no update/delete);
audit writes that aren't financial intent stay fire-and-forget. INV-3 (explicit 0) holds.

Workflow (project rules):
  - DESIGN ONLY. Do NOT write or edit application code this phase. Use plan mode /
    research; produce the interaction design + a follow-up build plan as docs.
  - Deliverables: an interaction-design doc and a sequenced build plan (a future phase),
    written to docs/ per the phased-handoff convention.
  - HARD STOP: present the interaction design and PAUSE for an architect design review
    before any UI is built. Do not begin building.

Definition of done:
  - An interaction design for 5a/5b/5c + the override setter, reviewed/approved by the
    architect (a design walkthrough; 5b shows a real tie-out), AND a follow-up build plan
    that explicitly includes the export-applies-overrides (INV-1) work and the B-3/B-4 +
    INV-7 items. No app code changed; npm run test still green.
  - Update the math-trust-plan memory + MEMORY.md; write a build-phase kickoff for the
    next fresh session. Stop after the design is approved — do not start the build.

Practical setup: sync local main first (git checkout main && git pull) — Phases 1-4 are
already on main (Phase 4 = 94114f5). No code branch is needed yet; cut one only when the
build plan is approved.
