# Linked Values — Bucket B · Phase 2 kickoff (paste into a fresh session)

> Cold-start prompt. No assumed context. Read the plan and the named files before any code.

## Where Phase 1 left off
Phase 1 is **DONE and committed** on branch `linked-values-bucket-b` (branched off `main`
after v1 merged via PR #5). Two commits on the branch:
- `e2a2948` — the Bucket B plan of record (version-controlled onto the branch).
- `6aa552c` — Phase 1: the pure engine descriptor (summary tier, echo).

Phase 1 created `src/lib/bindings/engineGraph.ts` with a pure
`describeEngineGraph(gc, siteOps, rows, summary, tier)` that emits the Tier-1 `summary:*`
nodes (takeoffSubtotal, linkedDivisionsTotal, subtotal, the 7 modifiers, totalEstimatedCost,
costPerSf, costPerUnit). Each node is a read-only `GraphNode` whose `evaluate` **echoes** the
value from the passed `TakeoffSummary` (never re-derives the math) and whose `inputs` declare
the real edges. The `summary:<field>` node-ID convention (`SummaryNodeField`,
`SUMMARY_NODE_PREFIX`, `summaryNodeId`) is formalized in `src/lib/bindings/types.ts`. Tests:
`src/lib/__tests__/bindingEngineGraph.test.ts` (16). **Nothing is wired into any UI/grid/DB
yet** — that is exactly Phase 2's job.

Suite at handoff: **930 pass / 81 files**, `npx tsc --noEmit` clean, eslint clean, both
export goldens untouched (no wiring).

## Read first
1. `docs/plans/2026-06-15-linked-values-bucket-b-engine-exposure.md` — the plan of record.
   Focus on **§1.2–§1.3** (the visibility-vs-expressibility insight + the integration seam),
   **§2** (the echo descriptor), and **§5 Phase 2**.
2. `src/lib/bindings/engineGraph.ts` — the descriptor you will now fold into the graph.
3. `src/lib/bindings/registry.ts` — especially `assembleBindingGraphNodes()` (the single seam),
   `userBindingSourceNodes`, `describeSourceNode`, and the collision-precedence logic.
4. `src/lib/trustInspector.ts` — `buildLinksModel` (around line 464) and the `"links"` TrustTab.
5. The v1 closure context in memory: `[[linked-values-system-plan]]` and
   `[[linked-values-bucket-b-plan]]`.

## Phase 2 — Wire Tier 1 into the inspection UI (Links tab + entry points)
**Scope (from §5 Phase 2):**
- Add an **opt-in `includeEngineGraph`** parameter to `assembleBindingGraphNodes()` —
  **default OFF** so the grid display / recompute path is byte-identical and the goldens
  still tie $0.00. When ON, fold in `describeEngineGraph(...)` nodes.
- **Collision precedence (enforce in the assemble seam):** user binding > engine-described
  node > bare source node. A user binding (or a reserved linked-division node) targeting a
  `summary:*` id must shadow the engine node; drop the colliding engine node before handing
  the list to the kind-blind graph core (it rejects duplicate ids — `GraphError`).
- `buildLinksModel` **opts in** (`includeEngineGraph: true`) so the Trust Inspector "Links"
  tab renders accurate depends-on / used-by for the summary + cross-page nodes. The Links tab
  already labels any node via `describeSourceNode` (which already handles the `summary:` prefix)
  — so ideally **no Links-rendering changes** are needed beyond feeding the nodes in.
- **Entry points:** make the summary cells (`SummaryTraceCell`) and the linked-division cells
  open the Links tab focused on their engine node — extend the existing badge / `tb:inspect-binding`
  event dispatch (the same mechanism v1's badges use). Find these via Grep for `tb:inspect-binding`
  and `SummaryTraceCell`.
- **Reconcile with the Trace tab** (it already decomposes the grand total) — do NOT rebuild it;
  just make sure the new Links view and the existing Trace view don't contradict each other.

**Echo-staleness mitigation (§6, important):** the caller must build `describeEngineGraph` from
the **same memoized inputs** `computeTakeoffSummary` uses, so the Links tab never shows a stale
number. Add/keep a test asserting echo === live engine at the wiring site.

**Smallest slice:** clicking a summary total opens the Links tab showing its real inputs +
dependents.

**Approval gates:** none (no DDL, no financial writes, no export change — LD-B4).

## Hard constraints (carry forward)
- **LD-B2:** echo only — never re-derive engine math in the descriptor.
- **LD-B4:** no DB, no financial writes, no export change. **Both goldens must tie $0.00.**
- **LD-B5:** graph stays kind-blind; engine nodes are plain `GraphNode`s folded at the
  `assembleBindingGraphNodes` seam via the opt-in flag; reuse the canonical node-ID scheme.
- Default the new flag OFF so the **grid display path is unchanged** and the goldens hold.

## Exit criteria (Phase 2)
- Links tab shows accurate depends-on / used-by for summary + cross-page nodes.
- Grid display / recompute path unchanged with the flag off (assert it).
- **Both export goldens tie $0.00.**
- Unit tests (incl. the collision-precedence cases + echo-at-wiring-site) **plus one Playwright
  e2e** (open the Links tab from a summary cell).
- **Manual `/verify`** (run the app, click a summary total, confirm the Links tab).
- `npm run test` green · `npx tsc --noEmit` clean · eslint clean.
- Commit (multi-line message via `git commit -F <tempfile>` — CLAUDE.md rule).
- Write the Phase 3 handoff doc (GC internal decomposition tier) via `/handoff`.
- **STOP at the Phase 2 boundary — do not start Phase 3.**

## Branch / commit hygiene
- Stay on `linked-values-bucket-b`. Do **not** work on `main`.
- Do **not** push or open a PR unless the architect asks — this is the architect's call (they
  spot-check before merge; v1 reload-persistence was unconfirmable in the sandbox, see
  `[[linked-values-system-plan]]` gotcha #3).
