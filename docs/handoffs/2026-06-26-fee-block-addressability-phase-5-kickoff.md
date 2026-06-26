# Phase 5 Kickoff — Division 60 Fee-Block Addressability: Export (template + Procore rollup)

_Ready-to-paste prompt for a fresh cold session. Written 2026-06-26._

---

## Kickoff prompt

> Implement **Phase 5 of the Division 60 Fee-Block Addressability plan**
> (`docs/plans/2026-06-23-fee-block-addressability.md` — read it first, plus the
> Phase 1-4 context below). Scope is **export**: write the Division 60 markup fee
> lines into the exported STEP 4 fee block of the **company XLSX template** (the
> "printout") AND roll each mapped line up to its Procore Budget Line Item (BLI) on
> the **Procore export**. **Export only — the import fold-in is Phase 6.**
>
> **This is the highest-risk phase** (see the plan's Risks section). The template's
> fee block is a **fixed-row layout** (~rows 333-340) with SUBTOTAL/TOTAL formulas
> referencing specific rows. Injecting a variable number of new lines must NOT shift
> or break those references or corrupt the sheet. Decide the safe mechanism in Phase 5
> (reserve spare rows vs. true row-insert with formula re-anchoring); if true
> row-insertion proves unsafe, the plan permits narrowing to a **capped** number of fee
> lines. **Write cells in ascending column order** (CLAUDE.md Excel/XML rule) and
> double-check column-letter parsing.
>
> **Concretely:**
> - **Template ("printout") export** — extend `src/lib/exporter.ts` so each markup fee
>   line (`section='markup'`, dollar in `inputs.amount`, rounded via `roundByRule` to
>   match the on-screen/engine value) is written into the STEP 4 fee block below the 7
>   computed modifier rows and above the SUBTOTAL/TOTAL, exactly where the engine places
>   the `additionalFees` addend. The exported grand TOTAL must equal
>   `takeoffSummary.totalEstimatedCost` to the cent.
> - **Procore export rollup** — a mapped fee line rolls up to its assigned `procoreCode`
>   BLI (cost type from the line's stored `costType`). An **unmapped** fee line (blank
>   `procoreCode`) follows the EXISTING export rules — skip-with-flag / the export
>   blocker UI — and is **never silently mis-routed** (AGENTS.md). Reuse
>   `validateExportReadiness` / the existing unmapped-line gate; do not invent a code.
> - **Goldens** — the `export-integrity` golden delta must stay **$0.00** vs the engine:
>   a fixture estimate carrying a flat fee line exports with the fee in the fee block and
>   the TOTAL tying to `computeTakeoffSummary(...).totalEstimatedCost`. Confirm the
>   template-fixture tests still read the committed working-copy template (see the
>   "template fixture tests read the working copy" memory — `git diff --stat templates/`
>   before blaming new code).
>
> **Approval gates:** none (no DDL, **no new export template TAB** — write into the
> existing fee block per the plan's "Out of scope"). Do NOT merge to `main`.
>
> Take the phase through the full **Definition of Done** (CLAUDE.md): `npm run test`
> green · `npx tsc --noEmit` clean · `npm run build` green · `/code-review` resolved ·
> commit via `git commit -F` to the **existing** `fee-block-addressability` branch +
> push · write the Phase 6 handoff via `/handoff`. **Run only this one phase.**

---

## Exit criteria (from the plan, Phase 5)

- The exported company template shows each fee line in the Division 60 fee block; the
  exported grand TOTAL ties to the engine's `totalEstimatedCost` (delta **$0.00**).
- The Procore export rolls a mapped fee line up to its assigned BLI; an unmapped fee
  line follows the existing skip-with-flag rule (never mis-routed).
- The fixed-template-layout constraint is handled without corrupting the sheet or
  breaking the SUBTOTAL/TOTAL formulas (cells written in ascending column order).
- Full Definition of Done: test green · `tsc` clean · `build` green · `/code-review`
  resolved · committed + pushed to `fee-block-addressability` · Phase 6 handoff written.

---

## Where Phase 4 left off (edit — COMPLETE)

Phase 4 is **done, committed (`fb0a868`), and pushed** on branch
`fee-block-addressability`. Suite **1455 passing**; tsc clean; build green.

**What shipped (the fee block is now fully editable + undoable):**
- **`src/types/index.ts`** — three NEW `WorkbookCommand` variants:
  **`INSERT_FEE_LINE`** (full line + array index), **`DELETE_FEE_LINE`** (full line +
  original index), **`EDIT_FEE_LINE`** (`prev`/`next` shallow field patch). They ride
  the **shared workbook undo stack** (single Ctrl+Z), the same pattern as
  `EDIT_BUYOUT_CELL` and `SET/CLEAR_BINDING`. _(Answers the plan's "command-history
  reuse" risk: a new variant was needed — markup lines are `EstimateSectionLine` rows,
  not `ProcessedTakeoffRow`, and don't use the `useSectionLineGrid` `SectionGridCommand`
  union.)_
- **`src/lib/sectionLines/markupCommands.ts`** (new, PURE) —
  `applyFeeLineForward` / `applyFeeLineInverse` (the reducer `useCommandDispatch` calls
  via `setMarkupLines`) + `buildFeeLineEdit(line, patch)` (captures prev/next; returns
  `null` for a no-op so it never lands on the stack). Fully unit-tested (no DOM).
- **`src/hooks/useMarkupFeeLines.ts`** (new) — the **mutable** markup-line store (twin of
  `useEstimateBindings`), seeded from the Phase-3 read-only `persistedMarkupLines` and
  re-seeded only on load/project change (never clobbers a live edit; reloads from DB on
  navigation). Owned in `page.tsx`, threaded into the workbook.
- **`src/hooks/useCommandDispatch.ts`** — `setMarkupLines` param + forward/inverse cases
  delegating to the pure reducer.
- **`src/hooks/useTakeoffWorkbook.tsx`** — `markupLines`/`setMarkupLines` params; the
  shared `pushBindingCommand` was renamed **`pushCommandThenForward`** (now used by both
  the binding AND fee-line creators); new creators **`insertFeeLine`** (appends a blank
  `newFeeLine`), **`deleteFeeLine`**, **`editFeeLine`** — each pushCommand-before-forward
  (AGENTS.md guardrail), reading the live `markupLines` prop (no stale snapshot). Returned
  from the hook.
- **`src/app/projects/[projectId]/page.tsx`** — owns the mutable store via
  `useMarkupFeeLines`; the **mutable `markupLines`** (not the read-only seed) now feeds
  BOTH `computeTakeoffSummary` calls (7th arg, same set to each — Amendment F), the
  `persistedSectionLines` save memo (`[...sectionLines, ...markupLines]` → full-replace
  `save_section_lines`), and the `EstimateTable` prop. Passes the 3 creators down.
- **`src/components/workspace/EstimateTable.tsx`** — the fee block stayed in the
  **`<tfoot>`** (no grid lift) with a lightweight edit layer: **click** the label /
  amount to inline-edit (`StringCellInput` / `NumberCellInput`, commit→`editFeeLine`;
  amount edits the RAW `inputs.amount`, not the `line:<id>:total` override), **click** the
  code cell to open the reused **`OneOffAssignPopover`** (validates via
  `validateOneOffCode` against the Procore authority → `editFeeLine({procoreCode,costType})`;
  unknown codes rejected, never guessed), **right-click** a fee row for an Insert/Delete
  context menu, and an **"+ Add fee line"** button for the empty state. Inserted lines are
  `source='manual'`; costType column shows the resolved type once assigned (else "O").
- **`src/lib/__tests__/markupFeeCommands.test.ts`** (new, 9 tests) — proves insert↔delete
  are exact inverses (line + index restored), edit restores prior label/amount/code
  atomically, a no-op edit builds no command, a mixed insert/edit/delete history reverses
  in order, and the Procore-code assign reuses `validateOneOffCode` (unknown rejected,
  valid resolves a cost type) — exactly the patch the popover hands `editFeeLine`.

## Phase 5 gotchas / pointers

- **Export is the highest-risk phase** — the template fee block is fixed-row (~333-340)
  with SUBTOTAL/TOTAL formulas. The mitigation candidates (reserve spare rows vs. true
  row-insert with formula re-anchoring) surface here; **cap the fee-line count** if true
  insertion proves unsafe. **Write cells in ascending column order** (CLAUDE.md).
- **The reconciliation delta you saw in Phase 4 is EXPECTED and should DISAPPEAR in
  Phase 5.** A fee line carrying dollars is in the engine total but not yet in the
  export/Procore rollup, so the ReconcileTab / status chip currently shows a delta.
  Closing that delta IS Phase 5's job — the `export-integrity` golden must end at $0.00.
- **Display↔export rounding parity.** The engine sums each fee line via `roundByRule`
  (`applyRounding` delegates to it), and the grid displays the same. The export MUST use
  the **same** `roundByRule(feeLineAmount(line), project.roundingRule)` per line so the
  exported fee block ties to the displayed/engine total under any rounding rule.
- **Unmapped lines are blocked, not mis-routed.** A blank `procoreCode` must go through
  the EXISTING export-blocker / `validateExportReadiness` gate (the same one one-off
  lines use), never a default/guessed code (AGENTS.md "No Speculative Changes").
- **`60-4000.002` is NOT in the catalog/authority by default** (see the
  "harvester-subtotal-fee-block" memory) — a fee line assigned a Division 60 code that
  isn't in `procore_cost_codes` stays unmapped (validation rejects it). That's by design;
  the export gate handles it. Don't add it to the harvested JSON.
- **Tests run on node (no jsdom).** Prove the export via the `exporter`/`exportUtils`
  pure tests + the `export-integrity` golden, not a DOM render. Check
  `git diff --stat templates/` first if a template-fixture test fails (the
  "template fixture tests read the working copy" memory).

## Remaining phases (plan of record)

- **Phase 6** — Import fold-in (`templateExtractor.ts` ~440-457): capture an unknown
  fee-block row as a markup line (`source='csv_import'`, `procoreCode=''` → needs-review)
  so a hand-keyed `$2,500` fee ties out to `$0.00` (the off-by-$2,500 fix). **After
  Phase 6 the workstream is complete → merging to `main` requires explicit architect
  approval** (the one main-push prompt is the gate, per CLAUDE.md Git Workflow).
