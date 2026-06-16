# Linked Values System — Plan of Record
_2026-06-15 · status: PROPOSED_

> This document is three things at once: (1) a written investigation of the current
> codebase, (2) an **authored spec** for the binding model (no external spec exists —
> it is synthesized here from first principles and grounded in this repo), and (3) a
> phased implementation plan mapped to actual files. **No feature code is written until
> this plan is reviewed.**

---

## 0. Long-term goal (the thing every decision is measured against)

The destination is a web app that **fully replaces the company's Excel estimate
templates** — estimators stop opening Excel. Implications, treated as binding constraints:

- **The estimate is the single source of truth.** The Procore budget import and the
  company Excel template are **generated export views**, not editable stores. Export mints
  a fresh template-shaped `.xlsx` from a versioned skeleton; the app never round-trip-edits
  a spreadsheet file as its store.
- **Structured bindings (lookups + rollups) are the permanent primary layer** — the
  inspectable, can't-silently-break way most of the estimate computes. They are not a
  throwaway stepping-stone.
- **Free-form formulas are a later escape hatch**, added by embedding **HyperFormula** as
  one more binding kind (`kind: 'expression'`) on the *same* graph — never a hand-rolled
  parser.

### The single load-bearing architectural constraint
The dependency graph must stay **indifferent to how each node computes** (`inputs in → value
out`). The graph core must never hardcode "lookup vs rollup." **Binding kind is an open
enum.** This is what makes the eventual formula capability an *additive binding type* rather
than a core rewrite. Preserving it is a hard requirement and a review gate on every phase.

---

## 1. Investigation findings (current codebase)

### 1.1 State architecture — the precondition is NOT met (headline finding)
There is **no single normalized estimate store**. The three pages are three separate React
state containers:

| Page | State hook | Persisted as |
|---|---|---|
| STEP 4 Estimate | `useTakeoffWorkbook` → `rows: ProcessedTakeoffRow[]` | rows in `estimate_line_items` |
| STEP 2 GCs | `usePersonnelCalculations` → `Record<string, number>` (utilization, equipment, manual, rate overrides) | `project_estimates.gc_utilization` / `gc_equipment_overrides` **JSONB** |
| STEP 3 Site-Ops | `useInfrastructureCalculations` → `quantities` / `rates` Records | `project_estimates.site_ops_quantities` / `site_ops_rates` **JSONB** |

STEP 4 lines are addressable by a **stable `id`**. STEP 2/3 "values" are **not rows** — they
are parametric outputs keyed by config-string (`utilEx`, `qtyKnox`), with no per-value ID.
**This is the central gap** the plan is designed around (see decision LD-1).

### 1.2 Calculation engine — ideal foundation
[`src/lib/calculations.ts`](src/lib/calculations.ts) is **pure** (`inputs → outputs`, no React
entanglement), recomputed via `useMemo`. `computePersonnelCosts`, `computeSiteOperations`,
`computeLinkedDivisionTotals`, `computeTakeoffSummary` are all side-effect-free. It recomputes
*everything* on any change — fine for v1; incremental recompute is a future optimization, not
a blocker.

### 1.3 The existing bridge is a hardcoded prototype of this entire feature
[`computeLinkedDivisionTotals`](src/lib/calculations.ts:241) drives **10 fixed STEP 4 rows**
(`LINKED_DIVISION_ROWS`, ~`src/lib/constants.ts:506`) whose values derive live from STEP 2/3,
rendered **read-only** via `getLinkedRowState` with a 🔗 badge. Each row carries a
`source.kind` discriminator (`gcSupervision | gcGeneral | {section}`). **That is an early,
single-purpose "binding kind" enum.** The work is to *generalize this*, not invent from zero.

### 1.4 Data model
`ProcessedTakeoffRow` ([`src/types/index.ts:21`](src/types/index.ts:21)) has: stable `id`
(DB UUID), `itemId` (cost code `NN-NNNN.NNN`), `procoreCode`, `costType`, `source` provenance,
extensible `customFields` JSONB. **No `basis` field** (authored below). Cost-code groupings:
[`getDivisionCode`](src/lib/division.ts:15) yields only the 2-digit prefix — **no base-code
(`NN-NNNN`) or suffix (`.NNN`) parser exists.** Those small parsers are the real "crosswalk"
groundwork rollup predicates need.

