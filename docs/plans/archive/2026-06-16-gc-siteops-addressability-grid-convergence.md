# GC / Site-Ops Addressability & Grid Convergence — Plan of Record
_2026-06-16 · status: PROPOSED_

> Companion to the direction doc `docs/plans/2026-06-16-gc-siteops-addressability-summary.md`
> (product decisions D1–D4) and the plan it extends,
> `docs/plans/2026-06-15-linked-values-system.md` (LD-1 addressability gap, LD-4
> kind-blind graph). **No feature code is written until this plan is approved.**

---

## Goal

When this workstream is done, **Step 2 (GC Personnel) and Step 3 (Site Operations) are
real spreadsheets like Step 4** — one uniform grid surface end to end. Every GC/Site-Ops
value is a **first-class addressable line** with a stable identity: it can be a Linked
Values binding *target*, a rollup *member*, carry an audited *type-over*, be *removed*
when it doesn't apply, and sit beside *one-off lines* the estimator adds — provided each
one-off resolves to a valid Procore code before it counts in the export. The bespoke
estimating IP (utilization-by-role math, supervision/linked subtotals, the
square-footage drivers) stays intact and protected: those lines are *removable* but not
*re-inventable*. Throughout, **every total still reproduces to the cent and the export
goldens never move** — the money-touching data migration ships small, proven, and
reversible before any pixels change.

---

## Out of scope / deferred

- **No new bespoke-formula line kinds.** Estimators cannot mint a new utilization-driven,
  supervision-subtotal, or linked-division line. The escape hatch is the *generic
  manual / lump-sum* kind only (D1). New structured math is a future workstream.
- **No HyperFormula / `kind:'expression'` bindings.** Unchanged from the Linked Values
  plan — still Future Phase 7, hooks preserved.
- **No change to the Procore export skeleton or the Step 4 grid's financial behavior.**
  Bindings/overrides change *how a value computes*, never the export template. Goldens
  tie $0.00 on every phase.
- **No re-derivation of imported bids — ever.** Imported GC/Site-Ops values stay frozen
  (D4); reuse is "copy to a new editable estimate," which is itself a later, separate
  feature (this plan keeps the import frozen, it does not build the copy flow).
- **No incremental/dirty recompute or graph-perf hardening** (Linked Values Future
  Phase 6). Full recompute-on-load remains the model.

---

## Locked decisions

### Product decisions (architect, 2026-06-16 — settled, not re-litigated here)
- **D1 — Validated escape hatch.** A one-off line must resolve to a valid
  `procore_cost_codes` entry (with a cost type) before it counts in the export — the same
  gate Step 4 manual rows already enforce (`validateExportReadiness`).
- **D2 — Removable / re-addable catalog seed.** The fixed catalogs become a helpful
  default, not a forced checklist: hide/remove lines that don't apply, pull standard lines
  back from a picker anytime.
- **D3 — Audited type-over on auto-calc rows (core, not optional).** Auto-calc rows still
  compute and stay the default, but an estimator may type a number over the computed
  result; the computed value is retained underneath and the event is recorded in the
  append-only `estimate_overrides` audit model.
- **D4 — Imported bids stay locked.** An imported bid's hand-authored GC/Site-Ops values
  are never re-derived; reuse = copy-to-new (deferred).

