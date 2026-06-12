-- ═════════════════════════════════════════════════════════════════════
-- TAKEOFF BRIDGE — Supabase Schema (Source of Truth)
-- ═════════════════════════════════════════════════════════════════════
--
-- This file is the canonical schema definition for the Supabase database.
-- All schema changes MUST be made here first, then applied to the
-- Supabase Dashboard SQL Editor.
--
-- Tables: 18 (added estimate_versions — Estimate Versioning module)
-- RPC Functions: 4 (save_estimate_line_items, save_estimate,
--   create_estimate_version, submit_estimate_version)
-- Trigger Functions: 4 (custom_step23_line_defs lifecycle guard + updated_at touch
--   — Catalog Manager Phase 2; catalog_additions updated_at touch — Phase 6;
--   estimate_versions freeze guard — Estimate Versioning)
-- RLS Policies: 31 (added estimate_versions SELECT/INSERT/UPDATE — Estimate Versioning)
-- Storage buckets: 1 ('templates', private — Phase 3b)
--
-- TENANT POLICY FORM: the tenant-isolation policies inline the lookup as
-- (SELECT tenant_id FROM users WHERE id = auth.uid()) — there is NO
-- get_auth_tenant_id() helper. This matches what is actually deployed on the
-- live DB (project nefvkrhbbkiqnpeabyqz). A prior version of this file defined
-- and called a (SELECT tenant_id FROM users WHERE id = auth.uid()) helper that was never present in the
-- live database; that file↔DB drift was reconciled 2026-06-08 by rewriting this
-- file to the deployed inline form (file-only change, no live DDL).
--
-- Last updated: 2026-06-11 (Estimate Versioning: new estimate_versions table —
-- named frozen versions of the working copy, one submitted official bid per
-- project (partial-unique index), price history derived at read time from the
-- submitted version. Earlier same day — Catalog Manager Phase 6: new catalog_additions table —
-- the runtime STEP 4 catalog overlay. Self-contained rows (own procore_code +
-- default_unit_price) layered on the harvested built-ins at the catalog chokepoint
-- and both resolvers; cost_code_map / rate_card get NO widening. SELECT/INSERT/
-- UPDATE policies modeled on Table 14, plus an updated_at touch trigger)
-- ═════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────
-- Table 0a: tenants
-- ─────────────────────────────────────────────────
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────
-- Table 0b: users (profiles synced from auth.users)
-- ─────────────────────────────────────────────────
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────
-- Table 1: projects
-- ─────────────────────────────────────────────────
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  square_footage NUMERIC NOT NULL DEFAULT 0,
  unit_count INTEGER NOT NULL DEFAULT 0,
  bid_date TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  building_perimeter NUMERIC,
  building_footprint NUMERIC,
  podium_area NUMERIC,
  woodframed_area NUMERIC,
  levels_above_podium INTEGER,
  expected_start TEXT,
  expected_finish TEXT,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  construction_contingency_rate NUMERIC NOT NULL DEFAULT 0,
  design_contingency_rate NUMERIC NOT NULL DEFAULT 0,
  builders_risk_rate NUMERIC NOT NULL DEFAULT 0,
  special_insurance_rate NUMERIC NOT NULL DEFAULT 0,
  gl_insurance_rate NUMERIC NOT NULL DEFAULT 0.01,
  bond_rate NUMERIC NOT NULL DEFAULT 0,
  fee_rate NUMERIC NOT NULL DEFAULT 0.05,
  -- B-3 (math-trust slice 6, 2026-06-09): default → 'none' (template-faithful;
  -- ties the unrounded company spreadsheet to the cent). Existing rows keep their
  -- persisted value (db.ts writes rounding_rule explicitly on every save), so only
  -- new direct inserts pick up 'none'. Per-project toggle still allows 'dollar'.
  rounding_rule TEXT NOT NULL DEFAULT 'none',
  -- Phase 3a: per-project template selection (multifamily | ti | medical)
  project_type TEXT NOT NULL DEFAULT 'multifamily',
  -- Market sector classification (display label, e.g. 'Healthcare'; '' = unset legacy project)
  market_sector TEXT NOT NULL DEFAULT '',
  -- Import past bids (Phase 1, 2026-06-09): true = this project was created by
  -- importing a finished company-template estimate. A finished bid's GC/Site-Ops
  -- division totals are hand-authored lump sums the app cannot reverse-engineer
  -- into staffing inputs (finding G-2), so for imported projects the workspace
  -- treats the 10 saved linked-division line items as authoritative statics
  -- (their stored qty×unitPrice IS the linked total) rather than recomputing them
  -- from STEP 2/3 — this is what lets a reopened import still tie to the cent.
  is_imported BOOLEAN NOT NULL DEFAULT false,
  -- Database fidelity Phase 1 (2026-06-11): capture fields knowable at import
  -- time but hard to reconstruct later. Both backfillable from the project view.
  -- bid_outcome: did the company win this bid? 'unknown' = legacy/unanswered.
  bid_outcome TEXT NOT NULL DEFAULT 'unknown'
    CHECK (bid_outcome IN ('won', 'lost', 'pending', 'unknown')),
  -- delivery_method: contract type — prices under different delivery methods
  -- are not fully comparable, so history reporting needs this dimension.
  delivery_method TEXT NOT NULL DEFAULT 'unknown'
    CHECK (delivery_method IN ('hard_bid', 'negotiated', 'gmp', 'design_build', 'other', 'unknown'))
);

-- ─────────────────────────────────────────────────
-- Table 2: project_estimates (totals + markups)
-- ─────────────────────────────────────────────────
CREATE TABLE project_estimates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  construction_contingency NUMERIC NOT NULL DEFAULT 0,
  design_contingency NUMERIC NOT NULL DEFAULT 0,
  builders_risk NUMERIC NOT NULL DEFAULT 0,
  special_insurance NUMERIC NOT NULL DEFAULT 0,
  gl_insurance NUMERIC NOT NULL DEFAULT 0,
  bond NUMERIC NOT NULL DEFAULT 0,
  fee NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  general_conditions_total NUMERIC DEFAULT 0,
  gc_utilization JSONB DEFAULT '{}',
  gc_equipment_overrides JSONB DEFAULT '{}',
  site_operations_total NUMERIC DEFAULT 0,
  site_ops_quantities JSONB DEFAULT '{}',
  site_ops_rates JSONB DEFAULT '{}',
  -- Rate-card slice 1, Phase A: point-in-time snapshot of the company rate card
  -- in effect when this estimate was created (Record<line_code, rate>). Empty
  -- '{}' until Phase B wires freeze-at-first-save + backfill; nothing reads it
  -- in Phase A, so day-one behavior is unchanged.
  rate_card_snapshot JSONB DEFAULT '{}',
  -- Imported bids only (architect-approved 2026-06-10): the bid's own hand-
  -- authored STEP 2/3 line detail, captured ONCE at import and read-only
  -- thereafter ({ step2Lines: [...], step3Lines: [...] } — ExtractedSheetLine
  -- shape). Deliberately NOT in the save_estimate RPC's upsert column list, so
  -- workspace auto-save can never overwrite it; written only via
  -- db.ts saveImportedStep23Lines. '{}' for app-born projects and for imports
  -- saved before this column existed (UI shows "re-import to capture detail").
  imported_step23_lines JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id)
);

-- Create enum type if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'data_fidelity_type') THEN
    CREATE TYPE data_fidelity_type AS ENUM ('discrete_unit', 'macro_lump_sum');
  END IF;
END
$$;

-- ─────────────────────────────────────────────────
-- Table 3: estimate_line_items
-- ─────────────────────────────────────────────────
CREATE TABLE estimate_line_items (
  id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  classification TEXT NOT NULL DEFAULT '',
  item_id TEXT NOT NULL DEFAULT '',
  procore_parent_code TEXT NOT NULL DEFAULT '',
  -- Phase 3a: persisted granular Procore code (manual-override support)
  procore_code TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  matched_qty NUMERIC NOT NULL DEFAULT 0,
  uom TEXT NOT NULL DEFAULT 'SF',
  unit_price NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  is_mapped BOOLEAN NOT NULL DEFAULT false,
  raw_quantities JSONB NOT NULL DEFAULT '[]',
  cost_type TEXT NOT NULL DEFAULT 'M',
  custom_fields JSONB DEFAULT '{}',
  data_fidelity data_fidelity_type NOT NULL DEFAULT 'discrete_unit',
  source TEXT NOT NULL DEFAULT 'template',
  PRIMARY KEY (project_id, id)
);