### 1.5 Grid layer
TanStack Table in [`EstimateTable.tsx`](src/components/workspace/EstimateTable.tsx) + column
helpers in `useTakeoffWorkbook`. Read-only/derived cells already have a home: the
`isCellHardLocked` gate already makes linked rows read-only. Per-cell decoration precedent
exists (`RowProvenanceGlyph`, the override ⚑ flag, the 🔗 badge). The **Trust Inspector**
slide-over (tabs: Trace/Reconcile/Flags) is the natural home for a "Links" tab.

### 1.6 Persistence
Single gateway [`db.ts`](src/lib/db.ts); atomic `save_estimate` RPC; `ORDER BY sort_order ASC`;
direct line-item writes forbidden (AGENTS.md). **Recompute-on-load is already the philosophy** —
stored totals are cache-only, recomputed every render via `computeTakeoffSummary`. The spec
principle "stored derived values are cache, recompute from source" is therefore already how the
app thinks. `estimate_overrides` is an append-only audit precedent; notably its `field` column
is **free TEXT (no CHECK) specifically so the set can widen without a migration** — a precedent
we reuse for the open `kind` enum.

### 1.7 Fit & risks (short form; full list in §6)
Supports the design cleanly: pure engine, recompute-on-load, an existing read-only-derived-cell
mechanism, and a literal precedent to generalize. The one place it fights us is the STEP 2/3
state shape (blobs, not addressable rows) — handled by a **value registry** (LD-1) rather than a
rewrite. Nothing forces the graph to know binding kinds, so the long-term goal stays open.

---

## 2. Authored spec — the binding model

### 2.1 Nodes and the kind-agnostic graph
A dependency graph of **nodes**. The graph core knows only:

```ts
interface GraphNode {
  id: string;                                   // stable, by-ID never by-position
  basis: Basis;                                 // unit/dimension of the value (see 2.5)
  inputs: string[];                             // node IDs this node reads
  evaluate: (inputs: Map<string, number>) => number;
}
```

The graph performs: build → **topological sort** → **cycle check** → evaluate in order. **It
never switches on binding kind.** Exactly one module — the **binding compiler** — turns a
stored binding into `{ inputs, evaluate }`:

```ts
compileBinding(binding, ctx) => { inputs: string[]; evaluate: (...) => number }
```

Adding `kind:'expression'` later = **add one case to the compiler** that hands off to
HyperFormula. **Zero graph-core changes.** This is the load-bearing constraint realized in code.

### 2.2 Node ID scheme (stable, by-ID / by-query — never cell position)
- STEP 4 line field: `line:<rowId>:<field>` (e.g. `line:<uuid>:total`, `:unitPrice`, `:matchedQty`)
- STEP 2 computed value: `gc:<key>` (e.g. `gc:supervisionSubtotal`, `gc:grandTotal`)
- STEP 3 computed value: `siteops:<section>` (e.g. `siteops:demolition`, `siteops:grandTotal`)
- STEP 2/3 raw input: `gc:input:<configKey>`, `siteops:input:<configKey>`
- Summary field: `summary:<field>` (e.g. `summary:subtotal`, `summary:fee`)

The existing 10 linked-division rows become **lookup bindings**: target `line:<linkedRowId>:total`
← source `gc:supervisionSubtotal` etc.

### 2.3 Binding kinds (v1)
- **lookup (reference binding):** `{ kind:'lookup', source: nodeId, transform?: { multiply?: number; add?: number } }`.
  Value = `source × multiply + add` (multiply then add). **Scalar transform capped to multiply
  and add only.**
- **rollup (aggregation binding):** `{ kind:'rollup', op, set, field? }` where `op ∈ {sum,count,avg,min,max}`.
  Value = `op` over the chosen field (default `total`) of the lines matched by `set`.

