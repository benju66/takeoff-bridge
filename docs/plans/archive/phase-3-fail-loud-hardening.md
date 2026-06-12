# Plan — Phase 3: Fail-Loud Hardening (the contract made real)

> Status: DRAFT awaiting architect approval (2026-06-08). Phase 3 of
> `docs/plans/make-the-math-trustworthy.md`. Implements the two Phase-3 rows of the
> contract's silent-escape register (#5 sign corruption, #3 silent row drop) and flips the
> two INV-8 `it.todo` placeholders to real tests.
>
> **Execution boundary (AGENTS.md):** no source/test file is touched until the architect
> approves the implementation table below.

---

## Goal

Turn the two silent-escape import paths into **loud, recoverable** ones. A wrong or missing
number must never escape quietly:

- **#5 — sign-safe US number parsing.** An accounting credit `"(1,234.50)"` or a trailing
  minus `"1,234.50-"` must parse to **−1234.50** (so a credit *reduces* the subtotal), a
  clean `"1,234.50"` to **1234.50**, and anything genuinely ambiguous (European format,
  multiple separators) must **fail loud** — flagged for the human, never guessed into a
  wrong positive number.
- **#3 — no silent row drop.** A parsed row with a **valid itemId but no matching template
  row** (`targetIdx === -1`) must be **appended to the grid** (visible, provenance
  `'csv_import'`, placed in its CSI division) and recorded on the **same**
  `MERGE_TAKEOFF_DATA` command so **one Ctrl+Z reverses the whole merge**.

**Hard constraints (locked):** US number format; `calculations.ts` stays the sole financial
authority; all DB access via `db.ts`; **no DB schema change**; each fix ships red→green; the
Phase 2 golden harness must still tie McKenna to the cent afterward.

---

## What I verified before planning (so the plan is grounded, not guessed)

1. **The golden harness is insulated from the parser.** `templateExtractor.ts` reads numeric
   cells via ExcelJS (`it.qty`), and imports only ExcelJS / types / `calculations` /
   `constants` — it never calls `parseCleanFloat`. So the #5 parser rewrite cannot move the
   McKenna tie-out. The fixture is present locally
   (`fixtures/golden/McKenna-Crossing-Estimate.xlsx`), so the regression gate runs for real.
2. **`MERGE_TAKEOFF_DATA` undo/redo cannot currently restore an appended row.** Both
   `applyCommandForward` and `applyCommandInverse` for this command only do
   `findIndex(id) → if (idx !== -1) merge fields`. There is **no add/remove path**. Fix #3
   therefore *must* extend the command payload (a new `appendedRows`) and teach the dispatch
   to add (redo) / remove (undo) them — otherwise the appended row would be un-undoable.
3. **Undo fidelity is tested via pure functions, not React renders.** The repo has no
   `@testing-library/react`; `commandCapture.test.ts` / `commandHistory.test.ts` mirror the
   dispatch's merge semantics in plain TS. The clean way to *truly* prove "one Ctrl+Z
   reverses the whole merge" is to extract the merge build + apply into a **pure module** the
   hook, the dispatch, and the test all call (no logic duplication, real coverage).
4. **The override surface already carries the unmapped quantity.** `ImportPreviewModal`'s
   preview table shows every parsed row (mapped *and* unmapped) with its `matchedQty` (Qty
   column) before confirm. So a no-itemId row's quantity is **not** lost at the override
   interface today — the post-import `unmappedTakeoffClassifications` banner is just a
   name-only notice. No `string[] → object` refactor is needed (it would ripple through the
   command type, `EstimateTable`, `page.tsx`, `useTakeoffWorkbook`). See "Decision A".
5. **Existing parser tests use clean integer-string quantities** (`"1500"`, `"100"`, …) — no
   commas, no embedded units — so a stricter, sign-aware parser does not regress them.

---

## Decisions for architect sign-off