CREATE INDEX idx_line_items_sort ON estimate_line_items (project_id, sort_order);

-- ─────────────────────────────────────────────────
-- Table 4: project_column_defs
-- ─────────────────────────────────────────────────
CREATE TABLE project_column_defs (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  column_defs JSONB NOT NULL DEFAULT '[]'
);

-- ─────────────────────────────────────────────────
-- Table 5: project_locked_cells
-- ─────────────────────────────────────────────────
CREATE TABLE project_locked_cells (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  locked_cells JSONB NOT NULL DEFAULT '{}'
);

-- ─────────────────────────────────────────────────
-- Table 6: project_registries
-- ─────────────────────────────────────────────────
CREATE TABLE project_registries (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  registry JSONB NOT NULL DEFAULT '{}'
);

-- ─────────────────────────────────────────────────
-- Table 7: global_registry (tenant-scoped)
-- ─────────────────────────────────────────────────
CREATE TABLE global_registry (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id INTEGER NOT NULL DEFAULT 1,
  registry JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id)
);

-- ═════════════════════════════════════════════════════════════════════
-- RPC: Atomic Line Item Save
-- ═════════════════════════════════════════════════════════════════════
--
-- Wraps DELETE + INSERT in a single PostgreSQL transaction.
-- If either step fails, the entire operation rolls back.
-- Called from client via: supabase.rpc('save_estimate_line_items', { ... })
-- ═════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION save_estimate_line_items(
  p_project_id TEXT,
  p_items JSONB
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Step 1: Delete all existing line items for this project
  DELETE FROM estimate_line_items WHERE project_id = p_project_id;

  -- Step 2: Insert all current items with sort_order from array index
  INSERT INTO estimate_line_items (
    id, project_id, sort_order, classification, item_id,
    procore_parent_code, procore_code, description, matched_qty, uom,
    unit_price, total, is_mapped, raw_quantities, cost_type,
    custom_fields, data_fidelity, source
  )
  SELECT
    item->>'id',
    p_project_id,
    (item->>'sort_order')::INTEGER,
    COALESCE(item->>'classification', ''),
    COALESCE(item->>'item_id', ''),
    COALESCE(item->>'procore_parent_code', ''),
    COALESCE(item->>'procore_code', ''),
    COALESCE(item->>'description', ''),
    COALESCE((item->>'matched_qty')::NUMERIC, 0),
    COALESCE(item->>'uom', 'SF'),
    COALESCE((item->>'unit_price')::NUMERIC, 0),
    COALESCE((item->>'total')::NUMERIC, 0),
    COALESCE((item->>'is_mapped')::BOOLEAN, false),
    COALESCE(item->'raw_quantities', '[]'::JSONB),
    COALESCE(item->>'cost_type', 'M'),
    COALESCE(item->'custom_fields', '{}'::JSONB),
    COALESCE(item->>'data_fidelity', 'discrete_unit')::data_fidelity_type,
    COALESCE(item->>'source', 'template')
  FROM jsonb_array_elements(p_items) AS item;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════
-- RPC: Atomic Estimate Save (totals + line items in one transaction)
-- ═════════════════════════════════════════════════════════════════════
--
-- Composes the project_estimates upsert AND the line-item DELETE+INSERT
-- into a SINGLE PostgreSQL transaction. Before this existed, the auto-save
-- hook issued two independent calls (saveProjectEstimate + the line-item
-- RPC) via Promise.all; if one succeeded and the other failed, the stored
-- header totals could move without their backing line items (or vice versa).
-- This RPC makes that impossible: either both land or neither does.
--
-- SECURITY INVOKER (the default — no SECURITY DEFINER clause) so the caller's
-- RLS on project_estimates + estimate_line_items still applies; this is NOT a
-- privilege-escalating function. search_path is pinned to public.
--
-- The line-item replace is delegated to save_estimate_line_items() so the
-- INSERT column list / COALESCE defaults stay defined in exactly one place.
-- The nested call runs inside this function's transaction, so a failure in
-- either step rolls the whole thing back.
--
-- Called from client via: supabase.rpc('save_estimate', { p_estimate, p_items })
-- p_estimate carries project_id plus the snake_case totals/markups columns.
-- ═════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION save_estimate(
  p_estimate JSONB,
  p_items JSONB
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_project_id TEXT := p_estimate->>'project_id';
BEGIN
  IF v_project_id IS NULL OR v_project_id = '' THEN
    RAISE EXCEPTION 'save_estimate: p_estimate.project_id is required';
  END IF;

  -- Step 1: Upsert totals/markups (single row per project)
  INSERT INTO project_estimates (
    project_id, subtotal, construction_contingency, design_contingency,
    builders_risk, special_insurance, gl_insurance, bond, fee, total_cost,
    general_conditions_total, gc_utilization, gc_equipment_overrides,
    site_operations_total, site_ops_quantities, site_ops_rates,
    rate_card_snapshot, updated_at
  )
  VALUES (
    v_project_id,
    COALESCE((p_estimate->>'subtotal')::NUMERIC, 0),
    COALESCE((p_estimate->>'construction_contingency')::NUMERIC, 0),
    COALESCE((p_estimate->>'design_contingency')::NUMERIC, 0),
    COALESCE((p_estimate->>'builders_risk')::NUMERIC, 0),
    COALESCE((p_estimate->>'special_insurance')::NUMERIC, 0),
    COALESCE((p_estimate->>'gl_insurance')::NUMERIC, 0),
    COALESCE((p_estimate->>'bond')::NUMERIC, 0),
    COALESCE((p_estimate->>'fee')::NUMERIC, 0),
    COALESCE((p_estimate->>'total_cost')::NUMERIC, 0),
    COALESCE((p_estimate->>'general_conditions_total')::NUMERIC, 0),
    COALESCE(p_estimate->'gc_utilization', '{}'::JSONB),
    COALESCE(p_estimate->'gc_equipment_overrides', '{}'::JSONB),
    COALESCE((p_estimate->>'site_operations_total')::NUMERIC, 0),
    COALESCE(p_estimate->'site_ops_quantities', '{}'::JSONB),
    COALESCE(p_estimate->'site_ops_rates', '{}'::JSONB),
    COALESCE(p_estimate->'rate_card_snapshot', '{}'::JSONB),
    now()
  )
  ON CONFLICT (project_id) DO UPDATE SET
    subtotal = EXCLUDED.subtotal,
    construction_contingency = EXCLUDED.construction_contingency,
    design_contingency = EXCLUDED.design_contingency,
    builders_risk = EXCLUDED.builders_risk,
    special_insurance = EXCLUDED.special_insurance,
    gl_insurance = EXCLUDED.gl_insurance,
    bond = EXCLUDED.bond,
    fee = EXCLUDED.fee,
    total_cost = EXCLUDED.total_cost,
    general_conditions_total = EXCLUDED.general_conditions_total,
    gc_utilization = EXCLUDED.gc_utilization,
    gc_equipment_overrides = EXCLUDED.gc_equipment_overrides,
    site_operations_total = EXCLUDED.site_operations_total,
    site_ops_quantities = EXCLUDED.site_ops_quantities,
    site_ops_rates = EXCLUDED.site_ops_rates,
    rate_card_snapshot = EXCLUDED.rate_card_snapshot,
    updated_at = EXCLUDED.updated_at;

  -- Step 2: Atomic line-item replace (delegates to the single-source RPC)
  PERFORM save_estimate_line_items(v_project_id, p_items);
END;
$$;

-- ═════════════════════════════════════════════════════════════════════
-- Table 8: classification_history (AI training data pipeline)
-- ═════════════════════════════════════════════════════════════════════
--
-- Records every classification → cost code resolution for future
-- AI-driven auto-mapping. Each row is an immutable training observation.
-- ═════════════════════════════════════════════════════════════════════

CREATE TABLE classification_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  classification  TEXT NOT NULL,
  resolved_code   TEXT NOT NULL,
  project_id      TEXT REFERENCES projects(id) ON DELETE SET NULL,
  resolved_by     TEXT NOT NULL DEFAULT 'seed',
  confidence      NUMERIC DEFAULT 1.0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_classification_history_lookup
  ON classification_history (classification, resolved_code);

CREATE INDEX idx_classification_history_project
  ON classification_history (project_id);

ALTER TABLE classification_history ENABLE ROW LEVEL SECURITY;

-- Tenant-scoped + append-only (training-data immutability, AGENTS.md). The prior
-- "anon_full_access" FOR ALL USING(true) had no TO clause, so the pre-login anon
-- browser key could read/write/delete every tenant's resolution history.
-- SELECT: global/seed rows (project_id IS NULL) stay readable as shared training
-- data; per-project rows are isolated to the owning tenant. INSERT: a client may
-- only record a resolution against a project its tenant owns. No UPDATE/DELETE
-- policy → rows are immutable to clients (each resolution is a frozen observation).
-- NOTE: the tenant predicate is inlined as (SELECT tenant_id FROM users WHERE
-- id = auth.uid()) to match the form actually deployed by the live tenant policies.
-- (Historical note: an earlier version of this file defined and called a
-- (SELECT tenant_id FROM users WHERE id = auth.uid()) helper that was never present in the deployed DB;
-- that file↔DB drift was reconciled 2026-06-08 by rewriting every tenant policy
-- in this file to this same inline form and removing the phantom helper.)
CREATE POLICY "classification_history_select_policy" ON classification_history
  FOR SELECT
  TO authenticated
  USING (
    project_id IS NULL OR EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = classification_history.project_id
      AND p.tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
    )
  );

CREATE POLICY "classification_history_insert_policy" ON classification_history
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = classification_history.project_id
    AND p.tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  ));

