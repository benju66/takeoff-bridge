import { describe, it, expect } from "vitest";
import { generateExcelWorkbook } from "../lib/exporter";
import type { ProcessedTakeoffRow, ColumnDefinition } from "@/types";
import type { Project } from "@/types/db";
import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import JSZip from "jszip";

// Layout coordinates seeded in template_config for Company_Estimate_Template.xlsx
const mockLayoutConfig = [
  { division: "01", headerRow: 10, startRow: 11, endRow: 14 },
  { division: "02", headerRow: 15, startRow: 16, endRow: 25 },
  { division: "03", headerRow: 26, startRow: 27, endRow: 52 },
  { division: "04", headerRow: 53, startRow: 54, endRow: 62 },
];

describe("Excel Export Integrity & Relative Shifting Engine", () => {
  const mockColumns: ColumnDefinition[] = [
    { id: "costType", header: "TYPE", type: "default" },
    { id: "itemId", header: "Code", type: "default" },
    { id: "description", header: "Description", type: "default" },
    { id: "matchedQty", header: "Quantity", type: "default" },
    { id: "uom", header: "Unit", type: "default" },
    { id: "unitPrice", header: "Rate", type: "default" },
    { id: "total", header: "Total", type: "default" },
  ];

  const mockProject: Project = {
    id: "project-1",
    name: "TDD Shifting Test Project",
    location: "Minneapolis, MN",
    squareFootage: 10000,
    unitCount: 100,
    bidDate: "2026-06-03",
    createdAt: new Date().toISOString(),
    constructionContingencyRate: 0.02,
    designContingencyRate: 0,
    buildersRiskRate: 0,
    specialInsuranceRate: 0,
    glInsuranceRate: 0.01,
    bondRate: 0,
    feeRate: 0.05,
    roundingRule: "none",
  };

  it("shifts coordinates and formulas correctly under Division 03 insertions", async () => {
    // Read the template file from the filesystem
    const templatePath = path.resolve(__dirname, "../../public/templates/Company_Estimate_Template.xlsx");
    const templateBuffer = fs.readFileSync(templatePath);

    // Mock rows: 
    // - 2 existing pre-populated rows in Division 03 (Concrete)
    // - 2 NEW/manual rows in Division 03 (Concrete) which will shift Division 04 and subsequent sections down.
    const mockRows: ProcessedTakeoffRow[] = [
      {
        id: "concrete-existing-1",
        classification: "Cast In-Place Concrete",
        itemId: "03-0000.001",
        procoreParentCode: "3-30000.000",
        procoreCode: "3-30000.000",
        description: "Existing Concrete Item 1",
        matchedQty: 150,
        uom: "CY",
        unitPrice: 120,
        total: 18000,
        isMapped: true,
        rawQuantities: [],
        costType: "M",
        source: "template",
      },
      {
        id: "concrete-existing-2",
        classification: "Footings",
        itemId: "03-0000.002",
        procoreParentCode: "3-30000.000",
        procoreCode: "3-30000.000",
        description: "Existing Concrete Item 2",
        matchedQty: 80,
        uom: "CY",
        unitPrice: 180,
        total: 14400,
        isMapped: true,
        rawQuantities: [],
        costType: "M",
        source: "template",
      },
      // Manual/unmapped rows (new insertion under Division 03)
      {
        id: "concrete-manual-1",
        classification: "Concrete Mesh",
        itemId: "03-2000.001",
        procoreParentCode: "3-30000.000",
        procoreCode: "",
        description: "Manual Rebar Mesh Item 1",
        matchedQty: 500,
        uom: "SF",
        unitPrice: 2.5,
        total: 1250,
        isMapped: true,
        rawQuantities: [],
        costType: "M",
        source: "manual",
      },
      {
        id: "concrete-manual-2",
        classification: "Concrete Vapor Barrier",
        itemId: "03-3000.002",
        procoreParentCode: "3-30000.000",
        procoreCode: "",
        description: "Manual Vapor Barrier Item 2",
        matchedQty: 500,
        uom: "SF",
        unitPrice: 1.5,
        total: 750,
        isMapped: true,
        rawQuantities: [],
        costType: "M",
        source: "manual",
      },
    ];

    // Trigger the Excel workbook generation with dynamic shifting parameters
    // Note: Cast the extra arguments to any if the current typescript signature doesn't support them yet.
    const blob = await (generateExcelWorkbook as any)(
      mockRows,
      mockProject,
      mockColumns,
      mockLayoutConfig,
      templateBuffer
    );

    // Load output blob into ExcelJS to run assertions
    const arrayBuffer = await blob.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(arrayBuffer) as any);

    const worksheet = workbook.getWorksheet("STEP 4 - ESTIMATE");
    expect(worksheet).toBeDefined();
    if (!worksheet) throw new Error("Worksheet not found");

    // Verification 1: Division 03 Header SUM range expansion
    // Row 26 is the Division 03 Header. Since we inserted 2 items in Division 03:
    // Original range: I27:I52 (26 items). New range: I27:I54 (28 items).
    const div3HeaderCell = worksheet.getCell("E26");
    expect(div3HeaderCell.value).toEqual({ formula: "SUM(I27:I54)" });

    // Verification 2: Division 04 Header Shifting
    // Original: Row 53. After 2 insertions: shifts to Row 55.
    // Original range: I54:I62. New range: I56:I64.
    const div4HeaderTitleCell = worksheet.getCell("D55");
    expect(div4HeaderTitleCell.value).toContain("DIVISION 04");
    
    const div4HeaderSumCell = worksheet.getCell("E55");
    expect(div4HeaderSumCell.value).toEqual({ formula: "SUM(I56:I64)" });

    // Verification 3: New Rows Stylings & Formulas
    // New manual items should be inserted at Row 53 and Row 54 (pushing old Row 53 down).
    const newRow1 = worksheet.getRow(53);
    expect(newRow1.getCell(3).value).toBe("03-2000.001");
    expect(newRow1.getCell(4).value).toBe("Manual Rebar Mesh Item 1");
    expect(newRow1.getCell(6).value).toBe(500);
    expect(newRow1.getCell(7).value).toBe("SF");
    expect(newRow1.getCell(8).value).toBe(2.5);
    expect(newRow1.getCell(9).value).toEqual({ formula: "IF(ISNUMBER(F53), F53 * H53, 0)" });

    // Typographic check: ensure background fill color is copied from the baseline (concrete Row 28/29)
    const baseConcreteCell = worksheet.getCell("D29");
    expect(newRow1.getCell(4).fill).toEqual(baseConcreteCell.fill);

    // Verification 4: SUBTOTAL Row Shifting & Formula Range
    // Original SUBTOTAL: Row 331. After 2 insertions: shifts to Row 333.
    // Formula must encompass all rows: SUM(I10:I332)
    const subtotalLabelCell = worksheet.getCell("H333");
    expect(subtotalLabelCell.value).toBe("SUBTOTAL");

    const subtotalSumCell = worksheet.getCell("I333");
    expect(subtotalSumCell.value).toEqual({ formula: "SUM(I10:I332)" });

    // Verification 5: Downstream Modifier Formulas
    // Construction Contingency (mod row 1) shifts from Row 333 to Row 335.
    // Its formula must update to point to the new shifted SUBTOTAL row at I333: F335 * $I$333
    const contingencyTotalCell = worksheet.getCell("I335");
    expect(contingencyTotalCell.value).toEqual({ formula: "F335*$I$333" });

    // Verify Column P modifier formula is standalone
    const contingencyPCell = worksheet.getCell("P335");
    expect(contingencyPCell.value).toEqual({ formula: "I335" });

    // Grand Total Row shifts from Row 341 to Row 343.
    // Formula: SUM(I333:I342)
    const grandTotalCell = worksheet.getCell("I343");
    expect(grandTotalCell.value).toEqual({ formula: "SUM(I333:I342)" });

    // Verify Column P grand total formula is standard summation
    const grandTotalPCell = worksheet.getCell("P343");
    expect(grandTotalPCell.value).toEqual({ formula: "SUM(P10:P342)" });

    // ── CORRUPTION FIX VERIFICATIONS ──────────────────────────────────────

    // Verification 6: Zero shared formulas in STEP 4 worksheet
    // (Other sheets are preserved byte-for-byte and may still contain shared formulas)
    let totalSharedFormulas = 0;
    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        const val = cell.value as any;
        if (val && typeof val === 'object' && (
          val.sharedFormula !== undefined ||
          val.formulaType === 'shared' ||
          val.shareType === 'shared'
        )) {
          totalSharedFormulas++;
        }
      });
    });
    expect(totalSharedFormulas).toBe(0);

    // Verification 7: AutoFilter range covers all data rows (330 + 2 insertions = 332)
    const autoFilter = worksheet.autoFilter as any;
    expect(autoFilter).toBeDefined();
    if (typeof autoFilter === 'object' && autoFilter.to) {
      expect(autoFilter.to).toBe("K332");
    } else if (typeof autoFilter === 'string') {
      expect(autoFilter).toContain("K332");
    }

    // Verification 8: Print Area encompasses shifted rows (342 + 2 = 344)
    expect(worksheet.pageSetup.printArea).toBe("B2:L344");

    // Verification 9: No external defined names remain (references to [1], [2], etc.)
    const dnModel = (workbook.definedNames as any).model;
    if (Array.isArray(dnModel)) {
      for (const dn of dnModel) {
        for (const range of (dn.ranges || [])) {
          expect(range).not.toMatch(/\[\d+\]/);
        }
      }
    }

    // Verification 10: Division 03 header merge (unshifted — C26:D26) still exists
    const merges: string[] = (worksheet.model as any)?.merges || [];
    expect(merges).toContain("C26:D26");

    // Verification 11: Division 04 header merge shifted by 2 (C53 → C55)
    expect(merges).toContain("C55:D55");

    // Verification 12: Reconciliation row formulas at shifted positions
    const reconRow = worksheet.getRow(348); // template 346 + 2 shift
    expect(reconRow.getCell(5).value).toEqual({ formula: "SUM(E10:E347)" });

    // ── ZIP-PRESERVATION VERIFICATIONS (JSZip pipeline) ────────────────────

    const outputZip = await JSZip.loadAsync(arrayBuffer);

    // Verification 13: Template metadata files preserved
    expect(outputZip.file("customXml/item1.xml")).not.toBeNull();

    // Verification 14: Printer settings preserved
    expect(outputZip.file("xl/printerSettings/printerSettings1.bin")).not.toBeNull();

    // Verification 15: calcChain intentionally removed
    expect(outputZip.file("xl/calcChain.xml")).toBeNull();

    // Verification 16: Sheet filenames preserved (not renumbered)
    expect(outputZip.file("xl/worksheets/sheet7.xml")).not.toBeNull();

    // Verification 17: Zero #REF! formulas in any sheet XML
    const sheetFiles: string[] = [];
    outputZip.forEach((relativePath: string) => {
      if (relativePath.startsWith("xl/worksheets/") && relativePath.endsWith(".xml")) {
        sheetFiles.push(relativePath);
      }
    });
    for (const sheetFile of sheetFiles) {
      const xml = await outputZip.file(sheetFile)!.async("string");
      expect(xml).not.toContain("#REF!");
    }
  });
});
