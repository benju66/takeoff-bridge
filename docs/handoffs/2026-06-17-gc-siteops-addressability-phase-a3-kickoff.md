# GC/Site-Ops Addressability — Phase A2 closure & Phase A3 kickoff
_2026-06-17 · branch `gc-siteops-addressability` (off `main`)_

> Plan of record: `docs/plans/2026-06-16-gc-siteops-addressability-grid-convergence.md`
> (read it first — locked decisions D1–D4, ID-1…ID-4). Phase A2 is **done & committed**.
> Phase A3 is the first **strangler-fig** phase (dual-read / dual-write), **no DDL**.

---

## What Phase A2 shipped

The first ⛔ DDL gate of the workstream: the dedicated **`estimate_section_lines`** table
(plan ID-1) + its `db.ts` gateway, applied live and proven inert. **Nothing reads or writes
it from the app yet** — A2 lays the pipe; A3 wires synthesis onto it.

### DDL (applied live to `nefvkrhbbkiqnpeabyqz`, and written into `supabase_schema.sql`)
- **`estimate_section_lines`** — one addressable row per GC Personnel (Step 2) / Site
  Operations (Step 3) line. Columns: `id TEXT`, `project_id` (FK→projects, ON DELETE
  CASCADE), `section` (**CHECK `IN ('gc','site_ops')`** — closed discriminator), `code`,
  `procore_code`, `cost_type`, `label`, `entry_kind` (**free TEXT, NO CHECK** — open
  line-kind enum, mirrors `estimate_bindings.kind`; A3 narrows the vocabulary), `inputs`
  JSONB, `sort_order`, `source`, `updated_at`. **PK `(project_id, id)`**, plus
  `idx_section_lines_sort (project_id, sort_order)`. **There is NO `total` column** — the
  structural enforcement of ID-1's "derived, never frozen" law (a stray `total` key in the
  RPC payload is silently dropped; smoke-tested live).
- **`save_section_lines(p_project_id TEXT, p_lines JSONB)`** RPC — DELETE-all + INSERT in one
  transaction, `SECURITY INVOKER`, `search_path = public`. A **mirror of
  `save_estimate_line_items`** but **separate from `save_estimate`**, so a section-line save
  never rides the Step 4 line-item replace (and vice-versa). `sort_order` arrives pre-set
  from the gateway's array index.
- **RLS** — `section_lines_tenant_policy`, a single `FOR ALL TO authenticated` policy with the
  **exact** `estimate_line_items` tenant predicate (`EXISTS (SELECT 1 FROM projects … AND
  projects.tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()))`). Real predicate
  → does **not** trip `rls_policy_always_true`.

### `db.ts` gateway (no page wiring)
- `getSectionLines(projectId)` → `EstimateSectionLine[]`, ordered `sort_order ASC`
  (AGENTS.md sort-order integrity), maps snake→camel.
- `saveSectionLines(projectId, lines)` → calls the RPC; `sort_order` from array index;
  **THROWS on failure** (authored estimator inputs must persist — not fire-and-forget).
- Helpers `SECTION_LINE_COLUMNS`, `mapSectionLineFromRow`, `buildSectionLinePayload`
  (never emits `total`).
- New types in `src/types/db.ts`: `SectionDiscriminator` (`'gc' | 'site_ops'`) +
  `EstimateSectionLine`.

### Tests
- New `src/lib/__tests__/sectionLinesDb.test.ts` (9 tests, chainable-supabase mock mirroring
  `estimateBindingsDb.test.ts`): RPC payload shape + array-index `sort_order` (stale
  `sortOrder` field is overridden), `source` defaults to `'template'`, throw-on-error for both
  save & read, read orders by `sort_order ASC` + snake→camel mapping, `inputs`/`source`/`updatedAt`
  null-defaults, **round-trip** (save out-of-order → reload ordered, riding the *actual* saved
  payload), and a no-`total`-property assertion throughout.

### Verification (Phase A2 exit — all green)
- Live smoke test (via `execute_sql`): `save_section_lines` round-tripped two lines on a real
  project, returned them `sort_order ASC` (the lower-`sort_order` line first despite being last
  in the array), the bogus `total:999` key was dropped, `inputs` persisted, `source` defaulted —
  then the smoke rows were deleted (table back to 0).
