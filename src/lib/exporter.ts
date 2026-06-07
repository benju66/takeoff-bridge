import { ProcessedTakeoffRow, ColumnDefinition } from "@/types";
import { Project, DivisionLayout, TemplateLayoutConfig } from "@/types/db";
import { DEFAULT_CURRENCY_DECIMALS, DEFAULT_QTY_DECIMALS, ESTIMATE_MODIFIERS, GC_MANUAL_DEFAULTS, isLinkedDivisionRow } from "./constants";
import { computeTakeoffSummary, computeLinkedDivisionTotals, LinkedDivisionTotal, PersonnelCalcResult, SiteOpsCalcResult } from "./calculations";
import { escapeCSVField, buildNumFmt, getColumnLetter } from "./exportUtils";
import { getDivisionCode } from "./division";
import JSZip from "jszip";
import { XMLParser, XMLBuilder } from "fast-xml-parser";

// Re-export for backward compatibility
export { getColumnLetter } from "./exportUtils";

/**
 * Generates a clean Excel payload CSV string.
 * Formats columns dynamically to match user's custom and default workspace column definitions.
 * Incorporates the 7 template-aligned modifier rows at the bottom, with rounding compliance.
 */
export function generateExcelPayload(
  rows: ProcessedTakeoffRow[],
  columnDefs: ColumnDefinition[],
  project?: Project | null,
  // gc-siteops Phase 5: linked division values so the payload's rows and
  // modifier basis match the estimate page (omitted → takeoff-only legacy).
  linkedTotals?: LinkedDivisionTotal[]
): string {
  const csvLines: string[] = [];
  const activeCols = columnDefs.filter((col) => col.id !== "actions" && col.id !== "validationStatus");
  const linkedByItemId = new Map((linkedTotals ?? []).map((l) => [l.itemId, l.total]));



  // Populate dynamic headers based on activeCols
  const headers = activeCols.map((col) => {
    if (col.type === "default") {
      switch (col.id) {
        case "costType":
          return "TYPE";
        case "itemId":
          return "Code";
        case "description":
          return "Description";
        case "matchedQty":
          return "Quantity";
        case "uom":
          return "Unit";
        case "unitPrice":
          return "Rate";
        case "total":
          return "Total";
        case "notes":
          return "Notes";
        case "costPerUnit":
          return "Cost/Unit";
        case "costPerSf":
          return "Cost/S.F.";
        default:
          return col.header;
      }
    } else {
      return col.header;
    }
  });
  csvLines.push(headers.map(escapeCSVField).join(","));

  // Populate each data row dynamically using active user modified grid values.
  // Linked division rows print their live linked value (qty 1) — the grid's
  // typed qty×price never counts for them (gc-siteops Phase 5).
  for (const row of rows) {
    const isLinked = isLinkedDivisionRow(row.itemId);
    const linkedValue = isLinked ? (linkedByItemId.get((row.itemId || "").trim()) ?? 0) : 0;
    const calculatedTotal = isLinked ? linkedValue : row.matchedQty * row.unitPrice;
    const rowValues = activeCols.map((col) => {
      if (col.type === "default") {
        switch (col.id) {
          case "costType":
            return row.costType || "TI";
          case "itemId":
            return row.itemId || "";
          case "description":
            return row.description || "";
          case "matchedQty":
            return isLinked ? 1 : row.matchedQty;
          case "uom":
            return row.uom || "";
          case "unitPrice":
            return isLinked ? linkedValue : row.unitPrice;
          case "total":
            return calculatedTotal;
          case "notes":
            return row.customFields?.notes || "";
          case "costPerUnit":
            return "";
          case "costPerSf":
            return "";
          default:
            return "";
        }
      } else {
        return row.customFields?.[col.id] ?? "";
      }
    });

    csvLines.push(rowValues.map(escapeCSVField).join(","));
  }

  // Calculate dynamic subtotal and append template-aligned modifier rows.
  // Basis includes the linked GC/Site Ops values when provided (Phase 5).
  const squareFootage = project?.squareFootage ?? 0;
  const unitCount = project?.unitCount ?? 0;
  const summary = computeTakeoffSummary(rows, squareFootage, unitCount, {
    constructionContingencyRate: project?.constructionContingencyRate ?? 0,
    designContingencyRate: project?.designContingencyRate ?? 0,
    buildersRiskRate: project?.buildersRiskRate ?? 0,
    specialInsuranceRate: project?.specialInsuranceRate ?? 0,
    glInsuranceRate: project?.glInsuranceRate ?? 0.01,
    bondRate: project?.bondRate ?? 0,
    feeRate: project?.feeRate ?? 0.05,
    roundingRule: project?.roundingRule ?? "dollar",
  }, linkedTotals);

  if (summary.subtotal > 0) {
    const modifierValues: Record<string, number> = {
      constructionContingency: summary.constructionContingency,
      designContingency: summary.designContingency,
      buildersRisk: summary.buildersRisk,
      specialInsurance: summary.specialInsurance,
      glInsurance: summary.glInsurance,
      bond: summary.bond,
      fee: summary.fee,
    };

    for (const mod of ESTIMATE_MODIFIERS) {
      const modValue = modifierValues[mod.key] ?? 0;
      const rateField = `${mod.key}Rate` as keyof Project;
      const rateDecimal = (project?.[rateField] as number) ?? mod.defaultRate;
      const ratePercent = (rateDecimal * 100).toFixed(2).replace(/\.?0+$/, '');

      const modRow = activeCols.map((col) => {
        if (col.type === "default") {
          switch (col.id) {
            case "costType":
              return "O";
            case "itemId":
              return mod.code;
            case "description":
              return `${mod.label} (${ratePercent}%)`;
            case "matchedQty":
              return 1;
            case "uom":
              return "LS";
            case "unitPrice":
              return modValue.toFixed(2);
            case "total":
              return modValue.toFixed(2);
            default:
              return "";
          }
        } else {
          return "";
        }
      });
      csvLines.push(modRow.map(escapeCSVField).join(","));
    }
  }

  // Use \r\n for universal Windows and Excel spreadsheet compliance
  return csvLines.join("\r\n");
}

/**
 * Groups fine-grained suffix costs into granular Procore Budget Line Items
 * codes and cost types, summing the budget values and structuring exactly
 * matching Procore's budget importer schema.
 * Columns: "Cost Code","Cost Type","Description","Original Budget"
 * Incorporates dynamic markup layers based on project settings.
 * Grouping key is the granular procoreCode; procoreParentCode is only a
 * back-compat fallback for rows the completeness gate would block upstream.
 */
export function generateProcoreBudget(
  rows: ProcessedTakeoffRow[],
  project: Project | null | undefined,
  gcCalcResult: PersonnelCalcResult,
  siteOpsCalcResult: SiteOpsCalcResult
): string {
  const csvLines: string[] = [];



  // Header line exactly matching Procore's standard budget importer columns
  csvLines.push(["Cost Code", "Cost Type", "Description", "Original Budget"].map(escapeCSVField).join(","));

  // Maintain groups using a combination key of granular cost code + cost type
  const groupings: Record<string, {
    costCode: string;
    costType: string;
    descriptions: Set<string>;
    totalCost: number;
  }> = {};

  // Group and sum mapped rows only to guarantee database cleanliness.
  // Linked division rows never contribute (gc-siteops Phase 5): their dollars
  // travel on the granular GC/Site Ops lines below — counting both would
  // double-count 1-10000.000 / 2-20000.000.
  for (const row of rows) {
    if (isLinkedDivisionRow(row.itemId)) continue;
    const costCode = ((row.procoreCode || "").trim() || (row.procoreParentCode || "").trim());
    if (!row.isMapped || !costCode) continue;

    const costType = row.costType.trim();
    const groupKey = `${costCode}::${costType}`;
    const calculatedTotal = row.matchedQty * row.unitPrice;

    if (!groupings[groupKey]) {
      groupings[groupKey] = {
        costCode,
        costType,
        descriptions: new Set<string>(),
        totalCost: 0
      };
    }

    groupings[groupKey].descriptions.add(row.description);
    groupings[groupKey].totalCost += calculatedTotal;
  }

  // GC + Site Ops computed lines join the budget under their user-confirmed
  // BLI codes (gc-siteops Phase 3 — values from calculations.ts, mapping from
  // constants.ts). Zero-dollar lines are skipped: no budget noise for inputs
  // the estimator left empty.
  for (const line of collectGcSiteOpsLines(gcCalcResult, siteOpsCalcResult)) {
    const costCode = line.procoreCode.trim();
    if (!costCode || Math.abs(line.total) <= RECONCILIATION_TOLERANCE) continue;
    const groupKey = `${costCode}::${line.costType}`;
    if (!groupings[groupKey]) {
      groupings[groupKey] = {
        costCode,
        costType: line.costType,
        descriptions: new Set<string>(),
        totalCost: 0,
      };
    }
    groupings[groupKey].descriptions.add(line.desc);
    groupings[groupKey].totalCost += line.total;
  }

  // Serialize grouped lines
  for (const key of Object.keys(groupings)) {
    const group = groupings[key];
    const consolidatedDescription = Array.from(group.descriptions).join("; ");

    const columns = [
      group.costCode,
      group.costType,
      consolidatedDescription,
      group.totalCost.toFixed(2)
    ];

    csvLines.push(columns.map(escapeCSVField).join(","));
  }

  // Calculate subtotal and append template-aligned modifier rows with
  // rounding. Modifier basis includes the linked GC + Site Ops division
  // values (gc-siteops Phase 5) — same basis as the estimate page and the
  // template's STEP 4 I331.
  const squareFootage = project?.squareFootage ?? 0;
  const unitCount = project?.unitCount ?? 0;
  const linkedTotals = computeLinkedDivisionTotals(gcCalcResult, siteOpsCalcResult);
  const summary = computeTakeoffSummary(rows, squareFootage, unitCount, {
    constructionContingencyRate: project?.constructionContingencyRate ?? 0,
    designContingencyRate: project?.designContingencyRate ?? 0,
    buildersRiskRate: project?.buildersRiskRate ?? 0,
    specialInsuranceRate: project?.specialInsuranceRate ?? 0,
    glInsuranceRate: project?.glInsuranceRate ?? 0.01,
    bondRate: project?.bondRate ?? 0,
    feeRate: project?.feeRate ?? 0.05,
    roundingRule: project?.roundingRule ?? "dollar",
  }, linkedTotals);

  if (summary.subtotal > 0) {
    const modifierValues: Record<string, number> = {
      constructionContingency: summary.constructionContingency,
      designContingency: summary.designContingency,
      buildersRisk: summary.buildersRisk,
      specialInsurance: summary.specialInsurance,
      glInsurance: summary.glInsurance,
      bond: summary.bond,
      fee: summary.fee,
    };

    for (const mod of ESTIMATE_MODIFIERS) {
      const modValue = modifierValues[mod.key] ?? 0;
      const rateField = `${mod.key}Rate` as keyof Project;
      const rateDecimal = (project?.[rateField] as number) ?? mod.defaultRate;
      const ratePercent = (rateDecimal * 100).toFixed(2).replace(/\.?0+$/, '');

      csvLines.push([
        mod.code,
        "O",
        `${mod.label} (${ratePercent}%)`,
        modValue.toFixed(2)
      ].map(escapeCSVField).join(","));
    }
  }

  // Ensure Windows line endings (\r\n) for seamless ingestion
  return csvLines.join("\r\n");
}

