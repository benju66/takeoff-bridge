import { ProcessedTakeoffRow, ColumnDefinition } from "@/types";
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
 * Safely converts a 1-based column index to an Excel column letter (e.g. 1 -> A, 27 -> AA).
 */
export function getColumnLetter(colIndex: number): string {
  let temp = colIndex;
  let letter = "";
  while (temp > 0) {
    const modulo = (temp - 1) % 26;
    letter = String.fromCharCode(65 + modulo) + letter;
    temp = Math.floor((temp - modulo) / 26);
  }
  return letter;
}

/**
 * Generates a clean Excel payload CSV string.
 * Formats columns dynamically to match user's custom and default workspace column definitions.
 * Incorporates standard markup layers (General Liability 1%, Contractor Fee 5%) cleanly at the bottom.
 */
export function generateExcelPayload(rows: ProcessedTakeoffRow[], columnDefs: ColumnDefinition[]): string {
  const csvLines: string[] = [];

  // Populate dynamic headers based on columnDefs
  const headers = columnDefs.map((col) => {
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
    const rowValues = columnDefs.map((col) => {
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

  // Calculate dynamic subtotal and append standard markup layers
  const subtotal = rows.reduce((sum, r) => sum + r.matchedQty * r.unitPrice, 0);
  if (subtotal > 0) {
    const generalLiability = subtotal * 0.01;
    const fee = subtotal * 0.05;

    const glRow = columnDefs.map((col) => {
      if (col.type === "default") {
        switch (col.id) {
          case "costType":
            return "TI";
          case "itemId":
            return "";
          case "description":
            return "General Liability (1%)";
          case "matchedQty":
            return 1;
          case "uom":
            return "LS";
          case "unitPrice":
            return generalLiability.toFixed(2);
          case "total":
            return generalLiability.toFixed(2);
          default:
            return "";
        }
      } else {
        return "";
      }
    });
    csvLines.push(glRow.map(escapeCSVField).join(","));

    const feeRow = columnDefs.map((col) => {
      if (col.type === "default") {
        switch (col.id) {
          case "costType":
            return "TI";
          case "itemId":
            return "";
          case "description":
            return "Fee (5%)";
          case "matchedQty":
            return 1;
          case "uom":
            return "LS";
          case "unitPrice":
            return fee.toFixed(2);
          case "total":
            return fee.toFixed(2);
          default:
            return "";
        }
      } else {
        return "";
      }
    });
    csvLines.push(feeRow.map(escapeCSVField).join(","));
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
  const subtotal = rows.reduce((sum, r) => sum + r.matchedQty * r.unitPrice, 0);
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
  projectMetadata: Project | null | undefined,
  columnDefs: ColumnDefinition[]
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
        // Clear this placeholder row cell values while preserving styles to prevent layout gaps
        worksheet.getRow(r).eachCell({ includeEmpty: true }, (cell) => {
          cell.value = null;
        });
      } else if (valStr.includes("Fee (5%)") || valStr.includes("Contractor Fee")) {
        // Capture cell styles
        feeStyle = {
          font: worksheet.getRow(r).getCell('D').font,
          fill: worksheet.getRow(r).getCell('D').fill,
          alignment: worksheet.getRow(r).getCell('D').alignment,
        };
        // Clear this placeholder row cell values while preserving styles
        worksheet.getRow(r).eachCell({ includeEmpty: true }, (cell) => {
          cell.value = null;
        });
      }
    }
  }

  // Determine spreadsheet column indices for each column definition
  const colIndexMap: Record<string, number> = {};
  const defaultColPositions: Record<string, number> = {
    costType: 1,      // A
    itemId: 3,        // C
    description: 4,   // D
    matchedQty: 6,    // F
    uom: 7,           // G
    unitPrice: 8,     // H
    total: 9,         // I
    costPerUnit: 10,  // J
    costPerSf: 11     // K
  };

  let nextCustomColIdx = 12; // Columns L, M, N, ...
  for (const col of columnDefs) {
    if (col.type === 'default') {
      if (defaultColPositions[col.id] !== undefined) {
        colIndexMap[col.id] = defaultColPositions[col.id];
      } else {
        colIndexMap[col.id] = nextCustomColIdx++;
      }
    } else {
      colIndexMap[col.id] = nextCustomColIdx++;
    }
  }

  // Headers Override: Write active column def header text values directly into worksheet.getRow(9)
  const headerRow = worksheet.getRow(9);
  for (const col of columnDefs) {
    const colIdx = colIndexMap[col.id];
    if (colIdx) {
      headerRow.getCell(colIdx).value = col.header;
    }
  }

  // Write active estimate grid rows starting at Row 10
  let currentRawRow = 10;
  let subtotal = 0;

  for (const row of rows) {
    const qty = Number(row.matchedQty) || 0;
    const price = Number(row.unitPrice) || 0;
    const total = qty * price;
    subtotal += total;

    const excelRow = worksheet.getRow(currentRawRow);
    
    for (const col of columnDefs) {
      const colIdx = colIndexMap[col.id];
      if (!colIdx) continue;

      if (col.type === 'default') {
        switch (col.id) {
          case "costType":
            excelRow.getCell(colIdx).value = row.costType || "TI";
            excelRow.getCell(colIdx).alignment = { horizontal: 'center' };
            break;
          case "itemId":
            excelRow.getCell(colIdx).value = row.itemId || "";
            excelRow.getCell(colIdx).alignment = { horizontal: 'center' };
            break;
          case "description":
            excelRow.getCell(colIdx).value = row.description || "";
            break;
          case "matchedQty":
            excelRow.getCell(colIdx).value = qty;
            excelRow.getCell(colIdx).numFmt = '#,##0.00';
            excelRow.getCell(colIdx).alignment = { horizontal: 'right' };
            break;
          case "uom":
            excelRow.getCell(colIdx).value = row.uom || "";
            excelRow.getCell(colIdx).alignment = { horizontal: 'center' };
            break;
          case "unitPrice":
            excelRow.getCell(colIdx).value = price;
            excelRow.getCell(colIdx).numFmt = '$#,##0.00';
            excelRow.getCell(colIdx).alignment = { horizontal: 'right' };
            break;
          case "total":
            const qtyLetter = getColumnLetter(colIndexMap["matchedQty"] || 6);
            const priceLetter = getColumnLetter(colIndexMap["unitPrice"] || 8);
            excelRow.getCell(colIdx).value = { formula: `${qtyLetter}${currentRawRow}*${priceLetter}${currentRawRow}` };
            excelRow.getCell(colIdx).numFmt = '$#,##0.00';
            excelRow.getCell(colIdx).alignment = { horizontal: 'right' };
            break;
          case "costPerUnit":
            const cpu = total / (projectMetadata?.unitCount || 1);
            excelRow.getCell(colIdx).value = cpu;
            excelRow.getCell(colIdx).numFmt = '$#,##0.00';
            excelRow.getCell(colIdx).alignment = { horizontal: 'right' };
            break;
          case "costPerSf":
            const cpsf = total / (projectMetadata?.squareFootage || 1);
            excelRow.getCell(colIdx).value = cpsf;
            excelRow.getCell(colIdx).numFmt = '$#,##0.00';
            excelRow.getCell(colIdx).alignment = { horizontal: 'right' };
            break;
        }
      } else {
        // Custom Column
        excelRow.getCell(colIdx).value = row.customFields?.[col.id] ?? "";
      }
    }

    currentRawRow++;
  }

  // Determine the exact end row of the inserted data block
  const endRowIdx = currentRawRow - 1;

  // Cleanly write visual spacing rows step-by-step
  for (let i = 0; i < 2; i++) {
    const spacerRow = worksheet.getRow(currentRawRow);
    spacerRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.value = null;
    });
    currentRawRow++;
  }

  // Append dynamic tracking rows at the bottom
  const generalLiability = subtotal * 0.01;
  const fee = subtotal * 0.05;
  const totalColLetter = getColumnLetter(colIndexMap["total"] || 9);

  // 1. General Liability Row (defensive clearing first)
  const glRow = worksheet.getRow(currentRawRow);
  glRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.value = null;
  });
  
  glRow.getCell(colIndexMap["costType"] || 1).value = "TI";
  glRow.getCell(colIndexMap["description"] || 4).value = "General Liability (1%)";
  glRow.getCell(colIndexMap["matchedQty"] || 6).value = 1;
  glRow.getCell(colIndexMap["uom"] || 7).value = "LS";
  glRow.getCell(colIndexMap["unitPrice"] || 8).value = generalLiability;
  glRow.getCell(colIndexMap["total"] || 9).value = { formula: `SUM(${totalColLetter}10:${totalColLetter}${endRowIdx})*0.01` };

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

  const glTotalCell = glRow.getCell(colIndexMap["total"] || 9);
  glTotalCell.numFmt = '$#,##0.00';
  glTotalCell.alignment = { horizontal: 'right' };

  const glQtyCell = glRow.getCell(colIndexMap["matchedQty"] || 6);
  glQtyCell.numFmt = '#,##0.00';

  const glPriceCell = glRow.getCell(colIndexMap["unitPrice"] || 8);
  glPriceCell.numFmt = '$#,##0.00';

  glRow.getCell(colIndexMap["costType"] || 1).alignment = { horizontal: 'center' };
  glRow.getCell(colIndexMap["uom"] || 7).alignment = { horizontal: 'center' };

  currentRawRow++;

  // 2. Contractor Fee Row (defensive clearing first)
  const feeRow = worksheet.getRow(currentRawRow);
  feeRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.value = null;
  });

  feeRow.getCell(colIndexMap["costType"] || 1).value = "TI";
  feeRow.getCell(colIndexMap["description"] || 4).value = "Fee (5%)";
  feeRow.getCell(colIndexMap["matchedQty"] || 6).value = 1;
  feeRow.getCell(colIndexMap["uom"] || 7).value = "LS";
  feeRow.getCell(colIndexMap["unitPrice"] || 8).value = fee;
  feeRow.getCell(colIndexMap["total"] || 9).value = { formula: `SUM(${totalColLetter}10:${totalColLetter}${endRowIdx})*0.05` };

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

  const feeTotalCell = feeRow.getCell(colIndexMap["total"] || 9);
  feeTotalCell.numFmt = '$#,##0.00';
  feeTotalCell.alignment = { horizontal: 'right' };

  const feeQtyCell = feeRow.getCell(colIndexMap["matchedQty"] || 6);
  feeQtyCell.numFmt = '#,##0.00';

  const feePriceCell = feeRow.getCell(colIndexMap["unitPrice"] || 8);
  feePriceCell.numFmt = '$#,##0.00';

  feeRow.getCell(colIndexMap["costType"] || 1).alignment = { horizontal: 'center' };
  feeRow.getCell(colIndexMap["uom"] || 7).alignment = { horizontal: 'center' };

  // Cleanly write visual spacing rows step-by-step
  for (let i = 0; i < 2; i++) {
    const spacerRow = worksheet.getRow(currentRawRow);
    spacerRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.value = null;
    });
    currentRawRow++;
  }

  // 3. Grand Total Row (defensive clearing first)
  const grandTotalRow = worksheet.getRow(currentRawRow);
  grandTotalRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.value = null;
  });

  grandTotalRow.getCell(colIndexMap["costType"] || 1).value = "TI";
  grandTotalRow.getCell(colIndexMap["description"] || 4).value = "TOTAL ESTIMATED COST";
  grandTotalRow.getCell(colIndexMap["total"] || 9).value = { formula: `SUM(${totalColLetter}10:${totalColLetter}${currentRawRow - 1})` };

  grandTotalRow.eachCell((cell) => {
    cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10B981' } };
  });

  const grandTotalCell = grandTotalRow.getCell(colIndexMap["total"] || 9);
  grandTotalCell.numFmt = '$#,##0.00';
  grandTotalCell.alignment = { horizontal: 'right' };
  grandTotalRow.getCell(colIndexMap["costType"] || 1).alignment = { horizontal: 'center' };

  // Write to buffer
  const outBuffer = await workbook.xlsx.writeBuffer();
  
  // Return as Blob
  return new Blob([outBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
}