### Implementation decisions (architect-locked at planning, 2026-06-16)
- **ID-1 — One new dedicated table, derived not frozen.** A single new table holds both
  Step 2 and Step 3 lines with a `section` discriminator (`gc` / `site_ops`), its own
  atomic save RPC, `sort_order`, and `source` provenance — routed through `src/lib/db.ts`,
  **not** an extension of `estimate_line_items`. It stores **line identity + estimator
  inputs** (utilization %, quantity, rate, lump sum, manual entries, rate overrides), a
  resolved `code`/`procore_code`/`cost_type`/`label`, never an authoritative
  `total NUMERIC NOT NULL`. Any persisted total is cache-only/recomputed — structurally
  enforcing the "derived, never frozen" law. Writes are independent and debounced (not
  routed through Step 4's DELETE-all + INSERT replace). _Why: GC/Site-Ops already export
  via a separate derived calc path (`exporter.ts` builds them from the calc result, never
  from `estimate_line_items`); a dedicated table protects Step 4's frozen-dollar Procore
  spine and the #1 frozen-vs-derived risk, and costs bindings nothing._
- **ID-2 — Lazy-on-load synthesis now, finishing sweep later.** On load, synthesize
  section-line rows from the legacy blob keys (incl. `qtyKnox`-style remapping) in memory
  and persist on next save (strangler-fig dual-read/dual-write). **Provenance branch:**
  app-born projects synthesize from the four JSONB blobs; imported projects synthesize
  from the frozen `imported_step23_lines` detail and stay **non-derived**. A later phase
  runs a one-shot **idempotent** sweep over remaining un-migrated projects, then removes
  the dual-read shim and retires the legacy blob columns (behind the schema gate). _Why:
  pure lazy never ends; a cold one-shot-across-all is high blast-radius — lazy-first proves
  the synthesis per-project at low stakes, the sweep just finishes the stragglers._
- **ID-3 — Extract a shared grid *shell*, not the business logic.** Adopt/extend the
  **existing** `src/components/ui/grid/` primitives (which `EstimateTable` does not yet
  consume) and factor out the grid shell **plus** the decoration/Trust layer (provenance
  glyph, override ⚑, 🔗 binding badge, cell lock, context menu, Trust Inspector) behind a
  **generalized host contract** that replaces today's Step-4-specific `TableMeta`
  vocabulary. Each step supplies its **own** state+command hook implementing that contract:
  Step 4 keeps `useTakeoffWorkbook`; Steps 2/3 get their own leaner hooks. **Sequence:**
  Phase B1 is a behavior-preserving extraction with Step 4 as the *sole* consumer (the
  dedicated Step-4 proving phase), then Steps 2/3 plug in. _Why: extraction quarantines
  Step 4 regression risk to one phase and is the only path to a genuinely uniform surface;
  re-instantiating the 1,236-line component + 1,575-line hook for three row sets smears
  that risk across every future edit._
- **ID-4 — Parameterize the calc line set; "variable" is bounded.** Inject the active line
  set into `computePersonnelCosts` / `computeSiteOperations` as an argument **defaulting to
  the full catalog constants** (mirrors the existing `RateLookup` injection pattern); the
  per-line math is untouched, so the default is byte-identical and goldens tie trivially.
  Two controlled kinds of "variable": **(a) removal (D2)** = the active set is a filtered
  subset; **(b) one-off addition (D1)** = a manual line whose config the user authored
  (entry `qty`/`qtyRate`/`lumpSum` + rate + a valid Procore code), which reuses the
  **existing manual-line evaluator** — no new math. **Bespoke structured lines stay
  catalog-only** (utilization-by-role, supervision subtotal, the linked-division bridge,
  `sqftPer3000`): subset-able (removable) but not user-mintable.

### Inherited / structural
- **LD-1, LD-4 (Linked Values):** generalize the existing bridge; the dependency graph
  stays indifferent to binding kind; all kind knowledge isolated in `compileBinding`;
  references by ID/predicate only.
- **Branch strategy (AGENTS.md / LD-5):** the whole workstream lives on a dedicated branch
  `gc-siteops-addressability` off `main`. Each phase commits onto that branch; never build
  on `main`. Pre-req before Phase 1: this plan file is committed so a fresh session reads it.

---

## Phases

> 12 phases across three tracks. Each fits one fresh session. **Every phase** exits on
> `npm run test` green · `npx tsc --noEmit` clean · committed (multi-line message via
> `git commit -F <tempfile>`) · a `/handoff` doc sequencing the next phase. Phases that
> touch money additionally tie **both export goldens (app-born + imported) at $0.00**.

### Track A — Addressability (financial-risk-bearing; strangler-fig)

#### Phase A1 — Parameterize the calc engine to a variable line set (pure lib)
- **Scope:** Refactor `computePersonnelCosts` / `computeSiteOperations` (`src/lib/calculations.ts`)
  to accept the active line set as an argument defaulting to the catalog constants
  (`STAFF_ROLE_DEFAULTS`, `OPERATIONAL_EXPENSE_DEFAULTS`, `GC_MANUAL_DEFAULTS`,
  `EQUIPMENT_DEFAULTS`, `SITE_OPS_DYNAMIC_DEFAULTS`, `SITE_OPS_MANUAL_DEFAULTS`). Per-line
  math unchanged. Add the "active line config" types supporting (a) a filtered subset
  (removal) and (b) a one-off manual line routed through the *existing* manual-line
  evaluator. Nothing removed or added yet — the parameterized boundary, proven inert.
- **Approval gates:** none (no DB, no UI).
- **Exit criteria:** new tests prove `default-arg output === legacy` for both functions,
  plus a subset case and a one-off-manual case compute correctly · the 41 existing calc
  tests + both export goldens unchanged · standard exits.

#### Phase A2 — New `estimate_section_lines` table + db gateway  ⛔ DDL GATE
- **Scope:** Create the single dedicated table (ID-1 shape: `id`, `project_id`,
  `section`, `code`, `procore_code`, `cost_type`, `label`, `entry_kind`, `inputs` JSONB,
  `sort_order`, `source`, timestamps — **no authoritative total column**). Add `db.ts`
  gateway funcs `getSectionLines` / `saveSectionLines` (own atomic RPC, independent +
  debounced, written separately from `save_estimate`). Tenant-scoped RLS mirroring
  `estimate_line_items`. Nothing reads it into the pages yet.
- **Approval gates:** ⛔ **DDL** — update `supabase_schema.sql` first, present exact
  `CREATE TABLE` + RPC + RLS SQL, **stop for sign-off** before applying. `list_tables` /
  `get_advisors` before & after; `generate_typescript_types` after.
- **Exit criteria:** round-trip test (write → read, `sort_order ASC`) · RLS verified
  tenant-scoped, no new advisor finding · goldens tie $0.00 (nothing consumes it yet) ·
  standard exits.

#### Phase A3 — Lazy-on-load synthesis, app-born branch (dual-read / dual-write)
- **Scope:** Pure synthesis module: legacy blobs (`gc_utilization`,
  `gc_equipment_overrides`, `site_ops_quantities`, `site_ops_rates` incl. the `qtyKnox`
  legacy remapping) → section-line rows (catalog seed + saved inputs). Wire the Step 2/3
  state to **dual-read**: synthesize rows on load, feed the parameterized engine (A1),
  assert identical `PersonnelCalcResult` / `SiteOpsCalcResult` to today's blob-driven
  path; persist to the new table on next save while still writing the legacy blobs
  (dual-write). **App-born projects only.**
- **Approval gates:** none (no DDL; no export change).
- **Exit criteria:** dual-read produces byte-identical calc results to the blob path for
  fixtures · **app-born golden ties $0.00** · standard exits.

#### Phase A4 — Imported-project synthesis branch (the #1 risk, isolated)
- **Scope:** Imported projects synthesize their section lines from the frozen
  `imported_step23_lines` (`step2Lines` / `step3Lines`) and stay **non-derived** — never
  re-derived from live inputs. Preserve `computeImportedLinkedDivisionTotalsViaEngine`
  exactly. The frozen-vs-derived split survives the new row model intact.
- **Approval gates:** none.
- **Exit criteria:** **imported golden ties $0.00** AND app-born golden still ties · a test
  asserts an imported project's section lines are constants, not recomputed from STEP 2/3
  inputs · standard exits.

#### Phase A5 — Surface section lines as BindingLines / registry source nodes
- **Scope:** Project the new section-line rows to `BindingLine`s and
  `line:<id>:<field>` graph nodes via `src/lib/bindings/registry.ts` — the same way Step 4
  rows are projected — so each GC/Site-Ops line becomes a binding **target** and rollup
  **member**. Fold at the existing `assembleBindingGraphNodes` collision-precedence seam;
  stay kind-blind (LD-4). Still behind the existing forms (no grid yet).
- **Approval gates:** none.
- **Exit criteria:** a unit test authors a lookup/rollup that targets/aggregates a section
  line and the engine evaluates it · the engine fold stays inert by default → goldens tie
  $0.00 · standard exits.

### Track A+ — Override-with-audit on calc rows (D3, core)

#### Phase A+1 — Type-over mechanism for auto-calc lines via `estimate_overrides`
- **Scope:** Layer `override ?? computed` **per line** inside the parameterized engine
  (A1), keyed by each line's stable node id; the computed value is always retained. Reuse
  `recordEstimateOverride` / `getEstimateOverrides` and the existing append-only audit
  model (the `field` column is already free TEXT, so line node ids need no migration). The
  Trust Inspector shows computed + manual side by side. Built and tested **headless** (a
  dev/test path, mirroring how Linked Values Phase 4 exercised `SET_BINDING`); the actual
  type-over *gesture* lands in Track B's grid.
- **Approval gates:** none (no DDL — reuses `estimate_overrides`).
- **Exit criteria:** a recorded line override layers over the computed value; un-overridden
  lines still derive live · inert with no overrides → goldens tie $0.00 · standard exits.

### Track B — Structured-first TanStack convergence (low financial risk)

#### Phase B1 — Extract the shared grid shell (behavior-preserving, Step 4 sole consumer)
- **Scope:** Adopt/extend the existing `src/components/ui/grid/` primitives inside
  `EstimateTable`, and extract the grid shell (TanStack instance plumbing +
  selection/keyboard + rendering) **plus** the decoration/Trust layer (provenance glyph,
  override ⚑, 🔗 badge, cell lock, context menu, Trust Inspector) behind a generalized host
  contract that replaces the Step-4-specific `TableMeta` vocabulary
  (`code|desc|qty|price|uom`, `insertManualRow`/`deleteRow`, `lockedCells`, `selection`).
  **Step 4 remains the sole consumer** via `useTakeoffWorkbook`. **The riskiest Track B
  phase** — keep it strictly zero-behavior-change.
- **Approval gates:** none, but treat the goldens + full suite as the hard gate.
- **Exit criteria:** export goldens, the **entire** test suite, and `tsc` ALL unchanged
  (zero behavior change) · standard exits. (If the extraction can't land green in one
  session, split it — an extra handoff is cheap.)

#### Phase B2 — Step 2 (GC Personnel) as a grid
- **Scope:** New leaner Step 2 state+command hook implementing the B1 host contract,
  backed by the section-lines table (A3) and the parameterized engine (A1). Render Step 2
  through the shared grid: per-cell editing, keyboard nav, cell locks, provenance glyphs,
  🔗 badges, Trust Inspector, and **undo/redo via `WorkbookCommand`** (command history does
  not exist on this page today — add the needed command types with full inverse data per
  AGENTS.md). Auto-calc rows derive; type-over wires to the A+1 override path. Catalog
  lines render as seed. Imported Step 2 stays its read-only view (D4).
- **Approval gates:** none.
- **Exit criteria:** Step 2 grid edits are undoable atomically; totals tie to the cent vs
  the old form · goldens tie $0.00 · a Playwright e2e + manual `/verify` · standard exits.

#### Phase B3 — Step 3 (Site Operations) as a grid
- **Scope:** Same pattern for Step 3 (the larger ~37-line catalog across 8 sections, with
  `GridSectionDivider`). Reuse the B2 hook/command pattern. Imported Step 3 stays
  read-only.
- **Approval gates:** none.
- **Exit criteria:** Step 3 grid edits undoable; totals tie to the cent · goldens tie
  $0.00 · e2e + `/verify` · standard exits.

#### Phase B4 — Removable / re-addable catalog seed (D2)
- **Scope:** Hide/remove a catalog line that doesn't apply (active set becomes a subset —
  A1) and pull standard lines back from a picker. Undoable via `WorkbookCommand`. Bespoke
  structured lines are removable but not re-inventable. Imported projects unaffected.