-- ═════════════════════════════════════════════════════════════════════
-- Table 9: estimate_snapshots (Version history / milestones)
-- ═════════════════════════════════════════════════════════════════════
--
-- Frozen copies of estimate state at explicit user milestones
-- and automatic pre-import checkpoints. Provides undo-beyond-session
-- capability and clean training data for price prediction models.
-- ═════════════════════════════════════════════════════════════════════

CREATE TABLE estimate_snapshots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  snapshot_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  snapshot_type  TEXT NOT NULL DEFAULT 'auto',
  label          TEXT DEFAULT '',
  line_items     JSONB NOT NULL,
  summary        JSONB DEFAULT '{}',
  metadata       JSONB DEFAULT '{}'
);

CREATE INDEX idx_snapshots_project
  ON estimate_snapshots (project_id, snapshot_at DESC);

ALTER TABLE estimate_snapshots ENABLE ROW LEVEL SECURITY;

-- Tenant-scoped + append-only (frozen milestone captures, AGENTS.md). The prior
-- "anon_full_access" FOR ALL USING(true) had no TO clause, so the pre-login anon
-- browser key could read/write/delete every tenant's frozen bid line items.
-- SELECT + INSERT are gated by the projects tenant-join (mirrors
-- line_items_tenant_policy). No UPDATE/DELETE policy → snapshots are immutable to
-- clients once written.
CREATE POLICY "estimate_snapshots_select_policy" ON estimate_snapshots
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = estimate_snapshots.project_id
    AND p.tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  ));

CREATE POLICY "estimate_snapshots_insert_policy" ON estimate_snapshots
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = estimate_snapshots.project_id
    AND p.tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  ));

-- ═════════════════════════════════════════════════════════════════════
-- Trigger: Auto-provision Tenant + User Profile on Auth Signup
-- ═════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  -- 1. Create a default tenant for the new user
  INSERT INTO public.tenants (name)
  VALUES (COALESCE(new.raw_user_meta_data->>'company_name', 'Corporate Workspace'))
  RETURNING id INTO v_tenant_id;

  -- 2. Create the user profile referencing the new tenant
  INSERT INTO public.users (id, email, tenant_id)
  VALUES (new.id, new.email, v_tenant_id);

  -- 3. Initialize the tenant's global corporate registry
  INSERT INTO public.global_registry (tenant_id, id, registry)
  VALUES (v_tenant_id, 1, '{}'::jsonb);

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- This is a signup TRIGGER function only; it is never meant to be called as an
-- RPC. Triggers fire regardless of role EXECUTE grants, so revoking EXECUTE from
-- the API roles removes the /rest/v1/rpc/handle_new_user attack surface (a
-- SECURITY DEFINER function callable by anon/authenticated) without breaking signup.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;

-- Trigger binding
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ═════════════════════════════════════════════════════════════════════
-- Row Level Security (Scoped Identity-Aware Tenant Isolation Filters)
-- ═════════════════════════════════════════════════════════════════════
--
-- Tenant isolation inlines the lookup as
--   (SELECT tenant_id FROM users WHERE id = auth.uid())
-- directly in each policy — this is the form deployed on the live DB. No
-- get_auth_tenant_id() helper exists (a prior file-only phantom, removed
-- 2026-06-08). The inline subquery does not recurse: the users table's own
-- users_select_policy is USING(true), so the predicate resolves cleanly.

-- 1. tenants
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenants_isolation_policy" ON tenants
  FOR ALL
  TO authenticated
  USING (id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- 2. users
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_select_policy" ON users
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "users_modify_policy" ON users
  FOR ALL
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- 3. projects
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "projects_tenant_policy" ON projects
  FOR ALL
  TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- 4. project_estimates
ALTER TABLE project_estimates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "estimates_tenant_policy" ON project_estimates
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = project_estimates.project_id
    AND projects.tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = project_estimates.project_id
    AND projects.tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  ));

-- 5. estimate_line_items
ALTER TABLE estimate_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "line_items_tenant_policy" ON estimate_line_items
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = estimate_line_items.project_id
    AND projects.tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = estimate_line_items.project_id
    AND projects.tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  ));

-- 6. project_column_defs
ALTER TABLE project_column_defs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "column_defs_tenant_policy" ON project_column_defs
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = project_column_defs.project_id
    AND projects.tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = project_column_defs.project_id
    AND projects.tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  ));

-- 7. project_locked_cells
ALTER TABLE project_locked_cells ENABLE ROW LEVEL SECURITY;
CREATE POLICY "locked_cells_tenant_policy" ON project_locked_cells
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = project_locked_cells.project_id
    AND projects.tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = project_locked_cells.project_id
    AND projects.tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  ));

-- 8. project_registries
ALTER TABLE project_registries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "registries_tenant_policy" ON project_registries
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = project_registries.project_id
    AND projects.tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = project_registries.project_id
    AND projects.tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  ));

