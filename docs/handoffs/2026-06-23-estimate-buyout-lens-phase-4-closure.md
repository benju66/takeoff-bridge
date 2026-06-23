# Estimate Buyout Lens — Phase 4 closure + merge proposal

_2026-06-23 · branch `estimate-buyout-lens` · Phase 4 commit `736bff5` + Projected Profit
follow-on `a9b211e` (branch tip; off Phase 3 `e075983`, off `main` @ `d47c231`)_

## Status: WORKSTREAM COMPLETE — awaiting architect approval to merge to `main`

All four phases of the Estimate Buyout Lens are built, committed, and pushed on
`estimate-buyout-lens`. Phase 4 (the final phase) added the rollup footer + "% committed"
progress bar and ran the guardrail proof. The one remaining step is the **workstream-end
merge to `main`**, which needs explicit architect approval (the push-to-`main` prompt IS the
gate). Per CLAUDE.md Git Workflow, default is a direct `--no-ff` merge; a PR is opt-in only.

## What Phase 4 shipped (commit `736bff5`)
- **Footer rollup**, shown **only in the Buyout lens** (`EstimateTable.tsx`), in the
  status-bar area: **Estimate total · Projected cost · Projected variance** (green favorable /
  red over, matching the Variance column's `>0 = favorable` convention) + a **"% of value
  committed" progress bar** (L-4 — Σ Estimate on lines with a Vendor ÷ Σ Estimate), showing
  the % and `$committed of $estimateTotal`.
- **Cells ↔ footer can't drift:** the per-line Estimate resolution the Variance column already
  used (linked/bound live value, stray → 0, else row Total; D-E) was extracted into one pure
  `resolveLineEstimate(linked, rowTotal)` in `buyout.ts`, now called by **both** the Variance
  cell and the rollup. The rollup is assembled in `useTakeoffWorkbook` (next to
  `getLinkedRowState` + `buyout.map`) and exposed as `buyoutRollup` on the hook, threaded
  through `page.tsx` into `EstimateTable`.

### Edge cases (handled + commented)
- **Empty estimate** — `computeBuyoutRollup([])` is all-zero & zero-guarded; the footer is also
  gated on `rows.length > 0` (mirrors the status bar), so a brand-new estimate shows no footer
  and never renders NaN/Infinity.
- **Structural rows** — division dividers/subtotals and the modifier + Total-Estimated-Cost
  summary rows are rendered by GridShell/the tfoot and are **not** in `rows`, so they are
  excluded from the rollup by construction. Every entry in `rows` is a buyout-able data line
  (D-C).
- **Filter/search active → DECISION: rollup reflects the WHOLE estimate** (not the filtered
  view), so a line hidden by a filter still counts toward "% committed". The footer shows a
  small amber note ("Filter active — rollup reflects the whole estimate") when `isFiltered`.
  Reason documented in the `buyoutRollup` memo comment.

## Guardrail proof (the workstream's safety property)
- **Goldens tie $0.00** — ran `golden-mckenna` / `golden-synthetic` / `golden-care` explicitly:
  **21 tests pass**. (The McKenna oracle IS present locally — its 7 tests ran and passed.) This
  proves buyout is display-only and never enters the engine/export.
- **Export byte-unaffected** — `grep` confirms **zero** buyout/vendor/actual/variance references
  in `src/lib/exporter.ts` and the export/Procore libs. The buyout columns are deliberately kept
  out of `columnDefs` (which the exporter iterates), so nothing buyout-shaped reaches the
  workbook/Procore output.
- **No DB / no DDL / no Supabase advisors** — buyout is browser-local (localStorage) only.

## Definition of Done — all green
- `npm run test` → **1227 passed** (was 1224 at Phase 3; +3 `resolveLineEstimate` cases).
- `npx tsc --noEmit` → clean.
- `npm run build` → green.
- Changed-files lint → clean (the single `lockedCells` warning in `EstimateTable.tsx` is
  **pre-existing** debt, not in the changed lines).
- `/code-review` (medium) → no findings.

## Files changed (Phase 4)
- `src/lib/buyout.ts` — `LinkedEstimateState` + `resolveLineEstimate` (pure, tested).
- `src/hooks/useTakeoffWorkbook.tsx` — `buyoutRollup` memo; Variance cell calls the shared
  helper; `buyoutRollup` on the return + type interface.
- `src/app/projects/[projectId]/page.tsx` — thread `buyoutRollup` into `EstimateTable`.
- `src/components/workspace/EstimateTable.tsx` — `BuyoutRollupFooter` (numbers + bar) +
  shared `money()` formatter; rendered only in the Buyout lens.
- `src/lib/__tests__/buyout.test.ts` — `resolveLineEstimate` cases.

## Phase 4 follow-on — Projected Profit footer (`a9b211e`, on the same branch)
After inspecting the company template's **STEP 4 - ESTIMATE** sheet, we confirmed columns
**O = Vendor** and **P = Actual** (`P = I` by default) — i.e. the spreadsheet's O/P ARE the
Buyout columns — and the bottom rows are **TOTAL PROJECTED COST** (`P341 = SUM(P10:P340)`),
**Projected Profit $** (`O347 = I341 − P341`) and **Projected Profit %** (`P347 = O347/P341`).
Architect approved adding these to the footer (keeping the % committed bar). The footer now shows:
- **Total Estimate (Bid)** = engine Total Estimated Cost (incl. modifiers + fee) → ties to `I341`.
- **Total Projected Cost** = `bid − profit` → ties to `P341`.
- **Projected Profit ($ + %)** = `fee + buyout savings`, % of projected cost → ties to `O347`/`P347`.
- **% committed bar** kept (buyout PROGRESS, distinct from the margin %).

Math is pure + tested (`computeBuyoutProfit` in `buyout.ts`): the Fee is in the bid but isn't a
cost (template marks its Actual "NA"), so it falls straight to profit; every dollar under estimate
(the data-line savings = `rollup.projectedVariance`) adds to it. Anchored on the **unfiltered**
`fullTakeoffSummary` bid + fee so it's whole-estimate consistent with the rollup. Still
display-only/browser-local — goldens still tie **$0.00**. Suite **1232** green, tsc/build clean,
lint-clean, `/code-review` clean (one cosmetic `abs()` fix). This resolves the product note below
(the footer "Estimate" was data-lines-only; "Total Estimate (Bid)" now shows the full bid).

## One product note for the architect (not a bug)
The footer's **"Estimate total" is the sum of the buyout-able data lines only** — it excludes
the modifier rows (construction/design contingency, builder's risk, special insurance) and the
"Total Estimated Cost" summary row, because those are rendered as tfoot summary rows and have
no Vendor/Actual cells in the current grid. So the footer's "Estimate" will read **lower than
the grid's "Total Estimated Cost"**. This is consistent with the cells (only data lines are
bought out) and matches L-4's "Σ Estimate" being over the buyout-able lines. If you later want
the modifiers/contingency to be buyout-able (the real spreadsheet bought out contingency &
insurance — D-C rationale), that's a follow-up: those rows would need to become real grid rows
(or get their own buyout cells in the tfoot) before they can carry a Vendor/Actual.

## Proposed next step (your call)
**Merge `estimate-buyout-lens` → `main`** (direct `--no-ff`, then push `main`). The push-to-
`main` prompt is the approval gate. Say the word ("merge it" / "ship it" / "land it") and I'll
drive it. If you'd rather run the cloud `/code-review ultra` or CI first, ask and I'll open a PR
instead.

### Deferred (hooks/seams preserved, NOT built — future fast-follows)
- Real shared `estimate_buyout` table (a single function swap of the localStorage read/write).
- Per-line inspector depth (multiple quotes, award status, dates, attachments).
- Vendor picker dropdown (Vendor is free text today).
- Block-paste into Vendor/Actual (D-B).
- Making modifier/contingency rows buyout-able (see product note above).
