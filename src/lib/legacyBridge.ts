/**
 * legacyBridge.ts — derive a legacy workbook's OWN code mapping (Import past
 * bids, Phase 2).
 *
 * Pre-app bids carry bare base codes on STEP 4 (no deterministic suffix), but
 * their "Budget Line Items" sheet maps each Procore budget code to a STEP 4
 * bare code mechanically: every BLI Budget Amount is a
 * `SUMIF('STEP 4 - ESTIMATE'!$C$…, 'STEP 4 - ESTIMATE'!C<n>, …)` whose
 * CRITERION cell holds the bare code being rolled up. Parsing that criterion
 * yields `bareCode → procoreCode` with certainty — the workbook's own author
 * wired it — so import normalization can suggest deterministic codes instead
 * of guessing.
 *
 * Best-effort by design, never a guess:
 *  - only formulas whose criterion is a single STEP 4 col-C cell count;
 *  - shared-formula cells with no formula text are skipped;
 *  - a bare code claimed by two DIFFERENT Procore codes is dropped (conflict);
 *  - col-A codes must pass `isValidProcoreCode` (today's Importer Data Fields).
 *
 * Lives on the ExcelJS side (takes a loaded Workbook) — the pure suggestion
 * ranking that consumes the resulting Map is in importEstimate.ts, which must
 * stay out of the ExcelJS module graph.
 */

import type ExcelJS from "exceljs";
import { SHEET, readCell } from "./templateExtractor";
import { isValidProcoreCode } from "./procoreValidCodes";

/** Splits a formula's top-level arguments (commas inside quotes don't split). */
function splitTopLevelArgs(body: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let inQuote = false;
  let current = "";
  for (const ch of body) {
    if (ch === "'") inQuote = !inQuote;
    if (!inQuote) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === "," && depth === 0) {
        args.push(current.trim());
        current = "";
        continue;
      }
    }
    current += ch;
  }
  if (current.trim() !== "") args.push(current.trim());
  return args;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A single `'STEP 4 - ESTIMATE'!C<n>` reference (quotes/absolute-$ optional). */
const STEP4_C_REF_RE = new RegExp(`^'?${escapeRegExp(SHEET.step4)}'?!\\$?C\\$?(\\d+)$`, "i");

/**
 * Extracts the STEP 4 row number from a SUMIF criterion that is a single
 * STEP 4 col-C cell reference. Returns 0 when the criterion is anything else
 * (a range, another sheet, a literal).
 */
function step4CriterionRow(criterion: string): number {
  if (criterion.includes(":")) return 0; // a range is never a criterion cell
  const m = STEP4_C_REF_RE.exec(criterion);
  return m ? Number(m[1]) : 0;
}

/**
 * Walks the legacy Budget Line Items sheet and derives `bareCode → procoreCode`
 * from its SUMIF formulas. Empty Map when the workbook has no BLI sheet (or no
 * parsable formulas) — callers fall back to the description-similarity tier.
 */
export function deriveLegacyBridge(wb: ExcelJS.Workbook): Map<string, string> {
  const bli = wb.getWorksheet(SHEET.bli);
  const s4 = wb.getWorksheet(SHEET.step4);
  const map = new Map<string, string>();
  if (!bli || !s4) return map;

  const conflicted = new Set<string>();
  for (let r = 2; r <= bli.rowCount; r++) {
    const procoreCode = String(readCell(bli, `A${r}`).value ?? "").trim();
    if (!procoreCode.includes("-") || !isValidProcoreCode(procoreCode)) continue;

    const formula = readCell(bli, `H${r}`).formula;
    if (!formula) continue; // literal or sharedFormula-only — skip, never guess

    const open = formula.toUpperCase().indexOf("SUMIF(");
    if (open < 0) continue;
    const body = formula.slice(open + "SUMIF(".length, formula.lastIndexOf(")"));
    const args = splitTopLevelArgs(body);
    if (args.length < 3) continue;

    const criterionRow = step4CriterionRow(args[1]);
    if (!criterionRow) continue; // criterion isn't a STEP 4 col-C cell

    const bareCode = String(readCell(s4, `C${criterionRow}`).value ?? "").trim();
    if (!bareCode) continue;

    const existing = map.get(bareCode);
    if (existing !== undefined && existing !== procoreCode) {
      conflicted.add(bareCode); // two Procore codes claim one bare code
      continue;
    }
    map.set(bareCode, procoreCode);
  }
  for (const code of conflicted) map.delete(code);
  return map;
}
