# Linked Values System — Phase 5 Kickoff (paste into a fresh session)

_Handoff written 2026-06-15. Phase 4 is complete; this sequences Phase 5 (the final v1 phase)._

> **No DDL gate in Phase 5** (the `estimate_bindings` table already exists, applied live in
> Phase 3). Phase 5 also adds **no export behavior** — the tie-out goldens MUST stay $0.00.
> Phase 5 is the first phase that touches the **Trust Inspector** (a "Links" tab) and adds a
> real **authoring panel**. Verification gates (same as Phase 4): a **Playwright e2e** AND a
> **manual `/verify`** pass driving the real app.

---

## Where Phase 4 left off (one line)

A persisted binding now shows in the STEP 4 grid as a **read-only, 🔗-badged derived cell** that
**recomputes live** from its source and can be **created/cleared undoably** (SET_BINDING /
CLEAR_BINDING) through the `db.ts` gateway — committed on branch **`linked-values-system`**
(`13c6db8`); **goldens still tie $0.00**; persistence-across-reload verified. The only authoring
path so far is a **dev/test context-menu affordance** ("Bind Total (dev)") — Phase 5 replaces it
with the real panel + the Links tab.

## Branch (LD-5) — do this first

```
git switch linked-values-system
```

Do **NOT** work on `main`. Phase 4 (`13c6db8`) sits on top of Phase 3 (`c2d907f`), Phase 2
(`91a101c`), Phase 1 (`4ced34d`), and the plan-of-record commit — current HEAD of the workstream.

> The working tree carries **unrelated** pre-existing WIP (`CLAUDE.md`,
> `src/app/cost-codes/page.tsx`, several `docs/plans/*` and `docs/handoffs/*` moves,
> `COMMIT_MSG.txt`, `review.diff`). It is NOT part of Linked Values — leave it alone and never
> `git add -A`; stage only the files you create or modify for Phase 5.

## What Phase 4 built (the surface Phase 5 plugs into)

- **`src/hooks/useEstimateBindings.ts`** — load hook (mirrors `useEstimateOverrides`), mounted in
  `page.tsx`. Loads the project's bindings on mount; OWNS the in-memory `bindings: Binding[]` +
  exposes `setBindings`, `records: EstimateBindingRecord[]`, `refresh`. Falls back to `[]` on read
  failure. `bindings` + `setBindings` are threaded into `useTakeoffWorkbook`.
- **`src/lib/bindings/registry.ts`** — `recomputeLineBindingValues(bindings, gc, siteOps, rows)`:
  recompute persisted bindings FROM SOURCE for the grid. **INERT when empty** (builds no source
  nodes → goldens tie). Collision precedence resolved here: **reserved linked-division rows win**
  (a user binding on one of the 10 is SKIPPED + logged); **for any other row the binding wins**
  over that line's constant `line:<id>:total` source node (deduped before `buildGraph`, so the
  graph core never sees a duplicate id and stays kind-blind — LD-4). Also
  `describeBindingDependency(binding)` → the badge/tooltip label.
- **`src/lib/bindings/store.ts`** — pure, kind-blind `upsertBinding` / `removeBinding` /
  `findBindingByTarget` over `Binding[]` (one binding per `targetNodeId`). Backs the optimistic
  state and the command inverse.
- **`SET_BINDING` / `CLEAR_BINDING`** commands (`src/types/index.ts` union;
  `src/hooks/useCommandDispatch.ts` forward+inverse). Full prev/next inverse data (AGENTS.md);
  DB writes via `saveEstimateBinding` / `deleteEstimateBinding` are **fire-and-forget +
  fail-soft** (`.catch(console.error)`), so the optimistic in-memory state always drives the UI.
- **Grid wiring (`src/hooks/useTakeoffWorkbook.tsx`)**: `bindingValuesByNodeId` memo;
  `boundRowState` (rowId → {value,label}); `getLinkedRowState` extended to return a bound state
  (`kind: 'binding'`) for non-linked rows carrying a `line:<id>:total` binding (reuses the
  `isCellHardLocked` read-only gate + the 🔗 badge); `createDevBinding(rowId)` /
  `clearBindingForRow(rowId)` (push command + `applyCommandForward`). The **total cell renders
  the value LIVE** (not `info.getValue()`) — see Gotchas.
