# Phase 3 Kickoff — Division 60 Fee-Block Addressability: Render fee lines + persistence

_Ready-to-paste prompt for a fresh cold session. Written 2026-06-26._

---

## Kickoff prompt

> Implement **Phase 3 of the Division 60 Fee-Block Addressability plan**
> (`docs/plans/2026-06-23-fee-block-addressability.md` — read it first, plus the
> Phase 1 + Phase 2 context below). Scope is **render + persistence**: load the
> `section='markup'` fee lines through the existing gateway and show them as real
> rows in the Division 60 block of the STEP 4 estimate, with their flat amount
> reflected in the grand total, surviving a reload. **Display + persistence only —
> NO editing, NO context menu, NO insert/delete, NO export, NO import** (those are
> Phases 4-6).
>
> **Concretely:**
> - **Load:** markup lines already arrive with the rest of the section lines —
>   `useProjectWorkspace.ts` (~`:72`) calls `getSectionLines(projectId)`, which is
>   section-agnostic and already returns `'markup'` rows. Split them out with
>   `isMarkupLine` (from `src/lib/sectionLines/markup.ts`) the same way GC/Site-Ops
>   lines are split, and thread the markup-line array down to the page.
> - **Feed the engine:** pass the markup-line array as the **7th positional arg**
>   (`markupLines`) to the two live `computeTakeoffSummary` calls in
>   `src/app/projects/[projectId]/page.tsx` (`:278` filtered summary, `:288`
>   unfiltered summary). The engine math is DONE (Phase 2) — this is pure wiring.
>   Mind the Amendment-F filtered-view rule: the filtered summary still adds the
>   fee lines (they are below-subtotal and not row-filterable), so pass the full
>   markup-line set to BOTH calls (decide + document; fee lines are not takeoff rows).
> - **Render:** show each markup line as a row in the Division 60 fee block of
>   `EstimateTable.tsx` (the block currently lives in a static `<tfoot>` around
>   `:989`) — display label, amount, and the Procore code or an "unmapped"/needs-review
>   badge. This likely requires **lifting the fee block out of the static `<tfoot>`**
>   into a render path that can host data rows alongside the 7 computed modifier rows
>   (the plan's "footer → grid lift" risk — confirm the cleanest path; watch table
>   layout, the status-bar / Buyout-footer ordering, and virtualization).
> - **Persistence:** markup lines save through the SAME `save_section_lines` path the
>   GC/Site-Ops lines already use — `saveSectionLines(projectId, sectionLines)` in
>   `useEstimatePersistence.ts` (~`:131`). The RPC is a full per-project replace across
>   ALL sections, so markup rows must be INCLUDED in the array handed to it (do not
>   drop them on save, or they'll be deleted). Phase 3 may not create new lines yet
>   (that's Phase 4's insert), but it MUST round-trip any existing markup line through
>   save without loss.
>
> **No editing yet** — the context menu (Insert/Delete), inline edit, command history,
> and Procore-code validation are Phase 4. Phase 3 only displays stored lines and keeps
> them alive across save/reload.
>
> **Approval gates:** none (no DDL, no schema change — storage + types + engine all
> exist). Do NOT merge to `main`.
>
> Take the phase through the full **Definition of Done** (CLAUDE.md): `npm run test`
> green · `npx tsc --noEmit` clean · `npm run build` green · `/code-review` resolved ·
> commit via `git commit -F` to the **existing** `fee-block-addressability` branch +
> push · write the Phase 4 handoff via `/handoff`. **Run only this one phase.**

---

## Exit criteria (from the plan, Phase 3)

- A stored markup line shows on the estimate page in the Division 60 block, with its
  flat amount reflected in the **Total Estimated Cost** (via the Phase 2
  `additionalFees` engine field), and **survives a reload** (loaded via the gateway,
  preserved through the `save_section_lines` full-replace).
- The 7 computed modifier rows and the rest of the estimate render unchanged
  (footer → grid lift does not regress layout / totals / the Trust Inspector chip).
- Full Definition of Done: test green · `tsc` clean · `build` green · `/code-review`
  resolved · committed + pushed to `fee-block-addressability` · Phase 4 handoff written.

---

## Where Phase 2 left off (calc engine — COMPLETE)

Phase 2 is **done, committed (`0712b0e`), and pushed** on branch
`fee-block-addressability`. It is **engine math only** — no UI, no render, nothing
loads markup lines into the page yet. Full suite **1440 passing**; tsc clean; build green.

**What shipped (all in `src/lib/`):**
- `calculations.ts` — `TakeoffSummary` gained an **`additionalFees: number`** field, and
  `computeTakeoffSummary` gained an optional trailing param
  **`markupLines?: EstimateSectionLine[]`** (the 7th positional arg, after `overrides`).
  Each markup line's `inputs.amount` (read via `feeLineAmount`, filtered by `isMarkupLine`)
  is **rounded independently** (`applyRounding`), optionally type-over'd via its
  `line:<id>:total` key (reusing the existing `eff` override closure — recorded into
  `summary.overrides` for Trust Inspector attribution), then summed into BOTH
  `computedTotal` and `effectiveComponentTotal` — **AFTER** subtotal + the 7 modifiers.
  It NEVER touches `subtotal` or any `raw*` (subtotal × rate) modifier → flat,
  below-subtotal, never marked up (locked decision). Omitted/empty → `additionalFees = 0`,
  byte-identical to before (fully inert).
- `bindings/types.ts` + `bindings/engineGraph.ts` — added the `summary:additionalFees`
  echo node (a cross-page leaf, no inputs in the summary tier) and wired it into the
  `totalEstimatedCost` node's `inputs`, so the depends-on graph stays honest
  (total = subtotal + 7 modifiers + additionalFees). `bindings/registry.ts` got a
  friendly label ("Additional fees (Division 60)").
- `__tests__/markupFeeCalc.test.ts` **(new, 10 tests)** — proves a flat **$2,500** line
  raises `totalEstimatedCost` by **exactly $2,500** with subtotal + 7 modifiers
  byte-identical; inert-when-empty; no compounding; independent per-line rounding;
  per-line `line:<id>:total` override (incl. override-of-0); direct-total-override
  precedence; defensive non-markup filter; graph echo. The 3 binding-graph tests were
  updated from 13 → 14 summary fields.

**Design decision locked in Phase 2 (carry forward):** a fee line's dollar is overridable
**per-line only**, via `line:<id>:total` (`sectionLineTotalOverrideKey` in
`src/lib/sectionLines/ids.ts`) — mirroring GC/Site-Ops one-off line totals.
`additionalFees` is a derived aggregate, NOT itself in `OVERRIDABLE_SUMMARY_FIELDS`.

## Phase 3 gotchas / pointers

- **Storage shape (from Phase 1):** a fee line is an `estimate_section_lines` row with
  `section='markup'`, `entry_kind='lumpSum'`, the dollar in `inputs.amount` (NOT
  `inputs.value`), `code=''`, `procoreCode` blank until assigned, `source` ('manual' or
  'csv_import'). Read the amount with `feeLineAmount(line)`; filter with `isMarkupLine(line)`
  (both in `src/lib/sectionLines/markup.ts`). Identity is `id` (`markup:fee:<uuid>`), NOT `code`.
- **The save RPC is a FULL per-project replace across all sections.** `saveSectionLines`
  → `save_section_lines` deletes and re-inserts every section line for the project. If you
  load gc/site_ops/markup but save only gc/site_ops, the markup rows are **silently
  deleted**. Whatever array you hand `saveSectionLines` must carry the markup lines too.
- **`sort_order` integrity (AGENTS.md):** section lines load `ORDER BY sort_order ASC` and
  must not be re-sorted client-side; the gateway re-stamps `sort_order` from the array index
  on save. Keep markup lines in a stable position in the saved array.
- **Footer → grid lift (plan risk):** the Division 60 block is currently computed cells in a
  static `<tfoot>` (`EstimateTable.tsx` ~`:989`). Hosting editable/data rows there may affect
  table layout, virtualization, and the status-bar / Buyout-footer ordering — confirm the
  cleanest render path before committing to it. Phase 3 is display-only, so a minimal
  data-row render is enough; full edit affordances are Phase 4.
- **No new lines yet:** Phase 3 does not add an Insert action. If no markup lines exist in
  the DB, the block renders exactly as today (the feature is invisible until a line exists).
  To test the render/round-trip end-to-end you may need to seed one markup line directly (or
  via a temporary test fixture) — the user-facing Insert is Phase 4.
- **Trust Inspector reconciliation:** once a fee line carries dollars, the Procore
  reconciliation (ReconcileTab) will show a delta because the fee line is not yet in the
  export rollup — that rollup wiring is **Phase 5**, not Phase 3. Don't try to fix it here.

## Remaining phases (plan of record)

- **Phase 4** — Edit: context-menu Insert/Delete + inline edit, command history
  (undo/redo via `commandHistory.pushCommand` per AGENTS.md), `source='manual'`, Procore
  code validation against the `procore_cost_codes` authority (surface the override UI for
  unknown codes, never guess a type).
- **Phase 5** — Export: write fee lines into the template fee block + Procore BLI rollup
  (highest risk — fixed-template-layout / formula re-anchoring; `export-integrity` golden
  delta must stay $0.00).
- **Phase 6** — Import fold-in (`templateExtractor.ts` ~440-457): capture an unknown
  fee-block row as a markup line so a hand-keyed `$2,500` fee ties out to `$0.00`.
  **After Phase 6 the workstream is complete → merging to `main` requires explicit
  architect approval** (the one main-push prompt is the gate).
