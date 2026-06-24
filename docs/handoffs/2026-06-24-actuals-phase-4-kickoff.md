# Handoff — Actuals Cost-History & Project Budget Snapshots, Phase 4 kickoff
_2026-06-24 · from the Phase 3 (ingestion UI) session_

## Where we are
**Phase 3 is COMPLETE, committed, and pushed.**
- Branch: `actuals-cost-history`, commit `8712c2b` (off Phase 2 `6110cb2`).
- Plan of record: `docs/plans/2026-06-23-actuals-cost-history-and-budget-snapshots.md`.
- Phase 3 implementation plan: `docs/plans/2026-06-24-actuals-phase-3-ingestion-ui.md`.
- Definition of Done satisfied: `npm run test` green (**109 files / 1317 tests**,
  +13 over Phase 2) · `npx tsc --noEmit` clean · `npm run build` green (the new
  `/projects/import-actuals` route is registered) · `/code-review` (medium) run +
  the one finding resolved · one commit · branch pushed. **No DDL this phase.**

## What landed in code
- **`src/lib/actuals/ingest.ts`** (NEW, pure — no DB/React) — the three reusable
  ingestion helpers, exported from the `actuals` barrel:
  - `classifyActualsCsv(csvText)` → `ActualsExportKind | null`. Routes a dropped
    CSV to one of the six export shapes by **header signature** (PapaParse
    `preview:1`, BOM-tolerant via `.trim()`). Disambiguation order matters: budget
    (`Cost Code Tier 1`) → change-event detail (`Event #`+`Latest Cost`) → summary
    (`Scope`+`Type`+`Reason`) → subcontractor commitments (`Project Number`+
    `Contract Company`) → potential COs (`PCCO`/`Change Reason`) → prime COs
    (`Designated Reviewer`/`PCO`). The shared `Budget Code` column never decides.
  - `extractEmbeddedProjectToken(raw)` → `{ projectNumber, projectName } | null`.
    Reads the embedded `25-117` / "Orchard Path III" token off the subcontractor-
    commitments rows (the only export that carries it).
  - `suggestProjectMatch(token, projects)` → `ProjectMatchCandidate | null`. Takes
    a structural `ProjectLike = { id, name }` (kept DB-decoupled). Confidence
    order: project-number-in-name → exact normalized name → containment. Returns
    `null` when nothing matches — **never guesses**.
- **`src/app/projects/import-actuals/page.tsx`** (NEW) — the ingestion UI, mirroring
  `src/app/projects/import/`'s aesthetic (ProtectedRoute, card layout, lucide icons,
  local `Field`/`Row` helpers per this codebase's per-page convention):
  - Multi-file `<input accept=".csv" multiple>` → each file read as text, classified,
    routed into a per-`ActualsExportKind` **slot map** (a new file of a known kind
    replaces its slot; files can be added incrementally). The **routing table** is
    shown (which file → which export, core vs supplementary, "needed" markers);
    **unrecognized files are listed**, not silently dropped.
  - Parse via `CsvActualsSource` (budget required; absent change-event CSVs default
    to `""` → parse to `[]`, engine tolerates) → `computeNormalizedActuals`.
  - Preview: headline totals (EAC / normalized / direct / burden), a **`DiagnosticsPanel`**
    rendering the full `ActualsDiagnostics` (unjoined / summary-only / duplicate
    groups / unattributed line count / internal-non-zero / unclassified events),
    and a scrollable **per-code actuals table** (normalized highlighted when it
    differs from EAC; burden codes tagged).
  - Auto-suggested project picker (`<select>` over `getProjects()`, pre-selected from
    `suggestProjectMatch` until the user picks) + optional label →
    `saveBudgetSnapshot({ projectId, normalized, label?, sourceKind: 'csv', metadata })`.
    `metadata` records the source filenames per slot + the embedded project
    number/name + an upload timestamp.
  - Success state shows the assigned `snapshot_number` + totals, with "Go to project"
    and "Upload another snapshot".
- **`src/app/projects/page.tsx`** — an "Import Actuals" nav button (Database icon)
  beside "Import Past Estimate".
- **`src/lib/__tests__/actualsIngest.test.ts`** (NEW, +13) — classifier routes all
  six real fixtures + rejects junk/empty + tolerates a BOM + every fixture lands in
  a distinct slot; token extraction reads `25-117`/"Orchard Path III"; project match
  by number / exact name / containment / number-beats-name / null-when-no-match.

## Non-obvious discoveries / decisions (build Phase 4+ to fit these)
1. **Snapshots save UN-PROMOTED.** Phase 3 only inserts via `saveBudgetSnapshot`
   (`is_final` defaults false). Promotion to FINAL is Phase 5 (`finalizeBudgetSnapshot`,
   already in `db.ts` from Phase 2). Do not promote in Phase 4.
