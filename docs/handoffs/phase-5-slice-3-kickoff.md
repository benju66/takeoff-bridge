# Kickoff — Phase 5 BUILD, Slice 3 (5b Reconciliation tab + status chip)

> Paste this as the first message of a fresh session to build **slice 3**. Slices 1 (export applies
> overrides / INV-1) and 2 (Trust Inspector shell + 5a Trace) are DONE and committed. The design is
> approved — do NOT re-open it or re-ask the four locked decisions (design §8).

Continue the Phase 5 BUILD (Visual Trust UI / glass box) for Takeoff Bridge — **Slice 3**.

First **check out the existing build branch — DO NOT cut a new one and DO NOT branch from main:**

    git checkout phase-5-visual-trust

Confirm slices 1–2 are present: `git log --oneline -4` should show
`2b1191e` (slice 2 — Trust Inspector shell + 5a Trace),
`6413bf9` (slice 1 docs progress), and
`8b35559` (slice 1 — export applies overrides).
Run `npm run test` once to confirm the green baseline: **367 passed + 1 todo** (35 files).
(`npm run test` is vitest in a **node** env — there is no DOM/React test harness, no
`@testing-library/react`, no jsdom. Test pure logic, not the DOM — see slice 2's pattern.)

## Read before writing code, in this order
1. `docs/handoffs/phase-5-build-kickoff.md` — the architect-signed build plan. Read its
   "Build progress log" first (slices 1+2 = done, you start at **slice 3**), then the rest.
2. `docs/plans/phase-5-visual-trust-ui-design.md` — **§4 the 5b Reconciliation design** (the ASCII
   panel + the two layers), **§8 LOCKED decision #4** (build the grand-total tie now), and **§9 the
   build-slices table (slice 3 row + its gate)**.
3. `src/lib/trustInspector.ts` + `src/components/workspace/TrustInspector.tsx` (slice 2 — you extend
   the pure view-model and fill the **Reconcile** placeholder tab the same way Trace was built:
   a pure builder + a thin renderer).
4. `CLAUDE.md`, `AGENTS.md`, `memory/MEMORY.md` (→ the `math-trust-plan` memory).

## Build SLICE 3 only — 5b Reconciliation tab + status-bar chip (live, not export-gated)
- **Surface the existing scope tie live.** `validateExportReadiness(rows, gcCalcResult,
  siteOpsCalcResult)` (`src/lib/exporter.ts:424`) already returns
  `reconciliation: { lineItemTotal, rollupTotal, delta, ok }` (`RECONCILIATION_TOLERANCE = 0.01`,
  exported from `exporter.ts:328`). Today it runs **only inside** `useExportHandlers.runExportGate`
  (`src/hooks/useExportHandlers.ts:70`) and is thrown away when it passes. Expose it as a derived
  value the page computes continuously (a tiny `useExportReadiness` selector or a memo) so the tab +
  chip reflect it live — **the export gate must keep calling the same function** (single source, no
  divergence). The gc/siteOps calc results live on `personnel.calcResult` / `infrastructure.calcResult`
  in `page.tsx`.
- **Build the grand-total tie (LOCKED decision #4).** Add a small **modifier-rollup helper** in
  `exporter.ts` (Σ the 7 *effective* modifiers from the summary — the `60-xxxx` codes that
  `generateProcoreBudget` (`exporter.ts:182`) writes) so the panel ties
  **subtotal + 7 modifiers = `summary.totalEstimatedCost`** to the **full Procore budget** (scope
  rollup + the modifier `60-xxxx` rollup), Δ at the cent. With an override applied (slice 1) this is
  the **live INV-1 proof** — surface it.
- **Reconcile tab** (fill the slice-2 placeholder) renders both layers per §4: scope subtotal ↔
  217-code rollup, + 7 modifiers (60-xxxx), = TOTAL ESTIMATED COST ↔ full Procore budget total,
  Difference $0.00 ✅ TIES / Δ $X.XX ⚠. Show the **active rounding mode** inline (B-3 visibility —
  reuse `ROUNDING_MODE_LABELS` / `roundingModeLabel` from `trustInspector.ts`). Show the
  "unmapped rows carrying dollars" blocker count from the reconciliation.
- **Status-bar chip** in the existing `EstimateTable` status bar: `Procore ✅ ties` (green) or
  `Δ $X.XX ⚠` (amber) — clicking it opens the Trust Inspector on the Reconcile tab. This is the
  always-on "earned by looking" signal.

This stays a **PURE VIEW** over engine outputs. The new modifier-rollup is the only added computation —
put it in **`exporter.ts`** alongside the Procore writers (NOT in a component, NOT a new math home);
calculations.ts stays the sole authority for the summary itself. **No override SETTER yet** (that's
slice 4).

## Hard rules (don't regress these)
- `calculations.ts` stays the sole financial authority; the modifier-rollup is a *rollup of
  already-computed* effective modifiers, not new estimate math.
- **Golden McKenna must keep tying to $0.00** — add a test that the **grand-total still ties with an
  override active** (INV-1).
- `npm run test` green before the commit; `/code-review` before delivery.

## Two traps to respect
- **Single source.** The chip/tab and the export gate must call the *same* `validateExportReadiness` —
  don't fork a second reconciliation path.
- **Amendment F (filtered view).** When a grid filter is active the page summary reflects only visible
  rows. Reconciliation is for export, which uses the **full** row set — compute the recon selector from
  the **unfiltered** `rows` (and the full summary), not `filteredRows`. Don't let a search box make the
  chip say "ties" against a partial number.

## Tests
Builder/wiring + reconciliation assertions in node (mirror slice 2 — extract any tie-math into a pure
helper and assert it there; no DOM). Scope tie AND grand-total tie at the cent; chip reflects a forced
Δ; grand-total still ties with an override active.

## Multi-session
Stop at a sensible green-committed point with a handoff note (update the kickoff progress log + the
`math-trust-plan` memory) rather than rushing ahead.

## Reminder for later (NOT slice 3)
**Slice 6 (rounding default → `none`) PAUSES for architect approval** on a 1-line
`projects.rounding_rule` migration — update `supabase_schema.sql` first and invoke the
`supabase:supabase` skill. The default is still `'dollar'` in code until then — do not flip it in
slice 3; only *display* the active mode.
