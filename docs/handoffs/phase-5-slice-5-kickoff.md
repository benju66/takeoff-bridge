# Kickoff — Phase 5 BUILD, Slice 5 (5c row provenance badges + Flags tab + flip INV-7)

> Paste this as the first message of a fresh session to build **slice 5**. The DESIGN phase is done
> and architect-approved (2026-06-09); slices 1–4 are committed. This session writes UI + one pure
> helper + flips a contract `it.todo`.

Slices 1–4 are DONE and committed on `phase-5-visual-trust`. First check out the existing build
branch — DO NOT cut a new one and DO NOT branch from main:

```
git checkout phase-5-visual-trust
```

Confirm slices 1–4 are present: `git log --oneline -6` should show `f0d0f23` (slice 4 — override
setter + ⚑ flags), `eb5df86` (slice 3 — 5b Reconciliation + chip), `2b1191e` (slice 2 — Trust
Inspector + 5a Trace), `8b35559` (slice 1 — export applies overrides). Run `npm run test` once to
confirm the green baseline: **392 passed + 1 todo (36 files)**.

(`npm run test` is vitest in a **node env** — there is no DOM/React test harness, no
`@testing-library/react`, no jsdom. Test pure logic, not the DOM — see slices 2–4's pattern: extract
the decision logic into a pure helper and assert that in node. Slice 4's `src/lib/overrideSetter.ts`
+ `src/lib/__tests__/overrideSetter.test.ts` are the template to copy.)

## Read before writing code, in this order
1. `docs/handoffs/phase-5-build-kickoff.md` — the architect-signed build plan. Read its **"Build
   progress log" first** (slices 1+2+3+4 = done; you start at slice 5), then the rest (esp. the
   **"Filtered-view trap"** and **"recordEstimateOverride THROWS"** hard constraints, which still
   apply to anything you touch).
2. `docs/plans/phase-5-visual-trust-ui-design.md` — **§5 (5c — Provenance & flags)** is your spec:
   §5.1 row provenance badges in the grid, §5.2 summary-value flags (⚑ already shipped in slice 4 —
   do not redo it), §5.3 the **Flags tab** (needs-review worklist + B-4 inline-recover unmapped
   imports + the audit log from `overrideRecords`). Also §9 the build-slices table (slice 5 row +
   its gate). The design is approved — do NOT re-open it or re-ask the four locked decisions.
3. `docs/correctness-contract.md` (INV-7 provenance completeness, INV-8 needs-review) and
   `src/lib/__tests__/correctness-contract.test.ts:299-308` — the `it.todo('INV-7 …')` you must
   **flip to a real assertion** this slice. Note the block comment: INV-7 is "enforced today by the
   type system + ingestion/command paths; the visible per-row badge is Phase 5."
4. The data already present (no new math; no engine change):
   - `ProcessedTakeoffRow.source` ∈ `'template' | 'csv_import' | 'manual'` (AGENTS.md "Source
     Provenance Tracking"; design §5.1 also lists `'ai_suggestion'` — handle it if the type carries
     it) and `row.needsReview` (Phase 3 / INV-8).
   - `useEstimateOverrides` returns `{ activeOverrides, overrideRecords, refresh }` —
     **`overrideRecords`** is the append-only audit trail (newest first), currently unused; thread it
     `page → EstimateTable → TrustInspector` for the Flags-tab audit log. `EstimateOverrideRecord`
     shape is in `src/types/index.ts:65` (field, computedValue, overrideValue [null = revert],
     reason, createdBy, createdAt).
   - The existing unmapped surface for B-4: `unmappedTakeoffClassifications: string[]` (just
     **classification names**) drives an amber banner in `EstimateTable.tsx:554-577` that only links
     to `/registry`. The richer assign-code UX is `ExportOverrideModal`
     (`src/components/workspace/ExportOverrideModal.tsx`) over `ExportBlocker[]` (`exporter.ts:418` —
     `rowId`/`itemId`/`amount`), wired in `page.tsx:526` via `applyProcoreOverrides`.
   - The grid already marks unmapped rows with `border-l-4 border-l-amber-500`
     (`EstimateTable.tsx:896`); provenance badges go on the **item-id cell** as glyphs (not another
     border — avoid visual collision).
5. `CLAUDE.md`, `AGENTS.md`, `memory/MEMORY.md` (→ the `math-trust-plan` memory).

## Build SLICE 5 only

