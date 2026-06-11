/**
 * versionDiff.ts — pure side-by-side comparison of two estimate version line
 * sets (Estimate Versioning module).
 *
 * Inputs are two ProcessedTakeoffRow arrays — frozen version payloads
 * (db.ts getEstimateVersionDetail) and/or the live working copy. Rows match
 * by `id`: ids are stable across versions because every version freezes the
 * same working-copy lineage (rows persist their id through saves), so a row
 * present in only one side genuinely was added or removed between the two.
 *
 * Guardrails (AGENTS.md "No AI Autonomy Over Financials"): this module only
 * REPORTS differences — every dollar figure is one side's stored value or a
 * subtraction of the two. Nothing here writes or recomputes an estimate.
 */

import type { ProcessedTakeoffRow } from "@/types";

export type VersionDiffKind = "added" | "removed" | "changed" | "unchanged";

/** Fields whose difference classifies a matched row as 'changed'. */
const COMPARED_FIELDS = [
  "itemId",
  "description",
  "matchedQty",
  "uom",
  "unitPrice",
  "total",
] as const satisfies readonly (keyof ProcessedTakeoffRow)[];

/** One line of the comparison. Exactly one row is absent for added/removed. */
export interface VersionDiffEntry {
  kind: VersionDiffKind;
  /** The line in version A (absent when kind === 'added'). */
  rowA?: ProcessedTakeoffRow;
  /** The line in version B (absent when kind === 'removed'). */
  rowB?: ProcessedTakeoffRow;
  /** B − A, with an absent side contributing 0. */
  qtyDelta: number;
  unitPriceDelta: number;
  totalDelta: number;
}

export interface VersionDiff {
  /** B's row order first, then rows removed since A in A's order. */
  entries: VersionDiffEntry[];
  /** Sum of line totals on each side, and their difference (B − A). */
  totalA: number;
  totalB: number;
  totalDelta: number;
  counts: Record<VersionDiffKind, number>;
}

/**
 * Compares version A (baseline) to version B. Entries follow B's row order so
 * the diff reads like the newer sheet, with rows removed since A appended at
 * the end in A's order.
 */
export function diffVersionLines(
  aRows: readonly ProcessedTakeoffRow[],
  bRows: readonly ProcessedTakeoffRow[]
): VersionDiff {
  const aById = new Map(aRows.map((r) => [r.id, r]));
  const bIds = new Set(bRows.map((r) => r.id));

  const counts: Record<VersionDiffKind, number> = {
    added: 0,
    removed: 0,
    changed: 0,
    unchanged: 0,
  };
  const entries: VersionDiffEntry[] = [];

  for (const rowB of bRows) {
    const rowA = aById.get(rowB.id);
    if (!rowA) {
      counts.added += 1;
      entries.push({
        kind: "added",
        rowB,
        qtyDelta: rowB.matchedQty,
        unitPriceDelta: rowB.unitPrice,
        totalDelta: rowB.total,
      });
      continue;
    }
    const kind: VersionDiffKind = COMPARED_FIELDS.some((f) => rowA[f] !== rowB[f])
      ? "changed"
      : "unchanged";
    counts[kind] += 1;
    entries.push({
      kind,
      rowA,
      rowB,
      qtyDelta: rowB.matchedQty - rowA.matchedQty,
      unitPriceDelta: rowB.unitPrice - rowA.unitPrice,
      totalDelta: rowB.total - rowA.total,
    });
  }

  for (const rowA of aRows) {
    if (bIds.has(rowA.id)) continue;
    counts.removed += 1;
    entries.push({
      kind: "removed",
      rowA,
      qtyDelta: -rowA.matchedQty,
      unitPriceDelta: -rowA.unitPrice,
      totalDelta: -rowA.total,
    });
  }

  const totalA = aRows.reduce((sum, r) => sum + r.total, 0);
  const totalB = bRows.reduce((sum, r) => sum + r.total, 0);

  return { entries, totalA, totalB, totalDelta: totalB - totalA, counts };
}