-- 9. global_registry
ALTER TABLE global_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "global_registry_tenant_policy" ON global_registry
  FOR ALL
  TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()))
  WITH CHECK (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- ─────────────────────────────────────────────────
-- Table 10: template_config
-- ─────────────────────────────────────────────────
CREATE TABLE template_config (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_name TEXT NOT NULL UNIQUE,
  sheet_name    TEXT NOT NULL DEFAULT 'STEP 4 - ESTIMATE',
  config_type   TEXT NOT NULL DEFAULT 'layout',
  config_data   JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Phase 3a: per-project-type template selection (wired in Phase 3b)
  project_type  TEXT
);

ALTER TABLE template_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "template_config_select_policy" ON template_config
  FOR SELECT
  TO authenticated
  USING (true);

-- Phase 3b: config_data is the self-describing layout object for the template.
--   divisions  — STEP 4 division row ranges (also feeds UI division labels)
--   anchors    — bottom-of-sheet row geometry. Derived in code (not stored):
--                auto-filter/print-area boundary = subtotalRow - 1 (330);
--                dimension end = reconStartRow + 3 (349);
--                data start = divisions[0].headerRow (10), column headers = 9;
--                grand total = subtotalRow + grandTotalOffset (341);
--                modifier rows = subtotalRow + modifierStartOffset..modifierEndOffset (333–339)
--   sheetNames — Procore rollup sheets resolved by the exporter
-- The app THROWS if this row is missing or still in the legacy bare-array
-- shape — there is no hardcoded fallback (Phase 3b removed DEFAULT_LAYOUT_CONFIG).
--
-- Rollback to the pre-3b shape (legacy array):
--   UPDATE template_config SET config_data = config_data->'divisions', updated_at = now()
--   WHERE template_name = 'Company_Estimate_Template.xlsx' AND jsonb_typeof(config_data) = 'object';
INSERT INTO template_config (template_name, sheet_name, config_type, config_data)
VALUES (
  'Company_Estimate_Template.xlsx',
  'STEP 4 - ESTIMATE',
  'layout',
  '{
   "divisions": [
    {"division": "01", "headerRow": 10, "startRow": 11, "endRow": 14, "label": "DIVISION 01 — GENERAL CONDITIONS"},
    {"division": "02", "headerRow": 15, "startRow": 16, "endRow": 25, "label": "DIVISION 02 — SITE OPERATIONS"},
    {"division": "03", "headerRow": 26, "startRow": 27, "endRow": 52, "label": "DIVISION 03 — CONCRETE"},
    {"division": "04", "headerRow": 53, "startRow": 54, "endRow": 62, "label": "DIVISION 04 — MASONRY"},
    {"division": "05", "headerRow": 63, "startRow": 64, "endRow": 72, "label": "DIVISION 05 — METALS"},
    {"division": "06", "headerRow": 73, "startRow": 74, "endRow": 92, "label": "DIVISION 06 — WOOD, PLASTICS, COMPOSITES"},
    {"division": "07", "headerRow": 93, "startRow": 94, "endRow": 130, "label": "DIVISION 07 — THERMAL & MOISTURE PROTECTION"},
    {"division": "08", "headerRow": 131, "startRow": 132, "endRow": 149, "label": "DIVISION 08 — OPENINGS"},
    {"division": "09", "headerRow": 150, "startRow": 151, "endRow": 164, "label": "DIVISION 09 — FINISHES"},
    {"division": "10", "headerRow": 165, "startRow": 166, "endRow": 189, "label": "DIVISION 10 — SPECIALTIES"},
    {"division": "11", "headerRow": 190, "startRow": 191, "endRow": 199, "label": "DIVISION 11 — EQUIPMENT"},
    {"division": "12", "headerRow": 200, "startRow": 201, "endRow": 211, "label": "DIVISION 12 — FURNISHINGS"},
    {"division": "13", "headerRow": 212, "startRow": 213, "endRow": 219, "label": "DIVISION 13 — SPECIAL CONSTRUCTION"},
    {"division": "14", "headerRow": 220, "startRow": 221, "endRow": 226, "label": "DIVISION 14 — CONVEYING EQUIPMENT"},
    {"division": "21", "headerRow": 227, "startRow": 228, "endRow": 231, "label": "DIVISION 21 — FIRE SUPPRESSION"},
    {"division": "22", "headerRow": 232, "startRow": 233, "endRow": 238, "label": "DIVISION 22 — PLUMBING"},
    {"division": "23", "headerRow": 239, "startRow": 240, "endRow": 242, "label": "DIVISION 23 — HVAC"},
    {"division": "26", "headerRow": 243, "startRow": 244, "endRow": 250, "label": "DIVISION 26 — ELECTRICAL"},
    {"division": "27", "headerRow": 251, "startRow": 252, "endRow": 255, "label": "DIVISION 27 — COMMUNICATIONS"},
    {"division": "28", "headerRow": 256, "startRow": 257, "endRow": 262, "label": "DIVISION 28 — ELECTRONIC SAFETY AND SECURITY"},
    {"division": "31", "headerRow": 263, "startRow": 264, "endRow": 270, "label": "DIVISION 31 — EARTHWORK"},
    {"division": "32", "headerRow": 271, "startRow": 272, "endRow": 291, "label": "DIVISION 32 — EXTERIOR IMPROVEMENTS"},
    {"division": "33", "headerRow": 292, "startRow": 293, "endRow": 304, "label": "DIVISION 33 — UTILITIES"},
    {"division": "50", "headerRow": 305, "startRow": 306, "endRow": 315, "label": "DIVISION 50 — WINTER CONDITIONS"},
    {"division": "80", "headerRow": 316, "startRow": 317, "endRow": 330, "label": "DIVISION 80 — ALLOWANCES"}
   ],
   "anchors": {
    "subtotalRow": 331,
    "modifierStartOffset": 2,
    "modifierEndOffset": 8,
    "grandTotalOffset": 10,
    "reconStartRow": 346
   },
   "sheetNames": {
    "budgetLineItems": "Budget Line Items",
    "importerDataFields": "Importer Data Fields"
   }
  }'::jsonb
)
ON CONFLICT (template_name) DO UPDATE
SET sheet_name = EXCLUDED.sheet_name,
    config_type = EXCLUDED.config_type,
    config_data = EXCLUDED.config_data,
    updated_at = now();

-- ─────────────────────────────────────────────────
-- Storage: 'templates' bucket (Phase 3b — private)
-- ─────────────────────────────────────────────────
--
-- Holds corporate estimate template .xlsx files (runtime source for exports).
-- Private: the file moved OUT of /public so it is no longer downloadable
-- without authentication. The git-tracked canonical copy lives at
-- templates/Company_Estimate_Template.xlsx; `npm run upload-template`
-- (service role) pushes it into this bucket.

INSERT INTO storage.buckets (id, name, public)
VALUES ('templates', 'templates', false)
ON CONFLICT (id) DO NOTHING;

-- Read: any signed-in user (mirrors template_config's access model).
-- NO insert/update/delete policies: writes happen only via the
-- service-role upload script / dashboard (service role bypasses RLS).
CREATE POLICY "templates_bucket_select_policy" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'templates');

-- Rollback (template file is also still served from /public until the
-- post-verification cleanup commit removes it):
--   DROP POLICY "templates_bucket_select_policy" ON storage.objects;
--   DELETE FROM storage.objects WHERE bucket_id = 'templates';
--   DELETE FROM storage.buckets WHERE id = 'templates';

