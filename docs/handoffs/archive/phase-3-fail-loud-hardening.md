# Handoff — Phase 3 (Fail-Loud Hardening) → Phase 4 (Override + Audit Model)

> Written 2026-06-08 at the close of Phase 3 of `docs/plans/make-the-math-trustworthy.md`.
> Read this, then the plan's **Phase 4 "Cold-start brief"**, then start Phase 4 in a fresh
> session. **Phase 4 PAUSES for architect schema approval before any DDL.**

## What Phase 3 delivered (committed, green)

The two silent-escape import paths from the contract's register (#5 sign, #3 dropped row) are
now LOUD and recoverable. Both INV-8 invariants are real tests; the McKenna golden harness
still ties to the cent.

New / changed files:

1. **`src/lib/parser.ts`** — `parseCleanFloat` replaced by an exported, sign-aware
   **`parseUsNumber(val): { value, ambiguous }`**. Honors accounting `( … )` and leading/trailing
   minus → negative; strips US thousands; one dot decimal; `-0` guarded. **Ambiguous** input
   (European decimal-comma, multiple separators, malformed grouping) → `{ value: 0, ambiguous: true }`
   — never a guessed positive. `parseTogalCSV` uses it for the 3 quantity columns; if the *chosen*
   measurement is ambiguous the qty stays **0** and the row is flagged **`needsReview`**.
2. **`src/lib/mergeTakeoff.ts`** (NEW, pure) — the merge extracted from the hook so undo is truly
   testable (no React harness in this repo). `computeMergeResult` builds the forward grid + a
   single `MERGE_TAKEOFF_DATA` command; `applyMergeForward` / `applyMergeInverse` apply redo/undo;
   `divisionInsertIndex` places a new row in its CSI division. **Fix #3:** a valid itemId with no
   template row (`targetIdx === -1`) is **appended** (`id: import-${itemId}`, `source:'csv_import'`,
   all non-nullable fields from the parser) and recorded in the command's new **`appendedRows`**.
   **Replace-mode hardening:** prior off-template imported rows are *removed* (command's new
   **`removedRows`**), not left as phantom blank $0 rows — symmetric undo (re-added on undo).
3. **`src/types/index.ts`** — `ProcessedTakeoffRow.needsReview?`; `MergeTakeoffDataCommand.appendedRows?`
   and `.removedRows?` (full inverse data → one Ctrl+Z reverses the whole merge).
4. **`src/hooks/useFileIngestion.ts`** — `mergeTakeoffData` now delegates row/command computation to
   `computeMergeResult`; the hook keeps the impure parts (pushCommand, pre-import snapshot, training
   records, state setters). Behavior identical except the new append/remove paths.
5. **`src/hooks/useCommandDispatch.ts`** — `MERGE_TAKEOFF_DATA` forward/inverse delegate to
   `applyMergeForward`/`applyMergeInverse` (DRYs the old inline merge logic; adds appended/removed).
6. **`src/components/workspace/ImportPreviewModal.tsx`** — a "Review #" status badge + stat surfaces
   `needsReview` rows in the override surface (architect chose: flag + badge).
7. **Tests:** `src/lib/__tests__/parser-numbers.test.ts` (NEW, 20), `src/__tests__/import-integrity.test.ts`
   (NEW, 10 — merge → undo → redo, append + replace-mode discard), and the two **INV-8 `it.todo`
   flipped to real tests** in `src/lib/__tests__/correctness-contract.test.ts`.
8. **`docs/plans/phase-3-fail-loud-hardening.md`** — the approved Phase 3 plan.

**Test status:** `npm run test` → **330 passed + 1 todo** (the 1 todo is INV-7 / Phase 5).
`tsc --noEmit` clean. Golden McKenna harness (`src/__tests__/golden-mckenna.test.ts`) ran with the
fixture present and still ties STEP 4 SUBTOTAL / TOTAL / cost-unit to **$0.00** — regression gate
held. `/code-review`: one real bug found (replace-mode phantom rows) and FIXED before commit
(`removedRows`); other notes were by-design.

## Decisions made this phase (architect-approved)

- **No-itemId quantity carry:** the override surface (`ImportPreviewModal`) already shows each
  unmapped row's quantity before confirm, so nothing is lost there — kept the post-import banner
  name-only (no `string[] → object` refactor). Code comment in `mergeTakeoff.ts`.
- **Ambiguous numbers:** flagged `needsReview` (qty forced to 0) + a "Review #" badge in the preview.

## Where Phase 4 starts — Override + Audit Model

Per the plan's **Phase 4**. **Read first:** the plan + this handoff + `supabase_schema.sql`,
`src/lib/db.ts` (snapshot + estimate functions), and the `estimate_snapshots` /
`classification_history` table defs.

- **Invoke the `supabase:supabase` skill before touching DB code** (CLAUDE.md).
- **Schema gate (HARD STOP):** update `supabase_schema.sql` FIRST and get **explicit architect
  approval before any DDL** (AGENTS.md). The recommended design is a new **append-only**
  `estimate_overrides` table (`{ field, computedValue, overrideValue, reason, who, when }`); the
  engine uses `overrideValue` but always carries `computedValue` alongside (glass-box shows both).
- **Guardrails unchanged:** `calculations.ts` is the sole financial authority; all DB access via
  `db.ts`; line-item writes only via the `save_estimate` RPC; `estimate_snapshots` /
  `classification_history` are append-only. Reuse `estimate_snapshots` (a `pre_import` snapshot
  already fires) for milestone change history — extend wiring to save/export.

**Note for Phase 4:** `ProcessedTakeoffRow.needsReview` (added this phase) is a natural companion
to the override model — a `needsReview` row is exactly the kind of value the override surface should
let an estimator resolve and record.

## Carried-forward backlog (NOT Phase 4 work) — `docs/backlog-math-trust.md`

B-1 CI-safe synthetic template fixture (the McKenna proof is machine-local / skips without the
confidential file); B-2 born-in-app GC/Site-Ops golden (G-2); B-3 rounding-default decision +
Phase 5 visibility (G-1). Do not let them evaporate across sessions.

**Do not start Phase 5** until Phase 4 is committed green.
