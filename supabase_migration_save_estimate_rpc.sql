-- ═════════════════════════════════════════════════════════════════════
-- Migration: save_estimate composed RPC (atomic estimate auto-save) — 2026-06-08
-- ═════════════════════════════════════════════════════════════════════
-- Closes audit finding #4 (HIGH, non-atomic estimate save). Canonical definition
-- lives in supabase_schema.sql; this file is the reviewable, idempotent DDL applied
-- to project nefvkrhbbkiqnpeabyqz. Function-only change; NO data migration.
-- Re-runnable (CREATE OR REPLACE).
--
-- Problem: useEstimatePersistence auto-save fired two independent transactions via
--   Promise.all — saveProjectEstimate (UPSERT project_estimates) and the line-item
--   RPC (DELETE+INSERT estimate_line_items). If one succeeded and the other failed,
--   the stored header totals could diverge from their backing line items. That
--   violates AGENTS.md "Atomic Line Item Writes" / Financial Write Constraint.
--
-- Fix: a single SECURITY INVOKER RPC, save_estimate(p_estimate, p_items), that
--   performs the project_estimates upsert AND delegates the line-item replace to
--   the existing save_estimate_line_items() inside the same transaction. Either
--   both land or neither does.
--
-- Security: SECURITY INVOKER (no SECURITY DEFINER) — the caller's RLS on
--   project_estimates + estimate_line_items still applies; not privilege-escalating.
--   search_path pinned to public. Verified post-apply: prosecdef=false,
--   proconfig=search_path=public; security advisors show no new warning.
--
-- Atomicity verified (service role, real project 1c6e14be-…): a save_estimate call
--   with a deliberately bad p_items (invalid data_fidelity enum) and a changed
--   subtotal rolled back the project_estimates upsert too — subtotal and line
--   count were both left unchanged.
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
