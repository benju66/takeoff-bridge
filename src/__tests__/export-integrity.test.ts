import { describe, it, expect } from "vitest";
import {
  generateExcelWorkbook,
  generateProcoreBudget,
  validateExportReadiness,
  rollupByProcoreCode,
  rollupGcSiteOps,
  collectGcSiteOpsLines,
  buildStep23DetailLines,
} from "../lib/exporter";
import { computePersonnelCosts, computeSiteOperations, computeLinkedDivisionTotals, computeTakeoffSummary } from "../lib/calculations";
import { LINKED_DIVISION_ROWS } from "../lib/constants";
import type { ProcessedTakeoffRow, ColumnDefinition } from "@/types";
import type { Project } from "@/types/db";
import fs from "fs";
import ExcelJS from "exceljs";
import JSZip from "jszip";

import {
  layoutWithDivisions,
  MASTER_TEMPLATE_PATH,
} from "./fixtures/templateLayout";

// Layout config mirroring the template_config seed (real anchors; divisions
// limited to the ones these focused tests populate)
const mockLayoutConfig = layoutWithDivisions("01", "02", "03", "04");

// gc-siteops Phase 3: every export path requires the GC + Site Ops calc
// results. Zero-input results = a project with no GC/Site Ops entries.
const zeroGcResult = () =>
  computePersonnelCosts(0, 0, {}, { dumpsters: 0, toilets: 0, electric: 0 });
const zeroSiteOpsResult = () =>
  computeSiteOperations(0, 0, { knox: 0, payrollCleaning: 0, hiredCleaning: 0, soilBorings: 0 }, { soilBorings: 0 });

