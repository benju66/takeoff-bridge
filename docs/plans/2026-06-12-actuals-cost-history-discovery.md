# Actuals Cost-History — Discovery & Design Notes
_2026-06-12 · status: DISCOVERY (pre-plan) · this is workstream #3; do NOT start until #1 done (✅ merged) and #2 (Template + Catalog Reconciliation) is complete._

This captures the ground-truth findings + architect feedback for the eventual actuals
cost-history workstream, so `/plan-phases` can start from real data instead of guessing.

## North star
A **historical cost model built from REAL actuals** (not just as-bid estimates), whose
highest-value output is **concept / early-budget pricing** — parametric metrics like
`$/SF` and `$/dwelling-unit` by code/division/market sector, plus estimate-accuracy
calibration. Resolves the architect's original concern that an estimates-only cost
database is inaccurate.

## Decisive findings from a real actuals export
Sample: `docs/reference/sample-procore-budget-details.csv` (a Procore **Budget Detail**
report, one completed-ish project, 130 lines, 20 columns — all dollars).

1. **Granularity = the type-suffixed Procore code** (`Budget Code` column, e.g.
   `1-10320.000.Labor`) = exactly the `(base + type)` universe of the `procore_cost_codes`
   spine from workstream #1. **No reverse-mapping problem** — Procore reports actuals at
   precisely the level our master list defines. Clean, direct join.
2. **NO quantities or units — dollars only.** Actuals are **total cost per code**, never
   unit rates. (Verified: zero qty/unit columns.)
3. **The export carries BOTH sides per code:** `Original Budget Amount` (≈ the estimate
   that became the budget) AND `Estimated Cost at Completion` (EAC = the actual).
4. Sample sanity check: Original Budget **$18.39M** → EAC **$18.37M** (**−0.1%** at the top
   line), but large code-level swings (rough carpentry −$833K, contingency −$267K,
   electrical −$120K; gypcrete/wall-panels/painting over). The code-level signal is the prize.

## The model is FOUR layers, each needing one input
| Layer | Output | Input needed | Status |
|---|---|---|---|
| Raw | actual $ per Procore code per project | budget detail export | ✅ sample in `docs/reference/` |
| **Clean** | normalized actual (CO-decomposed) | **CO log export** | ⛔ need a sample |
| **Parametric** | `$/SF`, `$/unit` benchmarks | **project metrics** (SF, # units, type) | ⛔ need source |
| Unit-rate (optional) | `$/UOM` per material | estimate qty + confirmed-actual-qty flag | partial (app has est qty) |

## Architect feedback (the three design drivers)

### 1. Change orders must be decomposed, or the history lies
Raw final cost ≠ estimate accuracy. Example from the sample: **Winter Conditions**
(`50-502000.000`) = `$0` original budget, `$121K` actual — entirely CO-driven; a naive
estimate-vs-actual scores it as a 100% miss when it's a known seasonal add.

The company classifies COs on three axes (capture all three):
- **Scope:** In Scope / Out of Scope → PRIMARY filter. Out-of-scope (owner adds scope) is
  EXCLUDED from estimate accuracy; in-scope (we missed something) COUNTS against it.
- **Type:** Allowance · FP Contingency/Buyout · No Cost · Original Budget · Owner
  Contingency → funding mechanism. Buyout variance = real estimating signal;
  allowance/contingency draws = budget mechanisms, not misses.
- **Change Reason:** AHJ · Allowance · Arch/Eng · FP Construction · Internal (DO NOT SEND
  TO SUB) · Owner Request · Winter Conditions → the *why* (Owner Request/Arch-Eng = scope
  change; Winter = seasonal; Internal = internal adjustment).

→ Store the final cost **decomposed by CO classification**, so the engine can compute a
**normalized actual** ("what our original bid scope actually cost") vs the **total actual**.
The budget detail already carries per-code CO dollars (`Approved COs`,
`Budget Modifications`); the **CO log** is what classifies them — join the two.

### 2. Material quantities — be honest about the basis
Estimates can carry material quantities; the actuals export does NOT. To derive an actual
**unit rate** you must use the **estimate's** quantity, which may differ from what was
actually installed. So:
- Default: derive from estimate qty, **flagged "estimated qty, unconfirmed."**
- Better where it matters: capture a **confirmed actual quantity at closeout** to override.
- Lump-sum **subcontract** codes often have no meaningful unit rate (the sub bid a number).
- Always record **which quantity basis** a rate came from.

### 3. Parametric metrics for concept/early pricing (the real prize)
At concept stage there's no takeoff — only gross metrics (total SF, # units/keys). Want:
`$/SF` and `$/unit` (e.g. "flooring across 72 units = $X → $/unit") by code/division/sector.
Needs each completed project's **denominators** (total SF, dwelling-unit count, unit mix,
type) — NOT in the budget detail; must be captured (extends the existing `market_sector`).

## Locked-ish design decisions (to confirm at plan time)
- **"Actual" = `Estimated Cost at Completion` (EAC)**; ingest **completed projects only**
  (EAC = final at closeout; `ERP Job to Date` is the booked cross-check).
- **"Estimate baseline" = `Original Budget Amount`** (compare Original for "bid quality";
  Revised for "managed-budget quality").
- **Scope-move noise:** code-level variance is distorted by budget reclassifications (e.g.
  $1.43M Rough Carpentry Material re-budgeted into Wall Panels/Trusses). Compare at a stable
  grouping or track the modifications.
- **Provenance separation:** actuals live in a SEPARATE `actual` pool from as-bid history;
  never blended. Plugs into the existing `PriceObservation` / `historyTrust.ts` pipeline
  with a new provenance tag.

## App integration points (existing)
- `procore_cost_codes` (workstream #1) = the join key/spine.
- `getBidPriceHistory` / `aggregateTrustedHistory` (`historyTrust.ts`) = the read pipeline
  to extend with an actual pool.
- Estimate quantities = on `estimate_line_items` (matched_qty) for Layer-4 derivation.
- `market_sector` = the first project-metric; extend for SF / unit count.

## Open inputs still needed before planning
1. A sample **Procore change-order (CO) log export** (with Scope/Type/Reason).
2. Where **project metrics** (total SF, # units, project type) live and how to capture them.

## Next step
When workstream #2 is complete, run `/plan-phases` using THIS doc as the brief. Likely a
multi-phase workstream: (P1) ingest + raw per-code actuals → (P2) CO decomposition / clean
actuals → (P3) project metrics + parametric `$/SF` `$/unit` → (P4) optional derived unit
rates + UI on `/rates`.
