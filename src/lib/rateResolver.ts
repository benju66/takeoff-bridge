import { RateCardEntry } from "@/types/db";

// ---------------------------------------------------------------------------
// rateResolver — the SINGLE chokepoint for the COMPANY-DEFAULT rate layer
// (Rate-card slice 1). Twin of costCodeResolver.ts.
//
// Backed by the rate_card table (primed at workspace mount via db.ts/getRateCard
// — Phase B), NOT constants.ts directly. The seed equals today's constants
// values, so day-one behavior is byte-identical; once the /rates editor (Phase
// C) edits a rate, the card is the truth for the company-default layer.
//
// Resolution contract: this module resolves ONLY the company layer.
// - hit  → the card's rate for that line_code
// - miss / unprimed → the caller's `fallback` (the constants.ts default). The
//   fallback keeps calc pure and byte-identical before the card is primed and
//   for any line the card doesn't carry — never a guessed financial value.
//
// The full layered chain lives in the calc hooks (Phase B), NOT here:
//   rate = projectOverride ?? projectSnapshot ?? resolveCompanyRate(code, fallback)
// calculations.ts imports nothing from this module; it receives an injected
// rateLookup whose default returns the fallback (so existing callers/tests are
// unchanged).
//
// HAZARD (deferred, matches costCodeResolver): SINGLE-SLOT cache keyed by
// line_code only — the template_name dimension of rate_card is dropped because
// exactly one template exists (MASTER_TEMPLATE_NAME). When per-type templates
// land, this MUST become template-keyed or two open workspaces of different
// types would cross-wire rates.
// ---------------------------------------------------------------------------

let rateCardMap: Map<string, number> | null = null;

/** Prime the company-rate cache from rate_card rows (workspace mount / re-focus). */
export function primeRateCard(entries: RateCardEntry[]): void {
  rateCardMap = new Map(entries.map((e) => [e.lineCode, e.rate]));
}

/**
 * Resolve a line's COMPANY-DEFAULT rate by its constants.ts `code`.
 * Returns the card rate on a hit; otherwise `fallback` (the constants default)
 * — on a miss OR when the card is unprimed. Pure scalar lookup; the layered
 * override/snapshot chain is composed by the calc hooks (Phase B).
 */
export function resolveCompanyRate(code: string, fallback: number): number {
  return rateCardMap?.get(code) ?? fallback;
}

/**
 * Catalog-price alias of `resolveCompanyRate` for the STEP 4 unit-price call
 * sites that resolve a row's price at birth (template init, CSV import, itemId
 * change). Same single primed map — NO separate cache, NO different behavior;
 * just a name that reads as "catalog unit price" rather than "GC/Site Ops rate"
 * where the disjoint catalog `itemId` keys are looked up. (Rate-card slice 2,
 * Phase B.) On a card miss / unprimed it returns `fallback` (the constants.ts /
 * JSON default), so day-one behavior is byte-identical to the hard-coded read.
 */
export function resolveCatalogPrice(itemId: string, fallback: number): number {
  return resolveCompanyRate(itemId, fallback);
}

/**
 * Snapshot the currently-primed company card as a plain `Record<line_code,
 * rate>` for freeze-at-first-save (Phase B). Returns a COPY (immune to later
 * re-primes) or `null` if the card is unprimed — the caller then persists `{}`
 * and freezes on a later save once the card is primed.
 */
export function snapshotRateCard(): Record<string, number> | null {
  if (!rateCardMap) return null;
  return Object.fromEntries(rateCardMap);
}

/** Test-only: clear the module-level cache. */
export function resetRateCard(): void {
  rateCardMap = null;
}
