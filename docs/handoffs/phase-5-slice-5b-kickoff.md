# Kickoff — Phase 5 BUILD slice 5b (B-4 inline assign-and-place for unmapped import rows)

> Paste this as the first message of a fresh session to build slice 5b. Slices 1–5 are DONE and
> committed on `phase-5-visual-trust`. Slice 5 split B-4 out — this is that carry-over.

---

Slices 1–5 are DONE and committed on `phase-5-visual-trust`. First check out the existing build
branch — **DO NOT cut a new one and DO NOT branch from main:**

```
git checkout phase-5-visual-trust
```

Confirm slices 1–5 are present: `git log --oneline -7` should show `050ab66` (slice 5 — 5c
provenance badges + Flags tab + flip INV-7), `f0d0f23` (slice 4 — override setter + ⚑ flags),
`eb5df86` (slice 3 — 5b Reconciliation + chip), `2b1191e` (slice 2 — Trust Inspector + 5a Trace),
`8b35559` (slice 1 — export applies overrides). Run `npm run test` once to confirm the green
baseline: **404 passed + 0 todo (37 files)**.

> `npm run test` is vitest in a **node** env — there is no DOM/React test harness (no
> `@testing-library/react`, no `jsdom`). Test pure logic, not the DOM. The slice template to copy is
> **`src/lib/overrideSetter.ts` + `src/lib/__tests__/overrideSetter.test.ts`** (slice 4): extract the
> decision/validation logic into a pure helper and assert *that* in node; the component is just the
> I/O shell.

## Read before writing code, in this order

1. **`docs/handoffs/phase-5-build-kickoff.md`** — the architect-signed build plan. Read the "Build
   progress log" first (slices 1+2+3+4+5 = done; slice 5 split out B-4 → **you are slice 5b**), then
   the rest (esp. the **"Filtered-view trap" (Amendment F)** and **"recordEstimateOverride THROWS"**
   hard constraints, and §9 build-slices table).
2. **`docs/plans/phase-5-visual-trust-ui-design.md`** §5.3 (the Flags tab) — the unmapped-import
   recovery bullet is your spec. **The design is approved — do NOT re-open it or re-ask the four
   locked decisions.**
3. **`AGENTS.md`** — three rules govern this slice: **"Compounding History Preservation"** (every row
   mutation MUST go through `commandHistory.pushCommand()` with a proper `WorkbookCommand`), **"Move
   Effect Atomicity"** (an `EDIT_CELL` that changes a row's division via `itemId` MUST embed
   `moveEffect` on the same command — one Ctrl+Z undoes edit + relocation atomically), and
   **"Structural Manipulation Grid Parameters"** (row mutations must be driven by an explicit user
   action). Also `CLAUDE.md`, `memory/MEMORY.md` → the `math-trust-plan` memory.
4. The data + write path already present (no new write path; no engine change):
   - **`buildFlagsModel({ rows, overrideRecords }).unmappedRows`** (in `src/lib/trustInspector.ts`,
     shipped slice 5) already gives you each unmapped row with its carried qty:
     `{ rowId, itemId, classification, description, matchedQty, uom }`. It selects
     `rows.filter(r => !r.isMapped && r.classification.trim() !== "")`. **This is where the unmapped
     rows + quantities live** — the slice-5 kickoff's "one real unknown" is already resolved.
   - **The existing write path = `meta.commitCellEdit(rowId, "itemId", prevItemId, newItemId)`**
     (`src/hooks/useCellEditing.ts:274`). It is the command builder: it reads `rowsRef.current`,
     builds the `EDIT_CELL` command with the full itemId cascade (10 derived fields) **and the
     cross-division `moveEffect`**, and pushes history. It is **call-path independent** — the grid's
     fuzzy-suggestion buttons already call it directly on click without entering edit mode
     (`useTakeoffWorkbook.tsx:863,914`). **Reuse it. Do NOT invent a new write path.**
   - **Suggestions** come from `getFuzzySuggestions(classification, ESTIMATE_ITEMS_MASTER)`
     (`src/lib/similarity.ts` + `src/lib/mock-data.ts`) — the same source the grid's itemId cell uses
     for its inline suggestions.

