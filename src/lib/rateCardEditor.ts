import {
  STAFF_ROLE_DEFAULTS,
  OPERATIONAL_EXPENSE_DEFAULTS,
  GC_MANUAL_DEFAULTS,
  SITE_OPS_DYNAMIC_DEFAULTS,
  SITE_OPS_MANUAL_DEFAULTS,
  SITE_OPS_SECTIONS,
  DIVISION_LABELS,
  DIVISION_NAMES,
} from "./constants";
import { getDivisionCode } from "./division";
import { ESTIMATE_ITEMS_MASTER } from "@/lib/mock-data";
import { RateCardEntry, CustomStep23LineDef } from "@/types/db";
import { statusOf, type CatalogLifecycleStatus } from "./catalogLifecycle";

// ---------------------------------------------------------------------------
// rateCardEditor — pure join + validation helpers for the /rates editor
// (Rate-card slice 1, Phase C). The page is a twin of /cost-codes; this module
// holds the parts worth unit-testing on their own:
//
//  - The card keys by the constants.ts line `code` (GC/Site Ops) OR the catalog
//    `itemId` (STEP 4 unit prices, Slice 2). To render a label / unit / section
//    we JOIN each card row back to its line definition. The join is built ONCE
//    from the same typed arrays the seed generator reads (GC/Site Ops) plus the
//    catalog master (Slice 2), so the editor view can never drift from the card.
//  - A card row with no matching line is SURFACED in an "unmatched" group, never
//    silently dropped (so a stale/renamed code is visible, not hidden) —
//    AGENTS.md: missing mappings must surface, not vanish.
//  - parseRateInput mirrors db.ts/updateRateCardEntry's gate per rate kind:
//    GC/Site Ops = finite >= 0; catalog = finite (negatives allowed, e.g. the
//    -$2 deduction line) — so the UI rejects a bad value BEFORE any write.
//
// This module performs NO calc and NO DB access; it only describes how to
// present the company-default layer that updateRateCardEntry edits.
// ---------------------------------------------------------------------------

/** Which validation/presentation family a rate line belongs to. */
export type RateLineKind = "gcSiteOps" | "catalog";

/** A line, normalized to what the /rates table needs to render. */
export interface RateLineDef {
  code: string;
  label: string;
  unit: string;
  sectionId: string;
  kind: RateLineKind;
  /** Lifecycle status when this def came from a PROMOTED custom GC/Site-Ops code
   *  (Catalog Manager Phase 4). Absent on built-in/catalog defs (always active);
   *  drives the retired/merged badge on a promoted-then-retired card row. */
  status?: CatalogLifecycleStatus;
}

/** Synthetic section id for staff rates (StaffRoleConfig carries no `section`). */
export const STAFF_SECTION_ID = "staff";

/** Section-id prefix for a catalog division group (keeps it disjoint from the
 *  GC/Site Ops section ids, which include bare names like `demolition`). */
export const CATALOG_SECTION_PREFIX = "catalog-";

/** Section id for PROMOTED custom GC/Site-Ops codes (Catalog Manager Phase 4).
 *  A custom def carries no inherent `section`, so its promoted card row files
 *  here — a dedicated, honest home that keeps it out of the "Unmatched" bucket.
 *  Placed before the catalog divisions so the GC/Site-Ops block stays first. */
export const CUSTOM_SECTION_ID = "promoted-custom-gc-site-ops";

/** GC/Site Ops section render order: staff, the GC `section` groups, then Site Ops. */
const GC_SITE_OPS_SECTIONS: { id: string; label: string }[] = [
  { id: STAFF_SECTION_ID, label: "Personnel — Staff Hourly Rates" },
  { id: "operational", label: "General Conditions — Operational Expenses" },
  { id: "gcMonthly", label: "General Conditions — Monthly Office & Site" },
  { id: "design", label: "General Conditions — Design & Preconstruction" },
  { id: "gcManual", label: "General Conditions — Manual Entries" },
  ...SITE_OPS_SECTIONS.map((s) => ({ id: s.id, label: `Site Operations — ${s.label}` })),
];

/**
 * One section per CSI division present in the catalog, ordered by division code
 * ascending. Built from the same master the seed reads, so every seeded catalog
 * itemId has a home section (none falls into "Unmatched" by accident).
 */
function buildCatalogDivisionSections(): { id: string; label: string }[] {
  const divisions = new Set<string>();
  for (const item of Object.values(ESTIMATE_ITEMS_MASTER)) {
    const div = getDivisionCode(item.itemId);
    if (div !== "") divisions.add(div);
  }
  return [...divisions]
    .sort()
    .map((div) => ({
      id: `${CATALOG_SECTION_PREFIX}${div}`,
      label: DIVISION_LABELS[div] ?? DIVISION_NAMES[div] ?? `DIVISION ${div}`,
    }));
}

/** Full section render order: GC/Site Ops sections, then promoted custom codes,
 *  then catalog divisions. The custom section is omitted by groupRateCardRows
 *  when no promoted custom code is present (empty sections are dropped). */
export const RATE_SECTION_ORDER: { id: string; label: string }[] = [
  ...GC_SITE_OPS_SECTIONS,
  { id: CUSTOM_SECTION_ID, label: "Promoted Custom GC/Site-Ops Codes" },
  ...buildCatalogDivisionSections(),
];