2. **Budget-only upload is a real path.** The UI requires only the Budget Detail to
   parse; change-event summary/detail are optional in the form. Absent → `""` →
   `parseChangeEventSummary`/`Detail` return `[]` → normalized == total, clean
   diagnostics. The engine already tolerates this (no code change needed).
3. **Auto-suggest never auto-attaches on a guess.** `suggestProjectMatch` returns
   `null` when nothing matches and the picker stays unset; the embedded token is
   still shown so the human can pick. A manual pick sets `userPickedProject` and the
   auto-suggest stops overriding it.
4. **`Parsed` stores only `{ normalized, token, fileNames }`** — the full
   `RawActualsExport` is computed locally in `reparse` and intentionally NOT held in
   state (the code-review fix: nothing read it; no reason to retain ~850 parsed rows
   for the page's lifetime). If Phase 4 needs the raw join again, re-parse or read it
   back from the stored snapshot.
5. **Engine numbers are stored verbatim.** The page never derives a dollar;
   `saveBudgetSnapshot` → `buildBudgetSnapshotPayload` copies the engine output. Keep
   it that way — the calc/normalization engine is the sole financial authority.

## Carry-over notes
1. **Plan-of-record still untracked.** `docs/plans/2026-06-23-actuals-cost-history-and-
   budget-snapshots.md` is still untracked (as at Phase 2). Commit it whenever
   convenient — left out of the Phase 3 commit to keep that commit phase-focused.
2. **Pre-existing working-tree churn.** A `docs/handoffs|plans` → `archive/` reorg
   (unstaged deletions + untracked `archive/` copies) was present before this session
   and left untouched — not part of the actuals commits. `git status` will show it.
3. **No snapshot-consumer UI yet.** Nothing reads `getBudgetSnapshots` /
   `getBudgetSnapshotDetail` in the app yet (Phase 4 reconciliation + Phase 8
   dashboard are the first consumers). The project page does not list snapshots.

## Phase 4 — Staging ground: estimate ↔ code reconciliation
Per the plan's Phase 4 scope. Reconstruct the project's estimate→Procore-code mapping
(via `resolveProcoreCode` over the saved line items / submitted version); bucket every
code as **1:1** (auto-verify) or **rolled-up**; offer **targeted** manual actual entry
on high-value/high-variance rollups with an **"enter all"** toggle; a **declined**
rollup is excluded. Persist verifications + manual allocations to the snapshot via the
**mutable `budget_snapshot_allocations` overlay** (`db.ts/saveBudgetSnapshotAllocation`
/ `getBudgetSnapshotAllocations` / `deleteBudgetSnapshotAllocation`, from Phase 2) —
NOT onto the frozen snapshot rows. The overlay's open-enum `kind` (free TEXT) + JSONB
`detail` is the deliberate room to write with **zero new DDL**.

- **Approval gates:** none (reuses the Phase 2 schema — no DDL).
- **Surface to reuse:** Phase 2 allocation gateway + `getBudgetSnapshotDetail` (frozen
  actuals + events + diagnostics + existing allocations). Reconstruct the estimate side
  with the existing `resolveProcoreCode` / cost-code-map machinery (see
  `src/lib/costCodeResolver.ts` and how `/projects/import` reconstructs mappings).
  Recompute any normalized-with-overrides from the frozen raw + overlay on load — do
  NOT mutate frozen rows (handoff discovery #2 from Phase 2).
- **Exit criteria:** the standard five (test · tsc · build · review · commit) + handoff.
  **One phase per fresh session — stop at the phase boundary.**

## Phase 4 kickoff prompt
> Implement **Phase 4 of the Actuals Cost-History & Project Budget Snapshots** workstream,
> per `docs/plans/2026-06-23-actuals-cost-history-and-budget-snapshots.md` and this Phase 4
> handoff `docs/handoffs/2026-06-24-actuals-phase-4-kickoff.md`. Phase 4 is the **staging
> ground: estimate ↔ code reconciliation.** Reconstruct the project's estimate→Procore-code
> mapping; bucket each code as 1:1 (auto-verify) or rolled-up; offer targeted manual actual
> entry on high-value/high-variance rollups with an "enter all" toggle; a declined rollup is
> excluded. Persist verifications + manual allocations to the **mutable
> `budget_snapshot_allocations` overlay** (Phase 2 gateway: `saveBudgetSnapshotAllocation` /
> `getBudgetSnapshotAllocations` / `deleteBudgetSnapshotAllocation`) — never onto the frozen
> snapshot rows; recompute normalized-with-overrides from the frozen raw + overlay on load.
> Reuse `getBudgetSnapshotDetail` and the existing `resolveProcoreCode` / cost-code-map
> machinery. NO promotion yet (that's Phase 5), NO DDL (the overlay's open-enum `kind` + JSONB
> `detail` absorbs the new vocabulary). Take it through the Definition of Done, commit one
> phase to `actuals-cost-history` via `git commit -F`, push, write the Phase 5 handoff. Stop
> at the phase boundary.
