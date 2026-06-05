-- ═════════════════════════════════════════════════════════════════════
-- TAKEOFF BRIDGE — Supabase Schema (Source of Truth)
-- ═════════════════════════════════════════════════════════════════════
--
-- This file is the canonical schema definition for the Supabase database.
-- All schema changes MUST be made here first, then applied to the
-- Supabase Dashboard SQL Editor.
--
-- Tables: 13 (added cost_code_map — Phase 3a)
-- RPC Functions: 1 (save_estimate_line_items)
-- RLS Policies: 16 (15 tenant-scoped + 1 storage.objects read policy — Phase 3b)
-- Storage buckets: 1 ('templates', private — Phase 3b)
--
-- Last updated: 2026-06-05 (Phase 3b: private templates bucket; config_data
-- becomes the self-describing {divisions, anchors, sheetNames} object)
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
  project_type TEXT NOT NULL DEFAULT 'multifamily'
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
CREATE POLICY "anon_full_access" ON classification_history FOR ALL USING (true) WITH CHECK (true);

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
CREATE POLICY "anon_full_access" ON estimate_snapshots FOR ALL USING (true) WITH CHECK (true);

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

-- Write: required by the Phase 3c mapping-editor UI (all writes via db.ts,
-- manual edits stored with source='manual'). Table is corporate template
-- data, not tenant-scoped — mirrors template_config's access model.
CREATE POLICY "cost_code_map_write_policy" ON cost_code_map
  FOR ALL
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