- **Approval gates:** none.
- **Exit criteria:** remove + re-add a line, totals recompute correctly, fully undoable ·
  goldens tie $0.00 · e2e + `/verify` · standard exits.

#### Phase B5 — Validated escape hatch: one-off lines requiring a Procore code (D1)
- **Scope:** Add a one-off line (generic manual entry kind — A1) that must resolve to a
  valid `procore_cost_codes` entry before it counts in export. Reuse the Procore-cost-code
  authority + `validateExportReadiness` + the Step 4 assign-and-place command pattern; an
  uncoded one-off is blocked from export with a clear message. Provenance `'manual'`.
- **Approval gates:** none (no DDL; no new export tab — the validation gate already exists).
- **Exit criteria:** add a one-off, assign a valid code → it exports; an uncoded one-off is
  blocked · goldens tie $0.00 · e2e + `/verify` · standard exits.

#### Phase B6 — Finish the migration: idempotent sweep + retire legacy blobs  ⛔ DDL GATE
- **Scope:** With lazy synthesis proven in the wild, run a one-shot **idempotent** sweep
  applying the same synthesis to every remaining un-migrated project; remove the dual-read
  shim and dual-write; retire the four legacy blob columns (`gc_utilization`,
  `gc_equipment_overrides`, `site_ops_quantities`, `site_ops_rates`) and drop them from the
  `save_estimate` RPC's upsert list. (`imported_step23_lines` stays — it is the imported
  frozen source.)
