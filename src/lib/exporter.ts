import { ProcessedTakeoffRow } from "@/types";
import { Project } from "@/types/db";
import ExcelJS from "exceljs";


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
 * Formats columns to match the company spreadsheet's Step 4 worksheet columns:
 * Columns: [ "TI", "", itemId, description, "", matchedQty, uom, unitPrice, total ]
 * Incorporates standard markup layers (General Liability 1%, Contractor Fee 5%) cleanly at the bottom.
 */
export function generateExcelPayload(rows: ProcessedTakeoffRow[]): string {
  const csvLines: string[] = [];

  // Populate each data row dynamically using active user modified grid values
  for (const row of rows) {
    const calculatedTotal = row.matchedQty * row.unitPrice;
    const columns = [
      "TI",                       // Literal "TI"
      "",                         // Blank placeholder
      row.itemId,                 // Active user Suffix Code
      row.description,            // Active user Description
      "",                         // Blank placeholder
      row.matchedQty,             // Active user Quantity
      row.uom,                    // Target UOM
      row.unitPrice,              // Active user Unit Price
      calculatedTotal             // Recalculated dynamic Total
    ];

    csvLines.push(columns.map(escapeCSVField).join(","));
  }

  // Calculate dynamic subtotal and append standard markup layers
  const subtotal = rows.reduce((sum, r) => sum + (r.matchedQty * r.unitPrice), 0);
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

  // Calculate subtotal and append standard markup layers dynamically
  const subtotal = rows.reduce((sum, r) => sum + (r.matchedQty * r.unitPrice), 0);
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

  // Ensure Windows line endings (\r\n) for seamless ingestion
  return csvLines.join("\r\n");
}

/**
 * Generates an Excel Workbook from a company template file, injects values
 * into "STEP 4 - ESTIMATE" sheet, recalculates markups, and returns a downloadable Blob.
 */