// ─── PROCORE ROLLUP + EXPORT GATES (Phase 2) ────────────────────────────────

/**
 * The template's STEP 4 column C carries two known typo'd internal codes.
 * Normalized on read so app rows land on their pre-populated template rows
 * instead of being inserted as overflow duplicates.
 */
const TEMPLATE_CODE_NORMALIZATIONS: Record<string, string> = {
  "03-4500.0002": "03-4500.001",
  "07-6100.01": "07-6100.001",
};

/** Rounding tolerance for all dollar tie-out comparisons. */
const RECONCILIATION_TOLERANCE = 0.01;

/**
 * Groups takeoff rows by granular Procore Budget Line Items code and sums
 * matchedQty * unitPrice. Rows with an empty procoreCode are skipped — the
 * completeness gate (validateExportReadiness) blocks them upstream when they
 * carry dollars. Linked division rows (gc-siteops Phase 5) are skipped
 * entirely: their dollars are fully represented by the 34+38 granular
 * GC/Site Ops lines, so counting them would double-count Procore dollars on
 * 1-10000.000 / 2-20000.000. Single source of truth for both export paths
 * (workbook BLI sheet and Procore budget CSV).
 */
export function rollupByProcoreCode(rows: ProcessedTakeoffRow[]): Record<string, number> {
  const rollup: Record<string, number> = {};
  for (const row of rows) {
    if (isLinkedDivisionRow(row.itemId)) continue;
    const code = (row.procoreCode || "").trim();
    if (!code) continue;
    rollup[code] = (rollup[code] || 0) + row.matchedQty * row.unitPrice;
  }
  return rollup;
}

/**
 * One flattened GC / Site Ops computed line (gc-siteops Phase 3).
 * `code` is the internal STEP 2/3 criterion code; `procoreCode` is the
 * user-confirmed granular Budget Line Items code carried on the line by the
 * calculation layer (single source: constants.ts — Phase 1 findings §4 + the
 * D2 orphan-line sign-off). GC/Site Ops lines are app-defined inputs, not
 * takeoff rows, so they do not pass through resolveProcoreCode/cost_code_map
 * (which only covers STEP 4 itemIds).
 */
export interface GcSiteOpsLine {
  code: string;
  procoreCode: string;
  costType: string;
  desc: string;
  total: number;
}

/** Flattens both calc results into one line list for rollup/gating/CSV. */
export function collectGcSiteOpsLines(
  gcCalcResult: PersonnelCalcResult,
  siteOpsCalcResult: SiteOpsCalcResult
): GcSiteOpsLine[] {
  return [
    ...gcCalcResult.staffLines.map((l) => ({ code: l.code, procoreCode: l.procoreCode, costType: l.costType, desc: l.role, total: l.total })),
    ...gcCalcResult.operationalLines.map((l) => ({ code: l.code, procoreCode: l.procoreCode, costType: l.costType, desc: l.desc, total: l.total })),
    ...gcCalcResult.equipmentLines.map((l) => ({ code: l.code, procoreCode: l.procoreCode, costType: l.costType, desc: l.desc, total: l.total })),
    ...gcCalcResult.manualLines.map((l) => ({ code: l.code, procoreCode: l.procoreCode, costType: l.costType, desc: l.desc, total: l.total })),
    ...siteOpsCalcResult.dynamicLines.map((l) => ({ code: l.code, procoreCode: l.procoreCode, costType: l.costType, desc: l.desc, total: l.total })),
    ...siteOpsCalcResult.manualLines.map((l) => ({ code: l.code, procoreCode: l.procoreCode, costType: l.costType, desc: l.desc, total: l.total })),
  ];
}

/**
 * Sums GC/Site Ops lines by granular BLI code. Accumulates (never overwrites):
 * multiple internal lines may share one BLI row — e.g. payroll + hired
 * progress cleaning both land on 2-29010.000 per the D2 sign-off.
 */
export function rollupGcSiteOps(lines: GcSiteOpsLine[]): Record<string, number> {
  const rollup: Record<string, number> = {};
  for (const line of lines) {
    const code = line.procoreCode.trim();
    if (!code) continue;
    rollup[code] = (rollup[code] || 0) + line.total;
  }
  return rollup;
}

/** A row whose dollars cannot be placed on any Procore Budget Line Items code. */
export interface ExportBlocker {
  rowId: string;
  itemId: string;
  description: string;
  amount: number;
}

export interface ExportReadiness {
  ok: boolean;
  /** Rows carrying unmapped dollars — must be resolved via the user-override interface. */
  blockers: ExportBlocker[];
  /** Line-item total vs Procore rollup total tie-out (tolerance $0.01). */
  reconciliation: { lineItemTotal: number; rollupTotal: number; delta: number; ok: boolean };
}

/**
 * Export gates — run BEFORE any download:
 * 1. Completeness: every row carrying dollars must have a granular procoreCode.
 *    Zero-dollar unmapped rows do not block (no dollars to lose).
 * 2. Reconciliation: Σ line items + Σ GC lines + Σ Site Ops lines must equal
 *    Σ Procore rollup within $0.01 (gc-siteops Phase 3, §7 Option A — the gate
 *    represents the full estimate, not just STEP 4).
 * Never auto-assigns a mapping — blockers route to the interactive override UI
 * (AGENTS.md: No AI Autonomy Over Financials).
 */
export function validateExportReadiness(
  rows: ProcessedTakeoffRow[],
  gcCalcResult: PersonnelCalcResult,
  siteOpsCalcResult: SiteOpsCalcResult
): ExportReadiness {
  const blockers: ExportBlocker[] = [];
  let lineItemTotal = 0;
  for (const row of rows) {
    // Linked division rows are display-only (gc-siteops Phase 5): their
    // dollars live on the granular GC/Site Ops lines added below, so they
    // count on neither side of the gate (kept out of rollupByProcoreCode too).
    if (isLinkedDivisionRow(row.itemId)) continue;
    const amount = row.matchedQty * row.unitPrice;
    lineItemTotal += amount;
    if (!(row.procoreCode || "").trim() && Math.abs(amount) > RECONCILIATION_TOLERANCE) {
      blockers.push({
        rowId: row.id,
        itemId: row.itemId,
        description: row.description,
        amount,
      });
    }
  }
  // GC + Site Ops computed lines join the gate. Their mapping is static
  // (constants.ts), so an unmapped line with dollars is a programming error,
  // not something the override modal can fix (it assigns codes to takeoff
  // rows only) — so it is NOT pushed as a blocker. Its dollars land in
  // lineItemTotal but not rollupTotal, which fails reconciliation below and
  // blocks the export with a delta; generateExcelWorkbook additionally throws
  // naming the offending line.
  const gcSiteOpsLines = collectGcSiteOpsLines(gcCalcResult, siteOpsCalcResult);
  for (const line of gcSiteOpsLines) {
    lineItemTotal += line.total;
  }
  const rollupTotal =
    Object.values(rollupByProcoreCode(rows)).reduce((s, v) => s + v, 0) +
    Object.values(rollupGcSiteOps(gcSiteOpsLines)).reduce((s, v) => s + v, 0);
  const delta = lineItemTotal - rollupTotal;
  const reconciliationOk = Math.abs(delta) <= RECONCILIATION_TOLERANCE;
  return {
    ok: blockers.length === 0 && reconciliationOk,
    blockers,
    reconciliation: { lineItemTotal, rollupTotal, delta, ok: reconciliationOk },
  };
}

/**
 * Asserts the layout config + template buffer are present and structurally
 * sound before any XML surgery. Phase 3b removed the hardcoded
 * DEFAULT_LAYOUT_CONFIG fallback: template_config.config_data (via db.ts,
 * which validates the full shape) is the single source of truth, so a
 * missing/invalid config must fail loudly instead of exporting with stale
 * built-in coordinates.
 */
function assertWorkbookInputs(
  layoutConfig: TemplateLayoutConfig | null | undefined,
  templateBuffer: ArrayBuffer | null | undefined
): asserts layoutConfig is TemplateLayoutConfig {
  if (
    !layoutConfig?.divisions?.length ||
    !layoutConfig.anchors ||
    !layoutConfig.sheetNames
  ) {
    throw new Error(
      "generateExcelWorkbook requires a template layout config ({divisions, anchors, sheetNames}) " +
      "from template_config.config_data — the hardcoded fallback was removed in Phase 3b."
    );
  }
  if (!templateBuffer) {
    throw new Error(
      "generateExcelWorkbook requires the template file buffer — fetch it via downloadTemplateFile() in db.ts."
    );
  }
}

/**
 * Builds a row-shift resolver for cross-sheet formula fixup.
 * For any original template row R on STEP 4, returns R + (total insertions
 * from divisions whose endRow < R). This correctly handles the fact that
 * insertions at different division boundaries shift downstream rows by
 * different cumulative amounts.
 */
function buildRowShifter(
  divisions: DivisionLayout[],
  insertionCounts: Record<string, number>
): (originalRow: number) => number {
  // Build sorted array of { threshold, count } pairs.
  // Rows strictly AFTER div.endRow are shifted by that division's insertion count.
  const shiftEntries: { threshold: number; count: number }[] = [];
  for (const div of divisions) {
    const count = insertionCounts[div.division] || 0;
    if (count > 0) {
      shiftEntries.push({ threshold: div.endRow, count });
    }
  }
  // Sort by threshold ascending (should already be in order from the layout config)
  shiftEntries.sort((a, b) => a.threshold - b.threshold);

  return (originalRow: number): number => {
    let shift = 0;
    for (const entry of shiftEntries) {
      if (originalRow > entry.threshold) {
        shift += entry.count;
      } else {
        break; // Sorted, so no further entries can match
      }
    }
    return originalRow + shift;
  };
}
// ─── XML HELPER FUNCTIONS (JSZip + fast-xml-parser) ─────────────────────────

const XML_PARSER_OPTS = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
};

const XML_BUILDER_OPTS = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
  suppressEmptyNode: true,
  format: false,
};

/**
 * Post-process XML builder output to restore formula-safe characters.
 * fast-xml-parser entity-encodes ' → &apos; and " → &quot; inside text content,
 * but Excel's formula parser expects raw characters in <f> tags
 * (e.g. 'STEP 1 - PROJECT DATA'!D6 not &apos;STEP 1 - PROJECT DATA&apos;!D6).
 */
function fixXmlEntities(xml: string): string {
  // Only fix inside <f>...</f> tags to avoid breaking other content
  return xml.replace(/<f>([^<]*)<\/f>/g, (_match, formulaContent: string) => {
    const fixed = formulaContent
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"');
    return `<f>${fixed}</f>`;
  });
}

