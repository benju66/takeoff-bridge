/**
 * Phase 4 forensic read — dump STEP 2 / STEP 3 source rows + BLI col B cost types.
 * Read-only. Usage: node scripts/phase4-forensic-step23.js
 */
const ExcelJS = require("exceljs");
const path = require("path");

const TEMPLATE = path.join(__dirname, "..", "templates", "Company_Estimate_Template.xlsx");

function cellText(cell) {
  if (!cell || cell.value === null || cell.value === undefined) return "";
  const v = cell.value;
  if (typeof v === "object") {
    if (v.formula !== undefined || v.sharedFormula !== undefined) {
      const f = v.formula || `(shared:${v.sharedFormula})`;
      const r = v.result !== undefined ? JSON.stringify(v.result) : "";
      return `=${f} ->${r}`;
    }
    if (v.richText) return v.richText.map((t) => t.text).join("");
    if (v.text) return v.text;
    return JSON.stringify(v);
  }
  return String(v);
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE);

  for (const name of ["STEP 2 - GCs", "STEP 3 - SITE OPS"]) {
    const ws = wb.getWorksheet(name);
    if (!ws) {
      console.log(`!! sheet not found: ${name}`);
      console.log("Sheets:", wb.worksheets.map((w) => w.name).join(" | "));
      continue;
    }
    console.log(`\n===== ${name} (rows 1-${ws.rowCount}) =====`);
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const cols = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
      const parts = cols
        .map((c) => {
          const t = cellText(row.getCell(c));
          return t ? `${c}=${t}` : "";
        })
        .filter(Boolean);
      if (parts.length) console.log(`r${r}: ${parts.join(" | ")}`);
    }
  }

  // BLI col A (procore code) + col B (cost type) for STEP2/3-sourced rows
  const bli = wb.getWorksheet("Budget Line Items");
  if (bli) {
    console.log(`\n===== Budget Line Items colA/colB (rows 1-90) =====`);
    for (let r = 1; r <= 90; r++) {
      const a = cellText(bli.getRow(r).getCell("A"));
      const b = cellText(bli.getRow(r).getCell("B"));
      if (a || b) console.log(`r${r}: A=${a} | B=${b}`);
    }
  } else {
    console.log("!! Budget Line Items sheet not found");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
