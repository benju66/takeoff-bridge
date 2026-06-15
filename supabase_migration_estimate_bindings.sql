-- ═════════════════════════════════════════════════════════════════════
-- MIGRATION: estimate_bindings (Linked Values System — Phase 3)
-- ═════════════════════════════════════════════════════════════════════
--
-- Adds the estimate_bindings table — persisted authored bindings (lookups +
-- rollups), the generalization of the hardcoded 10 linked-division rows into
-- the open binding model. MUTABLE (UPDATE/DELETE allowed, unlike the append-only
-- estimate_overrides; LD-3), so RLS is a single FOR ALL tenant policy mirroring
-- line_items_tenant_policy exactly (NOT the append-only SELECT/INSERT split). The
-- tenant predicate is inlined as (SELECT tenant_id FROM users WHERE id = auth.uid())
-- to match the form deployed by the live tenant policies (there is NO
-- get_auth_tenant_id() helper).
--
-- kind is FREE TEXT / no CHECK (open enum, mirrors estimate_overrides.field) so a
-- future 'expression' kind needs zero schema change; the DB is blind to binding kind,
-- the full rule lives in the definition JSONB ({ basis, rule }). Stored binding VALUES
-- are never trusted — recomputed from source on load. The export tie-out goldens are
-- unaffected: a binding changes HOW a value computes, not the export skeleton.
--
-- This file is the migration record; the canonical definition lives in
-- supabase_schema.sql (Table 19). Applied to project nefvkrhbbkiqnpeabyqz
-- (Takeoff-Bridge) via apply_migration.
--
-- Rollback:
--   DROP TABLE IF EXISTS estimate_bindings CASCADE;
--   DROP FUNCTION IF EXISTS touch_estimate_bindings_updated_at();
-- ═════════════════════════════════════════════════════════════════════

CREATE TABLE estimate_bindings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  target_node_id TEXT NOT NULL,
  kind           TEXT NOT NULL,              -- free text, OPEN enum (no CHECK; mirrors estimate_overrides.field)
  definition     JSONB NOT NULL,             -- { basis, rule } — value basis + the kind-specific rule
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, target_node_id)
);
-- The UNIQUE (project_id, target_node_id) btree backs the only hot query
-- (WHERE project_id = ?, leftmost prefix) — no separate index needed.

ALTER TABLE estimate_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "estimate_bindings_tenant_policy" ON estimate_bindings
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = estimate_bindings.project_id
    AND projects.tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = estimate_bindings.project_id
    AND projects.tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  ));

CREATE OR REPLACE FUNCTION touch_estimate_bindings_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER estimate_bindings_touch_updated_at_trg
  BEFORE UPDATE ON estimate_bindings
  FOR EACH ROW
  EXECUTE FUNCTION touch_estimate_bindings_updated_at();
