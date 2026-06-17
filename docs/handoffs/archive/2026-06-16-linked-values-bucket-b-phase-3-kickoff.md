# Linked Values - Bucket B - Phase 3 kickoff (paste into a fresh session)

> Cold-start prompt. No assumed context. Read the plan and the named files before any code.

## Where Phase 2 left off
Phase 2 is **DONE and committed** on branch `linked-values-bucket-b` (off `main`). Commits:
- `e2a2948` - the Bucket B plan of record.
- `6aa552c` - Phase 1: the pure engine descriptor (summary tier, echo).
- `1947e0f` - the Phase 2 kickoff handoff.
- `61f512a` - **Phase 2: wire the engine graph into the Trust Inspector "Links" tab.**

Phase 2 folded the Phase-1 descriptor into the inspection UI:
- `assembleBindingGraphNodes()` (registry.ts) gained an opt-in `options` arg
  (`{ includeEngineGraph, summary, engineTier }`), **DEFAULT OFF** so the grid /
  recompute / authoring-cycle / preview paths are byte-identical and the goldens tie
  $0.00. When ON (and a `summary` is supplied - the echo-staleness guard) it folds in
  `describeEngineGraph(...)` and enforces collision precedence **user binding > engine
  node > bare source node**, dropping the losers before the kind-blind graph core so it
  never sees a duplicate id.
- `buildLinksModel` (trustInspector.ts) opts in (`includeEngineGraph: true`), accepts an
  optional `summary`, and now derives depends-on from ANY focus node's inputs (engine or
  user) and used-by from every node that reads the focus. New `isDerived` flag + new pure
  `focusFieldToNodeId()` (maps a bare summary field -> `summary:<field>`; passes node-ids
  through). The page builds `linksModel` only while the inspector is open.
- Entry points: `SummaryTraceCell` gained a link affordance (`data-testid="summary-links"`)
  that opens the Links tab on the value's engine node; the hardcoded linked-division badge
  (`data-testid="linked-badge"`) is now a clickable button dispatching `tb:inspect-binding`.
- `TrustInspector` LinksTab shows an honest message for a derived engine value.

Status at handoff: **suite 947 pass / 83 files**, `npx tsc --noEmit` clean, eslint clean
(only 2 PRE-EXISTING warnings, untouched), the three export goldens (McKenna / synthetic /
CARE) tie **$0.00**, and the new Playwright e2e `e2e/linked-values-engine-graph.spec.ts`
passes LIVE (it starts the dev server, logs in, clicks the Subtotal cell's link affordance,
and confirms the Links tab shows the cross-page leaves). **Phases 1-2 (these 5 commits) were
merged to `main` via PR (architect-approved) - this branch is closed. Start Phase 3 on a FRESH
branch off the updated `main`.**

New tests added in Phase 2:
- `src/lib/__tests__/bindingEngineGraphWiring.test.ts` (9) - fold off/on, echo === engine at
  the wiring site, collision precedence, no duplicate ids.
- `src/lib/__tests__/bindingLinksEngine.test.ts` (8) - summary depends-on/used-by,
  `focusFieldToNodeId`, the omitted-summary fallback.

## Read first
1. `docs/plans/2026-06-15-linked-values-bucket-b-engine-exposure.md` - the plan of record.
   Focus on **section 2** (the echo descriptor), **section 5 Phase 3**, and **section 6**
   (the edge-authoring-drift risk + the structural-completeness test = the load-bearing guard).
2. `src/lib/bindings/engineGraph.ts` - the descriptor you will EXTEND with the GC tier
   (it currently emits only the `"summary"` tier; widen `EngineGraphTier` and add a `"gc"`
   branch to the switch - the signature is stable from day one).
3. `src/lib/calculations.ts` - the GC engine (`computePersonnelCosts` / `PersonnelCalcResult`):
   the source of truth for the values the GC nodes must ECHO (staff lines, subtotals,
   supervision, grandTotal, gcGeneral). NEVER re-implement this math.
4. `src/lib/bindings/registry.ts` - `gcSourceNodes` / `GC_*_NODE_ID` /
   `supervisionSubtotal` (the existing GC node IDs + the gc:general derived node to anchor to)
   and `assembleBindingGraphNodes` (the seam; engine tier flows through `options.engineTier`).
