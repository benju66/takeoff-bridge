# Phase 6 Kickoff — Division 60 Fee-Block Addressability: Import fold-in (Tier 1) + tie-out golden

_Ready-to-paste prompt for a fresh cold session. Written 2026-06-26._

---

## Kickoff prompt

> Implement **Phase 6 (the capstone) of the Division 60 Fee-Block Addressability plan**
> (`docs/plans/2026-06-23-fee-block-addressability.md` — read it first, plus the Phase 1-5
> context below). Scope is **import**: when importing an OLD estimate that has a hand-keyed
> fee line in the Division 60 fee block (today silently dropped, causing the "off-by-$2,500"
> tie-out failure), capture it as one of the new `section='markup'` fee lines so the import
> **ties out to $0.00**. The line comes in with its dollar intact and its Procore code left
> **blank / needs-review** for the estimator to assign (never guessed — AGENTS.md).
>
> **Concretely:**
> - **`src/lib/templateExtractor.ts`** (~lines 440–457) — the modifier loop currently
>   `continue`-skips any fee-block row that is NOT one of the 7 known modifiers (`:443`).
>   Change it to **capture** an unknown fee-block row (below the STEP 4 SUBTOTAL, with a
>   dollar value) as a markup fee line: `entry_kind='lumpSum'`, `source='csv_import'`,
>   `procore_code=''` (needs-review), `label` from the row's description, `inputs.amount`
>   from its dollar value. Use `newFeeLine(...)` from `src/lib/sectionLines/markup.ts`.
> - **`src/lib/importEstimate.ts`** — route the captured fee lines through the import so the
>   engine total includes them (pass them as `markupLines` into `computeTakeoffSummary`) and
>   **`checkImportTieOut` ties out to $0.00** (the off-by-$2,500 is fixed). Persist them via
>   the same `save_section_lines` full-replace path the GC/Site-Ops + manual fee lines use
>   (`[...sectionLines, ...markupLines]`).
> - **Import review** — surface the captured fee lines in the import review with an **editable
>   Procore mapping** (unmapped → "you assign it"), reusing the same validation
>   (`validateOneOffCode`) the fee block uses. Do not invent a code.
>
> **Goldens** — a golden test of a past estimate carrying a hand-keyed **$2,500** fee-block
> line imports with tie-out delta **$0.00** (the off-by-$2,500 fixed); the line appears
> editable and unmapped in the review. Confirm the template-fixture tests still read the
> committed working-copy template (`git diff --stat templates/` before blaming new code —
> the "template fixture tests read the working copy" memory).
>
> **Approval gates:** none for the work itself (no DDL — the `'markup'` section + storage
> already shipped in Phase 1). **After this phase the workstream is COMPLETE → merging to
> `main` requires explicit architect approval** (the one main-push prompt is the gate, per
> CLAUDE.md Git Workflow). Do NOT merge to `main` without it.
>
> Take the phase through the full **Definition of Done** (CLAUDE.md): `npm run test` green ·
> `npx tsc --noEmit` clean · `npm run build` green · `/code-review` resolved · commit via
> `git commit -F` to the **existing** `fee-block-addressability` branch + push · then the
> workstream is done — propose the merge-to-`main` and STOP for architect approval. **Run
> only this one phase.**

---

## Exit criteria (from the plan, Phase 6)

- A golden test of a past estimate carrying a hand-keyed $2,500 fee-block line imports with
  tie-out delta **$0.00** (the off-by-$2,500 fixed).
- The captured fee line appears editable and **unmapped** (`procore_code=''`) in the import
  review; the estimator can assign a valid Procore code there.
- Full Definition of Done: test green · `tsc` clean · `build` green · `/code-review` resolved ·
  committed + pushed to `fee-block-addressability` · workstream complete → merge-to-`main`
  proposed and gated on architect approval.

---

## Where Phase 5 left off (export — COMPLETE)

Phase 5 is **done, committed (`28cce7d`), and pushed** on branch `fee-block-addressability`.
Suite **1472 passing**; tsc clean; build green; `/code-review high` resolved (no correctness
findings).

