# Database Fidelity — Phase 2 Kickoff (combined-line marker)

_2026-06-11 · previous phase: Phase 1 complete on local main (`f71e1d7` + review
fixes `03a7d90`, not pushed) — capture columns `bid_outcome` / `delivery_method`
live with CHECK guards, import-page dropdowns, STEP 1 + /projects backfill
controls, advisory duplicate-import banner. Suite 641/60, goldens tie $0.00._

## Ready-to-paste prompt for a fresh session

> Read `docs/plans/database-fidelity.md` (plan of record, forks locked) and
> execute **Phase 2 only**: the per-line "combined" toggle at the STEP 4
> import review gate. Scope: (1) a per-line combined/lump toggle on the
> import review table in `src/app/projects/import/page.tsx`, using the same
> corrections-state-map escape-hatch pattern the gate already uses for
> `accepted` / `uomOverrides` (revertible any time before save; save is never
> gated on it); (2) a marked line saves with
> `data_fidelity='macro_lump_sum'` (the column already exists on
> `estimate_line_items` — **no DDL, no approval gates this phase**); (3) its
> `classification_history` training write goes in TAGGED via a distinct
> `resolved_by` value (free-text column, no schema change) so
> `getClassificationHistoryBulk` ranking and the /rates price-history mining
> (`getImportedPriceHistory` consumers / `priceHistory.ts` /
> `step23Normalization.ts` history paths) EXCLUDE lump observations —
> record everything, tagged; never discard (architect-locked). (4) Establish
> the documented `resolved_by` vocabulary in ONE module with every write
> routed through one `src/lib/db.ts` helper — Phase 5 must extend this
> vocabulary, not invent its own (named risk in the plan). All DB access
> through `src/lib/db.ts`; training writes from hooks stay fire-and-forget
> (`.catch(() => {})`); `classification_history` is append-only. Exit: tests
> proving a lump-tagged observation never surfaces in suggestions or price
> history, suite + goldens green ($0.00 ties), `npx tsc --noEmit` clean,
> `/code-review` findings resolved, committed via `git commit -F <tempfile>`,
> close with /handoff (do NOT push). Stop at the phase boundary — Phases 3–6
> and import-roadmap items 2/3/5 stay out of scope.

## Where Phase 1 left off (context a cold session may need)

- **Plan file:** `docs/plans/database-fidelity.md` — Phase 2 section + the
  "Locked decisions" block (record-everything-tagged) + the `resolved_by`
  vocabulary-sprawl risk note.
- Phase 1 added `BidOutcome` / `DeliveryMethod` unions in `src/types/db.ts`,
  option lists in `src/lib/constants.ts`, both project row mappers in
  `src/lib/db.ts`, and pure `normalizeProjectName` /
  `findLikelyDuplicateImports` in `src/lib/importEstimate.ts` (tests in
  `src/lib/__tests__/duplicateImportDetection.test.ts`).
- `data_fidelity` already exists end-to-end: `DbEstimateLineItem` and
  `ProcessedTakeoffRow.dataFidelity` (`'discrete_unit' | 'macro_lump_sum'`),
  mapped in `db.ts` `mapLineItemFromRow`. The toggle only needs to SET it on
  the in-memory rows before the existing save path.
- Import-save training writes happen in `handleSave`
  (`recordClassificationResolution(description, itemId, id, "user")`) — the
  `"user"` literal is today's only gate-side `resolved_by` value; that
  call site is where the lump tag branches.
- Exit-gate commands: `npm run test` · `npx tsc --noEmit` · commit message
  written to a temp file (no BOM) then `git commit -F <file>` — never inline
  multi-line commit text (Windows shell rule).

## Approval gates

None this phase (no DDL, no export changes). The next ⛔ gate in the
workstream is far off (Phase 6 sequencing).
