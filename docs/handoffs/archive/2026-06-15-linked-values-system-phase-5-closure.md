# Linked Values System — Phase 5 Closure (v1 COMPLETE)

_Closure written 2026-06-15. Phase 5 — the final v1 phase — is implemented, tested, and
committed on `linked-values-system` (`6ac3acf`). The Linked Values System v1 is complete._

---

## One-line status

An estimator can now **author / edit / delete** a `lookup` or a `rollup` from the STEP 4
grid and **inspect any cell's dependencies** in a Trust Inspector **"Links"** tab — the
dev affordance is gone, a cycle is rejected with a clear message, **goldens tie $0.00**,
and **reconciliation still ties**. This closes the v1 scope (spec phases 1–3 → Phases 1–5).

## What Phase 5 shipped (`6ac3acf`)

**Authoring — `DefineLinkPanel.tsx` (new) + `src/lib/bindings/authoring.ts` (new, pure):**
- Right-click an eligible row → **"Define link… / Edit link…"** opens a modal panel.
  - **Lookup**: source-node picker (3 GC computed values + every Site-Ops section + any
    other bindable line's total) + optional **×multiply / +add** transform.
  - **Rollup**: op ∈ sum/count/avg/min/max + a **set-rule builder** (combinator + leaves
    over division/baseCode/suffix/costType/itemId/procoreCode/source). Rule-based is the
    default; **hand-picked `explicitIds` is supported but flagged** (amber warning).
  - **Live result preview** (recomputed from source) + **member count** for rollups.
  - **Conservative cycle rejection** (graph.ts `findCycle`) — the panel shows the offending
    path and **disables Save** before a circular link can be created.
- Emits a `Binding` through the **existing SET_BINDING / CLEAR_BINDING command path**
  (`workbook.commitBinding` / `clearBindingForRow`) — **no second write path** (LD-4).
  Edit = SET_BINDING with the prior binding as `prev`; Delete = CLEAR_BINDING. **Undoable.**
- `authoring.ts` holds all decision logic (picker, builders, set-rule builder, validation,
  `bindingCycle`, `previewBinding`, the `isBindableRow` gate); the panel is the I/O shell.

**Inspection (LD-2) — `trustInspector.ts` + `TrustInspector.tsx`:**
- New **`"links"` `TrustTab`** + pure **`buildLinksModel`**: the focused node's **depends-on
  / used-by** (one hop each), labelled via the shared **`describeSourceNode`**, with
  **click-to-jump** to a line row.
- The per-cell **🔗 badge is now a button** that opens Trust on the Links tab focused on
  that cell — decoupled from the grid cell via a `tb:inspect-binding` window event (the
  same pattern as the header's `toggle-sidebar`), listened for in `EstimateTable`.
- **Trace and Reconcile tabs unaffected** and still tie.

**Engine — `registry.ts`:**
- Factored **`assembleBindingGraphNodes`** (collision precedence resolved here; **INERT when
  empty**) so the **recompute**, the **authoring cycle-guard/preview**, and the **Links view**
  all share ONE kind-blind graph builder. `recomputeLineBindingValues` is now a thin
  `evaluateGraph(assemble(…))`.
- **`userBindingSourceNodes`** widens the source set to **every** Site-Ops section (not just
  the linked-referenced ones) so the picker only offers nodes the engine actually evaluates.
  The golden **`gcSiteOpsSourceNodes` path is untouched** (still narrow → goldens tie).
- **`describeSourceNode`** — the one node labeller shared by the picker and the Links view.

## Decisions locked in Phase 5

1. **`created_by` drift → preserved, NO DDL.** `saveEstimateBinding` now **UPDATEs in place**
   (kind + definition only, never `created_by`) and **INSERTs only on create** (stamping the
   creator). On edit the original author is preserved. Trade-off: the write is two statements
   instead of one atomic upsert (negligible for a single-user tool; the UNIQUE constraint
   still guards integrity). Tenant `FOR ALL` RLS covers the UPDATE's SELECT.
2. **Display-only (no double-count).** A bound cell is a **traceable reference**; its value
   does **NOT** flow into the export subtotal. Every v1 source is already counted, so feeding
   a link into the total would double-count it. `calculations.ts` is **untouched** →
   **goldens tie $0.00, reconciliation still ties**, by construction. (Hook preserved for a
   future "adds genuinely new money" link kind.)
3. **STEP 2/3 addressability ceiling held.** The picker offers only nodes that exist
   (`gc:*`, every `siteops:<section>`, bindable `line:<id>:total`). `summary:*` is **excluded**
   (the recompute graph doesn't build it → it would read 0).

## Exit-criteria status

- ✅ Author + edit + delete a **lookup AND a rollup** from the grid; inspect in the **Links
  tab**; **cycle rejected with a message** — all exercised by the e2e.
- ✅ **Reconciliation still ties**; **goldens tie $0.00** (`golden-mckenna`, `golden-care`).
- ✅ **Playwright e2e** `e2e/linked-values-authoring.spec.ts` (replaces the Phase-4
  dev-affordance spec): author lookup → Links tab → live recompute → edit (×2) → cycle
  reject (Save disabled) → delete → undo → author rollup → delete. **Passes.**
- ✅ `npm run test` **914/80 green** (+24 tests: 15 authoring, 4 Links model, 5 recompute/
  source-node); `npx tsc --noEmit` clean; eslint **no new warnings** (3 pre-existing only).
- ✅ `/code-review` run — **no blocking correctness bugs**; the cross-file contract changes
  all have updated call sites (tsc-verified). Low-severity items accepted/documented below.
- ⚠️ **Manual `/verify`**: the **e2e itself drives the real Next.js app** against live
  Supabase end-to-end (it IS the real-app verification). **Persistence-on-reload was not
  separately confirmed in this environment** — the sandbox aborts/blocks the fire-and-forget
  binding writes (`TypeError: Failed to fetch`, the kickoff's documented benign gotcha #3),
  so the optimistic state carried the whole flow but a reload would not show the row here.
  **Persistence is covered by `estimateBindingsDb.test.ts` (round-trip + recompute-on-load).**
  → **Architect: spot-check reload-persistence in your environment** (author a link, wait a
  beat, reload — the 🔗 badge should return).

## Known limitations (by design, flagged — not bugs)

- **Imported projects:** a lookup into `gc:*` / `siteops:*` reads the **parametric defaults**,
  not the import's frozen GC/Site-Ops (the §6 addressability ceiling + the imported branch).
  Line-to-line lookups and rollups are correct for imports. Display-only, so export/goldens
  are unaffected.
- **Set-rule builder is flat** (a single all/any level). A hand-authored nested rule round-trips
  best-effort on edit (non-leaf children are dropped from the flat view); the builder only
  ever produces flat rules, so authored rules round-trip exactly.

## Future (flagged, NOT built — hooks preserved from day one)

- **Future Phase 6 — Graph hardening (spec phase 4):** incremental dirty-propagation, robust
  cycle diagnostics, performance at scale, optional full node-and-edge graph visualization.
  *Hooks preserved:* stable node IDs, kind-agnostic graph core, recompute-from-source,
  `findCycle` already returns the offending path.
- **Future Phase 7 — Expression bindings (HyperFormula):** add `kind:'expression'` as ONE
  `compileBinding` case delegating to embedded HyperFormula; **zero graph-core changes**.
  *Hooks preserved:* open free-text `kind`, compiler isolation, by-ID/predicate references only.
- **Display-only → summed:** if a future "adds genuinely new money" link is wanted, decide how
  it flows into `computeTakeoffSummary` without double-counting (the deferred decision #2 hook).

## For the next session

The Linked Values workstream is **v1-complete and committed on `linked-values-system`**
(unmerged). Next steps are the architect's call:
- **Merge** `linked-values-system` → `main` (whole workstream: P1 `4ced34d` → P2 `91a101c` →
  P3 `c2d907f` → P4 `13c6db8` → P5 `6ac3acf`), or
- start a **new workstream** (e.g. workstream #3 Actuals cost-history discovery), or
- pick up **Future Phase 6 / 7** when desired.

> The working tree still carries **unrelated pre-existing WIP** (`CLAUDE.md`,
> `src/app/cost-codes/page.tsx`, several `docs/` moves, `COMMIT_MSG.txt`, `review.diff`) —
> NOT part of Linked Values. It was deliberately left unstaged. Leave it alone; never
> `git add -A`.
