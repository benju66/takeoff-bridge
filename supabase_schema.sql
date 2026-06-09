-- ═════════════════════════════════════════════════════════════════════
-- TAKEOFF BRIDGE — Supabase Schema (Source of Truth)
-- ═════════════════════════════════════════════════════════════════════
--
-- This file is the canonical schema definition for the Supabase database.
-- All schema changes MUST be made here first, then applied to the
-- Supabase Dashboard SQL Editor.
--
-- Tables: 14 (added rate_card — Rate-card slice 1, Phase A)
-- RPC Functions: 2 (save_estimate_line_items, save_estimate)
-- RLS Policies: 20
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
-- Last updated: 2026-06-08 (schema-drift reconciliation: dropped the phantom
-- get_auth_tenant_id() helper; tenant policies rewritten to the deployed inline
-- (SELECT tenant_id FROM users WHERE id = auth.uid()) form)
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
  rounding_rule TEXT NOT NULL DEFAULT 'dollar',
  -- Phase 3a: per-project template selection (multifamily | ti | medical)
  project_type TEXT NOT NULL DEFAULT 'multifamily',
  -- Market sector classification (display label, e.g. 'Healthcare'; '' = unset legacy project)
  market_sector TEXT NOT NULL DEFAULT ''
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