**Operations are capped to the enumerated set** (`sum,count,avg,min,max` for rollups;
`multiply,add` for transforms). The cap is the feature — the compiler rejects anything else.
**No cell-address references and no ranges** exist anywhere; all references are by node ID or by
predicate.

### 2.4 Set rules (rollup membership) — rule-based default, hand-picked discouraged fallback
A SetRule is a JSON predicate over **line attributes only**, from a capped grammar:

```ts
type Leaf = { field: 'itemId'|'division'|'baseCode'|'suffix'|'costType'|'source'|'procoreCode';
              match: 'equals'|'startsWith'|'in'; value: string | string[] };
type SetRule = Leaf | { all: SetRule[] } | { any: SetRule[] } | { explicitIds: string[] };
```

- Rule-based (default): e.g. `{ field:'baseCode', match:'equals', value:'03-0000' }` or
  `{ all: [ {field:'division',match:'equals',value:'03'}, {field:'costType',match:'equals',value:'L'} ] }`.
- `explicitIds` (hand-picked): supported but **discouraged** and flagged — and it is the only
  form vulnerable to row-id churn (see §6). Rule-based rollups are immune to id churn entirely,
  which is the main reason they are the default.

Membership is **derived, never stored** (except `explicitIds`). It is recomputed whenever lines
change.

### 2.5 Basis (authored definition for this app)
A node's **basis** is the unit/dimension its value is measured in, so (a) a rollup never sums
dimensionally incompatible lines and (b) a scalar transform stays meaningful. v1 set:
`'currency' | 'quantity' | 'rate' | 'percent' | 'each'`. v1 rules (kept deliberately light):
- `sum/avg/min/max` require all members share a basis. The default field is `total`, always
  `currency`, so the common case is trivially satisfied.
- `count` is basis-agnostic.
- A lookup inherits its source's basis; `×factor / +offset` preserve basis.

The field and the check are reserved from day one; v1 enforcement is minimal. (Widening basis
rules is future work, not a migration.)

### 2.6 Cycle detection (conservative now, hardened later)
The moment users can author bindings (Phase 5), a **conservative cycle guard** must exist: on
create/edit, DFS over the proposed edges; if the target is reachable from itself, **reject with a
clear message.** This is correctness-first (O(n) per edit is fine at this scale). The *robust*
version — incremental dirty-propagation, rich diagnostics, performance at scale — is **spec
phase 4 hardening, deferred** (Future Phase 6).

### 2.7 Recompute model (v1)
Full recompute, topologically ordered, layered into the existing `useMemo` cycle: a pure
`evaluateGraph(nodes) → Map<nodeId, number>` runs inside the current recompute and injects its
outputs where `computeLinkedDivisionTotals` injects today. **Stored binding values are never
trusted — always recomputed from source on load.** Incremental recompute = Future Phase 6.

### 2.8 Persistence shape
New `estimate_bindings` table. `kind` is **free TEXT, no CHECK** (mirrors `estimate_overrides.field`
precedent) so adding `'expression'` needs **zero schema change** — the open-enum constraint
expressed at the DB layer. The full rule lives in `definition` JSONB; the DB is itself blind to
binding kind. One binding per `(project_id, target_node_id)`. **Mutable** (UPDATE/DELETE allowed,
unlike append-only overrides). Bindings are written separately from the atomic line-item save, so
they survive the DELETE+INSERT.

---

## 3. Locked decisions

- **LD-1 (v1 scope):** Generalize the existing bridge. Build the open binding engine over STEP 4
  lines + a **value registry** that gives STEP 2/3 computed values stable IDs, and fold the
  hardcoded 10 linked-division rows into the new model. **Do not** rewrite STEP 2/3 into line
  rows in v1 (deferred as its own future workstream).
- **LD-2 (inspection UI):** Per-cell depends-on/used-by indicators + a "Links" tab in the existing
  Trust Inspector. Full node-and-edge graph visualization is a **future optional enhancement**, not
  v1.
- **LD-3 (binding storage):** New mutable `estimate_bindings` table (DDL gate), `kind` free-TEXT,
  rule in JSONB.