- **Row provenance badges (5c.1, design §5.1).** A small glyph on each grid row's **item-id cell**,
  driven by `row.source` / `row.needsReview`. Legend: **▦ template · ⬚ imported (CSV) · ✎ manual ·
  ⚠ needs review**. Hover → a tooltip ("Imported from CSV", "Hand-entered", "Flagged: review before
  export"). `needsReview` takes visual priority (the ⚠ is the worklist signal). Extract the
  glyph/label decision into a **pure helper** (e.g. `src/lib/rowProvenance.ts` —
  `rowProvenanceBadge(row) → { glyph, label, kind }`) so it is node-testable and the INV-7 assertion
  can use it (mirrors `overrideSetter.ts`). No emoji in source — match the lucide-icon idiom already
  in `TrustInspector`/`EstimateTable`.
- **Flags tab (5c.3, design §5.3).** Fill the slice-2 Flags placeholder in `TrustInspector.tsx` (the
  `{tab === "flags" && <Placeholder …/>}` block) with a worklist:
  - **Needs-review rows** (`row.needsReview`, INV-8) — listed with their carried quantity; click →
    close the inspector focus and **scroll to the row in the grid** (reuse `setGlobalFilter("")` +
    `scrollToRowRef.current(index)`, the same `[view rows]` path slice 2 added).
  - **Override audit log** — render the full append-only `overrideRecords` trail (newest first): each
    set/revert event with field, computed→override, reason, who (`createdBy`), when (`createdAt`).
    Read-only, immutable. A revert (`overrideValue: null`) reads as "Reverted to computed."
  - **B-4 inline-recover unmapped import rows** — surface each unmapped classification **with its
    carried quantity** and an inline "assign code & place" control (the same assignment UX as
    `ExportOverrideModal`), so the estimator maps-and-places **without re-importing**. ⚠ **This is the
    one real unknown — resolve it first:** today `unmappedTakeoffClassifications` is only `string[]`
    (names, no qty), while qty lives elsewhere (design §5.3 says "Phase 3 already preserves it").
    Trace where the unmapped rows + their quantities actually live (`useTakeoffWorkbook` /
    `useFileIngestion` / the parser output) and decide the data source before building the control.
    If wiring the full B-4 recovery is larger than a clean slice, **split it**: ship badges + Flags
    worklist + audit log + INV-7 flip as slice 5, and carry B-4 inline-recovery as slice 5b — stop at
    a green commit either way.
- **Flip INV-7 (`correctness-contract.test.ts:307`).** Replace the `it.todo` with a real assertion:
  every persisted row carries a valid `source`, and the pure provenance helper returns a total
  mapping (a badge for every valid `source`/`needsReview` combination — never undefined). Keep it a
  node assertion on the pure helper + row model, not the DOM.

## Hard constraints (don't regress these)
- **No engine/math change** — 5c is a pure VIEW over `row.source` / `row.needsReview` /
  `overrideRecords` (`calculations.ts` stays the sole authority; AGENTS.md). The ⚑ summary-value flag
  already shipped in slice 4 — don't duplicate it.
- **DB access only via `src/lib/db.ts`.** The audit log is read from the already-loaded
  `overrideRecords` (no new fetch). If B-4 assign-and-place mutates rows, it must go through the
  existing command/registry path (`pushCommand` per AGENTS.md "Compounding History Preservation") —
  it is a user-driven row mutation, so it needs a proper `WorkbookCommand` for undo/redo, same as a
  context-menu insert. **Do NOT invent a new write path.**
- **`classification_history` / training tables stay append-only & fire-and-forget** if a B-4
  resolution records a classification (AGENTS.md "Training Data Immutability").
- **Golden McKenna must keep tying $0.00** (it has no overrides / no needs-review rows → the new
  surfaces are inert). `npm run test` green before every commit; `/code-review` before delivery.

## Tests (mirror slices 2–4 — pure logic in node, no DOM)
Assert the pure `rowProvenanceBadge` helper (each `source` → its glyph/label; `needsReview` priority;
totality), the INV-7 contract assertion (every row carries a valid source; mapping is total), and —
if B-4 lands — the assign-and-place command builder (inverse data captured for undo). The audit-log
rendering and grid badge rendering can't be unit-tested here; assert the helpers they consume.

## Stop at a sensible green-committed point with a handoff note
Update the kickoff "Build progress log" (`docs/handoffs/phase-5-build-kickoff.md`) + the
`math-trust-plan` memory rather than rushing ahead. The build is multi-session.

## Reminder for slice 6 (last)
Rounding default → `none` still **PAUSES for architect approval** of the 1-line `projects.rounding_rule
DEFAULT 'dollar' → 'none'` migration — update `supabase_schema.sql` first and invoke the
`supabase:supabase` skill. The default stays `'dollar'` in code until then (slice 3 only DISPLAYS the
active mode). Existing saved projects keep `'dollar'` regardless (db.ts writes it explicitly into a
NOT NULL column); only new projects would pick up `'none'`.
