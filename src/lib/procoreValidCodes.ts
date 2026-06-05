import procoreValidCodes from "./procore-valid-codes.json";

// ---------------------------------------------------------------------------
// Procore valid-code oracle (Phase 3c) — the SINGLE shared view over
// src/lib/procore-valid-codes.json (emitted from the template's Importer Data
// Fields sheet by `npm run sync-codes`; drift-guarded by
// src/__tests__/procore-valid-codes-sync.test.ts).
//
// Both surfaces that let a human pick a Procore code — the /cost-codes mapping
// editor and the export override modal — MUST consume these exports so they
// can never present different ideas of "valid" for the same financial decision.
// ---------------------------------------------------------------------------

export interface ProcoreValidCode {
  code: string;
  description: string;
}

/** All valid Procore codes, numerically sorted (e.g. 2-… before 10-…). */
export const PROCORE_VALID_CODES: ProcoreValidCode[] = [
  ...(procoreValidCodes as ProcoreValidCode[]),
].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

/** code → Procore description lookup. */
export const PROCORE_CODE_DESCRIPTIONS: ReadonlyMap<string, string> = new Map(
  PROCORE_VALID_CODES.map((v) => [v.code, v.description])
);

/** True when the code is on Procore's Importer Data Fields list. */
export function isValidProcoreCode(code: string): boolean {
  return PROCORE_CODE_DESCRIPTIONS.has(code);
}