- `list_tables`: 21 → **22 tables**; `estimate_section_lines` present, `rls_enabled: true`.
- `get_advisors` (security): **12 WARN before === 12 WARN after** (the same 11 unrelated
  admin-table `rls_policy_always_true` + 1 `auth_leaked_password_protection`) — **no new
  finding** for the new table.
- `generate_typescript_types` confirms the live shape (no `total`, `inputs: Json`, required
  `entry_kind`, FK to projects, `save_section_lines` fn). The repo does **not** track a
  generated types file — hand-written `@/types/db` + camelCase mappers — so this was a
  verification artifact, **not committed**.
- `npm run test` → **90 files / 1073 tests pass** (A1's 1064 + 9 new). All 3 export goldens
  (McKenna / synthetic / CARE) tie **$0.00** unchanged (nothing consumes the table).
- `npx tsc --noEmit` clean. `eslint` on the changed files: 0 errors (1 *pre-existing*
  `_projectId` unused-var warning at `db.ts:1346`, not from this change).

### Discoveries / gotchas for later phases
- **`execute_sql` runs as a privileged role and bypasses RLS**, so the live smoke test proves
  the table/RPC/ordering, NOT the tenant policy from a client's perspective. The tenant scoping
  is verified structurally (byte-identical predicate to `line_items_tenant_policy`) + by the
  clean advisor. A real cross-tenant denial is only observable once a page authenticates as a
  user (A3+ / manual `/verify`).
- **Design calls baked in (architect-approved):** single `updated_at` (no `created_at`) because
  the table is full-replace-saved per project, like `estimate_line_items` (which has no
  timestamps); `section` CHECK-enforced vs `entry_kind` open free-TEXT; `id TEXT` + composite PK
  (app-supplied stable IDs that A5 turns into `line:<id>:total` graph nodes), not a DB UUID.
- **`saveSectionLines` stamps `sort_order` from the array index** (mirrors
  `buildLineItemPayload`). A3 must therefore hand it lines **in the desired visual order** — the
  per-line `sortOrder` field on `EstimateSectionLine` is ignored on write (it only carries the
  value back on read). Keep this in mind so manual positions round-trip.
- **`entry_kind` vocabulary is A3's to define.** The DB is blind. Suggested set from the A1 calc
  configs: `staffRole` | `operationalExpense` | `equipment` (Step 2 structured), `dynamic`
  (Step 3 structured), `qty` | `qtyRate` | `lumpSum` (the manual/one-off kinds). Pick the set
  in A3 and pin it in a shared const so A5's graph projection and B2/B3's grids agree.

---

## Phase A3 — the next phase (NO DDL)

**Goal (plan §"Phase A3"):** a pure synthesis module that turns the **legacy JSONB blobs** into
`estimate_section_lines` rows in memory on load, feeds them to the **A1-parameterized engine**,
and proves the result is byte-identical to today's blob-driven path — then persists to the new
table on next save while **still** writing the legacy blobs (strangler-fig dual-read/dual-write).
**App-born projects only** (imported projects are Phase A4, the #1 risk, deliberately isolated).

### Scope (from the plan, ID-2)
- **Pure synthesis module** (e.g. `src/lib/sectionLines/synthesize.ts`): legacy blobs
  (`gc_utilization`, `gc_equipment_overrides`, `site_ops_quantities`, `site_ops_rates`) +
  the A1 catalog constants → `EstimateSectionLine[]` (catalog seed + the project's saved
  inputs). **Mind the `qtyKnox`-style legacy key remapping** the Step 2/3 hooks already do
  (find it in `usePersonnelCalculations.ts` / `useInfrastructureCalculations.ts` — the
  `site_ops_quantities` legacy `qty…` keys).
- Wire Step 2/3 state to **dual-read**: synthesize rows on load, build the line set via A1's
  `buildPersonnelLineSet` / `buildSiteOpsLineSet`, feed `computePersonnelCosts` /
  `computeSiteOperations`, and **assert identical `PersonnelCalcResult` / `SiteOpsCalcResult`**
  to the current blob-driven path.
- **Dual-write:** persist to the new table via `saveSectionLines` on next save while still
  writing the legacy blobs through `save_estimate` (so nothing depends on the new table yet and
  rollback is free).

### Approval gates
- **None** (no DDL; no export change). But treat the **app-born golden + full suite** as the
  hard gate.

### Concrete anchors
- A1 engine + builders: `src/lib/calculations.ts` (`computePersonnelCosts`,
  `computeSiteOperations`, `buildPersonnelLineSet`, `buildSiteOpsLineSet`,
  `DEFAULT_PERSONNEL_LINES`, `DEFAULT_SITE_OPS_LINES`, and the `OneOff*`/`*LineSet` types).
- Catalog constants: `src/lib/constants.ts` (`STAFF_ROLE_DEFAULTS`,
  `OPERATIONAL_EXPENSE_DEFAULTS`, `GC_MANUAL_DEFAULTS`, `EQUIPMENT_*`,
  `SITE_OPS_DYNAMIC_DEFAULTS`, `SITE_OPS_MANUAL_DEFAULTS`; the `*Config` interfaces).
- Production engine callers (still pass args only up to `rateLookup` — the `lines` positional
  is free; passing `undefined` for `rateOverrides`/`rateLookup` correctly triggers their
  defaults): `src/hooks/usePersonnelCalculations.ts`,
  `src/hooks/useInfrastructureCalculations.ts`.
- Gateway: `getSectionLines` / `saveSectionLines` in `src/lib/db.ts`; type
  `EstimateSectionLine` in `src/types/db.ts`.
- Blob columns + `save_estimate` upsert list: `supabase_schema.sql` `project_estimates` (L144–148)
  and the `save_estimate` RPC.

### Exit criteria
- Dual-read produces **byte-identical** `PersonnelCalcResult` / `SiteOpsCalcResult` to the blob
  path for fixtures · **app-born golden ties $0.00** · standard exits (`npm run test` green ·
  `npx tsc --noEmit` clean · committed via `git commit -F` · a `/handoff` sequencing Phase A4).
- **Stop at the Phase A3 boundary — do not start Phase A4** (imported branch).

### Phase A3 kickoff prompt (paste into a fresh session)

> **Branch first (AGENTS.md / LD-5):** confirm you're on `gc-siteops-addressability`
> (`git switch gc-siteops-addressability`); do NOT work on `main`. Confirm the plan file
> `docs/plans/2026-06-16-gc-siteops-addressability-grid-convergence.md` and this handoff are
> present.
>
> Implement **Phase A3** of GC/Site-Ops Addressability & Grid Convergence (read the plan's
> Phase A3 + locked decision ID-2 first). **App-born projects only — imported projects are
> Phase A4, do not touch them.** Build a PURE synthesis module that turns the legacy JSONB
> blobs (`gc_utilization`, `gc_equipment_overrides`, `site_ops_quantities`, `site_ops_rates`,
> incl. the `qtyKnox`-style legacy key remapping the Step 2/3 hooks already do) into
> `EstimateSectionLine[]` (catalog seed from the A1 constants + the project's saved inputs).
> Wire Step 2/3 state to **dual-read**: synthesize on load, build the active line set via A1's
> `buildPersonnelLineSet`/`buildSiteOpsLineSet`, feed `computePersonnelCosts`/
> `computeSiteOperations`, and assert the `PersonnelCalcResult`/`SiteOpsCalcResult` is
> byte-identical to today's blob-driven path. Then **dual-write**: persist to the new table via
> `saveSectionLines` on next save while STILL writing the legacy blobs through `save_estimate`.
> No DDL, no export change. Define the `entry_kind` vocabulary in a shared const (see the A2
> closure's suggested set) so A5/B2/B3 agree. Exit when dual-read is byte-identical for
> fixtures, the **app-born export golden ties $0.00**, `npm run test` is green, `npx tsc
> --noEmit` is clean, the work is committed (`git commit -F`), and a `/handoff` doc sequencing
> **Phase A4** is written. **Stop at the Phase A3 boundary.**

---

## Where this sits in the workstream
Track A: **A1 ✅** → **A2 ✅** (table+gateway, DDL — done) → A3 (lazy synthesis, app-born) →
A4 (imported branch, the #1 risk) → A5 (project to BindingLines). Then A+1
(override-with-audit), then Track B (B1 grid-shell extraction → B2/B3 grids → B4 removable seed
→ B5 one-off escape hatch → B6 finish-migration, DDL). A2 built the persistence seam A3–A5 + B2–B6
all depend on.
