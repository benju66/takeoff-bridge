import { CostCodeMapEntry } from "@/types/db";
import { ESTIMATE_ITEMS_MASTER } from "@/lib/mock-data";

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

/** Prime the resolver from cost_code_map rows (workspace mount / re-focus). */
export function primeCostCodeResolver(entries: CostCodeMapEntry[]): void {
  resolverMap = new Map(entries.map((e) => [e.internalCode, e.procoreCode]));
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
    Object.values(ESTIMATE_ITEMS_MASTER).map((item) => [item.itemId, item.procoreCode])
  );
}

/** Resolve an internal itemId to its granular Procore code ("" on miss/unprimed). */
export function resolveProcoreCode(itemId: string): string {
  return resolverMap?.get(itemId) ?? "";
}

/** Test-only: clear the module-level cache. */
export function resetCostCodeResolver(): void {
  resolverMap = null;
}
