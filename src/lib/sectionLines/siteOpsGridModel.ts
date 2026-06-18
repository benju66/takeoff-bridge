/**
 * GC/Site-Ops Addressability — Step 3 (Site Operations) grid MODEL (PURE, no React).
 *
 * The Site-Ops twin of `gcGridModel.ts`: the presentational + dispatch logic the
 * Step-3 grid (useSiteOpsGrid, Phase B3) is built on, factored out so it is
 * unit-testable without the React/TanStack tree:
 *   - the 8 Site-Ops section grouping (02.A–02.H) + display order (section order,
 *     then dynamic-before-manual within a section — matches the old InfrastructureStep),
 *   - the per-row computed-number join (section line `code` → calc total/qty/rate),
 *   - the estimator `entry` value per kind, and
 *   - the section-line → infrastructure-setter key resolution (the EDIT_SECTION_CELL
 *     command's `key`), so the grid cell and undo/redo dispatch agree.
 *
 * Site-Ops differs from GC in one way that matters here: a `qtyRate` manual line
 * (today only Soil Borings) has BOTH a typed quantity AND a typed rate, so it exposes
 * an editable rate cell (`resolveRateKey`) on top of the editable quantity cell
 * (`resolveQtyKey`). GC manual lines were qty/lumpSum only.
 */

import {
  SITE_OPS_SECTIONS,
  SITE_OPS_DYNAMIC_DEFAULTS,
  SITE_OPS_MANUAL_DEFAULTS,
  type SiteOpsSection,
} from "@/lib/constants";
import type { SiteOpsCalcResult } from "@/lib/calculations";
import type { EstimateSectionLine } from "@/types/db";
import type { SiteOpsLineGroup } from "@/lib/bindings/types";
import { ENTRY_KIND, isManualEntryKind } from "./entryKinds";
import type { CalcCell } from "./gcGridModel";

export type SiteOpsGroupKey = SiteOpsSection;

/** Coerce a JSONB `inputs` value to a finite number (synthesis writes numbers; guards reads). */
export const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The 8 Site-Ops section divider labels (02.A–02.H), keyed by section id. */
export const SITEOPS_GROUP_LABELS: Record<SiteOpsSection, string> = Object.fromEntries(
  SITE_OPS_SECTIONS.map((s) => [s.id, s.label])
) as Record<SiteOpsSection, string>;

export interface SiteOpsRowMeta {
  group: SiteOpsGroupKey;
  /** Global display order (section order, then dynamic-before-manual within section). */
  order: number;
  /** Engine-graph line group for the EngineLinkBadge node id (`siteOpsLeafNodeId`). */
  engineGroup: SiteOpsLineGroup;
  unit: string;
}

/**
 * Per-code display metadata, built in the SAME order the old InfrastructureStep
 * rendered: for each section (in `SITE_OPS_SECTIONS` order), its dynamic lines then
 * its manual lines. Section lines synthesize in catalog order (all dynamic, then all
 * manual), so the grid re-sorts by `order` to make each section's rows contiguous —
 * the GridShell inserts a divider when the group key changes, so rows of a group MUST
 * be adjacent. Persistence order (the synthesized array) is unaffected.
 */
export const SITEOPS_ROW_META: ReadonlyMap<string, SiteOpsRowMeta> = (() => {
  const map = new Map<string, SiteOpsRowMeta>();
  let order = 0;
  const add = (code: string, group: SiteOpsGroupKey, engineGroup: SiteOpsLineGroup, unit: string) => {
    map.set(code, { group, order: order++, engineGroup, unit });
  };
  for (const section of SITE_OPS_SECTIONS) {
    for (const d of SITE_OPS_DYNAMIC_DEFAULTS.filter((c) => c.section === section.id)) {
      add(d.code, section.id, "dynamic", d.unit);
    }
    for (const m of SITE_OPS_MANUAL_DEFAULTS.filter((c) => c.section === section.id)) {
      add(m.code, section.id, "manual", m.unit);
    }
  }
  return map;
})();

/** SITE_OPS_MANUAL config by code — for the entry-kind hint + the rate cell. */
export const SITEOPS_MANUAL_BY_CODE = new Map(SITE_OPS_MANUAL_DEFAULTS.map((m) => [m.code, m]));

/** SITE_OPS_DYNAMIC config by code — for the auto-line description hint (driver). */
export const SITEOPS_DYNAMIC_BY_CODE = new Map(SITE_OPS_DYNAMIC_DEFAULTS.map((d) => [d.code, d]));

/** Stable section-divider grouping for the grid (module-level → referentially stable). */
export const siteOpsGroupKey = (row: EstimateSectionLine): string =>
  SITEOPS_ROW_META.get(row.code)?.group ?? "";
export const siteOpsGroupLabel = (key: string): string =>
  SITEOPS_GROUP_LABELS[key as SiteOpsSection] ?? key;

/**
 * The per-row computed numbers, joined by `code` (the canonical join). Every Site-Ops
 * code is unique across the dynamic + manual arrays, so the join is collision-free.
 */
export function buildSiteOpsCalcLookup(calc: SiteOpsCalcResult): Map<string, CalcCell> {
  const m = new Map<string, CalcCell>();
  for (const l of calc.dynamicLines) m.set(l.code, { qty: l.qty, rate: l.rate, total: l.total });
  for (const l of calc.manualLines) m.set(l.code, { qty: l.qty, rate: l.rate, total: l.total });
  return m;
}

/** The estimator-entered value shown in the `entry` column (typed qty / lump-sum $). */
export function entryValue(line: EstimateSectionLine): number {
  // dynamic lines have no estimator input; manual lines hold qty / qtyRate / lumpSum value.
  return isManualEntryKind(line.entryKind) ? num(line.inputs.value) : 0;
}

/**
 * The infrastructure quantity-setter key for a manual line's `entry` edit (the
 * EDIT_SECTION_CELL command's `key`; drives `handleLineQuantityChange`). Null for
 * dynamic auto lines (no estimator input) or an unknown code.
 */
export function resolveQtyKey(line: EstimateSectionLine): string | null {
  if (!isManualEntryKind(line.entryKind)) return null;
  return SITEOPS_MANUAL_BY_CODE.get(line.code)?.key ?? null;
}

/**
 * The infrastructure rate-setter key for a `qtyRate` line's editable rate cell (drives
 * `handleLineRateChange`). Null for every other kind — only `qtyRate` lines expose an
 * editable rate (qty lines show their card rate read-only; lump-sum show "—").
 */
export function resolveRateKey(line: EstimateSectionLine): string | null {
  if (line.entryKind !== ENTRY_KIND.QtyRate) return null;
  return SITEOPS_MANUAL_BY_CODE.get(line.code)?.key ?? null;
}