- **Dev affordance (`ContextMenuPortal.tsx`)**: right-click → "🔗 Bind Total (dev)" / "🔗 Clear
  Binding" (testids `ctx-bind-total` / `ctx-clear-binding`); badge testid `binding-badge`.

> **Decisions Phase 4 locked (plan §6):** (1) **Row-id stability** — rule-based rollups are the
> recommended id-free form; id-bound forms (lookups, `explicitIds`) are gated to **stable-id**
> rows (`createDevBinding` rejects volatile `^row-\d+$` parser ids; template `row-<itemId>` and
> manual `manual-<...>` and saved rows pass). (2) **Collision precedence** — reserved linked rows
> win, else the binding wins. (3) **`created_by` drift** — DEFERRED to Phase 5 (see below).

## Read before any code

1. **Plan of record:** `docs/plans/2026-06-15-linked-values-system.md` — **§5 Phase 5** (scope +
   exit), **§1.5 / LD-2** (the Trust Inspector is the home for the "Links" tab; per-cell
   depends-on / used-by; full graph viz is explicitly OUT of v1), **§2.4** (set-rule grammar for
   the rollup builder — rule-based default, hand-picked `explicitIds` discouraged + flagged),
   **§2.3** (lookup transform capped to ×multiply +add), **§2.6** (conservative cycle guard —
   `findCycle` already exists in `graph.ts`, surface it in the UI).
2. **`src/lib/trustInspector.ts`** + the Trust Inspector slide-over component (find via
   `Grep "TrustTab"` / `openTrust`). Phase 5 adds `"links"` to `TrustTab`, generalizes `openTrust`
   to focus on **any node** (a line cell, not only summary fields), and lets the per-cell badge
   open Trust on the Links tab. **Trace and Reconcile tabs must be unaffected and still tie.**
3. **The Phase 4 surface above** — especially `getLinkedRowState`/`boundRowState` in
   `useTakeoffWorkbook.tsx` (where the badge + read-only state come from) and the
   `createDevBinding`/`clearBindingForRow` creators (the real panel calls the same SET_BINDING /
   CLEAR_BINDING command path — do NOT invent a second write path).
4. **AGENTS.md → Structural Manipulation Grid Parameters** (command-history rule) and the
   **kind-blind constraint (LD-4)** — the authoring UI must build a `Binding` and route it through
   the existing commands; kind knowledge stays only in `compile.ts`.

## Phase 5 — Authoring UI + inspection (LD-2)

**Goal:** an estimator can **author / edit / delete** a `lookup` and a `rollup` from the grid and
**inspect dependencies** in a "Links" tab — replacing the dev affordance with a real panel.

### Scope (from the plan of record §5 Phase 5)

- **Context-menu "Define link…"** → a panel to build either a **lookup** (source-node picker +
  optional ×multiply / +add transform) or a **rollup** (op ∈ sum/count/avg/min/max + a **set-rule
  builder**; rule-based default, hand-picked `explicitIds` supported but **discouraged + flagged**).
  The panel emits a `Binding` and dispatches **SET_BINDING** (reuse the Phase 4 command path /
  `setBindings`); editing an existing binding is a SET_BINDING with the prior binding as `prev`;
  delete is **CLEAR_BINDING**. Replace the dev "Bind Total (dev)" item.
- **"Links" tab in the existing Trust Inspector** — add `"links"` to `TrustTab`; generalize
  `openTrust` to focus on any node; show the focused cell's **depends-on / used-by**, click-to-jump.
  Trace (how a total decomposes) and Links (what one cell depends on / feeds) become two views of
  one graph. **Reconcile is unaffected and must still tie.** No new slide-over shell — reuse the
  Trust Inspector's docked + expand-to-fullscreen chrome.
- **Per-cell badge finalized** — the badge opens Trust on the Links tab (Phase 4 ships the badge
  + `describeBindingDependency` label; Phase 5 wires the click-through).
- **Conservative cycle rejection surfaced in the UI** — `findCycle` (graph.ts) already returns the
  offending path; on create/edit, reject a cycle with a clear message (plan §2.6). Do NOT build
  incremental/robust cycle diagnostics (that is Future Phase 6).

### Decisions Phase 5 should make / carry-forward

- **`created_by` drift (deferred from Phase 4).** `saveEstimateBinding`'s upsert overwrites
  `created_by` on every re-save (UPDATE), so it drifts from "creator" → "last writer". Now that
  authoring + edit land, decide: split into `created_by` (preserve) + `updated_by`, or drop
  `created_by` from the UPDATE path. **If this needs a schema column → that is a NEW ⛔ DDL gate**
  (update `supabase_schema.sql`, present the SQL, get sign-off before applying).