> ⚠ **The one correction you must internalize** (design §5.3 says "same assignment UX as
> `ExportOverrideModal`" — that phrasing is about the *control shape*, not the data path):
> - **B-4 unmapped rows** (this slice) are CSV rows whose **classification matched no corporate
>   `itemId`** (`!isMapped`). The fix is **assigning the `itemId`** (the corporate Code) →
>   `commitCellEdit(..., "itemId", ...)`, which derives `procoreCode`/`isMapped`/etc. via the cascade
>   and relocates the row to its division (moveEffect). Suggestions = `ESTIMATE_ITEMS_MASTER` via
>   `getFuzzySuggestions`.
> - **`ExportOverrideModal` / `applyProcoreOverrides` / `ExportBlocker` are a DIFFERENT concern** —
>   rows that *have* an itemId but whose dollars reach no granular **`procoreCode`**, assigned from
>   `PROCORE_VALID_CODES` at export time. **Do NOT route B-4 through `applyProcoreOverrides`** — that
>   assigns the wrong field.

## Build SLICE 5b only

▎ **Slice 5b — B-4 inline assign-and-place for unmapped import rows (Flags tab):**
▎
▎ - In the **Flags tab's unmapped worklist** (`FlagsTab` → the "Unmapped import rows" section in
▎   `src/components/workspace/TrustInspector.tsx`, currently read-only `WorklistRow`s that only jump to
▎   the grid), add an inline **"assign code & place"** control per row: a code picker pre-seeded with
▎   `getFuzzySuggestions(row.classification, ESTIMATE_ITEMS_MASTER)` (top matches as one-click chips,
▎   like the grid) **plus** a free-entry input/select over the full master so any valid code can be
▎   chosen. On assign, the row's `itemId` is set and the row relocates to its division.
▎ - **Write path = the existing command builder.** Thread a new callback **`onAssignCode(rowId,
▎   newItemId)`** down `EstimateTable → TrustInspector → FlagsTab`. `EstimateTable` implements it by
▎   looking up the row's current `itemId` (from `rows`) and calling
▎   **`table.options.meta.commitCellEdit(rowId, "itemId", currentItemId, newItemId)`** — the same path
▎   the grid's suggestion buttons use. This gives `pushCommand` + cascade + **`moveEffect`** for free
▎   (one Ctrl+Z undoes the assignment and the relocation atomically — AGENTS.md "Move Effect
▎   Atomicity"). **Do NOT build a new `WorkbookCommand` or a new DB write.**
▎ - After a successful assign, the row leaves `unmappedRows` on the next render (it becomes
▎   `isMapped`), so the worklist shrinks live. Decide the post-assign focus (keep the inspector open on
▎   Flags; optionally offer the existing "view" jump). Keep it consistent with slice 5's `onViewRow`.
▎ - **Node-testable surface (pure helper, mirror `overrideSetter.ts`).** Since `commitCellEdit` IS the
▎   command builder and is **already tested** for itemId undo fidelity incl. cross-division
▎   `moveEffect` (`src/lib/__tests__/commandCapture.test.ts`), the *new* pure surface is the
▎   **assign-input decision logic** — e.g. `src/lib/assignCode.ts`: `validateAssignInput(code)`
▎   (non-empty; trimmed; resolves to a known `ESTIMATE_ITEMS_MASTER` itemId → ok/err) and/or
▎   `suggestCodesForClassification(classification, limit)` (a thin, testable wrapper over
▎   `getFuzzySuggestions`). Unit-test that in node. Do NOT re-test the command capture — cite that
▎   `commandCapture.test.ts` already covers it.

## Hard constraints (don't regress these)

- **No engine/math change** — assigning a code is a row mutation via the existing command path;
  `calculations.ts` stays the sole authority (AGENTS.md). The summary recomputes naturally once the
  row becomes mapped.
- **Single write path:** `commitCellEdit` only (→ `pushCommand`); **no new `WorkbookCommand`, no new
  DB call, not `applyProcoreOverrides`**. DB access only via `src/lib/db.ts` if any (there is none new
  here).
- **Move Effect Atomicity** (AGENTS.md): one Ctrl+Z must undo the edit *and* the relocation — which
  you get by reusing `commitCellEdit`; verify by reading its `moveEffect` handling, don't reimplement
  it.
- If a B-4 resolution ever records a classification into `classification_history`, it stays
  **append-only & fire-and-forget** (`.catch(() => {})`) (AGENTS.md "Training Data Immutability").
  (Check whether `commitCellEdit` already does this on an itemId map — if so, you inherit it; don't
  duplicate.)
- **Golden McKenna must keep tying $0.00** (it has no unmapped rows → the new control is inert).
  `npm run test` green before the commit; `/code-review` before delivery.

## Tests (mirror slices 2–5 — pure logic in node, no DOM)

Assert the pure `assignCode` helper (validation: empty/whitespace rejected, unknown code rejected,
known itemId accepted; suggestion ordering/limit). The inline control's rendering and the
`commitCellEdit` wiring can't be unit-tested here; assert the helper it consumes and reference the
existing `commandCapture.test.ts` for the command's undo fidelity.

Stop at a sensible **green-committed** point with a handoff note (update `phase-5-build-kickoff.md`'s
"Build progress log" + the `math-trust-plan` memory) rather than rushing ahead. The build is
multi-session.

## Reminder for slice 6 (the last slice): rounding default → `none`

It **PAUSES for architect approval** of the 1-line `projects.rounding_rule DEFAULT 'dollar' → 'none'`
migration — update `supabase_schema.sql` first and invoke the `supabase:supabase` skill. The default
stays `'dollar'` in code until then (slice 3 only DISPLAYS the active mode); existing saved projects
keep `'dollar'` regardless (`db.ts` writes it explicitly into a NOT NULL column) — only new projects
would pick up `'none'`.
