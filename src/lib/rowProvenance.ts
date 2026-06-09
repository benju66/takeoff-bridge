/**
 * Row provenance badge — pure decision logic (Phase 5, slice 5c.1 + INV-7).
 *
 * Maps a row's `source` / `needsReview` to the small grid glyph the item-id cell
 * shows. PURE (no React): the EstimateTable cell renders the matching lucide icon
 * from `kind`, and the INV-7 contract test asserts this mapping is TOTAL — every
 * `source` + `needsReview` combination yields a valid, defined badge (never
 * undefined). Mirrors `overrideSetter.ts`: the component is the I/O shell; the
 * decision lives here so it is unit-testable in node (the repo has no DOM harness).
 *
 * `needsReview` takes visual PRIORITY — the ⚠ is the worklist signal (INV-8). A row
 * can be imported AND flagged; we surface the flag so it reaches the Flags worklist.
 */

import type { ProcessedTakeoffRow } from "@/types";

export type RowProvenanceKind =
  | "needs_review"
  | "template"
  | "imported"
  | "manual"
  | "ai_suggestion";

export interface RowProvenanceBadge {
  /** Stable kind — the cell picks a lucide icon + color from this. */
  kind: RowProvenanceKind;
  /** Short label (legend / aria-label). */
  label: string;
  /** Hover tooltip. */
  tooltip: string;
}

/** One badge per concrete `source` value (the contract's provenance taxonomy). */
const SOURCE_BADGES: Record<
  NonNullable<ProcessedTakeoffRow["source"]>,
  RowProvenanceBadge
> = {
  template: { kind: "template", label: "Template", tooltip: "From the estimate template" },
  csv_import: { kind: "imported", label: "Imported (CSV)", tooltip: "Imported from CSV" },
  manual: { kind: "manual", label: "Manual", tooltip: "Hand-entered" },
  ai_suggestion: {
    kind: "ai_suggestion",
    label: "AI suggestion",
    tooltip: "AI-suggested — verify before export",
  },
};

const NEEDS_REVIEW_BADGE: RowProvenanceBadge = {
  kind: "needs_review",
  label: "Needs review",
  tooltip: "Flagged: ambiguous import quantity — review before export",
};

/** Fallback for a row with no recorded source (legacy/unknown) → reads as template. */
const DEFAULT_BADGE: RowProvenanceBadge = SOURCE_BADGES.template;

/**
 * The provenance badge for a row. `needsReview` wins (worklist signal); otherwise
 * the `source` maps 1:1; an unset/unknown source falls back to template. TOTAL —
 * always returns a defined badge (INV-7 provenance completeness).
 */
export function rowProvenanceBadge(
  row: Pick<ProcessedTakeoffRow, "source" | "needsReview">
): RowProvenanceBadge {
  if (row.needsReview) return NEEDS_REVIEW_BADGE;
  if (row.source && SOURCE_BADGES[row.source]) return SOURCE_BADGES[row.source];
  return DEFAULT_BADGE;
}