- **LD-4 (architecture, non-negotiable):** Graph core indifferent to kind; all kind knowledge
  isolated in `compileBinding`; `kind` an open enum; references by ID/predicate only; ops capped.
- **LD-5 (branch strategy):** The whole workstream lives on a dedicated branch `linked-values-system`,
  branched off `main` (it is independent of the in-flight `template-catalog-reconciliation` work).
  Each phase commits onto that branch; merge to `main` when the workstream is complete (or per-phase if
  preferred). Never build phases on `main` or on another workstream's branch. Pre-req before Phase 1:
  the current branch's unrelated uncommitted changes are committed/stashed, and THIS plan file is
  committed so a fresh session can read it on the new branch.

---

## 4. Out of scope / deferred

- **No general formula engine / expression parser** now. No formula bar, no `=A1*B2`. Not scaffolded.
- **No HyperFormula** in v1 (it arrives as `kind:'expression'` in Future Phase 7; if ever built,
  embedded — never hand-rolled).
- **No cell-address references, no ranges** — ever.
- **No rewrite of STEP 2/3 into a normalized line-item store** in v1 (the registry bridges instead).
- **No incremental dirty-propagation / graph hardening** (spec phase 4 → Future Phase 6).
- **No full graph visualization** in v1 (Future Phase 6 option).
- **No new export behavior** — bindings change *how a value is computed*, not the export skeleton;
  the export tie-out goldens must remain $0.00.

---

## 5. Phases (v1 = spec phases 1–3)

> Sizing: each phase completes in one fresh session. Phases 1–3 are pure-lib / plumbing with no
> authoring UI; the feature becomes user-visible in Phases 4–5.

### Phase 1 — Binding primitives (pure lib, no wiring)
- **Scope:** New `src/lib/bindings/`: `types.ts` (`Binding`, open `BindingKind`, `Basis`, `SetRule`,
  `GraphNode`), `graph.ts` (build + topo-sort + **conservative cycle detection** + evaluate;
  kind-blind), `compile.ts` (`compileBinding` for `lookup` + `rollup`; the only kind-aware module),
  `setRule.ts` (capped predicate evaluator). Add `getBaseCode` / `getCodeSuffix` to
  [`src/lib/division.ts`](src/lib/division.ts).
- **Approval gates:** none (no DB, no UI).
- **Smallest shippable slice:** lookup compile + graph evaluate + cycle reject, with unit tests.
- **Exit criteria:** exhaustive unit tests (compile, graph, cycle, setRule, parsers) · existing
  goldens untouched (nothing wired yet) · `npm run test` green · `npx tsc --noEmit` clean ·
  committed · handoff doc.

### Phase 2 — Value registry + reframe the existing bridge (end-to-end proof)
- **Scope:** `src/lib/bindings/registry.ts` (pure: STEP 2/3 calc results + STEP 4 rows + summary →
  source `GraphNode`s with stable IDs). Express the 10 `LINKED_DIVISION_ROWS` as `lookup` bindings
  and prove the engine reproduces [`computeLinkedDivisionTotals`](src/lib/calculations.ts:241)
  **exactly**; route the page's linked-total injection through the engine as a drop-in. Preserve the
  imported-project branch (for `isImported`, linked nodes are **constants from saved rows**, not
  lookups into STEP 2/3 — see §6).
- **Approval gates:** none.
- **Smallest shippable slice:** engine output `===` legacy `computeLinkedDivisionTotals` for one
  fixture, behind the existing call site.
- **Exit criteria:** test asserting engine === legacy for all 10 rows (app-born) AND imported branch
  preserved · **both goldens tie $0.00 — app-born AND an imported-project golden** · `npm run test`
  green · `tsc` clean · committed · handoff.

### Phase 3 — Persistence + load/recompute wiring  ⛔ DDL GATE
- **Scope:** `estimate_bindings` table + RLS; `db.ts` gateway funcs `getEstimateBindings` /
  `saveEstimateBinding` / `deleteEstimateBinding` (mutable); load bindings at mount, feed the engine,
  recompute-on-load (stored binding values never trusted); bindings written separately from the
  atomic line-item save.
