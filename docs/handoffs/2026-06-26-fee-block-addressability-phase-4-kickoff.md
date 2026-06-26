# Phase 4 Kickoff — Division 60 Fee-Block Addressability: Edit fee lines (context menu + command history)

_Ready-to-paste prompt for a fresh cold session. Written 2026-06-26._

---

## Kickoff prompt

> Implement **Phase 4 of the Division 60 Fee-Block Addressability plan**
> (`docs/plans/2026-06-23-fee-block-addressability.md` — read it first, plus the
> Phase 1-3 context below). Scope is **editing the fee block**: make the context
> menu functional in the Division 60 fee block so an estimator can **Insert** a flat
> fee line, **Delete** one, and **inline-edit** its label / amount / Procore code —
> each fully **undo/redo-able** via command history. **Edit only — export is Phase 5,
> import fold-in is Phase 6.**
>
> **Concretely:**
> - **Insert / Delete / inline-edit** in the fee block. A new line is built with
>   `newFeeLine(...)` (`src/lib/sectionLines/markup.ts`) → `source='manual'`,
>   `section='markup'`, `entry_kind='lumpSum'`, dollar in `inputs.amount`, `procoreCode`
>   BLANK (never guessed). Deletes/edits mutate the same markup-line array.
> - **Command history (AGENTS.md, non-negotiable):** every insert / delete / edit MUST
>   call `commandHistory.pushCommand()` with a properly constructed `WorkbookCommand`
>   (`src/hooks/useCommandHistory.ts`) carrying enough inverse data (prev/next line state)
>   that a **single Ctrl+Z reverses it atomically**. Decide in Phase 4 whether the existing
>   grid `WorkbookCommand` variants cover section-line insert/delete/edit or a new variant
>   is needed (plan risk "Command-history reuse").
> - **State ownership:** Phase 3 holds markup lines as **read-only** `persistedMarkupLines`
>   in `useProjectWorkspace` (set once on load). Phase 4 must make them **mutable** —
>   move ownership to where the command history + save live (likely lift into the workbook
>   / a dedicated hook) so an edit re-renders, re-feeds the engine, and re-saves. The save
>   path already round-trips them: `page.tsx`'s `persistedSectionLines` memo
>   (`[...sectionLines, ...markupLines]`) feeds `useEstimatePersistence` → the full-replace
>   `save_section_lines` RPC. Keep markup lines OUT of the binding-projection `sectionLines`
>   (a markup line projects as a bogus zero-total graph node — that separation is deliberate).
> - **Procore code validation:** validate an assigned code against the `procore_cost_codes`
>   authority (via the primed `procoreValidCodes` overlay), surfacing the existing override /
>   needs-review UI for an unknown code rather than inventing a `type` (AGENTS.md "Procore
>   Cost Code Authority" / "No Speculative Changes"). The Phase 3 "unmapped / needs review"
>   badge already marks a blank code.
> - _"Define Link" stays as-is_ — it is the value-binding authoring panel, NOT the Procore
>   mapping; out of scope here.
>
> **Approval gates:** none (no DDL — storage/types/engine all exist). Do NOT merge to `main`.
>
> Take the phase through the full **Definition of Done** (CLAUDE.md): `npm run test` green ·
> `npx tsc --noEmit` clean · `npm run build` green · `/code-review` resolved · commit via
> `git commit -F` to the **existing** `fee-block-addressability` branch + push · write the
> Phase 5 handoff via `/handoff`. **Run only this one phase.**

---

## Exit criteria (from the plan, Phase 4)

- Insert / edit / delete work in the Division 60 fee block; a single Ctrl+Z reverses
  each atomically (insert↔delete, edit restores prior label/amount/code).
- Inserted lines persist with `source='manual'`; an assigned Procore code is validated
  against the authority (unknown → needs-review UI, never a guessed type).
- Full Definition of Done: test green · `tsc` clean · `build` green · `/code-review`
  resolved · committed + pushed to `fee-block-addressability` · Phase 5 handoff written.

---

## Where Phase 3 left off (render + persistence — COMPLETE)

Phase 3 is **done, committed (`7da00ec`), and pushed** on branch
`fee-block-addressability`. Suite **1446 passing**; tsc clean; build green.

**What shipped:**
- **`src/hooks/useProjectWorkspace.ts`** — splits the `section='markup'` lines out of the
  section-agnostic `getSectionLines` read into a new **`persistedMarkupLines:
  EstimateSectionLine[]`** return field (referentially stable; loaded for app-born AND
  imported — provenance-agnostic; reset on project change). This is **read-only** today.
- **`src/app/projects/[projectId]/page.tsx`** — threads `persistedMarkupLines` as the
  **7th positional arg** into BOTH `computeTakeoffSummary` calls (`takeoffSummary` filtered
  + `fullTakeoffSummary` unfiltered) — the **same full set to each** (Amendment F: a fee
  line is below-subtotal and not a filterable row, so a grid filter must not partial it
  out). A new **`persistedSectionLines`** memo (`[...sectionLines, ...persistedMarkupLines]`)
  feeds `useEstimatePersistence` so the full-replace RPC never deletes the fee rows — kept
  **separate** from the binding-projection `sectionLines`. Passes `markupLines=` to
  `EstimateTable`.
- **`src/components/workspace/EstimateTable.tsx`** — renders each markup line as a `<tr>`
  in the Division 60 fee block (inside the existing `<tfoot>`, **below** the 7 computed
  modifier rows, **above** the grand total): label, amount, Procore code or an **"unmapped /
  needs review"** badge. Display-only — no edit affordances yet. The fee block stayed in
  the `<tfoot>` (no grid lift needed for display; revisit if Phase 4 editing demands it).
- **`src/lib/calculations.ts`** — extracted the engine's per-component rounding into an
  exported **`roundByRule(val, rule)`** (internal `applyRounding` now delegates —
  behavior-preserving); the fee-block rows DISPLAY each line via `roundByRule` so a row
  ties to the total even under a non-default rounding rule (Zero-Budget-Leaks).
- **`src/lib/__tests__/markupFeePersistence.test.ts`** (new, 6 tests) — save-array integrity
  (markup rides the full-replace + reloads split-out via `isMarkupLine`; dropping it would
  lose it), Amendment-F same-set (`additionalFees` identical filtered vs unfiltered while the
  subtotal partials-out), and the display-tie (`roundByRule` == per-line `additionalFees`
  contribution).

## Phase 4 gotchas / pointers

- **Markup state is read-only in Phase 3.** `persistedMarkupLines` is set once on load in
  `useProjectWorkspace` and never mutated. Phase 4 must relocate ownership to a mutable
  store co-located with the command history + the save trigger, then re-thread it into the
  `computeTakeoffSummary` 7th arg, the `persistedSectionLines` persist memo, and the
  `EstimateTable markupLines` prop (all three currently read the workspace-hook value).
- **The save RPC is a FULL per-project replace across all sections.** Any mutation must keep
  the markup lines in the array handed to `saveSectionLines` or they're deleted. The
  `persistedSectionLines` memo is the single choke point — make sure it reads the *mutable*
  markup array, not a stale snapshot.
- **Per-line override key is `line:<id>:total`** (`sectionLineTotalOverrideKey`, Phase 2) —
  a fee line's dollar is overridable per-line, mirroring GC/Site-Ops one-off line totals.
  Editing the amount is a line-input edit (mutate `inputs.amount`), distinct from a typed
  override; decide which path an inline amount-edit takes (likely a direct input mutation +
  command, not an override).
- **The fee block renders inside the `<tfoot>`** (`EstimateTable.tsx`, the
  `markupLines.map(...)` block below the `ESTIMATE_MODIFIERS.map(...)`). Hosting an inline
  editor / context-menu target there is the plan's "footer → grid lift" risk — confirm the
  cleanest path (a `<tfoot>` cell can host an input, but the grid's selection / context-menu
  machinery is row-model-based; you may need to bridge it).
- **Reconciliation delta is EXPECTED while a fee line carries dollars** — the fee line is
  not yet in the export/Procore rollup (that's **Phase 5**), so the ReconcileTab / status
  chip will show a delta. Don't try to fix it in Phase 4.
- **Tests run on node (no jsdom / testing-library).** The suite is pure-logic; component
  render/interaction is not unit-tested. Prove Phase 4 via pure command-construction +
  reducer tests (mirror `commandHistory.test.ts` / `commandCapture.test.ts` / the existing
  one-off section-line tests) rather than a DOM render.

## Remaining phases (plan of record)

- **Phase 5** — Export: write fee lines into the template fee block (the "printout") + roll
  up to their mapped Procore BLI. **Highest risk** — fixed-template-layout (~rows 333-340) /
  SUBTOTAL/TOTAL formula re-anchoring; `export-integrity` golden delta must stay **$0.00**.
- **Phase 6** — Import fold-in (`templateExtractor.ts` ~440-457): capture an unknown
  fee-block row as a markup line so a hand-keyed `$2,500` fee ties out to `$0.00` (the
  off-by-$2,500 fix). **After Phase 6 the workstream is complete → merging to `main`
  requires explicit architect approval** (the one main-push prompt is the gate).
