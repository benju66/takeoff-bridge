# Linked Values - Bucket B - Phase 4 kickoff (paste into a fresh session)

> Cold-start prompt. No assumed context. Read the plan and the named files before any code.

## Where Phase 3 left off
Phase 3 (GC internal decomposition tier) is **DONE, tested green, and committed** on branch
`linked-values-bucket-b-p3` (cut fresh off `main` after PR #6 merged Phases 1-2). The single
Phase 3 commit:
- `b729a8d` - **feat(linked-values): Bucket B Phase 3 - GC internal decomposition tier.**

Phase 3 extended the pure echo descriptor (`src/lib/bindings/engineGraph.ts`) with a `"gc"`
tier emitting the full STEP 2 General Conditions tree as read-only `GraphNode`s:
- `gc:grandTotal` <- the four group subtotals (`gc:staffSubtotal` / `gc:opsSubtotal` /
  `gc:equipmentSubtotal` / `gc:manualSubtotal`); each subtotal <- its group's leaf line
  totals; each qty x rate leaf total <- `[qty, rate]` derived source nodes; lump-sum
  equipment leaves are total-only (no qty/rate). `gc:supervisionSubtotal` <- the 3
  supervision staff leaf totals (a re-grouping of staff lines, NOT new leaves);
  `gc:general` <- `[gc:grandTotal, gc:supervisionSubtotal]`.
- Every node ECHOES `PersonnelCalcResult` (LD-B2 - never re-derives the math); the edges are
  hand-authored from the engine structure and drive the depends-on/used-by view.

Key structural moves Phase 3 made that Phase 4 should MIRROR:
- **Node-ID scheme lives in `types.ts`** (the kind-blind leaf module). To avoid a
  `registry -> engineGraph -> registry` import cycle, the three canonical `gc:*` constants
  (`GC_GRAND_TOTAL_NODE_ID` / `GC_SUPERVISION_NODE_ID` / `GC_GENERAL_NODE_ID`) plus the new
  builders (`gcSubtotalNodeId`, `gcLeafNodeId`, `GcSubtotalGroup`, `GcLeafField`) were defined
  in `types.ts`; `registry.ts` **re-exports** the three for its existing import sites.
  **Phase 4 must do the same for Site-Ops** (see below: move `siteOpsSectionNodeId` into
  `types.ts`, add the new Site-Ops IDs there, re-export from `registry.ts`).
- **`describeEngineGraph(gc, siteOps, rows, summary, tier)` now accepts a single tier OR a
  list** (`EngineGraphTier | readonly EngineGraphTier[]`); the switch loops over the
  normalized tiers. `EngineGraphTier = "summary" | "gc"` - **Phase 4 widens it to add
  `"siteOps"` and adds a matching switch branch.**
- **`ALL_ENGINE_TIERS`** (in engineGraph.ts) is the default the inspection seam
  (`assembleBindingGraphNodes`) requests, so the Links tab shows the COMPLETE wiring and each
  new tier lights up automatically. **Phase 4 adds `"siteOps"` to `ALL_ENGINE_TIERS`.**
- **Precedence at the seam:** engine `gc:*` nodes outrank the bare `gc:*` source-node
  constants (engine > source). Phase 3 added the first such precedence test. **Phase 4 must
  add the analog: engine `siteops:<section>` wins over the bare `siteops:<section>` constant.**
- **`describeSourceNode` (registry.ts)** gained friendly labels for the new GC subtotal/leaf
  nodes. Phase 4 adds Site-Ops leaf/subtotal labels the same way.

Status at handoff: **suite 984 pass / 84 files** (`npm run test`), `npx tsc --noEmit` clean,
the three export goldens (McKenna / synthetic / CARE) tie **$0.00**, eslint adds NO new
warnings (the repo carries ~51 PRE-EXISTING lint problems in files this phase did not touch;
all 7 touched files lint clean - confirmed with `npx eslint <files>` exit 0). `/code-review`
on the diff returned no findings. **NOT pushed, no PR** (the architect reviews/merges each
phase pair - see Branch hygiene).

New tests added in Phase 3 (all green):
- `src/lib/__tests__/bindingEngineGraph.test.ts` - GC echo/edge/acyclicity/e2e suites across
  two fixtures (populated + a rate-override fixture).
- `src/lib/__tests__/bindingEngineGraphGcStructure.test.ts` (NEW) - the **structural-
  completeness guard**: descriptor GC node set EXACTLY matches the engine's produced-value
  set; every aggregate = sum of its declared inputs; grand total = sum of ALL leaf totals
  (the real drift catch for an uncovered cost group); echo === engine; no orphan edges.
- `src/lib/__tests__/bindingEngineGraphWiring.test.ts` - the engine-`gc:*`-wins-over-bare-
  source **precedence** test.
- `src/lib/__tests__/bindingLinksEngine.test.ts` - Links-tab GC traversal via `buildLinksModel`
  (`gc:grandTotal` depends-on the 4 subtotals + used-by `gc:general`; a supervision staff leaf
  feeds both its subtotal and supervision; `gc:general` echoes grandTotal - supervision).

## Read first
1. `docs/plans/2026-06-15-linked-values-bucket-b-engine-exposure.md` - the plan of record.
   Focus on **section 2** (the echo descriptor), **section 5 Phase 4**, and **section 6**
   (the edge-authoring-drift risk + the structural-completeness test = the load-bearing guard).
2. `src/lib/bindings/engineGraph.ts` - the descriptor you EXTEND with the `"siteOps"` tier
   (it currently emits `"summary"` + `"gc"`; widen `EngineGraphTier`, add `"siteOps"` to
   `ALL_ENGINE_TIERS`, add a `describeSiteOpsNodes(siteOps)` and a `"siteOps"` switch branch -
   the signature is stable). Study `describeGcNodes` / `describeGcGroup` as the template.
3. `src/lib/calculations.ts` - the Site-Ops engine (`computeSiteOperations` /
   `SiteOpsCalcResult`): the source of truth the Site-Ops nodes must ECHO. NEVER re-implement
   this math. `SiteOpsCalcResult = { dynamicLines, manualLines, grandTotal }`;
   `grandTotal = dynamicTotal + manualTotal`; dynamic lines are `qty x rate`; manual lines
   carry 3 entry types - `qty` (typed qty x template rate), `qtyRate` (typed qty x typed
   rate), `lumpSum` (typed dollar; the engine sets `qty = value>0?1:0`, `rate = value`, so
   `total = qty x rate` STILL holds - a uniform `[qty, rate]` leaf edge is faithful for all
   three, OR treat lumpSum as a total-only leaf; implementer's call, document it).
4. `src/lib/bindings/registry.ts` - `siteOpsSectionNodeId(section)` (the canonical
   `siteops:<section>` IDs), `sectionTotalsByCode(siteOps)` (line code -> section subtotal),
   `allSiteOpsSectionNodes` (the bare source nodes the engine tier will SHADOW), and
   `assembleBindingGraphNodes` (the seam; engine > source precedence already wired). Also
   `SITE_OPS_SECTIONS`, `SITE_OPS_DYNAMIC_DEFAULTS`, `SITE_OPS_MANUAL_DEFAULTS` in
   `src/lib/constants.ts` (the section map + the `cfg.section` each line belongs to).
5. The v1/Bucket-B context in memory: `[[linked-values-system-plan]]` and
   `[[linked-values-bucket-b-plan]]`.

## Phase 4 - Site-Ops internal decomposition tier (reaches the complete picture)
**Scope (from section 5 Phase 4):** extend `describeEngineGraph` with a `"siteOps"` tier
emitting Site-Ops nodes to the leaf, ECHOING `SiteOpsCalcResult` (LD-B2):
- `siteops:grandTotal` <- `[dynamicSubtotal, manualSubtotal]` (the engine's own literal
  `grandTotal = dynamicTotal + manualTotal` decomposition); each <- its group's leaf totals.
- each line total (echo) <- `[qty, rate]` (handle the 3 manual entry types); `qty`/`rate` as
  derived source nodes. (Dynamic lines are always `qty x rate`.)
- The **canonical `siteops:<section>` subtotals** are a CROSS-CUTTING re-grouping (by
  `cfg.section`, spanning dynamic + manual) - the Site-Ops analog of GC's `supervisionSubtotal`
  re-grouping of staff. Each `siteops:<section>` <- the leaf totals of the lines whose section
  is that section (reuse the SAME leaf `total` node ids; do NOT mint duplicate leaves). This
  reuses the existing `siteops:<section>` IDs (LD-B5), so the engine nodes shadow the bare
  section constants at the seam (engine > source).
- **Decide + document the leaf-ID scheme** (mirror `gcLeafNodeId`): e.g.
  `siteops:dynamic:<code>:<field>` / `siteops:manual:<code>:<field>`. Add a new
  `SITEOPS_GRAND_TOTAL_NODE_ID = "siteops:grandTotal"` and the dynamic/manual subtotal IDs to
  `types.ts`. **Move `siteOpsSectionNodeId` (currently in registry.ts) into `types.ts`** (it
  is a pure string fn, no app imports) and re-export from `registry.ts`, so `engineGraph.ts`
  can build section IDs without the import cycle - exactly the Phase 3 pattern for the gc IDs.

**The load-bearing guard (section 6):** add a **structural-completeness test** (a new
`bindingEngineGraphSiteOpsStructure.test.ts`, the analog of the Phase 3 GC structure test):
the descriptor's Site-Ops node set EXACTLY matches the engine's produced-value set (every
dynamic + manual line has total/qty/rate nodes; no spurious; no missing); each aggregate =
sum of its declared inputs; `siteops:grandTotal` = sum of ALL leaf totals = sum of the 8
section subtotals = `siteOps.grandTotal`; echo === engine per node; no orphan edges. This is
what keeps the hand-authored Site-Ops edges from lying.

**Smallest slice:** `siteops:grandTotal` echoing `SiteOpsCalcResult.grandTotal` with authored
edges to the dynamic + manual subtotals, plus a test that the echo equals the engine to the
cent and the folded `siteops:<section>` (engine) wins over the bare `siteops:<section>`
source constant.

**Approval gates:** none (no DDL, no financial writes, no export change - LD-B4).

## Hard constraints (carry forward)
- **LD-B2:** echo only - never re-derive engine math in the descriptor.
- **LD-B4:** no DB, no financial writes, no export change. **Both/all goldens must tie $0.00**
  (the engine fold stays default-OFF on the grid/recompute/export path; only the Links tab
  opts in via `includeEngineGraph` + a supplied `summary`).
- **LD-B5:** graph stays kind-blind; engine nodes are plain `GraphNode`s folded at the
  `assembleBindingGraphNodes` seam via the opt-in flag; reuse the canonical `siteops:<section>`
  node IDs (engine > bare source precedence).

## Exit criteria (Phase 4)
- Site-Ops depends-on/used-by complete to the leaf in the Links tab (via `buildLinksModel`).
- echo === engine per Site-Ops node (across fixtures, incl. a varied-inputs fixture covering
  all 3 manual entry types).
- **Structural-completeness test**: every Site-Ops engine value has a node; aggregates = sum
  of declared inputs; grandTotal = sum of all leaves = sum of section subtotals; no orphans.
- Engine `siteops:<section>` node wins over the bare `siteops:<section>` source constant
  (precedence test).
- **All export goldens tie $0.00** (run golden-mckenna / golden-synthetic / golden-care).
- Unit tests + (ONLY if a UI affordance is added) one e2e. NOTE: per-cell Site-Ops/GC badges
  are explicitly **Phase 5** - keep Phase 4 to the descriptor + the Links-tab traversal, so
  (like Phase 3) NO new e2e is required unless you add an entry point. The plan's Phase 4
  "manual /verify" = the architect spot-checks the Links tab; surface that, don't force a UI.
- `npm run test` green - `npx tsc --noEmit` clean - eslint clean on touched files (no NEW
  warnings; the repo's pre-existing lint problems are out of scope).
- `/code-review` on the diff, resolve findings.
- Commit (multi-line message via `git commit -F <tempfile>` - CLAUDE.md rule).
- Write the Phase 5 handoff (division rollups, completeness affordances & perf - the
  workstream-closing phase) via `/handoff`.
- **STOP at the Phase 4 boundary - do not start Phase 5.**

## Branch hygiene
- **Continue on `linked-values-bucket-b-p3`** (build Phase 4 on top of the Phase 3 commit
  `b729a8d`). Phases 3+4 form the merge PAIR, mirroring the P1+P2 cadence the architect set
  ("review/merge each phase pair; no stacking"). Do **not** cut a new branch for Phase 4.
- Do **not** push or open a PR unless the architect asks. After Phase 4 is green + committed,
  the architect decides whether to merge the 3+4 pair to `main`.

## Environment note (carry forward)
- This is a Windows machine: use the PowerShell tool for shell commands; no emoji in PS
  scripts; commit messages via a temp file + `git commit -F`. `Edit`/`Write` worked normally
  in the Phase 3 session.