export async function generateExcelWorkbook(
  rows: ProcessedTakeoffRow[],
  projectMetadata: Project | null | undefined
): Promise<Blob> {
  // Fetch template file
  const response = await fetch('/templates/Company_Estimate_Template.xlsx');
  if (!response.ok) {
    throw new Error(`Failed to load corporate template Company_Estimate_Template.xlsx (Status: ${response.status})`);
  }
  const buffer = await response.arrayBuffer();

  // Load into ExcelJS Workbook
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  // Retrieve worksheet "STEP 4 - ESTIMATE"
  const worksheet = workbook.getWorksheet("STEP 4 - ESTIMATE");
  if (!worksheet) {
    throw new Error('Worksheet "STEP 4 - ESTIMATE" not found in the template');
  }

  // Update Project Metadata if metadata is available
  if (projectMetadata) {
    const projNameCell = worksheet.getCell('B4');
    if (projNameCell) projNameCell.value = projectMetadata.name || "";
    
    const locCell = worksheet.getCell('F4');
    if (locCell) locCell.value = projectMetadata.location || "";
    
    const dateCell = worksheet.getCell('I4');
    if (dateCell) dateCell.value = projectMetadata.bidDate || "";
  }

  // Scan worksheet to find pre-existing tracking rows (General Liability and Fee)
  // in Column D so we can extract their styles and then remove/clear them.
  let glStyle: Partial<ExcelJS.Style> | null = null;
  let feeStyle: Partial<ExcelJS.Style> | null = null;
  
  // We scan from Row 10 to 100 to locate tracking row placeholders
  for (let r = 10; r <= 100; r++) {
    const cellD = worksheet.getCell(`D${r}`);
    if (cellD && cellD.value) {
      const valStr = String(cellD.value).trim();
      if (valStr.includes("General Liability")) {
        // Capture cell styles
        glStyle = {
          font: worksheet.getRow(r).getCell('D').font,
          fill: worksheet.getRow(r).getCell('D').fill,
          alignment: worksheet.getRow(r).getCell('D').alignment,
        };
        // Clear this placeholder row to keep data region clean
        worksheet.getRow(r).values = [];
      } else if (valStr.includes("Fee (5%)") || valStr.includes("Contractor Fee")) {
        // Capture cell styles
        feeStyle = {
          font: worksheet.getRow(r).getCell('D').font,
          fill: worksheet.getRow(r).getCell('D').fill,
          alignment: worksheet.getRow(r).getCell('D').alignment,
        };
        // Clear this placeholder row
        worksheet.getRow(r).values = [];
      }
    }
  }

  // Write active estimate grid rows starting at Row 10
  let currentRawRow = 10;
  
  // Calculate Subtotal dynamically
  let subtotal = 0;

  for (const row of rows) {
    const qty = Number(row.matchedQty) || 0;
    const price = Number(row.unitPrice) || 0;
    const total = qty * price;
    subtotal += total;

    const excelRow = worksheet.getRow(currentRawRow);
    excelRow.getCell('A').value = "TI";                      // Column A
    excelRow.getCell('B').value = "";                        // Column B
    excelRow.getCell('C').value = row.itemId || "";          // Column C
    excelRow.getCell('D').value = row.description || "";     // Column D
    excelRow.getCell('E').value = "";                        // Column E
    excelRow.getCell('F').value = qty;                       // Column F
    excelRow.getCell('G').value = row.uom || "";             // Column G
    excelRow.getCell('H').value = price;                     // Column H
    excelRow.getCell('I').value = total;                     // Column I

    // Add formats/alignments
    excelRow.getCell('F').numFmt = '#,##0.00';
    excelRow.getCell('H').numFmt = '$#,##0.00';
    excelRow.getCell('I').numFmt = '$#,##0.00';
    
    excelRow.getCell('A').alignment = { horizontal: 'center' };
    excelRow.getCell('C').alignment = { horizontal: 'center' };
    excelRow.getCell('F').alignment = { horizontal: 'right' };
    excelRow.getCell('G').alignment = { horizontal: 'center' };
    excelRow.getCell('H').alignment = { horizontal: 'right' };
    excelRow.getCell('I').alignment = { horizontal: 'right' };

    currentRawRow++;
  }

  // Let's add two blank rows for visual spacing
  currentRawRow += 2;

  // Append dynamic tracking rows at the bottom
  const generalLiability = subtotal * 0.01;
  const fee = subtotal * 0.05;

  // 1. General Liability Row
  const glRow = worksheet.getRow(currentRawRow);
  glRow.getCell('A').value = "TI";
  glRow.getCell('B').value = "";
  glRow.getCell('C').value = "";
  glRow.getCell('D').value = "General Liability (1%)";
  glRow.getCell('E').value = "";
  glRow.getCell('F').value = 1;
  glRow.getCell('G').value = "LS";
  glRow.getCell('H').value = generalLiability;
  glRow.getCell('I').value = generalLiability;

  // Apply original style or premium default
  glRow.eachCell((cell) => {
    if (glStyle) {
      if (glStyle.font) cell.font = glStyle.font;
      if (glStyle.fill) cell.fill = glStyle.fill;
      if (glStyle.alignment) cell.alignment = glStyle.alignment;
    } else {
      cell.font = { bold: true, color: { argb: 'FF2563EB' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
    }
  });
  glRow.getCell('I').numFmt = '$#,##0.00';
  glRow.getCell('H').numFmt = '$#,##0.00';
  glRow.getCell('F').numFmt = '#,##0.00';
  glRow.getCell('A').alignment = { horizontal: 'center' };
  glRow.getCell('G').alignment = { horizontal: 'center' };
  glRow.getCell('I').alignment = { horizontal: 'right' };

  currentRawRow++;

  // 2. Contractor Fee Row
  const feeRow = worksheet.getRow(currentRawRow);
  feeRow.getCell('A').value = "TI";
  feeRow.getCell('B').value = "";
  feeRow.getCell('C').value = "";
  feeRow.getCell('D').value = "Fee (5%)";
  feeRow.getCell('E').value = "";
  feeRow.getCell('F').value = 1;
  feeRow.getCell('G').value = "LS";
  feeRow.getCell('H').value = fee;
  feeRow.getCell('I').value = fee;

  feeRow.eachCell((cell) => {
    if (feeStyle) {
      if (feeStyle.font) cell.font = feeStyle.font;
      if (feeStyle.fill) cell.fill = feeStyle.fill;
      if (feeStyle.alignment) cell.alignment = feeStyle.alignment;
    } else {
      cell.font = { bold: true, color: { argb: 'FF4F46E5' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
    }
  });
  feeRow.getCell('I').numFmt = '$#,##0.00';
  feeRow.getCell('H').numFmt = '$#,##0.00';
  feeRow.getCell('F').numFmt = '#,##0.00';
  feeRow.getCell('A').alignment = { horizontal: 'center' };
  feeRow.getCell('G').alignment = { horizontal: 'center' };
  feeRow.getCell('I').alignment = { horizontal: 'right' };

  currentRawRow += 2;

  // 3. Grand Total Row
  const totalRowValue = subtotal + generalLiability + fee;
  const grandTotalRow = worksheet.getRow(currentRawRow);
  grandTotalRow.getCell('A').value = "TI";
  grandTotalRow.getCell('B').value = "";
  grandTotalRow.getCell('C').value = "";
  grandTotalRow.getCell('D').value = "TOTAL ESTIMATED COST";
  grandTotalRow.getCell('E').value = "";
  grandTotalRow.getCell('F').value = "";
  grandTotalRow.getCell('G').value = "";
  grandTotalRow.getCell('H').value = "";
  grandTotalRow.getCell('I').value = totalRowValue;

  grandTotalRow.eachCell((cell) => {
    cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10B981' } };
  });
  grandTotalRow.getCell('I').numFmt = '$#,##0.00';
  grandTotalRow.getCell('A').alignment = { horizontal: 'center' };
  grandTotalRow.getCell('I').alignment = { horizontal: 'right' };

  // Write to buffer
  const outBuffer = await workbook.xlsx.writeBuffer();
  
  // Return as Blob
  return new Blob([outBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
}

