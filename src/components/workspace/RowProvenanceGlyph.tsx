"use client";

import React from "react";
import { LayoutGrid, FileSpreadsheet, Pencil, Sparkles, AlertTriangle } from "lucide-react";
import { rowProvenanceBadge, RowProvenanceKind } from "@/lib/rowProvenance";
import type { ProcessedTakeoffRow } from "@/types";

// ---------------------------------------------------------------------------
// Row provenance glyph (Phase 5, slice 5c.1). A small lucide icon in the item-id
// cell signalling where a row came from — ▦ template · ⬚ imported (CSV) · ✎ manual ·
// ⚠ needs review (the worklist signal takes priority). The glyph/label DECISION is
// the pure `rowProvenanceBadge` helper (node-tested + INV-7); this is just the icon
// shell, matching the lucide idiom used across TrustInspector/EstimateTable.
// ---------------------------------------------------------------------------

const ICONS: Record<
  RowProvenanceKind,
  { Icon: React.ComponentType<{ size?: number }>; className: string }
> = {
  needs_review: { Icon: AlertTriangle, className: "text-amber-600 dark:text-amber-400" },
  template: { Icon: LayoutGrid, className: "text-slate-400 dark:text-slate-500" },
  imported: { Icon: FileSpreadsheet, className: "text-slate-400 dark:text-slate-500" },
  manual: { Icon: Pencil, className: "text-slate-400 dark:text-slate-500" },
  ai_suggestion: { Icon: Sparkles, className: "text-violet-500 dark:text-violet-400" },
};

export function RowProvenanceGlyph({
  row,
}: {
  row: Pick<ProcessedTakeoffRow, "source" | "needsReview">;
}) {
  const badge = rowProvenanceBadge(row);
  const { Icon, className } = ICONS[badge.kind];
  return (
    <span
      title={badge.tooltip}
      aria-label={badge.label}
      className={`inline-flex shrink-0 ${className}`}
    >
      <Icon size={12} />
    </span>
  );
}
