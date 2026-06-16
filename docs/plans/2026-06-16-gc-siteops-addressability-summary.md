# GC / Site-Ops Addressability & Grid Convergence — Summary & Direction
_2026-06-16 · status: DIRECTION SET, plan not yet written_

> This is a **decision + scoping summary**, not a phased plan of record. It captures
> the problem, the current ground truth, the architect's chosen end-state, and the
> effort/risk shape — then hands off a ready-to-paste **`/ultraplan` prompt** (bottom
> of this doc) to generate the detailed multi-phase plan in a fresh session.

---

## 1. The one-paragraph version

Step 2 (General Conditions personnel) and Step 3 (Site Operations) are the last two
pages of the estimate that are **not built like the estimate**. Step 4 is a real
spreadsheet — addressable rows with stable IDs, undo/redo, per-cell locks, the Trust
Inspector, and now Linked Values bindings. Steps 2 and 3 are **bespoke forms over a
fixed catalog**: the estimator fills in parametric values (utilization %, quantities,
lump sums, rate overrides) that are saved as **loose JSONB blobs keyed by short
strings** (`utilEx`, `qtyKnox`, `rateSoilBorings`). Because those values have **no
stable per-line identity**, the Linked Values engine can *read their totals* but cannot
*target an individual line* with a binding, include individual lines in a rollup, or
attach an override-audit record to one. The Linked Values plan-of-record names this the
**central unmet precondition (decision LD-1)** for the "estimators stop opening Excel"
goal. This document sets the direction to close that gap.

---

## 2. Ground truth (what the code actually is today)

### 2.1 Persistence — loose blobs, not rows
`project_estimates` stores four free-form JSONB columns (confirmed in
`supabase_schema.sql:144-148`):

| Column | Holds | Keyed by |
|---|---|---|
| `gc_utilization` | 8 staff utilization %s + `rate*` overrides | config string (`utilEx`, `rateSrSu`) |
| `gc_equipment_overrides` | 3 equipment lump sums + N manual GC entries | config string (`eqDumpsters`, `preconFees`) |
| `site_ops_quantities` | per-line quantities | config string, with **legacy remapping** (`knox` → `qtyKnox`) |
| `site_ops_rates` | per-line rate overrides (only `qtyRate` lines) | config string (`rateSoilBorings`) |

Saved atomically via the `save_estimate` RPC. There is **no per-value row, no
`sort_order`, no stable UUID** — unlike `estimate_line_items`, which has all three.

### 2.2 State — plain `useState`, no command history
`usePersonnelCalculations` and `useInfrastructureCalculations` hold these values in
local `useState` maps and push a debounced JSONB save. They are **not wired into**:
- the **undo/redo command history** (`WorkbookCommand` / `useCommandHistory`), and
- the **append-only override-audit model** (`estimate_overrides`).
Step 4 has both. This is the parity gap.

### 2.3 Lines — a fixed catalog defined in constants
The set of GC/Site-Ops lines is hard-defined in `src/lib/constants.ts`
(`STAFF_ROLE_DEFAULTS`, `GC_MANUAL_DEFAULTS`, `EQUIPMENT_DEFAULTS`,
`SITE_OPS_MANUAL_DEFAULTS`). The estimator **cannot add or remove a line today** — only
fill in values. **Crucially, every config line already carries the attributes a rollup
predicate needs**: `code` (cost code), `procoreCode`, and `costType`. So the data a
`SetRule` reads already exists — it just isn't surfaced as a line identity.

### 2.4 UI — bespoke forms, not tables
`PersonnelPricingStep.tsx` and `InfrastructureStep.tsx` are plain `<input>`/`<select>`
forms (44 and 30 inputs respectively). **Only `EstimateTable.tsx` uses TanStack
Table.** Steps 2 and 3 share none of its grid machinery.

### 2.5 What already works (half the groundwork is done)
The bindings **value registry** (`src/lib/bindings/registry.ts`) already lifts
GC/Site-Ops **aggregates** into the dependency graph as readable source nodes:
`gc:grandTotal`, `gc:supervisionSubtotal`, `gc:general`, `siteOps:<section>`. The 10
hardcoded "linked division" rows are already re-expressed as generic `lookup` bindings
that read these nodes and reproduce the old totals to the cent. **What's missing is
per-LINE identity** — turning each individual GC/Site-Ops line into a `BindingLine`
that can be a binding *target* and a rollup *member*, not just a read-only aggregate.

