/**
 * Template Extractor — reads a company-estimate-template workbook (the McKenna
 * oracle and, in future, any "upload a past estimate as a project" file) into a
 * typed `ExtractedEstimate`: the project inputs, the STEP 4 line items, and the
 * live oracle outputs (subtotals, modifiers, totals) the engine is proven
 * against.
 *
 * Why this is a library module, not a test helper: the reproduction harness
 * (`src/__tests__/golden-mckenna.test.ts`) uses it to prove the engine matches a
 * real bid to the cent, and the planned "import past estimates" feature will
 * reuse it verbatim to turn an existing workbook into a project.
 *
 * Design rules:
 *  - **Scan, never hardcode rows.** A real bid has rows inserted/deleted vs the
 *    blank template (McKenna's STEP 4 SUBTOTAL sits at row 328, not the
 *    template's 331). Anchors are found by scanning a column for a label
 *    ("SUBTOTAL", "Total Supervision", a cost-code pattern) so extraction
 *    survives template row shifts — the same way the exporter matches by code.
 *  - **Read cached results, faithfully.** This extends `xlsx-reader.ts`'s
 *    `extractCellValue` (which returns only a formula's cached result) to also
 *    expose the formula text and a strict numeric reading. Confidential dollar
 *    values are read at runtime; nothing is hardcoded.
 *  - **`calculations.ts` stays the sole financial authority.** This module only
 *    *reads* inputs and the spreadsheet's own outputs; it never re-derives a
 *    total or a markup.
 */

import ExcelJS from "exceljs";
import type { ProcessedTakeoffRow } from "@/types";
import { getMonthsBetween } from "./calculations";
import { ESTIMATE_MODIFIERS, LINKED_DIVISION_ROWS, isLinkedDivisionRow } from "./constants";
import { RECONCILIATION_TOLERANCE } from "./exporter";

// ---------------------------------------------------------------------------
// Sheet names (template-canonical)
// ---------------------------------------------------------------------------
export const SHEET = {
  step1: "STEP 1 - PROJECT DATA",
  step2: "STEP 2 - GCs",
  step3: "STEP 3 - SITE OPS",
  step4: "STEP 4 - ESTIMATE",
  bli: "Budget Line Items",
} as const;

/** A STEP 4 cost code, e.g. "03-0000.001" / "60-4000.001". */
const COST_CODE_RE = /^\d{2}-\d{4}\.\d{3}$/;

/**
 * A LEGACY STEP 4 cost code — bare base form with no deterministic suffix
 * (e.g. "03-3000"). Real pre-app bids use these exclusively; they carry the
 * division + family signal the import normalization flow matches against.
 */
const BARE_CODE_RE = /^\d{2}-\d{4}$/;

// ---------------------------------------------------------------------------
// Typed result shapes
// ---------------------------------------------------------------------------

export interface ExtractedModifierRates {
  constructionContingencyRate: number;
  designContingencyRate: number;
  buildersRiskRate: number;
  specialInsuranceRate: number;
  glInsuranceRate: number;
  bondRate: number;
  feeRate: number;
}

export interface ExtractedProjectInputs {
  projectName: string;
  squareFootage: number;
  unitCount: number;
  /** "YYYY-MM-DD" (or "" when absent). */
  startDate: string;
  finishDate: string;
  /** Computed via the engine's own `getMonthsBetween` from start/finish. */
  durationMonths: number;
  rates: ExtractedModifierRates;
}

