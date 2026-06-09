-- ═════════════════════════════════════════════════════════════════════
-- Migration: RLS / security hardening (verified audit fixes) — 2026-06-08
-- ═════════════════════════════════════════════════════════════════════
-- Closes the verified findings from the 2026-06-08 whole-repo audit + live
-- Supabase security advisors. Canonical definitions live in supabase_schema.sql;
-- this file is the reviewable, idempotent DDL applied to project nefvkrhbbkiqnpeabyqz.
-- Policy-only + function-attribute changes; NO data migration (the two leaking
-- tables are empty). Re-runnable (DROP ... IF EXISTS before each CREATE).
--
-- Fix 1 (CRITICAL): classification_history + estimate_snapshots were
--   "anon_full_access" FOR ALL USING(true) WITH CHECK(true) with NO `TO` clause,
--   so the pre-login anon browser key could read/write/delete every tenant's
--   financial + training data. Replaced with tenant-scoped, append-only policies.
-- Fix 2 (HIGH, partial): cost_code_map + rate_card write policies narrowed from
--   FOR ALL to UPDATE-only (browser editors only UPDATE; seeds bypass RLS via
--   service role). Full server-side lockdown is a deferred follow-up.
-- Fix 3 (advisor hardening): pin search_path on two functions; revoke EXECUTE on
--   the handle_new_user signup trigger (never meant to be an RPC).
--
-- NOTE: the tenant predicate is inlined as (SELECT tenant_id FROM users WHERE
-- id = auth.uid()) to match the form actually deployed by the live tenant policies.
-- supabase_schema.sql references a get_auth_tenant_id() helper that is NOT present
-- in the deployed DB (pre-existing file↔DB drift); inlining keeps these new
-- policies consistent with the deployed neighbors and avoids depending on a missing
-- function. Reconcile the drift separately.
-- ═════════════════════════════════════════════════════════════════════

-- ── Fix 1a: classification_history — tenant-scoped + append-only ──────────
DROP POLICY IF EXISTS "anon_full_access" ON classification_history;
DROP POLICY IF EXISTS "classification_history_select_policy" ON classification_history;
DROP POLICY IF EXISTS "classification_history_insert_policy" ON classification_history;

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

-- ── Fix 1b: estimate_snapshots — tenant-scoped + append-only ──────────────
DROP POLICY IF EXISTS "anon_full_access" ON estimate_snapshots;
DROP POLICY IF EXISTS "estimate_snapshots_select_policy" ON estimate_snapshots;
DROP POLICY IF EXISTS "estimate_snapshots_insert_policy" ON estimate_snapshots;

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

-- ── Fix 2: cost_code_map + rate_card — UPDATE-only writes ─────────────────
DROP POLICY IF EXISTS "cost_code_map_write_policy" ON cost_code_map;
DROP POLICY IF EXISTS "cost_code_map_update_policy" ON cost_code_map;
CREATE POLICY "cost_code_map_update_policy" ON cost_code_map
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "rate_card_write_policy" ON rate_card;
DROP POLICY IF EXISTS "rate_card_update_policy" ON rate_card;
CREATE POLICY "rate_card_update_policy" ON rate_card
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ── Fix 3: function hardening (advisors) ──────────────────────────────────
ALTER FUNCTION public.handle_new_user() SET search_path = public;
ALTER FUNCTION public.save_estimate_line_items(p_project_id text, p_items jsonb) SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;
