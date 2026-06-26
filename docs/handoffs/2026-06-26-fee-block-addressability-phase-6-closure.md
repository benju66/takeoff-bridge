# Phase 6 Closure — Division 60 Fee-Block Addressability: Import fold-in (Tier 1) + tie-out golden

_Written 2026-06-26. **This is the LAST phase — the workstream is COMPLETE.**_

---

## What shipped (import now ties out a hand-keyed fee line)

The capstone fold-in: an OLD estimate carrying a hand-keyed line in the Division 60 fee block
(e.g. a $2,500 "Preconstruction Fee" typed in below the SUBTOTAL) is now **captured** as a
`section='markup'` fee line instead of being silently dropped, so the import **ties out to
$0.00** (the off-by-$2,500 is fixed). The dollar comes in intact; the Procore code is left
**blank / needs-review** for the estimator to assign in the import review (never guessed).

- **`src/lib/templateExtractor.ts`** — the modifier loop (`extractStep4`, between SUBTOTAL and
  TOTAL) no longer `continue`-skips a non-modifier fee-block row that carries a dollar. It
  captures it via `newFeeLine({ label: <col D | col C | "Imported Fee">, amount: <col I cached
  dollar>, source: "csv_import" })` → `section='markup'`, `entry_kind='lumpSum'`,
  `procore_code=''`, `cost_type=''`. Only fires on a non-null, non-zero col-I dollar (title /
  blank rows skipped — same "never drop a dollar / never capture a non-dollar" rule as the
  ad-hoc path). A suffixed code like `60-4000.002` is captured (the loop keys on the full code
  + the bare base `60-4000`, so it matches no modifier). New `feeLines: EstimateSectionLine[]`
  on `ExtractedEstimate` — **empty `[]` for every existing fixture/bid** whose fee block is the
  7 modifiers only (fully inert; `golden-*` paths byte-identical).
- **`src/lib/importEstimate.ts`** — new pure `applyFeeLineMappings(feeLines, assignments)`
  (the same revertible escape-hatch pattern as `applyAcceptedMappings`): applies the
  estimator's per-line `{ procoreCode, costType }` assignment; originals never mutated; the
  `inputs.amount` is never touched (a Procore assignment moves no dollar → the tie-out cannot
  move).
- **`src/app/projects/import/page.tsx`** — `markupLines = applyFeeLineMappings(parsed.extracted.feeLines, feeAssignments)`
  is fed as the **7th arg** into the `summary` `computeTakeoffSummary` call (the flat
  below-subtotal addend that closes the tie-out gap) and persisted on save via
  `saveSectionLines(id, markupLines)` (awaited, throws on failure — these fee dollars are part
  of the tie-out). New "Fee block (Division 60) — imported flat fees" review card shows each
  line (label · amount · mapped-code/unmapped badge) with the **reused `OneOffAssignPopover`**
  (validates via `validateOneOffCode`, never guesses). On reload `useProjectWorkspace` already
  loads these via `getSectionLines().filter(isMarkupLine)` → `persistedMarkupLines`.
- **Tests** — `src/__tests__/fixtures/syntheticTemplate.ts` gained
  `buildFeeBlockPastBidTemplateBuffer()` + `FEE_BLOCK_PAST_BID_ORACLE` (base synthetic shape +
  one hand-keyed `60-4000.002` "Preconstruction Fee" $2,500; oracle TOTAL $110,500). New
  `src/__tests__/import-fee-block.test.ts` (CI-safe): captures the line unmapped; ties **−$2,500
  without** / **$0.00 with** the captured fee (subtotal + 7 modifiers byte-identical, only
  `additionalFees` rises by $2,500); the line is editable + unmapped + revertible via
  `applyFeeLineMappings`; a 7-modifier-only bid extracts `feeLines === []` (regression).

## Definition of Done — status

- `npm run test` — **1477 passing** (1472 prior + 5 new), no regressions.
- `npx tsc --noEmit` — clean.
- `npm run build` — green.
- `/code-review` (medium) — **no findings**.
- Committed via `git commit -F` to branch `fee-block-addressability` + pushed.
- No DDL (the `'markup'` section + `save_section_lines` shipped in Phase 1).
- Template working copy untouched (`git diff --stat templates/` empty — the export-integrity
  fixture goldens read the committed copy, per the "template fixture tests read the working
  copy" memory).

## Workstream COMPLETE → the only remaining step is merge to `main`

All 6 phases are done (storage → calc → render → edit → export → import). Per CLAUDE.md Git
Workflow, merging the branch into `main` is the ONLY step that touches `main` and requires
**explicit architect approval** (the one main-push prompt is the gate). Default is a direct
`--no-ff` merge; a PR is opt-in only if the architect wants the cloud `/code-review ultra` or
CI to run first. **Do NOT merge without that approval.**

## Notes carried forward (not bugs)

- Export-of-imports stays blocked (`assertNotImported`) — Phase 6 fixed IMPORT tie-out only.
- At import save only the markup lines are written to `estimate_section_lines` (an imported
  project's GC/Site-Ops section lines are synthesized lazily from `imported_step23_lines` and
  persisted on the first workspace auto-save). The full-replace on that first auto-save merges
  `[...synthesizedGcSiteOps, ...markupLines]` — the import-saved fee lines are preserved.
