/**
 * Phase 3 Slice 3 evidence probe — READ-ONLY dump of the CARE fixture:
 *  1. BLI SUMIF formulas whose criterion points at STEP 2 / STEP 3 (the
 *     workbook's own bare-code -> Procore mapping for GC/Site-Ops lines).
 *  2. Every STEP 2 / STEP 3 line (code, description, qty, uom, rate, total).
 * Usage: node scripts/slice3-probe-step23-sumifs.js
 */
const ExcelJS = require("exceljs");
const path = require("path");

const FIXTURE = path.join(
  __dirname,
  "..",
  "fixtures",
  "past-bids",
  "2026.04.03 CARE Schematic Design Estimate.LIVE.xlsx"
);

const SHEETS = {
  step2: "STEP 2 - GCs",
  step3: "STEP 3 - SITE OPS",
  step4: "STEP 4 - ESTIMATE",
  bli: "Budget Line Items",
};

function reading(cell) {
  if (!cell || cell.value === null || cell.value === undefined)
    return { value: "", formula: null };
  const v = cell.value;
  if (typeof v === "object") {
    if (v.formula !== undefined || v.sharedFormula !== undefined) {
      return {
        value: v.result !== undefined && v.result !== null ? v.result : "",
        formula: v.formula || null,
      };
    }
    if (v.richText) return { value: v.richText.map((t) => t.text).join(""), formula: null };
    if (v.text) return { value: v.text, formula: null };
    return { value: String(v), formula: null };
  }
  return { value: v, formula: null };
}

function splitTopLevelArgs(body) {
  const args = [];
  let depth = 0,
    inQuote = false,
    current = "";
  for (const ch of body) {
    if (ch === "'") inQuote = !inQuote;
    if (!inQuote) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === "," && depth === 0) {
        args.push(current.trim());
        current = "";
        continue;
      }
    }
    current += ch;
  }
  if (current.trim() !== "") args.push(current.trim());
  return args;
}

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// criterion -> { sheetKey, col, row } when it is a single cell ref on a known sheet
function parseCriterion(criterion) {
  if (criterion.includes(":")) return null;
  for (const [key, name] of Object.entries(SHEETS)) {
    if (key === "bli") continue;
    const re = new RegExp(`^'?${esc(name)}'?!\\$?([A-Z]+)\\$?(\\d+)$`, "i");
    const m = re.exec(criterion);
    if (m) return { sheetKey: key, col: m[1].toUpperCase(), row: Number(m[2]) };
  }
  return null;
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FIXTURE);

  const ws = {};
  for (const [key, name] of Object.entries(SHEETS)) {
    ws[key] = wb.getWorksheet(name);
    if (!ws[key]) console.log(`!! sheet not found: ${name}`);
  }

  // ---- 1. BLI SUMIF criteria, classified by target sheet --------------------
  const counts = { step2: 0, step3: 0, step4: 0, other: 0, noFormula: 0, notSumif: 0 };
  const entries = []; // {procore, sheetKey, critCol, critRow, bareCode, desc}
  const bli = ws.bli;
  for (let r = 2; r <= bli.rowCount; r++) {
    const a = reading(bli.getRow(r).getCell("A"));
    const procore = String(a.value ?? "").trim();
    if (!procore.includes("-")) continue;

    const h = reading(bli.getRow(r).getCell("H"));
    if (!h.formula) {
      counts.noFormula++;
      continue;
    }
    const up = h.formula.toUpperCase();
    const open = up.indexOf("SUMIF(");
    if (open < 0) {
      counts.notSumif++;
      console.log(`  [non-SUMIF] BLI r${r} ${procore}: =${h.formula}`);
      continue;
    }
    const body = h.formula.slice(open + "SUMIF(".length, h.formula.lastIndexOf(")"));
    const args = splitTopLevelArgs(body);
    if (args.length < 3) continue;
    const crit = parseCriterion(args[1]);
    if (!crit) {
      counts.other++;
      console.log(`  [odd criterion] BLI r${r} ${procore}: ${args[1]}`);
      continue;
    }
    counts[crit.sheetKey]++;
    if (crit.sheetKey === "step2" || crit.sheetKey === "step3") {
      const target = ws[crit.sheetKey];
      const code = String(reading(target.getRow(crit.row).getCell("C")).value ?? "").trim();
      const desc = String(reading(target.getRow(crit.row).getCell("D")).value ?? "").trim();
      entries.push({
        bliRow: r,
        procore,
        sheetKey: crit.sheetKey,
        criterion: `${crit.col}${crit.row}`,
        bareCode: code,
        desc,
        sumRange: args[0],
        sumCol: args[2],
      });
    }
  }

  console.log("\n===== BLI SUMIF criterion sheets =====");
  console.log(JSON.stringify(counts, null, 2));

  console.log("\n===== STEP 2/3-pointing BLI SUMIFs =====");
  for (const e of entries) {
    console.log(
      `BLI r${e.bliRow} ${e.procore} <- ${e.sheetKey}!${e.criterion} code='${e.bareCode}' desc='${e.desc}' sum=${e.sumRange}|${e.sumCol}`
    );
  }

  // conflicts: one bare code claimed by 2+ procore codes (per sheet)
  for (const sheetKey of ["step2", "step3"]) {
    const byCode = new Map();
    for (const e of entries.filter((x) => x.sheetKey === sheetKey && x.bareCode)) {
      const set = byCode.get(e.bareCode) ?? new Set();
      set.add(e.procore);
      byCode.set(e.bareCode, set);
    }
    const conflicts = [...byCode.entries()].filter(([, s]) => s.size > 1);
    console.log(
      `\n${sheetKey}: ${byCode.size} distinct bare codes, ${conflicts.length} claimed by 2+ procore codes`
    );
    for (const [code, set] of conflicts) console.log(`  CONFLICT ${code}: ${[...set].join(", ")}`);
  }

  // ---- 2. All STEP 2/3 lines ------------------------------------------------
  const BARE = /^\d{2}-\d{4}$/;
  const SUFFIXED = /^\d{2}-\d{4}\.\d{3}$/;
  for (const sheetKey of ["step2", "step3"]) {
    const sheet = ws[sheetKey];
    console.log(`\n===== ${SHEETS[sheetKey]} lines =====`);
    for (let r = 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const code = String(reading(row.getCell("C")).value ?? "").trim();
      if (!BARE.test(code) && !SUFFIXED.test(code)) continue;
      const desc = String(reading(row.getCell("D")).value ?? "").trim();
      const qty = reading(row.getCell("F")).value;
      const uom = String(reading(row.getCell("G")).value ?? "").trim();
      const rate = reading(row.getCell("H")).value;
      const total = reading(row.getCell("I")).value;
      console.log(
        `r${r}: ${code} '${desc}' qty=${qty} uom=${uom} rate=${rate} total=${total}`
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