- **Decision A — no-itemId quantity carry.** The contract (#3) says a no-itemId row should
  "carry its quantity into the override surface (today only the name survives)." Finding (4)
  shows the **override surface (`ImportPreviewModal`) already shows the quantity** per row;
  only the post-import banner is name-only. **Recommended:** treat the requirement as already
  met by the preview, add a one-line code comment noting it, and **not** refactor the
  `unmapped` list into an object (avoids a wide, risky ripple for no behavior gain). If you'd
  rather the post-import banner also show quantities, that is a small follow-up I can scope
  separately.
- **Decision B — ambiguous-number routing.** To "fail loud" without guessing, an ambiguous
  quantity is set to **0 contribution** (never a wrong positive) **and** the row is flagged
  `needsReview` so the human sees it in the override surface. **Recommended:** add an optional
  `needsReview?: boolean` to `ProcessedTakeoffRow` (optional → no DB schema impact, no
  Data-Interface-Integrity violation) and show a small "Review #" status in `ImportPreviewModal`.
  Alternative: parser-only flag with no modal badge (less visible). Recommend the small badge.

---

## Implementation table (the review gate)

| # | File | Change | Type |
|---|------|--------|------|
| 1 | `src/lib/parser.ts` | Replace `parseCleanFloat` with an exported, sign-aware `parseUsNumber(val): { value: number; ambiguous: boolean }`. Honor `( … )` / leading & trailing minus → negative; strip US thousands; one dot decimal; flag European/multi-separator input ambiguous. In `parseTogalCSV`, use it for the 3 quantity columns; if the **chosen** measurement is ambiguous → `qty = 0` + `needsReview: true` (no guessed value flows into a total). | Edit |
| 2 | `src/types/index.ts` | Add optional `needsReview?: boolean` to `ProcessedTakeoffRow`; add optional `appendedRows?: ProcessedTakeoffRow[]` to `MergeTakeoffDataCommand`. | Edit |
| 3 | `src/lib/mergeTakeoff.ts` **(NEW, pure)** | Extract the merge as pure, testable logic: `divisionInsertIndex(rows, itemId)` (place a new row after the last same-division row, else end); `computeMergeResult(currentRows, parsed, prevUnmapped, appendData, threshold, keywords) → { updatedRows, command, unmappedList }` (existing accumulate + reset behavior **unchanged**, plus: `targetIdx === -1 && itemId` → build appended row `id: \`import-${itemId}\``, splice via `divisionInsertIndex`, record in `command.appendedRows`); `applyMergeForward(rows, cmd)` / `applyMergeInverse(rows, cmd)` (field merges **+** add/remove appended rows). | New |
| 4 | `src/hooks/useFileIngestion.ts` | `mergeTakeoffData` delegates row/command computation to `computeMergeResult`, then `pushCommand(command)` → `setRows(updatedRows)` → `setUnmapped(unmappedList)`. Fire-and-forget side effects (snapshot, training, registry) stay in the hook. No behavior change except the new append path. | Edit |
| 5 | `src/hooks/useCommandDispatch.ts` | `MERGE_TAKEOFF_DATA` forward → `setRows(prev => applyMergeForward(prev, cmd)); setUnmapped(cmd.nextUnmapped)`; inverse → `applyMergeInverse` + `cmd.prevUnmapped`. (DRYs the duplicated inline merge logic; adds appended add/remove.) | Edit |
| 6 | `src/components/workspace/ImportPreviewModal.tsx` | Small: show a "Review #" status badge + a stat for `needsReview` rows (Decision B). No flow change. | Edit |
| 7 | `src/lib/__tests__/parser-numbers.test.ts` **(NEW)** | Fix #5: `"(1,234.50)" → -1234.50`, `"-1,234.50" → -1234.50`, `"1,234.50- " → -1234.50`, `"1,234.50" → 1234.50`, plain `number`/empty pass-through, ambiguous (`"1.234,50"`, `"1,2,3"`, `"1.2.3"`) → `ambiguous: true`; **end-to-end**: a parenthesized credit row through `parseTogalCSV` → `computeTakeoffSummary` *reduces* the subtotal. | New |
| 8 | `src/__tests__/import-integrity.test.ts` **(NEW)** | Fix #3 against the **real** pure functions: merge a batch with (a) an off-template valid code and (b) a no-itemId classification → (a) appended & visible with its qty in its division, (b) in `unmappedList`, neither vanishes; then `applyMergeInverse` (one undo) restores the exact original grid (appended row gone, template fields restored, unmapped reset); `applyMergeForward` (redo) re-adds it faithfully. | New |
| 9 | `src/lib/__tests__/correctness-contract.test.ts` | Flip the two INV-8 `it.todo` → real tests that call the canonical functions (`parseUsNumber` sign cases; `computeMergeResult` + `applyMergeInverse` single-undo). | Edit |

---

## `parseUsNumber` contract (the heart of Fix #5)

```
number            → { value, ambiguous: false }
null/undefined/"" → { value: 0, ambiguous: false }
"(1,234.50)"      → { value: -1234.50, ambiguous: false }   // accounting parens
"-1,234.50"       → { value: -1234.50, ambiguous: false }   // leading minus
"1,234.50-"       → { value: -1234.50, ambiguous: false }   // trailing minus (parseFloat drops this today)
"1,234.50"        → { value:  1234.50, ambiguous: false }
"1,234,567"       → { value:  1234567, ambiguous: false }   // US thousands
"1.234,50"        → { value: 0, ambiguous: true }           // European decimal-comma
"1.2.3"           → { value: 0, ambiguous: true }           // multiple dots
"1,2,3"           → { value: 0, ambiguous: true }           // bad thousands grouping
```

Algorithm: detect sign (surrounding parens, or a single leading/trailing `-`) → strip the
sign chars → validate the magnitude as US format (`^\d{1,3}(,\d{3})*(\.\d+)?$` or
`^\d+(\.\d+)?$`); a leftover `-`/`(`/`)`, a comma *after* the dot, mis-sized comma groups, or
>1 dot ⇒ `ambiguous: true`. Never silently coerce an ambiguous string to a positive number.

---

## Undo design for the appended row (Fix #3) — why it's atomic

`computeMergeResult` produces the forward grid **and** the single `MERGE_TAKEOFF_DATA` command
carrying `prevRowStates` (existing rows, unchanged), `nextRowStates` (existing rows' final
fields), `prev/nextUnmapped`, **and the new `appendedRows`** (full rows). One `pushCommand`.
- **Undo** (`applyMergeInverse`): restore `prevRowStates` fields **and** remove every row whose
  id is in `appendedRows` → grid is byte-for-byte the pre-merge grid.
- **Redo** (`applyMergeForward`): re-apply `nextRowStates` **and** re-splice each `appendedRows`
  row via `divisionInsertIndex` → identical to the original merge.
Appended ids are collision-free by construction: we only append when no row has that itemId, and
template/manual ids use different prefixes (`row-…` / `manual-…`), so `import-${itemId}` is unique;
a later import of the same code finds the existing appended row and accumulates instead.

---

## Test & verification plan

- `npm run test` fully green: new `parser-numbers` + `import-integrity` tests, flipped INV-8
  contract tests, and **all existing suites** (parser, command, calculations, exporter, …).
- **Regression gate (run locally where the fixture is present):**
  `src/__tests__/golden-mckenna.test.ts` still ties McKenna to **$0.00** (it skips cleanly
  elsewhere). This is the keystone — confirmed before delivery.
- `tsc --noEmit` clean. `/code-review` run and findings addressed.

## Risks / watch-items

- **Stricter parsing changing a real qty.** Mitigated: existing parser tests use clean integer
  strings; the golden harness doesn't route through the parser; ambiguous → flagged (visible),
  never a silent wrong number.
- **Merge refactor regressing the import path.** Mitigated: `computeMergeResult` reproduces the
  current accumulate/reset behavior exactly (only the append branch is new); the
  `import-integrity` test asserts merge → undo → redo fidelity against the real functions.
- **Scope creep into Phase 4 / backlog.** Out of scope: any DB/schema change, the override+audit
  model, the glass-box UI, and backlog B-1/B-2/B-3.

## Done when

New parser-number + import-integrity tests green; both INV-8 invariants green; the golden
harness still ties to the cent; `npm run test` green; `/code-review` clean; committed; Phase 4
handoff written; math-trust memory + MEMORY.md updated. **Stop after Phase 3.**
