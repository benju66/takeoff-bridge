/**
 * procoreTypeReconciliation.ts — pure, type-aware reconciliation between the
 * estimate-side cost-code mapping (cost_code_map) and the Procore master list
 * (procore_cost_codes). Procore Cost Codes — Phase 3.
 *
 * The /cost-codes page now reads the typed Procore master list and surfaces two
 * read-only advisories computed here (NO auto-fix — fixing the estimate catalog's
 * costType values is the follow-on reconciliation workstream):
 *   - TYPE MISMATCH:  an estimate code maps to a Procore base that exists, but the
 *                     estimate's cost type disagrees with Procore's type for it.
 *   - MISSING BASE:   an estimate code maps to a Procore base NOT in the master
 *                     list (e.g. a dropped/retire-candidate code).
 *
 * Everything here is pure (no DB, no DOM) so the measured counts (67 mismatches /
 * 8 missing-base on the canonical seed data) are unit-pinned. This module does
 * NOT touch export validation — the JSON oracle stays the validation gate until
 * Phase 4.
 */

import type { ProcoreCostCodeType } from "@/types/db";
import { isLinkedDivisionRow } from "@/lib/constants";

/**
 * Estimate-side cost-type vocabulary (L/M/S) → Procore type. The estimate catalog
 * carries only Labor/Material/Subcontract; Procore additionally has **Equipment**,
 * which has NO estimate counterpart. That gap is intentional: an estimate code can
 * never *be* Equipment, so any estimate code mapped to an Equipment-typed Procore
 * base always reads as a mismatch here. Resolving the Equipment gap (extending the
 * estimate vocabulary) is deferred to the follow-on reconciliation workstream.
 */
export const ESTIMATE_TO_PROCORE_TYPE: Readonly<Record<string, ProcoreCostCodeType>> = {
  L: "Labor",
  M: "Material",
  S: "Subcontract",
};

/** Map an estimate costType (L/M/S, case/space-insensitive) to a Procore type, or null. */
export function estimateCostTypeToProcore(costType: string): ProcoreCostCodeType | null {
  return ESTIMATE_TO_PROCORE_TYPE[(costType ?? "").trim().toUpperCase()] ?? null;
}

/** One estimate code whose mapped Procore base exists but with a disagreeing type. */
export interface TypeMismatch {
  internalCode: string;
  procoreCode: string;
  /** Raw estimate-side cost type (L/M/S as stored on the catalog item). */
  estimateCostType: string;
  /** Estimate type mapped to Procore's vocabulary; null when L/M/S can't map it. */
  estimateType: ProcoreCostCodeType | null;
  /** Procore's type for the mapped base code. */
  procoreType: ProcoreCostCodeType;
}

/** One estimate code mapped to a Procore base absent from the master list. */
export interface MissingBase {
  internalCode: string;
  procoreCode: string;
}

export interface TypeReconciliation {
  mismatches: TypeMismatch[];
  missingBase: MissingBase[];
}

/** Minimal mapping shape consumed here (a subset of CostCodeMapEntry). */
export interface MappingForReconciliation {
  internalCode: string;
  procoreCode: string;
}

/**
 * Compare each estimate→Procore mapping against the typed Procore master list.
 *
 * @param mappings           the cost_code_map rows (internalCode → procoreCode).
 * @param catalogByInternalCode  catalog keyed by internalCode; only `.costType`
 *                           is read. A mapping whose internalCode has no catalog
 *                           item is skipped (no estimate type to compare).
 * @param procoreTypeByCode  the ACTIVE Procore master list: code → type.
 *
 * A mapping is a MISSING_BASE when its procoreCode is not in the master list;
 * otherwise it is a TYPE_MISMATCH when the estimate's type disagrees with
 * Procore's. Results are sorted by internalCode for stable display.
 *
 * Phase 4: with `options.exemptLinkedDivision`, a mapping that WOULD be a
 * MISSING_BASE is suppressed when its internalCode is a linked-division summary
 * row (isLinkedDivisionRow). Those 8 division-02 summaries map to the retired
 * `2-20000.000` base — pure noise in the advisory because the export never
 * writes them (they carry STEP 2/3 dollars, excluded from the STEP 4 rollup).
 * The exemption is scoped to the missing-base branch ONLY: a linked-division row
 * whose base DOES exist with a disagreeing type is still a real mismatch finding,
 * so the canonical 67 mismatch count is unaffected. The default (no options)
 * keeps the unexempted behavior so the 67/8 counts stay pinned and the exemption
 * stays honest/visible.
 */
export function computeTypeReconciliation(
  mappings: MappingForReconciliation[],
  catalogByInternalCode: Record<string, { costType: string } | undefined>,
  procoreTypeByCode: ReadonlyMap<string, ProcoreCostCodeType>,
  options?: { exemptLinkedDivision?: boolean },
): TypeReconciliation {
  const mismatches: TypeMismatch[] = [];
  const missingBase: MissingBase[] = [];

  for (const m of mappings) {
    const procoreType = procoreTypeByCode.get(m.procoreCode);
    if (!procoreType) {
      // Linked-division summaries map to the retired 2-20000.000 base and never
      // export — exempt them from the missing-base advisory (8 → 0).
      if (options?.exemptLinkedDivision && isLinkedDivisionRow(m.internalCode)) continue;
      missingBase.push({ internalCode: m.internalCode, procoreCode: m.procoreCode });
      continue;
    }
    const item = catalogByInternalCode[m.internalCode];
    if (!item) continue; // no estimate item → nothing to compare
    const estimateType = estimateCostTypeToProcore(item.costType);
    if (estimateType !== procoreType) {
      mismatches.push({
        internalCode: m.internalCode,
        procoreCode: m.procoreCode,
        estimateCostType: item.costType,
        estimateType,
        procoreType,
      });
    }
  }

  mismatches.sort((a, b) => a.internalCode.localeCompare(b.internalCode));
  missingBase.sort((a, b) => a.internalCode.localeCompare(b.internalCode));
  return { mismatches, missingBase };
}
