# Standalone Formula-Driven Template — Discovery & Sizing
_2026-06-12 · status: BACKLOG (candidate workstream) · do NOT start until #2 (Template + Catalog Reconciliation) is complete._

## Goal
Turn the app's export into a **product**: an app-generated company estimate template that is
**accurate, formula-driven, and usable standalone** — a team can open it in Excel, edit
inputs, and have totals recompute correctly, without the app. Confirmed achievable — it's an
assembly/hardening of already-proven pieces, not a research problem.

## Why it's realistic (pieces already exist)
- The export already mutates the template XML and **preserves most live formulas**.
- The golden harness already proves **$0.00** fidelity to the real template.
- The **Excel round-trip feature** (in-flight cloud work) already exports live STEP 2/3
  formulas + offline edit + re-import — the closest existing piece.

## Current state — formula-vs-value audit (src/lib/exporter.ts, 2026-06-12)
**~65–75% of the exported workbook is already live-formula-driven.** Inputs (qty col F, rate
col H) are written as VALUES; the dependent line formulas survive and recompute.

| Region | Recomputes on offline input edit? | Notes |
|---|---|---|
| STEP 4 detail rows (col I=F×H, J per-unit, K per-SF) | ✅ yes | mapped + linked + unmapped (unmapped get NEW synthetic formulas, exporter.ts:1594–1600) |
| STEP 4 division headers (col E `=SUM(...)`) | ✅ yes | exporter.ts:1626 |
| STEP 4 reconciliation rows | ✅ yes | always formulas, exporter.ts:1752–1779 |
| STEP 4 subtotal/modifiers/grand total | ⚠ partial | FORMULA when clean; frozen to VALUE when ≥1 override active (exporter.ts:1659,1678,1707,1731) |
| STEP 2/3 detail line items (col I, J) | ✅ yes | qty/rate are values, line formulas live |
| **STEP 2/3 subtotals** | ❌ no | written as VALUES for exact tie-out (exporter.ts:1234–1251) |
| **Budget Line Items (BLI) rollup, col H** | ❌ no | **100% static values** — SUMIF-by-Procore-code deliberately flattened (exporter.ts:1984–2053) |

## The gap to "fully standalone" (the ~25–35% that's static — all intentional)
1. **BLI rollup sheet** — restore live `SUMIF`-by-Procore-code so the Procore rollup
   recomputes from edited detail. Biggest single piece; was flattened on purpose for
   upload determinism / floating-point tie-out.
2. **STEP 2/3 subtotals** — restore `SUM` formulas (flattened for bit-identical tie-out).
   The round-trip feature already does live STEP 2/3 formulas — reuse/extend.
3. **Modifier freeze under overrides** — decide whether standalone mode keeps modifier
   formulas live (today they freeze to values when an override is active).

## Core tension → likely solution: TWO export modes
The Procore-upload export WANTS flattened values (determinism, exact tie-out, clean upload).
The standalone template WANTS live formulas. So the likely shape is a **"standalone /
formula-live" export mode** distinct from the existing Procore-upload (flattened) export —
not a replacement. Same engine, two outputs.

## Definition of done (what proves it's trustworthy offline)
- **Recalc golden:** open the exported workbook in a real calc engine, force a full recalc,
  confirm **$0.00** — proving the math is formula-driven, not baked values. (Catches the
  failure mode of a cell that should be live shipping as a static number.) This is THE key
  new verification.
- **Round-trip golden:** export → edit an input offline → re-import → recalc → still $0.00.
- Both layered on the existing STEP 4 + GC/Site-Ops golden.

## Template hardening (turns an export into a tool a team can trust)
- Lock/protect formula cells; clearly mark editable input cells.
- Embed a short legend + a version stamp.
- Optional: a standalone-mode banner so users know it's a live working copy.

## Governance
Once edited outside the app, the app data and the workbook can diverge. Define a clear
**source-of-truth rule** (app vs offline workbook) + how round-trip re-import resolves it.

## Dependencies & sequencing
- **After #2** (clean, correct codes/types — the structural prerequisite).
- **Relates to the Excel round-trip feature** (in-flight PR) — that work + this share the
  formula-live export path; coordinate so they don't fork.
- Builds on the math-trust golden harness.

## Sizing verdict
**Medium workstream.** ~70% already formula-driven; the remaining work is restoring live
formulas to the BLI rollup + STEP 2/3 subtotals (deliberately flattened today) behind a
standalone mode, plus the recalc/round-trip golden and template hardening. Not small (the
flattening was intentional and the two-mode split needs care), but well-bounded.

## Next step
After #2, run `/plan-phases` using this doc as the brief. First investigate how the in-flight
Excel round-trip PR landed (it may already cover STEP 2/3) to avoid duplicate work.
