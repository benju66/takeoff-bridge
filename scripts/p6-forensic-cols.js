/**
 * Phase 6 forensic read — STEP 4 col S/R check formulas (rows 11-25) and raw
 * shared-formula structure of STEP 2/3 F/H/I cells (master vs dependent).
 * Read-only. Usage: node scripts/p6-forensic-cols.js
 */
const JSZip = require("jszip");
const fs = require("fs");
const path = require("path");

const TEMPLATE = path.join(__dirname, "..", "templates", "Company_Estimate_Template.xlsx");

async function main() {
  const buf = fs.readFileSync(TEMPLATE);
  const zip = await JSZip.loadAsync(buf);

  // STEP 2 = sheet5, STEP 3 = sheet6, STEP 4 = sheet7 (per Phase 1 findings)
  const step4 = await zip.file("xl/worksheets/sheet7.xml").async("string");
  const step2 = await zip.file("xl/worksheets/sheet5.xml").async("string");
  const step3 = await zip.file("xl/worksheets/sheet6.xml").async("string");

  console.log("===== STEP 4 rows 11-25, cols Q/R/S/T raw cells =====");
  for (let r = 11; r <= 25; r++) {
    for (const c of ["Q", "R", "S", "T"]) {
      const re = new RegExp(`<c r="${c}${r}"[^>]*>(?:(?!</c>)[\\s\\S])*</c>|<c r="${c}${r}"[^/>]*/>`);
      const m = step4.match(re);
      if (m && m[0].includes("<f")) console.log(m[0]);
    }
  }

  // Shared formula masters/dependents on STEP 2/3 for cols E,F,H,I
  for (const [name, xml] of [["STEP 2", step2], ["STEP 3", step3]]) {
    console.log(`\n===== ${name} — cells in E/F/H with <f> tags (raw) =====`);
    const cellRe = /<c r="([EFH])(\d+)"[^>]*>([\s\S]*?)<\/c>/g;
    let m;
    while ((m = cellRe.exec(xml)) !== null) {
      if (m[3].includes("<f")) {
        console.log(`${m[1]}${m[2]}: ${m[3].replace(/<v>[^<]*<\/v>/, "").trim()}`);
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
