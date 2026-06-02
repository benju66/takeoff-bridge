import { describe, it, expect } from "vitest";
import { generateExcelPayload } from "../exporter";
import type { ProcessedTakeoffRow, ColumnDefinition } from "@/types";

describe("exporter - generateExcelPayload", () => {
  const mockColumns: ColumnDefinition[] = [
    { id: "actions", header: "", type: "default" },
    { id: "validationStatus", header: "", type: "default" },
    { id: "costType", header: "TYPE", type: "default" },
    { id: "itemId", header: "Code", type: "default" },
    { id: "description", header: "Description", type: "default" },
    { id: "matchedQty", header: "Quantity", type: "default" },
    { id: "uom", header: "Unit", type: "default" },
    { id: "unitPrice", header: "Rate", type: "default" },
    { id: "total", header: "Total", type: "default" },
    { id: "notes", header: "", type: "default" },
  ];

  const mockRows: ProcessedTakeoffRow[] = [
    {
      id: "row-1",
      classification: "Slab on Grade",
      itemId: "03-0000.001",
      procoreParentCode: "3-30000.000",
      description: "Concrete slab",
      matchedQty: 100,
      uom: "SF",
      unitPrice: 5.5,
      total: 550,
      isMapped: true,
      rawQuantities: [{ qty: 100, uom: "SF" }],
      costType: "M",
      customFields: {
        notes: "Use standard high-strength mix.",
      },
    },
  ];

  const mockProject: Project = {
    id: "project-1",
    name: "Mock Project",
    location: "Mock Location",
    squareFootage: 1000,
    unitCount: 10,
    bidDate: "2026-06-01",
    createdAt: new Date().toISOString(),
    overheadRate: 0,
    feeRate: 5,
    liabilityRate: 1,
    taxRate: 0,
    roundingRule: "none"
  };

  it("filters out actions and validationStatus web control columns", () => {
    const csvContent = generateExcelPayload(mockRows, mockColumns, mockProject);
    const firstLine = csvContent.split("\r\n")[0];

    // Headers should not contain actions or validationStatus
    expect(firstLine).not.toContain("actions");
    expect(firstLine).not.toContain("validationStatus");
  });

  it("maps the notes column header to 'Notes' and row value correctly", () => {
    const csvContent = generateExcelPayload(mockRows, mockColumns, mockProject);
    const lines = csvContent.split("\r\n");
    const headers = lines[0].split(",");
    
    // Notes header should be mapped to "Notes"
    expect(headers).toContain("Notes");
    
    // Row values should contain the notes text
    const dataLine = lines[1];
    expect(dataLine).toContain("Use standard high-strength mix.");
  });

  it("calculates subtotals and markups correctly without interactive columns", () => {
    const csvContent = generateExcelPayload(mockRows, mockColumns, mockProject);
    const lines = csvContent.split("\r\n");

    // Header + data row + 4 markup rows = 6 lines
    expect(lines).toHaveLength(6);
    expect(lines[2]).toContain("Overhead Markup (0%)");
    expect(lines[3]).toContain("General Liability (1%)");
    expect(lines[4]).toContain("Contractor Fee (5%)");
    expect(lines[5]).toContain("Sales Tax (0%)");
  });
});
