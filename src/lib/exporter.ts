import { ProcessedTakeoffRow, ColumnDefinition } from "@/types";
import { Project, DivisionLayout } from "@/types/db";
import { DEFAULT_CURRENCY_DECIMALS, DEFAULT_QTY_DECIMALS, ESTIMATE_MODIFIERS } from "./constants";
import { computeTakeoffSummary } from "./calculations";
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
  project?: Project | null
): string {
  const csvLines: string[] = [];
  const activeCols = columnDefs.filter((col) => col.id !== "actions" && col.id !== "validationStatus");



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

  // Populate each data row dynamically using active user modified grid values
  for (const row of rows) {
    const calculatedTotal = row.matchedQty * row.unitPrice;
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
            return row.matchedQty;
          case "uom":
            return row.uom || "";
          case "unitPrice":
            return row.unitPrice;
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

  // Calculate dynamic subtotal and append template-aligned modifier rows
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
  });

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
 * Groups fine-grained suffix costs into unified Procore parent codes and cost types,
 * summing the budget values and structuring exactly matching Procore's budget importer schema.
 * Columns: "Cost Code","Cost Type","Description","Original Budget"
 * Incorporates dynamic markup layers based on project settings.
 */
export function generateProcoreBudget(
  rows: ProcessedTakeoffRow[],
  project?: Project | null
): string {
  const csvLines: string[] = [];



  // Header line exactly matching Procore's standard budget importer columns
  csvLines.push(["Cost Code", "Cost Type", "Description", "Original Budget"].map(escapeCSVField).join(","));

  // Maintain groups using a combination key of parent cost code + cost type
  const groupings: Record<string, {
    parentCode: string;
    costType: string;
    descriptions: Set<string>;
    totalCost: number;
  }> = {};

  // Group and sum mapped rows only to guarantee database cleanliness
  for (const row of rows) {
    if (!row.isMapped || !row.procoreParentCode) continue;

    const parentCode = row.procoreParentCode.trim();
    const costType = row.costType.trim();
    const groupKey = `${parentCode}::${costType}`;
    const calculatedTotal = row.matchedQty * row.unitPrice;

    if (!groupings[groupKey]) {
      groupings[groupKey] = {
        parentCode,
        costType,
        descriptions: new Set<string>(),
        totalCost: 0
      };
    }

    groupings[groupKey].descriptions.add(row.description);
    groupings[groupKey].totalCost += calculatedTotal;
  }

  // Serialize grouped lines
  for (const key of Object.keys(groupings)) {
    const group = groupings[key];
    const consolidatedDescription = Array.from(group.descriptions).join("; ");

    const columns = [
      group.parentCode,
      group.costType,
      consolidatedDescription,
      group.totalCost.toFixed(2)
    ];

    csvLines.push(columns.map(escapeCSVField).join(","));
  }

  // Calculate subtotal and append template-aligned modifier rows with rounding
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
  });

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

/**
 * Generates an Excel Workbook from a company template file, injects values
 * into "STEP 4 - ESTIMATE" sheet, recalculates markups, and returns a downloadable Blob.
 */
const DEFAULT_LAYOUT_CONFIG: DivisionLayout[] = [
  { division: "01", headerRow: 10, startRow: 11, endRow: 14 },
  { division: "02", headerRow: 15, startRow: 16, endRow: 25 },
  { division: "03", headerRow: 26, startRow: 27, endRow: 52 },
  { division: "04", headerRow: 53, startRow: 54, endRow: 62 },
  { division: "05", headerRow: 63, startRow: 64, endRow: 72 },
  { division: "06", headerRow: 73, startRow: 74, endRow: 92 },
  { division: "07", headerRow: 93, startRow: 94, endRow: 130 },
  { division: "08", headerRow: 131, startRow: 132, endRow: 149 },
  { division: "09", headerRow: 150, startRow: 151, endRow: 164 },
  { division: "10", headerRow: 165, startRow: 166, endRow: 189 },
  { division: "11", headerRow: 190, startRow: 191, endRow: 199 },
  { division: "12", headerRow: 200, startRow: 201, endRow: 211 },
  { division: "13", headerRow: 212, startRow: 213, endRow: 219 },
  { division: "14", headerRow: 220, startRow: 221, endRow: 226 },
  { division: "21", headerRow: 227, startRow: 228, endRow: 231 },
  { division: "22", headerRow: 232, startRow: 233, endRow: 238 },
  { division: "23", headerRow: 239, startRow: 240, endRow: 242 },
  { division: "26", headerRow: 243, startRow: 244, endRow: 250 },
  { division: "27", headerRow: 251, startRow: 252, endRow: 255 },
  { division: "28", headerRow: 256, startRow: 257, endRow: 262 },
  { division: "31", headerRow: 263, startRow: 264, endRow: 270 },
  { division: "32", headerRow: 271, startRow: 272, endRow: 291 },
  { division: "33", headerRow: 292, startRow: 293, endRow: 304 },
  { division: "50", headerRow: 305, startRow: 306, endRow: 315 },
  { division: "80", headerRow: 316, startRow: 317, endRow: 330 }
];

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
  rowEl.row.push(newCell);
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

