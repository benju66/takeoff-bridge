import { ProcessedTakeoffRow, ColumnDefinition } from "@/types";
import { Project } from "@/types/db";
import { GL_RATE, FEE_RATE } from "./constants";
import { escapeCSVField } from "./exportUtils";
import ExcelJS from "exceljs";

// Re-export for backward compatibility
export { getColumnLetter } from "./exportUtils";

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
    const generalLiability = subtotal * GL_RATE;
    const fee = subtotal * FEE_RATE;

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
    const generalLiability = subtotal * GL_RATE;
    const fee = subtotal * FEE_RATE;

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

  // Retrieve worksheet "STEP 1 - PROJECT DATA" and update project metadata
  const projectDataSheet = workbook.getWorksheet("STEP 1 - PROJECT DATA");
  if (projectDataSheet && projectMetadata) {
    // Project Name
    const nameCell = projectDataSheet.getCell('D5');
    if (nameCell) nameCell.value = projectMetadata.name || "";

    // Location / Address
    const locCell = projectDataSheet.getCell('D8');
    if (locCell) locCell.value = projectMetadata.location || "";

    // Bid Date
    const dateCell = projectDataSheet.getCell('G9');
    if (dateCell) dateCell.value = projectMetadata.bidDate || "";

    // Expected Start & Finish
    const startCell = projectDataSheet.getCell('D10');
    if (startCell) startCell.value = projectMetadata.expectedStart || "";

    const finishCell = projectDataSheet.getCell('D11');
    if (finishCell) finishCell.value = projectMetadata.expectedFinish || "";

    // Gross SF (Project Size)
    const sfCell = projectDataSheet.getCell('D12');
    if (sfCell) sfCell.value = Number(projectMetadata.squareFootage) || 0;

    // Unit Count (# of Units)
    const unitsCell = projectDataSheet.getCell('D58');
    if (unitsCell) unitsCell.value = Number(projectMetadata.unitCount) || 0;

    // Optional physical specs
    if (projectMetadata.buildingPerimeter !== undefined) {
      const cell = projectDataSheet.getCell('E63');
      if (cell) cell.value = Number(projectMetadata.buildingPerimeter) || 0;
    }
    if (projectMetadata.buildingFootprint !== undefined) {
      const cell = projectDataSheet.getCell('E65');
      if (cell) cell.value = Number(projectMetadata.buildingFootprint) || 0;
    }
    if (projectMetadata.podiumArea !== undefined) {
      const cell = projectDataSheet.getCell('E66');
      if (cell) cell.value = Number(projectMetadata.podiumArea) || 0;
    }
    if (projectMetadata.woodframedArea !== undefined) {
      const cell = projectDataSheet.getCell('E67');
      if (cell) cell.value = Number(projectMetadata.woodframedArea) || 0;
    }
    if (projectMetadata.levelsAbovePodium !== undefined) {
      const cell = projectDataSheet.getCell('E72');
      if (cell) cell.value = Number(projectMetadata.levelsAbovePodium) || 0;
    }
  }

  // Retrieve worksheet "STEP 4 - ESTIMATE"
  const worksheet = workbook.getWorksheet("STEP 4 - ESTIMATE");
  if (!worksheet) {
    throw new Error('Worksheet "STEP 4 - ESTIMATE" not found in the template');
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

  // Scan worksheet to locate SUBTOTAL row and build a map of pre-populated item row indexes
  let subtotalRowIdx = -1;
  const prepopulatedRowsMap: Record<string, number> = {}; // itemCode -> rowNumber

  const maxRow = worksheet.actualRowCount || 350;
  for (let r = 10; r <= maxRow + 50; r++) {
    const cellH = worksheet.getCell(`H${r}`);
    if (cellH && cellH.value) {
      const valStr = String(cellH.value).trim();
      if (valStr.toUpperCase() === "SUBTOTAL") {
        subtotalRowIdx = r;
        break;
      }
    }

    const cellC = worksheet.getCell(`C${r}`);
    if (cellC && cellC.value) {
      const codeStr = String(cellC.value).trim();
      if (codeStr && codeStr.length >= 6 && codeStr.includes("-")) {
        prepopulatedRowsMap[codeStr] = r;
      }
    }
  }

  if (subtotalRowIdx === -1) {
    throw new Error('Failed to find "SUBTOTAL" row in "STEP 4 - ESTIMATE" sheet');
  }

  const unmappedRows: ProcessedTakeoffRow[] = [];

  // Update pre-populated rows
  for (const row of rows) {
    const code = (row.itemId || "").trim();
    const qty = Number(row.matchedQty) || 0;
    const price = Number(row.unitPrice) || 0;

    const rIdx = prepopulatedRowsMap[code];
    if (rIdx !== undefined) {
      const excelRow = worksheet.getRow(rIdx);
      
      excelRow.getCell(colIndexMap["description"] || 4).value = row.description || "";
      
      const qtyCell = excelRow.getCell(colIndexMap["matchedQty"] || 6);
      qtyCell.value = qty;
      qtyCell.numFmt = '#,##0.00';
      qtyCell.alignment = { horizontal: 'right' };

      const uomCell = excelRow.getCell(colIndexMap["uom"] || 7);
      uomCell.value = row.uom || "";
      uomCell.alignment = { horizontal: 'center' };

      const priceCell = excelRow.getCell(colIndexMap["unitPrice"] || 8);
      priceCell.value = price;
      priceCell.numFmt = '$#,##0.00';
      priceCell.alignment = { horizontal: 'right' };

      for (const col of columnDefs) {
        if (col.type === 'custom') {
          const colIdx = colIndexMap[col.id];
          if (colIdx) {
            excelRow.getCell(colIdx).value = row.customFields?.[col.id] ?? "";
          }
        }
      }
    } else {
      unmappedRows.push(row);
    }
  }

  // Copy styles helper
  const baseGCsRow = worksheet.getRow(12);

  function copyCellStyles(fromCell: ExcelJS.Cell, toCell: ExcelJS.Cell) {
    if (fromCell.font) toCell.font = JSON.parse(JSON.stringify(fromCell.font));
    if (fromCell.fill) toCell.fill = JSON.parse(JSON.stringify(fromCell.fill));
    if (fromCell.border) toCell.border = JSON.parse(JSON.stringify(fromCell.border));
    if (fromCell.alignment) toCell.alignment = JSON.parse(JSON.stringify(fromCell.alignment));
    if (fromCell.numFmt) toCell.numFmt = fromCell.numFmt;
  }

  // Insert unmapped/manual rows above the SUBTOTAL row
  let insertedCount = 0;
  for (const row of unmappedRows) {
    worksheet.insertRow(subtotalRowIdx, []);
    const excelRow = worksheet.getRow(subtotalRowIdx);

    // Apply baseline styles cell-by-cell from Row 12
    for (let c = 1; c <= 20; c++) {
      const fromCell = baseGCsRow.getCell(c);
      const toCell = excelRow.getCell(c);
      copyCellStyles(fromCell, toCell);
    }

    const qty = Number(row.matchedQty) || 0;
    const price = Number(row.unitPrice) || 0;

    excelRow.getCell(colIndexMap["costType"] || 1).value = row.costType || "TI";
    excelRow.getCell(colIndexMap["costType"] || 1).alignment = { horizontal: 'center' };

    excelRow.getCell(colIndexMap["itemId"] || 3).value = row.itemId || "";
    excelRow.getCell(colIndexMap["itemId"] || 3).alignment = { horizontal: 'center' };

    excelRow.getCell(colIndexMap["description"] || 4).value = row.description || "";

    const qtyCell = excelRow.getCell(colIndexMap["matchedQty"] || 6);
    qtyCell.value = qty;
    qtyCell.numFmt = '#,##0.00';
    qtyCell.alignment = { horizontal: 'right' };

    const uomCell = excelRow.getCell(colIndexMap["uom"] || 7);
    uomCell.value = row.uom || "";
    uomCell.alignment = { horizontal: 'center' };

    const priceCell = excelRow.getCell(colIndexMap["unitPrice"] || 8);
    priceCell.value = price;
    priceCell.numFmt = '$#,##0.00';
    priceCell.alignment = { horizontal: 'right' };

    const totalCell = excelRow.getCell(colIndexMap["total"] || 9);
    totalCell.value = { formula: `IF(ISNUMBER(F${subtotalRowIdx}), F${subtotalRowIdx} * H${subtotalRowIdx}, 0)` };
    totalCell.numFmt = '$#,##0.00';
    totalCell.alignment = { horizontal: 'right' };

    const cpuCell = excelRow.getCell(colIndexMap["costPerUnit"] || 10);
    cpuCell.value = { formula: `IF($J$8=0, 0, I${subtotalRowIdx}/$J$8)` };
    cpuCell.numFmt = '$#,##0.00';
    cpuCell.alignment = { horizontal: 'right' };

    const cpsfCell = excelRow.getCell(colIndexMap["costPerSf"] || 11);
    cpsfCell.value = { formula: `IF($K$8=0, 0, I${subtotalRowIdx}/$K$8)` };
    cpsfCell.numFmt = '$#,##0.00';
    cpsfCell.alignment = { horizontal: 'right' };

    for (const col of columnDefs) {
      if (col.type === 'custom') {
        const colIdx = colIndexMap[col.id];
        if (colIdx) {
          excelRow.getCell(colIdx).value = row.customFields?.[col.id] ?? "";
        }
      }
    }

    subtotalRowIdx++;
    insertedCount++;
  }

  // Update SUBTOTAL formula (SUM from Row 10 to row before the new subtotal)
  const subtotalCell = worksheet.getCell(`I${subtotalRowIdx}`);
  subtotalCell.value = { formula: `SUM(I10:I${subtotalRowIdx - 1})` };

  // Rewrite shifted formulas to match their new row coordinates
  if (insertedCount > 0) {
    for (let offset = 2; offset <= 8; offset++) {
      const r = subtotalRowIdx + offset;
      const excelRow = worksheet.getRow(r);
      excelRow.getCell(9).value = { formula: `F${r}*$I$${subtotalRowIdx}` };
      excelRow.getCell(10).value = { formula: `IF($J$8=0, 0, I${r}/$J$8)` };
      excelRow.getCell(11).value = { formula: `IF($K$8=0, 0, I${r}/$K$8)` };
    }

    // Rewrite Grand Total row formulas
    const totalRowIdx = subtotalRowIdx + 10;
    const totalRow = worksheet.getRow(totalRowIdx);
    totalRow.getCell(9).value = { formula: `SUM(I${subtotalRowIdx}:I${subtotalRowIdx + 9})` };
    totalRow.getCell(10).value = { formula: `IF($J$8=0, 0, I${totalRowIdx}/$J$8)` };
    totalRow.getCell(11).value = { formula: `IF($K$8=0, 0, I${totalRowIdx}/$K$8)` };
  }

  // Write to buffer
  const outBuffer = await workbook.xlsx.writeBuffer();
  
  // Return as Blob
  return new Blob([outBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
}


