# GC/Site-Ops Addressability — Phase A1 closure & Phase A2 kickoff
_2026-06-16 · branch `gc-siteops-addressability` (off `main`)_

> Plan of record: `docs/plans/2026-06-16-gc-siteops-addressability-grid-convergence.md`
> (read it first — locked decisions D1–D4, ID-1…ID-4). Phase A1 is **done & committed**
> (`3b08860`). Phase A2 is the **first ⛔ DDL gate** of the workstream.

---

## What Phase A1 shipped (commit `3b08860`)

Parameterized the two GC/Site-Ops calc engines to a **variable active line set**, per ID-4 —
a pure-lib change with the boundary left **inert** (no DB / page / binding-engine wiring).

1. **`computePersonnelCosts` / `computeSiteOperations` (`src/lib/calculations.ts`)** now take a
   trailing optional `lines` argument that **defaults to the full catalog constants**
   (`DEFAULT_PERSONNEL_LINES` / `DEFAULT_SITE_OPS_LINES`). The per-line math is byte-for-byte
   unchanged — only *which* lines compute is variable. This mirrors the existing `RateLookup`
   injection pattern (same file): a trailing param with an inert default, so every existing
   caller and both export goldens are unmoved. The functions stay pure.

2. **Active-line-config types + builders** (exported from `calculations.ts`):
   - `PersonnelLineSet` (`staffRoles` / `operationalExpenses` / `equipment` / `manualLines`) and
     `SiteOpsLineSet` (`dynamicLines` / `manualLines`) — the injected shape.
   - `OneOffGcLine` = `GcManualConfig`, `OneOffSiteOpsLine` = `SiteOpsManualConfig` — aliases
     making explicit that a one-off line **is** a generic manual config (so it flows through the
     *existing* manual-line evaluator, no new math).
   - `buildPersonnelLineSet({ removeCodes?, addManual?, base? })` and
     `buildSiteOpsLineSet(...)` — pure. Encode the two controlled "variables":
     - **(a) removal (D2)** → `removeCodes` filters the catalog by `code` (every config kind has
       a unique `code`; identity is keyed by `code`, since the operational/dynamic driver kinds
       have no `key`).
     - **(b) one-off addition (D1)** → `addManual` appends user-authored manual configs to the
       manual array; their typed value arrives via the existing `manualEntries[key]` /
       `quantities[key]` (+ `rates[key]` for `qtyRate`) lookups.

3. **The protection is encoded in the API surface**: the additive parameter is `addManual`
   **only** — there is *no* `addStaff` / `addOperational` / `addDynamic`. Bespoke STRUCTURED
   lines (utilization-by-role, the operational/Site-Ops quantity drivers incl. `sqftPer3000`,
   the lump-sum equipment lines) are **removable but not user-mintable**. The supervision
   subtotal and the linked-division bridge are *derived downstream* in
   `computeLinkedDivisionTotals` — not line configs, so they were untouched.

4. **Tests** — new `src/lib/__tests__/calculationsLineSet.test.ts` (12 tests):
   default-arg == explicit-default-set == full-builder for both functions; `DEFAULT_*_LINES`
   *are* the catalog constants (referential `toBe`); removal-subset across staff/operational/
   manual + Site-Ops dynamic/manual; one-off manual cases (lumpSum, qty, qtyRate, and an idle
   one-off → $0). Routing assertions prove a one-off lands in `manualLines`, never as a
   structured line.

### Verification (Phase A1 exit — all green)
- `npm run test` → **89 files / 1064 tests pass** (was 1052 pre-change; +12 from the new file).
- The **63** existing `calculations.test.ts` tests unchanged; all 3 export goldens
  (McKenna / synthetic / CARE) tie unchanged.
- `npx tsc --noEmit` clean; `eslint` clean on the two changed files.

### Discoveries / gotchas for later phases
- **The plan says "41 existing calc tests"; the real count in `calculations.test.ts` is 63.**
  The "41" figure is stale — treat "the existing calc tests + both goldens unchanged" as the
  binding gate, not the number.
- Both production callers (`src/hooks/usePersonnelCalculations.ts`,
  `src/hooks/useInfrastructureCalculations.ts`) pass args only up to `rateLookup`, so the new
  trailing `lines` param is safe. **A3 will start passing a built line set here** (dual-read).
- Passing `undefined` for `rateOverrides`/`rateLookup` to reach the `lines` positional arg
  correctly triggers their defaults (JS default-param semantics) — the line-set tests rely on
  this; keep it in mind when A3/B2/B3 call the engines positionally.

---

## Phase A2 — the next phase (⛔ DDL GATE)