// The template's Budget Line Items sheet file (verified forensically — same
// fixed-template precedent as the sheet7.xml STEP 4 assertion below).
const BLI_SHEET_FILE = "xl/worksheets/sheet17.xml";

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
    // Read the git-tracked canonical template (runtime uses the Storage bucket)
    const templateBuffer = fs.readFileSync(MASTER_TEMPLATE_PATH);

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
    const blob = await generateExcelWorkbook(
      mockRows,
      mockProject,
      mockColumns,
      mockLayoutConfig,
      templateBuffer as unknown as ArrayBuffer,
      zeroGcResult(),
      zeroSiteOpsResult()
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

// ---------------------------------------------------------------------------
// Phase 2 — Procore Rollup, Export Gates & Budget Line Items computed values
// ---------------------------------------------------------------------------

describe("Procore Rollup & Export Gates (Phase 2)", () => {
  const mockColumnsShared: ColumnDefinition[] = [
    { id: "costType", header: "TYPE", type: "default" },
    { id: "itemId", header: "Code", type: "default" },
    { id: "description", header: "Description", type: "default" },
    { id: "matchedQty", header: "Quantity", type: "default" },
    { id: "uom", header: "Unit", type: "default" },
    { id: "unitPrice", header: "Rate", type: "default" },
    { id: "total", header: "Total", type: "default" },
  ];

  const mockProjectShared: Project = {
    id: "project-2",
    name: "Phase 2 Rollup Test Project",
    location: "Minneapolis, MN",
    squareFootage: 10000,
    unitCount: 100,
    bidDate: "2026-06-05",
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

  const baseRow = (overrides: Partial<ProcessedTakeoffRow>): ProcessedTakeoffRow => ({
    id: "row-x",
    classification: "",
    itemId: "",
    procoreParentCode: "",
    procoreCode: "",
    description: "",
    matchedQty: 0,
    uom: "LS",
    unitPrice: 0,
    total: 0,
    isMapped: true,
    rawQuantities: [],
    costType: "S",
    customFields: {},
    source: "template",
    ...overrides,
  });

  // Fixture: two Div-03 rows sharing 3-30000.000 (incl. former orphan
  // 03-0000.002 Footings) + one Div-02 row on the 2-20000.000 fallback code
  // (absent from the template's Budget Line Items sheet → exercises append).
  const concreteRow = baseRow({
    id: "row-03-0000.001", itemId: "03-0000.001",
    procoreParentCode: "3-30000.000", procoreCode: "3-30000.000",
    description: "Cast In-Place Concrete", matchedQty: 150, unitPrice: 120, total: 18000, uom: "CY",
  });
  const footingsRow = baseRow({
    id: "row-03-0000.002", itemId: "03-0000.002",
    procoreParentCode: "3-30000.000", procoreCode: "3-30000.000",
    description: "Footings", matchedQty: 80, unitPrice: 180, total: 14400, uom: "CY",
  });
  // NOTE (Phase 5): itemId must NOT be a linked division row (02-0000.001 et
  // al. are excluded from the rollup) — this fixture exercises the BLI-append
  // path for a mapped code absent from the sheet, so it uses a manual itemId.
  const div02Row = baseRow({
    id: "row-02-1000.001", itemId: "02-1000.001",
    procoreParentCode: "2-20000.000", procoreCode: "2-20000.000",
    description: "Demolition Allowance", matchedQty: 1, unitPrice: 5000, total: 5000,
    source: "manual",
  });
  const unmappedWithDollars = baseRow({
    id: "manual-unmapped-dollars", itemId: "03-2000.001",
    description: "Manual Rebar Mesh", matchedQty: 500, unitPrice: 2.5, total: 1250,
    isMapped: true, source: "manual",
  });
  const unmappedZeroDollar = baseRow({
    id: "manual-unmapped-zero", itemId: "",
    description: "Empty manual stub", matchedQty: 0, unitPrice: 99,
    isMapped: false, source: "manual",
  });

  it("blocks export when unmapped rows carry dollars; zero-dollar unmapped rows do not block", () => {
    const readiness = validateExportReadiness(
      [concreteRow, unmappedWithDollars, unmappedZeroDollar],
      zeroGcResult(),
      zeroSiteOpsResult()
    );
    expect(readiness.ok).toBe(false);
    expect(readiness.blockers).toHaveLength(1);
    expect(readiness.blockers[0]).toMatchObject({
      rowId: "manual-unmapped-dollars",
      itemId: "03-2000.001",
      amount: 1250,
    });
    // Unmapped dollars are excluded from the rollup → reconciliation also fails
    expect(readiness.reconciliation.ok).toBe(false);
    expect(readiness.reconciliation.delta).toBeCloseTo(1250, 2);
  });

  it("reconciliation ties out on a fully mapped fixture", () => {
    const readiness = validateExportReadiness([concreteRow, footingsRow, div02Row], zeroGcResult(), zeroSiteOpsResult());
    expect(readiness.ok).toBe(true);
    expect(readiness.blockers).toHaveLength(0);
    expect(readiness.reconciliation.lineItemTotal).toBeCloseTo(37400, 2);
    expect(readiness.reconciliation.rollupTotal).toBeCloseTo(37400, 2);
    expect(Math.abs(readiness.reconciliation.delta)).toBeLessThanOrEqual(0.01);

    const rollup = rollupByProcoreCode([concreteRow, footingsRow, div02Row]);
    expect(rollup["3-30000.000"]).toBeCloseTo(32400, 2);
    expect(rollup["2-20000.000"]).toBeCloseTo(5000, 2);
  });

  it("writes computed values into Budget Line Items and appends missing mapped codes", async () => {
    const templateBuffer = fs.readFileSync(MASTER_TEMPLATE_PATH);
    const rows = [concreteRow, footingsRow, div02Row];

    const blob = await generateExcelWorkbook(
      rows,
      mockProjectShared,
      mockColumnsShared,
      mockLayoutConfig,
      templateBuffer as unknown as ArrayBuffer,
      zeroGcResult(),
      zeroSiteOpsResult()
    );
    const arrayBuffer = await blob.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(arrayBuffer) as never);

    const bli = workbook.getWorksheet("Budget Line Items");
    expect(bli).toBeDefined();
    if (!bli) throw new Error("Budget Line Items sheet not found");

    // Index Budget Amount (col H) cells by Cost Code (col A)
    const byCode = new Map<string, ExcelJS.CellValue>();
    bli.eachRow((row, rowNum) => {
      if (rowNum < 2) return;
      const code = String(row.getCell(1).value ?? "").trim();
      if (code) byCode.set(code, row.getCell(8).value);
    });

    // (c) Former orphan 03-0000.002 Footings rolls into 3-30000.000 as a static value
    const concreteVal = byCode.get("3-30000.000");
    expect(typeof concreteVal).toBe("number");
    expect(concreteVal as number).toBeCloseTo(32400, 2);

    // The template's broken #REF! row (1-10000.000) is value-written, not formula-stripped
    const gcVal = byCode.get("1-10000.000");
    expect(typeof gcVal).toBe("number");
    expect(gcVal as number).toBeCloseTo(0, 2);

    // Missing mapped code 2-20000.000 is appended with its rollup value
    const div02Val = byCode.get("2-20000.000");
    expect(typeof div02Val).toBe("number");
    expect(div02Val as number).toBeCloseTo(5000, 2);

    // gc-siteops Phase 3: NO live SUMIF survives in Budget Line Items — every
    // row carries a computed value (zero-input GC/Site Ops → $0 rows).
    const outputZip = await JSZip.loadAsync(arrayBuffer);
    const bliSheetXml = await outputZip.file(BLI_SHEET_FILE)!.async("string");
    expect(bliSheetXml).not.toBe("");
    expect(bliSheetXml).not.toContain("#REF!");
    expect(bliSheetXml).not.toContain("SUMIF('STEP 4 - ESTIMATE'");
    expect(bliSheetXml).not.toContain("SUMIF('STEP 2 - GCs'");
    expect(bliSheetXml).not.toContain("SUMIF('STEP 3 - SITE OPS'");

    // A formerly SUMIF-driven STEP 2 row now holds a computed $0 value
    const superintendentVal = byCode.get("1-10420.000");
    expect(typeof superintendentVal).toBe("number");
    expect(superintendentVal as number).toBeCloseTo(0, 2);

    // (d) generateProcoreBudget and the workbook BLI agree on totals
    const csv = generateProcoreBudget(rows, mockProjectShared, zeroGcResult(), zeroSiteOpsResult());
    const lines = csv.split("\r\n").slice(1); // drop header
    let csvDetailTotal = 0;
    const csvCodes = new Set<string>();
    for (const line of lines) {
      const cols = line.split(",");
      const code = cols[0].replace(/^"|"$/g, "");
      // Detail rows only — modifier rows use the template modifier codes (no division prefix match)
      if (code === "3-30000.000" || code === "2-20000.000") {
        csvCodes.add(code);
        csvDetailTotal += parseFloat(cols[cols.length - 1].replace(/^"|"$/g, ""));
      }
    }
    expect(csvCodes).toEqual(new Set(["3-30000.000", "2-20000.000"]));
    const bliWrittenTotal = (concreteVal as number) + (div02Val as number);
    expect(csvDetailTotal).toBeCloseTo(bliWrittenTotal, 2);
    expect(csvDetailTotal).toBeCloseTo(37400, 2);

    // fullCalcOnLoad is set so surviving live formulas recompute on open
    const wbXmlOut = await outputZip.file("xl/workbook.xml")!.async("string");
    expect(wbXmlOut).toMatch(/<calcPr[^>]*fullCalcOnLoad="1"/);
  }, 30000);
});

// ---------------------------------------------------------------------------
// gc-siteops Phase 3 — GC + Site Ops computed values reach Budget Line Items
// ---------------------------------------------------------------------------

describe("GC + Site Ops Budget Line Items export (Phase 3)", () => {
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
    id: "project-3",
    name: "Phase 3 GC Export Test Project",
    location: "Minneapolis, MN",
    squareFootage: 10000,
    unitCount: 100,
    bidDate: "2026-06-06",
    createdAt: new Date().toISOString(),
    constructionContingencyRate: 0,
    designContingencyRate: 0,
    buildersRiskRate: 0,
    specialInsuranceRate: 0,
    glInsuranceRate: 0.01,
    bondRate: 0,
    feeRate: 0.05,
    roundingRule: "none",
  };

  const baseRow = (overrides: Partial<ProcessedTakeoffRow>): ProcessedTakeoffRow => ({
    id: "row-x",
    classification: "",
    itemId: "",
    procoreParentCode: "",
    procoreCode: "",
    description: "",
    matchedQty: 0,
    uom: "LS",
    unitPrice: 0,
    total: 0,
    isMapped: true,
    rawQuantities: [],
    costType: "S",
    customFields: {},
    source: "template",
    ...overrides,
  });

  // STEP 4 fixture: $32,400 on 3-30000.000 (a code pre-existing on the sheet)
  const step4Rows = [
    baseRow({
      id: "row-03-0000.001", itemId: "03-0000.001",
      procoreParentCode: "3-30000.000", procoreCode: "3-30000.000",
      description: "Cast In-Place Concrete", matchedQty: 150, unitPrice: 120, total: 18000, uom: "CY",
    }),
    baseRow({
      id: "row-03-0000.002", itemId: "03-0000.002",
      procoreParentCode: "3-30000.000", procoreCode: "3-30000.000",
      description: "Footings", matchedQty: 80, unitPrice: 180, total: 14400, uom: "CY",
    }),
  ];

  // GC fixture: 10 months, sqft 0 (no fire-ext line), Superintendent 100% + PM 50%,
  // all 3 equipment lines, plus Phase 4 manual entries on three NEW lines.
  // Staff: su = 10×173.2×1.0×110 = 190,520 ; pm = 10×173.2×0.5×120 = 103,920
  // Ops:   small tools 10×500 = 5,000 ; fuel 10×1,200 = 12,000 ; cell 10×135 = 1,350
  //        + Phase 4 auto: quality 5,000 ; temp office 8,500 ; office equip 2,500 ;
  //        computers 3,000 ; trailer 8,000 ; fire ext 0 ; gas 9,000 ; water 6,500 ;
  //        courier 3,500 ; plan repro 2,500  (= +48,500)
  // Equip: 5,000 + 2,000 + 3,000
  // Manual (Phase 4): designArch $12,000 lump ; tempOfficeSetup 1×9,000 ; safetyConsultant $500
  // grandTotal = 392,790
  const gcResult = () =>
    computePersonnelCosts(
      10, 0,
      { su: 100, pm: 50 },
      { dumpsters: 5000, toilets: 2000, electric: 3000 },
      { designArch: 12000, tempOfficeSetup: 1, safetyConsultant: 500 }
    );
  const GC_TOTAL = 392790;

  // Site Ops fixture: 10 months, 10,000 sf, knox 2, payroll 100 hr, hired 50 hr,
  // soil borings 1 × $2,500, plus Phase 4 entries on four NEW lines:
  // demolition 1,000 sf × $6 = 6,000 ; finalCleaning 2 × $2,500 = 5,000 ;
  // ffeRelocation $7,500 lump ; craneRental $4,000 lump
  // safety 5,000 ; temp prot 2,500 ; hoist 65,000 ; knox 1,300 ;
  // payroll 7,400 ; hired 2,700 ; soil 2,500 → grandTotal = 108,900
  const siteOpsResult = () =>
    computeSiteOperations(10, 10000,
      { knox: 2, payrollCleaning: 100, hiredCleaning: 50, soilBorings: 1, demolition: 1000, finalCleaning: 2, ffeRelocation: 7500, craneRental: 4000 },
      { soilBorings: 2500 });
  const SITE_OPS_TOTAL = 108900;

  it("sums shared-BLI-code lines in the GC/Site Ops rollup (D2: payroll + hired cleaning)", () => {
    const rollup = rollupGcSiteOps(collectGcSiteOpsLines(gcResult(), siteOpsResult()));
    expect(rollup["2-29010.000"]).toBeCloseTo(7400 + 2700, 2);
    expect(rollup["1-10420.000"]).toBeCloseTo(190520, 2);
    expect(rollup["1-15130.000"]).toBeCloseTo(5000, 2);
  });

  it("gate Option A: reconciliation covers line items + GC + Site Ops", () => {
    const readiness = validateExportReadiness(step4Rows, gcResult(), siteOpsResult());
    expect(readiness.ok).toBe(true);
    expect(readiness.blockers).toHaveLength(0);
    expect(readiness.reconciliation.lineItemTotal).toBeCloseTo(32400 + GC_TOTAL + SITE_OPS_TOTAL, 2);
    expect(readiness.reconciliation.rollupTotal).toBeCloseTo(32400 + GC_TOTAL + SITE_OPS_TOTAL, 2);
  });

  it("writes GC + Site Ops values into their Budget Line Items rows; full 217-row tie-out; no live SUMIF survives", async () => {
    const templateBuffer = fs.readFileSync(MASTER_TEMPLATE_PATH);

    const blob = await generateExcelWorkbook(
      step4Rows,
      mockProject,
      mockColumns,
      mockLayoutConfig,
      templateBuffer as unknown as ArrayBuffer,
      gcResult(),
      siteOpsResult()
    );
    const arrayBuffer = await blob.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(arrayBuffer) as never);

    const bli = workbook.getWorksheet("Budget Line Items");
    expect(bli).toBeDefined();
    if (!bli) throw new Error("Budget Line Items sheet not found");

    // Index Budget Amount (col H) cells by Cost Code (col A)
    const byCode = new Map<string, ExcelJS.CellValue>();
    bli.eachRow((row, rowNum) => {
      if (rowNum < 2) return;
      const code = String(row.getCell(1).value ?? "").trim();
      if (code && code.includes("-")) byCode.set(code, row.getCell(8).value);
    });

    // All 217 BLI rows present (144 STEP 4 + 34 GC + 38 Site Ops + 1 broken row)
    expect(byCode.size).toBe(217);

    // GC staff lines land on their confirmed BLI codes (findings §4.1)
    expect(byCode.get("1-10420.000")).toBeCloseTo(190520, 2); // Superintendent
    expect(byCode.get("1-10330.000")).toBeCloseTo(103920, 2); // Project Manager
    // GC operational + equipment lines
    expect(byCode.get("1-11000.000")).toBeCloseTo(5000, 2);   // Small Tools
    expect(byCode.get("1-11200.000")).toBeCloseTo(12000, 2);  // Fuel and Vehicle
    expect(byCode.get("1-15111.000")).toBeCloseTo(1350, 2);   // Cell Phone
    expect(byCode.get("1-15130.000")).toBeCloseTo(5000, 2);   // Dumpsters
    expect(byCode.get("1-15140.000")).toBeCloseTo(2000, 2);   // Temp Toilets
    expect(byCode.get("1-15170.000")).toBeCloseTo(3000, 2);   // Temp Electric

    // Site Ops lines (findings §4.2)
    expect(byCode.get("2-29015.000")).toBeCloseTo(5000, 2);   // Safety
    expect(byCode.get("2-29020.000")).toBeCloseTo(2500, 2);   // Temp Protection
    expect(byCode.get("2-29405.000")).toBeCloseTo(65000, 2);  // Material Hoist
    expect(byCode.get("2-29307.000")).toBeCloseTo(1300, 2);   // Knox Box
    expect(byCode.get("2-23200.000")).toBeCloseTo(2500, 2);   // Soil Borings
    // D2: payroll + hired progress cleaning SUM into one BLI row
    expect(byCode.get("2-29010.000")).toBeCloseTo(10100, 2);

    // D3: the broken 1-10000.000 row gets $0 — granular GC rows carry the dollars
    expect(byCode.get("1-10000.000")).toBeCloseTo(0, 2);

    // Phase 4 NEW lines land on their BLI codes
    expect(byCode.get("1-14010.000")).toBeCloseTo(5000, 2);   // Quality (auto, 10 mo × $500)
    expect(byCode.get("1-15120.000")).toBeCloseTo(8000, 2);   // Storage Trailer (auto)
    expect(byCode.get("1-10130.000")).toBeCloseTo(12000, 2);  // Design - Architecture (lump)
    expect(byCode.get("1-10610.000")).toBeCloseTo(500, 2);    // Safety Consultant (%-line, typed $)
    // D2a: Temp Office Setup (manual 1×$9,000) + Temp Office monthly (auto 10×$850)
    // share sibling BLI row 1-15110.000
    expect(byCode.get("1-15110.000")).toBeCloseTo(9000 + 8500, 2);
    expect(byCode.get("2-24100.000")).toBeCloseTo(6000, 2);   // Demolition (qty 1,000 sf × $6)
    expect(byCode.get("2-29005.000")).toBeCloseTo(5000, 2);   // Final Cleaning (qty 2 × $2,500)
    expect(byCode.get("2-25100.000")).toBeCloseTo(7500, 2);   // FFE Relocation (lump)
    expect(byCode.get("2-29415.000")).toBeCloseTo(4000, 2);   // Crane Rental (lump)

    // Lines without an estimator entry still export $0
    expect(byCode.get("1-10001.000")).toBeCloseTo(0, 2);      // Preconstruction Fees
    expect(byCode.get("2-29530.000")).toBeCloseTo(0, 2);      // Gypcrete Testing

    // Full reconciliation: Σ all 217 BLI values = Σ line items + GC + Site Ops
    let bliTotal = 0;
    for (const val of byCode.values()) {
      expect(typeof val).toBe("number"); // every row computed — no formulas left
      bliTotal += val as number;
    }
    expect(bliTotal).toBeCloseTo(32400 + GC_TOTAL + SITE_OPS_TOTAL, 2);

    // No live SUMIF survives anywhere in the BLI sheet XML
    const outputZip = await JSZip.loadAsync(arrayBuffer);
    const bliSheetXml = await outputZip.file(BLI_SHEET_FILE)!.async("string");
    expect(bliSheetXml).not.toContain("SUMIF(");
    expect(bliSheetXml).not.toContain("#REF!");
  }, 30000);

  it("Procore budget CSV carries GC + Site Ops dollars under their BLI codes and cost types", () => {
    const csv = generateProcoreBudget(step4Rows, mockProject, gcResult(), siteOpsResult());
    const lines = csv.split("\r\n").slice(1); // drop header
    const byCodeType = new Map<string, number>();
    for (const line of lines) {
      const cols = line.split(",");
      const code = cols[0].replace(/^"|"$/g, "");
      const costType = cols[1]?.replace(/^"|"$/g, "");
      const total = parseFloat(cols[cols.length - 1].replace(/^"|"$/g, ""));
      byCodeType.set(`${code}::${costType}`, total);
    }
    // Staff lines export as Labor ("L"), template BLI col B
    expect(byCodeType.get("1-10420.000::L")).toBeCloseTo(190520, 2);
    // D2: payroll + hired cleaning grouped on one code as Material
    expect(byCodeType.get("2-29010.000::M")).toBeCloseTo(10100, 2);
    // Phase 4: FFE Relocation exports as Subcontract ("S", template BLI col B
    // — caught in the Phase 4 cost-type re-verification)
    expect(byCodeType.get("2-25100.000::S")).toBeCloseTo(7500, 2);
    // Phase 4: Final Cleaning is "S"; Crane Rental is "M"
    expect(byCodeType.get("2-29005.000::S")).toBeCloseTo(5000, 2);
    expect(byCodeType.get("2-29415.000::M")).toBeCloseTo(4000, 2);
    // Zero-dollar GC lines emit no CSV row (no budget noise)
    expect([...byCodeType.keys()].some((k) => k.startsWith("1-10310.000"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// gc-siteops Phase 5 — estimate-page linkage + double-count trap closure
// ---------------------------------------------------------------------------

describe("Linked division rows & double-count closure (Phase 5)", () => {
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
    id: "project-5",
    name: "Phase 5 Linkage Test Project",
    location: "Minneapolis, MN",
    squareFootage: 10000,
    unitCount: 100,
    bidDate: "2026-06-06",
    createdAt: new Date().toISOString(),
    constructionContingencyRate: 0,
    designContingencyRate: 0,
    buildersRiskRate: 0,
    specialInsuranceRate: 0,
    glInsuranceRate: 0.01,
    bondRate: 0,
    feeRate: 0.05,
    roundingRule: "none",
  };

  const baseRow = (overrides: Partial<ProcessedTakeoffRow>): ProcessedTakeoffRow => ({
    id: "row-x",
    classification: "",
    itemId: "",
    procoreParentCode: "",
    procoreCode: "",
    description: "",
    matchedQty: 0,
    uom: "LS",
    unitPrice: 0,
    total: 0,
    isMapped: true,
    rawQuantities: [],
    costType: "S",
    customFields: {},
    source: "template",
    ...overrides,
  });

  // The 10 template-seeded linked division rows as they exist in a project
  // grid (qty 0; catalog maps them to the division parent BLI codes)
  const linkedGridRows = LINKED_DIVISION_ROWS.map((cfg) =>
    baseRow({
      id: `row-${cfg.itemId}`,
      itemId: cfg.itemId,
      procoreParentCode: cfg.itemId.startsWith("01") ? "1-10000.000" : "2-20000.000",
      procoreCode: cfg.itemId.startsWith("01") ? "1-10000.000" : "2-20000.000",
      description: cfg.description,
      matchedQty: 0,
      unitPrice: 0,
      costType: "L",
    })
  );

  // A linked row carrying STRAY typed dollars — the double-count trap
  const strayGcRow = baseRow({
    id: "row-01-0000.001-stray",
    itemId: "01-0000.001",
    procoreParentCode: "1-10000.000",
    procoreCode: "1-10000.000",
    description: "General Conditions",
    matchedQty: 2,
    unitPrice: 500, // $1,000 typed directly on the division-total row
    costType: "L",
  });

  const concreteRow = baseRow({
    id: "row-03-0000.001",
    itemId: "03-0000.001",
    procoreParentCode: "3-30000.000",
    procoreCode: "3-30000.000",
    description: "Cast In-Place Concrete",
    matchedQty: 150,
    unitPrice: 216, // $32,400
    uom: "CY",
    costType: "M",
  });

  const gcResult = () =>
    computePersonnelCosts(10, 0, { su: 100 }, { dumpsters: 5000, toilets: 0, electric: 0 });
  const siteOpsResult = () =>
    computeSiteOperations(10, 10000, { demolition: 1000, craneRental: 4000 }, {});

  it("rollupByProcoreCode excludes linked division rows — even with typed dollars", () => {
    const rollup = rollupByProcoreCode([concreteRow, strayGcRow, ...linkedGridRows.slice(1)]);
    expect(rollup["3-30000.000"]).toBeCloseTo(32400, 2);
    expect(rollup["1-10000.000"]).toBeUndefined();
    expect(rollup["2-20000.000"]).toBeUndefined();
  });

  it("gate ties out with stray dollars on a linked row (excluded on both sides)", () => {
    const gc = gcResult();
    const so = siteOpsResult();
    const readiness = validateExportReadiness([concreteRow, strayGcRow, ...linkedGridRows.slice(1)], gc, so);
    expect(readiness.ok).toBe(true);
    expect(readiness.blockers).toHaveLength(0);
    // Stray $1,000 counts nowhere; GC/Site Ops dollars keep ONE representation
    expect(readiness.reconciliation.lineItemTotal).toBeCloseTo(32400 + gc.grandTotal + so.grandTotal, 2);
    expect(readiness.reconciliation.rollupTotal).toBeCloseTo(32400 + gc.grandTotal + so.grandTotal, 2);
  });

  it("workbook: STEP 4 rows 12–24 carry the linked Step 2/3 values; division BLI codes stay $0", async () => {
    const templateBuffer = fs.readFileSync(MASTER_TEMPLATE_PATH);
    const gc = gcResult();
    const so = siteOpsResult();
    const linked = computeLinkedDivisionTotals(gc, so);
    const linkedByItemId = new Map(linked.map((l) => [l.itemId, l.total]));

    const blob = await generateExcelWorkbook(
      [concreteRow, strayGcRow, ...linkedGridRows.slice(1)],
      mockProject,
      mockColumns,
      mockLayoutConfig,
      templateBuffer as unknown as ArrayBuffer,
      gc,
      so
    );
    const arrayBuffer = await blob.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(arrayBuffer) as never);

    // STEP 4 sheet: the linked rows (template rows 12–24) carry qty 1 × the
    // computed Step 2/3 subtotal — values, not the grid's zeros, and not the
    // stray typed dollars. (No insertions above row 24 in this fixture.)
    const step4 = workbook.getWorksheet("STEP 4 - ESTIMATE")!;
    const linkedRowPositions: Record<string, number> = {
      "01-0000.001": 12, "01-0400.002": 13, "02-0000.001": 17, "02-4100.002": 18,
      "02-9005.003": 19, "02-9070.004": 20, "02-9200.005": 21, "02-9300.006": 22,
      "02-9400.007": 23, "02-9500.008": 24,
    };
    for (const [itemId, rowNum] of Object.entries(linkedRowPositions)) {
      const qty = step4.getRow(rowNum).getCell(6).value;   // F
      const price = step4.getRow(rowNum).getCell(8).value; // H
      expect(qty, `${itemId} qty`).toBe(1);
      expect(price, `${itemId} value`).toBeCloseTo(linkedByItemId.get(itemId)!, 2);
    }
    // Supervision = the superintendent staff line; GC = remainder (intent, not D4 bugs)
    const supervision = linkedByItemId.get("01-0400.002")!;
    expect(supervision).toBeCloseTo(10 * 173.2 * 110, 2);
    expect(linkedByItemId.get("01-0000.001")!).toBeCloseTo(gc.grandTotal - supervision, 2);

    // Budget Line Items: the division parent codes carry NO dollars (D3 +
    // trap closure) and the sheet total has no double-count
    const bli = workbook.getWorksheet("Budget Line Items")!;
    const byCode = new Map<string, ExcelJS.CellValue>();
    bli.eachRow((row, rowNum) => {
      if (rowNum < 2) return;
      const code = String(row.getCell(1).value ?? "").trim();
      if (code && code.includes("-")) byCode.set(code, row.getCell(8).value);
    });
    expect(byCode.get("1-10000.000")).toBeCloseTo(0, 2);
    expect(byCode.has("2-20000.000")).toBe(false); // never appended
    let bliTotal = 0;
    for (const val of byCode.values()) bliTotal += val as number;
    expect(bliTotal).toBeCloseTo(32400 + gc.grandTotal + so.grandTotal, 2);
  }, 30000);

  it("Procore CSV: no division-total codes; modifier rows use the combined basis", () => {
    const gc = gcResult();
    const so = siteOpsResult();
    const csv = generateProcoreBudget(
      [concreteRow, strayGcRow, ...linkedGridRows.slice(1)],
      mockProject,
      gc,
      so
    );
    const lines = csv.split("\r\n").slice(1);
    const byCode = new Map<string, number>();
    for (const line of lines) {
      const cols = line.split(",");
      const code = cols[0].replace(/^"|"$/g, "");
      byCode.set(code, parseFloat(cols[cols.length - 1].replace(/^"|"$/g, "")));
    }
    // The trap is closed: no dollars on the division parent codes
    expect(byCode.has("1-10000.000")).toBe(false);
    expect(byCode.has("2-20000.000")).toBe(false);
    // Modifier basis = takeoff + GC + Site Ops (template I331), stray excluded
    const basis = 32400 + gc.grandTotal + so.grandTotal;
    expect(byCode.get("60-4000.001")).toBeCloseTo(basis * 0.05, 2); // Fee 5%
    expect(byCode.get("60-2020.001")).toBeCloseTo(basis * 0.01, 2); // GL 1%
  });
});

// ---------------------------------------------------------------------------
// gc-siteops Phase 6 — STEP 2/3 sheet detail (plan §8)
// ---------------------------------------------------------------------------

describe("STEP 2/3 sheet detail (Phase 6)", () => {
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
    id: "project-6",
    name: "Phase 6 Sheet Detail Test Project",
    location: "Minneapolis, MN",
    squareFootage: 10000,
    unitCount: 100,
    bidDate: "2026-06-07",
    createdAt: new Date().toISOString(),
    constructionContingencyRate: 0,
    designContingencyRate: 0,
    buildersRiskRate: 0,
    specialInsuranceRate: 0,
    glInsuranceRate: 0.01,
    bondRate: 0,
    feeRate: 0.05,
    roundingRule: "none",
  };

  const baseRow = (overrides: Partial<ProcessedTakeoffRow>): ProcessedTakeoffRow => ({
    id: "row-x",
    classification: "",
    itemId: "",
    procoreParentCode: "",
    procoreCode: "",
    description: "",
    matchedQty: 0,
    uom: "LS",
    unitPrice: 0,
    total: 0,
    isMapped: true,
    rawQuantities: [],
    costType: "S",
    customFields: {},
    source: "template",
    ...overrides,
  });

  // STEP 4 fixture: $32,400 of takeoff dollars + the 10 template-seeded
  // linked division rows (qty 0) so the %-line basis includes GC + Site Ops
  // the way a real project grid does.
  const step4Rows = [
    baseRow({
      id: "row-03-0000.001", itemId: "03-0000.001",
      procoreParentCode: "3-30000.000", procoreCode: "3-30000.000",
      description: "Cast In-Place Concrete", matchedQty: 150, unitPrice: 120, total: 18000, uom: "CY", costType: "M",
    }),
    baseRow({
      id: "row-03-0000.002", itemId: "03-0000.002",
      procoreParentCode: "3-30000.000", procoreCode: "3-30000.000",
      description: "Footings", matchedQty: 80, unitPrice: 180, total: 14400, uom: "CY", costType: "M",
    }),
    ...LINKED_DIVISION_ROWS.map((cfg) =>
      baseRow({
        id: `row-${cfg.itemId}`,
        itemId: cfg.itemId,
        procoreParentCode: cfg.itemId.startsWith("01") ? "1-10000.000" : "2-20000.000",
        procoreCode: cfg.itemId.startsWith("01") ? "1-10000.000" : "2-20000.000",
        description: cfg.description,
        costType: "L",
      })
    ),
  ];

  // Same rich fixture as the Phase 3 block (GC_TOTAL 392,790 / SITE_OPS 108,900)
  const gcResult = () =>
    computePersonnelCosts(
      10, 0,
      { su: 100, pm: 50 },
      { dumpsters: 5000, toilets: 2000, electric: 3000 },
      { designArch: 12000, tempOfficeSetup: 1, safetyConsultant: 500 }
    );
  const siteOpsResult = () =>
    computeSiteOperations(10, 10000,
      { knox: 2, payrollCleaning: 100, hiredCleaning: 50, soilBorings: 1, demolition: 1000, finalCleaning: 2, ffeRelocation: 7500, craneRental: 4000 },
      { soilBorings: 2500 });

  const summaryRates = {
    constructionContingencyRate: 0, designContingencyRate: 0, buildersRiskRate: 0,
    specialInsuranceRate: 0, glInsuranceRate: 0.01, bondRate: 0, feeRate: 0.05,
    roundingRule: "none",
  };

  it("buildStep23DetailLines: lump-sum lines write qty 0/1 × amount; %-lines write effective % × basis", () => {
    const basis = 566135.4;
    const { step2, step3 } = buildStep23DetailLines(gcResult(), siteOpsResult(), basis);
    const s2 = new Map(step2.map((l) => [l.code, l]));
    const s3 = new Map(step3.map((l) => [l.code, l]));

    // Staff: utilization fraction + computed hours + rate
    expect(s2.get("01-0420.001")).toMatchObject({ qty: 1732, rate: 110, utilization: 1 });
    expect(s2.get("01-0330.001")).toMatchObject({ qty: 866, rate: 120, utilization: 0.5 });
    // Equipment lump sums: qty 1 × typed amount (qty 0 when empty)
    expect(s2.get("01-5130.001")).toMatchObject({ qty: 1, rate: 5000 });
    // %-line (template-faithful): F = amount ÷ basis, H = basis → I recomputes to $500
    const safety = s2.get("01-0610.001")!;
    expect(safety.qty).toBeCloseTo(500 / basis, 10);
    expect(safety.rate).toBeCloseTo(basis, 2);
    // Untyped %-line: F = 0, H = basis → I recomputes to $0
    expect(s3.size).toBeGreaterThan(0);
    const procore = s2.get("01-1600.001")!;
    expect(procore.qty).toBe(0);
    expect(procore.rate).toBeCloseTo(basis, 2);
    // Site Ops qty × rate lines pass through
    expect(s3.get("02-9307.001")).toMatchObject({ qty: 2, rate: 650 });
    expect(s3.get("02-4100.001")).toMatchObject({ qty: 1000, rate: 6 });
  });

  it("buildStep23DetailLines: %-lines fall back to qty 0/1 × amount when the basis is $0", () => {
    const { step2 } = buildStep23DetailLines(gcResult(), siteOpsResult(), 0);
    const s2 = new Map(step2.map((l) => [l.code, l]));
    expect(s2.get("01-0610.001")).toMatchObject({ qty: 1, rate: 500 });
    expect(s2.get("01-1600.001")).toMatchObject({ qty: 0, rate: 0 });
  });

  it("workbook: STEP 2/3 sheets carry line qty/rate values, live F×H line totals, and exact subtotal tie-out with STEP 4", async () => {
    const templateBuffer = fs.readFileSync(MASTER_TEMPLATE_PATH);
    const gc = gcResult();
    const so = siteOpsResult();
    const linked = computeLinkedDivisionTotals(gc, so);
    const linkedByItemId = new Map(linked.map((l) => [l.itemId, l.total]));
    const summary = computeTakeoffSummary(step4Rows, 10000, 100, summaryRates, linked);

    const blob = await generateExcelWorkbook(
      step4Rows,
      mockProject,
      mockColumns,
      mockLayoutConfig,
      templateBuffer as unknown as ArrayBuffer,
      gc,
      so
    );
    const arrayBuffer = await blob.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(arrayBuffer) as never);

    const step2 = workbook.getWorksheet("STEP 2 - GCs")!;
    const step3 = workbook.getWorksheet("STEP 3 - SITE OPS")!;
    expect(step2).toBeDefined();
    expect(step3).toBeDefined();

    // ── STEP 2 line rows: utilization (E) / qty (F) / rate (H) values ──
    // Superintendent (row 13): 100% × 10 mo × 173.2 = 1,732 hr @ $110
    expect(step2.getCell("E13").value).toBe(1);
    expect(step2.getCell("F13").value).toBe(1732);
    expect(step2.getCell("H13").value).toBe(110);
    // Project Manager (row 29): 50% → 866 hr @ $120
    expect(step2.getCell("E29").value).toBe(0.5);
    expect(step2.getCell("F29").value).toBe(866);
    expect(step2.getCell("H29").value).toBe(120);
    // Idle staff still written ($0 line, default rate visible): Project Executive row 27
    expect(step2.getCell("E27").value).toBe(0);
    expect(step2.getCell("F27").value).toBe(0);
    expect(step2.getCell("H27").value).toBe(175);
    // Auto monthly line: Small Tools (row 36) 10 mo × $500 (su-driven)
    expect(step2.getCell("F36").value).toBe(10);
    expect(step2.getCell("H36").value).toBe(500);
    // Equipment lump sum: Dumpsters (row 47) qty 1 × $5,000
    expect(step2.getCell("F47").value).toBe(1);
    expect(step2.getCell("H47").value).toBe(5000);
    // Manual lump sum: Design - Architecture (row 20) qty 1 × $12,000
    expect(step2.getCell("F20").value).toBe(1);
    expect(step2.getCell("H20").value).toBe(12000);
    // %-line Safety Consultant (row 35): effective % × whole-job basis
    expect(step2.getCell("F35").value).toBeCloseTo(500 / summary.totalEstimatedCost, 10);
    expect(step2.getCell("H35").value).toBeCloseTo(summary.totalEstimatedCost, 2);

    // Line totals stay LIVE F×H formulas (flattened standalone, not shared)
    const i13 = step2.getCell("I13").value as { formula?: string };
    expect(i13?.formula).toBe("F13*H13");
    const i36 = step2.getCell("I36").value as { formula?: string };
    expect(i36?.formula).toBe("F36*H36");

    // ── STEP 3 line rows ──
    expect(step3.getCell("F55").value).toBe(2);    // Knox Box qty
    expect(step3.getCell("H55").value).toBe(650);  // Knox Box rate
    expect(step3.getCell("F17").value).toBe(10);   // Safety: 10 mo
    expect(step3.getCell("H17").value).toBe(500);
    expect(step3.getCell("F18").value).toBe(10000); // Temp Protection: sqft
    expect(step3.getCell("H18").value).toBe(0.25);
    expect(step3.getCell("F12").value).toBe(1);    // Soil Borings qtyRate
    expect(step3.getCell("H12").value).toBe(2500);
    expect(step3.getCell("F32").value).toBe(1000); // Demolition
    expect(step3.getCell("H32").value).toBe(6);
    expect(step3.getCell("F13").value).toBe(1);    // FFE Relocation lump $7,500
    expect(step3.getCell("H13").value).toBe(7500);

    // ── Subtotal cells: VALUES identical to the STEP 4 rows 12–24 writes,
    // so the template's exact-equality col-S checks tie out ──
    const step4 = workbook.getWorksheet("STEP 4 - ESTIMATE")!;
    const subtotalChecks: { itemId: string; sheet: ExcelJS.Worksheet; cell: string; step4Row: number }[] = [
      { itemId: "01-0400.002", sheet: step2, cell: "I16", step4Row: 13 },
      { itemId: "01-0000.001", sheet: step2, cell: "I58", step4Row: 12 },
      { itemId: "02-0000.001", sheet: step3, cell: "I29", step4Row: 17 },
      { itemId: "02-4100.002", sheet: step3, cell: "I35", step4Row: 18 },
      { itemId: "02-9005.003", sheet: step3, cell: "I40", step4Row: 19 },
      { itemId: "02-9070.004", sheet: step3, cell: "I45", step4Row: 20 },
      { itemId: "02-9200.005", sheet: step3, cell: "I51", step4Row: 21 },
      { itemId: "02-9300.006", sheet: step3, cell: "I62", step4Row: 22 },
      { itemId: "02-9400.007", sheet: step3, cell: "I72", step4Row: 23 },
      { itemId: "02-9500.008", sheet: step3, cell: "I82", step4Row: 24 },
    ];
    for (const check of subtotalChecks) {
      const subtotalValue = check.sheet.getCell(check.cell).value;
      // A value (number), not a formula — and the EXACT number on STEP 4 col H
      expect(typeof subtotalValue, `${check.itemId} subtotal is a value`).toBe("number");
      expect(subtotalValue, `${check.itemId} subtotal`).toBe(linkedByItemId.get(check.itemId)!);
      expect(step4.getRow(check.step4Row).getCell(8).value, `${check.itemId} STEP 4 H`).toBe(subtotalValue);
    }
    // Spot-check the section math itself
    expect(linkedByItemId.get("01-0400.002")).toBeCloseTo(190520, 2);          // Supervision (su)
    expect(linkedByItemId.get("01-0000.001")).toBeCloseTo(392790 - 190520, 2); // GC remainder
    expect(linkedByItemId.get("02-0000.001")).toBeCloseTo(27600, 2);           // 02.A Site Operations
    expect(linkedByItemId.get("02-9400.007")).toBeCloseTo(69000, 2);           // 02.G Site Equipment

    // ── Sheet detail must not change export dollars: BLI still ties out ──
    const bli = workbook.getWorksheet("Budget Line Items")!;
    let bliTotal = 0;
    bli.eachRow((row, rowNum) => {
      if (rowNum < 2) return;
      const code = String(row.getCell(1).value ?? "").trim();
      if (code && code.includes("-")) bliTotal += Number(row.getCell(8).value) || 0;
    });
    expect(bliTotal).toBeCloseTo(32400 + gc.grandTotal + so.grandTotal, 2);

    // ── No shared formulas survive on the rebuilt STEP 2/3 sheets ──
    const outputZip = await JSZip.loadAsync(arrayBuffer);
    for (const sheetFile of ["xl/worksheets/sheet5.xml", "xl/worksheets/sheet6.xml"]) {
      const xml = await outputZip.file(sheetFile)!.async("string");
      expect(xml, `${sheetFile} shared formulas flattened`).not.toContain('t="shared"');
    }
  }, 30000);
});
