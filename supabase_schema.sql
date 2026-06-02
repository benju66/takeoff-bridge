-- ═════════════════════════════════════════════════════════════════════
-- TAKEOFF BRIDGE — Supabase Schema (Source of Truth)
-- ═════════════════════════════════════════════════════════════════════
--
-- This file is the canonical schema definition for the Supabase database.
-- All schema changes MUST be made here first, then applied to the
-- Supabase Dashboard SQL Editor.
--
-- Tables: 9 (added tenants, users)
-- RPC Functions: 1 (save_estimate_line_items)
-- RLS Policies: 9 (scoped, identity-aware tenant isolation filters)
--
-- Last updated: 2026-06-02
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
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- ─────────────────────────────────────────────────
-- Table 2: project_estimates (totals + markups)
-- ─────────────────────────────────────────────────
CREATE TABLE project_estimates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  general_liability NUMERIC NOT NULL DEFAULT 0,
  fee NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  general_conditions_total NUMERIC DEFAULT 0,
  gc_utilization JSONB DEFAULT '{}',
  gc_equipment_overrides JSONB DEFAULT '{}',
  site_operations_total NUMERIC DEFAULT 0,
  site_ops_quantities JSONB DEFAULT '{}',
  site_ops_rates JSONB DEFAULT '{}',
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
AS $$
BEGIN
  -- Step 1: Delete all existing line items for this project
  DELETE FROM estimate_line_items WHERE project_id = p_project_id;

  -- Step 2: Insert all current items with sort_order from array index
  INSERT INTO estimate_line_items (
    id, project_id, sort_order, classification, item_id,
    procore_parent_code, description, matched_qty, uom,
    unit_price, total, is_mapped, raw_quantities, cost_type,
    custom_fields, data_fidelity
  )
  SELECT
    item->>'id',
    p_project_id,
    (item->>'sort_order')::INTEGER,
    COALESCE(item->>'classification', ''),
    COALESCE(item->>'item_id', ''),
    COALESCE(item->>'procore_parent_code', ''),
    COALESCE(item->>'description', ''),
    COALESCE((item->>'matched_qty')::NUMERIC, 0),
    COALESCE(item->>'uom', 'SF'),
    COALESCE((item->>'unit_price')::NUMERIC, 0),
    COALESCE((item->>'total')::NUMERIC, 0),
    COALESCE((item->>'is_mapped')::BOOLEAN, false),
    COALESCE(item->'raw_quantities', '[]'::JSONB),
    COALESCE(item->>'cost_type', 'M'),
    COALESCE(item->'custom_fields', '{}'::JSONB),
    COALESCE(item->>'data_fidelity', 'discrete_unit')::data_fidelity_type
  FROM jsonb_array_elements(p_items) AS item;
END;
$$;

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger binding
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ═════════════════════════════════════════════════════════════════════
-- Helper: Secure Tenant Lookup (Prevents RLS Policy Circular Recursion)
-- ═════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_auth_tenant_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM public.users WHERE id = auth.uid();
$$;

-- ═════════════════════════════════════════════════════════════════════
-- Row Level Security (Scoped Identity-Aware Tenant Isolation Filters)
-- ═════════════════════════════════════════════════════════════════════

-- 1. tenants
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenants_isolation_policy" ON tenants
  FOR ALL
  TO authenticated
  USING (id = public.get_auth_tenant_id());

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
  USING (tenant_id = public.get_auth_tenant_id())
  WITH CHECK (tenant_id = public.get_auth_tenant_id());

-- 4. project_estimates
ALTER TABLE project_estimates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "estimates_tenant_policy" ON project_estimates
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = project_estimates.project_id
    AND projects.tenant_id = public.get_auth_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = project_estimates.project_id
    AND projects.tenant_id = public.get_auth_tenant_id()
  ));

-- 5. estimate_line_items
ALTER TABLE estimate_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "line_items_tenant_policy" ON estimate_line_items
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = estimate_line_items.project_id
    AND projects.tenant_id = public.get_auth_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = estimate_line_items.project_id
    AND projects.tenant_id = public.get_auth_tenant_id()
  ));

-- 6. project_column_defs
ALTER TABLE project_column_defs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "column_defs_tenant_policy" ON project_column_defs
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = project_column_defs.project_id
    AND projects.tenant_id = public.get_auth_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = project_column_defs.project_id
    AND projects.tenant_id = public.get_auth_tenant_id()
  ));

-- 7. project_locked_cells
ALTER TABLE project_locked_cells ENABLE ROW LEVEL SECURITY;
CREATE POLICY "locked_cells_tenant_policy" ON project_locked_cells
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = project_locked_cells.project_id
    AND projects.tenant_id = public.get_auth_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = project_locked_cells.project_id
    AND projects.tenant_id = public.get_auth_tenant_id()
  ));

-- 8. project_registries
ALTER TABLE project_registries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "registries_tenant_policy" ON project_registries
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = project_registries.project_id
    AND projects.tenant_id = public.get_auth_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = project_registries.project_id
    AND projects.tenant_id = public.get_auth_tenant_id()
  ));

-- 9. global_registry
ALTER TABLE global_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "global_registry_tenant_policy" ON global_registry
  FOR ALL
  TO authenticated
  USING (tenant_id = public.get_auth_tenant_id())
  WITH CHECK (tenant_id = public.get_auth_tenant_id());
