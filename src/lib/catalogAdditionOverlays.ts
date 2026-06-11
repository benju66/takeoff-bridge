import type { CatalogAddition } from "@/types/db";
import { catalogAdditionToItem, primeCatalogAdditions } from "@/lib/catalog";
import { primeCostCodeAdditions } from "@/lib/costCodeResolver";
import { primeCatalogPriceAdditions } from "@/lib/rateResolver";

// ---------------------------------------------------------------------------
// primeCatalogAdditionOverlays — the SINGLE place that primes all three
// catalog-additions overlays from DB rows (Catalog Manager Phase 7).
//
// A self-contained addition feeds three disjoint slots: the catalog chokepoint
// (catalog.ts — the item itself), the cost-code resolver (its own procore_code),
// and the catalog-price resolver (its own default_unit_price). Every site that
// loads additions must prime all three together or a row would be born with a
// code but no price (or vice-versa). With FIVE sites now (workspace mount,
// import, /catalog, /cost-codes, /rates) this one helper removes the chance of
// priming only some of them. An empty list clears every overlay (identity).
//
// No cycle: catalog.ts imports neither resolver; costCodeResolver imports
// catalog.ts (getCatalogItems) but not this module.
// ---------------------------------------------------------------------------

/** Prime the catalog-item, cost-code, and catalog-price additions overlays from
 *  catalog_additions rows in one call (the freeze-at-birth resolvers read these
 *  at row birth; built-in cost_code_map / rate_card always win a code collision). */
export function primeCatalogAdditionOverlays(additions: CatalogAddition[]): void {
  const items = additions.map(catalogAdditionToItem);
  primeCatalogAdditions(items);
  primeCostCodeAdditions(items);
  primeCatalogPriceAdditions(items);
}
