import {
  STAFF_ROLE_DEFAULTS,
  OPERATIONAL_EXPENSE_DEFAULTS,
  GC_MANUAL_DEFAULTS,
  SITE_OPS_DYNAMIC_DEFAULTS,
  SITE_OPS_MANUAL_DEFAULTS,
  SITE_OPS_SECTIONS,
} from "./constants";
import { RateCardEntry } from "@/types/db";

// ---------------------------------------------------------------------------
// rateCardEditor — pure join + validation helpers for the /rates editor
// (Rate-card slice 1, Phase C). The page is a twin of /cost-codes; this module
// holds the parts worth unit-testing on their own:
//
//  - The card keys by the constants.ts line `code`. To render a label / unit /
//    section we JOIN each card row back to its constants line definition. The
//    join is built ONCE from the same typed arrays the seed generator reads, so
//    the editor view can never drift from the seeded card.
//  - A card row with no matching constants line is SURFACED in an "unmatched"
//    group, never silently dropped (so a stale/renamed code is visible, not
//    hidden) — AGENTS.md: missing mappings must surface, not vanish.
//  - parseRateInput mirrors db.ts/updateRateCardEntry's gate (finite >= 0) so
//    the UI rejects a bad value BEFORE any write is attempted.
//
// This module performs NO calc and NO DB access; it only describes how to
// present the company-default layer that updateRateCardEntry edits.
// ---------------------------------------------------------------------------

/** A constants.ts line, normalized to what the /rates table needs to render. */
export interface RateLineDef {
  code: string;
  label: string;
  unit: string;
  sectionId: string;
}

/** Synthetic section id for staff rates (StaffRoleConfig carries no `section`). */
export const STAFF_SECTION_ID = "staff";

/** Section render order + labels: staff, the GC `section` groups, then Site Ops. */
export const RATE_SECTION_ORDER: { id: string; label: string }[] = [
  { id: STAFF_SECTION_ID, label: "Personnel — Staff Hourly Rates" },
  { id: "operational", label: "General Conditions — Operational Expenses" },
  { id: "gcMonthly", label: "General Conditions — Monthly Office & Site" },
  { id: "design", label: "General Conditions — Design & Preconstruction" },
  { id: "gcManual", label: "General Conditions — Manual Entries" },
  ...SITE_OPS_SECTIONS.map((s) => ({ id: s.id, label: `Site Operations — ${s.label}` })),
];

/**
 * The constants line definitions keyed by `code`. Built from the same typed
 * arrays the seed generator reads (staff use "hr"; the rest carry their own
 * `unit`). Lump-sum lines are included for completeness but carry no card row,
 * so they never render (the card only holds rate-bearing lines).
 */
function buildLineDefs(): Map<string, RateLineDef> {
  const defs = new Map<string, RateLineDef>();
  const add = (d: RateLineDef) => defs.set(d.code, d);

  STAFF_ROLE_DEFAULTS.forEach((r) =>
    add({ code: r.code, label: r.label, unit: "hr", sectionId: STAFF_SECTION_ID }),
  );
  OPERATIONAL_EXPENSE_DEFAULTS.forEach((e) =>
    add({ code: e.code, label: e.description, unit: e.unit, sectionId: e.section }),
  );
  GC_MANUAL_DEFAULTS.forEach((g) =>
    add({ code: g.code, label: g.label, unit: g.unit, sectionId: g.section }),
  );
  SITE_OPS_DYNAMIC_DEFAULTS.forEach((d) =>
    add({ code: d.code, label: d.label, unit: d.unit, sectionId: d.section }),
  );
  SITE_OPS_MANUAL_DEFAULTS.forEach((s) =>
    add({ code: s.code, label: s.label, unit: s.unit, sectionId: s.section }),
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
 */
export function groupRateCardRows(entries: RateCardEntry[]): RateSectionGroup[] {
  const enriched: EnrichedRateRow[] = entries.map((entry) => ({
    entry,
    def: RATE_LINE_DEFS.get(entry.lineCode) ?? null,
  }));

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
 * Parse a rate input string, returning the numeric value only if it is a
 * finite number >= 0 (mirrors db.ts/updateRateCardEntry's gate). Returns null
 * for empty / non-numeric / negative / non-finite input so the UI can reject
 * the edit BEFORE attempting a write — no unvalidated financial value.
 */
export function parseRateInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}