-- ─────────────────────────────────────────────────
-- Table 11: cost_code_map (Phase 3a — app-owned granular Procore mapping)
-- ─────────────────────────────────────────────────
--
-- Maps internal itemId codes (STEP 4 granularity, e.g. '03-0000.001') to
-- granular Procore Budget Line Items codes (e.g. '3-33543.000') per template.
-- Replaces the SUMIF cell-pins inside the .xlsx as the mapping source of truth.
--
-- source provenance: 'template' (authoritative BLI SUMIF criterion or
-- Steps-2/3 division-base fallback), 'sibling' (orphan routed to its
-- XX-YYYY.001 sibling's code), 'manual' (user-confirmed / mapping-editor edit).
--
-- Seed data (221 rows for Company_Estimate_Template.xlsx) is generated by
-- `npm run generate-seed` → `supabase_seed_cost_code_map.sql` from
-- src/lib/estimate-catalog.json + scripts/output/cost-code-gaps.json.
--
-- UPDATE POLICY (Phase 3c, user-approved 2026-06-05): the seed is INSERT-ONLY
-- (ON CONFLICT DO NOTHING). Template re-harvests only ADD rows for brand-new
-- internal codes; they NEVER change existing mappings. The /cost-codes
-- mapping-editor UI (db.ts/updateCostCodeMapping, stamps source='manual') is
-- the SOLE update path for existing rows — no script may silently move a
-- financial mapping. At runtime this table is the single mapping authority:
-- every row-creation path resolves procoreCode through
-- src/lib/costCodeResolver.ts (primed from this table), never the catalog JSON.

CREATE TABLE cost_code_map (
  template_name TEXT NOT NULL,
  internal_code TEXT NOT NULL,
  procore_code  TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'template'
                CHECK (source IN ('template', 'sibling', 'manual')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (template_name, internal_code)
);

ALTER TABLE cost_code_map ENABLE ROW LEVEL SECURITY;

-- Read: consistent with template_config
CREATE POLICY "cost_code_map_select_policy" ON cost_code_map
  FOR SELECT
  TO authenticated
  USING (true);

-- Write: UPDATE-only, required by the Phase 3c mapping-editor UI (db.ts/
-- updateCostCodeMapping, manual edits stored with source='manual'). Narrowed from
-- the prior FOR ALL so the browser can no longer INSERT or DELETE mapping rows —
-- the editor only updates existing rows, and the seed runs via migration/service
-- role (which bypasses RLS). Corporate template data, not tenant-scoped.
-- FOLLOW-UP (deferred): move writes server-side (service-role only) to fully close
-- the "any authenticated user can re-point a financial mapping" exposure.
CREATE POLICY "cost_code_map_update_policy" ON cost_code_map
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Phase 3a one-time backfill (run after seeding cost_code_map):
-- hydrates procore_code for line items saved before the column existed,
-- replacing the retired client-side catalog hydration in db.ts.
--
--   UPDATE estimate_line_items eli
--   SET procore_code = m.procore_code
--   FROM cost_code_map m
--   WHERE m.template_name = 'Company_Estimate_Template.xlsx'
--     AND m.internal_code = eli.item_id
--     AND eli.procore_code = '';

-- ─────────────────────────────────────────────────
-- Table 12: rate_card (Rate-card slice 1, Phase A — company default rates)
-- ─────────────────────────────────────────────────
--
-- Lifts the hard-coded GC/Site Ops default RATES out of src/lib/constants.ts
-- into an admin-editable, DB-backed company rate card. Architecturally an exact
-- twin of cost_code_map (where dollars LAND); this table holds how MUCH a line
-- costs per unit. Keyed by the constants.ts line `code` (e.g. '01-0310.001'),
-- one row per rate-bearing GC/Site Ops line (44 rows for the master template).
-- Lump-sum / qty-rate lines (estimator-typed dollar amounts, rate null) carry
-- NO row here.
--
-- source provenance: 'seed' (generated from constants.ts — equals today's
-- values, so nothing changes on day one), 'manual' (future /rates editor edit,
-- Phase C). The future market-sector / project_type dimension is added later
-- via migration when that feature is built — no dormant column now (mirrors
-- the cost_code_map precedent).
--
-- Seed data (44 rows for Company_Estimate_Template.xlsx) is generated by
-- `npm run generate-rate-card-seed` → `supabase_seed_rate_card.sql` from the
-- src/lib/constants.ts typed arrays (imported directly — no second source of
-- truth, no regex parsing).
--
-- UPDATE POLICY (twin of cost_code_map): the seed is INSERT-ONLY
-- (ON CONFLICT DO NOTHING). Re-running the generator only ADDS rows for
-- brand-new rate lines; it NEVER clobbers a source='manual' editor edit. The
-- /rates editor UI (db.ts/updateRateCardEntry, stamps source='manual') is the
-- SOLE update path for existing rows. At runtime the company-default layer is
-- resolved through src/lib/rateResolver.ts (primed from this table); per-project
-- snapshots (project_estimates.rate_card_snapshot) and per-project overrides
-- sit on top — Phase B.

CREATE TABLE rate_card (
  template_name TEXT NOT NULL,
  line_code     TEXT NOT NULL,          -- constants.ts line `code`, e.g. '01-0310.001'
  rate          NUMERIC NOT NULL,
  source        TEXT NOT NULL DEFAULT 'seed'
                CHECK (source IN ('seed', 'manual')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (template_name, line_code)
);

ALTER TABLE rate_card ENABLE ROW LEVEL SECURITY;

-- Read: consistent with cost_code_map / template_config (corporate template data)
CREATE POLICY "rate_card_select_policy" ON rate_card
  FOR SELECT
  TO authenticated
  USING (true);

-- Write: UPDATE-only, required by the /rates editor UI (db.ts/updateRateCardEntry,
-- manual edits stored with source='manual'). Narrowed from the prior FOR ALL so the
-- browser can no longer INSERT or DELETE rate rows — the editor only updates existing
-- rows, and the seed runs via migration/service role (which bypasses RLS). Corporate
-- template data, not tenant-scoped — mirrors cost_code_map's access model.
-- FOLLOW-UP (deferred): move writes server-side (service-role only) to fully close
-- the "any authenticated user can edit a company rate" exposure.
CREATE POLICY "rate_card_update_policy" ON rate_card
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- INSERT policy (Catalog Manager Phase 4 — thin promotion). Required by
-- db.ts/promoteCustomStep23LineDef: a promoted custom GC/Site-Ops code gets ONE
-- opt-in rate_card row so /rates shows it with its label/unit and the existing
-- audited ADOPT path works over its mined STEP 2/3 history — nothing more (no
-- calculator visibility; architect-locked 2026-06-11). THE deliberate widening of
-- this prior UPDATE-only table; promotion is one-way (no DELETE policy). The seed
-- still runs via migration/service role (which bypasses RLS). Adds ONE expected
-- rls_policy_always_true advisor WARN, mirroring the cost_code_map /
-- custom_step23_line_defs UPDATE precedent.
-- FOLLOW-UP (deferred, same CONSOLIDATED note shared by cost_code_map / rate_card
-- / custom_step23_line_defs): move writes server-side (service-role only) to fully
-- close the "any authenticated user can insert/edit a company rate" exposure.
CREATE POLICY "rate_card_insert_policy" ON rate_card
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ═════════════════════════════════════════════════════════════════════
-- Table 13: estimate_overrides (Phase 4 — Override + Audit Model)
-- ═════════════════════════════════════════════════════════════════════
--
-- Append-only audit trail of estimator overrides of computed estimate values.
-- One immutable row per override EVENT (a "set" or a "revert"). The engine uses
-- override_value IN PLACE of the computed value but ALWAYS carries computed_value
-- alongside (glass-box UI, Phase 5, shows both). Consistent with the append-only
-- ethos of classification_history / estimate_snapshots: never UPDATE/DELETE —
-- a change of mind appends a new row.
--
-- Active override per (project_id, field) = the LATEST row by created_at. A row
-- with override_value IS NULL is a REVERT tombstone (the field falls back to the
-- computed value). An override_value of 0 is a REAL override (INV-3: explicit zero
-- is honored, never confused with "no override").
--
-- field: the computed value being overridden — a TakeoffSummary key (subtotal |
--   constructionContingency | designContingency | buildersRisk | specialInsurance |
--   glInsurance | bond | fee | totalEstimatedCost). Free TEXT (no CHECK) so Phase 5
--   can extend the overridable set without a migration; the engine applies only the
--   keys it knows (OVERRIDABLE_SUMMARY_FIELDS in src/lib/calculations.ts).

CREATE TABLE estimate_overrides (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  field           TEXT NOT NULL,
  computed_value  NUMERIC,            -- engine value at time of override (audit; NULL if unknown)
  override_value  NUMERIC,            -- value used in place; NULL = revert to computed (tombstone)
  reason          TEXT NOT NULL DEFAULT '',
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_estimate_overrides_lookup
  ON estimate_overrides (project_id, created_at DESC);

ALTER TABLE estimate_overrides ENABLE ROW LEVEL SECURITY;

-- Tenant-scoped + append-only (mirrors classification_history / estimate_snapshots).
-- SELECT + INSERT gated by the projects tenant-join; NO UPDATE/DELETE policy →
-- rows are immutable to clients. Tenant predicate inlined as (SELECT tenant_id FROM
-- users WHERE id = auth.uid()) to match the form deployed by the live tenant policies
-- (no get_auth_tenant_id() helper).
CREATE POLICY "estimate_overrides_select_policy" ON estimate_overrides
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = estimate_overrides.project_id
    AND p.tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  ));

CREATE POLICY "estimate_overrides_insert_policy" ON estimate_overrides
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = estimate_overrides.project_id
    AND p.tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  ));