export interface ExtractedLineItem {
  itemId: string;
  description: string;
  qty: number;
  unitPrice: number;
  /** Mirrors the sheet's `I = IF(ISNUMBER(F), F*H, 0)`: qty × unitPrice. */
  total: number;
  /** True for the 10 GC/Site-Ops linked division rows (their value comes from STEP 2/3). */
  isLinked: boolean;
  /**
   * True for a non-conforming STEP 4 line — a hand-typed row whose code cell does
   * NOT match `NN-NNNN.NNN` but which carries real dollars. These travel in
   * `ExtractedEstimate.adHocLineItems` (kept OUT of `lineItems` so the golden
   * extraction path is byte-identical); the import flow brings them in as
   * `needsReview` rows so no dollar is ever dropped.
   */
  isAdHoc: boolean;
  /** Source row number on STEP 4 (provenance / debugging). */
  rowNumber: number;
  /**
   * The code text as it appears in the sheet's code cell. Equals `itemId` for
   * conforming lines; for ad-hoc lines it preserves a LEGACY bare base code
   * (`NN-NNNN`) when present, `""` otherwise — the import normalization flow
   * needs it to bridge legacy codes to today's catalog.
   */
  rawCode: string;
  /**
   * The estimator's note from STEP 4 col E (`""` when blank). Estimators
   * annotate odd lines there; the import review shows it for mapping context
   * and it rides into the project as a custom field — never dropped.
   */
  comment: string;
  /**
   * The AS-BID unit of measure from STEP 4 col G, trimmed and uppercased
   * (`""` when blank — on real bids only the soft-cost 60-xxxx modifier rows
   * are blank, and those never become line items). Historical fidelity, same
   * rule as unitPrice: an as-bid $/SF price must never be relabeled EA by the
   * catalog. Non-financial — never feeds a total.
   */
  uom: string;
}

/** One value the spreadsheet itself computes — the thing the engine is proven against. */
export interface ExtractedModifierOutput {
  key: string;
  code: string;
  label: string;
  /** Decimal rate the bid used (from STEP 1 col G). */
  rate: number;
  /** The dollar value in the STEP 4 modifier cell (null if the cell has no cached number). */
  total: number | null;
  /** The label the SHEET shows for this modifier row (legacy bids relabel slots,
   *  e.g. 60-1005 "Owner's Rep"); `""` when the row is absent. */
  sheetLabel: string;
  /**
   * True when the row's dollar value is a hand-typed LUMP SUM rather than
   * rate × subtotal (|I − rate×subtotal| > RECONCILIATION_TOLERANCE). Legacy
   * bids carry these; the import flow records each as an audited override.
   */
  isLump: boolean;
  /** Source row number on STEP 4 (provenance for the override audit trail); 0 when absent. */
  rowNumber: number;
}

export interface ExtractedSheetLine {
  code: string;
  description: string;
  utilization: number | null;
  qty: number;
  rate: number;
  total: number;
  rowNumber: number;
  /** As-bid UOM from col G (trimmed, uppercased; `""` when blank) — staff lines
   *  carry HR/MO, lump scopes LS; rides into `imported_step23_lines` verbatim. */
  uom: string;
}

export interface ExtractedOracleOutputs {
  /** STEP 4 SUBTOTAL cell (Σ all line items incl. the 10 linked rows). */
  step4Subtotal: number;
  step4SubtotalRow: number;
  /** STEP 4 TOTAL cell (subtotal + the 7 modifiers). */
  totalEstimatedCost: number;
  step4TotalRow: number;
  /** STEP 4 modifier rows, by key (7 entries). */
  modifiers: ExtractedModifierOutput[];
  /** Cost/Unit cell (col J) on the TOTAL row; null if absent. */
  costPerUnit: number | null;
  /** Each of the 10 linked STEP 4 division rows and the value the sheet shows. */
  linkedDivisionValues: { itemId: string; total: number }[];
  /** STEP 2 "Total Supervision" (I16) — null if not a cached number. */
  step2SupervisionSubtotal: number | null;
  /** STEP 2 "Total Design, PM and GCs" (I58). */
  step2DesignPmGcSubtotal: number | null;
  /**
   * The 10 STEP 2/3 section subtotals keyed by the STEP 4 linked itemId they
   * feed, located by label (row-shift resilient). null where the cell has no
   * cached numeric result (e.g. an uncalculated shared-formula subtotal).
   */
  linkedSourceSubtotals: { itemId: string; total: number | null }[];
  /** Σ of every numeric Budget Line Items "Budget Amount" (col H). */
  bliNumericTotal: number;
  /** BLI rows whose col-H formula has no cached number (#REF!/uncalculated). */
  bliBrokenRowCount: number;
  /** Total BLI code rows scanned. */
  bliRowCount: number;
}

