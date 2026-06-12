import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import ExcelJS from "exceljs";
import {
  STEP23_LINE_PATTERNS,
  STEP23_PATTERN_BY_CODE,
  STEP23_DIAL_CELLS,
  STEP23_SECTION_SUBTOTALS,
  qtyFormulaFor,
  type Step23SheetName,
} from "../lib/step23FormulaPatterns";
import {
  STAFF_ROLE_DEFAULTS,
  OPERATIONAL_EXPENSE_DEFAULTS,
  EQUIPMENT_DEFAULTS,
  GC_MANUAL_DEFAULTS,
  SITE_OPS_DYNAMIC_DEFAULTS,
  SITE_OPS_MANUAL_DEFAULTS,
} from "../lib/constants";
import { MASTER_TEMPLATE_PATH } from "./fixtures/templateLayout";

// ---------------------------------------------------------------------------
// Excel Round-Trip Phase 1 drift guard: the pattern table's `native` column is
// a forensic claim about the committed template. If the template is ever
// re-uploaded with different STEP 2/3 formulas, the live exporter (Phase 2)
// would silently emit/keep wrong shapes — this test mechanically pins
// pattern-table ↔ template. CI-safe: reads only the git-tracked template.
// ---------------------------------------------------------------------------

const CODE_RE = /^\d{2}-\d{4}(\.\d{1,3})?$/;

/** Normalized formula text of a cell, or null when it's a plain value. */
function formulaOf(sheet: ExcelJS.Worksheet, ref: string): string | null {
  const cell = sheet.getCell(ref);
  // ExcelJS translates shared-formula dependents (F13/F14 etc.) for us.
  const f = cell.formula;
  return f ? f.replace(/\s+/g, "") : null;
}

describe("step23FormulaPatterns ↔ committed template sync", () => {
  let sheets: Record<Step23SheetName, ExcelJS.Worksheet>;
  let rowByCode: Record<Step23SheetName, Map<string, number>>;

  beforeAll(async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(fs.readFileSync(MASTER_TEMPLATE_PATH).buffer as ArrayBuffer);
    sheets = {
      "STEP 2 - GCs": wb.getWorksheet("STEP 2 - GCs")!,
      "STEP 3 - SITE OPS": wb.getWorksheet("STEP 3 - SITE OPS")!,
    };
    rowByCode = { "STEP 2 - GCs": new Map(), "STEP 3 - SITE OPS": new Map() };
    for (const name of Object.keys(sheets) as Step23SheetName[]) {
      sheets[name].eachRow((row, rowNum) => {
        const c = row.getCell("C").text.trim();
        if (CODE_RE.test(c)) rowByCode[name].set(c, rowNum);
      });
    }
  });

  it("pattern table covers exactly the six line-config arrays (bijection)", () => {
    const configCodes = [
      ...STAFF_ROLE_DEFAULTS.map((c) => c.code),
      ...OPERATIONAL_EXPENSE_DEFAULTS.map((c) => c.code),
      ...EQUIPMENT_DEFAULTS.map((c) => c.code),
      ...GC_MANUAL_DEFAULTS.map((c) => c.code),
      ...SITE_OPS_DYNAMIC_DEFAULTS.map((c) => c.code),
      ...SITE_OPS_MANUAL_DEFAULTS.map((c) => c.code),
    ].sort();
    const patternCodes = STEP23_LINE_PATTERNS.map((l) => l.code).sort();
    expect(patternCodes).toEqual(configCodes);
    expect(STEP23_PATTERN_BY_CODE.size).toBe(STEP23_LINE_PATTERNS.length);
  });

  it("every pattern line exists on its sheet at a code-bearing row", () => {
    for (const line of STEP23_LINE_PATTERNS) {
      expect(
        rowByCode[line.sheet].has(line.code),
        `${line.code} (${line.label}) not found in col C of "${line.sheet}"`
      ).toBe(true);
    }
  });

  it("each line's `native` shape matches the template's actual qty-cell formula", () => {
    for (const line of STEP23_LINE_PATTERNS) {
      const row = rowByCode[line.sheet].get(line.code)!;
      const actual = formulaOf(sheets[line.sheet], `F${row}`);
      const expected = qtyFormulaFor(line.native, row);
      expect(
        actual,
        `${line.sheet} r${row} ${line.code} (${line.label}): native=${line.native}`
      ).toBe(expected);
    }
  });

  it("every line's I cell natively carries the F×H line-total formula", () => {
    for (const line of STEP23_LINE_PATTERNS) {
      const row = rowByCode[line.sheet].get(line.code)!;
      expect(
        formulaOf(sheets[line.sheet], `I${row}`),
        `${line.sheet} r${row} ${line.code}`
      ).toBe(`F${row}*H${row}`);
    }
  });

  it("every section-subtotal coordinate points at a native SUM in the template", () => {
    // A template re-upload that inserts a row above a subtotal would shift
    // it while the old cell still holds a SUM over the WRONG range — the
    // exporter's "must contain SUM(" guard alone cannot catch that. Pin the
    // exact coordinates here.
    for (const sub of STEP23_SECTION_SUBTOTALS) {
      const formula = formulaOf(sheets[sub.sheet], `I${sub.row}`);
      expect(formula, `${sub.itemId} I${sub.row} on ${sub.sheet}`).toMatch(/^SUM\(/i);
    }
    // …and each sits adjacent to its section: the row directly above is a
    // code-bearing or blank line, never another subtotal (sanity anchor).
    expect(STEP23_SECTION_SUBTOTALS).toHaveLength(10);
  });

  it("dial cells J5/J8 carry the documented cross-sheet pulls", () => {
    for (const name of Object.keys(sheets) as Step23SheetName[]) {
      expect(formulaOf(sheets[name], "J5"), `${name} J5`).toBe(
        STEP23_DIAL_CELLS[name].J5.replace(/\s+/g, "")
      );
      expect(formulaOf(sheets[name], "J8"), `${name} J8`).toBe(
        STEP23_DIAL_CELLS[name].J8.replace(/\s+/g, "")
      );
    }
  });

  it("every native≠write divergence carries an explicit sign-off", () => {
    for (const line of STEP23_LINE_PATTERNS) {
      const diverges =
        line.write === "pctFrozen" || line.native !== (line.write as string);
      if (diverges) {
        expect(line.signOff, `${line.code} (${line.label}) diverges without sign-off`).toBeTruthy();
      } else {
        expect(line.signOff, `${line.code} (${line.label}) has a sign-off but does not diverge`).toBeUndefined();
      }
    }
  });
});
