# Handoff — Actuals Cost-History & Project Budget Snapshots, Phase 2 kickoff
_2026-06-23 · from the Phase 1 (parser + normalization engine) session_

## Where we are
**Phase 1 is COMPLETE, committed, and pushed.**
- Branch: `actuals-cost-history` (off `main` `60d3101`), commit `7b0085a`, pushed to origin.
- Plan of record: `docs/plans/2026-06-23-actuals-cost-history-and-budget-snapshots.md`.
- Definition of Done satisfied: 64 new tests green · `npx tsc --noEmit` clean · `npm run build`
  green · `/code-review` (no blocking findings) · one commit · branch pushed.

### What landed (pure; no DB, no UI)
New modules under `src/lib/actuals/`, all behind a swappable `ActualsSource` interface
(`CsvActualsSource` now; a Procore-API source slots in later untouched):
- `types.ts` — enums + record/output interfaces + the `ActualsSource` interface.
- `currency.ts` — `parseActualsCurrency` (strips `$`, delegates to the existing sign-safe
  `parseUsNumber`), `normalizeEventId`, `parseCostCode`/`parseCostCodeDescription`,
  `parseCostType`, `buildGrainKey`.
- `parseExports.ts` — PapaParse readers for all six export shapes.
- `classify.ts` — canonicalize messy Scope/Type/Reason casing + bucket each event.
- `normalize.ts` — the engine: `computeNormalizedActuals(raw) → NormalizedActuals`.
- `csvSource.ts` — `CsvActualsSource` from the six CSV strings.
- `index.ts` — barrel.
- 6 test files + `actualsFixtures.ts` read the **real** `templates/` exports.

### The engine's output shape (Phase 2 stores this)
`computeNormalizedActuals` returns `NormalizedActuals`:
- `codeActuals: CodeActual[]` — per `code+costType` grain key (e.g. `1-10320.000.Labor`):
  `{ budgetCode, costCode, costType, description, originalBudget, totalActual,
  normalizedActual, isBurden, normalizedOutContributions[] }`.
- `events: ClassifiedChangeEvent[]` — joined + classified + dedup-flagged.
- `grandTotalActual`, `grandNormalizedActual`, `burdenTotalActual`, `directTotalActual`.
- `diagnostics` — `unjoinedDetailEventIds`, `summaryOnlyEventIds`, `duplicateEventGroups`,
  `unattributedDetailLineCount`, `internalNonZeroEventIds`, `unclassifiedEvents`.

### Golden constants pinned from the sample project (Orchard Path III / 25-117)
- Σ totalActual (EAC grand total) = **$18,314,218.92**
- Σ normalizedActual = **$18,254,126.31**
- Fee (`60-604000.000`) + GL (`60-602020.000`) burden = **$181,663.28**
- 130 distinct `code+costType` grain rows · 162/162 change events join cleanly.

## Non-obvious discoveries (build Phase 2 to fit these)
1. **Event-id format mismatch (CRITICAL):** the change-event **detail** zero-pads ids to 3
   digits (`097`); the **summary** uses unpadded (`97`). `INT-xxx` ids match as-is. The join
   MUST canonicalize (`normalizeEventId`) or every event 1–99 silently loses its
   classification. Covered by a regression test.
2. **Two numbers, top-down from EAC:** `totalActual` = the budget export's
   `Estimated Cost at Completion`. `normalizedActual` = EAC minus the per-code `Latest Cost`
   of change events in the OUT buckets (Owner-Contingency / Out-of-Scope / Allowance-reconcile
   / net-zero Internal reclass). In-scope FP Contingency/Buyout draws are KEPT. This keeps
   cost overruns not captured by a CO inside the normalized number (the locked definition).
3. **Net-zero internal nuance:** only Internal-reason events whose detail lines net to ~$0
   are cancelled (INT-001/003). INT-002 (+$15k, single code) is NOT net-zero → kept and
   flagged in `diagnostics.internalNonZeroEventIds`. Don't blindly cancel all `INT-xxx`.
4. **Fee/GL ride the revenue side in the detail:** in the change-event detail the Fee and GL
   lines carry their markup on `Latest Price` (cost side = 0), so they don't pollute direct
   cost. Burden lives in the budget on the two `60-xxxxxx.000` codes; the engine flags those
   `isBurden` so Phase 2/6 can include/exclude burden.
