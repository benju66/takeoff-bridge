/**
 * Phase 6 manual verification — inspect the generated artifact's STEP 2/3
 * detail, subtotal values, and STEP 4 linked-row writes side by side.
 * Read-only. Usage: node scripts/p6-inspect-artifact.js
 */
const ExcelJS = require("exceljs");
const path = require("path");

const FILE = path.join(__dirname, "output", "p6-manual-export.xlsx");

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
  await wb.xlsx.readFile(FILE);

  for (const name of ["STEP 2 - GCs", "STEP 3 - SITE OPS"]) {
    const ws = wb.getWorksheet(name);
    console.log(`\n===== ${name} =====`);
    for (let r = 10; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const parts = ["C", "D", "E", "F", "G", "H", "I"]
        .map((c) => {
          const t = cellText(row.getCell(c));
          return t ? `${c}=${t}` : "";
        })
        .filter(Boolean);
      if (parts.length) console.log(`r${r}: ${parts.join(" | ")}`);
    }
  }

  const s4 = wb.getWorksheet("STEP 4 - ESTIMATE");
  console.log("\n===== STEP 4 rows 12-24 (F/H/I/S) =====");
  for (let r = 12; r <= 24; r++) {
    const row = s4.getRow(r);
    const parts = ["C", "D", "F", "H", "I", "S"]
      .map((c) => {
        const t = cellText(row.getCell(c));
        return t ? `${c}=${t}` : "";
      })
      .filter(Boolean);
    if (parts.length) console.log(`r${r}: ${parts.join(" | ")}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