-- ─────────────────────────────────────────────────
-- Table 14: custom_step23_line_defs (import STEP 2/3 review gate, Phase 2)
-- ─────────────────────────────────────────────────
--
-- User-minted GC/Site-Ops line DEFINITIONS (architect-locked 2026-06-10: new-code
-- creation happens at the import gate, not the future Catalog Manager). When no
-- built-in constants.ts line fits an imported bid's STEP 2/3 line, the estimator
-- mints a deterministic code here (e.g. '02-4100.003' "Demolition - Openings in
-- CMU"). The step23Normalization resolver overlays these rows on the built-in
-- defs AT RENDER TIME, so a minted code labels the matching line in every stored
-- bid — past and future — with no re-import.
--
-- A custom code may NEVER shadow a built-in one: db.ts/createCustomStep23LineDef
-- rejects collisions against the static STEP23_LINE_DEFS at mint time, and the
-- resolver prefers the built-in if constants.ts later ships the same code (the
-- conflict surfaces in the UI as the built-in label; renumbering tooling is
-- Catalog Manager scope). label drives description auto-resolution (it defaults
-- to the minted line's as-bid description). procore_code is nullable — optional
-- at mint; Catalog Manager fills it in later. These are labels, resolver targets,
-- and /rates mining keys ONLY: no rate_card row, no calculator line, no ADOPT.
--
-- source provenance: 'import_gate' (minted at the import review gate — the sole
-- write path this phase), 'manual' (future Catalog Manager edits).

CREATE TABLE custom_step23_line_defs (
  code         TEXT PRIMARY KEY
               CHECK (code ~ '^\d{2}-\d{4}\.\d{3}$'),  -- deterministic NN-NNNN.NNN only
  label        TEXT NOT NULL
               CHECK (btrim(label) <> ''),             -- the auto-resolution key
  unit         TEXT NOT NULL DEFAULT '',               -- as-bid UOM ('' when the bid had none)
  procore_code TEXT,                                   -- nullable; Catalog Manager backfills
  source       TEXT NOT NULL DEFAULT 'import_gate'
               CHECK (source IN ('import_gate', 'manual')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE custom_step23_line_defs ENABLE ROW LEVEL SECURITY;

-- Read: corporate data, consistent with cost_code_map / rate_card.
CREATE POLICY "custom_step23_line_defs_select_policy" ON custom_step23_line_defs
  FOR SELECT
  TO authenticated
  USING (true);

-- Write: INSERT (mint, import review gate) + UPDATE (lifecycle, Catalog Manager).
-- db.ts validates shape + built-in/custom collisions before the write; the CHECK
-- constraints + the lifecycle guard trigger (below) are the server-side backstop.
-- No DELETE policy → a code's row is never removed; retire/merge are tombstones.
-- FOLLOW-UP (deferred, same CONSOLIDATED note now shared by cost_code_map /
-- rate_card / custom_step23_line_defs): move writes server-side (service-role
-- only) to fully close the "any authenticated user can mint/edit a code" exposure
-- — accepted for a single-company tool (plan §Risks; flagged at the Phase 2 gate).
CREATE POLICY "custom_step23_line_defs_insert_policy" ON custom_step23_line_defs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ─────────────────────────────────────────────────
-- Table 14 LIFECYCLE LAYER (Catalog Manager, Phase 2)
-- ─────────────────────────────────────────────────
--
-- A minted code's row is NEVER deleted. It transitions (architect-locked
-- 2026-06-11, merge/retire = redirects + tombstones):
--   active → retired  (leaves every picker; still labels its old lines)
--   active → merged   (redirects to a WINNER; every stored bid shows the winner
--                      at render time — no imported payload is ever rewritten)
-- A winner (merged_into) may be ANY active def — custom OR built-in — so there is
-- intentionally NO FK on merged_into (a built-in winner lives only in constants.ts).
-- These rules MIRROR src/lib/catalogLifecycle.ts (transitionError) and the db.ts
-- write surface; the trigger is the authority no client bug can bypass.

ALTER TABLE custom_step23_line_defs
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'retired', 'merged')),
  ADD COLUMN merged_into TEXT
    CHECK (merged_into IS NULL OR merged_into ~ '^\d{2}-\d{4}\.\d{3}$'),  -- shape only; no FK (winner may be a built-in)
  -- merged ⇔ merged_into consistency, declaratively (the guard trigger raises the
  -- clean message first on UPDATE; this CHECK is the always-on backstop and also
  -- guards direct INSERTs): merged requires a non-self winner; non-merged is NULL.
  ADD CONSTRAINT custom_step23_line_defs_merge_consistency CHECK (
    (status = 'merged' AND merged_into IS NOT NULL AND merged_into <> code)
    OR (status <> 'merged' AND merged_into IS NULL)
  );

-- Lifecycle guard (BEFORE UPDATE): mirrors catalogLifecycle.transitionError so the
-- DB row and the browser enforce the SAME rule. SET search_path = '' pins schema
-- resolution (only pg_catalog built-ins are referenced) — keeps the security
-- advisor clean (no function_search_path_mutable). SECURITY INVOKER (default).
CREATE OR REPLACE FUNCTION custom_step23_line_defs_lifecycle_guard()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  -- code (PK) is immutable.
  IF NEW.code <> OLD.code THEN
    RAISE EXCEPTION 'Custom code is immutable (% cannot become %).', OLD.code, NEW.code;
  END IF;

  -- Status transitions: only an active code may transition, and only to
  -- retired/merged. A merged→merged re-point (chain-collapse) keeps status equal
  -- and is allowed; the consistency block below validates the new winner.
  IF NEW.status <> OLD.status THEN
    IF OLD.status <> 'active' THEN
      RAISE EXCEPTION 'Code % is %; only active codes can be retired or merged.', OLD.code, OLD.status;
    END IF;
    IF NEW.status NOT IN ('retired', 'merged') THEN
      RAISE EXCEPTION 'Cannot transition % to "%".', OLD.code, NEW.status;
    END IF;
  END IF;

  -- merged ⇔ merged_into consistency (clean messages mirroring transitionError).
  IF NEW.status = 'merged' THEN
    IF NEW.merged_into IS NULL OR btrim(NEW.merged_into) = '' THEN
      RAISE EXCEPTION 'A merged code requires a winning code.';
    END IF;
    IF NEW.merged_into = NEW.code THEN
      RAISE EXCEPTION 'A code cannot be merged into itself.';
    END IF;
  ELSIF NEW.merged_into IS NOT NULL THEN
    RAISE EXCEPTION 'A non-merged code carries no merge target.';
  END IF;

  RETURN NEW;
END;
$$;

-- updated_at touch (BEFORE UPDATE). Fires AFTER the guard (trigger names fire in
-- alphabetical order: ..._lifecycle_guard_trg < ..._touch_updated_at_trg).
CREATE OR REPLACE FUNCTION touch_custom_step23_line_defs_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER custom_step23_line_defs_lifecycle_guard_trg
  BEFORE UPDATE ON custom_step23_line_defs
  FOR EACH ROW
  EXECUTE FUNCTION custom_step23_line_defs_lifecycle_guard();

CREATE TRIGGER custom_step23_line_defs_touch_updated_at_trg
  BEFORE UPDATE ON custom_step23_line_defs
  FOR EACH ROW
  EXECUTE FUNCTION touch_custom_step23_line_defs_updated_at();

-- UPDATE policy: THE deliberate widening of the by-design-immutable table (the
-- guard trigger is what makes it safe). USING/WITH CHECK are (true) — the trigger,
-- not the policy predicate, enforces legal lifecycle transitions. This adds one
-- expected rls_policy_always_true advisor WARN, mirroring the cost_code_map /
-- rate_card UPDATE precedent. Carries the same consolidated server-side-writes
-- follow-up note above.
CREATE POLICY "custom_step23_line_defs_update_policy" ON custom_step23_line_defs
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ─────────────────────────────────────────────────
-- Table 15: catalog_additions (Catalog Manager Phase 6 — STEP 4 runtime overlay)
-- ─────────────────────────────────────────────────
--
-- In-app additions to the STEP 4 catalog: a brand-new catalog code an estimator
-- creates on /catalog (Phase 7 UI) that works everywhere immediately — pickers,
-- import matching, row birth, mapping, rates — with no redeploy and no agent
-- session. The catalog chokepoint (src/lib/catalog.ts) overlays these rows on the
-- harvested built-ins (ESTIMATE_ITEMS_MASTER) at render time; a built-in ALWAYS
-- wins a code collision (the harvested template is the source of truth).
--
-- SELF-CONTAINED (architect-locked 2026-06-11): an addition carries its OWN
-- procore_code and default_unit_price, so cost_code_map / rate_card get NO policy
-- widening for adds. The cost-code resolver overlays this procore_code and the
-- catalog-price resolver overlays this default_unit_price for addition itemIds.
--
-- status: 'active' (live overlay) | 'landed' (its code now ships in a fresh
-- estimate-catalog.json harvest — the built-in wins the overlay by construction;
-- the row stays as the audit/provenance + reconciliation record).
--
-- source provenance: 'catalog_manager' (created via the /catalog Add-code UI —
-- the sole write path) | 'manual' (reserved for future tooling).
--
-- FREEZE-AT-BIRTH: default_unit_price reaches a row ONLY at birth (template init /
-- import / itemId change resolve through the catalog-price overlay). A saved row
-- persists its own unit_price, so editing an addition never retro-moves it.

CREATE TABLE catalog_additions (
  item_id            TEXT PRIMARY KEY
                     CHECK (item_id ~ '^\d{2}-\d{4}\.\d{3}$'),  -- catalog code shape NN-NNNN.NNN
  description        TEXT NOT NULL
                     CHECK (btrim(description) <> ''),          -- import-match / display label
  target_uom         TEXT NOT NULL DEFAULT '',                  -- '' when the addition has none
  default_unit_price NUMERIC NOT NULL DEFAULT 0,                -- birth-time price (may be a negative deduction)
  cost_type          TEXT NOT NULL DEFAULT 'M'
                     CHECK (cost_type IN ('L', 'M', 'S', 'E')), -- Labor / Materials / Subcontract / Equipment
  procore_code       TEXT NOT NULL                              -- names a valid Procore BLI at birth (app-validated
                     CHECK (btrim(procore_code) <> ''),         --   against the Importer list; shape varies, no regex)
  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'landed')),
  source             TEXT NOT NULL DEFAULT 'catalog_manager'
                     CHECK (source IN ('catalog_manager', 'manual')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE catalog_additions ENABLE ROW LEVEL SECURITY;

-- Read: corporate data, consistent with cost_code_map / rate_card / template_config.
-- (SELECT USING(true) is intentionally NOT flagged by the rls_policy_always_true linter.)
CREATE POLICY "catalog_additions_select_policy" ON catalog_additions
  FOR SELECT
  TO authenticated
  USING (true);

-- Write: INSERT (create a STEP 4 code, /catalog Add-code UI) + UPDATE (edit +
-- mark-landed). db.ts validates shape + built-in/addition collision + Procore-list
-- membership before the write; the CHECK constraints are the server-side backstop.
-- No DELETE policy → an addition's row is never removed (audit/provenance + the
-- landed reconciliation record). THE deliberate widening for this new table — adds
-- two expected rls_policy_always_true advisor WARNs (INSERT WITH CHECK true; UPDATE
-- USING/WITH CHECK true), mirroring the rate_card / custom_step23_line_defs precedent.
-- FOLLOW-UP (deferred, same CONSOLIDATED note shared by cost_code_map / rate_card /
-- custom_step23_line_defs): move writes server-side (service-role only) to fully
-- close the "any authenticated user can add/edit a catalog code" exposure — accepted
-- for a single-company tool (plan §Risks; flagged at the Phase 6 gate).
CREATE POLICY "catalog_additions_insert_policy" ON catalog_additions
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "catalog_additions_update_policy" ON catalog_additions
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- updated_at touch (BEFORE UPDATE), mirroring the custom_step23_line_defs pattern.
-- SET search_path = '' pins schema resolution (only pg_catalog built-ins referenced)
-- — keeps the function_search_path_mutable advisor clean. SECURITY INVOKER (default).
CREATE OR REPLACE FUNCTION touch_catalog_additions_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER catalog_additions_touch_updated_at_trg
  BEFORE UPDATE ON catalog_additions
  FOR EACH ROW
  EXECUTE FUNCTION touch_catalog_additions_updated_at();

