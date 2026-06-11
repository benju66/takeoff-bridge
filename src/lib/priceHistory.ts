/**
 * priceHistory.ts — pure aggregation of AS-BID unit prices from imported bids
 * (Import past bids, Phase 3 Slice 2).
 *
 * Inputs are the saved `estimate_line_items` rows with `source='imported'`
 * (db.ts getImportedPriceHistory) — every unit price is the BID's own number,
 * kept verbatim at import (historical fidelity), with the AS-BID UOM captured
 * by Slice 0. Prices are only comparable WITHIN a unit of measure, so stats
 * group by (itemId, uom) — a $/SF observation never averages into an EA one.
 *
 * Guardrails (AGENTS.md "No AI Autonomy Over Financials"): this module only
 * REPORTS history — count / median / range / the observation list. Nothing
 * here writes; adopting a figure into the rate card is an explicit human
 * action through the existing audited /rates path.
 */

/** One as-bid price seen on an imported line item, with its project context. */
export interface PriceObservation {
  itemId: string;
  unitPrice: number;
  /** As-bid UOM (uppercased at extraction; "" for pre-Slice-0 saves). */
  uom: string;
  projectName: string;
  /** "YYYY-MM-DD" bid date of the source project ("" when unset). */
  bidDate: string;
  marketSector: string;
  /** As-bid quantity (fidelity Phase 3) — fuel for historyTrust's zero-qty
   *  rule. OPTIONAL: undefined means the producer had no quantity context;
   *  the trust screen then cannot judge it and lets the row pass. */
  qty?: number;
  /** The line's data_fidelity flag (fidelity Phase 3) — fuel for
   *  historyTrust's combined-line rule ('macro_lump_sum' is excluded). */
  dataFidelity?: string;
}

/** Report for one (itemId, uom) group. */
export interface PriceHistoryStat {
  itemId: string;
  uom: string;
  count: number;
  median: number;
  min: number;
  max: number;
  /** The raw observations, newest bid first (ties keep input order). */
  observations: PriceObservation[];
}

/** Standard median: middle value, or the mean of the two middles. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Groups observations into per-(itemId, uom) stats, keyed by itemId. Within an
 * item, groups are ordered by count (desc) so the dominant unit reads first.
 *
 * SUPERSEDED for app reporting by historyTrust.aggregateTrustedHistory
 * (fidelity Phase 3) — every consumer now flows through the trust module.
 * This function stays as the pre-trust REFERENCE implementation: the
 * equivalence test proves the trust pipeline reports identical numbers for
 * already-clean data by comparing against it.
 */
export function aggregatePriceHistory(
  observations: readonly PriceObservation[]
): Map<string, PriceHistoryStat[]> {
  const byItem = new Map<string, Map<string, PriceObservation[]>>();
  for (const o of observations) {
    if (!o.itemId) continue;
    const byUom = byItem.get(o.itemId) ?? new Map<string, PriceObservation[]>();
    const list = byUom.get(o.uom) ?? [];
    list.push(o);
    byUom.set(o.uom, list);
    byItem.set(o.itemId, byUom);
  }

  const out = new Map<string, PriceHistoryStat[]>();
  for (const [itemId, byUom] of byItem) {
    const stats: PriceHistoryStat[] = [];
    for (const [uom, list] of byUom) {
      const prices = list.map((o) => o.unitPrice);
      stats.push({
        itemId,
        uom,
        count: list.length,
        median: median(prices),
        min: Math.min(...prices),
        max: Math.max(...prices),
        // Newest bid first; localeCompare on ISO dates sorts correctly.
        observations: [...list].sort((a, b) => b.bidDate.localeCompare(a.bidDate)),
      });
    }
    stats.sort((a, b) => b.count - a.count || a.uom.localeCompare(b.uom));
    out.set(itemId, stats);
  }
  return out;
}
