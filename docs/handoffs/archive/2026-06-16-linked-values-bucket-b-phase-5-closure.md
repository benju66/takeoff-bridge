# Linked Values — Bucket B: Phase 5 closure & workstream-close coverage map
_2026-06-16 · branch `linked-values-bucket-b-p5` (fresh off `main`, the 3+4 pair merged via PR #7)_

> Phase 5 — the **workstream-closing** phase. Bucket B is now complete: the calculation
> engine's hardcoded value relationships are **fully visible** in the kind-blind dependency
> graph / Trust Inspector "Links" tab, and there is a per-cell entry point into that view from
> the GC and Site-Ops pages. Inspection-only — no DB, no financial writes, no export change.

---

## What Phase 5 shipped

1. **`division` rollup tier** (`engineGraph.ts`). `division:<NN>:total` echo nodes — one per
   PRESENT STEP 4 division — that ECHO the Σ of their member lines' `line:<id>:total` source
   nodes, grouped by 2-digit CSI division via **`getDivisionCode()`** (AGENTS.md; never inline
   substring/split/regex). They REUSE the existing `line:<id>:total` source ids as edges (no
   duplicate leaves) — so a STEP 4 cell now shows its division rollup under "Used by", and a
   division node shows its member lines under "Depends on" (the **line → division** path trail).
   `"division"` is added to `EngineGraphTier`, `ALL_ENGINE_TIERS`, and the switch; the node-ID
   scheme (`DIVISION_NODE_PREFIX`, `divisionTotalNodeId`) lives in `types.ts`.

2. **Per-cell GC/Site-Ops Links badge** (the entry point the architect's spot-check was held
   for). A shared `EngineLinkBadge` (🔗) on every GC (STEP 2) and Site-Ops (STEP 3) value —
   line totals, section subtotals, grand totals — dispatches the existing `tb:inspect-binding`
   window event carrying the value's raw engine node id (`gc:*` / `siteops:*`). See **Cross-step
   delivery** below.

3. **Structural guards + coverage proof.** New `bindingEngineGraphDivisionStructure.test.ts`
   (the load-bearing division drift catch) and `bindingEngineGraphCoverage.test.ts` (the
   "no-straggler" catch + the full-graph perf check), plus a `line → division` traversal in
   `bindingLinksEngine.test.ts` and one Playwright e2e (Site-Ops badge → STEP 4 Links tab).

4. **Coverage map doc** (this file).

---

## Cross-step delivery (the one notable UX behavior)

The project page (`projects/[projectId]/page.tsx`) renders **one step panel at a time**
(`activeTab === "stepN" && …`). The Trust Inspector — and its `tb:inspect-binding` listener —
lives inside `EstimateTable`, which is **unmounted** while the GC/Site-Ops panels show. So a
badge click on STEP 2/3 **navigates to STEP 4** and opens the inspector there:

- The badge dispatches `tb:inspect-binding` with `{ nodeId }`.
- A page-level coordinator (always mounted) catches it: when `activeTab !== "step4"` it stashes
  `pendingInspect = { nodeId, seq++ }` and `router.push(?step=step4)`. EstimateTable mounts with
  the prop already set and a `seq`-keyed effect opens the Links tab on that node (race-free — no
  reliance on event timing across the unmount).
- When STEP 4 is **already** mounted, the coordinator early-returns and EstimateTable's own
  listener (now widened to accept a raw `nodeId` in addition to the grid's `rowId`) handles it.

Lifting the inspector to page-level so it could open *in place* on STEP 2/3 was out of scope for
a closing phase (a large refactor). Imported projects render `ImportedStep23Panel` (not the
parametric calculators), so badges appear only on parametric projects — the engine-graph path.

---

## Coverage map — every engine relationship → the node family that exposes it

§1.1 of the plan classified ~240 engine relationships across GC (STEP 2), Site-Ops (STEP 3), and
the STEP 4 summary. Bucket B exposes them as read-only echo nodes at these tiers (the per-tier
structure tests assert *node set == engine produced-value set* exactly, so coverage is verified,
not asserted by hand):

| Engine area (plan §1.1) | Exposed by | Node family (tier) | Phase |
|---|---|---|---|
| STEP 4 summary: subtotal trail, 7 modifiers, total, cost-per-SF/unit | `summary` tier | `summary:<field>` (13 nodes) | 1–2 |
| Cross-page money trail (takeoff + linked → subtotal → modifiers → total) | `summary` tier edges | `summary:subtotal ← [takeoffSubtotal, linkedDivisionsTotal]`, … | 1–2 |
| GC rollups/subtotals (staff / ops / equipment / manual → grand total) | `gc` tier | `gc:<group>Subtotal`, `gc:grandTotal` | 3 |
| GC derived (`supervisionSubtotal`, `general = grand − supervision`) | `gc` tier | `gc:supervisionSubtotal`, `gc:general` | 3 |
| GC leaf lines (qty × rate → total; lump-sum equipment) | `gc` tier | `gc:<group>:<code>:{qty,rate,total}` | 3 |
| Site-Ops rollups (dynamic + manual → grand total) | `siteOps` tier | `siteops:<group>Subtotal`, `siteops:grandTotal` | 4 |
| Site-Ops section re-grouping (8 template sections) | `siteOps` tier | `siteops:<section>` (cross-cutting) | 4 |
| Site-Ops leaf lines (all 3 entry types, uniform qty × rate) | `siteOps` tier | `siteops:<group>:<code>:{qty,rate,total}` | 4 |
| STEP 4 division rollups (line totals by CSI division) | `division` tier | `division:<NN>:total ← line:<id>:total` | **5** |
| The 10 cross-page linked lookups (GC/Site-Ops → STEP 4 division rows) | v1 `linkedDivisionBindings` | `line:<itemId>:total` lookups | v1 |

**No stragglers.** The `siteOps` `[qty, rate]` leaf edge is uniform across all entry types (no
total-only leaves); GC's lump-sum equipment is the only total-only leaf and it is noded. The
`bindingEngineGraphCoverage.test.ts` asserts the `ALL_ENGINE_TIERS` union covers all 13 summary
fields, every GC aggregate + one leaf-total per GC line, every Site-Ops aggregate + all 8
sections + one leaf-total per Site-Ops line, and one division total per present division — and
that each tier emits only in its own namespace (so a tier registered in `ALL_ENGINE_TIERS`
without a switch branch would emit nothing and fail). The 10 linked lookups are covered by v1's
`linkedDivisionBindings` (real `lookup` bindings, inspectable via the grid's per-row badge) and
are deliberately NOT re-noded here, to avoid a second, divergent representation of the same edge.

### Documented division semantics (LD-B2 faithfulness)
`division:<NN>:total` echoes the **Σ of its member `line:<id>:total` source nodes** (the same Σ
the graph already holds), exactly as the `siteops:<section>` re-grouping echoes Σ of leaf totals.
This is internally consistent (`value === Σ inputs`). It can DIFFER from
`computeDivisionBreakdown` for a division that contains one of the 10 linked-division rows:
that analytics aggregation counts the row's *linked* value, whereas `line:total` holds the row's
stored `total`. This is a documented divergence in representation, **not** a re-derivation of the
math — the division node never computes a number the engine didn't already produce as a line
total.

---

## Perf (the §6 graph-size risk)
Measured at the full node count: the worst-case fixture (heavy GC utilization + every Site-Ops
entry type + 21 STEP 4 rows across 10 divisions) assembles + evaluates the **complete 326-node**
graph in **~1.16 ms** at the `assembleBindingGraphNodes` seam — three orders of magnitude under
the CI-safe 500 ms budget. A Links-tab open is a single in-memory topological-sort pass; perf is
a non-issue at this size. If a future estimate ever pushed the graph much larger, the kind-blind
graph supports lazy/subgraph evaluation (noted, not pre-built).

---

## Safety envelope (carried, all honored)
- **LD-B2** echo-only — the `division` tier echoes Σ of engine line totals; never re-derives.
- **LD-B4** no DB / no financial writes / no export change. The engine fold stays **default-OFF**
  on the grid / recompute / export path (`recomputeLineBindingValues` passes no options →
  `includeEngine` false → no engine nodes). All three goldens (McKenna / synthetic / CARE) tie
  **$0.00**. The badges are display-only and never touch the export path.
- **LD-B5** kind-blind — division nodes are plain `GraphNode`s folded at the existing
  `assembleBindingGraphNodes` seam; new ids in `types.ts`; reuses canonical `line:total` ids
  (engine > bare-source precedence unaffected — `division:*` ids never collide).
- **AGENTS.md** — division extraction via `getDivisionCode()` only.

## Gate status
`npm run test` green (**87 files / 1045 tests**, incl. the 3 golden tie-outs $0.00) ·
`npx tsc --noEmit` clean · eslint clean on all touched files (the 2 remaining warnings in
`EstimateTable.tsx` — `lockedCells` unused, `useVirtualizer` incompatible-library — are
PRE-EXISTING, in untouched lines) · one Playwright e2e written (live-env, like the Phase 2 spec;
covered by the architect's manual /verify).

---

## The workstream is complete — what is NOT built (the editability arc)
Bucket B is **inspection-only** and now closed. The editability arc remains FUTURE and unbuilt:
- **Future Phase 6** — formula-engine dependency investigation (HyperFormula is a *candidate*,
  not an assumed choice) + editable design. **Architect-gated; decide before any build.**
- **Future Phase 7** — editable migration build (gated on Phase 6): let estimators re-author
  these relationships as editable expression bindings.

Hooks preserved from day one: the OPEN `kind` enum (`types.ts`), compiler isolation (`compile.ts`
is the only kind-aware module), by-id / by-predicate references, and the echo descriptor
(`engineGraph.ts`) as the read-only fallback an editable kind would supersede per-node.

**STOP** at the Phase 5 boundary.