-- ─────────────────────────────────────────────────
-- Table 16: estimate_versions (Estimate Versioning module)
-- ─────────────────────────────────────────────────
--
-- Named, frozen versions of a project's live working copy. The team always
-- edits ONE live copy (project_estimates + estimate_line_items); "Save
-- Version" freezes that copy here with a user title. Versions are drafts —
-- invisible to cost history — until the SUBMIT action marks exactly one as
-- the project's official bid (the partial-unique index below is THE
-- single-official-bid invariant). Cost history is derived AT READ TIME from
-- whichever version is currently submitted (db.ts getBidPriceHistory), so
-- submitting v3 after v2 automatically withdraws v2's observations and
-- replaces them with v3's — no history table is ever written, and
-- double-counting is impossible by construction.
--
-- line_items: frozen snake_case rows in the exact save_estimate payload shape
-- (db.ts buildLineItemPayload). summary: the TakeoffSummary numbers copied
-- verbatim from the calculation engine at freeze time (calculations.ts is the
-- sole authority — nothing here derives a dollar).
--
-- IMMUTABILITY: a version's payload is frozen at creation. The freeze-guard
-- trigger below rejects any UPDATE that touches anything besides the
-- submission flag pair (is_submitted, submitted_at) — the only mutable state.
-- No DELETE policy → versions are never removed by clients.

CREATE TABLE estimate_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,            -- per-project, assigned by create_estimate_version
  title          TEXT NOT NULL DEFAULT '',
  line_items     JSONB NOT NULL,              -- frozen snake_case rows (save_estimate payload shape)
  summary        JSONB NOT NULL DEFAULT '{}', -- TakeoffSummary copied verbatim from the engine
  metadata       JSONB NOT NULL DEFAULT '{}',
  is_submitted   BOOLEAN NOT NULL DEFAULT false,
  submitted_at   TIMESTAMPTZ,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, version_number),
  CONSTRAINT estimate_versions_submit_consistency CHECK (
    (is_submitted AND submitted_at IS NOT NULL)
    OR (NOT is_submitted AND submitted_at IS NULL))
);

-- THE single-official-bid invariant: at most one submitted version per project.
CREATE UNIQUE INDEX idx_estimate_versions_one_submitted
  ON estimate_versions (project_id) WHERE is_submitted;

CREATE INDEX idx_estimate_versions_project
  ON estimate_versions (project_id, version_number DESC);

ALTER TABLE estimate_versions ENABLE ROW LEVEL SECURITY;

-- Tenant-scoped via the projects join (mirrors estimate_snapshots). SELECT +
-- INSERT + UPDATE only; UPDATE exists solely for the submission flag flip and
-- is constrained to that by the freeze-guard trigger. No DELETE policy.
-- Tenant predicate inlined as (SELECT tenant_id FROM users WHERE id =
-- auth.uid()) to match the form deployed by the live tenant policies.
CREATE POLICY "estimate_versions_select_policy" ON estimate_versions
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = estimate_versions.project_id
    AND p.tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  ));

CREATE POLICY "estimate_versions_insert_policy" ON estimate_versions
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = estimate_versions.project_id
    AND p.tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  ));

CREATE POLICY "estimate_versions_update_policy" ON estimate_versions
  FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = estimate_versions.project_id
    AND p.tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = estimate_versions.project_id
    AND p.tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  ));

-- Freeze guard (BEFORE UPDATE): a version's payload is immutable — only the
-- submission flag pair may change. Mirrors the custom_step23_line_defs
-- lifecycle-guard pattern: the trigger, not the policy predicate, is the
-- authority no client bug can bypass. SET search_path = '' pins schema
-- resolution (only pg_catalog built-ins referenced). SECURITY INVOKER (default).
CREATE OR REPLACE FUNCTION estimate_versions_freeze_guard()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.version_number IS DISTINCT FROM OLD.version_number
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.line_items IS DISTINCT FROM OLD.line_items
     OR NEW.summary IS DISTINCT FROM OLD.summary
     OR NEW.metadata IS DISTINCT FROM OLD.metadata
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'estimate_versions rows are frozen: only the submission flag (is_submitted, submitted_at) may change.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER estimate_versions_freeze_guard_trg
  BEFORE UPDATE ON estimate_versions
  FOR EACH ROW
  EXECUTE FUNCTION estimate_versions_freeze_guard();

-- ═════════════════════════════════════════════════════════════════════
-- RPC: Create Estimate Version (atomic per-project numbering)
-- ═════════════════════════════════════════════════════════════════════
--
-- Freezes the live working copy as the next numbered version in one
-- transaction: MAX(version_number)+1 and the INSERT commit together, so two
-- saves can never mint the same number silently (the UNIQUE constraint is the
-- backstop for a same-moment race — one caller gets a clean retryable error).
--
-- SECURITY INVOKER (default) — the caller's INSERT policy (projects tenant
-- join) still applies; this is NOT privilege-escalating. search_path pinned.
-- Called from client via: supabase.rpc('create_estimate_version', { ... })

