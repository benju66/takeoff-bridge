# Linked Values — Bucket B: Engine Graph Exposure — Plan of Record
_2026-06-15 · status: PROPOSED_

> Investigation + authored design + phased plan for making the calculation engine's
> currently-hardcoded value relationships **visible** in the dependency-graph inspection
> UI. Builds on the completed Linked Values v1 (`docs/plans/2026-06-15-linked-values-system.md`).
> **No feature code until this plan is reviewed.**

---

## 0. Context & long-term goal

v1 shipped the binding engine + the inspection UI (per-cell depends-on/used-by + the Trust
Inspector "Links" tab), but it only exposes relationships that are *expressed as bindings*
(the reframed cross-page linked rows + anything an estimator authors). The large body of math
still hardcoded in `calculations.ts` — modifiers, GC staff math, Site-Ops drivers, summary
sums — is invisible to the Links UI. That hidden math is **"bucket B."**

The long-term goal is unchanged: the app fully replaces Excel; the estimate is the single
source of truth; every value's wiring is **inspectable structure, not buried code.** Bucket B
is the step that makes the *whole* estimate's wiring visible.

---

## 1. Investigation findings

### 1.1 The engine's relationships, classified (~240 total)
| Bucket | GC (STEP 2) | Site-Ops (STEP 3) | STEP 4 summary |
|---|---|---|---|
| Rollup-expressible (sums/sections/subtotals) | 7 | 11 | 12 |
| Lookup-expressible (×constant) | 16 | 12 | 7 |
| Derived source nodes (inputs / passthroughs) | 30 | 63 | — |
| **Needs a formula (value×value, ÷, multi-term)** | 40 | 33 | ~9 |

~40% of relationships are arithmetic *between two values* (every "qty × rate" line total,
cost-per-SF, `gcGeneral = grandTotal − supervision`, etc.). The v1 **user-facing** vocabulary
(lookup ×const, rollup sum/count/avg/min/max) cannot express those.

### 1.2 The decisive insight: visibility is decoupled from expressibility
The "needs a formula" gap only blocks letting **users re-author** these as editable bindings.
It does **not** block *showing* them, because:
- The graph is already **kind-blind and already holds read-only, non-binding nodes** (v1's
  `gc:*`, `siteops:*`, `line:*` source nodes). GraphNode has no `kind`
  ([types.ts](src/lib/bindings/types.ts)); the graph resolves edges by node ID.
- A node's `evaluate` is an arbitrary code closure. An **engine-described node authored in
  code** can carry *any* relationship — it simply **echoes the engine's already-computed value
  and declares its input edges.** No formula engine is needed for visibility.
- There is a **single seam** — `assembleBindingGraphNodes()`
  ([registry.ts:380](src/lib/bindings/registry.ts:380)) — feeding *both* the grid and the Links
  tab ([buildLinksModel, trustInspector.ts:464](src/lib/trustInspector.ts:464)). Folding a pure
  `describeEngineGraph(...)` in there federates engine nodes into the inspection UI with **zero
  changes to the graph core, the compiler, or the math.**

**Therefore: full visibility across all ~240 relationships is achievable now — additively, at
low risk, with the engine still the sole authority and goldens trivially holding $0.00.** The
HyperFormula gating applies only to the *editable* future arc.

### 1.3 Integration seam (where the work lands)
- `src/lib/bindings/engineGraph.ts` (**new**, pure) — `describeEngineGraph(gc, siteOps, rows,
  summary) → GraphNode[]` (echo nodes + edges).
- `assembleBindingGraphNodes()` gains an opt-in `includeEngineGraph` param (default off → grid
  display unchanged; on for the Links tab). Collision precedence: **user binding > engine-described
  node > bare source node.**
- `buildLinksModel` opts in; the Links tab renders engine depends-on/used-by with no Links-logic
  changes (it already labels any node via `describeSourceNode`).
- Per-cell entry points (summary cells, linked rows, later GC/Site-Ops cells) dispatch
  `tb:inspect-binding` focused on the relevant engine node.