export interface ExtractedEstimate {
  inputs: ExtractedProjectInputs;
  lineItems: ExtractedLineItem[];
  /**
   * Non-conforming STEP 4 lines that carry dollars (code cell not `NN-NNNN.NNN`).
   * Kept SEPARATE from `lineItems` so the golden extraction/tie-out path is
   * byte-identical; the import flow folds these in as `needsReview` rows so a
   * finished bid's hand-typed lines are imported, never dropped.
   */
  adHocLineItems: ExtractedLineItem[];
  oracle: ExtractedOracleOutputs;
  /** STEP 2 line inputs (for future deep reconstruction / diagnostics). */
  step2Lines: ExtractedSheetLine[];
  /** STEP 3 line inputs. */
  step3Lines: ExtractedSheetLine[];
}

// ---------------------------------------------------------------------------
// Cell reading — extends xlsx-reader.ts's extractCellValue to also expose the
// formula text and a strict numeric reading of a cell's cached result.
// ---------------------------------------------------------------------------

export interface CellReading {
  /** Resolved display value (formula → cached result, Date → ISO date). */
  value: string | number | null;
  /** Formula text without the leading "=", or null for a literal cell. */
  formula: string | null;
  /** Numeric value when the cell (or its cached result) is a finite number, else null. */
  numeric: number | null;
}

export function readCell(ws: ExcelJS.Worksheet | undefined, ref: string): CellReading {
  if (!ws) return { value: null, formula: null, numeric: null };
  const v = ws.getCell(ref).value as unknown;

  if (v === null || v === undefined || v === "") {
    return { value: null, formula: null, numeric: null };
  }
  if (typeof v === "number") {
    return { value: v, formula: null, numeric: Number.isFinite(v) ? v : null };
  }
  if (typeof v === "string") {
    return { value: v, formula: null, numeric: null };
  }
  if (v instanceof Date) {
    return { value: toIsoDate(v), formula: null, numeric: null };
  }
  if (typeof v === "object") {
    const obj = v as { formula?: string; sharedFormula?: string; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(obj.richText)) {
      const text = obj.richText.map((t) => t.text).join("");
      return { value: text, formula: null, numeric: null };
    }
    if ("result" in obj || "formula" in obj || "sharedFormula" in obj) {
      const formula = obj.formula ?? null;
      const result = obj.result;
      if (typeof result === "number") {
        return { value: result, formula, numeric: Number.isFinite(result) ? result : null };
      }
      if (result instanceof Date) {
        return { value: toIsoDate(result), formula, numeric: null };
      }
      if (result === null || result === undefined) {
        return { value: null, formula, numeric: null };
      }
      return { value: result as string, formula, numeric: null };
    }
  }
  return { value: null, formula: null, numeric: null };
}

/** Strict numeric read: cached number → itself, anything else → 0 (mirrors Excel's blank=0). */
function num(ws: ExcelJS.Worksheet | undefined, ref: string): number {
  return readCell(ws, ref).numeric ?? 0;
}

/** Numeric-or-null read: distinguishes a genuine 0 / number from an uncached formula. */
function numOrNull(ws: ExcelJS.Worksheet | undefined, ref: string): number | null {
  return readCell(ws, ref).numeric;
}

/** Plain text read (trimmed). */
function text(ws: ExcelJS.Worksheet | undefined, ref: string): string {
  const v = readCell(ws, ref).value;
  return v === null ? "" : String(v).trim();
}

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Scans `column` of a sheet for the first cell whose trimmed text equals (or, with
 * `contains`, includes) `label`, returning that row number — or 0 if not found.
 */
