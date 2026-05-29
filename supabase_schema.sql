-- ═════════════════════════════════════════════════════════════════════
-- TAKEOFF BRIDGE — Supabase Schema (Source of Truth)
-- ═════════════════════════════════════════════════════════════════════
--
-- This file is the canonical schema definition for the Supabase database.
-- All schema changes MUST be made here first, then applied to the
-- Supabase Dashboard SQL Editor.
--
-- Tables: 7
-- RPC Functions: 1 (save_estimate_line_items)
-- RLS Policies: 7 (anonymous full access — development phase)
--
-- Last updated: 2026-05-29
-- ═════════════════════════════════════════════════════════════════════

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
  expected_finish TEXT
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
-- Table 7: global_registry (singleton)
-- ─────────────────────────────────────────────────
CREATE TABLE global_registry (
  id INTEGER PRIMARY KEY DEFAULT 1,
  registry JSONB NOT NULL DEFAULT '{}'
);

-- Insert the singleton row
INSERT INTO global_registry (id, registry) VALUES (1, '{}');

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
    custom_fields
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
    COALESCE(item->'custom_fields', '{}'::JSONB)
  FROM jsonb_array_elements(p_items) AS item;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════
-- Row Level Security (Anonymous Access — Development Phase)
-- ═════════════════════════════════════════════════════════════════════

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_full_access" ON projects FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE project_estimates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_full_access" ON project_estimates FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE estimate_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_full_access" ON estimate_line_items FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE project_column_defs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_full_access" ON project_column_defs FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE project_locked_cells ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_full_access" ON project_locked_cells FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE project_registries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_full_access" ON project_registries FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE global_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_full_access" ON global_registry FOR ALL USING (true) WITH CHECK (true);
