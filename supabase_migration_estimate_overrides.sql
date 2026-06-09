-- ═════════════════════════════════════════════════════════════════════
-- MIGRATION: estimate_overrides (Phase 4 — Override + Audit Model)
-- ═════════════════════════════════════════════════════════════════════
--
-- Adds the append-only estimate_overrides audit table + its tenant-scoped
-- SELECT/INSERT RLS. Mirrors the immutable-audit pattern of
-- classification_history / estimate_snapshots (no UPDATE/DELETE policy → rows
-- are immutable to clients). The tenant predicate is inlined as
-- (SELECT tenant_id FROM users WHERE id = auth.uid()) to match the form deployed
-- by the live tenant policies (there is NO get_auth_tenant_id() helper).
--
-- This file is the migration record; the canonical definition lives in
-- supabase_schema.sql (Table 13). Applied to project nefvkrhbbkiqnpeabyqz
-- (Takeoff-Bridge) via apply_migration.
--
-- Active override per (project_id, field) = the LATEST row by created_at; a row
-- with override_value IS NULL is a REVERT tombstone. An override_value of 0 is a
-- REAL override (INV-3 — explicit zero is honored).
--
-- Rollback:
--   DROP TABLE IF EXISTS estimate_overrides CASCADE;
-- ═════════════════════════════════════════════════════════════════════

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