CREATE OR REPLACE FUNCTION create_estimate_version(
  p_project_id TEXT,
  p_title TEXT,
  p_line_items JSONB,
  p_summary JSONB
)
RETURNS estimate_versions
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_row estimate_versions;
BEGIN
  IF p_project_id IS NULL OR p_project_id = '' THEN
    RAISE EXCEPTION 'create_estimate_version: p_project_id is required';
  END IF;

  INSERT INTO estimate_versions (
    project_id, version_number, title, line_items, summary, created_by
  )
  VALUES (
    p_project_id,
    COALESCE(
      (SELECT MAX(version_number) FROM estimate_versions
        WHERE project_id = p_project_id),
      0
    ) + 1,
    COALESCE(p_title, ''),
    COALESCE(p_line_items, '[]'::jsonb),
    COALESCE(p_summary, '{}'::jsonb),
    auth.uid()
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════
-- RPC: Submit Estimate Version (the one doorway into cost history)
-- ═════════════════════════════════════════════════════════════════════
--
-- Marks one version as the project's official bid in a single transaction:
-- clears the currently submitted version (if any), then sets the target.
-- Either both flips land or neither does — combined with the partial-unique
-- index, a project can never carry two submitted versions, so cost history
-- (derived at read time from the submitted version) can never double-count.
-- Re-submitting the already-submitted version is a clean no-op.
--
-- SECURITY INVOKER (default) — the caller's UPDATE policy still applies, and
-- the freeze-guard trigger confines both UPDATEs to the submission flag pair.
-- Called from client via: supabase.rpc('submit_estimate_version', { ... })

CREATE OR REPLACE FUNCTION submit_estimate_version(
  p_project_id TEXT,
  p_version_id UUID
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Step 1: withdraw the current official bid, if it isn't the target itself.
  UPDATE estimate_versions
     SET is_submitted = false, submitted_at = NULL
   WHERE project_id = p_project_id
     AND is_submitted
     AND id <> p_version_id;

  -- Step 2: mark the target as the official bid.
  UPDATE estimate_versions
     SET is_submitted = true, submitted_at = now()
   WHERE id = p_version_id
     AND project_id = p_project_id
     AND NOT is_submitted;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    -- Already submitted → no-op. Anything else → the target doesn't exist
    -- under this project (or this tenant's RLS view): fail loudly.
    IF NOT EXISTS (
      SELECT 1 FROM estimate_versions
       WHERE id = p_version_id AND project_id = p_project_id AND is_submitted
    ) THEN
      RAISE EXCEPTION 'submit_estimate_version: version % not found for project %',
        p_version_id, p_project_id;
    END IF;
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────
-- Table 17: procore_cost_codes (Procore Cost Codes master list — Phase 1)
-- ─────────────────────────────────────────────────
--
-- The company's authoritative Procore cost-code master list: (code, type,
-- description) for all 217 codes exported from Procore. Becomes the type-aware
-- source of truth for "what Procore codes exist" — the join spine for the later
-- actuals/final-cost workstream. The hard-coded src/lib/procore-valid-codes.json
-- (224 codes, no type) is DEMOTED to a drift check in Phase 4; this phase only
-- builds + seeds the table (JSON stays the live export-validation oracle, and no
-- consumer reads this table yet — getProcoreCostCodes() is added unwired).
--
-- code: the Procore cost code (e.g. '1-10000.000', '11-110000.000'). Procore's
-- shape varies (N-NNNNN.000 / NN-NNNNNN.000) and differs from the estimate-side
-- NN-NNNN.NNN catalog shape — so NO regex CHECK (non-empty only), mirroring the
-- catalog_additions.procore_code precedent.
--
-- type: Procore's classification — Labor / Material / Subcontract / Equipment.
-- Equipment has no estimate-side counterpart (the estimate catalog carries L/M/S);
-- the Phase 3 advisory surfaces that gap. Seed split (217): Material 98,
-- Subcontract 110, Labor 8, Equipment 1.
--
-- LIFECYCLE (tombstone/redirect — MIRRORS custom_step23_line_defs Phase 2): a
-- code's row is NEVER deleted. It transitions active → retired (a code Procore no
-- longer uses; stays for the historical join) or active → merged (redirects to a
-- WINNER named by merged_into). merged_into carries no FK (a winner is just
-- another code string) and no regex (Procore shape varies); the guard trigger +
-- consistency CHECK are the backstop. The 7 codes in the JSON oracle but not in
-- this list (Phase 1 reconciliation report, docs/plans/2026-06-12-procore-cost-
-- codes-reconciliation.md) are resolved per-code in Phase 4 — retired or merged,
-- never blind-deleted (2-20000.000 Site Operations is a LIVE rollup target: 8
-- cost_code_map rows + 8 saved line items point at it).

CREATE TABLE procore_cost_codes (
  code        TEXT PRIMARY KEY
              CHECK (btrim(code) <> ''),
  type        TEXT NOT NULL
              CHECK (type IN ('Labor', 'Material', 'Subcontract', 'Equipment')),
  description TEXT NOT NULL
              CHECK (btrim(description) <> ''),
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'retired', 'merged')),
  merged_into TEXT,  -- redirect target; no FK (winner is any code string), no regex (Procore shape varies)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- merged ⇔ merged_into consistency (declarative backstop; the guard trigger
  -- raises the clean message first on UPDATE — this also guards direct INSERTs).
  CONSTRAINT procore_cost_codes_merge_consistency CHECK (
    (status = 'merged' AND merged_into IS NOT NULL AND merged_into <> code)
    OR (status <> 'merged' AND merged_into IS NULL)
  )
);

ALTER TABLE procore_cost_codes ENABLE ROW LEVEL SECURITY;

-- Read: corporate data, consistent with cost_code_map / rate_card / catalog_additions.
CREATE POLICY "procore_cost_codes_select_policy" ON procore_cost_codes
  FOR SELECT
  TO authenticated
  USING (true);

-- Write: INSERT (Phase 2 spreadsheet import-apply) + UPDATE (Phase 4 lifecycle:
-- retire/merge). db.ts validates shape before the write; the CHECK constraints +
-- lifecycle guard trigger are the server-side backstop. No DELETE policy → a
-- code's row is never removed (retire/merge are tombstones/redirects). Adds the
-- two expected rls_policy_always_true advisor WARNs (INSERT WITH CHECK true; UPDATE
-- USING/WITH CHECK true), mirroring the catalog_additions / cost_code_map /
-- rate_card / custom_step23_line_defs precedent — carries the same consolidated
-- "move writes server-side (service-role only)" follow-up. Both write policies are
-- added now so Phases 2 & 4 need no DDL.
CREATE POLICY "procore_cost_codes_insert_policy" ON procore_cost_codes
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "procore_cost_codes_update_policy" ON procore_cost_codes
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Lifecycle guard (BEFORE UPDATE): mirrors custom_step23_line_defs_lifecycle_guard.
-- code (PK) is immutable; only an active code may transition, and only to
-- retired/merged; merged ⇔ non-self merged_into. SET search_path = '' pins schema
-- resolution (only pg_catalog built-ins referenced) — keeps the security advisor
-- clean (no function_search_path_mutable). SECURITY INVOKER (default).
CREATE OR REPLACE FUNCTION procore_cost_codes_lifecycle_guard()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  IF NEW.code <> OLD.code THEN
    RAISE EXCEPTION 'Procore code is immutable (% cannot become %).', OLD.code, NEW.code;
  END IF;

  IF NEW.status <> OLD.status THEN
    IF OLD.status <> 'active' THEN
      RAISE EXCEPTION 'Code % is %; only active codes can be retired or merged.', OLD.code, OLD.status;
    END IF;
    IF NEW.status NOT IN ('retired', 'merged') THEN
      RAISE EXCEPTION 'Cannot transition % to "%".', OLD.code, NEW.status;
    END IF;
  END IF;

  IF NEW.status = 'merged' THEN
    IF NEW.merged_into IS NULL OR btrim(NEW.merged_into) = '' THEN
      RAISE EXCEPTION 'A merged code requires a winning code.';
    END IF;
    IF NEW.merged_into = NEW.code THEN
      RAISE EXCEPTION 'A code cannot be merged into itself.';
    END IF;
  ELSIF NEW.merged_into IS NOT NULL THEN
    RAISE EXCEPTION 'A non-merged code carries no merge target.';
  END IF;

  RETURN NEW;
END;
$$;

-- updated_at touch (BEFORE UPDATE), mirroring the custom_step23_line_defs pattern.
-- SET search_path = '' pins schema resolution. SECURITY INVOKER (default).
CREATE OR REPLACE FUNCTION touch_procore_cost_codes_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Trigger names fire alphabetically: _lifecycle_guard_trg < _touch_updated_at_trg
-- (guard validates, then updated_at is stamped) — mirrors custom_step23_line_defs.
CREATE TRIGGER procore_cost_codes_lifecycle_guard_trg
  BEFORE UPDATE ON procore_cost_codes
  FOR EACH ROW
  EXECUTE FUNCTION procore_cost_codes_lifecycle_guard();

CREATE TRIGGER procore_cost_codes_touch_updated_at_trg
  BEFORE UPDATE ON procore_cost_codes
  FOR EACH ROW
  EXECUTE FUNCTION touch_procore_cost_codes_updated_at();
