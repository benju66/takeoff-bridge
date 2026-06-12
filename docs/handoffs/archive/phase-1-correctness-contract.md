# Handoff — Phase 1 (Correctness Contract) → Phase 2 (Reproduction Harness)

> Written 2026-06-08 at the close of Phase 1 of `docs/plans/make-the-math-trustworthy.md`.
> Read this, then the plan's **Phase 2 "Cold-start brief"**, then start Phase 2 in a fresh
> session.

## What Phase 1 delivered (committed, green)

Phase 1 was **doc + tests only — no behavior change.** Two new files:

1. **`docs/correctness-contract.md`** — the written spec of what "correct" means. Three
   sections:
   - **Invariants** INV-1 … INV-8, each phrased to map to a test, with status tags
     (`holds today` / `Phase 2` / `Phase 3` / `Phase 5`).
   - **Single source of truth** — `calculations.ts` is the sole financial authority, plus an
     explicit "forbidden to invent" list (exporter only rolls up, never re-derives a markup).
   - **Silent-escape register** — a table of every place a wrong/missing number can escape
     today and how each is made loud: bug #5 (sign, `parser.ts:45-50`), bug #3 (dropped row,
     `useFileIngestion.ts:162-178`), unset-modifier defaulting (`calculations.ts:349-356`,
     visibility), card-price defaulting (`parser.ts:119`, visibility).
2. **`src/lib/__tests__/correctness-contract.test.ts`** — the executable contract. **9 guard
   tests pass on day one** (INV-1 engine-half, INV-2, INV-3, INV-4 ×2, INV-5, INV-6 ×2), plus
   **4 `it.todo` placeholders** for the invariants that land later (INV-1 full tie-out → Phase 2;
   INV-7 provenance badge → Phase 5; INV-8 sign + dropped-row → Phase 3).

**Test status:** `npm run test` → **290 passed + 4 todo across 28 files** (was 281). The 4 todo
are intentional pending markers, not failures. `/code-review` run: clean (no correctness
findings on a doc+test-only diff).

## Key facts the Phase 1 work nailed down (so Phase 2 doesn't re-derive them)

- **Subtotal basis:** the modifiers, cost/SF, and cost/unit all compute on
  `takeoffSubtotal + linkedDivisionsTotal` (the template's STEP 4 I331 basis, which **includes**
  the 10 linked GC/Site Ops rows). A linked row's own typed qty×price never counts.
- **Rounding:** each of the 7 modifiers is rounded **independently** (`applyRounding`) before
  summing; `totalEstimatedCost` is the exact sum of the rounded components. JS `Math.round` is
  half-up — Phase 2 should expect this when comparing to Excel (watch-item §Risks: Excel may
  round half-to-even in places; document any legitimate divergence per Phase 2.4).
- **Explicit-zero rule:** rates use `??` (nullish), so an explicit `0` is preserved; only a
  genuinely unset rate falls back (GL 1%, Fee 5%). The golden harness must feed the oracle's
  *actual* G18–G24 rates, not rely on these defaults.
- **The $0.01 match bar** is the existing `RECONCILIATION_TOLERANCE` (`exporter.ts:322`). Use
  the same constant/tolerance in the golden test.

## Where Phase 2 starts

Per the plan's **Phase 2 — Reproduction Harness** (the ⭐ keystone):

1. **Read first:** the plan + this handoff + `docs/correctness-contract.md`, then
   `src/lib/xlsx-reader.ts`, `src/lib/calculations.ts`, and
   `src/__tests__/export-integrity.test.ts` (the ExcelJS tie-out pattern to mirror).
2. **Oracle file:** `C:\Users\BUrness\takeoff-bridge-fixtures\McKenna-Crossing-Estimate.xlsx`
   (already on disk — no architect handoff needed up front). Resolution order:
   env `TAKEOFF_GOLDEN_XLSX` → `fixtures/golden/McKenna-Crossing-Estimate.xlsx` → that master path.
3. **Build:** `.gitignore` `/fixtures/golden/` (never commit a bid figure);
   `fixtures/golden/{.gitkeep,README.md}`; `src/lib/templateExtractor.ts` (reusable — extends
   `xlsx-reader.ts`'s `extractCellValue` to capture formula text *and* cached result; locates
   STEP 4 line items by scanning the cost-code column, **not** hardcoded rows);
   `src/__tests__/golden-mckenna.test.ts` (`describe.skipIf(!fixtureExists)` so CI/other
   machines skip cleanly).
4. **Prove to the cent:** feed extracted inputs through `computePersonnelCosts` →
   `computeSiteOperations` → `computeLinkedDivisionTotals` → `computeTakeoffSummary`, and the
   export half through `rollupByProcoreCode` + `rollupGcSiteOps`; assert every output equals
   the extracted oracle cell within **$0.01**.
5. **Phase 2.4 is a discovery event:** the first run will likely surface deltas. Triage each as
   (a) engine bug, (b) input extracted wrong, or (c) legitimate Excel-vs-JS rounding to
   document. Append a findings note to `docs/correctness-contract.md` listing every delta and
   its disposition, then bring the deltas to the architect.

**Guardrails unchanged:** `calculations.ts` is the sole financial authority; all DB access via
`db.ts`; no schema change in Phase 2; confidential bid pricing never enters git (the golden
test reads expected values from the gitignored oracle at runtime).

**Do not start Phase 3** until Phase 2 is committed green (golden test ties to the cent or every
residual delta is dispositioned).