**Goal (plan §"Phase A2"):** create the single dedicated `estimate_section_lines` table (ID-1)
+ a `db.ts` gateway, with **nothing reading it into the pages yet**. This is the first schema
change of the workstream and is gated on explicit architect sign-off.

### Scope (from the plan, ID-1 shape)
- One table holding **both** Step 2 and Step 3 lines, discriminated by `section` (`gc` /
  `site_ops`). Columns: `id`, `project_id`, `section`, `code`, `procore_code`, `cost_type`,
  `label`, `entry_kind`, `inputs` JSONB, `sort_order`, `source`, timestamps —
  **no authoritative `total` column** (derived, never frozen — ID-1's structural law). Any
  persisted total is cache-only.
- `db.ts` gateway funcs `getSectionLines` / `saveSectionLines` with their **own** atomic RPC
  (independent + debounced — written separately from `save_estimate`, NOT through Step 4's
  DELETE-all+INSERT replace path).
- Tenant-scoped RLS mirroring `estimate_line_items`.
- `ORDER BY sort_order ASC` on read (AGENTS.md sort-order integrity).

### Concrete reference anchors (`supabase_schema.sql`)
- `estimate_line_items` table → **L178**; its RLS policy `line_items_tenant_policy` → **L582**
  (mirror this tenant predicate; note the live DB inlines the tenant predicate — there is no
  `get_auth_tenant_id()` helper; see memory `schema-drift-reconciliation`).
- `save_estimate_line_items` RPC (atomic line-item pattern to imitate) → **L246**;
  `save_estimate` → **L312**.
- Legacy blobs A3/A4/B6 interact with: `gc_utilization` L144, `gc_equipment_overrides`,
  `site_ops_quantities` L147, `site_ops_rates`, `imported_step23_lines` L161 (the imported
  frozen source — stays through B6).

### Approval gates / required process (AGENTS.md "Data Persistence Boundaries")
- ⛔ **DDL** — update `supabase_schema.sql` **first**, present the exact `CREATE TABLE` + RPC +
  RLS SQL, and **STOP for architect sign-off before applying.** Invoke the
  `supabase:supabase` skill before touching DB code.
- All DB access routes through `src/lib/db.ts` (no direct client imports).
- `list_tables` + `get_advisors` **before & after**; `generate_typescript_types` after.

### Exit criteria
- Round-trip test (write → read, `sort_order ASC`); RLS verified tenant-scoped with **no new
  advisor finding**; both goldens tie **$0.00** (nothing consumes the table yet); standard
  exits (`npm run test` green · `tsc` clean · committed via `git commit -F` · handoff for A3).

### Phase A2 kickoff prompt (paste into a fresh session)

> **Branch first (AGENTS.md / LD-5):** confirm you're on `gc-siteops-addressability`
> (`git switch gc-siteops-addressability`); do NOT work on `main`. Confirm the plan file
> `docs/plans/2026-06-16-gc-siteops-addressability-grid-convergence.md` and this handoff are
> present.
>
> Implement **Phase A2** of GC/Site-Ops Addressability & Grid Convergence (read the plan's
> Phase A2 + locked decision ID-1 first). Invoke the `supabase:supabase` skill before any DB
> code. Create the new `estimate_section_lines` table (ID-1 shape — `section` discriminator,
> `entry_kind`, `inputs` JSONB, `sort_order`, `source`, **no authoritative total column**),
> add `getSectionLines` / `saveSectionLines` to `src/lib/db.ts` backed by their own atomic RPC
> (independent + debounced, written separately from `save_estimate`), and tenant-scoped RLS
> mirroring `estimate_line_items` (`line_items_tenant_policy`). **Wire nothing into the pages
> yet.** ⛔ This is a DDL gate: update `supabase_schema.sql` first, present the exact
> `CREATE TABLE` + RPC + RLS SQL, and STOP for my sign-off before applying anything. Run
> `list_tables` + `get_advisors` before & after and `generate_typescript_types` after. Exit
> when the round-trip test passes (`sort_order ASC`), RLS is verified tenant-scoped with no new
> advisor finding, both export goldens tie $0.00, `npm run test` is green, `tsc` is clean, the
> work is committed (`git commit -F`), and a handoff sequencing **Phase A3** is written. **Stop
> at the Phase A2 boundary.**

---

## Where this sits in the workstream
Track A: **A1 ✅** → A2 (table+gateway, DDL) → A3 (lazy synthesis, app-born) →
A4 (imported branch, the #1 risk) → A5 (project to BindingLines). Then A+1 (override-with-audit),
then Track B (B1 grid-shell extraction → B2/B3 grids → B4 removable seed → B5 one-off escape
hatch → B6 finish-migration, DDL). A1 built the calc seam B2–B5 and A+1 all depend on.