- **Approval gates:** ⛔ **DDL** — update `supabase_schema.sql` first and present exact SQL for
  sign-off before applying. Proposed shape:
  ```sql
  CREATE TABLE estimate_bindings (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id    text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    target_node_id text NOT NULL,
    kind          text NOT NULL,            -- free text, OPEN enum (no CHECK; mirrors estimate_overrides.field)
    definition    jsonb NOT NULL,           -- full rule incl. transform/op/set
    created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, target_node_id)
  );
  -- + tenant-scoped RLS mirroring estimate_line_items policies
  ```
- **Smallest shippable slice:** one binding created in code persists → reloads → recomputes to the
  same value.
- **Exit criteria:** round-trip + recompute-on-load test · RLS verified (tenant-scoped) · goldens tie
  $0.00 (no bindings present) · `npm run test` green · `tsc` clean · committed · handoff.

### Phase 4 — Bindings in the grid: display + lifecycle plumbing (no authoring UI yet)
- **Scope:** Render bound cells **read-only** (reuse `isCellHardLocked`) with a depends-on binding
  badge driven by loaded bindings. New command-history commands `SET_BINDING` / `CLEAR_BINDING`
  (undo/redo) per the AGENTS.md command-history rule, wired through `db.ts`. A dev/test path to
  create a binding (not polished UI) to exercise the plumbing.
- **Approval gates:** none (no DDL; no export change).
- **Smallest shippable slice:** a persisted binding shows as a read-only derived cell with a badge;
  `SET_BINDING` is undoable.
- **Exit criteria:** create/clear binding is undoable atomically · derived cell read-only + badge ·
  recompute live when sources change · goldens tie · **a Playwright end-to-end test exercises
  create → recompute → clear** · **manual verify: drive the real app (/verify skill)** ·
  `npm run test` green · `tsc` clean · committed · handoff.

### Phase 5 — Authoring UI + inspection (LD-2)
- **Scope:** Context-menu "Define link…" → panel to build a **lookup** (source picker + ×/+ transform)
  or **rollup** (op + set-rule builder; rule-based default, hand-picked discouraged fallback).
  **"Links" tab** in the existing Trust Inspector slide-over showing the focused cell's depends-on /
  used-by, click-to-jump. **This is the Trust-panel touchpoint:** add `"links"` to `TrustTab`
  ([`src/lib/trustInspector.ts`](src/lib/trustInspector.ts)), generalize `openTrust` to focus on any
  node (a line cell — not only summary fields as today), and let the per-cell binding badge open Trust
  on the Links tab. The existing **Trace** tab and the new **Links** tab become two views of one
  dependency graph (Trace = how a total decomposes; Links = what one cell depends on / feeds);
  **Reconcile is unaffected and must still tie.** No new slide-over shell is built — it reuses the
  Trust Inspector's existing docked + expand-to-fullscreen chrome. Finalize per-cell badge.
  Conservative cycle rejection surfaced in the UI.
- **Approval gates:** none.
- **Smallest shippable slice:** author one lookup from the grid, see it recompute live, inspect it in
  the Links tab.
- **Exit criteria:** estimator can author + edit + delete a lookup and a rollup from the grid and
  inspect dependencies · cycle attempt rejected with a message · **reconciliation still ties** ·
  goldens tie (no bindings) · **a Playwright end-to-end test exercises authoring + the Links tab** ·
  **manual verify: drive the real app (/verify skill)** · `npm run test` green · `tsc` clean ·
  committed · handoff.

### Future (flagged, NOT built — hooks to preserve from day one)
- **Future Phase 6 — Graph hardening (spec phase 4):** incremental dirty-propagation, robust cycle
  diagnostics, performance at scale, optional full graph visualization. *Hooks preserved:* stable
  node IDs, kind-agnostic graph core, recompute-from-source.