- **Approval gates:** ⛔ **DDL** — `supabase_schema.sql` first, present the sweep + column
  drops + RPC change, **stop for sign-off**. Advisors before & after; regenerate types.
- **Exit criteria:** sweep is idempotent (re-running is a no-op); every project loads from
  the new table; shim removed · goldens tie $0.00 · standard exits.

---

## Risks & unknowns

- **Imported frozen-vs-derived split (finds out: A4).** The #1 risk. Imported bids must
  never re-derive — A4 isolates this in its own phase with an imported golden gate. If the
  synthesis accidentally feeds imported rows through the live engine, the imported golden
  drifts immediately.
- **Grid-shell extraction blast radius (finds out: B1).** `EstimateTable` (1,236 lines) +
  `useTakeoffWorkbook` (1,575 lines) are large and coupled, and `EstimateTable` is the only
  current `useReactTable` consumer. The generalized host contract must capture every
  Step-4-specific behavior with zero change. Mitigation: B1 keeps Step 4 the sole consumer
  and gates on the full suite + goldens; split the phase if it can't land green.
- **Command history on Steps 2/3 (finds out: B2).** These pages have *no* undo today.
  New command types must carry full inverse data (AGENTS.md compounding-history). Risk of
  partial-fidelity undo if a derived recompute isn't captured — covered by per-phase undo
  tests.
