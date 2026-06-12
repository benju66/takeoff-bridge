import { InternalEstimateItem } from "@/types";
import { CatalogAddition, CatalogCostTypeOverride } from "@/types/db";
import { ESTIMATE_ITEMS_MASTER } from "@/lib/mock-data";

// ---------------------------------------------------------------------------
// catalog.ts — the SINGLE runtime source for STEP 4 catalog items.
//
// Built-ins come from the harvested template (ESTIMATE_ITEMS_MASTER, the
// estimate-catalog.json the sync-codes script writes). In-app additions are
// layered in via the prime pattern — the exact twin of primeCostCodeResolver /
// primeRateCard — so a later phase can overlay catalog additions at this ONE
// chokepoint without touching the ~12 consumers again.
//
// Collision rule (architect-locked): a built-in ALWAYS wins a code collision
// with a primed addition — the harvested template is the source of truth, and an
// addition whose code later lands in a fresh harvest is simply superseded.
//
// Identity contract: with NOTHING primed, getCatalogItems() returns the exact
// ESTIMATE_ITEMS_MASTER reference — byte-identical. This phase (Phase 5) is a
// pure identity refactor: no addition is primed anywhere yet, so every consumer
// reads exactly what it read before.
// ---------------------------------------------------------------------------

let primedAdditions: InternalEstimateItem[] | null = null;
let primedCostTypeOverrides: Map<string, string> | null = null;

/**
 * Prime the in-app catalog additions overlay (Phase 6 wires the DB fetch here,
 * at the existing prime sites). An empty list is treated as nothing primed so
 * the identity contract holds.
 */
export function primeCatalogAdditions(items: InternalEstimateItem[]): void {
  primedAdditions = items.length > 0 ? items : null;
}

/**
 * Prime the built-in cost-type override overlay (catalog_cost_type_overrides
 * rows — Template + Catalog Reconciliation Phase 2). An override patches a
 * matching BUILT-IN's costType — that ONE field only — the inverse of the
 * addition collision rule: an addition never shadows a built-in, an override
 * exists only to relabel one. Overrides naming a non-built-in code are inert
 * (e.g. a code dropped by a later harvest). An empty list is treated as
 * nothing primed so the identity contract holds. LABEL ONLY — costType is read
 * by neither calculations.ts nor exporter.ts, so priming moves no dollars.
 */
export function primeCatalogCostTypeOverrides(overrides: CatalogCostTypeOverride[]): void {
  if (overrides.length === 0) {
    primedCostTypeOverrides = null;
    return;
  }
  primedCostTypeOverrides = new Map(overrides.map((o) => [o.itemId, o.costType]));
}

/** Test-only: clear the primed additions + cost-type override overlays. */
export function resetCatalog(): void {
  primedAdditions = null;
  primedCostTypeOverrides = null;
}

/**
 * The merged STEP 4 catalog keyed by itemId. Nothing primed ⇒ the exact
 * ESTIMATE_ITEMS_MASTER reference. With additions primed, additions are layered
 * first and the built-ins overwrite any colliding code (built-in always wins).
 * With cost-type overrides primed, each matching built-in is then cloned with
 * the override's costType (override wins for that one field; all other fields —
 * and every untouched item — keep the built-in reference).
 */
export function getCatalogItems(): Record<string, InternalEstimateItem> {
  if (!primedAdditions && !primedCostTypeOverrides) return ESTIMATE_ITEMS_MASTER;
  const merged: Record<string, InternalEstimateItem> = {};
  if (primedAdditions) {
    for (const add of primedAdditions) merged[add.itemId] = add;
  }
  Object.assign(merged, ESTIMATE_ITEMS_MASTER);
  if (primedCostTypeOverrides) {
    for (const [itemId, costType] of primedCostTypeOverrides) {
      const builtIn = ESTIMATE_ITEMS_MASTER[itemId];
      if (builtIn && builtIn.costType !== costType) {
        merged[itemId] = { ...builtIn, costType };
      }
    }
  }
  return merged;
}

/**
 * True when itemId is a HARVESTED BUILT-IN STEP 4 code — the codes an addition
 * may never shadow (a built-in always wins the overlay). Checks the built-ins
 * ONLY (ESTIMATE_ITEMS_MASTER), never the primed additions; db.ts rejects an
 * addition whose itemId collides with one at create time.
 */
export function isBuiltInCatalogCode(itemId: string): boolean {
  return Object.prototype.hasOwnProperty.call(ESTIMATE_ITEMS_MASTER, itemId);
}

/**
 * Drift state of a catalog addition vs the HARVESTED template
 * (estimate-catalog.json → ESTIMATE_ITEMS_MASTER). Phase 7's "honest drift"
 * banner is built on this single oracle:
 *  - 'reconciled'   — already marked 'landed'; the built-in wins the overlay and
 *                     the row remains only as the audit/reconciliation record.
 *  - 'landed-ready' — still 'active' but its code now ships as a BUILT-IN (a fresh
 *                     harvest added the STEP 4 row): the in-app overlay is now
 *                     superseded, so the page offers one-click "mark landed".
 *  - 'drifted'      — 'active' and NOT yet a built-in: the row exists only in-app.
 *                     Its STEP 4 row must be hand-added to the master template and
 *                     `npm run sync-codes` re-run, or it is lost on a re-harvest.
 * Reads the BUILT-INS only (via isBuiltInCatalogCode) — never the primed overlay —
 * so the answer is stable regardless of what is primed in the session.
 */
export type CatalogAdditionDriftState = "reconciled" | "landed-ready" | "drifted";

export function catalogAdditionDriftState(a: CatalogAddition): CatalogAdditionDriftState {
  if (a.status === "landed") return "reconciled";
  return isBuiltInCatalogCode(a.itemId) ? "landed-ready" : "drifted";
}

/**
 * Project a DB CatalogAddition row to the InternalEstimateItem the catalog +
 * resolver overlays consume (primeCatalogAdditions / primeCostCodeAdditions /
 * primeCatalogPriceAdditions). procoreParentCode mirrors the granular procoreCode:
 * an addition carries no separate coarse parent, and the parent is a
 * non-authoritative back-compat fallback (the exporter groups by procoreCode).
 */
export function catalogAdditionToItem(a: CatalogAddition): InternalEstimateItem {
  return {
    itemId: a.itemId,
    procoreParentCode: a.procoreCode,
    procoreCode: a.procoreCode,
    description: a.description,
    targetUom: a.targetUom,
    defaultUnitPrice: a.defaultUnitPrice,
    costType: a.costType,
  };
}
