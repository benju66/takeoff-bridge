# GC / Site-Ops Addressability & Grid Convergence — Summary & Direction
_2026-06-16 · status: DIRECTION LOCKED (decisions D1–D4 settled), plan not yet written_

> **Direction:** a **structured-first uniform grid with a validated free-form escape
> hatch** — Steps 2/3 match `EstimateTable`, but structure (clean exports, comparable
> jobs, protected calc IP) is preserved. See locked decisions D1–D4 in §3.

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

> **Direction settled via architect interview, 2026-06-16.** This supersedes both the
> earlier "fixed-catalog-but-addressable" chat recommendation **and** the first-draft
> "free-form everything" framing of this doc. The agreed goal is narrower and safer:
> **a structured-first uniform grid with a *validated* free-form escape hatch.**

Steps 2 and 3 should become **full TanStack tables whose functionality and UI match
`EstimateTable`** — one uniform spreadsheet surface end to end (insert/delete, per-cell
editing, keyboard nav, copy/paste, cell locks, undo/redo via `WorkbookCommand`,
provenance glyphs, override ⚑ flags, 🔗 binding badges, Trust Inspector trace). The
estimate stops having three different kinds of page.

But "uniform grid" does **not** mean "anything goes." The structure that makes the app
worth more than Excel — clean exports, comparable jobs, protected estimating IP — is
preserved by the four locked decisions below.

### Locked decisions (architect, 2026-06-16)

| # | Decision | What it means |
|---|---|---|
| **D1** | **One-off lines must carry a valid Procore code before export.** | The escape hatch is *structured*: an estimator can add a line that isn't in the catalog, but it must resolve to a valid `procore_cost_codes` entry (with a cost type) before it counts in the export — exactly the discipline Step 4 manual rows already enforce. Keeps exports clean and jobs comparable. |
| **D2** | **Standard catalog lines are removable and easily re-added.** | The fixed catalog (`STAFF_ROLE_DEFAULTS`, `GC_MANUAL_DEFAULTS`, `EQUIPMENT_DEFAULTS`, `SITE_OPS_MANUAL_DEFAULTS`) becomes a **helpful default, not a forced checklist**: estimators can hide/remove lines that don't apply on a job and pull standard lines back from a picker anytime. |
| **D3** | **Auto-calculated rows allow type-over, recorded as an audited override.** | The staffing / linked rows still compute from inputs (utilization, rates, duration) and stay the default, but an estimator **may type a number over the computed result**. The app keeps the computed value, layers the manual value on top, and records it via the append-only `estimate_overrides` audit model (the Trust Inspector glass box shows both). |
| **D4** | **Imported past bids stay a locked historical record; reuse = "copy to new."** | An imported bid remains frozen (its hand-authored GC/Site-Ops values are never re-derived). To reuse one, the estimator makes a copy that becomes a fresh editable estimate. Protects the historical data asset. |

**Scope consequence of D3 — read this:** allowing type-over pulls the **override-audit
trail into core scope**, not "eventual parity." Good news: this is *not* new
architecture — `estimate_overrides` already does exactly this for summary fields
(append-only, keeps computed + manual side by side, shown in the Trust Inspector). It
just has to cover GC/Site-Ops lines once they are addressable (D-dependent on Track A).
It also preserves recompute-from-source: an un-overridden row still derives live; an
overridden row derives live *underneath* a visible manual layer.

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

### Track A+ — Override-with-audit on calc rows (pulled into core by D3)
Decision **D3** (type-over allowed on auto-calculated rows) makes this a *required* part
of the core, riding directly on Track A's addressability. Once each calc row has a stable
ID, an estimator type-over writes an append-only `estimate_overrides` record against that
row's node; the computed value is retained and both are shown in the Trust Inspector.
This reuses an existing, proven mechanism — no new audit architecture — and preserves
recompute-from-source (the row still derives live underneath the manual layer).

### Track B — Structured-first TanStack convergence (the UI/UX rebuild)
Once the data model is addressable and proven, rebuild Steps 2 and 3 as TanStack tables
matching `EstimateTable`, with the fixed catalog as **removable/re-addable seed content**
(D2) and a **validated escape hatch** for one-off lines (D1). Because Track A already
proved the engine, Track B carries little financial risk — it's mostly grid wiring and
reuse of existing Step 4 components.

**The escape hatch forces three real decisions** (deferred to the plan, flagged here):
1. **Export mapping / code assignment (D1).** One-off lines must resolve to a valid
   `procore_cost_codes` entry before export — reuse the same Procore-cost-code authority
   and validation Step 4 manual rows already use; an uncoded line is blocked from export.
2. **Calc engine shape.** `computePersonnelCosts` / `computeSiteOperations` derive a
   *fixed* set of lines from inputs. A removable/extensible line set means the engine must
   compute over a *variable* line set — a real refactor of those two functions (kept pure).
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

## 7. Decision status

**Product decisions — SETTLED** (architect interview, 2026-06-16): the four locked
decisions D1–D4 in §3 close every product/domain question. No further architect input is
required to begin planning.

**Implementation decisions — the planner's to make** (not architect-facing):
1. **Storage model for addressable GC/Site-Ops lines** — extend `estimate_line_items`
   with a section/origin discriminator, or a **new dedicated table** per step? (Trade:
   reuse the proven RPC + sort-order machinery vs. clean separation from takeoff lines.)
2. **Migration strategy** — backfill blobs → rows lazily on first load, or a one-shot
   migration RPC? Default: **invisible/lossless** to the estimator either way.
3. **How much of `EstimateTable` is extracted vs. duplicated** for Steps 2/3 — factor
   out a shared grid, or instantiate `EstimateTable` with a section-scoped row set?
