/**
 * GC/Site-Ops Addressability — the section-line stable ID scheme (PURE, zero deps).
 *
 * One shared source of truth for the `<section>:<group>:<key|code>` ids the A3
 * synthesizer stamps on every app-born section line (`synthesize.ts`) AND the A+1
 * engine forms to address a per-line audited type-over (`calculations.ts`).
 * Centralizing the format here is what makes the two agree BY CONSTRUCTION: an
 * override keyed by `line:gc:staff:ex:total` lands on exactly the line A5 projects
 * to that same source-node id.
 *
 * Group keying mirrors the synthesizer exactly (so the ids round-trip):
 *   - staff / equipment / GC-manual / Site-Ops-manual lines key by the config `key`
 *     (the persistence/lookup key in the JSONB blobs).
 *   - operational-expense / Site-Ops-dynamic lines have no `key` — they key by `code`.
 *
 * Imported-line ids (`imported:gc:<row>` / `imported:siteops:<row>`) are NOT here:
 * imported lines are frozen constants synthesized in `imported.ts`, never routed
 * through the calc engine, so they carry no engine-applied override (D4).
 */

/** Step 2 utilization-by-role labour line (STAFF_ROLE_DEFAULTS) — keyed by role key. */
export function gcStaffLineId(roleKey: string): string {
  return `gc:staff:${roleKey}`;
}
/** Step 2 auto-driver operational line (OPERATIONAL_EXPENSE_DEFAULTS) — keyed by code. */
export function gcOperationalLineId(code: string): string {
  return `gc:op:${code}`;
}
/** Step 2 lump-sum equipment line (EQUIPMENT_DEFAULTS) — keyed by equipment key. */
export function gcEquipmentLineId(eqKey: string): string {
  return `gc:equip:${eqKey}`;
}
/** Step 2 estimator-typed GC line (GC_MANUAL_DEFAULTS) — keyed by manual key. */
export function gcManualLineId(key: string): string {
  return `gc:manual:${key}`;
}
/** Step 3 duration/sqft driver line (SITE_OPS_DYNAMIC_DEFAULTS) — keyed by code. */
export function siteOpsDynamicLineId(code: string): string {
  return `siteops:dynamic:${code}`;
}
/** Step 3 estimator-typed Site-Ops line (SITE_OPS_MANUAL_DEFAULTS) — keyed by manual key. */
export function siteOpsManualLineId(key: string): string {
  return `siteops:manual:${key}`;
}

/**
 * The `estimate_overrides.field` key for a section line FIELD — the single address an
 * audited type-over (D3, Phase A+1) and a Linked-Values binding (A5) SHARE. Equal by
 * contract to the bindings layer's `lineFieldNodeId(sectionLineId, field)` (asserted in
 * `calculationsLineOverrides.test.ts` so the two can never drift). Kept here, in the
 * zero-dep id module, so `calculations.ts` need not import the bindings layer (which
 * would create a cycle via `bindings/registry.ts → calculations.ts`).
 *
 * `field` is `"total"` for the type-over A+1 introduced, and `"qty"` for the
 * duration-driven-quantity override (B3 follow-on): a derived auto line's computed
 * quantity is locked but the estimator may override it, and total then recomputes as
 * (override qty) × rate.
 */
export function sectionLineFieldOverrideKey(sectionLineId: string, field: string): string {
  return `line:${sectionLineId}:${field}`;
}

/** The `estimate_overrides.field` key for a section line's TOTAL (the A+1 type-over). */
export function sectionLineTotalOverrideKey(sectionLineId: string): string {
  return sectionLineFieldOverrideKey(sectionLineId, "total");
}

/** The `estimate_overrides.field` key for a derived line's QUANTITY override (B3 follow-on). */
export function sectionLineQtyOverrideKey(sectionLineId: string): string {
  return sectionLineFieldOverrideKey(sectionLineId, "qty");
}
