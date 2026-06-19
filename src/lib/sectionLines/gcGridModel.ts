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
import { isOneOffLine, oneOffUnit } from "./oneOff";

export type GcGroupKey = "01.A" | "01.B" | "01.C" | "01.D" | "01.E" | "01.F" | "01.G";

/** The section divider key for estimator-authored one-off GC lines (B5 / D1). */
export const GC_ONE_OFF_GROUP: GcGroupKey = "01.G";

export const GC_GROUP_LABELS: Record<GcGroupKey, string> = {
  "01.A": "01.A — Staff Labour Directs",
  "01.B": "01.B — Operational Expenses",
  "01.C": "01.C — Site Equipment & Mobilization Overrides",
  "01.D": "01.D — Design & Preconstruction",
  "01.E": "01.E — General Conditions — Monthly (Auto)",
  "01.F": "01.F — General Conditions — Manual Entries",
  "01.G": "01.G — One-off Lines",
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

/**
 * A catalog line offered by the "+ Add line" picker (Phase B4 / D2). `groupKey` /
 * `groupLabel` are the line's section, so the host groups the removed lines by the same
 * 01.A–01.F / 02.A–02.H dividers the grid uses. Display-ordered.
 */
export interface SectionCatalogEntry {
  code: string;
  label: string;
  groupKey: string;
  groupLabel: string;
}

/** Stable section-divider grouping for the grid (module-level → referentially stable).
 *  One-off lines (B5 / D1) are not in the catalog ROW_META, so they fall into their own
 *  01.G — One-off Lines divider. */
export const gcGroupKey = (row: EstimateSectionLine): string =>
  isOneOffLine(row) ? GC_ONE_OFF_GROUP : (GC_ROW_META.get(row.code)?.group ?? "");
export const gcGroupLabel = (key: string): string =>
  GC_GROUP_LABELS[key as GcGroupKey] ?? key;

/** The unit shown for a GC line: the catalog ROW_META unit, or a one-off's stored unit (B5). */
export const gcRowUnit = (line: EstimateSectionLine): string =>
  GC_ROW_META.get(line.code)?.unit ?? oneOffUnit(line);

/**
 * The full GC (Step 2) catalog as picker entries, in display order — the universe a
 * removed line can be re-added from. Labels mirror what the synthesizer writes (staff =
 * role label, operational = description, equipment = label, manual = label) for parity
 * with the grid's Description column.
 */
export const GC_CATALOG_LINES: readonly SectionCatalogEntry[] = (() => {
  const entries: SectionCatalogEntry[] = [];
  const push = (code: string, label: string) => {
    const meta = GC_ROW_META.get(code);
    entries.push({ code, label, groupKey: meta?.group ?? "", groupLabel: gcGroupLabel(meta?.group ?? "") });
  };
  for (const r of STAFF_ROLE_DEFAULTS) push(r.code, r.label);
  for (const o of OPERATIONAL_EXPENSE_DEFAULTS) push(o.code, o.description);
  for (const e of EQUIPMENT_DEFAULTS) push(e.code, e.label);
  for (const m of GC_MANUAL_DEFAULTS) push(m.code, m.label);
  return entries.sort((a, b) => (GC_ROW_META.get(a.code)?.order ?? 999) - (GC_ROW_META.get(b.code)?.order ?? 999));
})();

/**
 * True for a GC line whose Quantity is DERIVED (utilization×duration for staff, the
 * driver for operational) → the Quantity cell is locked-but-overridable (B3). Equipment
 * and manual lines return false (their amount/quantity is a direct input).
 */
export const gcIsDerivedQtyLine = (row: EstimateSectionLine): boolean =>
  row.entryKind === ENTRY_KIND.StaffRole || row.entryKind === ENTRY_KIND.OperationalExpense;

/** Compact quantity formatter for the Quantity column (e.g. 346.4, 10, 1.5). */
export const fmtQty = (n: number): string =>
  n.toLocaleString(undefined, { maximumFractionDigits: 2 });

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
  // Equipment is a lump (the export carries only a total): present it uniformly as the
  // template's Quantity 1 × Rate(amount) = Total so the grid's Quantity/Rate columns read
  // consistently with the lump-sum lines (the editable amount itself rides in `inputs.amount`).
  for (const l of calc.equipmentLines) m.set(l.code, { qty: l.total > 0 ? 1 : 0, rate: l.total, total: l.total });
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
