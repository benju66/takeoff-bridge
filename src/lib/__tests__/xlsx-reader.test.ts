/// <reference types="vitest" />

import { parseTogalXLSX } from "@/lib/xlsx-reader";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Helper: create a File-like object from a real .xlsx fixture on disk
// ---------------------------------------------------------------------------
function makeFileFromFixture(filename: string): File {
  const fixturePath = path.resolve(__dirname, "../../../takeoff_data_example.xlsx");
  const buffer = fs.readFileSync(fixturePath);
  return new File([buffer], filename, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// ---------------------------------------------------------------------------
// parseTogalXLSX — Integration Tests
// ---------------------------------------------------------------------------
describe("parseTogalXLSX", () => {

  // -------------------------------------------------------------------------
  // Test 1: Parse real Togal export fixture
  // -------------------------------------------------------------------------
  it("parses the example spreadsheet into correct TogalRowPayload array", async () => {
    const file = makeFileFromFixture("takeoff_data_example.xlsx");
    const result = await parseTogalXLSX(file);

    expect(result.rows.length).toBeGreaterThanOrEqual(4);
    expect(result.sheetNames.length).toBeGreaterThanOrEqual(1);
    expect(result.selectedSheet).toBeTruthy();

    // Verify first row
    const row0 = result.rows[0];
    expect(row0.Classification).toBe("02 - Area");
    expect(row0["Quantity 1"]).toBeCloseTo(274.01, 1);
    expect(row0["Quantity1 UOM"]).toBe("SF");

    // Verify embedded code row
    const footingsRow = result.rows.find(
      (r) => String(r.Classification).includes("Footings"),
    );
    expect(footingsRow).toBeTruthy();
    expect(footingsRow!["Quantity1 UOM"]).toBe("FT");
  });

  // -------------------------------------------------------------------------
  // Test 2: Returns correct structure for empty/minimal workbook
  // -------------------------------------------------------------------------
  it("returns empty rows for a file with no data", async () => {
    // Create a minimal xlsx with only a header row
    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Empty");
    ws.addRow(["Classification", "Quantity 1", "Quantity1 UOM"]);
    const buffer = await wb.xlsx.writeBuffer();
    const file = new File([buffer], "empty.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const result = await parseTogalXLSX(file);
    expect(result.rows).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test 3: Handles formula cells correctly
  // -------------------------------------------------------------------------
  it("extracts formula result values instead of formula strings", async () => {
    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("WithFormulas");
    ws.addRow(["Classification", "Quantity 1", "Quantity1 UOM"]);
    const row = ws.addRow(["Test Item", 0, "SF"]);
    // Simulate a formula cell with a cached result
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    row.getCell(2).value = { formula: "SUM(A1:A10)", result: 42 } as any;

    const buffer = await wb.xlsx.writeBuffer();
    const file = new File([buffer], "formulas.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const result = await parseTogalXLSX(file);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]["Quantity 1"]).toBe(42);
  });

  // -------------------------------------------------------------------------
  // Test 4: Multi-sheet selection
  // -------------------------------------------------------------------------
  it("returns sheet names and allows selecting a specific sheet", async () => {
    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.Workbook();

    const ws1 = wb.addWorksheet("Sheet1");
    ws1.addRow(["Classification", "Quantity 1", "Quantity1 UOM"]);
    ws1.addRow(["Item A", 100, "SF"]);

    const ws2 = wb.addWorksheet("Sheet2");
    ws2.addRow(["Classification", "Quantity 1", "Quantity1 UOM"]);
    ws2.addRow(["Item B", 200, "LF"]);

    const buffer = await wb.xlsx.writeBuffer();
    const file = new File([buffer], "multi.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    // Default: auto-selects first sheet with data
    const result1 = await parseTogalXLSX(file);
    expect(result1.sheetNames).toEqual(["Sheet1", "Sheet2"]);
    expect(result1.selectedSheet).toBe("Sheet1");
    expect(result1.rows[0].Classification).toBe("Item A");

    // Explicit: select Sheet2
    const result2 = await parseTogalXLSX(file, "Sheet2");
    expect(result2.selectedSheet).toBe("Sheet2");
    expect(result2.rows[0].Classification).toBe("Item B");
  });
});
