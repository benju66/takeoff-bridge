/**
 * procoreCostCodes.ts — pure helpers for the /procore-codes management page
 * (Procore Cost Codes master-list — Phase 2).
 *
 * Validation, diffing, and export-workbook construction for the Procore Cost
 * Codes import/export flow. Everything here is pure (no DB, no DOM) so the
 * round-trip — parse → validate → export → re-parse — is unit-testable.
 *
 * The validation vocabulary + shape mirror the seed generator
 * (scripts/generate-procore-cost-codes-seed.js) and the DB CHECK constraint, so
 * nothing the page can apply could ever violate procore_cost_codes.
 */

import ExcelJS from "exceljs";
import type { ProcoreCostCode, ProcoreCostCodeType } from "@/types/db";
import type { ParsedProcoreCostCodeRow } from "@/lib/xlsx-reader";

/** The four valid Procore cost-code types (matches the DB CHECK + the seed). */
export const PROCORE_COST_CODE_TYPES: ProcoreCostCodeType[] = [
  "Labor",
  "Material",
  "Subcontract",
  "Equipment",
];

/** The 3-column export header, in order. */
export const PROCORE_COST_CODE_HEADERS = ["Cost Code", "Type", "Description"] as const;

/** A parsed row that has passed shape + type validation. */
export interface ValidatedProcoreCostCodeRow {
  code: string;
  type: ProcoreCostCodeType;
  description: string;
}

export interface ProcoreImportValidation {
  ok: boolean;
  /** Validated rows (only meaningful when ok === true). */
  rows: ValidatedProcoreCostCodeRow[];
  /** Human-readable problems; non-empty iff ok === false. */
  errors: string[];
}

function isProcoreType(value: string): value is ProcoreCostCodeType {
  return (PROCORE_COST_CODE_TYPES as string[]).includes(value);
}

/**
 * Validate raw parsed rows against the procore_cost_codes shape + vocabulary.
 * Fail-loud and TOTAL: every problem is collected so the importer can show the
 * full list, and a single bad row makes the whole import invalid (no partial
 * apply). Rules (mirroring the seed):
 *   - non-empty code; non-empty description;
 *   - type ∈ {Labor, Material, Subcontract, Equipment};
 *   - no duplicate code within the file.
 */
export function validateProcoreImportRows(
  rawRows: ParsedProcoreCostCodeRow[],
): ProcoreImportValidation {
  const errors: string[] = [];
  const rows: ValidatedProcoreCostCodeRow[] = [];
  const seen = new Set<string>();

  if (rawRows.length === 0) {
    return { ok: false, rows: [], errors: ["The file contains no cost-code rows."] };
  }

  rawRows.forEach((r, i) => {
    // +2: 1-based sheet row, accounting for the header row.
    const line = i + 2;
    const code = r.code.trim();
    const type = r.type.trim();
    const description = r.description.trim();

    if (!code) errors.push(`Row ${line}: empty Cost Code.`);
    if (!description) errors.push(`Row ${line}: empty Description${code ? ` for ${code}` : ""}.`);
    if (!isProcoreType(type)) {
      errors.push(
        `Row ${line}: invalid Type "${type}"${code ? ` for ${code}` : ""} — must be one of ${PROCORE_COST_CODE_TYPES.join(", ")}.`,
      );
    }
    if (code && seen.has(code)) {
      errors.push(`Row ${line}: duplicate Cost Code ${code}.`);
    }
    if (code) seen.add(code);

    if (code && description && isProcoreType(type)) {
      rows.push({ code, type, description });
    }
  });

  return errors.length === 0
    ? { ok: true, rows, errors: [] }
    : { ok: false, rows: [], errors };
}

// ---------------------------------------------------------------------------
// Diff — incoming (validated) file vs. the current DB master list
// ---------------------------------------------------------------------------

export interface ProcoreCostCodeChange {
  code: string;
  from: { type: ProcoreCostCodeType; description: string; status: ProcoreCostCode["status"] };
  to: { type: ProcoreCostCodeType; description: string };
}

export interface ProcoreCostCodeDiff {
  /** In the file, no row in the DB at all → new codes. */
  added: ValidatedProcoreCostCodeRow[];
  /** In the file AND the DB, but type/description differ OR the DB row is not
   *  active (a re-activation). */
  changed: ProcoreCostCodeChange[];
  /** Active in the DB but ABSENT from the file → PROPOSED retirements. Never
   *  auto-applied (architect-locked: a partial/bad export must not nuke live
   *  codes). */
  proposedRetirements: ProcoreCostCode[];
  /** Count of file rows that exactly match an active DB row (no change). */
  unchanged: number;
}

/**
 * Compare the incoming validated file against the full current DB list.
 * Comparison key is `code`. Retired/merged DB rows that are absent from the
 * file are NOT proposed retirements (they're already not active); only ACTIVE
 * DB codes missing from the file are.
 */
export function diffProcoreCostCodes(
  current: ProcoreCostCode[],
  incoming: ValidatedProcoreCostCodeRow[],
): ProcoreCostCodeDiff {
  const byCode = new Map(current.map((c) => [c.code, c]));
  const incomingCodes = new Set(incoming.map((r) => r.code));

  const added: ValidatedProcoreCostCodeRow[] = [];
  const changed: ProcoreCostCodeChange[] = [];
  let unchanged = 0;

  for (const row of incoming) {
    const existing = byCode.get(row.code);
    if (!existing) {
      added.push(row);
      continue;
    }
    const sameContent =
      existing.type === row.type && existing.description === row.description;
    if (sameContent && existing.status === "active") {
      unchanged += 1;
    } else {
      changed.push({
        code: row.code,
        from: { type: existing.type, description: existing.description, status: existing.status },
        to: { type: row.type, description: row.description },
      });
    }
  }

  const proposedRetirements = current
    .filter((c) => c.status === "active" && !incomingCodes.has(c.code))
    .sort((a, b) => a.code.localeCompare(b.code));

  return { added, changed, proposedRetirements, unchanged };
}

// ---------------------------------------------------------------------------
// Export — current table → 3-column .xlsx (the same shape Procore emits)
// ---------------------------------------------------------------------------

/**
 * Build a 3-column (Cost Code | Type | Description) .xlsx buffer from the given
 * codes, in the exact order supplied (the caller decides ordering). Order-
 * preserving and lossless, so parse → export → re-parse is row-identical. Used
 * for the page download and proven by the round-trip test.
 */
export async function buildProcoreCostCodesWorkbookBuffer(
  codes: Array<Pick<ProcoreCostCode, "code" | "type" | "description">>,
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow([...PROCORE_COST_CODE_HEADERS]);
  for (const c of codes) {
    ws.addRow([c.code, c.type, c.description]);
  }
  return wb.xlsx.writeBuffer();
}