- **Override addressing vocabulary (finds out: A+1).** Line node ids enter the
  `estimate_overrides.field` free-TEXT column. No migration, but the engine must apply
  overrides only to keys it recognizes (mirror `OVERRIDABLE_SUMMARY_FIELDS`), or a stale
  override could mis-apply.
- **Legacy-column retirement timing (finds out: B6).** Dropping the four blob columns is
  irreversible and changes the `save_estimate` RPC. Gated behind explicit approval and
  sequenced last, after lazy synthesis is proven in the wild.
- **Phase sizing of B1.** If the extraction overruns one session, it splits into
  "adopt ui/grid primitives" + "extract host contract" — flagged, not yet split.

---

## Phase 1 kickoff prompt

> **Branch first (AGENTS.md / LD-5):** before touching any files, create and switch to the
> workstream branch — `git switch -c gc-siteops-addressability` off `main` (if it already
> exists, `git switch gc-siteops-addressability`). Do NOT work on `main`. Confirm this plan
> file is present and committed on the branch.
>
> Implement **Phase A1 of GC/Site-Ops Addressability & Grid Convergence**, per the plan of
> record at `docs/plans/2026-06-16-gc-siteops-addressability-grid-convergence.md` (read it
> first, especially the locked decisions ID-1…ID-4 and Phase A1). Scope: refactor
> `computePersonnelCosts` and `computeSiteOperations` in `src/lib/calculations.ts` to accept
> the **active line set** as an argument that **defaults to the full catalog constants**, so
> default-arg output is byte-identical (mirror the existing `RateLookup` injection pattern —
> keep the functions pure). Add the "active line config" types supporting (a) a filtered
> subset (removal, D2) and (b) a one-off manual line routed through the **existing**
> manual-line evaluator (D1) — no new per-line math, and do NOT make bespoke structured
> lines (utilization-by-role, supervision subtotal, linked-division, `sqftPer3000`)
> user-mintable. Wire nothing into the DB, the pages, or the binding engine yet — the
> parameterized boundary must be inert. Write tests proving `default === legacy` for both
> functions plus a subset case and a one-off-manual case; the 41 existing calc tests and
> both export goldens must stay unchanged. Exit when `npm run test` is green,
> `npx tsc --noEmit` is clean, the work is committed (multi-line message via
> `git commit -F <tempfile>`), and a `/handoff` doc sequencing Phase A2 is written. **Stop at
> the Phase A1 boundary — do not start Phase A2.**