function findRowByLabel(
  ws: ExcelJS.Worksheet | undefined,
  column: string,
  label: string,
  opts: { contains?: boolean; caseInsensitive?: boolean } = {}
): number {
  if (!ws) return 0;
  const target = opts.caseInsensitive ? label.toUpperCase() : label;
  const last = ws.rowCount;
  for (let r = 1; r <= last; r++) {
    let cell = text(ws, `${column}${r}`);
    if (opts.caseInsensitive) cell = cell.toUpperCase();
    if (opts.contains ? cell.includes(target) : cell === target) return r;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// STEP 1 — project inputs
// ---------------------------------------------------------------------------

function extractInputs(wb: ExcelJS.Workbook): ExtractedProjectInputs {
  const s1 = wb.getWorksheet(SHEET.step1);

  // sqft: prefer "Gross SF" (filled bids), fall back to "Project Size".
  const sqftRow = findRowByLabel(s1, "C", "Gross SF") || findRowByLabel(s1, "C", "Project Size");
  const squareFootage = sqftRow ? num(s1, `D${sqftRow}`) : 0;

  const unitRow = findRowByLabel(s1, "C", "# of Units");
  const unitCount = unitRow ? num(s1, `D${unitRow}`) : 0;

  const startRow = findRowByLabel(s1, "C", "Expected Start");
  const finishRow = findRowByLabel(s1, "C", "Expected Finish");
  const startDate = startRow ? text(s1, `D${startRow}`) : "";
  const finishDate = finishRow ? text(s1, `D${finishRow}`) : "";
  // getMonthsBetween wants "YYYY-MM…"; our date reads are already ISO.
  const durationMonths = getMonthsBetween(startDate, finishDate);

  const nameRow = findRowByLabel(s1, "C", "Project Name");
  const projectName = nameRow ? text(s1, `D${nameRow}`) : "";

  // Modifier rates: scan col F for each modifier's label, read col G beside it;
  // fall back to the config's fixed STEP-1 cell (e.g. "G18") if the label moved.
  const rateFor = (label: string, step1Cell: string): number => {
    const row = findRowByLabel(s1, "F", label);
    if (row) return num(s1, `G${row}`);
    return num(s1, step1Cell);
  };
  const byKey: Record<string, number> = {};
  for (const m of ESTIMATE_MODIFIERS) byKey[m.key] = rateFor(m.label, m.step1Cell);

  return {
    projectName,
    squareFootage,
    unitCount,
    startDate,
    finishDate,
    durationMonths,
    rates: {
      constructionContingencyRate: byKey.constructionContingency ?? 0,
      designContingencyRate: byKey.designContingency ?? 0,
      buildersRiskRate: byKey.buildersRisk ?? 0,
      specialInsuranceRate: byKey.specialInsurance ?? 0,
      glInsuranceRate: byKey.glInsurance ?? 0,
      bondRate: byKey.bond ?? 0,
      feeRate: byKey.fee ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// STEP 4 — line items + oracle outputs
// ---------------------------------------------------------------------------

function extractStep4(wb: ExcelJS.Workbook): {
  lineItems: ExtractedLineItem[];
  adHocLineItems: ExtractedLineItem[];
  oracle: Pick<
    ExtractedOracleOutputs,
    | "step4Subtotal"
    | "step4SubtotalRow"
    | "totalEstimatedCost"
    | "step4TotalRow"
    | "modifiers"
    | "costPerUnit"
    | "linkedDivisionValues"
  >;
} {
  const s4 = wb.getWorksheet(SHEET.step4);
  if (!s4) throw new Error(`Workbook has no "${SHEET.step4}" sheet — not a template-format estimate.`);

  const subtotalRow = findRowByLabel(s4, "H", "SUBTOTAL", { caseInsensitive: true });
  const totalRow = findRowByLabel(s4, "H", "TOTAL", { caseInsensitive: true });
  if (!subtotalRow) throw new Error(`No SUBTOTAL row found on "${SHEET.step4}".`);
  if (!totalRow) throw new Error(`No TOTAL row found on "${SHEET.step4}".`);

  const modifierCodes = new Map(ESTIMATE_MODIFIERS.map((m) => [m.code, m]));

  const lineItems: ExtractedLineItem[] = [];
  const adHocLineItems: ExtractedLineItem[] = [];
  const linkedDivisionValues: { itemId: string; total: number }[] = [];

  for (let r = 1; r < subtotalRow; r++) {
    const rawCode = text(s4, `C${r}`);
    const qty = num(s4, `F${r}`);
    const unitPrice = num(s4, `H${r}`);
    // As-bid UOM (col G). Bids write lowercase ("sf"); the catalog is uppercase —
    // normalize so the two compare cleanly. Blank stays "".
    const uom = text(s4, `G${r}`).toUpperCase();

    if (COST_CODE_RE.test(rawCode)) {
      const total = qty * unitPrice;
      const isLinked = isLinkedDivisionRow(rawCode);
      lineItems.push({ itemId: rawCode, description: text(s4, `D${r}`), qty, unitPrice, total, isLinked, isAdHoc: false, rowNumber: r, rawCode, comment: text(s4, `E${r}`), uom });
      if (isLinked) linkedDivisionValues.push({ itemId: rawCode, total });
      continue;
    }

    // Non-conforming row. Capture it as ad-hoc ONLY when it carries real dollars,
    // so a finished bid's hand-typed line (no NN-NNNN.NNN code) is imported and
    // never dropped (plan: "never drop a dollar"). Title/header/blank rows carry
    // no dollar and are skipped. Dollar source: F×H, else the cached extended-
    // amount cell I (a lump line with the amount typed straight into col I).
    const computed = qty * unitPrice;
    const iCell = numOrNull(s4, `I${r}`);
    const dollar = computed !== 0 ? computed : (iCell ?? 0);
    if (dollar === 0) continue;
    // Normalize so matchedQty × unitPrice reproduces the dollar through the engine.
    const adQty = computed !== 0 ? qty : 1;
    const adPrice = computed !== 0 ? unitPrice : dollar;
    adHocLineItems.push({
      itemId: "",
      description: text(s4, `D${r}`) || rawCode,
      qty: adQty,
      unitPrice: adPrice,
      total: adQty * adPrice,
      isLinked: false,
      isAdHoc: true,
      rowNumber: r,
      // Preserve a legacy bare base code (NN-NNNN) so normalization can bridge it.
      rawCode: BARE_CODE_RE.test(rawCode) ? rawCode : "",
      comment: text(s4, `E${r}`),
      uom,
    });
  }

  // Modifier dollar cells sit between SUBTOTAL and TOTAL, keyed by their 60-xxxx code.
  // Legacy bids write the BARE base code (60-1000) where the template writes the
  // suffixed one (60-1000.001) — match on the base so both shapes extract. The
  // subtotal is read here (not at return) because lump classification needs it.
  const step4Subtotal = num(s4, `I${subtotalRow}`);
  const modifierByBase = new Map(ESTIMATE_MODIFIERS.map((m) => [m.code.split(".")[0], m]));
  const modifierByKey = new Map<string, ExtractedModifierOutput>();
  for (let r = subtotalRow + 1; r < totalRow; r++) {
    const code = text(s4, `C${r}`);
    const cfg = modifierCodes.get(code) ?? modifierByBase.get(code);
    if (!cfg) continue;
    const rate = num(s4, `F${r}`);
    const total = numOrNull(s4, `I${r}`);
    modifierByKey.set(cfg.key, {
      key: cfg.key,
      code: cfg.code,
      label: cfg.label,
      rate,
      total,
      sheetLabel: text(s4, `D${r}`),
      // A hand-typed lump: the row's cached dollar is NOT rate × subtotal.
      isLump: total !== null && Math.abs(total - rate * step4Subtotal) > RECONCILIATION_TOLERANCE,
      rowNumber: r,
    });
  }
  // Preserve the canonical 7-modifier order.
  const modifiers = ESTIMATE_MODIFIERS.map(
    (m) =>
      modifierByKey.get(m.key) ??
      { key: m.key, code: m.code, label: m.label, rate: 0, total: null, sheetLabel: "", isLump: false, rowNumber: 0 }
  );

  return {
    lineItems,
    adHocLineItems,
    oracle: {
      step4Subtotal,
      step4SubtotalRow: subtotalRow,
      totalEstimatedCost: num(s4, `I${totalRow}`),
      step4TotalRow: totalRow,
      modifiers,
      costPerUnit: numOrNull(s4, `J${totalRow}`),
      linkedDivisionValues,
    },
  };
}

// ---------------------------------------------------------------------------
// STEP 2 / STEP 3 — section subtotals (oracle) + raw line inputs (diagnostics)
// ---------------------------------------------------------------------------

/** STEP 2/3 subtotal labels → the STEP 4 linked itemId they feed (template-stable text). */
const LINKED_SUBTOTAL_LABELS: { itemId: string; sheet: keyof typeof SHEET; label: string }[] = [
  { itemId: "01-0400.002", sheet: "step2", label: "Total Supervision" },
  { itemId: "01-0000.001", sheet: "step2", label: "Total Design, PM and GCs" },
  { itemId: "02-0000.001", sheet: "step3", label: "Total Site Operations" },
  { itemId: "02-4100.002", sheet: "step3", label: "Total Demolition" },
  { itemId: "02-9005.003", sheet: "step3", label: "Total Final Cleaning" },
  { itemId: "02-9070.004", sheet: "step3", label: "Total SWPPP Permit" },
  { itemId: "02-9200.005", sheet: "step3", label: "Total Survey and Layout" },
  { itemId: "02-9300.006", sheet: "step3", label: "Total Building and Site Services" },
  { itemId: "02-9400.007", sheet: "step3", label: "Total Site Equipment" },
  { itemId: "02-9500.008", sheet: "step3", label: "Total Site Special Inspections" },
];

function extractSheetLines(ws: ExcelJS.Worksheet | undefined): ExtractedSheetLine[] {
  if (!ws) return [];
  const lines: ExtractedSheetLine[] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const code = text(ws, `C${r}`);
    // Legacy bids write BARE base codes on STEP 2/3 (the CARE probe found
    // zero suffixed codes there) — accept both shapes so an imported bid's
    // hand-authored GC/Site-Ops detail survives. Modern templates carry no
    // bare codes, so their extraction is byte-identical.
    if (!COST_CODE_RE.test(code) && !BARE_CODE_RE.test(code)) continue;
    const qty = num(ws, `F${r}`);
    const rate = num(ws, `H${r}`);
    lines.push({
      code,
      description: text(ws, `D${r}`),
      utilization: numOrNull(ws, `E${r}`),
      qty,
      rate,
      total: num(ws, `I${r}`) || qty * rate,
      rowNumber: r,
      uom: text(ws, `G${r}`).toUpperCase(),
    });
  }
  return lines;
}

function extractStep23(wb: ExcelJS.Workbook): {
  step2SupervisionSubtotal: number | null;
  step2DesignPmGcSubtotal: number | null;
  linkedSourceSubtotals: { itemId: string; total: number | null }[];
  step2Lines: ExtractedSheetLine[];
  step3Lines: ExtractedSheetLine[];
} {
  const s2 = wb.getWorksheet(SHEET.step2);
  const s3 = wb.getWorksheet(SHEET.step3);

  const subtotalByLabel = (sheetKey: keyof typeof SHEET, label: string): number | null => {
    const ws = sheetKey === "step2" ? s2 : s3;
    const row = findRowByLabel(ws, "H", label);
    return row ? numOrNull(ws, `I${row}`) : null;
  };

  const linkedSourceSubtotals = LINKED_SUBTOTAL_LABELS.map(({ itemId, sheet, label }) => ({
    itemId,
    total: subtotalByLabel(sheet, label),
  }));

  return {
    step2SupervisionSubtotal: subtotalByLabel("step2", "Total Supervision"),
    step2DesignPmGcSubtotal: subtotalByLabel("step2", "Total Design, PM and GCs"),
    linkedSourceSubtotals,
    step2Lines: extractSheetLines(s2),
    step3Lines: extractSheetLines(s3),
  };
}

// ---------------------------------------------------------------------------
// Budget Line Items — diagnostic rollup (a real bid's BLI can be #REF!-broken)
// ---------------------------------------------------------------------------

function extractBli(wb: ExcelJS.Workbook): {
  bliNumericTotal: number;
  bliBrokenRowCount: number;
  bliRowCount: number;
} {
  const bli = wb.getWorksheet(SHEET.bli);
  let bliNumericTotal = 0;
  let bliBrokenRowCount = 0;
  let bliRowCount = 0;
  if (bli) {
    for (let r = 2; r <= bli.rowCount; r++) {
      const code = text(bli, `A${r}`);
      if (!code.includes("-")) continue; // code rows only
      bliRowCount++;
      const n = numOrNull(bli, `H${r}`);
      if (n === null) bliBrokenRowCount++;
      else bliNumericTotal += n;
    }
  }
  return { bliNumericTotal, bliBrokenRowCount, bliRowCount };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Loads an .xlsx buffer into an ExcelJS workbook (formula cells keep their cached results). */
export async function loadTemplateWorkbook(buffer: ArrayBuffer | Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
  return wb;
}

/** Reads a template-format workbook into a typed ExtractedEstimate. */
export function extractEstimate(wb: ExcelJS.Workbook): ExtractedEstimate {
  const inputs = extractInputs(wb);
  const { lineItems, adHocLineItems, oracle: step4Oracle } = extractStep4(wb);
  const step23 = extractStep23(wb);
  const bli = extractBli(wb);

  return {
    inputs,
    lineItems,
    adHocLineItems,
    step2Lines: step23.step2Lines,
    step3Lines: step23.step3Lines,
    oracle: {
      ...step4Oracle,
      step2SupervisionSubtotal: step23.step2SupervisionSubtotal,
      step2DesignPmGcSubtotal: step23.step2DesignPmGcSubtotal,
      linkedSourceSubtotals: step23.linkedSourceSubtotals,
      ...bli,
    },
  };
}

/** Convenience: buffer → ExtractedEstimate. */
export async function extractEstimateFromBuffer(buffer: ArrayBuffer | Buffer): Promise<ExtractedEstimate> {
  return extractEstimate(await loadTemplateWorkbook(buffer));
}

/**
 * Maps extracted STEP 4 line items to minimal `ProcessedTakeoffRow`s for the
 * calculation engine. Linked division rows keep their itemId so
 * `computeTakeoffSummary` excludes their typed qty×price and counts the linked
 * value instead; their value travels separately via `linkedTotalsFromExtract`.
 */
export function toProcessedRows(items: ExtractedLineItem[]): ProcessedTakeoffRow[] {
  return items.map((it) => ({
    id: `oracle-r${it.rowNumber}`,
    classification: it.description,
    itemId: it.itemId,
    procoreParentCode: "",
    procoreCode: "",
    description: it.description,
    matchedQty: it.qty,
    uom: "",
    unitPrice: it.unitPrice,
    total: it.total,
    isMapped: true,
    rawQuantities: [],
    costType: "M",
    source: "csv_import",
  }));
}

/**
 * Builds the `linkedTotals` array `computeTakeoffSummary` expects from the
 * extracted linked rows (their STEP 4 value = the STEP 2/3 subtotal Excel
 * pulled in). Description/sourceLabel are cosmetic and filled from config.
 */
export function linkedTotalsFromExtract(
  items: ExtractedLineItem[]
): { itemId: string; description: string; sourceLabel: string; total: number }[] {
  const cfgByItemId = new Map(LINKED_DIVISION_ROWS.map((c) => [c.itemId, c]));
  return items
    .filter((it) => it.isLinked)
    .map((it) => {
      const cfg = cfgByItemId.get(it.itemId);
      return {
        itemId: it.itemId,
        description: cfg?.description ?? it.description,
        sourceLabel: cfg?.sourceLabel ?? "",
        total: it.total,
      };
    });
}
