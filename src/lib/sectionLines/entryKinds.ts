/**
 * GC/Site-Ops Addressability — the section-line `entry_kind` vocabulary.
 *
 * `estimate_section_lines.entry_kind` is an OPEN free-TEXT column in the DB (no
 * CHECK — mirrors `estimate_bindings.kind`, plan A2). The vocabulary is the app's
 * concern; this module is the single shared source of truth for it so the three
 * downstream consumers agree:
 *   - A3 synthesis (`synthesize.ts`) stamps these on every synthesized line.
 *   - A5 will project section lines to `line:<id>:total` graph nodes keyed off the kind.
 *   - B2/B3 grids render/edit per kind.
 *
 * The set is the A2-closure suggested vocabulary, drawn from the A1 calc configs:
 *   STRUCTURED (catalog-only; removable but NOT user-mintable — ID-4):
 *     - `staffRole`          Step 2 utilization-by-role labour lines (STAFF_ROLE_DEFAULTS)
 *     - `operationalExpense` Step 2 auto-driver operational lines (OPERATIONAL_EXPENSE_DEFAULTS)
 *     - `equipment`          Step 2 lump-sum equipment lines (EQUIPMENT_DEFAULTS)
 *     - `dynamic`            Step 3 duration/sqft driver lines (SITE_OPS_DYNAMIC_DEFAULTS)
 *   MANUAL (the estimator-typed / one-off kinds — D1's escape hatch reuses these;
 *   a manual config's `entry` value IS its entry kind):
 *     - `qty`     typed quantity × catalog rate
 *     - `qtyRate` typed quantity × typed rate
 *     - `lumpSum` typed dollar amount
 */

export const ENTRY_KIND = {
  StaffRole: "staffRole",
  OperationalExpense: "operationalExpense",
  Equipment: "equipment",
  Dynamic: "dynamic",
  Qty: "qty",
  QtyRate: "qtyRate",
  LumpSum: "lumpSum",
} as const;

export type EntryKind = (typeof ENTRY_KIND)[keyof typeof ENTRY_KIND];

/** The full closed set of section-line entry kinds (for structural-completeness tests). */
export const ENTRY_KINDS: readonly EntryKind[] = Object.freeze(
  Object.values(ENTRY_KIND)
) as readonly EntryKind[];

/**
 * Bespoke catalog-only kinds: subset-able (removable, D2) but never user-mintable
 * (ID-4 protection — there is deliberately no structured-line adder).
 */
export const STRUCTURED_ENTRY_KINDS: readonly EntryKind[] = Object.freeze([
  ENTRY_KIND.StaffRole,
  ENTRY_KIND.OperationalExpense,
  ENTRY_KIND.Equipment,
  ENTRY_KIND.Dynamic,
]) as readonly EntryKind[];

/**
 * The estimator-typed kinds. A manual config's `entry` field ('qty' | 'qtyRate'
 * | 'lumpSum') maps 1:1 onto these, so the one-off escape hatch (D1, B5) routes
 * through the SAME evaluator with no new entry kinds.
 */
export const MANUAL_ENTRY_KINDS: readonly EntryKind[] = Object.freeze([
  ENTRY_KIND.Qty,
  ENTRY_KIND.QtyRate,
  ENTRY_KIND.LumpSum,
]) as readonly EntryKind[];

/** True for the estimator-typed kinds (`qty` / `qtyRate` / `lumpSum`). */
export function isManualEntryKind(kind: string): kind is "qty" | "qtyRate" | "lumpSum" {
  return (MANUAL_ENTRY_KINDS as readonly string[]).includes(kind);
}

/** True for the bespoke catalog-only structured kinds. */
export function isStructuredEntryKind(kind: string): boolean {
  return (STRUCTURED_ENTRY_KINDS as readonly string[]).includes(kind);
}