4. **Calc engine refactor boundary** — how `computePersonnelCosts` /
   `computeSiteOperations` move from fixed-set to variable-set while staying pure and
   reproducing current totals exactly.

**Open roadmap question — non-blocking** (does not affect this doc; decide at plan time):
**sequencing** — does this GC/Site-Ops workstream run immediately after the
addressability/Linked-Values track, or do the cold-start "estimator speed" features
(assemblies, smarter classification) come first?

---

## 8. Planning kickoff prompt (paste into a fresh session when ready)

> Works with **`/plan-phases`** (recommended — see §9) or `/ultraplan` for a deeper pass.
> **Produce the full multi-phase plan-of-record for "GC/Site-Ops Addressability & Grid
> Convergence."** Read this summary first:
> `docs/plans/2026-06-16-gc-siteops-addressability-summary.md` (especially the locked
> decisions D1–D4 in §3), and the Linked Values plan it extends:
> `docs/plans/2026-06-15-linked-values-system.md` (honor decision LD-1 and the
> kind-blind-graph constraint LD-4).
>
> **Goal:** make Step 2 (GC Personnel) and Step 3 (Site Operations) values first-class
> addressable lines, then converge both pages onto a **structured-first uniform grid that
> matches `EstimateTable`'s functionality and UI, with a *validated* free-form escape
> hatch** — NOT free-form-everything. The fixed catalog (`STAFF_ROLE_DEFAULTS`,
> `GC_MANUAL_DEFAULTS`, `EQUIPMENT_DEFAULTS`, `SITE_OPS_MANUAL_DEFAULTS`) becomes
> removable/re-addable seed content (D2), one-off lines require a valid Procore code
> before export (D1), auto-calc rows allow audited type-over (D3), and imported past bids
> stay locked/"copy-to-new" (D4).
>
> **The four locked decisions are settled — do NOT re-litigate them; design to them.**
> The planning skill's "surface decisions" step should cover only the *implementation*
> choices below, not the product decisions.
>
> **Structure the plan as two decoupled tracks plus the D3 bridge:**
> - **Track A — Addressability (financial-risk-bearing).** Give every GC/Site-Ops value
>   a stable ID and surface each line as a `BindingLine` (binding target + rollup
>   member), behind the *existing forms*, with strangler-fig dual-read/dual-write and a
>   **"reproduce every total to the cent, zero export-golden movement"** gate on every
>   phase. Give computed nodes stable IDs but keep them **DERIVED** (recompute-from-source;
>   `calculations.ts` stays the sole financial authority — never freeze dollars).
> - **Track A+ — Override-with-audit on calc rows (D3, core not optional).** Once rows are
>   addressable, wire type-over to append-only `estimate_overrides` (computed value
>   retained, both shown in Trust Inspector). Reuse the existing summary-override
>   mechanism — no new audit architecture.
> - **Track B — Structured-first TanStack convergence (low financial risk).** Rebuild
>   Steps 2/3 as TanStack tables reusing `EstimateTable` machinery (insert/delete, locks,
>   undo/redo via `WorkbookCommand`, provenance glyphs, override ⚑, 🔗 binding badges,
>   Trust Inspector), with removable/re-addable catalog seed (D2) and the validated
>   escape hatch (D1). Wire GC/Site-Ops edits into the **command history** — it does not
>   exist on these pages today.
>
> **Settle these IMPLEMENTATION decisions first (planning-skill Step 2), one
> recommendation each:** (1) storage model — extend `estimate_line_items` with a section
> discriminator vs. a new per-step table; (2) backfill — lazy-on-load vs. one-shot
> migration RPC (default invisible/lossless); (3) shared-grid extraction vs.
> `EstimateTable` re-instantiation; (4) the `computePersonnelCosts` /
> `computeSiteOperations` fixed-set → variable-set refactor boundary, kept pure.
>
> **Hard constraints:** all DB access via `src/lib/db.ts`; DDL behind the schema gate
> (`supabase_schema.sql` first, show exact SQL, **stop for approval**) with **backfill of
> every saved project** out of the legacy blob keys (incl. the `qtyKnox`-style legacy
> remapping); preserve the **imported-project frozen-vs-derived split** (imported values
> must never be re-derived — the #1 risk); command-history fidelity on every mutation;
> provenance + `getDivisionCode()` rules. Each phase sized for one fresh session, with
> `npm run test` green + `npx tsc --noEmit` clean + a `/handoff` doc as exit criteria.
> Branch the workstream per AGENTS.md LD-5 convention; do not build on `main`.

---

## 9. Advice: `/plan-phases` vs `/ultraplan` for this workstream

**`/plan-phases` is adequate — recommended as the primary tool.** This workstream is
large but it is *not* under-specified: the product decisions are settled (D1–D4), it
decomposes cleanly into Track A / A+ / B, and each track breaks into one-session phases
with obvious approval gates (the schema DDL) and a sharp, testable exit bar ("to the
cent, zero golden movement"). That is exactly the shape `/plan-phases` is built for, and
it already enforces the investigate → surface-decisions → phased-plan flow this needs.

**Where a deeper `/ultraplan` pass would add value — optional, and only here:** the two
genuinely hard *design* problems are (a) the **storage model + lossless backfill** of
every saved project off the legacy blob keys, and (b) the **calc-engine fixed-set →
variable-set refactor** that must reproduce every total exactly. If you want maximum-rigor
exploration of alternatives and failure modes, point the heavier planning pass at *those
two sub-problems specifically* — not the whole workstream.

**Bottom line:** plan the workstream with `/plan-phases`; reserve `/ultraplan` (if used at
all) for a focused deep-dive on the storage/backfill and calc-refactor phases.
