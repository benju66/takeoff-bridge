import { ProcessedTakeoffRow } from "@/types";

/**
 * Safely escapes value fields for safe, compliant CSV ingestion.
 * Wraps values containing commas, quotes, or newlines in double quotes, doubling internal quotes.
 */
function escapeCSVField(val: unknown): string {
  if (val === undefined || val === null) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generates a clean Excel payload CSV string.
 * Formats columns to match the company spreadsheet's Step 4 worksheet columns with exact placeholders:
 * Columns: [ "TI", "", itemId, description, "", matchedQty, uom, unitPrice, total ]
 * Incorporates standard markup layers (General Liability 1%, Contractor Fee 5%) cleanly at the bottom.
 */
export function generateExcelPayload(rows: ProcessedTakeoffRow[]): string {
  const csvLines: string[] = [];

  // Populate each data row adhering strictly to the spreadsheet layout sequence
  for (const row of rows) {
    const columns = [
      "TI",                       // Literal "TI"
      "",                         // Blank placeholder
      row.itemId,                 // Suffix cost code
      row.description,            // Item description
      "",                         // Blank placeholder
      row.matchedQty,             // Extracted Qty matching UOM
      row.uom,                    // Target UOM
      row.unitPrice,              // Default Unit Price
      row.total                   // Multiplied Total Cost
    ];

    csvLines.push(columns.map(escapeCSVField).join(","));
  }

  // Calculate and append standard markup layers
  const subtotal = rows.reduce((sum, r) => sum + r.total, 0);
  if (subtotal > 0) {
    const generalLiability = subtotal * 0.01;
    const fee = subtotal * 0.05;

    const glColumns = [
      "TI",
      "",
      "",
      "General Liability (1%)",
      "",
      1,
      "LS",
      generalLiability.toFixed(2),
      generalLiability.toFixed(2)
    ];
    csvLines.push(glColumns.map(escapeCSVField).join(","));

    const feeColumns = [
      "TI",
      "",
      "",
      "Fee (5%)",
      "",
      1,
      "LS",
      fee.toFixed(2),
      fee.toFixed(2)
    ];
    csvLines.push(feeColumns.map(escapeCSVField).join(","));
  }

  // Use \r\n for universal Windows and Excel spreadsheet compliance
  return csvLines.join("\r\n");
}

/**
 * Groups fine-grained suffix costs into unified Procore parent codes and cost types,
 * summing the budget values and structuring exactly matching Procore's budget importer schema.
 * Columns: "Cost Code","Cost Type","Description","Original Budget"
 * Incorporates standard markup layers (General Liability 1%, Contractor Fee 5%) cleanly at the bottom.
 */
export function generateProcoreBudget(rows: ProcessedTakeoffRow[]): string {
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

    if (!groupings[groupKey]) {
      groupings[groupKey] = {
        parentCode,
        costType,
        descriptions: new Set<string>(),
        totalCost: 0
      };
    }

    groupings[groupKey].descriptions.add(row.description);
    groupings[groupKey].totalCost += row.total;
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

  // Calculate and append standard markup layers
  const subtotal = rows.reduce((sum, r) => sum + r.total, 0);
  if (subtotal > 0) {
    const generalLiability = subtotal * 0.01;
    const fee = subtotal * 0.05;

    csvLines.push([
      "1-10000.000",
      "O",
      "General Liability (1%)",
      generalLiability.toFixed(2)
    ].map(escapeCSVField).join(","));

    csvLines.push([
      "1-20000.000",
      "O",
      "Fee (5%)",
      fee.toFixed(2)
    ].map(escapeCSVField).join(","));
  }

  return csvLines.join("\r\n");
}
