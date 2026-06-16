# Linked Values System — Phase 3 Kickoff (paste into a fresh session)

_Handoff written 2026-06-15. Phase 2 is complete; this sequences Phase 3._

> ⛔ **Phase 3 is the DDL gate.** It creates the `estimate_bindings` table. Do **not**
> apply any schema change before presenting the exact SQL and receiving explicit
> architect sign-off (see "Approval gates" below). Phases 1–2 had no gate; this one does.

---

## Where Phase 2 left off (one line)

The value registry + binding engine now reproduce the app's existing linked-division
behavior **exactly** for both branches, and the live app reads the engine's output as a
drop-in — committed on branch **`linked-values-system`**; **goldens still tie $0.00**, no DB,
no UI, no export change.

## Branch (LD-5) — do this first

```
git switch linked-values-system
```

Do **NOT** work on `main` or on `template-catalog-reconciliation`. Phase 2 sits on top of
Phase 1 (`4ced34d`) and the plan-of-record commit; the Phase 2 commit is the new HEAD of the
workstream branch.

> Note: the branch working tree carries **unrelated** pre-existing WIP (`CLAUDE.md`,
> `src/app/cost-codes/page.tsx`, several `docs/plans/*` and `docs/handoffs/*` moves,
> `COMMIT_MSG.txt`, `review.diff`, `src/lib/bindings/` is now tracked). It is NOT part of
> Linked Values — leave it alone and never `git add -A`; stage only the files you create or
> modify for Phase 3.

## What Phase 2 built (the surface Phase 3 plugs into)

- **`src/lib/bindings/registry.ts` (pure, app-aware bridge — the only bindings module that
  imports app concepts).** Stable node IDs (`gc:supervisionSubtotal`, `gc:grandTotal`,
  `gc:general`, `siteops:<section>`, `line:<id>:total` via `linkedRowTotalNodeId`); source-node
  builders (`gcSiteOpsSourceNodes` — `gc:general` is a **derived** node = grandTotal −
  supervision); the 10 `LINKED_DIVISION_ROWS` as `lookup` bindings (`linkedDivisionBindings`);
  two engine entry points:
  - `computeLinkedDivisionTotalsViaEngine(gc, siteOps)` — APP-BORN (lookups into STEP 2/3).
  - `computeImportedLinkedDivisionTotalsViaEngine(rows)` — IMPORTED (linked nodes are
    **constants from the saved rows**, never STEP 2/3 lookups — the §6 trap).
  Plus `projectLine(row)` and `lineFieldSourceNodes(lines)` — the `line:<id>:{total,unitPrice,
  matchedQty}` source-node groundwork rollups will need (Phase 1 carry-forward note).
- **Two app-born call sites reframed as drop-ins** (numbers unchanged):
  `src/app/projects/[projectId]/page.tsx` (`linkedDivisionTotals` memo, both branches) and
  `src/hooks/useTakeoffWorkbook.tsx` (`linkedTotalByItemId` memo, app-born grid display).
- **`src/lib/__tests__/bindingRegistry.test.ts`** — engine ≡ `computeLinkedDivisionTotals`
  (all 10 rows, multiple fixtures), engine ≡ `linkedTotalsFromRows`, and the §6 proof that the
  imported branch derives **solely** from saved rows and diverges from the app-born lookup.
- The legacy `computeLinkedDivisionTotals` / `linkedTotalsFromRows` are **retained** as the
  equivalence oracles (still tested directly in `calculations.test.ts`); only the pages stopped
  calling them.

## Read before any code

1. **Plan of record:** `docs/plans/2026-06-15-linked-values-system.md` — **§2.8** (persistence
   shape), **§5 Phase 3** (the table DDL + exit criteria), **§3 LD-3** (mutable table, `kind`
   free-TEXT), and **§6** (row-id stability risk — Phase 4 decision, but read it now).
2. **AGENTS.md → Data Persistence Boundaries** — the single gateway (`src/lib/db.ts`), the
   `supabase_schema.sql` source-of-truth rule, and the RLS pattern to mirror.
3. **The Phase 2 surface above** (`src/lib/bindings/registry.ts`).

## Phase 3 — Persistence + load/recompute wiring  ⛔ DDL GATE

**Goal:** persist authored bindings and recompute them on load (stored binding values are never
trusted), so a binding created in code survives a reload and recomputes to the same value —
**with zero golden movement when no bindings are present.**

### Scope (from the plan of record §5 Phase 3)

- **DDL:** new `estimate_bindings` table + tenant-scoped RLS mirroring `estimate_line_items`.
  Update `supabase_schema.sql` **first** and present the exact SQL for sign-off. Proposed shape
  (plan §5): `id uuid PK`, `project_id text NOT NULL REFERENCES projects ON DELETE CASCADE`,
  `target_node_id text NOT NULL`, `kind text NOT NULL` (**free text, OPEN enum — NO CHECK**,
  mirroring `estimate_overrides.field`), `definition jsonb NOT NULL`, `created_by`, `created_at`,
  `updated_at`, `UNIQUE (project_id, target_node_id)`. **Mutable** (UPDATE/DELETE allowed —
  unlike append-only overrides; LD-3).
- **`src/lib/db.ts` gateway funcs:** `getEstimateBindings(projectId)` /
  `saveEstimateBinding(...)` / `deleteEstimateBinding(...)`. All DB access routes through
  `db.ts` (AGENTS.md). Bindings are written **separately** from the atomic `save_estimate`
  line-item RPC, so they survive the line-item DELETE+INSERT.
- **Load + recompute-on-load:** load a project's bindings at mount, compile them
  (`compileBindingToNode`) onto the registry's source nodes, and feed `evaluateGraph` — stored
  binding values are never trusted, always recomputed from source.

### Approval gates

⛔ **DDL** — update `supabase_schema.sql` first and present the exact `CREATE TABLE` + RLS SQL
for explicit sign-off **before** applying it (AGENTS.md Schema Source of Truth). Invoke the
`supabase:supabase` skill before touching any DB code. No other gates.

### Exit criteria

- Round-trip + recompute-on-load test: one binding created in code persists → reloads →
  recomputes to the same value.
- RLS verified (tenant-scoped; mirrors `estimate_line_items`).
- **Goldens tie $0.00 with no bindings present** (the feature is inert until a binding exists).
- `npm run test` green · `npx tsc --noEmit` clean · `npx eslint <changed files>` clean.
- Committed on `linked-values-system` (multi-line message via `git commit -F <tempfile>`).
- A Phase 4 handoff doc written via the `/handoff` skill.

**STOP at the Phase 3 boundary — do not start Phase 4.**

---

## Process reminders (AGENTS.md / CLAUDE.md)

- Present the implementation plan table + run the SKILL.md 5-step verification, and **wait for
  explicit approval** before writing code (Execution Boundary). The DDL needs its own explicit
  sign-off on top of the plan approval.
- Lead chat responses with a plain-language summary, full technical depth below it.
- Windows: use the **PowerShell** tool; no emoji in scripts; commit via `git commit -F <file>`.
- Keep the graph core kind-blind (LD-4) — `kind` appears ONLY in `compileBinding`. The DB layer
  is itself blind to binding kind (`kind` is free text; the rule lives in `definition` JSONB).
