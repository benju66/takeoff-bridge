import { InternalEstimateItem } from "@/types";
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

/**
 * Prime the in-app catalog additions overlay (Phase 6 wires the DB fetch here,
 * at the existing prime sites). An empty list is treated as nothing primed so
 * the identity contract holds.
 */
export function primeCatalogAdditions(items: InternalEstimateItem[]): void {
  primedAdditions = items.length > 0 ? items : null;
}

/** Test-only: clear the primed additions overlay. */
export function resetCatalog(): void {
  primedAdditions = null;
}

/**
 * The merged STEP 4 catalog keyed by itemId. Nothing primed ⇒ the exact
 * ESTIMATE_ITEMS_MASTER reference. With additions primed, additions are layered
 * first and the built-ins overwrite any colliding code (built-in always wins).
 */
export function getCatalogItems(): Record<string, InternalEstimateItem> {
  if (!primedAdditions) return ESTIMATE_ITEMS_MASTER;
  const merged: Record<string, InternalEstimateItem> = {};
  for (const add of primedAdditions) merged[add.itemId] = add;
  return Object.assign(merged, ESTIMATE_ITEMS_MASTER);
}
