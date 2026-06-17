# Linked Values - Bucket B - Phase 5 kickoff (paste into a fresh session)

> Cold-start prompt. No assumed context. Read the plan and the named files before any code.
> Phase 5 is the **workstream-closing** phase: division rollups, completeness affordances,
> and a performance check at the full node count.

## Where Phase 4 left off
Phase 4 (Site-Ops internal decomposition tier) is **DONE, tested green, and committed** on
branch `linked-values-bucket-b-p3`. The single Phase 4 commit:
- `7aecae7` - **feat(linked-values): Bucket B Phase 4 - Site-Ops internal decomposition tier.**

Phase 4 extended the pure echo descriptor (`src/lib/bindings/engineGraph.ts`) with a
`"siteOps"` tier emitting the full STEP 3 Site Operations tree as read-only `GraphNode`s:
- `siteops:grandTotal` <- the two group subtotals (`siteops:dynamicSubtotal` /
  `siteops:manualSubtotal`) - the engine's literal `grandTotal = dynamicTotal + manualTotal`
  decomposition; each subtotal <- its group's leaf line totals; each leaf `total` <-
  `[qty, rate]`. The `[qty, rate]` leaf edge is UNIFORM across dynamic + all 3 manual entry
  types (`qty` / `qtyRate` / `lumpSum`) because the engine sets `qty`/`rate` so that
  `total = qty x rate` always holds (lumpSum: `qty = value>0?1:0`, `rate = value`). So
  Site-Ops, unlike GC's lump-sum equipment, has **NO total-only leaves**.
- The 8 canonical `siteops:<section>` subtotals are a CROSS-CUTTING re-grouping (by
  `cfg.section`, spanning dynamic + manual) - the Site-Ops analog of GC's
  `supervisionSubtotal`. Each `siteops:<section>` <- the leaf totals of its member lines
  (REUSING the same leaf `total` ids - no duplicate leaves). They reuse the canonical
  `siteops:<section>` ids (LD-B5), so the engine section nodes shadow the bare section
  constants at the `assembleBindingGraphNodes` seam (engine > source).
- Every node ECHOES `SiteOpsCalcResult` (LD-B2 - never re-derives the math).

