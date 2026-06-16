# Linked Values System — Phase 4 Kickoff (paste into a fresh session)

_Handoff written 2026-06-15. Phase 3 is complete; this sequences Phase 4._

> **No DDL gate in Phase 4** (the `estimate_bindings` table already exists, applied live in
> Phase 3). Phase 4 also adds **no export behavior** — the tie-out goldens MUST stay $0.00.
> Approval gates: none. But Phase 4 has two NEW verification requirements the earlier
> phases did not: a **Playwright end-to-end test** and a **manual `/verify` pass** driving
> the real app.

---

## Where Phase 3 left off (one line)

The `estimate_bindings` table is live (mutable, tenant-scoped RLS, recompute-from-source on
load), the `db.ts` gateway can persist/load/delete bindings, and the engine can recompute a
persisted binding to the same value — committed on branch **`linked-values-system`**
(`c2d907f`); **goldens still tie $0.00** with no bindings present; **no UI, no grid display
yet.**

## Branch (LD-5) — do this first

```
git switch linked-values-system
```

Do **NOT** work on `main`. Phase 3 (`c2d907f`) sits on top of Phase 2 (`91a101c`), Phase 1
(`4ced34d`), and the plan-of-record commit — it is the current HEAD of the workstream branch.

> Note: the branch working tree carries **unrelated** pre-existing WIP (`CLAUDE.md`,
> `src/app/cost-codes/page.tsx`, several `docs/plans/*` and `docs/handoffs/*` moves,
> `COMMIT_MSG.txt`, `review.diff`). It is NOT part of Linked Values — leave it alone and never
> `git add -A`; stage only the files you create or modify for Phase 4.

## What Phase 3 built (the surface Phase 4 plugs into)

- **`estimate_bindings` table** (canonical def: `supabase_schema.sql` Table 19; migration record:
  `supabase_migration_estimate_bindings.sql`). MUTABLE (LD-3): `UNIQUE (project_id,
  target_node_id)`, `kind` free-TEXT/no-CHECK (open enum), `definition` JSONB = `{ basis, rule }`,
  single `FOR ALL` tenant policy (mirrors `estimate_line_items`), `updated_at` touch trigger.
  Applied live to `nefvkrhbbkiqnpeabyqz`; RLS verified; no new advisor findings.
- **`src/lib/db.ts` gateway** (all DB access routes here — AGENTS.md single gateway):
  - `getEstimateBindings(projectId): EstimateBindingRecord[]` — reads, reconstructs a full
    `Binding`, ordered by `target_node_id`.
  - `saveEstimateBinding(projectId, binding)` — upsert on `(project_id, target_node_id)`,
    stamps `created_by` from session. **Written SEPARATELY from the atomic `save_estimate`
    line-item RPC**, so a binding survives the line-item DELETE+INSERT.
  - `deleteEstimateBinding(projectId, targetNodeId)` — idempotent delete.
- **`src/lib/bindings/types.ts`**: `StoredBindingDefinition` (`{ basis, rule }` — the JSONB shape)
  and `EstimateBindingRecord` (reconstructed `Binding` + audit metadata).
- **`src/lib/bindings/recompute.ts`**: `recomputeBindingValues(bindings, sourceNodes, lines)` —
  the recompute-on-load entry point: compiles persisted bindings (`compileBindingToNode`) onto
  the supplied source nodes and `evaluateGraph`s the whole graph. **Stored values are never
  trusted — always recomputed from source.** INERT when `bindings` is empty (returns just the
  source values → goldens tie).
- **`src/lib/__tests__/estimateBindingsDb.test.ts`** (11 tests): gateway upsert/get/delete
  (mutable surface), round-trip → recompute-on-load (lookup + rollup), inert-when-empty.
- The Phase 2 surface is **untouched**: `computeLinkedDivisionTotalsViaEngine` /
  `computeImportedLinkedDivisionTotalsViaEngine` (registry.ts) and the page's
  `linkedDivisionTotals` path still drive the existing 10 linked rows exactly as before.

> **Phase 3 deliberately did NOT mount a loader hook into the page** (no display consumer
> existed yet). Phase 4 builds the hook **and** its grid display together — see Scope below.

## Read before any code

1. **Plan of record:** `docs/plans/2026-06-15-linked-values-system.md` — **§5 Phase 4** (scope +
   exit criteria), **§1.5** (grid layer: `isCellHardLocked`, `RowProvenanceGlyph`, the 🔗 badge,
   the override ⚑ flag — the per-cell decoration precedents to reuse), **§2.7** (recompute model),
   and **§6** (row-id stability — the decision Phase 4 must make; see Carry-forward below).
2. **AGENTS.md → Structural Manipulation Grid Parameters** — the **command-history rule**:
   every state mutation MUST call `commandHistory.pushCommand()` with a `WorkbookCommand`
   carrying enough inverse data for full undo/redo (`src/hooks/useCommandHistory.ts`). New
   commands `SET_BINDING` / `CLEAR_BINDING` must follow this.
