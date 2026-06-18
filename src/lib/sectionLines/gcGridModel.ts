/**
 * GC/Site-Ops Addressability — Step 2 (GC Personnel) grid MODEL (PURE, no React).
 *
 * The presentational + dispatch logic the Step-2 grid (useGcPersonnelGrid, Phase B2)
 * is built on, factored out so it is unit-testable without the React/TanStack tree:
 *   - the 01.A–01.F section grouping + display order (derived once from the catalog),
 *   - the per-row computed-number join (section line `code` → calc total/qty/rate),
 *   - the estimator `entry` value per kind, and
 *   - the section-line → personnel-setter target resolution (the EDIT_SECTION_CELL
 *     command's `target`/`key`), so the grid cell and undo/redo dispatch agree.
 *
 * Grouping note: section lines carry only `code` + `entryKind`; the UI section (and
 * its display order) lives on the catalog config, so it is resolved by `code`.
 * Operational lines split across 01.B (operational) / 01.E (gcMonthly); manual lines
 * split across 01.D (design) / 01.F (gcManual). Display order is presentational —
 * persistence order (personnel.sectionLines, catalog order) is unaffected.
 */

import {
  STAFF_ROLE_DEFAULTS,
  OPERATIONAL_EXPENSE_DEFAULTS,
  EQUIPMENT_DEFAULTS,
  GC_MANUAL_DEFAULTS,
} from "@/lib/constants";
import type { PersonnelCalcResult } from "@/lib/calculations";
import type { EstimateSectionLine } from "@/types/db";
import type { GcSubtotalGroup } from "@/lib/bindings/types";
import { ENTRY_KIND, isManualEntryKind } from "./entryKinds";

export type GcGroupKey = "01.A" | "01.B" | "01.C" | "01.D" | "01.E" | "01.F";

export const GC_GROUP_LABELS: Record<GcGroupKey, string> = {
  "01.A": "01.A — Staff Labour Directs",
  "01.B": "01.B — Operational Expenses",
  "01.C": "01.C — Site Equipment & Mobilization Overrides",
  "01.D": "01.D — Design & Preconstruction",
  "01.E": "01.E — General Conditions — Monthly (Auto)",
  "01.F": "01.F — General Conditions — Manual Entries",
};

export interface GcRowMeta {
  group: GcGroupKey;
  /** Global display order (UI section order, then catalog order within section). */
  order: number;
  /** Engine-graph subtotal group for the EngineLinkBadge node id. */
  engineGroup: GcSubtotalGroup;
  unit: string;
}

export const GC_ROW_META: ReadonlyMap<string, GcRowMeta> = (() => {
  const map = new Map<string, GcRowMeta>();
  let order = 0;
  const add = (code: string, group: GcGroupKey, engineGroup: GcSubtotalGroup, unit: string) => {
    map.set(code, { group, order: order++, engineGroup, unit });
  };
  for (const r of STAFF_ROLE_DEFAULTS) add(r.code, "01.A", "staff", "hr");
  for (const o of OPERATIONAL_EXPENSE_DEFAULTS.filter((o) => o.section === "operational")) add(o.code, "01.B", "ops", o.unit);
  for (const e of EQUIPMENT_DEFAULTS) add(e.code, "01.C", "equipment", "ls");
  for (const m of GC_MANUAL_DEFAULTS.filter((m) => m.section === "design")) add(m.code, "01.D", "manual", m.unit);
  for (const o of OPERATIONAL_EXPENSE_DEFAULTS.filter((o) => o.section === "gcMonthly")) add(o.code, "01.E", "ops", o.unit);
  for (const m of GC_MANUAL_DEFAULTS.filter((m) => m.section === "gcManual")) add(m.code, "01.F", "manual", m.unit);
  return map;
})();

/** GC_MANUAL config by code — for the qty-vs-lumpSum entry hint + rate column. */
export const GC_MANUAL_BY_CODE = new Map(GC_MANUAL_DEFAULTS.map((m) => [m.code, m]));

const STAFF_KEY_BY_CODE = new Map(STAFF_ROLE_DEFAULTS.map((r) => [r.code, r.key]));
const EQUIP_KEY_BY_CODE = new Map(EQUIPMENT_DEFAULTS.map((e) => [e.code, e.key]));

export const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The per-row computed numbers, joined by `code` (the canonical join
 *  projectAppBornSectionLines uses). */
export interface CalcCell {
  qty: number;
  rate: number;
  total: number;
}

export function buildCalcLookup(calc: PersonnelCalcResult): Map<string, CalcCell> {
  const m = new Map<string, CalcCell>();
  for (const l of calc.staffLines) m.set(l.code, { qty: l.qty, rate: l.rate, total: l.total });
  for (const l of calc.operationalLines) m.set(l.code, { qty: l.qty, rate: l.rate, total: l.total });
  for (const l of calc.equipmentLines) m.set(l.code, { qty: 0, rate: 0, total: l.total });
  for (const l of calc.manualLines) m.set(l.code, { qty: l.qty, rate: l.rate, total: l.total });
  return m;
}

/** The estimator-entered value shown in the `entry` column (utilization % / equipment $ / manual qty-or-$). */
export function entryValue(line: EstimateSectionLine): number {
  if (line.entryKind === ENTRY_KIND.StaffRole) return num(line.inputs.utilization);
  if (line.entryKind === ENTRY_KIND.Equipment) return num(line.inputs.amount);
  return num(line.inputs.value); // qty / qtyRate / lumpSum manual
}

/** The staff role key for a line (the rate-override setter key); null for non-staff. */
export function resolveRoleKey(line: EstimateSectionLine): string | null {
  return line.entryKind === ENTRY_KIND.StaffRole ? STAFF_KEY_BY_CODE.get(line.code) ?? null : null;
}

/**
 * Resolves which personnel setter an `entry`-column edit drives + the catalog key it
 * expects (the EDIT_SECTION_CELL command's `target`/`key`). Pure — the single mapping
 * from a section line to its setter, so undo/redo dispatch and the cell agree. Returns
 * null for operational auto lines (no estimator input) or an unknown code.
 */
export function resolveEntryTarget(
  line: EstimateSectionLine
): { target: "utilization" | "equipment" | "manual"; key: string } | null {
  if (line.entryKind === ENTRY_KIND.StaffRole) {
    const key = STAFF_KEY_BY_CODE.get(line.code);
    return key ? { target: "utilization", key } : null;
  }
  if (line.entryKind === ENTRY_KIND.Equipment) {
    const key = EQUIP_KEY_BY_CODE.get(line.code);
    return key ? { target: "equipment", key } : null;
  }
  if (isManualEntryKind(line.entryKind)) {
    const key = GC_MANUAL_BY_CODE.get(line.code)?.key;
    return key ? { target: "manual", key } : null;
  }
  return null;
}