Key structural moves Phase 4 made (mirroring Phase 3's `gc:*` IDs - Phase 5 keeps these):
- **Node-ID scheme lives in `types.ts`** (the kind-blind leaf module). To avoid a
  `registry -> engineGraph -> registry` import cycle, `siteOpsSectionNodeId` MOVED into
  `types.ts` (param loosened to `string`, no app import) and `registry.ts` **re-exports** it;
  new IDs added there too: `SITEOPS_NODE_PREFIX`, `SITEOPS_GRAND_TOTAL_NODE_ID`,
  `SiteOpsLineGroup`, `siteOpsSubtotalNodeId`, `SiteOpsLeafField`, `siteOpsLeafNodeId`.
- **`EngineGraphTier`** is now `"summary" | "gc" | "siteOps"`; **`ALL_ENGINE_TIERS`** =
  `["summary", "gc", "siteOps"]` (the seam default `assembleBindingGraphNodes` requests, so
  the Links tab shows the COMPLETE wiring). A new tier lights up by adding its branch.
- **`describeSourceNode` (registry.ts)** gained friendly Site-Ops aggregate/leaf labels.
- **Precedence at the seam:** engine `siteops:<section>` nodes outrank the bare
  `siteops:<section>` source constants (engine > source). Phase 4 added that precedence test.

Status at handoff: **suite 1023 pass / 85 files** (`npm run test`), `npx tsc --noEmit` clean,
the three export goldens (McKenna / synthetic / CARE) tie **$0.00**, eslint adds NO new
warnings (the repo carries ~50 PRE-EXISTING lint problems in files this phase did not touch;
all 7 touched files lint clean - confirmed with `npx eslint <files>` exit 0). The diff was
reviewed (no correctness findings). **NOT pushed, no PR.**

New/changed tests in Phase 4 (all green):
- `src/lib/__tests__/bindingEngineGraph.test.ts` - siteOps echo/edge/acyclicity/e2e across
  two fixtures (populated + a varied fixture exercising all 3 manual entry types).
- `src/lib/__tests__/bindingEngineGraphSiteOpsStructure.test.ts` (NEW) - the **structural-
  completeness guard**: descriptor Site-Ops node set == engine produced-value set; every
  aggregate == sum of its declared inputs; grandTotal == Sum(all leaves) == Sum(8 section
  subtotals) == `siteOps.grandTotal`; echo === engine; no orphan edges.
- `src/lib/__tests__/bindingEngineGraphWiring.test.ts` - engine-`siteops:<section>`-wins
  precedence test.
- `src/lib/__tests__/bindingLinksEngine.test.ts` - Links-tab Site-Ops traversal via
  `buildLinksModel`.

**With Phases 1 + 3 + 4 the summary + GC + Site-Ops tiers are all visible.** Phase 5 closes
the remaining gaps (division rollups + stragglers), adds the "complete picture" affordance,
and verifies performance at the full node count.

## Read first
1. `docs/plans/2026-06-15-linked-values-bucket-b-engine-exposure.md` - the plan of record.
   Focus on **section 5 Phase 5**, **section 1.1** (the ~240-relationship classification -
   the coverage target), and **section 6** (the perf risk + the structural-completeness test).
2. `src/lib/bindings/engineGraph.ts` - the descriptor you EXTEND (it now emits `"summary"` +
   `"gc"` + `"siteOps"`). Study `describeSiteOpsNodes` / `describeGcNodes` as the template for
   any new `"division"` tier. The signature is stable.
3. `src/lib/bindings/registry.ts` - `assembleBindingGraphNodes` (the seam + the engine>source
   precedence + the INERT-empty fast path that keeps goldens $0.00), `userBindingSourceNodes`
   (the bare source set the engine tiers shadow), `lineFieldSourceNodes` / `lineFieldNodeId`
   (the `line:<id>:<field>` source nodes a division rollup would aggregate), `describeSourceNode`
   (where a `division:*` label would go).
4. `src/lib/division.ts` - `getDivisionCode(itemId)` (the AGENTS.md-mandated 2-digit CSI
   extraction). A `division:<NN>:total` rollup must use this to group lines - never inline regex.
5. `src/lib/calculations.ts` - `computeTakeoffSummary` / `TakeoffSummary` (the summary tier's
   authority; check whether any summary value is still un-noded). `PersonnelCalcResult` /
   `SiteOpsCalcResult` (already fully noded by Phases 3/4 - audit for any straggler).
6. `src/lib/trustInspector.ts` - `buildLinksModel` (opts into `includeEngineGraph` + the
   supplied `summary`; the Links-tab traversal). `focusFieldToNodeId` (the Trace-field ->
   node-id mapping a per-cell badge would dispatch via `tb:inspect-binding`).
7. The v1/Bucket-B context in memory: `[[linked-values-system-plan]]` and
   `[[linked-values-bucket-b-plan]]`.

## Phase 5 - Division rollups, completeness affordances & perf (workstream close)
**Scope (from section 5 Phase 5):**
- **`division:<NN>:total` rollup nodes.** STEP 4 line totals grouped by 2-digit CSI division
  (via `getDivisionCode`). The natural Phase-5 form, mirroring the Site-Ops section
  re-grouping: an echo node per present division edged to the `line:<id>:total` nodes of its
  member lines (REUSE the existing line source ids - do NOT mint duplicate leaves). Decide +
  document the value source (echo the Sum of member `line:<id>:total`s) and the ID scheme
  (`division:<NN>:total`, add to `types.ts`). Add a `"division"` tier + `ALL_ENGINE_TIERS`
  entry + switch branch. NOTE: division rollups read STEP 4 `rows`/`lines` (not gc/siteOps) -
  the `rows` arg of `describeEngineGraph` is already in the signature for exactly this.
- **Stragglers.** Audit section 1.1's ~240 relationships against what's now noded
  (summary + gc + siteOps). Add any remaining engine value that lacks a node (e.g. confirm
  the GC equipment subtotal, any summary field, any cross-page edge). The coverage map doc
  is the deliverable that proves completeness.
- **Per-cell GC/Site-Ops Links entry point (REQUIRED this phase).** A badge/affordance on the
  GC (STEP 2) and Site-Ops (STEP 3) pages that opens the Trust Inspector Links tab focused on
  that cell's engine node (`gc:*` / `siteops:*`). **Architect decision (2026-06-16): the Phase 4
  visual spot-check was deliberately HELD to Phase 5 because no such entry point exists yet** -
  today `tb:inspect-binding` only carries a `rowId` -> `line:<id>:total` and the summary
  affordance only reaches `summary:<field>`; NO UI path focuses a `gc:*`/`siteops:*` node, and
  Links-tab dependency rows only re-focus to grid rows. So this badge is what finally makes the
  manual /verify possible. Reuse the existing pattern (dispatch a focus event that the
  `EstimateTable` listener maps to a node id; extend it to accept a raw node id, not just a
  rowId). **Add ONE Playwright e2e** clicking a Site-Ops value and asserting the Links tab shows
  its depends-on/used-by. (Consider also a "complete picture" Links-tab path trail line -> division
  -> summary, but the per-cell entry point is the must-have.)
- **Performance check at the full node count.** ~240 nodes + edges evaluated on Links-tab
  open. Expected fine; verify (a test or a measured note). If not, the kind-blind graph
  supports lazy/subgraph evaluation later - note it, don't pre-optimize.
- **Coverage map doc.** Document which engine relationships are noded by which tier (the
  completeness ledger that closes the workstream).

**The load-bearing guard (section 6):** extend the structural-completeness pattern to the
division tier - a `bindingEngineGraphDivisionStructure.test.ts` (analog of the GC/Site-Ops
structure tests): every present division has a `division:<NN>:total` node; each == Sum of its
member `line:<id>:total`s; no orphan edges; echo === the grouped Sum. Plus a coverage test
that asserts the descriptor covers the section-1.1 relationship set (the "no straggler" catch).

**Smallest slice:** `division:<NN>:total` for one division echoing the Sum of its member line
totals with authored edges, plus a test that the echo equals the grouped Sum to the cent and
that it folds in at the seam without a duplicate id.

**Approval gates:** none (no DDL, no financial writes, no export change - LD-B4). **If a UI
affordance (per-cell badge / path trail) is added, it is display-only** and must not touch
the export path - keep the engine fold default-OFF on grid/recompute/export.

## Hard constraints (carry forward)
- **LD-B2:** echo only - never re-derive engine math in the descriptor.
- **LD-B4:** no DB, no financial writes, no export change. **Both/all goldens must tie $0.00**
  (the engine fold stays default-OFF on the grid/recompute/export path; only the Links tab
  opts in via `includeEngineGraph` + a supplied `summary`).
- **LD-B5:** graph stays kind-blind; engine nodes are plain `GraphNode`s folded at the
  `assembleBindingGraphNodes` seam via the opt-in flag; reuse canonical node IDs
  (engine > bare source precedence). New `division:<NN>` ids go in `types.ts`.
- **AGENTS.md:** division-code extraction MUST use `getDivisionCode()` from
  `src/lib/division.ts` - never inline `substring`/`split`/regex.

## Exit criteria (Phase 5 - workstream close)
- Division rollup nodes complete + traversable in the Links tab; stragglers closed.
- **Complete coverage verified by test** (the structural-completeness test extended to the
  division tier + the section-1.1 no-straggler coverage test).
- Links-tab open at full graph size is acceptably fast (verified / measured note).
- **All export goldens tie $0.00** (run golden-mckenna / golden-synthetic / golden-care).
- Unit tests + (ONLY if a UI affordance is added) one Playwright e2e + a **manual /verify**
  (the architect spot-checks the Links tab / the new affordance).
- `npm run test` green - `npx tsc --noEmit` clean - eslint clean on touched files (no NEW
  warnings; the repo's pre-existing lint problems are out of scope).
- Review the diff (`/code-review`), resolve findings.
- Commit (multi-line message via `git commit -F <tempfile>` - CLAUDE.md rule).
- Write the **workstream-close** doc (coverage map + what shipped across Phases 1-5; note the
  FUTURE editability arc - Phase 6 formula-engine investigation / Phase 7 editable migration -
  is NOT built, hooks preserved). Then **STOP** - the inspection-only workstream is complete.

## Branch hygiene
- Phases **3 + 4 are the merge PAIR** (branch `linked-values-bucket-b-p3`), mirroring the
  P1+P2 cadence ("review/merge each phase pair; no stacking"). The architect reviews/merges
  the 3+4 pair to `main` BEFORE Phase 5.
- **Phase 5 starts on a FRESH branch off `main`** (e.g. `linked-values-bucket-b-p5`) AFTER the
  3+4 pair lands on `main`. Do **not** stack Phase 5 on `linked-values-bucket-b-p3`. (Phase 5
  is the final, solo phase - it merges on its own once green.)
- If the architect has NOT yet merged 3+4 when Phase 5 starts, branch Phase 5 off
  `linked-values-bucket-b-p3` instead and rebase later - but the default is off `main`.
- Do **not** push or open a PR unless the architect asks.

## Environment note (carry forward)
- This is a Windows machine: use the PowerShell tool for shell commands; no emoji in PS
  scripts; commit messages via a temp file + `git commit -F`. `Edit`/`Write` worked normally
  in the Phase 4 session. (One Bash call was used for a read-only `git diff` review; prefer
  PowerShell per CLAUDE.md.)