- **Future Phase 7 — Expression bindings (HyperFormula):** add `kind:'expression'` as one
  `compileBinding` case delegating to embedded HyperFormula; graph core unchanged. *Hooks preserved:*
  open free-text `kind`, compiler isolation, by-ID/predicate references only.

---

## 6. Risks & unknowns

- **Row-id stability (which phase finds out: Phase 2/4).** Saved rows have stable DB UUIDs, but
  freshly-parsed CSV-import rows use `row-${index}` ([`parser.ts`](src/lib/parser.ts)) — unstable
  across re-parse. *Mitigation:* rule-based rollups reference no specific ids (immune); for lookups
  and `explicitIds`, gate authoring to **saved** estimates (ids stabilized) or stabilize ids at
  parse. Decision needed in Phase 4.
- **Imported-project branch (Phase 2).** For `isImported`, the page reads linked totals from saved
  rows (`linkedTotalsFromRows`), NOT from STEP 2/3 (frozen bids). The reframe must keep this: imported
  linked nodes are **constants**, not lookups. If missed, imported goldens drift. Highest-risk item in
  Phase 2.
- **STEP 2/3 addressability ceiling (Phase 5).** The registry exposes STEP 2/3 *computed* values as
  read-only source nodes; v1 cannot make a STEP 4 binding *write back* into a STEP 2/3 input, nor bind
  to a STEP 2/3 value that doesn't already exist as a named output. If estimators want finer-grained
  STEP 2/3 targets, that pulls Future "normalize STEP 2/3" forward.
- **`useMemo` full-recompute cost (Phase 2+).** Fine at current sizes; if binding fan-out grows large,
  the full-recompute model is the first thing to feel it → triggers Future Phase 6.
- **Open-enum discipline (every phase).** The plan dies as a clean architecture if a `switch(kind)`
  leaks into the graph core. *Mitigation:* code-review gate — kind appears only in `compileBinding`.

---

## 7. Recommended first slice

**Phase 1, narrowed:** the kind-agnostic graph core + the `lookup` compiler + a conservative cycle
check + `getBaseCode`/`getCodeSuffix`, all pure with unit tests — then, as the proof, express **one**
of the existing linked-division rows (e.g. Supervision: `line:<id>:total` ← `gc:supervisionSubtotal`)
as a lookup binding and assert the engine reproduces `computeLinkedDivisionTotals` for that row to the
cent. This proves **binding-by-ID end to end** against behavior the app already trusts, with zero DB,
zero UI, and zero golden movement — the smallest possible thing that validates the whole approach.

---

## 8. Phase 1 kickoff prompt (paste into a fresh session)

> **Branch first (LD-5):** before touching any files, create and switch to the dedicated workstream
> branch — `git switch -c linked-values-system` off `main` (if it already exists, `git switch
> linked-values-system`). Do NOT work on `main` or on `template-catalog-reconciliation`. Confirm this
> plan file is present and committed on the branch so you can read it.
>
> Implement **Phase 1 of the Linked Values System**, per the plan of record at
> `docs/plans/2026-06-15-linked-values-system.md` (read it first, especially §2 the authored spec and
> §5 Phase 1). Scope: create `src/lib/bindings/` with `types.ts`, `graph.ts` (kind-agnostic engine:
> build + topological sort + conservative cycle detection + evaluate — it must NOT switch on binding
> kind), `compile.ts` (`compileBinding` for `lookup` and `rollup`; the ONLY kind-aware module), and
> `setRule.ts` (capped predicate evaluator). Add `getBaseCode` and `getCodeSuffix` to
> `src/lib/division.ts`. Honor the hard constraint LD-4 (open `kind` enum; graph indifferent to kind;
> references by ID/predicate only; ops capped to sum/count/avg/min/max and multiply/add). Write
> exhaustive unit tests. Do NOT wire anything into the pages, the DB, or the engine yet — goldens must
> stay untouched. Exit when `npm run test` is green, `npx tsc --noEmit` is clean, the work is committed
> (multi-line message via `git commit -F <tempfile>`), and a handoff doc sequencing Phase 2 is written
> via the /handoff skill. **Stop at the Phase 1 boundary — do not start Phase 2.**