---

## 2. Authored design — the echo descriptor

```ts
// src/lib/bindings/engineGraph.ts  (pure, read-only)
function describeEngineGraph(
  gc: PersonnelCalcResult, siteOps: SiteOpsCalcResult,
  rows: readonly ProcessedTakeoffRow[], summary: TakeoffSummary,
  tier: EngineGraphTier,           // which levels to emit (tiered rollout)
): GraphNode[]
```
Each emitted `GraphNode`:
- `id` — canonical scheme, extended: `summary:<field>`, `division:<NN>:total`, plus v1's
  `gc:*`, `siteops:*`, `line:*`.
- `basis` — currency / quantity / rate / percent / each.
- `inputs` — the **edges**, authored from the known engine structure (e.g. `summary:subtotal`
  → `[summary:takeoffSubtotal, summary:linkedDivisionsTotal]`; each modifier →
  `[summary:subtotal]`; `summary:totalEstimatedCost` → `[summary:subtotal, ...7 modifiers]`;
  `gc:grandTotal` → `[gc:staffTotal, gc:opsTotal, gc:equipmentTotal, gc:manualTotal]`).
- `evaluate` — **ECHO**: returns the engine's already-computed value captured from the
  calc-result / summary. **It never re-implements the math.** (Edges drive the depends-on/used-by
  view; the value comes from the engine.)

This keeps `calculations.ts` the single source of the math (AGENTS.md financial authority), makes
drift structurally impossible at the value level, and lets the existing
evaluate/Links pipeline work unchanged.

---