5. **Duplicates:** events 97/98 ("Project Insulation", −$41,476.26) are a true duplicate by
   cost-side fingerprint; 79/72 ("Additional Build Wrap", different amounts) are NOT. Dedup
   keys on title+class+per-line dollars.
6. **Supplementary exports parsed but not yet consumed:** PCOs, prime COs, and subcontractor
   commitments parse to typed records. The commitments carry the embedded project token
   (`25-117` / "Orchard Path III") — that's the **project auto-suggest** source for Phase 3.

## ⚠️ Working-tree warning for the architect / next session
At the start of the Phase 1 session the working tree already contained an **uncommitted,
modified `templates/Company_Estimate_Template.xlsx`** (220,007 → 227,921 bytes) and a modified
`scripts/output/cost-code-gaps.json`. The modified template adds rows that **break 4
`src/__tests__/export-integrity.test.ts` assertions** (Fee modifier shifts `F339`→`F340`,
print area +1 row) — this has NOTHING to do with the actuals work. Proof: with the committed
template restored, the FULL suite is **107/107 files green including the new actuals tests**;
with the modified template present, export-integrity fails even on its own.

**Action needed (architect decision, NOT done by the agent):** decide whether that template
change is intentional. If yes, it must be committed deliberately and `export-integrity.test.ts`
expectations updated to match (and the `2026-06-10` manual-catalog-additions story re-checked).
If no, `git checkout -- templates/Company_Estimate_Template.xlsx scripts/output/cost-code-gaps.json`.
The agent left these working-tree files untouched (not staged, not reverted).

## Phase 2 — Storage spine (⛔ DDL) + db.ts gateway
Per the plan's Phase 2 scope. Design and add the core tables **in one phase** so later phases
are DDL-free, modeled on `estimate_versions` / `estimate_snapshots`:
- `budget_snapshots` — append-only, tenant-scoped via the projects join, immutable freeze-guard
  trigger, `is_final` promotion flag + partial-unique "one FINAL per project" index.
- `budget_snapshot_actuals` — per `code+costType`: `total_actual`, `normalized_actual`, the
  CO-bucket breakdown, `is_burden`, original budget. (Shape it to the `CodeActual` above.)
- Storage for the **optional per-line manual allocation** that Phase 4 uses to recover
  rollup granularity.
- An atomic write RPC (mirror `save_estimate`) + `db.ts` read/write methods. **No consumer UI.**

### ⛔ Approval gates (Definition of Done, CLAUDE.md)
- **Run the `supabase:supabase` skill FIRST.**
- **DDL gate:** update `supabase_schema.sql` first, present the EXACT SQL, then STOP for
  explicit architect approval before applying to the live DB (`nefvkrhbbkiqnpeabyqz`). Never
  apply DDL un-approved.
- After applying: `get_advisors` shows no new findings.

### Exit criteria (the standard five + handoff)
`npm run test` green · `npx tsc --noEmit` clean · `npm run build` green · `/code-review`
resolved · one commit on `actuals-cost-history` (message via `git commit -F`) · push the
branch · write the Phase 3 handoff. **One phase per fresh session — stop at the phase boundary.**

## Phase 2 kickoff prompt
> Implement **Phase 2 of the Actuals Cost-History & Project Budget Snapshots** workstream, per
> `docs/plans/2026-06-23-actuals-cost-history-and-budget-snapshots.md` and the Phase 2 handoff
> `docs/handoffs/2026-06-23-actuals-phase-2-kickoff.md`. Phase 2 is the **storage spine (⛔ DDL)
> + db.ts gateway** — `budget_snapshots` (append-only, freeze-guard, one-FINAL-per-project),
> `budget_snapshot_actuals` (shaped to the Phase 1 `CodeActual`), per-line manual-allocation
> storage, an atomic write RPC, and `db.ts` methods. NO consumer UI. Run the `supabase:supabase`
> skill FIRST; update `supabase_schema.sql` and STOP for explicit approval of the exact SQL
> before touching the live DB. Take it through the Definition of Done, commit one phase to
> `actuals-cost-history`, push, write the Phase 3 handoff. Stop at the phase boundary.