/**
 * The line definitions keyed by `code`. The GC/Site Ops block is built from the
 * same typed arrays the seed generator reads (staff use "hr"; the rest carry
 * their own `unit`). The catalog block is built from ESTIMATE_ITEMS_MASTER
 * (label=description, unit=targetUom) and grouped by CSI division.
 *
 * Catalog defs are added LAST so a catalog itemId wins the one known key overlap
 * — `02-4100.002` is both a GC lump-sum (null-rate) line AND a catalog itemId;
 * it must classify as `catalog` and render in its division group, listed once.
 */
function buildLineDefs(): Map<string, RateLineDef> {
  const defs = new Map<string, RateLineDef>();
  const add = (d: RateLineDef) => defs.set(d.code, d);

  STAFF_ROLE_DEFAULTS.forEach((r) =>
    add({ code: r.code, label: r.label, unit: "hr", sectionId: STAFF_SECTION_ID, kind: "gcSiteOps" }),
  );
  OPERATIONAL_EXPENSE_DEFAULTS.forEach((e) =>
    add({ code: e.code, label: e.description, unit: e.unit, sectionId: e.section, kind: "gcSiteOps" }),
  );
  GC_MANUAL_DEFAULTS.forEach((g) =>
    add({ code: g.code, label: g.label, unit: g.unit, sectionId: g.section, kind: "gcSiteOps" }),
  );
  SITE_OPS_DYNAMIC_DEFAULTS.forEach((d) =>
    add({ code: d.code, label: d.label, unit: d.unit, sectionId: d.section, kind: "gcSiteOps" }),
  );
  SITE_OPS_MANUAL_DEFAULTS.forEach((s) =>
    add({ code: s.code, label: s.label, unit: s.unit, sectionId: s.section, kind: "gcSiteOps" }),
  );

  // Catalog (STEP 4 unit prices, Slice 2) — added last so it wins on key overlap.
  Object.values(ESTIMATE_ITEMS_MASTER).forEach((item) =>
    add({
      code: item.itemId,
      label: item.description,
      unit: item.targetUom,
      sectionId: `${CATALOG_SECTION_PREFIX}${getDivisionCode(item.itemId)}`,
      kind: "catalog",
    }),
  );
  return defs;
}

export const RATE_LINE_DEFS: Map<string, RateLineDef> = buildLineDefs();

/** A card row joined to its constants line def (`def` is null when unmatched). */
export interface EnrichedRateRow {
  entry: RateCardEntry;
  def: RateLineDef | null;
}

/** A section of joined rows for grouped rendering. */
export interface RateSectionGroup {
  id: string;
  label: string;
  rows: EnrichedRateRow[];
}

const UNMATCHED_SECTION_ID = "__unmatched__";

/**
 * Join + group card rows by section in RATE_SECTION_ORDER order. Card rows
 * whose `lineCode` matches no constants line (or whose section is unknown) are
 * surfaced in a trailing "Unmatched" group rather than dropped. Empty sections
 * are omitted.
 *
 * `customDefs` (Catalog Manager Phase 4 — thin promotion): a card row keyed by a
 * PROMOTED custom GC/Site-Ops code has no built-in line def, so without this it
 * would fall into "Unmatched". Joining it to its custom def lifts it into the
 * dedicated CUSTOM_SECTION_ID group with the def's label/unit (kind 'gcSiteOps'
 * → ADOPT gates non-negative, same as any GC/Site-Ops rate) and carries its
 * lifecycle `status` so a promoted-then-retired row renders the retired badge.
 */
export function groupRateCardRows(
  entries: RateCardEntry[],
  customDefs?: readonly CustomStep23LineDef[],
): RateSectionGroup[] {
  const customByCode = new Map<string, CustomStep23LineDef>();
  for (const d of customDefs ?? []) customByCode.set(d.code, d);

  const enriched: EnrichedRateRow[] = entries.map((entry) => {
    const builtIn = RATE_LINE_DEFS.get(entry.lineCode);
    if (builtIn) return { entry, def: builtIn };

    const custom = customByCode.get(entry.lineCode);
    if (custom) {
      return {
        entry,
        def: {
          code: custom.code,
          label: custom.label,
          unit: custom.unit,
          sectionId: CUSTOM_SECTION_ID,
          kind: "gcSiteOps",
          status: statusOf(custom),
        },
      };
    }
    return { entry, def: null };
  });

  const knownSectionIds = new Set(RATE_SECTION_ORDER.map((s) => s.id));
  const groups: RateSectionGroup[] = [];

  for (const section of RATE_SECTION_ORDER) {
    const rows = enriched.filter((r) => r.def?.sectionId === section.id);
    if (rows.length > 0) groups.push({ id: section.id, label: section.label, rows });
  }

  // No matching line def, OR a def whose section isn't in the render order.
  const unmatched = enriched.filter(
    (r) => r.def === null || !knownSectionIds.has(r.def.sectionId),
  );
  if (unmatched.length > 0) {
    groups.push({
      id: UNMATCHED_SECTION_ID,
      label: "Unmatched — card rows with no current line definition",
      rows: unmatched,
    });
  }
  return groups;
}

/**
 * Parse a rate input string, mirroring db.ts/updateRateCardEntry's per-kind
 * gate: finite >= 0 by default (GC/Site Ops); finite only (negatives allowed)
 * when `allowNegative` is set (catalog, e.g. the -$2 deduction line). Returns
 * null for empty / non-numeric / non-finite (and negative unless allowed) input
 * so the UI rejects the edit BEFORE a write — no unvalidated financial value.
 */
export function parseRateInput(
  raw: string,
  opts?: { allowNegative?: boolean },
): number | null {
  const allowNegative = opts?.allowNegative ?? false;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  if (!allowNegative && value < 0) return null;
  return value;
}