---

## 3. The chosen end-state (architect's direction, 2026-06-16)

> **Supersedes** the earlier "fixed-catalog-but-addressable" recommendation in chat.

**Free-form everything.** Steps 2 and 3 should eventually become **full TanStack
tables whose functionality and UI match `EstimateTable`** — including:
- arbitrary row **insert / delete** (context-menu, like Step 4's manual rows),
- per-cell **editing, keyboard nav, copy/paste**, cell **locks**,
- **undo/redo** through the same `WorkbookCommand` history,
- **provenance glyphs**, **override ⚑ flags**, and **🔗 binding badges**,
- the **Trust Inspector** trace working over these lines like any other.

In other words, the estimate stops having three different kinds of page and becomes
**one uniform spreadsheet surface** end to end. The fixed catalog becomes seed/default
content, not a hard ceiling.

---

## 4. The path: decouple risk from rebuild

The end-state is large, and it mixes a **financial data-model migration** (high risk)
with a **UI rebuild** (low financial risk). The governing principle is to **keep those
two separate** so the money-touching change ships small, proven, and reversible before
any pixels move.

### Track A — Addressability (the financial-risk-bearing core)
Give every GC/Site-Ops value a **stable identity** and surface each line as a
`BindingLine`, so it can be a binding target and rollup member — **without changing the
existing forms**. This is where the "reproduce to the cent, zero golden movement" bar
applies. Strangler-fig: dual-read/dual-write old blobs ↔ new addressable rows, prove
totals unchanged, then cut over.

**The subtle trap to respect:** addressable **≠** stored-as-frozen-dollars. The lines
are *derived* (utilization × rate × hours × months; qty × rate). The app's law is
**recompute-from-source** (`calculations.ts` stays the sole financial authority; stored
derived values are cache). So Track A gives the *computed nodes stable IDs while keeping
them derived* — it must not freeze a dollar that should move when a rate card changes.

### Track B — Free-form TanStack convergence (the UI/UX rebuild)
Once the data model is addressable and proven, rebuild Steps 2 and 3 as TanStack tables
matching `EstimateTable`, and lift the fixed catalog into seed content so the estimator
can insert/delete arbitrary lines. Because Track A already proved the engine, Track B
carries little financial risk — it's mostly grid wiring and reuse of existing Step 4
components.

**Going free-form forces three real decisions** (deferred to the plan, flagged here):
1. **Export mapping** currently leans on the fixed catalog (every line has a known
   `code`/`procoreCode`). Free-form lines need a code-assignment + validation path
   (likely the same Procore-cost-code authority Step 4 uses).
2. **Calc engine shape.** `computePersonnelCosts` / `computeSiteOperations` derive a
   *fixed* set of lines from inputs. Free-form means the engine must compute over a
   *variable* line set — a real refactor of those two functions (kept pure).
3. **Row-id stability vs. churn** for inserted lines, mirroring Step 4's
   `isStableBindingRowId` rule (only DB-UUID rows are bindable).

---

## 5. Effort & risk shape

- **This is the largest and riskiest remaining workstream** — bigger than the entire
  Linked Values v1 (5 phases). It is a financial data-model migration behind the
  **schema gate** (DDL → `supabase_schema.sql` + explicit approval), with **backfill of
  every already-saved project** out of the legacy blob keys.
- **Highest-risk single item:** the **imported-project branch**. Imported estimates
  carry *frozen, hand-authored* GC/Site-Ops values that must **never be re-derived**
  from live inputs. The frozen-vs-derived split must survive the migration intact
  (already the #1 risk in the Linked Values plan).
- **Mitigations already in place:** the calc engine is pure and recompute-on-load is
  the established philosophy; export golden tests exist to pin "zero movement"; the
  value registry already bridges aggregates, so Track A extends a proven seam rather
  than inventing one.

---

## 6. Guardrails any plan must honor (from AGENTS.md)

- **Single DB gateway** (`src/lib/db.ts`) — no hook/component touches Supabase directly.
- **Schema source of truth** — `supabase_schema.sql` updated first, approved before apply.
- **Financial authority** stays in `calculations.ts`; no invented/altered formulas.
- **Append-only training/audit tables** (`estimate_overrides`, `classification_history`,
  `estimate_snapshots`) — never UPDATE/DELETE; fire-and-forget writes.
- **Command history** — every state mutation pushes a `WorkbookCommand` with full
  inverse data for undo/redo fidelity.
- **Division codes** via `getDivisionCode()` only; **source provenance** mandatory on
  every row.

---

## 7. Open decisions for the plan to settle (not yet decided)

1. **Storage model for addressable GC/Site-Ops lines** — extend `estimate_line_items`
   with a section/origin discriminator, or a **new dedicated table** per step? (Trade:
   reuse the proven RPC + sort-order machinery vs. clean separation from takeoff lines.)
2. **Migration strategy** — backfill blobs → rows lazily on first load, or a one-shot
   migration RPC? (Trade: zero-downtime drip vs. clean cutover.)
3. **How much of `EstimateTable` is extracted vs. duplicated** for Steps 2/3 — factor
   out a shared grid, or instantiate `EstimateTable` with a section-scoped row set?
4. **Free-form code assignment UX** — how an estimator picks/validates a Procore code
   for a brand-new GC/Site-Ops line.
5. **Calc engine refactor boundary** — how `computePersonnelCosts` /
   `computeSiteOperations` move from fixed-set to variable-set while staying pure and
   reproducing current totals exactly.

---

## 8. `/ultraplan` prompt (paste into a fresh session when ready)

> **Use `/ultraplan` to produce the full multi-phase plan-of-record for "GC/Site-Ops
> Addressability & Grid Convergence."** Read this summary first:
> `docs/plans/2026-06-16-gc-siteops-addressability-summary.md`, and the Linked Values
> plan it extends: `docs/plans/2026-06-15-linked-values-system.md` (honor decision LD-1
> and the kind-blind-graph constraint LD-4).
>
> **Goal:** make Step 2 (GC Personnel) and Step 3 (Site Operations) values first-class
> addressable lines, then converge both pages onto **free-form TanStack tables whose
> functionality and UI match `EstimateTable`** — uniform spreadsheet surface end to end,
> with the fixed catalog (`STAFF_ROLE_DEFAULTS`, `GC_MANUAL_DEFAULTS`,
> `EQUIPMENT_DEFAULTS`, `SITE_OPS_MANUAL_DEFAULTS`) demoted to seed/default content the
> estimator can insert into and delete from.
>
> **Structure the plan as two decoupled tracks:**
> - **Track A — Addressability (financial-risk-bearing).** Give every GC/Site-Ops value
>   a stable ID and surface each line as a `BindingLine` (binding target + rollup
>   member), behind the *existing forms*, with strangler-fig dual-read/dual-write and a
>   **"reproduce every total to the cent, zero export-golden movement"** gate on every
>   phase. Give computed nodes stable IDs but keep them **DERIVED** (recompute-from-source;
>   `calculations.ts` stays the sole financial authority — never freeze dollars).
> - **Track B — Free-form TanStack convergence (low financial risk).** Rebuild Steps 2/3
>   as TanStack tables reusing `EstimateTable` machinery (insert/delete, locks, undo/redo
>   via `WorkbookCommand`, provenance glyphs, override ⚑, 🔗 binding badges, Trust
>   Inspector). Wire GC/Site-Ops edits into the **command history** and the **append-only
>   `estimate_overrides`** audit model — neither exists on these pages today.
>
> **Settle these open decisions first (Step 2 of the planning skill), one
> recommendation each:** (1) storage model — extend `estimate_line_items` with a section
> discriminator vs. a new per-step table; (2) backfill — lazy-on-load vs. one-shot
> migration RPC; (3) shared-grid extraction vs. `EstimateTable` re-instantiation;
> (4) free-form Procore-code assignment + validation UX (reuse the `procore_cost_codes`
> authority); (5) the `computePersonnelCosts` / `computeSiteOperations` fixed-set →
> variable-set refactor boundary, kept pure.
>
> **Hard constraints:** all DB access via `src/lib/db.ts`; DDL behind the schema gate
> (`supabase_schema.sql` first, show exact SQL, **stop for approval**) with **backfill of
> every saved project** out of the legacy blob keys (incl. the `qtyKnox`-style legacy
> remapping); preserve the **imported-project frozen-vs-derived split** (imported values
> must never be re-derived — the #1 risk); command-history fidelity on every mutation;
> provenance + `getDivisionCode()` rules. Each phase sized for one fresh session, with
> `npm run test` green + `npx tsc --noEmit` clean + a `/handoff` doc as exit criteria.
> Branch the workstream per AGENTS.md LD-5 convention; do not build on `main`.
