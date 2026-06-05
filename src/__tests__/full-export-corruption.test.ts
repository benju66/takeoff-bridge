
import { describe, it, expect } from "vitest";
import { generateExcelWorkbook } from "../lib/exporter";
import { ESTIMATE_ITEMS_MASTER } from "../lib/mock-data";
import type { ProcessedTakeoffRow, ColumnDefinition } from "@/types";
import type { Project } from "@/types/db";
import fs from "fs";
import path from "path";
import JSZip from "jszip";

describe("Full Export Corruption Test", () => {
  it("should produce valid XLSX with all 230+ rows", async () => {
    const templatePath = path.resolve(__dirname, "../../public/templates/Company_Estimate_Template.xlsx");
    const templateBuffer = fs.readFileSync(templatePath);

    // Initialize all rows from catalog (just like the real app does)
    const sortedKeys = Object.keys(ESTIMATE_ITEMS_MASTER).sort();
    const mockRows: ProcessedTakeoffRow[] = sortedKeys.map((key) => {
      const item = ESTIMATE_ITEMS_MASTER[key];
      return {
        id: `row-${item.itemId}`,
        classification: item.description,
        itemId: item.itemId,
        procoreParentCode: item.procoreParentCode,
        procoreCode: item.procoreCode,
        description: item.description,
        matchedQty: 10,
        uom: item.targetUom,
        unitPrice: item.defaultUnitPrice,
        total: 10 * item.defaultUnitPrice,
        isMapped: true,
        rawQuantities: [],
        costType: item.costType,
        source: "template" as const,
      };
    });

    // Add 3 manual rows to Division 03 to trigger overflow
    for (let i = 0; i < 3; i++) {
      mockRows.push({
        id: `manual-${i}`,
        classification: "MANUAL ENTRY",
        itemId: `03-9900.${String(i+1).padStart(3, '0')}`,
        procoreParentCode: "3-30000.000",
        procoreCode: "",
        description: `Manual Concrete Item ${i+1}`,
        matchedQty: 100,
        uom: "SF",
        unitPrice: 5,
        total: 500,
        isMapped: true,
        rawQuantities: [],
        costType: "M",
        source: "manual" as const,
      });
    }

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
      id: "full-test",
      name: "Full Export Test",
      location: "Minneapolis, MN",
      squareFootage: 10000,
      unitCount: 100,
      createdAt: new Date().toISOString(),
      constructionContingencyRate: 0.02,
      designContingencyRate: 0,
      buildersRiskRate: 0,
      specialInsuranceRate: 0,
      glInsuranceRate: 0.01,
      bondRate: 0,
      feeRate: 0.05,
      roundingRule: "none",
      bidDate: "",
    };

    console.log(`Generating workbook with ${mockRows.length} rows...`);

    const blob = await (generateExcelWorkbook as any)(
      mockRows,
      mockProject,
      mockColumns,
      null, // use DEFAULT_LAYOUT_CONFIG
      templateBuffer
    );

    const arrayBuffer = await blob.arrayBuffer();
    const outputZip = await JSZip.loadAsync(arrayBuffer);

    // Check ALL sheet XMLs for issues
    const issues: string[] = [];
    
    const sheetFiles: string[] = [];
    outputZip.forEach((relativePath: string) => {
      if (relativePath.startsWith("xl/worksheets/") && relativePath.endsWith(".xml")) {
        sheetFiles.push(relativePath);
      }
    });

    for (const sheetFile of sheetFiles) {
      const xml = await outputZip.file(sheetFile)!.async("string");
      
      // Check for #REF!
      const refCount = (xml.match(/#REF!/g) || []).length;
      if (refCount > 0) {
        issues.push(`${sheetFile}: ${refCount} #REF! references found`);
        // Show the actual formulas with #REF!
        const refFormulas = xml.match(/<f[^>]*>[^<]*#REF![^<]*<\/f>/g) || [];
        for (const f of refFormulas.slice(0, 5)) {
          issues.push(`  ${f}`);
        }
      }
      
      // Check for cells with t="e" (error type)
      const errorCells = (xml.match(/t="e"/g) || []).length;
      if (errorCells > 0) {
        issues.push(`${sheetFile}: ${errorCells} error-type cells (t="e")`);
      }
      
      // Check for cells with t="s" that have inline content (invalid)
      const sTypeCells = xml.match(/<c [^>]*t="s"[^>]*><is>/g) || [];
      if (sTypeCells.length > 0) {
        issues.push(`${sheetFile}: ${sTypeCells.length} cells with t="s" but inline content`);
      }
      
      // Check for orphaned <v> without <f> where type is formula-based
      // Check for duplicate row numbers
      const rowNums = xml.match(/<row [^>]*r="(\d+)"/g)?.map(r => r.match(/r="(\d+)"/)?.[1]) || [];
      const dupes = rowNums.filter((v, i, a) => a.indexOf(v) !== i);
      if (dupes.length > 0) {
        issues.push(`${sheetFile}: duplicate row numbers: ${dupes.join(', ')}`);
      }
    }

    if (issues.length > 0) {
      console.log("\n=== ISSUES FOUND ===");
      issues.forEach(i => console.log(i));
    } else {
      console.log("\nNo structural issues found in any sheet");
    }

    // Save the output for manual inspection
    fs.writeFileSync(
      path.resolve(__dirname, "../../scratch_full_export.xlsx"), 
      Buffer.from(arrayBuffer)
    );
    console.log("\nSaved to scratch_full_export.xlsx");

    // Assert no issues
    expect(issues).toEqual([]);
  }, 30000);
});