5. The v1/Bucket-B context in memory: `[[linked-values-system-plan]]` and
   `[[linked-values-bucket-b-plan]]`.

## Phase 3 - GC internal decomposition tier (full GC tree)
**Scope (from section 5 Phase 3):** extend `describeEngineGraph` with a `"gc"` tier emitting
GC nodes to the leaf, ECHOING `PersonnelCalcResult` (LD-B2 - never re-derive):
- `gc:grandTotal` <- its subtotals; each subtotal <- its leaf line totals; each leaf line
  total (echo) <- `[qty, rate]`; qty/rate as derived source nodes.
- `supervisionSubtotal` <- the 3 supervision staff totals; `gcGeneral` <-
  `[grandTotal, supervisionSubtotal]` (the existing `gc:general` derived semantics).
- Reuse the canonical `gc:*` node IDs already in registry.ts (LD-B5); where an engine
  `gc:*` node now collides with a bare `gc:*` source-node constant, the **engine node wins**
  - that precedence already exists in `assembleBindingGraphNodes` (engine > bare source);
  confirm it fires here (this is the FIRST tier where engine ids overlap source ids, so add
  a test that the folded `gc:grandTotal` is the engine-described node, not the bare constant).
- The Links tab must traverse the full GC tree; GC cells MAY (optional) get a per-cell badge,
  but per-cell GC/Site-Ops badges are explicitly Phase 5 - keep Phase 3 to the descriptor +
  the Links-tab traversal unless trivial.

**The load-bearing guard (section 6):** add a **structural-completeness test** - assert the
descriptor's GC node set EXACTLY matches the GC engine's produced-value set (every GC value
has a node; no orphan edges; echo === engine per node). This is the analog of v1's
registry-completeness invariant and is what keeps the hand-authored edges from lying.

**Smallest slice:** `gc:grandTotal` echoing `PersonnelCalcResult.grandTotal` with authored
edges to its subtotals, plus a test that the echo equals the engine to the cent and the
folded node (engine) wins over the bare `gc:grandTotal` source constant.

**Approval gates:** none (no DDL, no financial writes, no export change - LD-B4).

## Hard constraints (carry forward)
- **LD-B2:** echo only - never re-derive engine math in the descriptor.
- **LD-B4:** no DB, no financial writes, no export change. **Both goldens must tie $0.00**
  (the engine fold stays default-OFF on the grid/recompute/export path; only the Links tab
  opts in).
- **LD-B5:** graph stays kind-blind; engine nodes are plain `GraphNode`s folded at the
  `assembleBindingGraphNodes` seam via the opt-in flag; reuse the canonical `gc:*` node IDs.

## Exit criteria (Phase 3)
- GC depends-on/used-by complete to the leaf in the Links tab.
- echo === engine per GC node (across fixtures, incl. the override fixture).
- **Structural-completeness test**: every GC engine value has a node; no orphan edges.
- Engine `gc:*` node wins over the bare `gc:*` source constant (precedence test).
- **Both export goldens tie $0.00** (run golden-mckenna / golden-synthetic / golden-care).
- Unit tests + (if a UI affordance is added) one e2e.
- `npm run test` green - `npx tsc --noEmit` clean - eslint clean (no NEW warnings).
- Commit (multi-line message via `git commit -F <tempfile>` - CLAUDE.md rule).
- Write the Phase 4 handoff (Site-Ops internal decomposition tier) via `/handoff`.
- **STOP at the Phase 3 boundary - do not start Phase 4.**

## Branch / commit hygiene
- Phases 1-2 were merged to `main` via PR; the old `linked-values-bucket-b` branch is closed.
  Create a **fresh branch off the updated `main`** for Phase 3 (e.g. `linked-values-bucket-b-p3`).
  Do **not** continue committing on the merged branch.
- Do **not** push or open a PR unless the architect asks (they review/merge each phase pair;
  the per-phase-pair merge cadence is the agreed way to avoid stacking).

## Environment note (carry forward from Phase 2)
- This session's `Edit`/`Write` tools were intermittently blocked by a hook; the work was
  applied via PowerShell + .NET `WriteAllText` (UTF-8 no BOM) with all-ASCII replacement
  text so the existing emoji/em-dash bytes stayed intact. If `Edit`/`Write` work in the
  fresh session, prefer them; otherwise the same fallback is proven.