// ─── MAIN EXPORT FUNCTION (JSZip + fast-xml-parser) ─────────────────────────

export async function generateExcelWorkbook(
  rows: ProcessedTakeoffRow[],
  projectMetadata: Project | null | undefined,
  columnDefs: ColumnDefinition[],
  layoutConfig?: DivisionLayout[] | null,
  templateBuffer?: ArrayBuffer | null
): Promise<Blob> {
  // ── PHASE 1: ZIP Open + XML Extraction ──────────────────────────────────────

  let buffer: ArrayBuffer;
  if (templateBuffer) {
    buffer = templateBuffer;
  } else {
    const response = await fetch("/templates/Company_Estimate_Template.xlsx");
    if (!response.ok) {
      throw new Error(`Failed to load corporate template Company_Estimate_Template.xlsx (Status: ${response.status})`);
    }
    buffer = await response.arrayBuffer();
  }

  const zip = await JSZip.loadAsync(buffer);

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
    const cellType = cellEl[":@"]?.["@_t"];
    const rawValue = getCellTextValue(cellEl);
    if (cellType === "s" && rawValue) {
      // Shared string index
      const idx = parseInt(rawValue, 10);
      return sharedStrings[idx] || "";
    }
    return rawValue;
  }

  const divisions = JSON.parse(
    JSON.stringify(layoutConfig || DEFAULT_LAYOUT_CONFIG)
  ) as DivisionLayout[];
  let rowShift = 0;
  const insertionsByDivision: Record<string, number> = {};

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
        prepopulatedRowsMap[codeStr] = r;
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

        // Description (D)
        const descCell = getOrCreateCell(rowEl, "D", rIdx, getStyleFromRow(rowEl, "D"));
        setCellInlineString(descCell, row.description || "");

        // Quantity (F)
        const qtyCell = getOrCreateCell(rowEl, "F", rIdx, getStyleFromRow(rowEl, "F"));
        setCellValue(qtyCell, Number(row.matchedQty) || 0);

        // UOM (G)
        const uomCell = getOrCreateCell(rowEl, "G", rIdx, getStyleFromRow(rowEl, "G"));
        setCellInlineString(uomCell, row.uom || "");

        // Unit Price (H)
        const priceCell = getOrCreateCell(rowEl, "H", rIdx, getStyleFromRow(rowEl, "H"));
        setCellValue(priceCell, Number(row.unitPrice) || 0);

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

  const subtotalRowIdx = 331 + rowShift;

  // Subtotal formula
  const subtotalRowEl = findRowElement(sheetDataChildren, subtotalRowIdx);
  if (subtotalRowEl) {
    const iCell = findCellInRow(subtotalRowEl, "I");
    if (iCell) setCellFormula(iCell, `SUM(I10:I${subtotalRowIdx - 1})`);
  }

  // Modifier rows (subtotal + 2 through subtotal + 8)
  for (let offset = 2; offset <= 8; offset++) {
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

  // Grand Total row
  const totalRowIdx = subtotalRowIdx + 10;
  const totalRowEl = findRowElement(sheetDataChildren, totalRowIdx);
  if (totalRowEl) {
    const iTotal = findCellInRow(totalRowEl, "I");
    if (iTotal) setCellFormula(iTotal, `SUM(I${subtotalRowIdx}:I${subtotalRowIdx + 9})`);

    const jTotal = findCellInRow(totalRowEl, "J");
    if (jTotal) setCellFormula(jTotal, `IF($J$8=0, 0, I${totalRowIdx}/$J$8)`);

    const kTotal = findCellInRow(totalRowEl, "K");
    if (kTotal) setCellFormula(kTotal, `IF($K$8=0, 0, I${totalRowIdx}/$K$8)`);

    const pTotal = findCellInRow(totalRowEl, "P");
    if (pTotal) setCellFormula(pTotal, `SUM(P10:P${totalRowIdx - 1})`);
  }

  // Reconciliation rows
  const reconStartRow = 346 + rowShift;

  // Row 346: "Totals from Column E"
  const reconRow1 = findRowElement(sheetDataChildren, reconStartRow);
  if (reconRow1) {
    const eRecon1 = findCellInRow(reconRow1, "E");
    if (eRecon1) setCellFormula(eRecon1, `SUM(E10:E${reconStartRow - 1})`);
  }

  // Row 347: "Contingency, Insurance and Fee"
  const reconRow2 = findRowElement(sheetDataChildren, reconStartRow + 1);
  if (reconRow2) {
    const eRecon2 = findCellInRow(reconRow2, "E");
    if (eRecon2) setCellFormula(eRecon2, `SUM(I${subtotalRowIdx + 1}:I${subtotalRowIdx + 9})`);

    const oRecon2 = findCellInRow(reconRow2, "O");
    if (oRecon2) setCellFormula(oRecon2, `I${totalRowIdx}-P${totalRowIdx}`);

    const pRecon2 = findCellInRow(reconRow2, "P");
    if (pRecon2) setCellFormula(pRecon2, `O${reconStartRow + 1}/P${totalRowIdx}`);
  }

  // Row 348: "Total"
  const reconRow3 = findRowElement(sheetDataChildren, reconStartRow + 2);
  if (reconRow3) {
    const eRecon3 = findCellInRow(reconRow3, "E");
    if (eRecon3) setCellFormula(eRecon3, `SUM(E${reconStartRow}:E${reconStartRow + 1})`);
  }

  // Row 349: "Equals Totals from Column I"
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

  // ── PHASE 3: Metadata Updates + ZIP Write ──────────────────────────────────

  const originalDivisions = layoutConfig || DEFAULT_LAYOUT_CONFIG;
  const shiftRow = buildRowShifter(originalDivisions, insertionsByDivision);

  // 3a: Update AutoFilter range
  step4Xml = step4Xml.replace(
    /(<autoFilter[^>]*ref=")[^"]+(")/,
    `$1A9:K${330 + rowShift}$2`
  );

  // 3a: Update Dimension
  step4Xml = step4Xml.replace(
    /(<dimension[^>]*ref=")[^"]+(")/,
    `$1B1:U${349 + rowShift}$2`
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
        if (origRow > 330) {
          return `${prefix}${origRow + rowShift}${suffix}`;
        }
        return `${prefix}${rowStr}${suffix}`;
      }
    );
  }

  // 3d: Cross-sheet formula row shifting + #REF! fix
  if (rowShift > 0) {
    const crossSheetNames = [
      "COVER", "STEP 2 - GCs", "STEP 3 - SITE OPS", "PER DIEM", "Budget Line Items"
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
        // Also handle #REF! for Budget Line Items even without STEP 4 refs
        if (sheetName === "Budget Line Items" && sheetXml?.includes("#REF!")) {
          sheetXml = sheetXml.replace(/<f>[^<]*#REF![^<]*<\/f>/g, "");
          zip.file(`xl/${sheetFile}`, sheetXml);
        }
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

      // Fix #REF! formulas (pre-existing in Budget Line Items)
      if (sheetName === "Budget Line Items" && sheetXml.includes("#REF!")) {
        sheetXml = sheetXml.replace(/<f>[^<]*#REF![^<]*<\/f>/g, "");
      }

      zip.file(`xl/${sheetFile}`, sheetXml);
    }
  } else {
    // Even without row shift, fix #REF! in Budget Line Items
    try {
      const bliFile = resolveSheetFile(wbXml, relsXml, "Budget Line Items");
      let bliXml = await zip.file(`xl/${bliFile}`)?.async("string");
      if (bliXml && bliXml.includes("#REF!")) {
        bliXml = bliXml.replace(/<f>[^<]*#REF![^<]*<\/f>/g, "");
        zip.file(`xl/${bliFile}`, bliXml);
      }
    } catch { /* Budget Line Items not found, skip */ }
  }

  // 3e: Write modified files to ZIP
  zip.file(`xl/${step4File}`, step4Xml);
  zip.file(`xl/${step1File}`, step1Xml);
  zip.file("xl/workbook.xml", wbXml);
  zip.file("xl/_rels/workbook.xml.rels", relsXml);

  // Generate output
  const outBuffer = await zip.generateAsync({ type: "arraybuffer" });
  return new Blob([outBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