- **STEP 2/3 addressability ceiling (plan §6).** The registry exposes STEP 2/3 *computed* values as
  read-only source nodes; v1 cannot bind to a STEP 2/3 value that is not already a named output, nor
  write back into a STEP 2/3 input. Scope the source-node picker to the nodes that actually exist
  (`gc:*`, `siteops:*`, `line:<id>:<field>`, `summary:<field>`); do not promise finer STEP 2/3
  targets (that pulls "normalize STEP 2/3" forward).
- **Summary/reconcile integration.** Phase 4 is **display-only** — a bound cell's grid total drives
  the cell, NOT the summed subtotal/export. Phase 5 owns the explicit decision of whether (and how) a
  user binding flows into `computeTakeoffSummary` / reconciliation. **Whatever you choose, the export
  tie-out goldens MUST stay $0.00 when no bindings exist, and Reconcile must still tie.**

### Gotchas discovered in Phase 4 (save yourself the debugging)

- **TanStack memoizes accessor results per row.** A binding/linked change is *external* to the row
  object, so `info.getValue()` returns a STALE cached value. Phase 4 fixed the **total** cell by
  rendering the value **live** from `getLinkedRowState(info.row.original)` inside the cell (the
  accessor stays for filter/sort). Any NEW derived column you add (e.g. a Links indicator, or if
  you surface the bound value elsewhere) must compute live in the cell, not via `getValue()`.
- **`info.row.index` is the FILTERED-model position, not the full-array index.** Anything that
  indexes the full `rows` array from a context-menu `rowIndex` is wrong under an active grid filter.
  Phase 4 routes the binding action by **rowId** and passes **`filteredRows`** to `ContextMenuPortal`
  so `currentRow` resolves correctly. Author the panel by rowId, never by a filtered grid index.
- **Fire-and-forget binding writes can log `TypeError: Failed to fetch` when a navigation aborts an
  in-flight write.** This is benign (fail-soft); the optimistic state carries the UI. In an e2e,
  `waitForTimeout(~2-4s)` before reload/navigation to let the write settle if you assert persistence.

### Approval gates

None expected (no DDL; no export change) **unless** the `created_by` decision adds a column — then
it is a ⛔ DDL gate (present the SQL, get sign-off, update `supabase_schema.sql` first).

### Exit criteria

- An estimator can **author + edit + delete** a `lookup` AND a `rollup` from the grid and inspect
  dependencies in the **Links tab**; a cycle attempt is **rejected with a message**.
- **Reconciliation still ties**; **goldens tie $0.00** (no bindings present).
- **A Playwright e2e** exercises authoring + the Links tab.
- **Manual verify: drive the real app (`/verify` skill).**
- `npm run test` green · `npx tsc --noEmit` clean · `npx eslint <changed files>` clean (no new
  warnings).
- `/code-review` run, findings resolved.
- Committed on `linked-values-system` (multi-line message via `git commit -F <tempfile>`; stage only
  Phase 5 files — never `git add -A`).
- A closure/handoff doc written via the `/handoff` skill. **Phase 5 is the last v1 phase** — the doc
  should note the workstream is v1-complete and flag Future Phase 6 (graph hardening) / Phase 7
  (HyperFormula `kind:'expression'`) as NOT-built, hooks preserved.

**STOP at the Phase 5 boundary — do not start Future Phase 6/7.**

---

## Process reminders (AGENTS.md / CLAUDE.md)

- Present the implementation plan table + run the SKILL.md 5-step verification, and **wait for
  explicit approval** before writing code (Execution Boundary).
- **Database task** — invoke the `supabase:supabase` skill before touching any DB code. No DDL is
  expected; if the `created_by` decision needs a column, that is a NEW ⛔ gate (present the SQL).
- Keep the graph core **kind-blind** (LD-4) — binding kind appears ONLY in `compileBinding`. The
  authoring panel builds a `Binding` and routes it through SET_BINDING / CLEAR_BINDING; it must not
  switch on kind anywhere but the compiler.
- Lead chat responses with a plain-language summary, full technical depth below it.
- Windows: use the **PowerShell** tool; no emoji in scripts; commit via `git commit -F <file>`.
