# Procore Cost Codes — Phase 1 Reconciliation Report
_Generated 2026-06-12 by `npm run procore-codes-reconcile` — regenerate after any data change._

## What this is
The new Procore master list (`docs/reference/Procore Cost Codes.xlsx`, **217** typed
codes) is a strict subset of the old JSON oracle (`src/lib/procore-valid-codes.json`,
**224** codes). This report cross-references each **dropped** code (in the old oracle,
absent from the new list) against everything that would break if it were blind-deleted,
so the architect can decide each one in Phase 4 (retire / merge-redirect / repoint-then-retire).

## Diff summary

| Metric | Count |
| --- | --- |
| Old JSON oracle codes | 224 |
| New Procore list codes | 217 |
| Dropped (old, not new) | 7 |
| Added (new, not old) | 0 |

> CORRECTION vs. the plan: the plan-of-record assumed these were live rollup
> targets, but the live data shows ZERO references — they are safe retire
> candidates, not repoint-first:
> - `1-10440.000` (General Labor)
>
> Only `2-20000.000` Site Operations is an actual live export target.

## Reference legend
- **cost_code_map target** — internal estimate codes whose dollars roll up to this
  Procore code on export. **Retiring a code with live targets WOULD break the export
  golden unless the targets are repointed first (Phase 4).**
- **estimate_line_items (procore_code)** — saved estimate rows currently carrying this
  code as their Procore destination.
- **catalog procoreCode** — STEP 4 catalog rows that export to this code (seed source for
  cost_code_map; should mirror it).
- **catalog procoreParentCode** — STEP 2/3 *display* rollup parent only; **NOT** an export
  destination. A code referenced solely as a parent is display-grouping, not a dollar target.

## Per-code findings

### `1-10440.000` — General Labor

| Reference | Count | Detail |
| --- | --- | --- |
| cost_code_map target | 0 | — |
| cost_code_map internal_code | 0 | — |
| estimate_line_items procore_code | 0 | saved rows |
| estimate_line_items item_id | 0 | saved rows |
| catalog procoreCode (export target) | 0 | — |
| catalog procoreParentCode (display only) | 0 | — |

**Verdict: zero references anywhere — safe retire candidate.** No mapping, no saved row, no
catalog reference. Phase 4 can `retired` it with no repoint.

### `2-20000.000` — Site Operations

| Reference | Count | Detail |
| --- | --- | --- |
| cost_code_map target | 8 | 02-0000.001, 02-4100.002, 02-9005.003, 02-9070.004, 02-9200.005, 02-9300.006, 02-9400.007, 02-9500.008 |
| cost_code_map internal_code | 0 | — |
| estimate_line_items procore_code | 8 | saved rows |
| estimate_line_items item_id | 0 | saved rows |
| catalog procoreCode (export target) | 8 | 02-0000.001, 02-4100.002, 02-9005.003, 02-9070.004, 02-9200.005, 02-9300.006, 02-9400.007, 02-9500.008 |
| catalog procoreParentCode (display only) | 8 | 02-0000.001, 02-4100.002, 02-9005.003, 02-9070.004, 02-9200.005, 02-9300.006, 02-9400.007, 02-9500.008 |

**Verdict: LIVE EXPORT TARGET — must repoint before retiring (Phase 4), or the export
golden breaks.** Repoint the listed cost_code_map rows (via `updateCostCodeMapping`)
to a retained code, then retire/merge this one.

### `2-29406.000` — Trash Chute

| Reference | Count | Detail |
| --- | --- | --- |
| cost_code_map target | 0 | — |
| cost_code_map internal_code | 0 | — |
| estimate_line_items procore_code | 0 | saved rows |
| estimate_line_items item_id | 0 | saved rows |
| catalog procoreCode (export target) | 0 | — |
| catalog procoreParentCode (display only) | 0 | — |

**Verdict: zero references anywhere — safe retire candidate.** No mapping, no saved row, no
catalog reference. Phase 4 can `retired` it with no repoint.

### `6-66119.000` — Quartz Surface

| Reference | Count | Detail |
| --- | --- | --- |
| cost_code_map target | 0 | — |
| cost_code_map internal_code | 0 | — |
| estimate_line_items procore_code | 0 | saved rows |
| estimate_line_items item_id | 0 | saved rows |
| catalog procoreCode (export target) | 0 | — |
| catalog procoreParentCode (display only) | 0 | — |

**Verdict: zero references anywhere — safe retire candidate.** No mapping, no saved row, no
catalog reference. Phase 4 can `retired` it with no repoint.

### `8-87000.000` — Hardware

| Reference | Count | Detail |
| --- | --- | --- |
| cost_code_map target | 0 | — |
| cost_code_map internal_code | 0 | — |
| estimate_line_items procore_code | 0 | saved rows |
| estimate_line_items item_id | 0 | saved rows |
| catalog procoreCode (export target) | 0 | — |
| catalog procoreParentCode (display only) | 0 | — |

**Verdict: zero references anywhere — safe retire candidate.** No mapping, no saved row, no
catalog reference. Phase 4 can `retired` it with no repoint.

### `11-110000.000` — Equipment

| Reference | Count | Detail |
| --- | --- | --- |
| cost_code_map target | 0 | — |
| cost_code_map internal_code | 0 | — |
| estimate_line_items procore_code | 0 | saved rows |
| estimate_line_items item_id | 0 | saved rows |
| catalog procoreCode (export target) | 0 | — |
| catalog procoreParentCode (display only) | 7 | 11-1313.001, 11-2423.001, 11-3100.001, 11-3110.001, 11-4000.001, 11-6700.001, 11-8216.001 |

**Verdict: display-only rollup parent — safe to retire for export.** It is never a dollar
destination; the 7 child row(s) export to their own retained codes.
Phase 4 note: the catalog still references it as a `procoreParentCode` display label — a
cosmetic grouping question, not an export break. Consider `merged` → a retained parent if a
grouping label is still wanted, else `retired`.

### `60-605000.000` — Miscellaneous

| Reference | Count | Detail |
| --- | --- | --- |
| cost_code_map target | 0 | — |
| cost_code_map internal_code | 0 | — |
| estimate_line_items procore_code | 0 | saved rows |
| estimate_line_items item_id | 0 | saved rows |
| catalog procoreCode (export target) | 0 | — |
| catalog procoreParentCode (display only) | 0 | — |

**Verdict: zero references anywhere — safe retire candidate.** No mapping, no saved row, no
catalog reference. Phase 4 can `retired` it with no repoint.

## Recommended Phase 4 dispositions (architect decides)

| Code | Description | Live export target? | Suggested disposition |
| --- | --- | --- | --- |
| `1-10440.000` | General Labor | no | retire (no references) |
| `2-20000.000` | Site Operations | YES | **REPOINT then retire** (8 mapping(s), 8 saved row(s)) |
| `2-29406.000` | Trash Chute | no | retire (no references) |
| `6-66119.000` | Quartz Surface | no | retire (no references) |
| `8-87000.000` | Hardware | no | retire (no references) |
| `11-110000.000` | Equipment | no | retire (or merge to a retained parent for the display label) |
| `60-605000.000` | Miscellaneous | no | retire (no references) |

## Method / reproducibility
- Dropped set = `procore-valid-codes.json` codes minus `Procore Cost Codes.xlsx` codes.
- DB facts read live from `cost_code_map` + `estimate_line_items` via the service role.
- Catalog references read from `src/lib/estimate-catalog.json` (the cost_code_map seed source).
- Re-run: `npm run procore-codes-reconcile` (requires `.env.local` service-role key).
