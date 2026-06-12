// One-off read-only probe: which STEP 2/3 cells carry formulas vs typed values
// in the CARE bid? Informs the roadmap item 2 (active import) design conversation.
const ExcelJS = require("exceljs");

const FILE = "fixtures/past-bids/2026.04.03 CARE Schematic Design Estimate.LIVE.xlsx";

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);

  const sheets = wb.worksheets.map((ws) => ws.name);
  console.log("SHEETS:", JSON.stringify(sheets));

  for (const ws of wb.worksheets) {
    if (!/step\s*2|step\s*3/i.test(ws.name)) continue;
    console.log(`\n===== ${ws.name} =====`);
    let formulaRows = 0;
    let valueOnlyDollarRows = 0;
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells = [];
      let hasDollar = false;
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        if (v && typeof v === "object" && v.formula) {
          cells.push(`${cell.address}=${v.formula}`);
        } else if (typeof v === "number" && v !== 0) {
          hasDollar = true;
        }
      });
      if (cells.length > 0) {
        formulaRows++;
        if (formulaRows <= 40) {
          const label = row.getCell(2).text || row.getCell(1).text || "";
          console.log(
            `r${rowNumber} [${String(label).slice(0, 38)}] ${cells.slice(0, 6).join(" | ")}`
          );
        }
      } else if (hasDollar) {
        valueOnlyDollarRows++;
        const label = row.getCell(2).text || row.getCell(1).text || "";
        if (valueOnlyDollarRows <= 15)
          console.log(`r${rowNumber} [VALUES-ONLY] [${String(label).slice(0, 38)}]`);
      }
    });
    console.log(
      `-- ${ws.name}: ${formulaRows} rows with formulas, ${valueOnlyDollarRows} numeric rows with NO formulas`
    );
  }
}

main().catch((e) => {
  console.error("PROBE FAILED:", e.message);
  process.exit(1);
});
