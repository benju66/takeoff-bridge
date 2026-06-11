import { CostCodeMapEntry } from "@/types/db";
import { InternalEstimateItem } from "@/types";
import { getCatalogItems } from "@/lib/catalog";

// ---------------------------------------------------------------------------
// resolveProcoreCode — the SINGLE chokepoint for deriving a row's granular
// Procore code from its internal itemId at row-creation time (Phase 3c).
//
// Backed by the cost_code_map table (primed at workspace mount via
// db.ts/getCostCodeMap), NOT the static catalog JSON. The catalog and the map
// were identical at 3a seed time, but the /cost-codes mapping editor is the
// designated update path — once a mapping is edited, only the map is truth.
//
// Resolution contract (AGENTS.md — no invented financial mappings):
// - hit  → the mapped granular Procore code
// - miss / unprimed → "" — the export completeness gate blocks empty codes and
//   routes the user to the interactive override modal. Never guessed.
//
// HAZARD (deferred until the per-type-templates phase): this is a SINGLE-SLOT
// cache keyed by internalCode only — the template_name dimension of
// cost_code_map is dropped because exactly one template exists
// (MASTER_TEMPLATE_NAME). When MF/TI/Medical templates land, this MUST become
// template-keyed (e.g. Map<templateName, Map<internalCode, code>>) or two
// open workspaces of different types would silently cross-wire mappings.
// ---------------------------------------------------------------------------

let resolverMap: Map<string, string> | null = null;

// Catalog-additions overlay (Catalog Manager Phase 6). A SEPARATE slot from the
// cost_code_map-primed resolverMap so the workspace's re-prime from the table
// never wipes it: additions are self-contained and carry their OWN procore_code,
// so cost_code_map gets NO widening. resolveProcoreCode consults resolverMap
// FIRST — a built-in (cost_code_map) always wins a code collision; the additions
// overlay only answers addition itemIds the map never carries.
let additionsProcoreMap: Map<string, string> | null = null;

/** Prime the resolver from cost_code_map rows (workspace mount / re-focus). */
export function primeCostCodeResolver(entries: CostCodeMapEntry[]): void {
  resolverMap = new Map(entries.map((e) => [e.internalCode, e.procoreCode]));
}

/**
 * Prime the catalog-additions procore-code overlay (Phase 6). Each addition
 * carries its own granular procore_code; this overlays it for the addition's
 * itemId. An empty list clears the overlay (identity — nothing primed).
 */
export function primeCostCodeAdditions(additions: InternalEstimateItem[]): void {
  additionsProcoreMap =
    additions.length > 0
      ? new Map(additions.map((a) => [a.itemId, a.procoreCode]))
      : null;
}

/**
 * Degraded fallback: prime from the static catalog. ONLY for the workspace
 * load-failure path (preserves the pre-3c graceful-degradation behavior, where
 * default rows carried catalog procoreCodes). Stale-mapping risk is confined
 * to sessions where the DB was unreachable — which auto-save can't reach either.
 */
export function primeCostCodeResolverFromCatalog(): void {
  console.warn(
    "costCodeResolver: priming from static catalog (cost_code_map unavailable) — mappings may be stale until reload."
  );
  resolverMap = new Map(
    Object.values(getCatalogItems()).map((item) => [item.itemId, item.procoreCode])
  );
}

/**
 * Resolve an internal itemId to its granular Procore code ("" on miss/unprimed).
 * cost_code_map (built-in) wins; an addition's self-contained procore_code is the
 * fallback for addition itemIds the map never carries (no cost_code_map widening).
 */
export function resolveProcoreCode(itemId: string): string {
  return resolverMap?.get(itemId) ?? additionsProcoreMap?.get(itemId) ?? "";
}

/** Test-only: clear the module-level caches (resolver + additions overlay). */
export function resetCostCodeResolver(): void {
  resolverMap = null;
  additionsProcoreMap = null;
}