**What shipped (fee lines now leave the app on export):**
- **`src/lib/exporter.ts`** — `effectiveFeeLineAmount(line, rule, overrides?)` (engine parity:
  `roundByRule(feeLineAmount)` honoring a `line:<id>:total` type-over) + `rollupMarkupLines`
  (sums MAPPED — valid `isValidProcoreCode` — fee lines by code; unmapped skipped). The three
  generators thread a new optional `markupLines` arg:
  - **`generateExcelWorkbook`** inserts each fee line as a real row at the **empty spare row
    340** (between the 7 modifiers and the grand total) via `shiftRowElements` + `cloneRowElement`
    (clone the first modifier row for style), cells in ascending column order **A,C,D,G,I**
    (A=costType, C=procoreCode, D=label, G="LS", I=effective amount VALUE). `feeRowShift` threads
    into `totalRowIdx` / `reconStartRow` / dimension; **`buildRowShifter` gained a fee-insertion
    threshold** (`subtotalRow + modifierEndOffset` = 339) so the grand total / recon / the
    `STEP 2 → I341` cross-sheet ref / print area / `O346:P346` merge all shift uniformly; the
    three `rowShift>0` guards now also fire on `feeRowShift>0`; the print-area branch uses
    `shiftRow(origRow)`. `markupLines` also feeds `step4Summary` so the OVERRIDE-path grand-total
    VALUE includes `additionalFees`. The grand-total SUM + recon E347 span are rewritten over the
    shifted range, so they auto-include the fee rows.
  - **`generateExcelPayload`** appends a flat fee CSV row after the 7 modifier rows.
  - **`generateProcoreBudget`** adds each MAPPED fee line to `groupings` (`code::costType`, like a
    GC/Site-Ops line); unmapped skipped (blocked upstream).
  - **`validateExportReadiness`** flags an unmapped fee line carrying dollars as a blocker with a
    NEW `kind: 'feeLine'`; fee dollars are kept OUT of the scope reconciliation (they are
    below-subtotal addends like the 7 modifiers, so the scope tie still represents the
    subtotal/BLI sheet).
- **`src/lib/trustInspector.ts`** — `buildReconciliationModel` gained optional `feeRollupTotal`
  (default 0 → inert) folded into `fullProcoreBudgetTotal`, closing the grand-total delta a
  mapped fee line otherwise opened (the "Phase-4 symptom").
- **Threading** — `useExportHandlers` (new `markupLines` param → all 4 generators + a
  fee-block-specific `'feeLine'` blocker message), `useTakeoffWorkbook` (passes its existing
  `markupLines`), and the `page.tsx` reconciliation memo (gate `markupLines` + `feeRollupTotal`).
- **Tests** — new `src/lib/__tests__/markupFeeExport.test.ts` (14 pure: rollup, payload, Procore
  CSV mapped/unmapped, gate kind `feeLine`, reconcile $0 tie) + 3 `export-integrity.test.ts`
  fee-block goldens (real-template fee row + grand-total SUM span + $0.00 engine tie; override-path
  direct numeric tie; no-fee byte-identical `SUM(I331:I340)`).

## Phase 6 gotchas / pointers

- **No DDL.** The `'markup'` section CHECK + the `save_section_lines` full-replace path shipped in
  Phase 1; Phase 6 only WRITES through them on import.
- **Never guess the Procore code.** Imported fee lines come in `procore_code=''` (needs-review).
  Reuse `validateOneOffCode` in the review UI; never auto-assign (AGENTS.md "No Speculative
  Changes", plan "Imported lines" locked decision).
- **The fee-block rows live BELOW the STEP 4 SUBTOTAL** (`templateExtractor.ts` modifier loop). Only
  capture rows that are NOT one of the 7 known modifiers AND carry a dollar — see the
  "harvester-subtotal-fee-block" memory (the fee block is `60-xxxx` %-modifiers + flat fee lines,
  not catalog items). The 7 computed modifiers stay computed (don't capture them as fee lines).
- **Tie-out:** `checkImportTieOut` compares the imported engine total to the file's TOTAL. The fix
  is to make the captured fee dollars part of `additionalFees` (pass the captured markup lines into
  `computeTakeoffSummary` on the import path) so the imported total rises by exactly the fee amount,
  matching the file's TOTAL → delta $0.00.
- **Export of imported bids is still blocked** (`assertNotImported`) — Phase 6 only fixes IMPORT
  tie-out, not export-of-imports (a separate locked decision).

## Known Phase-5 scoping notes (carry forward, not bugs)

- The workbook **Budget Line Items sheet excludes fee dollars** (scope-only, exactly like the 7
  modifiers, which are also absent from it). The **Procore budget CSV** — the actual upload — DOES
  carry mapped fee dollars. This mirrors the existing modifier treatment.
- A fee line mapped to one of the 7 modifiers' exact `60-xxxx.001` codes would emit a second Procore
  CSV line (benign — the fee's costType differs from the modifier's "O", so they are distinct
  Procore keys; realistic fee codes differ from the modifier codes). Not worth special-casing.

## Remaining phases (plan of record)

- **Phase 6 (this one)** — Import fold-in + tie-out golden. **LAST phase.** After it the workstream
  is complete → **merging to `main` requires explicit architect approval** (the one main-push
  prompt is the gate, per CLAUDE.md Git Workflow).