## 3. Locked decisions
- **LD-B1 (intent):** Inspection-only for this workstream. Editability is a **future arc that
  BEGINS with a formula-engine dependency investigation** — HyperFormula is a candidate to
  evaluate, **not** an assumed choice (architect's call).
- **LD-B2 (faithfulness):** **Echo** the engine value; never re-implement the math in the
  descriptor. Engine = sole authority.
- **LD-B3 (granularity):** **Tiered** rollout (summary + cross-page → GC tree → Site-Ops tree →
  division/polish), **architected to reach complete coverage** of all ~240 relationships.
- **LD-B4 (safety envelope):** **No DB, no financial writes, no export change.** Purely additive
  read-only description. Both goldens must stay $0.00 every phase.
- **LD-B5 (architecture, inherited):** Graph stays kind-blind; engine nodes are plain
  `GraphNode`s folded at the `assembleBindingGraphNodes` seam via opt-in; reuse the canonical
  node-ID scheme.
- **LD-B6 (branch):** New branch `linked-values-bucket-b`. **Pre-req decision:** either merge the
  confirmed-green v1 (`linked-values-system`) to `main` first and branch off `main`
  (Recommended — clean base), or branch `linked-values-bucket-b` off `linked-values-system` if
  you're not ready to merge v1.

---

## 4. Out of scope / deferred
- **No editable re-authoring** of engine relationships (future arc; gated on the formula-engine
  decision).
- **No formula engine** (HyperFormula or otherwise) — not chosen, not added. The future arc
  starts by *investigating* the right dependency.
- **No re-derivation** of engine math in the descriptor (echo only).
- **No persistence / no migration / no export change.**
- **No full node-and-edge graph visualization** (still the separate, optional enhancement from
  v1's LD-2).

---

## 5. Phases (inspection-only, tiered to complete coverage)

> Each phase is one fresh session. Phases 1–2 deliver the highest-value tier (the cross-page +
> summary money trail). Phases 3–5 complete the picture. None has a DDL/financial/export gate.

### Phase 1 — Engine descriptor: summary + cross-page tier (pure lib, echo, no wiring)
- **Scope:** New `src/lib/bindings/engineGraph.ts` emitting Tier 1 nodes — `summary:*`
  (takeoffSubtotal, linkedDivisionsTotal, subtotal, 7 modifiers, totalEstimatedCost, costPerSf,
  costPerUnit) with **echo** values from `TakeoffSummary` and authored edges; anchored to the
  existing cross-page linked / `gc:*` / `siteops:*` subtotal node IDs. Formalize the
  `summary:<field>` node-ID convention in `types.ts`.
- **Approval gates:** none.
- **Smallest slice:** `summary:subtotal` + its two inputs + one modifier, with a test that the
  echoed value equals `computeTakeoffSummary` to the cent.
- **Exit:** unit tests (echo === engine across fixtures incl. overrides; edge structure; no
  cycles) · goldens untouched (no wiring) · `npm run test` green · `tsc` clean · committed ·
  handoff.

### Phase 2 — Wire Tier 1 into the inspection UI (Links tab + entry points)
- **Scope:** Add opt-in `includeEngineGraph` to `assembleBindingGraphNodes()` (default off;
  precedence user-binding > engine > source). `buildLinksModel` opts in. Summary cells
  (`SummaryTraceCell`) and linked-division cells open the Links tab focused on their engine node
  (extend the badge / `tb:inspect-binding` dispatch). Reconcile with the Trace tab (note: it
  already decomposes the grand total) without rebuilding it.
- **Approval gates:** none.
- **Smallest slice:** clicking a summary total opens the Links tab showing its real inputs +
  dependents.
- **Exit:** Links tab shows accurate depends-on/used-by for summary + cross-page nodes · grid
  display path unchanged (flag off) · **goldens tie $0.00** · unit tests + one Playwright e2e ·
  **manual /verify** · `npm run test` green · `tsc` clean · committed · handoff.

### Phase 3 — GC internal decomposition tier (full GC tree)
- **Scope:** Extend `describeEngineGraph` with GC nodes to leaf: `gc:grandTotal` ← subtotals;
  each subtotal ← its leaf line totals; each leaf line total (echo) ← `[qty, rate]`; qty/rate as
  derived sources; `supervisionSubtotal` ← 3 supervision staff totals; `gcGeneral` ← `[grandTotal,
  supervisionSubtotal]`. Links tab traverses the full GC tree.
- **Approval gates:** none.
- **Exit:** GC depends-on/used-by complete to leaf · echo === engine per node · structural
  completeness test (every GC engine value has a node; no orphan edges) · goldens tie ·
  `npm run test` green · `tsc` clean · committed · handoff.

### Phase 4 — Site-Ops internal decomposition tier (reaches the complete picture)
- **Scope:** Extend `describeEngineGraph` with Site-Ops nodes to leaf: `grandTotal` ←
  `[dynamicTotal, manualTotal]`; sections ← member line totals; each line total (echo) ←
  `[qty, rate]`, handling the 3 entry types (qty / qtyRate / lumpSum). With Phase 1+3+4, all
  ~240 relationships are now inspectable.
- **Approval gates:** none.
- **Exit:** full-coverage structural test (every engine value has a node; echo === engine;
  reverse-edges complete; no orphans — honoring the v1 registry-completeness invariant) · goldens
  tie · unit + e2e · **manual /verify** · `npm run test` green · `tsc` clean · committed · handoff.

### Phase 5 — Division rollups, completeness affordances & perf
- **Scope:** `division:<NN>:total` rollup nodes; any stragglers (equipment subtotal, etc.); a
  "complete picture" affordance (e.g. Links tab cross-page path trail); optional per-cell badges
  on the GC/Site-Ops pages; **performance check at full node count**; doc the coverage map.
- **Approval gates:** none.
- **Exit:** complete coverage verified by test · Links-tab open at full graph size is acceptably
  fast · goldens tie · `npm run test` green · `tsc` clean · committed · handoff (workstream close).

### Future (NOT built — the editability arc)
- **Future Phase 6 — Formula-engine dependency investigation + editable design (DISCOVERY/gate).**
  Investigate whether **HyperFormula** is the right long-term dependency vs alternatives (a
  constrained internal expression evaluator, formula.js, mathjs, …) against this app's needs
  (auditability, bundle/licence, the kind-blind graph). Design how echo nodes become *editable*
  expression bindings. **Decide before any build** — architect approves the engine choice.
- **Future Phase 7 — Editable migration build** (gated on Phase 6): implement the chosen
  expression kind; let estimators re-author the relationships. *Hooks preserved from day one:*
  open `kind` enum, compiler isolation, by-ID/predicate references, the echo descriptor as the
  read-only fallback.

---

## 6. Risks & unknowns
- **Echo staleness (Phase 1+).** Echo captures the engine value at build time; the descriptor
  must recompute in lockstep with `computeTakeoffSummary` (same memo inputs) or the Links tab
  could show a stale number. *Mitigation:* derive `describeEngineGraph` from the same memoized
  inputs the summary uses; a test asserts echo === live engine.
- **Edge-authoring drift (Phase 3–4, the main risk).** Edges are hand-authored from the engine's
  structure; if the engine gains a line/driver and the descriptor isn't updated, the graph lies.
  *Mitigation:* a **structural completeness test** — assert the descriptor's node set exactly
  matches the engine's produced-value set (the analog of v1's registry-completeness invariant).
  This is the load-bearing guard for bucket B.
- **Graph size / perf (Phase 5).** ~240 nodes + edges evaluated on Links-tab open. Expected fine;
  verified in Phase 5; if not, the kind-blind graph supports lazy/subgraph evaluation later.
- **Collision with future user bindings.** A user binding targeting a `summary:*` node should
  shadow the engine node. *Mitigation:* the precedence rule (user > engine > source); the Links
  tab shows such a node as bound.
- **Scope creep into editability.** Keep Phases 1–5 strictly read-only/echo; no "edit" affordances
  leak in early.

---

## 7. Recommended first slice
**Phase 1, narrowed:** `describeEngineGraph` emitting just `summary:subtotal`,
`summary:takeoffSubtotal`, `summary:linkedDivisionsTotal`, and one modifier (e.g.
`summary:fee`), each echoing `computeTakeoffSummary` with authored edges — plus a unit test that
the echoed values equal the engine to the cent and the edges are correct. Zero UI, zero DB, zero
golden movement. Proves the echo-descriptor model end to end before scaling it across the engine.

---

## 8. Phase 1 kickoff prompt (paste into a fresh session)
> **Branch first (LD-B6):** create/switch to `linked-values-bucket-b`. Base it off `main` if v1
> (`linked-values-system`) has been merged; otherwise branch it off `linked-values-system` so v1's
> `src/lib/bindings/` code is present. Do not work on `main` directly. Confirm this plan file is
> present on the branch.
>
> Implement **Phase 1 of Linked Values Bucket B (Engine Graph Exposure)**, per
> `docs/plans/2026-06-15-linked-values-bucket-b-engine-exposure.md` (read it first — §2 design,
> §5 Phase 1). Scope: create `src/lib/bindings/engineGraph.ts` with a pure
> `describeEngineGraph(gc, siteOps, rows, summary, tier)` that emits the Tier-1 `summary:*` nodes
> (takeoffSubtotal, linkedDivisionsTotal, subtotal, the 7 modifiers, totalEstimatedCost, costPerSf,
> costPerUnit) as read-only GraphNodes whose `evaluate` **ECHOES** the value from the passed
> `TakeoffSummary` (NEVER re-implements the math) and whose `inputs` declare the real edges. Add
> the `summary:<field>` node-ID convention to `types.ts`. Honor LD-B2 (echo only), LD-B4 (no DB, no
> financial writes, no export change), LD-B5 (graph stays kind-blind; reuse canonical node IDs).
> Write exhaustive unit tests: echoed value === computeTakeoffSummary to the cent across fixtures
> (including an override fixture), edge structure correct, no cycles. Do NOT wire anything into the
> pages, the grid, the Links tab, or the DB yet — goldens must stay untouched. Exit when
> `npm run test` is green, `npx tsc --noEmit` is clean, committed (message via `git commit -F
> <tempfile>`), and a Phase 2 handoff is written via /handoff. **Stop at the Phase 1 boundary.**
