-- ═════════════════════════════════════════════════════════════════════
-- MIGRATION: estimate_versions (Estimate Versioning module)
-- ═════════════════════════════════════════════════════════════════════
--
-- Adds the estimate_versions table (named frozen versions of the working
-- copy), its tenant-scoped SELECT/INSERT/UPDATE RLS, the freeze-guard
-- trigger (payload immutable; only the submission flag pair may change),
-- the partial-unique single-official-bid index, and the
-- create_estimate_version / submit_estimate_version RPCs.
--
-- This file is the migration record; the canonical definition lives in
-- supabase_schema.sql (Table 16). Apply to project nefvkrhbbkiqnpeabyqz
-- (Takeoff-Bridge) via apply_migration.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS submit_estimate_version(TEXT, UUID);
--   DROP FUNCTION IF EXISTS create_estimate_version(TEXT, TEXT, JSONB, JSONB);
--   DROP TABLE IF EXISTS estimate_versions CASCADE;
--   DROP FUNCTION IF EXISTS estimate_versions_freeze_guard();
-- ═════════════════════════════════════════════════════════════════════

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