/**
 * Resolve sheet XML filename from workbook.xml + rels.
 * Returns e.g. "worksheets/sheet7.xml"
 */
function resolveSheetFile(wbXml: string, relsXml: string, sheetName: string): string {
  // Find <sheet name="STEP 4 - ESTIMATE" ... r:id="rId7"/>
  const escapedName = sheetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sheetMatch = wbXml.match(new RegExp(`<sheet[^>]*name="${escapedName}"[^>]*r:id="([^"]+)"`));
  if (!sheetMatch) {
    // Try alternate attribute order: r:id before name
    const altMatch = wbXml.match(new RegExp(`<sheet[^>]*r:id="([^"]+)"[^>]*name="${escapedName}"`));
    if (!altMatch) throw new Error(`Sheet "${sheetName}" not found in workbook.xml`);
    const rId = altMatch[1];
    const relMatch = relsXml.match(new RegExp(`Id="${rId}"[^>]*Target="([^"]+)"`));
    if (!relMatch) throw new Error(`Relationship ${rId} not found in workbook.xml.rels`);
    return relMatch[1];
  }
  const rId = sheetMatch[1];
  const relMatch = relsXml.match(new RegExp(`Id="${rId}"[^>]*Target="([^"]+)"`));
  if (!relMatch) throw new Error(`Relationship ${rId} not found in workbook.xml.rels`);
  return relMatch[1];
}

/**
 * Convert column letter(s) to 1-based index. A=1, B=2, Z=26, AA=27.
 */
function colLetterToIndex(letter: string): number {
  let index = 0;
  for (let i = 0; i < letter.length; i++) {
    index = index * 26 + (letter.charCodeAt(i) - 64);
  }
  return index;
}

/**
 * Extract row number and column letter from an A1-style cell reference.
 */
function parseCellRef(ref: string): { col: string; row: number } {
  const match = ref.match(/^([A-Z]+)(\d+)$/);
  if (!match) return { col: "", row: 0 };
  return { col: match[1], row: parseInt(match[2], 10) };
}

/**
 * Shift cell references in a formula string.
 * Respects $ anchoring (absolute refs are NOT shifted).
 */
