# Actuals Phase 3 — Ingestion UI (implementation plan)
_2026-06-24 · branch `actuals-cost-history` · no DDL (reuses the Phase 2 schema)_

## Goal
A new route that lets a user upload a project's Procore CSV exports (Budget Detail +
change-event summary/detail, plus optional supplementary files), preview the parsed
`NormalizedActuals` **including diagnostics** (so nothing is silently dropped), pick the
target project (auto-suggested from the embedded `25-117` / "Orchard Path III" token on the
parsed `SubcontractorCommitmentRow`), and save an **un-promoted** snapshot via
`db.ts/saveBudgetSnapshot`. Minimal end-to-end: upload → parse → store. No reconciliation,
no promotion, no DDL.

## Reuse (built in Phases 1–2, nothing re-derived)
- `CsvActualsSource` + `computeNormalizedActuals` — the parse + normalization engine.
- `saveBudgetSnapshot({ projectId, normalized, label?, sourceKind: 'csv', metadata })` — the
  Phase 2 atomic gateway (engine numbers copied verbatim; un-promoted on insert).

## New pure logic (the only testable units this phase adds)
A small pure module bridges the raw exports to the UI:
- `classifyActualsCsv(csvText)` → which of the six export shapes a dropped file is (by header
  signature), or `null` if unrecognized. Lets the user drop all files at once; the UI shows
  the routing so a misread is visible, never silent.
- `extractEmbeddedProjectToken(raw)` → `{ projectNumber, projectName }` from the subcontractor
  commitments rows (the only export carrying the embedded `25-117` token), or `null`.
- `suggestProjectMatch(token, projects)` → the best existing project to attach to (number token
  found in a project name → exact normalized name → containment), or `null`.

## Implementation plan

| # | File | Change |
|---|------|--------|
| 1 | `src/lib/actuals/ingest.ts` (new) | Pure: `classifyActualsCsv`, `extractEmbeddedProjectToken`, `suggestProjectMatch` + `ActualsExportKind` / `EmbeddedProjectToken` / `ProjectMatchCandidate` types. No DB/React import. |
| 2 | `src/lib/actuals/index.ts` | Re-export the new ingest surface from the actuals barrel. |
| 3 | `src/lib/__tests__/actualsIngest.test.ts` (new) | Unit tests: classifier routes all six real fixture files + rejects junk; token extraction reads `25-117`/"Orchard Path III"; project match resolves by number, exact name, containment, and returns null when nothing fits. |
| 4 | `src/app/projects/import-actuals/page.tsx` (new) | The ingestion UI (mirrors `projects/import/`): multi-file drop → classify + route (visible table) → parse via `CsvActualsSource`+`computeNormalizedActuals` → preview totals + the full diagnostics panel + a code-actuals table → project picker (auto-suggested) + optional label → Save un-promoted snapshot via `saveBudgetSnapshot`; success state. |
| 5 | `src/app/projects/page.tsx` | Add an "Import Actuals" nav button beside "Import Past Estimate". |

## Guardrails honored
- **No DDL** — reuses the Phase 2 schema; no schema-file change.
- **Single gateway** — the page imports only `getProjects` + `saveBudgetSnapshot` from `db.ts`;
  no direct Supabase client import.
- **No financial fabrication** — the page never derives a dollar; it stores exactly what the
  engine computed (`saveBudgetSnapshot` → `buildBudgetSnapshotPayload`, copied verbatim).
- **Nothing silently dropped** — file routing, unrecognized files, and the engine's full
  `ActualsDiagnostics` (unjoined / summary-only / duplicates / unattributed lines /
  internal-non-zero / unclassified events) are surfaced in the preview.
- **Un-promoted** — Phase 3 only inserts; promotion to FINAL is Phase 5.

## Definition of Done
test · `npx tsc --noEmit` · `npm run build` · `/code-review` · one commit to
`actuals-cost-history` via `git commit -F` · push · write the Phase 4 handoff · stop.
