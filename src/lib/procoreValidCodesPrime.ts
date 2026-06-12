import type { ProcoreCostCode } from "@/types/db";
import { getProcoreCostCodes } from "@/lib/db";
import { primeProcoreValidCodes } from "@/lib/procoreValidCodes";

// ---------------------------------------------------------------------------
// Procore Cost Codes — Phase 4 cutover. The DB-loading half of the validation
// oracle flip. Kept SEPARATE from procoreValidCodes.ts (which db.ts imports for
// the persist/export gate) so we don't create a procoreValidCodes ↔ db cycle.
//
// FAIL-SOFT everywhere: any error (or an empty active set) leaves the JSON
// baseline as the backing set, so validation degrades to the (superset) JSON
// list and never blocks a legitimate code. Idempotent + module-global — safe to
// call at every code-validating surface mount (/cost-codes, /catalog,
// /projects/import, workspace via useTakeoffWorkbook).
// ---------------------------------------------------------------------------

/** Prime the validation oracle from an already-loaded master list (its ACTIVE
 *  rows). For surfaces that fetch the list anyway (e.g. /cost-codes, the
 *  workspace mount batch) — avoids a second round-trip. */
export function primeProcoreValidCodesFromList(codes: ProcoreCostCode[]): void {
  const active = codes
    .filter((c) => c.status === "active")
    .map((c) => ({ code: c.code, description: c.description }));
  if (active.length > 0) primeProcoreValidCodes(active);
}

/** Load the live master list and prime the oracle from its ACTIVE rows. For
 *  surfaces that don't otherwise need the full list. Fail-soft. */
export async function primeProcoreValidCodesFromDb(): Promise<void> {
  try {
    primeProcoreValidCodesFromList(await getProcoreCostCodes());
  } catch (err) {
    console.error(
      "Failed to prime Procore valid codes from DB (JSON baseline kept):",
      err,
    );
  }
}