function shiftFormulaRefs(
  formula: string,
  insertAtRow: number,
  shiftByRow: number
): string {
  return formula.replace(
    /(\$?)([A-Z]+)(\$?)(\d+)/g,
    (_match: string, _colLock: string, col: string, rowLock: string, rowStr: string) => {
      // If row is absolute ($), don't shift
      if (rowLock === "$") return `${_colLock}${col}${rowLock}${rowStr}`;
      const rowNum = parseInt(rowStr, 10);
      if (rowNum >= insertAtRow) {
        return `${_colLock}${col}${rowLock}${rowNum + shiftByRow}`;
      }
      return `${_colLock}${col}${rowLock}${rowStr}`;
    }
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ParsedElement = any;

/**
 * In fast-xml-parser preserveOrder mode, each element is an object like:
 *   { "c": [...children], ":@": { "@_r": "C27", "@_s": "79" } }
 * This helper finds a <row> element by its r attribute in a list of parsed elements.
 */
function findRowElement(elements: ParsedElement[], rowNum: number): ParsedElement | undefined {
  for (const el of elements) {
    if (el.row && el[":@"]?.["@_r"] === String(rowNum)) {
      return el;
    }
  }
  return undefined;
}

/**
 * Find a <c> (cell) element within a parsed <row>'s children by column letter.
 */
function findCellInRow(rowEl: ParsedElement, colLetter: string): ParsedElement | undefined {
  const children: ParsedElement[] = rowEl.row || [];
  for (const child of children) {
    if (child.c !== undefined) {
      const ref = child[":@"]?.["@_r"] || "";
      const { col } = parseCellRef(ref);
      if (col === colLetter) return child;
    }
  }
  return undefined;
}

/**
 * Set a numeric value on a parsed cell element.
 * Replaces all children with a single <v> element.
 */
function setCellValue(cellEl: ParsedElement, value: number): void {
  // Remove type attribute (numbers don't need t=...)
  if (cellEl[":@"]) {
    delete cellEl[":@"]["@_t"];
  }
  // Replace children with just <v>
  cellEl.c = [{ v: [{ "#text": String(value) }] }];
}

/**
 * Set a formula on a parsed cell element.
 * Creates <f>formula</f><v>0</v>.
 */
function setCellFormula(cellEl: ParsedElement, formula: string): void {
  if (cellEl[":@"]) {
    delete cellEl[":@"]["@_t"];
  }
  cellEl.c = [
    { f: [{ "#text": formula }] },
    { v: [{ "#text": "0" }] },
  ];
}

/**
 * Set an inline string on a parsed cell element.
 * Sets t="inlineStr" and creates <is><t>text</t></is>.
 */
function setCellInlineString(cellEl: ParsedElement, text: string): void {
  if (!cellEl[":@"]) cellEl[":@"] = {};
  cellEl[":@"]["@_t"] = "inlineStr";
  cellEl.c = [
    { is: [{ t: [{ "#text": text }] }] },
  ];
}

/**
 * Create a new cell element at the given reference with a style index.
 */
function createCellElement(ref: string, styleIdx: string): ParsedElement {
  return {
    c: [],
    ":@": { "@_r": ref, "@_s": styleIdx },
  };
}

/**
 * Insert or find a cell in a row. If the cell doesn't exist, create it with the style
 * from a reference row at the same column position.
 */
function getOrCreateCell(
  rowEl: ParsedElement,
  colLetter: string,
  rowNum: number,
  defaultStyleIdx: string
): ParsedElement {
  const existing = findCellInRow(rowEl, colLetter);
  if (existing) return existing;
  const newCell = createCellElement(`${colLetter}${rowNum}`, defaultStyleIdx);
  // Excel requires <c> elements in ascending column order within a <row>;
  // out-of-order cells are silently stripped by Excel's repair ("Removed
  // Records: Cell information"). Insert in position — never append blindly.
  // (Mirrors insertRowElement, which keeps <row> elements ordered.)
  const newColIdx = colLetterToIndex(colLetter);
  const children: ParsedElement[] = rowEl.row;
  let insertIdx = children.length;
  for (let i = 0; i < children.length; i++) {
    if (children[i].c === undefined) continue; // non-cell node
    const ref = children[i][":@"]?.["@_r"] || "";
    const { col } = parseCellRef(ref);
    if (col && colLetterToIndex(col) > newColIdx) {
      insertIdx = i;
      break;
    }
  }
  children.splice(insertIdx, 0, newCell);
  return newCell;
}

/**
 * Clone a parsed row element at a new row number.
 * Copies all cell s-attributes, updates r-attributes.
 */
function cloneRowElement(sourceRow: ParsedElement, newRowNum: number): ParsedElement {
  const cloned = JSON.parse(JSON.stringify(sourceRow));
  // Update row r attribute
  if (cloned[":@"]) {
    cloned[":@"]["@_r"] = String(newRowNum);
  }
  // Update each cell's r attribute
  const children: ParsedElement[] = cloned.row || [];
  for (const child of children) {
    if (child.c !== undefined && child[":@"]?.["@_r"]) {
      const oldRef = child[":@"]["@_r"];
      const { col } = parseCellRef(oldRef);
      child[":@"]["@_r"] = `${col}${newRowNum}`;
    }
    // Clear any existing values/formulas but keep style
    if (child.c !== undefined) {
      child.c = [];
    }
  }
  return cloned;
}

/**
 * Get the style index from a cell at a given column in a reference row.
 * Returns "0" if not found.
 */
function getStyleFromRow(rowEl: ParsedElement, colLetter: string): string {
  const cell = findCellInRow(rowEl, colLetter);
  return cell?.[":@"]?.["@_s"] || "0";
}

/**
 * Extract all <row> elements from parsed sheetData, sorted by row number.
 */
function getRowElements(parsedSheetData: ParsedElement[]): ParsedElement[] {
  const rows: ParsedElement[] = [];
  for (const el of parsedSheetData) {
    if (el.row !== undefined) {
      rows.push(el);
    }
  }
  return rows;
}

/**
 * Get the row number from a parsed row element.
 */
function getRowNum(rowEl: ParsedElement): number {
  return parseInt(rowEl[":@"]?.["@_r"] || "0", 10);
}

/**
 * Shift all row/cell r-attributes in rows >= startRow by shiftBy.
 */
function shiftRowElements(
  parsedSheetData: ParsedElement[],
  startRow: number,
  shiftBy: number
): void {
  for (const el of parsedSheetData) {
    if (el.row === undefined) continue;
    const rowNum = getRowNum(el);
    if (rowNum >= startRow) {
      const newRowNum = rowNum + shiftBy;
      if (el[":@"]) el[":@"]["@_r"] = String(newRowNum);
      // Update cell references and formulas
      const children: ParsedElement[] = el.row || [];
      for (const child of children) {
        if (child.c !== undefined && child[":@"]?.["@_r"]) {
          const { col } = parseCellRef(child[":@"]["@_r"]);
          child[":@"]["@_r"] = `${col}${newRowNum}`;
        }
        // Also shift formula references within <f> elements
        if (child.c !== undefined) {
          const cellChildren: ParsedElement[] = child.c || [];
          for (const fc of cellChildren) {
            if (fc.f !== undefined) {
              const fTextArr = fc.f || [];
              for (const ft of fTextArr) {
                if (ft["#text"] !== undefined) {
                  ft["#text"] = shiftFormulaRefs(
                    String(ft["#text"]),
                    startRow,
                    shiftBy
                  );
                }
              }
            }
          }
        }
      }
    }
  }
}

/**
 * Insert a new row element into the parsed sheetData at the correct position.
 */
function insertRowElement(parsedSheetData: ParsedElement[], newRow: ParsedElement): void {
  const newRowNum = getRowNum(newRow);
  // Find insertion index — after all rows with lower row numbers
  let insertIdx = parsedSheetData.length;
  for (let i = 0; i < parsedSheetData.length; i++) {
    if (parsedSheetData[i].row !== undefined) {
      const rn = getRowNum(parsedSheetData[i]);
      if (rn >= newRowNum) {
        insertIdx = i;
        break;
      }
    }
  }
  parsedSheetData.splice(insertIdx, 0, newRow);
}

/**
 * Get the text value of a shared-string cell or inline-string cell from its XML.
 * For cells with t="s", the <v> contains an index into sharedStrings —
 * we just return the raw index as a string for comparison purposes.
 */
function getCellTextValue(cellEl: ParsedElement): string {
  const children: ParsedElement[] = cellEl.c || [];
  for (const child of children) {
    if (child.v !== undefined) {
      const vChildren = child.v || [];
      for (const vc of vChildren) {
        if (vc["#text"] !== undefined) return String(vc["#text"]);
      }
    }
  }
  return "";
}

/**
 * Get the formula text from a cell element, if it has one.
 */
function getCellFormula(cellEl: ParsedElement): string | null {
  const children: ParsedElement[] = cellEl.c || [];
  for (const child of children) {
    if (child.f !== undefined) {
      const fChildren = child.f || [];
      for (const fc of fChildren) {
        if (fc["#text"] !== undefined) return String(fc["#text"]);
      }
      return ""; // <f/> with no text content
    }
  }
  return null;
}

/**
 * Read the display text from a cell, resolving shared string references
 * against the workbook's sharedStrings table.
 */
function readCellTextResolved(cellEl: ParsedElement, sharedStrings: string[]): string {
  const cellType = cellEl[":@"]?.["@_t"];
  const rawValue = getCellTextValue(cellEl);
  if (cellType === "s" && rawValue) {
    const idx = parseInt(rawValue, 10);
    return sharedStrings[idx] || "";
  }
  return rawValue;
}

/**
 * Expand all shared formulas in a parsed <sheetData> children array to
 * standalone formulas (extracted from the STEP 4 pipeline for reuse on the
 * STEP 2/3 sheets — gc-siteops Phase 6). Overwriting a shared-formula MASTER
 * cell with a value would orphan its dependents; after flattening, any cell
 * can be safely replaced.
 */
function flattenSharedFormulas(sheetDataChildren: ParsedElement[]): void {
  // Build shared formula master index: si → { masterRow, masterCol, formula }
  const sharedMasters: Record<string, { masterRow: number; masterCol: number; formula: string }> = {};

  for (const rowEl of getRowElements(sheetDataChildren)) {
    const rowNum = getRowNum(rowEl);
    const children: ParsedElement[] = rowEl.row || [];
    for (const child of children) {
      if (child.c === undefined) continue;
      const cellChildren: ParsedElement[] = child.c || [];
      for (const fc of cellChildren) {
        if (fc.f === undefined) continue;
        const attrs = fc[":@"] || {};
        if (attrs["@_t"] === "shared" && attrs["@_ref"]) {
          // This is a master cell
          const si = attrs["@_si"] || "0";
          const formulaText = fc.f?.[0]?.["#text"] || "";
          const ref = child[":@"]?.["@_r"] || "";
          const { col } = parseCellRef(ref);
          sharedMasters[si] = {
            masterRow: rowNum,
            masterCol: colLetterToIndex(col),
            formula: formulaText,
          };
        }
      }
    }
  }

  // Expand all shared formulas to standalone
  for (const rowEl of getRowElements(sheetDataChildren)) {
    const rowNum = getRowNum(rowEl);
    const children: ParsedElement[] = rowEl.row || [];
    for (const child of children) {
      if (child.c === undefined) continue;
      const cellChildren: ParsedElement[] = child.c || [];
      for (let i = 0; i < cellChildren.length; i++) {
        const fc = cellChildren[i];
        if (fc.f === undefined) continue;
        const attrs = fc[":@"] || {};
        if (attrs["@_t"] === "shared") {
          const si = attrs["@_si"] || "0";
          const hasFormula = fc.f?.[0]?.["#text"];

          if (attrs["@_ref"]) {
            // Master cell — keep formula, remove shared attributes
            delete attrs["@_t"];
            delete attrs["@_si"];
            delete attrs["@_ref"];
          } else if (hasFormula) {
            // Dependent with formula text — just remove shared attributes
            delete attrs["@_t"];
            delete attrs["@_si"];
          } else {
            // Dependent WITHOUT formula text — compute from master
            const master = sharedMasters[si];
            if (master && master.formula) {
              const rowOffset = rowNum - master.masterRow;
              const expandedFormula = shiftFormulaRefs(master.formula, master.masterRow, rowOffset);
              // Replace <f/> with <f>expandedFormula</f>
              fc.f = [{ "#text": expandedFormula }];
              delete attrs["@_t"];
              delete attrs["@_si"];
            } else {
              // Fallback: master not found or empty formula — remove <f>, keep <v>
              cellChildren.splice(i, 1);
              i--;
            }
          }
          // Clean up empty :@ if no attributes left
          if (Object.keys(attrs).length === 0) delete fc[":@"];
        }
      }
    }
  }
}

// ─── STEP 2/3 SHEET DETAIL (gc-siteops Phase 6) ─────────────────────────────

/**
 * One GC/Site Ops line as written onto its STEP 2/3 template row:
 * col F = qty, col H = rate (values; the row's live I = F×H recomputes),
 * col E = utilization fraction (staff rows only).
 */
interface SheetDetailLine {
  code: string;
  qty: number;
  rate: number;
  utilization?: number;
}

/**
 * STEP 2/3 section-subtotal cells ← the linked STEP 4 division rows
 * (computeLinkedDivisionTotals itemIds). Coordinates forensically verified
 * (Phase 1 findings §5.1, re-verified Phase 6); STEP 2/3 rows never shift —
 * the exporter inserts rows only on STEP 4. Written as VALUES from the exact
 * numbers Phase 5 writes onto STEP 4 rows 12–24, so the template's
 * exact-equality col-S checks (e.g. S13: I13='STEP 2 - GCs'!I16) compare
 * identical numbers and tie out regardless of floating-point summation order.
 */
const STEP23_SUBTOTAL_CELLS: { itemId: string; sheet: string; row: number }[] = [
  { itemId: "01-0400.002", sheet: "STEP 2 - GCs", row: 16 },       // Total Supervision
  { itemId: "01-0000.001", sheet: "STEP 2 - GCs", row: 58 },       // Total Design, PM and GCs
  { itemId: "02-0000.001", sheet: "STEP 3 - SITE OPS", row: 29 },  // Total Site Operations
  { itemId: "02-4100.002", sheet: "STEP 3 - SITE OPS", row: 35 },  // Total Demolition
  { itemId: "02-9005.003", sheet: "STEP 3 - SITE OPS", row: 40 },  // Total Final Cleaning
  { itemId: "02-9070.004", sheet: "STEP 3 - SITE OPS", row: 45 },  // Total SWPPP Permit
  { itemId: "02-9200.005", sheet: "STEP 3 - SITE OPS", row: 51 },  // Total Survey and Layout
  { itemId: "02-9300.006", sheet: "STEP 3 - SITE OPS", row: 62 },  // Total Building and Site Services
  { itemId: "02-9400.007", sheet: "STEP 3 - SITE OPS", row: 72 },  // Total Site Equipment
  { itemId: "02-9500.008", sheet: "STEP 3 - SITE OPS", row: 82 },  // Total Site Special Inspections
];

/** The two %-of-estimate GC lines (findings §5.2) get the template-faithful write shape. */
const PCT_LINE_CODES = new Set(
  GC_MANUAL_DEFAULTS.filter((cfg) => cfg.pctHint !== undefined).map((cfg) => cfg.code)
);

/**
 * Builds the STEP 2 / STEP 3 sheet-detail line lists from the calc results
 * (calculations.ts is the sole authority — this only reshapes existing
 * qty/rate pairs into the template's column convention):
 *  - staff lines: utilization (col E) + computed hours (F) + hourly rate (H)
 *  - lump-sum lines (equipment + lumpSum entries): qty 0/1 × the typed amount
 *    (the calc layer's own convention)
 *  - the two %-lines: template-faithful — F = typed amount ÷ estimate total
 *    (the effective %), H = the estimate total, so I = F×H recomputes to the
 *    typed amount and the sheet reads like the template's own instruction
 *    ("Enter this amount in column H when estimate complete"). Falls back to
 *    qty 0/1 × amount when the estimate total is $0.
 */
export function buildStep23DetailLines(
  gcCalcResult: PersonnelCalcResult,
  siteOpsCalcResult: SiteOpsCalcResult,
  estimateTotalBasis: number
): { step2: SheetDetailLine[]; step3: SheetDetailLine[] } {
  const step2: SheetDetailLine[] = [
    ...gcCalcResult.staffLines.map((l) => ({ code: l.code, qty: l.qty, rate: l.rate, utilization: l.utilization })),
    ...gcCalcResult.operationalLines.map((l) => ({ code: l.code, qty: l.qty, rate: l.rate })),
    ...gcCalcResult.equipmentLines.map((l) => ({ code: l.code, qty: l.total > 0 ? 1 : 0, rate: l.total })),
    ...gcCalcResult.manualLines.map((l) => {
      if (PCT_LINE_CODES.has(l.code)) {
        return estimateTotalBasis > 0
          ? { code: l.code, qty: l.total / estimateTotalBasis, rate: estimateTotalBasis }
          : { code: l.code, qty: l.total > 0 ? 1 : 0, rate: l.total };
      }
      return { code: l.code, qty: l.qty, rate: l.rate };
    }),
  ];
  const step3: SheetDetailLine[] = [
    ...siteOpsCalcResult.dynamicLines.map((l) => ({ code: l.code, qty: l.qty, rate: l.rate })),
    ...siteOpsCalcResult.manualLines.map((l) => ({ code: l.code, qty: l.qty, rate: l.rate })),
  ];
  return { step2, step3 };
}

/**
 * Writes the GC / Site Ops line detail onto the exported workbook's
 * "STEP 2 - GCs" and "STEP 3 - SITE OPS" sheets (gc-siteops Phase 6 — plan §8;
 * previously these sheets exported blank). Purely informational: the Budget
 * Line Items sheet carries computed values for all 217 rows regardless
 * (Phase 3), so this changes no export dollars.
 *
 * Per-row writes go in ascending column order (E → F → H — CLAUDE.md rule);
 * each row's live I = F×H line-total formula and the J cost-per-SF formulas
 * are left intact and recompute on open (fullCalcOnLoad). The section
 * subtotal cells are overwritten with the linked division VALUES (see
 * STEP23_SUBTOTAL_CELLS) so the STEP 4 col-S checks tie out exactly.
 */
async function writeStep23SheetDetail(
  zip: JSZip,
  wbXml: string,
  relsXml: string,
  sharedStrings: string[],
  gcCalcResult: PersonnelCalcResult,
  siteOpsCalcResult: SiteOpsCalcResult,
  estimateTotalBasis: number,
  linkedTotals: LinkedDivisionTotal[]
): Promise<void> {
  const parser = new XMLParser(XML_PARSER_OPTS);
  const builder = new XMLBuilder(XML_BUILDER_OPTS);

  const detail = buildStep23DetailLines(gcCalcResult, siteOpsCalcResult, estimateTotalBasis);
  const linkedTotalByItemId = new Map(linkedTotals.map((l) => [l.itemId, l.total]));

  const sheets: { name: string; lines: SheetDetailLine[] }[] = [
    { name: "STEP 2 - GCs", lines: detail.step2 },
    { name: "STEP 3 - SITE OPS", lines: detail.step3 },
  ];

  for (const { name, lines } of sheets) {
    const sheetFile = resolveSheetFile(wbXml, relsXml, name);
    let sheetXml = await zip.file(`xl/${sheetFile}`)?.async("string");
    const dataMatch = sheetXml?.match(/<sheetData>([\s\S]*)<\/sheetData>/);
    if (!sheetXml || !dataMatch) {
      throw new Error(`Sheet "${name}" has no <sheetData> — cannot write GC/Site Ops detail.`);
    }

    const parsed: ParsedElement[] = parser.parse(`<sheetData>${dataMatch[1]}</sheetData>`);
    const children: ParsedElement[] = parsed[0].sheetData || [];

    // Overwriting cells is only safe once no shared-formula dependents remain
    flattenSharedFormulas(children);

    // Locate each source line's row by its col-C criterion code (codes are
    // unique per sheet — findings §4). Never keyed off STEP 4 itemIds: the
    // string "02-4100.002" is also a STEP 4 linked-row itemId (P5 collision
    // note), but here we only ever scan THIS sheet's own code column.
    const rowByCode: Record<string, ParsedElement> = {};
    for (const rowEl of getRowElements(children)) {
      const cellC = findCellInRow(rowEl, "C");
      if (!cellC) continue;
      const code = readCellTextResolved(cellC, sharedStrings).trim();
      if (code && code.includes("-")) rowByCode[code] = rowEl;
    }

    for (const line of lines) {
      const rowEl = rowByCode[line.code];
      if (!rowEl) {
        // All template source lines were verified present (Phase 1). A miss
        // with dollars means constants.ts drifted from the template.
        if (Math.abs(line.qty * line.rate) > RECONCILIATION_TOLERANCE) {
          throw new Error(
            `GC/Site Ops line "${line.code}" carries dollars but has no row on "${name}" — constants.ts no longer matches the template.`
          );
        }
        continue;
      }
      const rowNum = getRowNum(rowEl);
      // Ascending column order within the row: E → F → H
      if (line.utilization !== undefined) {
        const eCell = getOrCreateCell(rowEl, "E", rowNum, getStyleFromRow(rowEl, "E"));
        setCellValue(eCell, line.utilization);
      }
      const fCell = getOrCreateCell(rowEl, "F", rowNum, getStyleFromRow(rowEl, "F"));
      setCellValue(fCell, line.qty);
      const hCell = getOrCreateCell(rowEl, "H", rowNum, getStyleFromRow(rowEl, "H"));
      setCellValue(hCell, line.rate);
    }

    // Section subtotal cells → linked division VALUES (exact col-S tie-out)
    for (const sub of STEP23_SUBTOTAL_CELLS) {
      if (sub.sheet !== name) continue;
      const rowEl = findRowElement(children, sub.row);
      const iCell = rowEl ? findCellInRow(rowEl, "I") : undefined;
      if (!rowEl || !iCell) {
        throw new Error(`Subtotal cell I${sub.row} not found on "${name}" — template layout drifted.`);
      }
      const formula = getCellFormula(iCell);
      if (formula === null || !formula.toUpperCase().includes("SUM(")) {
        // Guard: we expect to replace the template's live SUM. Anything else
        // means the coordinates no longer point at a subtotal row.
        throw new Error(
          `Cell I${sub.row} on "${name}" is not a SUM subtotal (found ${formula === null ? "a static value" : `"${formula}"`}) — refusing to overwrite.`
        );
      }
      setCellValue(iCell, linkedTotalByItemId.get(sub.itemId) ?? 0);
    }

    const rebuilt = fixXmlEntities(builder.build(parsed));
    const inner = rebuilt.replace(/^<sheetData>/, "").replace(/<\/sheetData>$/, "");
    sheetXml = sheetXml.replace(/<sheetData>[\s\S]*<\/sheetData>/, `<sheetData>${inner}</sheetData>`);
    zip.file(`xl/${sheetFile}`, sheetXml);
  }
}

// ─── MAIN EXPORT FUNCTION (JSZip + fast-xml-parser) ─────────────────────────

export async function generateExcelWorkbook(
  rows: ProcessedTakeoffRow[],
  projectMetadata: Project | null | undefined,
  columnDefs: ColumnDefinition[],
  layoutConfig: TemplateLayoutConfig,
  templateBuffer: ArrayBuffer,
  // Required (gc-siteops Phase 3): an export path that omitted these would
  // silently re-create the $0 GC/Site Ops bug this phase closes.
  gcCalcResult: PersonnelCalcResult,
  siteOpsCalcResult: SiteOpsCalcResult
): Promise<Blob> {
  // ── PHASE 1: ZIP Open + XML Extraction ──────────────────────────────────────

  assertWorkbookInputs(layoutConfig, templateBuffer);
  const { anchors, sheetNames } = layoutConfig;

  const zip = await JSZip.loadAsync(templateBuffer);

  let wbXml = await zip.file("xl/workbook.xml")!.async("string");
  let relsXml = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");

  const step4File = resolveSheetFile(wbXml, relsXml, "STEP 4 - ESTIMATE");
  const step1File = resolveSheetFile(wbXml, relsXml, "STEP 1 - PROJECT DATA");

  let step4Xml = await zip.file(`xl/${step4File}`)!.async("string");
  let step1Xml = await zip.file(`xl/${step1File}`)!.async("string");

  const parser = new XMLParser(XML_PARSER_OPTS);
  const builder = new XMLBuilder(XML_BUILDER_OPTS);

  // ── PHASE 2a: Flatten Shared Formulas (STEP 4 only) ────────────────────────

  // Extract <sheetData>...</sheetData> from the sheet XML
  const sheetDataMatch = step4Xml.match(/<sheetData>([\s\S]*)<\/sheetData>/);
  if (!sheetDataMatch) throw new Error("No <sheetData> found in STEP 4 sheet XML");

  const parsedSheetData: ParsedElement[] = parser.parse(`<sheetData>${sheetDataMatch[1]}</sheetData>`);
  // parsedSheetData is an array with a single { sheetData: [...rows...] } element
  const sheetDataWrapper = parsedSheetData[0];
  const sheetDataChildren: ParsedElement[] = sheetDataWrapper.sheetData || [];

  flattenSharedFormulas(sheetDataChildren);

  // ── PHASE 2b: Write STEP 1 Project Metadata ────────────────────────────────

  if (projectMetadata) {
    const step1SheetDataMatch = step1Xml.match(/<sheetData>([\s\S]*)<\/sheetData>/);
    if (step1SheetDataMatch) {
      const parsedStep1 = parser.parse(`<sheetData>${step1SheetDataMatch[1]}</sheetData>`);
      const step1Wrapper = parsedStep1[0];
      const step1Children: ParsedElement[] = step1Wrapper.sheetData || [];

      // Helper to write a value to a STEP 1 cell
      const writeStep1Cell = (
        cellAddr: string,
        value: string | number,
        type: "text" | "number"
      ) => {
        const { col, row } = parseCellRef(cellAddr);
        const rowEl = findRowElement(step1Children, row);
        if (!rowEl) return;
        const cellEl = findCellInRow(rowEl, col);
        if (!cellEl) return;
        if (type === "text") {
          setCellInlineString(cellEl, String(value));
        } else {
          setCellValue(cellEl, Number(value) || 0);
        }
      };

      // Project metadata fields
      writeStep1Cell("D5", projectMetadata.name || "", "text");
      writeStep1Cell("D8", projectMetadata.location || "", "text");
      writeStep1Cell("G9", projectMetadata.bidDate || "", "text");
      writeStep1Cell("D10", projectMetadata.expectedStart || "", "text");
      writeStep1Cell("D11", projectMetadata.expectedFinish || "", "text");
      writeStep1Cell("D12", Number(projectMetadata.squareFootage) || 0, "number");
      writeStep1Cell("D58", Number(projectMetadata.unitCount) || 0, "number");

      // Optional physical specs — only write if explicitly set
      if (projectMetadata.buildingPerimeter !== undefined) {
        writeStep1Cell("E63", Number(projectMetadata.buildingPerimeter) || 0, "number");
      }
      if (projectMetadata.buildingFootprint !== undefined) {
        writeStep1Cell("E65", Number(projectMetadata.buildingFootprint) || 0, "number");
      }
      if (projectMetadata.podiumArea !== undefined) {
        writeStep1Cell("E66", Number(projectMetadata.podiumArea) || 0, "number");
      }
      if (projectMetadata.woodframedArea !== undefined) {
        writeStep1Cell("E67", Number(projectMetadata.woodframedArea) || 0, "number");
      }
      if (projectMetadata.levelsAbovePodium !== undefined) {
        writeStep1Cell("E72", Number(projectMetadata.levelsAbovePodium) || 0, "number");
      }

      // ── PHASE 2c: Write STEP 1 Modifier Rates (G18–G24) ──────────────────
      for (const mod of ESTIMATE_MODIFIERS) {
        const rateField = `${mod.key}Rate` as keyof Project;
        const rateDecimal = (projectMetadata[rateField] as number) ?? mod.defaultRate;
        writeStep1Cell(mod.step1Cell, rateDecimal, "number");
      }

      // Rebuild STEP 1 sheetData XML
      const newStep1SheetData = fixXmlEntities(builder.build(parsedStep1));
      // Extract just the inner content (strip wrapper <sheetData>...</sheetData>)
      const step1Inner = newStep1SheetData.replace(/^<sheetData>/, "").replace(/<\/sheetData>$/, "");
      step1Xml = step1Xml.replace(
        /<sheetData>[\s\S]*<\/sheetData>/,
        `<sheetData>${step1Inner}</sheetData>`
      );
    }
  }

  // ── PHASE 2d: Write STEP 4 Row 9 Header Override ───────────────────────────

  const activeCols = columnDefs.filter(
    (col) => col.id !== "actions" && col.id !== "validationStatus"
  );

  const defaultColPositions: Record<string, number> = {
    costType: 1,      // A
    itemId: 3,        // C
    description: 4,   // D
    matchedQty: 6,    // F
    uom: 7,           // G
    unitPrice: 8,     // H
    total: 9,         // I
    costPerUnit: 10,  // J
    costPerSf: 11,    // K
  };

  const colIndexMap: Record<string, number> = {};
  let nextCustomColIdx = 12;
  for (const col of activeCols) {
    if (col.type === "default") {
      if (defaultColPositions[col.id] !== undefined) {
        colIndexMap[col.id] = defaultColPositions[col.id];
      } else {
        colIndexMap[col.id] = nextCustomColIdx++;
      }
    } else {
      colIndexMap[col.id] = nextCustomColIdx++;
    }
  }

  // Write column headers into Row 9
  const headerRowEl = findRowElement(sheetDataChildren, 9);
  if (headerRowEl) {
    for (const col of activeCols) {
      const colIdx = colIndexMap[col.id];
      if (!colIdx) continue;
      const colLetter = getColumnLetter(colIdx);
      const cellEl = findCellInRow(headerRowEl, colLetter);
      if (cellEl) {
        const headerText = col.id === "notes" ? "Notes" : col.header;
        setCellInlineString(cellEl, headerText);
      }
    }
  }

  // ── PHASE 2e: Process Division Data ────────────────────────────────────────

  // We need a shared strings lookup for reading existing cell text values
  // Parse the shared strings table once
  const sstXml = await zip.file("xl/sharedStrings.xml")?.async("string");
  let sharedStrings: string[] = [];
  if (sstXml) {
    const sstEntries = sstXml.match(/<si>([\s\S]*?)<\/si>/g) || [];
    sharedStrings = sstEntries.map((entry) => {
      const tMatch = entry.match(/<t[^>]*>([^<]*)<\/t>/);
      return tMatch ? tMatch[1] : "";
    });
  }

  /**
   * Read the display text from a cell, resolving shared string references.
   */
  function readCellText(cellEl: ParsedElement): string {
    return readCellTextResolved(cellEl, sharedStrings);
  }

  const divisions = JSON.parse(
    JSON.stringify(layoutConfig.divisions)
  ) as DivisionLayout[];
  // Top of the STEP 4 data region (row 10); the column-header row sits above it.
  const dataStartRow = divisions[0].headerRow;
  let rowShift = 0;
  const insertionsByDivision: Record<string, number> = {};

  // gc-siteops Phase 5: the 10 linked division rows (template rows 12–24) get
  // qty 1 × their computed Step 2/3 subtotal written as VALUES — replacing the
  // grid's display-only zeros — so the sheet's own subtotal (I331) and modifier
  // formulas recompute on the same whole-job basis as the estimate page.
  // Values come from calculations.ts (sole authority); these rows stay OUT of
  // the BLI rollup (the granular GC/Site Ops rows carry the dollars).
  // Computed ONCE per export — PHASE 2g (sheet detail + %-line basis) reuses
  // this same array, which also guarantees the STEP 2/3 subtotal values are
  // bit-identical to the STEP 4 row writes (the col-S exact-equality tie-out).
  const linkedDivisionTotals = computeLinkedDivisionTotals(gcCalcResult, siteOpsCalcResult);
  const linkedDivisionTotalByItemId = new Map(
    linkedDivisionTotals.map((l) => [l.itemId, l.total])
  );

  for (const div of divisions) {
    const headerRowIdx = div.headerRow + rowShift;
    const startRowIdx = div.startRow + rowShift;
    let endRowIdx = div.endRow + rowShift;

    // Get rows belonging to this division
    const divRows = rows.filter((r) => getDivisionCode(r.itemId) === div.division);

    // Build map of existing pre-populated row numbers in the template
    const prepopulatedRowsMap: Record<string, number> = {};
    for (let r = startRowIdx; r <= endRowIdx; r++) {
      const rowEl = findRowElement(sheetDataChildren, r);
      if (!rowEl) continue;
      const cellC = findCellInRow(rowEl, "C");
      if (!cellC) continue;
      const codeStr = readCellText(cellC).trim();
      if (codeStr && codeStr.length >= 6 && codeStr.includes("-")) {
        // Normalize known template typos so catalog itemIds match their rows
        const normalized = TEMPLATE_CODE_NORMALIZATIONS[codeStr] || codeStr;
        prepopulatedRowsMap[normalized] = r;
      }
    }

    const unmappedRows: ProcessedTakeoffRow[] = [];

    // Map rows to template or collect unmapped
    for (const row of divRows) {
      const code = (row.itemId || "").trim();
      const rIdx = prepopulatedRowsMap[code];
      if (rIdx !== undefined) {
        // ── Mapped row: write DATA VALUES ONLY (do NOT overwrite template formulas)
        const rowEl = findRowElement(sheetDataChildren, rIdx);
        if (!rowEl) continue;

        // Linked division rows: qty/price come from the linked-write pass
        // below, never from grid values (Phase 5 — grid values are
        // display-only zeros, or excluded stray dollars).
        const isLinked = isLinkedDivisionRow(code);

        // Description (D)
        const descCell = getOrCreateCell(rowEl, "D", rIdx, getStyleFromRow(rowEl, "D"));
        setCellInlineString(descCell, row.description || "");

        if (!isLinked) {
          // Quantity (F)
          const qtyCell = getOrCreateCell(rowEl, "F", rIdx, getStyleFromRow(rowEl, "F"));
          setCellValue(qtyCell, Number(row.matchedQty) || 0);
        }

        // UOM (G)
        const uomCell = getOrCreateCell(rowEl, "G", rIdx, getStyleFromRow(rowEl, "G"));
        setCellInlineString(uomCell, row.uom || "");

        if (!isLinked) {
          // Unit Price (H)
          const priceCell = getOrCreateCell(rowEl, "H", rIdx, getStyleFromRow(rowEl, "H"));
          setCellValue(priceCell, Number(row.unitPrice) || 0);
        }

        // Custom fields + notes
        for (const col of activeCols) {
          if (col.type === "custom" || col.id === "notes") {
            const colIdx = colIndexMap[col.id];
            if (!colIdx) continue;
            const colLetter = getColumnLetter(colIdx);
            const cell = getOrCreateCell(rowEl, colLetter, rIdx, "0");
            setCellInlineString(cell, String(row.customFields?.[col.id] ?? ""));
          }
        }
      } else {
        unmappedRows.push(row);
      }
    }

    // ── Linked division rows (Phase 5): write qty 1 × computed Step 2/3
    // subtotal as values, independent of grid state, replacing the template's
    // live pull formulas (which would read $0 off the blank STEP 2/3 sheets).
    for (const [code, rIdx] of Object.entries(prepopulatedRowsMap)) {
      if (!isLinkedDivisionRow(code)) continue;
      const rowEl = findRowElement(sheetDataChildren, rIdx);
      if (!rowEl) continue;
      const qtyCell = getOrCreateCell(rowEl, "F", rIdx, getStyleFromRow(rowEl, "F"));
      setCellValue(qtyCell, 1);
      const priceCell = getOrCreateCell(rowEl, "H", rIdx, getStyleFromRow(rowEl, "H"));
      setCellValue(priceCell, linkedDivisionTotalByItemId.get(code) ?? 0);
    }

    // ── Unmapped row insertion (overflow/manual rows) ──
    // Use the first data row as the style reference
    const baseRowEl = findRowElement(sheetDataChildren, startRowIdx);

    for (const row of unmappedRows) {
      const insertIdx = endRowIdx + 1;

      // Shift all rows at and below the insertion point down by 1
      shiftRowElements(sheetDataChildren, insertIdx, 1);

      // Clone the base row at the new position
      const newRow = baseRowEl
        ? cloneRowElement(baseRowEl, insertIdx)
        : { row: [], ":@": { "@_r": String(insertIdx) } };

      // Populate cell values
      const aCel = getOrCreateCell(newRow, "A", insertIdx, baseRowEl ? getStyleFromRow(baseRowEl, "A") : "0");
      setCellInlineString(aCel, row.costType || "TI");

      const cCel = getOrCreateCell(newRow, "C", insertIdx, baseRowEl ? getStyleFromRow(baseRowEl, "C") : "0");
      setCellInlineString(cCel, row.itemId || "");

      const dCel = getOrCreateCell(newRow, "D", insertIdx, baseRowEl ? getStyleFromRow(baseRowEl, "D") : "0");
      setCellInlineString(dCel, row.description || "");

      const fCel = getOrCreateCell(newRow, "F", insertIdx, baseRowEl ? getStyleFromRow(baseRowEl, "F") : "0");
      setCellValue(fCel, Number(row.matchedQty) || 0);

      const gCel = getOrCreateCell(newRow, "G", insertIdx, baseRowEl ? getStyleFromRow(baseRowEl, "G") : "0");
      setCellInlineString(gCel, row.uom || "");

      const hCel = getOrCreateCell(newRow, "H", insertIdx, baseRowEl ? getStyleFromRow(baseRowEl, "H") : "0");
      setCellValue(hCel, Number(row.unitPrice) || 0);

      const iCel = getOrCreateCell(newRow, "I", insertIdx, baseRowEl ? getStyleFromRow(baseRowEl, "I") : "0");
      setCellFormula(iCel, `IF(ISNUMBER(F${insertIdx}), F${insertIdx} * H${insertIdx}, 0)`);

      const jCel = getOrCreateCell(newRow, "J", insertIdx, baseRowEl ? getStyleFromRow(baseRowEl, "J") : "0");
      setCellFormula(jCel, `IF($J$8=0, 0, I${insertIdx}/$J$8)`);

      const kCel = getOrCreateCell(newRow, "K", insertIdx, baseRowEl ? getStyleFromRow(baseRowEl, "K") : "0");
      setCellFormula(kCel, `IF($K$8=0, 0, I${insertIdx}/$K$8)`);

      // Custom fields + notes for inserted rows
      for (const col of activeCols) {
        if (col.type === "custom" || col.id === "notes") {
          const colIdx = colIndexMap[col.id];
          if (!colIdx) continue;
          const colLetter = getColumnLetter(colIdx);
          const cell = getOrCreateCell(newRow, colLetter, insertIdx, "0");
          setCellInlineString(cell, String(row.customFields?.[col.id] ?? ""));
        }
      }

      // Insert into the sheetData
      insertRowElement(sheetDataChildren, newRow);

      rowShift++;
      endRowIdx++;
      insertionsByDivision[div.division] = (insertionsByDivision[div.division] || 0) + 1;
    }

    // Rewrite Division Header Subtotal Formula (in Column E)
    const headerEl = findRowElement(sheetDataChildren, headerRowIdx);
    if (headerEl) {
      const eCell = findCellInRow(headerEl, "E");
      if (eCell) {
        setCellFormula(eCell, `SUM(I${startRowIdx}:I${endRowIdx})`);
      }
    }
  }

  // ── PHASE 2f: Subtotal, Modifiers, Grand Total, Reconciliation ─────────────
  // Row geometry comes from template_config.config_data anchors (Phase 3b);
  // all anchor values are ORIGINAL template rows, shifted by rowShift here.

  const subtotalRowIdx = anchors.subtotalRow + rowShift;

  // Subtotal formula
  const subtotalRowEl = findRowElement(sheetDataChildren, subtotalRowIdx);
  if (subtotalRowEl) {
    const iCell = findCellInRow(subtotalRowEl, "I");
    if (iCell) setCellFormula(iCell, `SUM(I${dataStartRow}:I${subtotalRowIdx - 1})`);
  }

  // Modifier rows (subtotal + modifierStartOffset through subtotal + modifierEndOffset)
  for (let offset = anchors.modifierStartOffset; offset <= anchors.modifierEndOffset; offset++) {
    const r = subtotalRowIdx + offset;
    const modRowEl = findRowElement(sheetDataChildren, r);
    if (!modRowEl) continue;

    // Read cost code from Column C to match the modifier
    const cCell = findCellInRow(modRowEl, "C");
    const costCode = cCell ? readCellText(cCell).trim() : "";
    const mod = ESTIMATE_MODIFIERS.find((m) => m.code === costCode);

    if (mod && projectMetadata) {
      const rateField = `${mod.key}Rate` as keyof Project;
      const rateDecimal = (projectMetadata[rateField] as number) ?? mod.defaultRate;
      // Write rate to Column F
      const fCell = findCellInRow(modRowEl, "F");
      if (fCell) setCellValue(fCell, rateDecimal);
    }

    // Always rewrite formulas
    const iModCell = findCellInRow(modRowEl, "I");
    if (iModCell) setCellFormula(iModCell, `F${r}*$I$${subtotalRowIdx}`);

    const jModCell = findCellInRow(modRowEl, "J");
    if (jModCell) setCellFormula(jModCell, `IF($J$8=0, 0, I${r}/$J$8)`);

    const kModCell = findCellInRow(modRowEl, "K");
    if (kModCell) setCellFormula(kModCell, `IF($K$8=0, 0, I${r}/$K$8)`);

    const pModCell = findCellInRow(modRowEl, "P");
    if (pModCell) setCellFormula(pModCell, `I${r}`);
  }

  // Grand Total row (= subtotal + grandTotalOffset; the SUM spans the rows between them)
  const totalRowIdx = subtotalRowIdx + anchors.grandTotalOffset;
  const totalRowEl = findRowElement(sheetDataChildren, totalRowIdx);
  if (totalRowEl) {
    const iTotal = findCellInRow(totalRowEl, "I");
    if (iTotal) setCellFormula(iTotal, `SUM(I${subtotalRowIdx}:I${totalRowIdx - 1})`);

    const jTotal = findCellInRow(totalRowEl, "J");
    if (jTotal) setCellFormula(jTotal, `IF($J$8=0, 0, I${totalRowIdx}/$J$8)`);

    const kTotal = findCellInRow(totalRowEl, "K");
    if (kTotal) setCellFormula(kTotal, `IF($K$8=0, 0, I${totalRowIdx}/$K$8)`);

    const pTotal = findCellInRow(totalRowEl, "P");
    if (pTotal) setCellFormula(pTotal, `SUM(P${dataStartRow}:P${totalRowIdx - 1})`);
  }

  // Reconciliation rows (4 rows starting at anchors.reconStartRow)
  const reconStartRow = anchors.reconStartRow + rowShift;

  // Recon row 1 (template row 346): "Totals from Column E"
  const reconRow1 = findRowElement(sheetDataChildren, reconStartRow);
  if (reconRow1) {
    const eRecon1 = findCellInRow(reconRow1, "E");
    if (eRecon1) setCellFormula(eRecon1, `SUM(E${dataStartRow}:E${reconStartRow - 1})`);
  }

  // Recon row 2 (template row 347): "Contingency, Insurance and Fee"
  const reconRow2 = findRowElement(sheetDataChildren, reconStartRow + 1);
  if (reconRow2) {
    const eRecon2 = findCellInRow(reconRow2, "E");
    if (eRecon2) setCellFormula(eRecon2, `SUM(I${subtotalRowIdx + 1}:I${totalRowIdx - 1})`);

    const oRecon2 = findCellInRow(reconRow2, "O");
    if (oRecon2) setCellFormula(oRecon2, `I${totalRowIdx}-P${totalRowIdx}`);

    const pRecon2 = findCellInRow(reconRow2, "P");
    if (pRecon2) setCellFormula(pRecon2, `O${reconStartRow + 1}/P${totalRowIdx}`);
  }

  // Recon row 3 (template row 348): "Total"
  const reconRow3 = findRowElement(sheetDataChildren, reconStartRow + 2);
  if (reconRow3) {
    const eRecon3 = findCellInRow(reconRow3, "E");
    if (eRecon3) setCellFormula(eRecon3, `SUM(E${reconStartRow}:E${reconStartRow + 1})`);
  }

  // Recon row 4 (template row 349): "Equals Totals from Column I"
  const reconRow4 = findRowElement(sheetDataChildren, reconStartRow + 3);
  if (reconRow4) {
    const eRecon4 = findCellInRow(reconRow4, "E");
    if (eRecon4) setCellFormula(eRecon4, `E${reconStartRow + 2}=I${totalRowIdx}`);
  }

  // ── Rebuild STEP 4 sheetData XML ───────────────────────────────────────────

  const newSheetDataXml = fixXmlEntities(builder.build(parsedSheetData));
  const step4Inner = newSheetDataXml.replace(/^<sheetData>/, "").replace(/<\/sheetData>$/, "");
  step4Xml = step4Xml.replace(
    /<sheetData>[\s\S]*<\/sheetData>/,
    `<sheetData>${step4Inner}</sheetData>`
  );

  // ── PHASE 2g: STEP 2/3 Sheet Detail (gc-siteops Phase 6) ───────────────────
  // Write the GC/Site Ops line qty/rate values + section-subtotal values onto
  // the "STEP 2 - GCs" / "STEP 3 - SITE OPS" sheets. Must run BEFORE the 3d
  // cross-sheet fixup so any 'STEP 4 - ESTIMATE'! references that survive on
  // those sheets (e.g. the L-column % hints) are row-shifted on the updated
  // XML. The %-line basis is the same whole-job summary the estimate page and
  // both CSV paths use (computeTakeoffSummary + linked totals — Phase 5 basis).
  const step23Summary = computeTakeoffSummary(
    rows,
    projectMetadata?.squareFootage ?? 0,
    projectMetadata?.unitCount ?? 0,
    {
      constructionContingencyRate: projectMetadata?.constructionContingencyRate ?? 0,
      designContingencyRate: projectMetadata?.designContingencyRate ?? 0,
      buildersRiskRate: projectMetadata?.buildersRiskRate ?? 0,
      specialInsuranceRate: projectMetadata?.specialInsuranceRate ?? 0,
      glInsuranceRate: projectMetadata?.glInsuranceRate ?? 0.01,
      bondRate: projectMetadata?.bondRate ?? 0,
      feeRate: projectMetadata?.feeRate ?? 0.05,
      roundingRule: projectMetadata?.roundingRule ?? "dollar",
    },
    linkedDivisionTotals
  );
  await writeStep23SheetDetail(
    zip,
    wbXml,
    relsXml,
    sharedStrings,
    gcCalcResult,
    siteOpsCalcResult,
    step23Summary.totalEstimatedCost,
    linkedDivisionTotals
  );

  // ── PHASE 3: Metadata Updates + ZIP Write ──────────────────────────────────

  const shiftRow = buildRowShifter(layoutConfig.divisions, insertionsByDivision);

  // Derived boundaries (see TemplateLayoutAnchors): last data row sits just
  // above the subtotal; the sheet ends at the last of the 4 recon rows.
  const dataEndRow = anchors.subtotalRow - 1;
  const sheetEndRow = anchors.reconStartRow + 3;

  // 3a: Update AutoFilter range (column-header row spans the data region)
  step4Xml = step4Xml.replace(
    /(<autoFilter[^>]*ref=")[^"]+(")/,
    `$1A${dataStartRow - 1}:K${dataEndRow + rowShift}$2`
  );

  // 3a: Update Dimension
  step4Xml = step4Xml.replace(
    /(<dimension[^>]*ref=")[^"]+(")/,
    `$1B1:U${sheetEndRow + rowShift}$2`
  );

  // 3a: Update MergeCells — shift row numbers
  if (rowShift > 0) {
    step4Xml = step4Xml.replace(
      /<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/g,
      (_match: string, col1: string, row1Str: string, col2: string, row2Str: string) => {
        const r1 = shiftRow(parseInt(row1Str, 10));
        const r2 = shiftRow(parseInt(row2Str, 10));
        return `<mergeCell ref="${col1}${r1}:${col2}${r2}"/>`;
      }
    );
  }

  // 3b: Remove calcChain.xml
  zip.remove("xl/calcChain.xml");
  let ctXml = await zip.file("[Content_Types].xml")!.async("string");
  ctXml = ctXml.replace(/<Override[^>]*calcChain[^>]*\/>/g, "");
  zip.file("[Content_Types].xml", ctXml);
  relsXml = relsXml.replace(/<Relationship[^>]*calcChain[^>]*\/>/g, "");

  // 3c: Update workbook.xml — remove external defined names
  wbXml = wbXml.replace(/<definedName[^>]*>[^<]*\[\d+\][^<]*<\/definedName>/g, "");

  // 3c: Update Print Area for STEP 4
  // Find the _xlnm.Print_Area for STEP 4 and update its row references
  if (rowShift > 0) {
    wbXml = wbXml.replace(
      /(<definedName[^>]*name="_xlnm\.Print_Area"[^>]*>[^<]*\$)(\d+)(<\/definedName>)/g,
      (_match: string, prefix: string, rowStr: string, suffix: string) => {
        const origRow = parseInt(rowStr, 10);
        // Only shift rows in the range that's above the data region boundary
        if (origRow > dataEndRow) {
          return `${prefix}${origRow + rowShift}${suffix}`;
        }
        return `${prefix}${rowStr}${suffix}`;
      }
    );
  }

  // 3d: Cross-sheet formula row shifting + #REF! fix
  if (rowShift > 0) {
    const crossSheetNames = [
      "COVER", "STEP 2 - GCs", "STEP 3 - SITE OPS", "PER DIEM", sheetNames.budgetLineItems
    ];

    for (const sheetName of crossSheetNames) {
      let sheetFile: string;
      try {
        sheetFile = resolveSheetFile(wbXml, relsXml, sheetName);
      } catch {
        continue; // Sheet not found, skip
      }

      let sheetXml = await zip.file(`xl/${sheetFile}`)?.async("string");
      if (!sheetXml || !sheetXml.includes("STEP 4 - ESTIMATE")) {
        // Budget Line Items #REF! repair is handled by the dedicated rollup
        // phase (3d-2) below — nothing to shift here.
        continue;
      }

      const refPattern = /('STEP 4 - ESTIMATE'!\$?[A-Z]+\$?)(\d+)/g;
      sheetXml = sheetXml.replace(
        refPattern,
        (_fullMatch: string, prefix: string, rowStr: string) => {
          const origRow = parseInt(rowStr, 10);
          const newRow = shiftRow(origRow);
          return `${prefix}${newRow}`;
        }
      );

      zip.file(`xl/${sheetFile}`, sheetXml);
    }
  }

  // 3d-2: Budget Line Items — deterministic computed rollup for ALL 217 rows
  // (gc-siteops Phase 3; supersedes the Phase 2 "preserve STEP 2/3 SUMIFs"
  // decision). Column H gets a computed VALUE on every data row:
  //  - STEP 4-sourced rows (and the broken #REF! row 1-10000.000): from
  //    rollupByProcoreCode — unchanged. The broken row gets $0 in the normal
  //    flow per the D3 sign-off (the 34 granular GC rows carry the dollars).
  //  - STEP 2/3-sourced rows (34 GC + 38 Site Ops live SUMIFs): from the
  //    GC/Site Ops rollup — $0 where the app has no input line yet. No live
  //    SUMIF survives in the exported file, so a wrong legacy formula can
  //    never produce a wrong rollup (§0.D rule 1).
  // Rows are identified by their own Procore code (col A), never by the SUMIF
  // criterion (§0.D rule 2). Mapped codes absent from the sheet (e.g.
  // 2-20000.000) are appended after validation against the "Importer Data
  // Fields" sheet. Values come exclusively from calculations.ts results and
  // rollupByProcoreCode (matchedQty * unitPrice) — no invented financials.
  const procoreRollup = rollupByProcoreCode(rows);
  const gcSiteOpsLines = collectGcSiteOpsLines(gcCalcResult, siteOpsCalcResult);
  for (const line of gcSiteOpsLines) {
    if (!line.procoreCode.trim() && Math.abs(line.total) > RECONCILIATION_TOLERANCE) {
      throw new Error(
        `GC/Site Ops line "${line.code}" (${line.desc}) carries $${line.total.toFixed(2)} but has no Budget Line Items mapping — fix its constants.ts entry.`
      );
    }
  }
  const gcSiteOpsRollup = rollupGcSiteOps(gcSiteOpsLines);
  let bliSheetFile: string | null = null;
  try {
    bliSheetFile = resolveSheetFile(wbXml, relsXml, sheetNames.budgetLineItems);
  } catch {
    bliSheetFile = null; // Template variant without a BLI sheet — skip phase
  }

  if (bliSheetFile) {
    let bliXml = await zip.file(`xl/${bliSheetFile}`)?.async("string");
    const bliDataMatch = bliXml?.match(/<sheetData>([\s\S]*)<\/sheetData>/);
    if (bliXml && bliDataMatch) {
      // Validation oracle: Importer Data Fields col A = valid Procore codes,
      // col B = official cost code description.
      const importerCodes = new Map<string, string>();
      try {
        const impFile = resolveSheetFile(wbXml, relsXml, sheetNames.importerDataFields);
        const impXml = await zip.file(`xl/${impFile}`)?.async("string");
        const impDataMatch = impXml?.match(/<sheetData>([\s\S]*)<\/sheetData>/);
        if (impDataMatch) {
          const parsedImp: ParsedElement[] = parser.parse(`<sheetData>${impDataMatch[1]}</sheetData>`);
          const impChildren: ParsedElement[] = parsedImp[0].sheetData || [];
          for (const rowEl of getRowElements(impChildren)) {
            if (getRowNum(rowEl) < 2) continue; // header row
            const aCell = findCellInRow(rowEl, "A");
            if (!aCell) continue;
            const code = readCellText(aCell).trim();
            if (!code || !code.includes("-")) continue;
            const bCell = findCellInRow(rowEl, "B");
            importerCodes.set(code, bCell ? readCellText(bCell).trim() : "");
          }
        }
      } catch { /* Importer Data Fields sheet not found — append validation skipped */ }

      const parsedBli: ParsedElement[] = parser.parse(`<sheetData>${bliDataMatch[1]}</sheetData>`);
      const bliChildren: ParsedElement[] = parsedBli[0].sheetData || [];

      const seenCodes = new Set<string>();
      const gcSiteOpsWritten = new Set<string>();
      let writtenTotal = 0;
      let lastDataRowEl: ParsedElement | null = null;
      let lastDataRowNum = 1;

      for (const rowEl of getRowElements(bliChildren)) {
        const rowNum = getRowNum(rowEl);
        if (rowNum < 2) continue; // header row
        const aCell = findCellInRow(rowEl, "A");
        if (!aCell) continue;
        const code = readCellText(aCell).trim();
        if (!code || !code.includes("-")) continue;
        seenCodes.add(code);
        if (rowNum > lastDataRowNum) {
          lastDataRowNum = rowNum;
          lastDataRowEl = rowEl;
        }

        const hCell = findCellInRow(rowEl, "H");
        if (!hCell) continue;
        const formula = getCellFormula(hCell);
        const step4Amount = procoreRollup[code] ?? 0;
        if (formula !== null && (formula.includes("STEP 4 - ESTIMATE") || formula.includes("#REF!"))) {
          // App-owned rollup row (or the broken #REF! row): computed value
          setCellValue(hCell, step4Amount);
          writtenTotal += step4Amount;
        } else if (formula !== null) {
          // STEP 2/3-sourced row: write the app-computed GC/Site Ops value
          // ($0 where no app input line exists yet — see Phase 1 findings §6).
          if (Math.abs(step4Amount) > RECONCILIATION_TOLERANCE) {
            // A STEP 4 line item is mapped onto a GC/Site Ops BLI code —
            // writing either value would drop the other's dollars. Surface
            // the conflict instead of guessing.
            throw new Error(
              `${sheetNames.budgetLineItems} row for "${code}" is GC/Site Ops-sourced, but STEP 4 line items total $${step4Amount.toFixed(2)} for it. Resolve the mapping before export.`
            );
          }
          const amount = gcSiteOpsRollup[code] ?? 0;
          setCellValue(hCell, amount);
          writtenTotal += amount;
          gcSiteOpsWritten.add(code);
        } else if (
          Math.abs(step4Amount) > RECONCILIATION_TOLERANCE ||
          Math.abs(gcSiteOpsRollup[code] ?? 0) > RECONCILIATION_TOLERANCE
        ) {
          // Static (formula-less) row carrying app dollars — never expected;
          // surface instead of silently dropping.
          throw new Error(
            `${sheetNames.budgetLineItems} row for "${code}" is a static cell, but the app carries dollars for it. Resolve the mapping before export.`
          );
        }
      }

      // Every GC/Site Ops code with dollars must have landed on a STEP 2/3
      // BLI row (all 34+38 exist in the template — Phase 1 verified). A miss
      // means constants.ts drifted from the template; fail loudly.
      const unplacedGcCodes = Object.keys(gcSiteOpsRollup)
        .filter((code) => !gcSiteOpsWritten.has(code) && Math.abs(gcSiteOpsRollup[code]) > RECONCILIATION_TOLERANCE)
        .sort();
      if (unplacedGcCodes.length > 0) {
        throw new Error(
          `GC/Site Ops dollars have no ${sheetNames.budgetLineItems} row to land on: ${unplacedGcCodes.join(", ")}. constants.ts mapping no longer matches the template.`
        );
      }

      // Append rows for mapped codes absent from the sheet (e.g. 2-20000.000)
      const missingCodes = Object.keys(procoreRollup)
        .filter((code) => !seenCodes.has(code) && Math.abs(procoreRollup[code]) > RECONCILIATION_TOLERANCE)
        .sort();
      for (const code of missingCodes) {
        if (importerCodes.size > 0 && !importerCodes.has(code)) {
          throw new Error(
            `Procore code "${code}" is not present in the template's ${sheetNames.importerDataFields} sheet — cannot append it to ${sheetNames.budgetLineItems}.`
          );
        }
        lastDataRowNum++;
        const newRow: ParsedElement = lastDataRowEl
          ? cloneRowElement(lastDataRowEl, lastDataRowNum)
          : { row: [], ":@": { "@_r": String(lastDataRowNum) } };
        const styleOf = (col: string) => (lastDataRowEl ? getStyleFromRow(lastDataRowEl, col) : "0");
        setCellInlineString(getOrCreateCell(newRow, "A", lastDataRowNum, styleOf("A")), code);
        // Template-wide BLI convention for data rows: Cost Type "Material",
        // Unit Qty 1, UOM "ls" (mirrors every pre-populated BLI row)
        setCellInlineString(getOrCreateCell(newRow, "B", lastDataRowNum, styleOf("B")), "Material");
        setCellInlineString(getOrCreateCell(newRow, "C", lastDataRowNum, styleOf("C")), importerCodes.get(code) || "");
        setCellValue(getOrCreateCell(newRow, "E", lastDataRowNum, styleOf("E")), 1);
        setCellInlineString(getOrCreateCell(newRow, "F", lastDataRowNum, styleOf("F")), "ls");
        setCellValue(getOrCreateCell(newRow, "H", lastDataRowNum, styleOf("H")), procoreRollup[code]);
        insertRowElement(bliChildren, newRow);
        writtenTotal += procoreRollup[code];
      }

      // Internal tie-out: dollars written/appended must equal the full
      // rollup — STEP 4 line items + GC + Site Ops (gc-siteops Phase 3).
      const rollupTotal =
        Object.values(procoreRollup).reduce((s, v) => s + v, 0) +
        Object.values(gcSiteOpsRollup).reduce((s, v) => s + v, 0);
      if (Math.abs(writtenTotal - rollupTotal) > RECONCILIATION_TOLERANCE) {
        throw new Error(
          `Budget Line Items reconciliation failed: wrote $${writtenTotal.toFixed(2)} but rollup totals $${rollupTotal.toFixed(2)}.`
        );
      }

      const newBliSheetData = fixXmlEntities(builder.build(parsedBli));
      const bliInner = newBliSheetData.replace(/^<sheetData>/, "").replace(/<\/sheetData>$/, "");
      bliXml = bliXml.replace(
        /<sheetData>[\s\S]*<\/sheetData>/,
        `<sheetData>${bliInner}</sheetData>`
      );

      // Extend dimension + autoFilter over appended rows
      if (missingCodes.length > 0) {
        bliXml = bliXml.replace(/(<dimension[^>]*ref="A1:[A-Z]+)\d+(")/, `$1${lastDataRowNum}$2`);
        bliXml = bliXml.replace(/(<autoFilter[^>]*ref="A1:[A-Z]+)\d+(")/, `$1${lastDataRowNum}$2`);
      }

      zip.file(`xl/${bliSheetFile}`, bliXml);
    }
  }

  // 3d-3: Force full recalculation on open so all remaining live formulas
  // (STEP 2/3 SUMIFs, STEP 4 column I, division headers) recompute against
  // the injected values (calcChain was removed in 3b).
  if (/<calcPr[^>]*\/>/.test(wbXml)) {
    wbXml = wbXml.replace(/<calcPr([^>]*?)\s*\/>/, (_match: string, attrs: string) => {
      const cleaned = attrs.replace(/\s*fullCalcOnLoad="[^"]*"/, "");
      return `<calcPr${cleaned} fullCalcOnLoad="1"/>`;
    });
  } else {
    wbXml = wbXml.replace("</workbook>", `<calcPr fullCalcOnLoad="1"/></workbook>`);
  }

  // 3e: Write modified files to ZIP
  zip.file(`xl/${step4File}`, step4Xml);
  zip.file(`xl/${step1File}`, step1Xml);
  zip.file("xl/workbook.xml", wbXml);
  zip.file("xl/_rels/workbook.xml.rels", relsXml);

  // 3f: Clear cached error values (t="e") on formula cells across all sheets.
  // The template ships stale cached errors (e.g. #DIV/0! in auxiliary sheets
  // whose divisor cells are blank). Dropping the cached <v> and the error type
  // marker — while keeping the formula — forces Excel to recompute the cell on
  // open (calcChain was already removed in step 3b). Literal error values
  // without a formula are left untouched.
  const worksheetFiles = Object.keys(zip.files).filter(
    (name) => name.startsWith("xl/worksheets/") && name.endsWith(".xml")
  );
  for (const wsName of worksheetFiles) {
    const wsXml = await zip.file(wsName)?.async("string");
    if (!wsXml || !wsXml.includes('t="e"')) continue;
    const cleaned = wsXml.replace(
      /(<c [^>]*?) t="e"([^>]*>)(<f[^>]*(?:\/>|>[^<]*<\/f>))<v>[^<]*<\/v>/g,
      "$1$2$3"
    );
    if (cleaned !== wsXml) zip.file(wsName, cleaned);
  }

  // Generate output
  const outBuffer = await zip.generateAsync({ type: "arraybuffer" });
  return new Blob([outBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

