import procoreValidCodes from "./procore-valid-codes.json";
import type { ProcoreCostCodeType } from "@/types/db";

// ---------------------------------------------------------------------------
// Procore valid-code oracle — the SINGLE shared view over the set of codes a
// human (or the export gate) may pick.
//
// Phase 3c baseline: this set came from src/lib/procore-valid-codes.json (224
// codes, emitted from the template's Importer Data Fields sheet by
// `npm run sync-codes`; drift-guarded by procore-valid-codes-sync.test.ts).
//
// Phase 4 cutover: the live `procore_cost_codes` ACTIVE list (217) is now the
// oracle. The JSON stays the COLD-START / SSR baseline and the fail-soft
// fallback; primeProcoreValidCodes() swaps the backing set to the DB-active
// rows at each code-validating surface mount (see procoreValidCodesPrime.ts).
// The swap MUTATES the exported collections IN PLACE (same array/Map refs) so
// no consumer's `import { PROCORE_VALID_CODES }` ever goes stale — call-site
// shapes are unchanged.
//
// Fail-safe by construction: DB-active (217) is a strict SUBSET of the JSON
// baseline (224), so an unprimed window (or a failed prime) can only ever
// ACCEPT one of the 7 retired-by-absence codes (all unreferenced) — it can
// never REJECT a legitimate code.
// ---------------------------------------------------------------------------

export interface ProcoreValidCode {
  code: string;
  description: string;
  /**
   * Procore cost type (Labor/Material/Subcontract/Equipment), present only when the
   * oracle was primed from the live `procore_cost_codes` master list (Phase B5 — the
   * one-off escape hatch needs it to stamp an assigned one-off's cost type, D1). The
   * JSON baseline has no type, so it is OPTIONAL — `getProcoreCostType` returns null
   * for an unprimed/baseline code, and the one-off assign flow defaults sensibly.
   */
  type?: ProcoreCostCodeType;
}

const numericSort = (a: ProcoreValidCode, b: ProcoreValidCode) =>
  a.code.localeCompare(b.code, undefined, { numeric: true });

/** The JSON baseline — cold-start/SSR backing set and the fail-soft fallback. */
const JSON_BASELINE: ProcoreValidCode[] = [
  ...(procoreValidCodes as ProcoreValidCode[]),
].sort(numericSort);

/**
 * All valid Procore codes, numerically sorted (e.g. 2-… before 10-…). The array
 * REFERENCE is stable for the module's lifetime — primeProcoreValidCodes()
 * mutates its contents in place, so consumers keep this same binding.
 */
export const PROCORE_VALID_CODES: ProcoreValidCode[] = [...JSON_BASELINE];

/** Internal mutable backing for the description lookup; exported below as a
 *  ReadonlyMap view over this same reference. */
const descByCode = new Map<string, string>(
  JSON_BASELINE.map((v) => [v.code, v.description]),
);

/** Internal mutable backing for the code → Procore type lookup. Empty under the JSON
 *  baseline (no type), populated by primeProcoreValidCodes when given typed rows. */
const typeByCode = new Map<string, ProcoreCostCodeType>();

/** code → Procore description lookup (mutated in place by primeProcoreValidCodes). */
export const PROCORE_CODE_DESCRIPTIONS: ReadonlyMap<string, string> = descByCode;

/** True when the code is on the active Procore master list (DB-primed in Phase 4),
 *  or — before the prime runs / if it failed — on the JSON baseline. */
export function isValidProcoreCode(code: string): boolean {
  return descByCode.has(code);
}

/**
 * The Procore cost type for a code, or null when unknown (the JSON baseline carries no
 * type, so this is null until the oracle is primed from the live master list). Phase B5
 * (D1): the one-off assign flow uses this to stamp an assigned one-off's cost type.
 */
export function getProcoreCostType(code: string): ProcoreCostCodeType | null {
  return typeByCode.get(code) ?? null;
}

/**
 * Phase 4 cutover: swap the validation oracle's backing set to `codes` — the live
 * `procore_cost_codes` ACTIVE rows — making the DB the source of truth. Mutates the
 * exported collections IN PLACE (same references) so no consumer import goes stale.
 * Idempotent + module-global. Keeping the JSON baseline (fail-soft) is simply not
 * calling this; resetProcoreValidCodes() restores it explicitly.
 */
export function primeProcoreValidCodes(codes: ProcoreValidCode[]): void {
  const sorted = [...codes].sort(numericSort);
  PROCORE_VALID_CODES.length = 0;
  PROCORE_VALID_CODES.push(...sorted);
  descByCode.clear();
  typeByCode.clear();
  for (const v of sorted) {
    descByCode.set(v.code, v.description);
    if (v.type) typeByCode.set(v.code, v.type);
  }
}

/** Restore the JSON baseline backing set (used by tests; also the explicit
 *  "fall back" path if a caller ever needs to undo a prime). */
export function resetProcoreValidCodes(): void {
  primeProcoreValidCodes(JSON_BASELINE);
}