3. **The Phase 3 surface above**, plus `src/hooks/useEstimateOverrides.ts` (the load-on-mount
   hook to mirror for `useEstimateBindings`) and `src/hooks/useTakeoffWorkbook.tsx` (the
   `linkedTotalByItemId` memo + the column helpers / `isCellHardLocked` gate).

## Phase 4 — Bindings in the grid: display + lifecycle plumbing (no authoring UI yet)

**Goal:** a persisted binding shows in the grid as a **read-only derived cell** with a
depends-on badge, recomputes live when its sources change, and can be created/cleared
**undoably** — all driven through the command-history + `db.ts` gateway. **No authoring panel
yet** (that's Phase 5); a dev/test path to create a binding is enough to exercise the plumbing.

### Scope (from the plan of record §5 Phase 4)

- **`useEstimateBindings(projectId, isLoaded)` hook** — mirror `useEstimateOverrides`: load the
  project's bindings at mount, expose `bindings: Binding[]` (+ `records` + `refresh`), fall back
  to `[]` on read failure. **Mount it in `page.tsx`.**
- **Recompute-on-load wired into the live recompute** — build the app source nodes
  (`gcSiteOpsSourceNodes` + `lineFieldSourceNodes` from `registry.ts`; consider adding a
  `buildSourceNodes(gc, siteOps, lines)` helper) and feed loaded bindings through
  `recomputeBindingValues`. Surface the recomputed values into the grid display (e.g. fold a
  persisted binding that targets `line:<id>:total` into `useTakeoffWorkbook`'s
  `linkedTotalByItemId`). **Inert when no bindings exist → goldens tie.**
- **Read-only bound cells** — reuse the existing `isCellHardLocked` gate so a bound cell is
  read-only, with a depends-on **binding badge** (reuse the 🔗 / glyph precedent).
- **`SET_BINDING` / `CLEAR_BINDING` command-history commands** — create/clear a binding is a
  single undoable command, wired through `db.ts` (`saveEstimateBinding` / `deleteEstimateBinding`),
  capturing inverse data (prev/next binding) for full undo/redo fidelity (AGENTS.md).
- **A dev/test path** to create a binding (not a polished panel) to exercise create → recompute →
  clear end-to-end.

### Approval gates

None (no DDL — table already live; no export change). Standard plan-table + 5-step verification
before code (AGENTS.md Execution Boundary).

### Decisions Phase 4 MUST make (carry-forward from Phase 3 / §6)

- **Row-id stability (§6 — the explicit Phase 4 decision).** Saved rows have stable DB UUIDs, but
  freshly-parsed CSV-import rows use `row-${index}` (`parser.ts`) — unstable across re-parse.
  A `line:<id>:total` lookup/`explicitIds` rollup bound to an unstable id breaks on re-parse.
  **Decide:** gate binding authoring to **saved** estimates (ids stabilized), and/or prefer
  rule-based rollups (immune to id churn). Rule-based rollups reference no specific id.
- **Collision precedence.** When a persisted binding targets a node already produced by the 10
  hardcoded linked rows (or a source node), `buildGraph` throws on a duplicate id. Define
  precedence (persisted binding wins / is rejected / is skipped) when folding persisted bindings
  into the existing graph — Phase 3 left this to Phase 4 because no display consumer existed.
- **`created_by` semantics (low-severity, from the Phase 3 code review).** `saveEstimateBinding`'s
  upsert overwrites `created_by` on a re-save (UPDATE), so it drifts from "creator" to "last
  writer." If audit attribution matters, split into `created_by` (preserve) + `updated_by`, or
  don't include `created_by` in the UPDATE path of the upsert.

### Exit criteria

- A persisted binding shows as a **read-only derived cell with a badge**; `SET_BINDING` is
  **undoable** (create/clear atomic).
- Bound cells **recompute live** when their sources change.
- **Goldens tie $0.00** (no bindings present).
- **A Playwright end-to-end test** exercises create → recompute → clear.
- **Manual verify: drive the real app via the `/verify` skill.**
- `npm run test` green · `npx tsc --noEmit` clean · `npx eslint <changed files>` clean (no new
  warnings).
- `/code-review` run, findings resolved.
- Committed on `linked-values-system` (multi-line message via `git commit -F <tempfile>`;
  stage only Phase 4 files — never `git add -A`).
- A Phase 5 handoff doc written via the `/handoff` skill.

**STOP at the Phase 4 boundary — do not start Phase 5 (authoring UI + the Trust "Links" tab).**

---

## Process reminders (AGENTS.md / CLAUDE.md)

- Present the implementation plan table + run the SKILL.md 5-step verification, and **wait for
  explicit approval** before writing code (Execution Boundary).
- **Database task** — invoke the `supabase:supabase` skill before touching any DB code. No DDL is
  expected in Phase 4; if you find you need schema changes, that is a NEW ⛔ gate (stop and
  present the SQL).
- Keep the graph core **kind-blind** (LD-4) — binding kind appears ONLY in `compileBinding`. The
  new commands + hook + grid wiring must not switch on kind.
- Lead chat responses with a plain-language summary, full technical depth below it.
- Windows: use the **PowerShell** tool; no emoji in scripts; commit via `git commit -F <file>`.
