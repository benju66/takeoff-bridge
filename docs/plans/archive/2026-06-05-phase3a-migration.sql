-- ═════════════════════════════════════════════════════════════════════
-- Phase 3a migration: cost_code_map + procore_code persistence + project_type
-- Applied: branch `phase-3a` first, then main (2026-06-05).
-- Canonical schema: supabase_schema.sql. Seed: supabase_seed_cost_code_map.sql
-- (appended below at apply time via npm run generate-seed output).
-- ═════════════════════════════════════════════════════════════════════

-- 1. New table: app-owned granular Procore mapping
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

CREATE POLICY "cost_code_map_select_policy" ON cost_code_map
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "cost_code_map_write_policy" ON cost_code_map
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 2. Column adds
ALTER TABLE estimate_line_items ADD COLUMN procore_code TEXT NOT NULL DEFAULT '';
ALTER TABLE projects            ADD COLUMN project_type TEXT NOT NULL DEFAULT 'multifamily';
ALTER TABLE template_config     ADD COLUMN project_type TEXT;

-- 3. RPC update: persist procore_code through the atomic save
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

-- 4. Seed: contents of supabase_seed_cost_code_map.sql (221 rows,
--    ON CONFLICT DO NOTHING) are appended here at apply time.

-- 5. Backfill: hydrate procore_code for rows saved before the column
--    existed (replaces the retired client-side catalog hydration).
--    Runs AFTER the seed.
-- UPDATE estimate_line_items eli
-- SET procore_code = m.procore_code
-- FROM cost_code_map m
-- WHERE m.template_name = 'Company_Estimate_Template.xlsx'
--   AND m.internal_code = eli.item_id
--   AND eli.procore_code = '';
