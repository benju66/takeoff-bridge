/* eslint-disable @typescript-eslint/no-require-imports */
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

// Mappings preserved from original mock-data.ts
const ORIGINAL_MOCK_COST_TYPES = {
  "01-0000": "L", "01-0400": "L", "01-0230": "L",
  "02-4100": "S", "02-9010": "L", "02-9020": "M", "02-9200.001": "L",
  "03-0000.001": "S", "03-0000.002": "S", "03-0000.003": "S", "03-0000.004": "S",
  "03-0000.005": "S", "03-0000.006": "S", "03-0000.007": "S", "03-0000.008": "S",
  "03-0000.009": "S", "03-0000.010": "S", "03-0000.011": "S", "03-3543.001": "S",
  "04-0000.001": "M", "04-0000.002": "S", "04-0000.003": "S", "04-0000.004": "S",
  "05-0000.001": "S", "05-0000.002": "S", "05-0000.003": "S", "05-0000.004": "S",
  "05-0000.005": "S",
  "06-1000.001": "S", "06-1100.001": "M", "06-1200.001": "M",
  "07-0000.001": "S", "07-0000.002": "S", "07-0000.003": "S", "07-0000.004": "S",
  "07-0000.005": "S", "07-0000.006": "S",
  "08-1100.001": "M", "08-2000.001": "M", "08-5000.001": "M", "08-7100.001": "M",
  "09-2200.001": "S", "09-2900.001": "S", "09-2900.002": "S", "09-6000.001": "S",
  "09-9000.001": "S"
};

// Known template typos in STEP 4 column C. Normalized on read so the affected
// rows harvest into the catalog and match their Budget Line Items criteria.
// User-approved 2026-06-04.
const TYPO_NORMALIZATION = {
  "03-4500.0002": "03-4500.001", // Precast Architectural Concrete
  "07-6100.01": "07-6100.001"    // Metal Roofing
};

// User-confirmed Procore destinations (2026-06-04) for catalog codes that have
// no Budget Line Items SUMIF criterion of their own. Never inferred by the agent.
const USER_CONFIRMED_PROCORE_CODES = {
  "12-3570.001": "6-64100.000",   // Healthcare Casework & FFE -> Architectural Casework and Millwork
  "22-4129.001": "22-220000.000", // Shower Pans -> Plumbing division base
  "80-8002.002": "80-800001.000", // TBD allowances all roll up to 80-800001.000
  "80-8003.003": "80-800001.000",
  "80-8004.004": "80-800001.000",
  "80-8005.005": "80-800001.000",
  "80-8006.006": "80-800001.000"
};

// GC / Site-Ops codes verified (2026-06-04) to roll up from the STEP 2 - GCs and
// STEP 3 - SITE OPS sheets, NOT from STEP 4 line items. The division base is kept
// as a fallback destination so app-entered dollars never silently drop.
const STEPS_2_3_FALLBACK_CODES = {
  "01-0000.001": "1-10000.000",
  "01-0400.002": "1-10000.000",
  "02-0000.001": "2-20000.000",
  "02-4100.002": "2-20000.000",
  "02-9005.003": "2-20000.000",
  "02-9070.004": "2-20000.000",
  "02-9200.005": "2-20000.000",
  "02-9300.006": "2-20000.000",
  "02-9400.007": "2-20000.000",
  "02-9500.008": "2-20000.000"
};

const ESTIMATE_SHEET = "STEP 4 - ESTIMATE";
const BUDGET_LINE_ITEMS_SHEET = "Budget Line Items";
const IMPORTER_SHEET = "Importer Data Fields";

function determineCostType(code, description) {
  if (ORIGINAL_MOCK_COST_TYPES[code]) {
    return ORIGINAL_MOCK_COST_TYPES[code];
  }

  const descLower = (description || "").toLowerCase();
  if (
    descLower.includes("labor") ||
    descLower.includes("supervision") ||
    descLower.includes("superintendent") ||
    descLower.includes("pm ") ||
    descLower.includes("project manager") ||
    descLower.includes("engineer") ||
    descLower.includes("executive")
  ) {
    return "L";
  }

  if (
    descLower.includes("material") ||
    descLower.includes("supply") ||
    descLower.includes("purchase") ||
    descLower.includes("lumber") ||
    descLower.includes("steel") ||
    descLower.includes("door") ||
    descLower.includes("window") ||
    descLower.includes("barrier") ||
    descLower.includes("shingle") ||
    descLower.includes("hardware") ||
    descLower.includes("concrete") ||
    descLower.includes("studs") ||
    descLower.includes("timber")
  ) {
    return "M";
  }

  return "S"; // Subcontract fallback
}

// Coarse division-parent rollup, preserved for back-compat until Phase 2
// unifies the CSV export path onto the granular procoreCode.
function resolveProcoreParentCode(code) {
  const parts = code.split("-");
  const divStr = parts[0];
  const division = parseInt(divStr, 10);

  if (isNaN(division)) {
    return "1-10000.000";
  }

  switch (division) {
    case 1: return "1-10000.000";
    case 2: return "2-20000.000";
    case 3: return "3-30000.000";
    case 4: return "4-40000.000";
    case 5: return "5-50000.000";
    case 6: return "6-60000.000";
    case 7: return "7-70000.000";
    case 8: return "8-80000.000";
    case 9: return "9-90000.000";
    default:
      return `${division}-${division}0000.000`;
  }
}

function cellText(cell) {
  const v = cell ? cell.value : null;
  if (v == null) return "";
  if (typeof v === "object") {
    if (v.result !== undefined && v.result !== null) return String(v.result).trim();
    if (v.richText) return v.richText.map((r) => r.text).join("").trim();
    if (v.text) return String(v.text).trim();
    return "";
  }
  return String(v).trim();
}

function cellFormula(cell) {
  if (!cell) return null;
  if (cell.formula) return cell.formula;
  const v = cell.value;
  if (v && typeof v === "object" && v.formula) return v.formula;
  return null;
}

function normalizeInternalCode(raw) {
  const trimmed = String(raw || "").trim();
  return TYPO_NORMALIZATION[trimmed] || trimmed;
}

/**
 * Build the authoritative internal-code -> granular Procore code map by parsing
 * the Budget Line Items sheet. Each data row's column H holds
 *   SUMIF('<source>'!$C$a:$C$b, '<source>'!C<n>, '<source>'!$I$a:$I$b)
 * The criterion cell C<n> on the source sheet holds the internal code; column A
 * of the Budget Line Items row holds the granular Procore code.
 * Only STEP 4-sourced rows feed the line-item map (STEP 2/3 rows are GC/Site-Ops).
 */
function buildAuthoritativeMap(workbook) {
  const bli = workbook.getWorksheet(BUDGET_LINE_ITEMS_SHEET);
  if (!bli) {
    throw new Error(`Worksheet "${BUDGET_LINE_ITEMS_SHEET}" not found in template!`);
  }
  const step4 = workbook.getWorksheet(ESTIMATE_SHEET);

  // Precisely parse the SUMIF arguments: range sheet, criterion sheet + cell.
  const sumifRe = /SUMIF\(\s*'([^']+)'!\$?[A-Z]+\$?\d+:\$?[A-Z]+\$?\d+\s*,\s*'([^']+)'!\$?([A-Z]+)\$?(\d+)\s*,/i;

  const map = {};      // internal code -> procore code
  const conflicts = []; // same internal code claimed by two BLI rows

  bli.eachRow((row, rowNumber) => {
    const formula = cellFormula(row.getCell(8)); // column H
    if (!formula) return;

    const procoreCode = cellText(row.getCell(1)); // column A
    if (!procoreCode) return;

    const m = formula.match(sumifRe);
    if (!m) return; // e.g. the known #REF!-broken 1-10000.000 row
    const [, , criterionSheet, criterionCol, criterionRow] = m;
    if (criterionSheet !== ESTIMATE_SHEET) return; // STEP 2/3 rows handled by those sheets

    const criterionCell = step4.getRow(Number(criterionRow)).getCell(criterionCol);
    const internalCode = normalizeInternalCode(cellText(criterionCell));
    if (!internalCode) return;

    if (map[internalCode] && map[internalCode] !== procoreCode) {
      conflicts.push({ internalCode, a: map[internalCode], b: procoreCode, bliRow: rowNumber });
      return;
    }
    map[internalCode] = procoreCode;
  });

  return { map, conflicts };
}

/** Collect the set of valid Procore codes from the Importer Data Fields sheet. */
function buildImporterCodeSet(workbook) {
  const importer = workbook.getWorksheet(IMPORTER_SHEET);
  if (!importer) {
    throw new Error(`Worksheet "${IMPORTER_SHEET}" not found in template!`);
  }
  const procoreCodeRe = /^\d{1,2}-\d{4,6}\.\d{3}$/;
  const codes = new Set();
  importer.eachRow((row) => {
    row.eachCell((cell) => {
      const v = cellText(cell);
      if (procoreCodeRe.test(v)) codes.add(v);
    });
  });
  return codes;
}

/**
 * Resolve the granular Procore code for one internal catalog code.
 * Resolution order: template SUMIF (authoritative) -> verified Steps 2/3 fallback
 * -> user-confirmed override -> sibling inference. Anything else is unresolved —
 * never guessed.
 */
function resolveProcoreCode(internalCode, authoritativeMap) {
  if (authoritativeMap[internalCode]) {
    return { procoreCode: authoritativeMap[internalCode], basis: "template-sumif" };
  }
  if (STEPS_2_3_FALLBACK_CODES[internalCode]) {
    return { procoreCode: STEPS_2_3_FALLBACK_CODES[internalCode], basis: "steps-2-3" };
  }
  if (USER_CONFIRMED_PROCORE_CODES[internalCode]) {
    return { procoreCode: USER_CONFIRMED_PROCORE_CODES[internalCode], basis: "user-confirmed" };
  }

  // Sibling inference: another code with the same "XX-YYYY." prefix that has an
  // authoritative mapping. Prefer the lowest numeric suffix (.000/.001 first).
  const prefix = internalCode.split(".")[0];
  const siblings = Object.keys(authoritativeMap)
    .filter((code) => code.split(".")[0] === prefix)
    .sort((a, b) => Number(a.split(".")[1]) - Number(b.split(".")[1]));
  if (siblings.length > 0) {
    const distinctTargets = new Set(siblings.map((s) => authoritativeMap[s]));
    if (distinctTargets.size > 1) {
      return { procoreCode: "", basis: "ambiguous-siblings", siblings };
    }
    return {
      procoreCode: authoritativeMap[siblings[0]],
      basis: "sibling",
      sibling: siblings[0]
    };
  }

  return { procoreCode: "", basis: "unresolved" };
}

async function main() {
  const rootDir = path.join(__dirname, '..');
  const templatePath = path.join(rootDir, 'public', 'templates', 'Company_Estimate_Template.xlsx');
  const jsonOutputPath = path.join(rootDir, 'src', 'lib', 'estimate-catalog.json');
  const gapsOutputDir = path.join(__dirname, 'output');
  const gapsOutputPath = path.join(gapsOutputDir, 'cost-code-gaps.json');

  console.log(`Loading spreadsheet template: ${templatePath}`);
  if (!fs.existsSync(templatePath)) {
    console.error(`ERROR: Template file not found at ${templatePath}`);
    process.exit(1);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);

  const worksheet = workbook.getWorksheet(ESTIMATE_SHEET);
  if (!worksheet) {
    console.error(`ERROR: Worksheet "${ESTIMATE_SHEET}" not found in template!`);
    process.exit(1);
  }

  // --- Granular Procore mapping sources -----------------------------------
  const { map: authoritativeMap, conflicts } = buildAuthoritativeMap(workbook);
  const importerCodes = buildImporterCodeSet(workbook);
  console.log(`Authoritative SUMIF mappings found: ${Object.keys(authoritativeMap).length}`);
  console.log(`Importer Data Fields valid codes:   ${importerCodes.size}`);
  if (conflicts.length > 0) {
    console.error(`ERROR: conflicting SUMIF criteria detected:`);
    conflicts.forEach((c) => console.error(`  ${c.internalCode}: ${c.a} vs ${c.b} (BLI row ${c.bliRow})`));
    process.exit(1);
  }

  const codeRegex = /^\d{2}-\d{4}\.\d{3}$|^\d{2}-\d{4}$/;
  const catalog = {};
  let totalRowsChecked = 0;
  let codesHarvestedCount = 0;

  // Gap report buckets — every non-authoritative resolution is recorded here.
  const gaps = {
    generatedAt: new Date().toISOString(),
    templatePath: 'public/templates/Company_Estimate_Template.xlsx',
    summary: {},
    siblingInferred: [],
    userConfirmed: [],
    handledBySteps2And3: [],
    normalizedTypos: [],
    unresolved: [],
    invalidProcoreCodes: []
  };

  // Scan worksheet from Row 10 to end of sheet to harvest cost codes
  const maxRow = worksheet.actualRowCount || 350;
  for (let r = 10; r <= maxRow + 50; r++) {
    totalRowsChecked++;

    // Column H has SUBTOTAL indicator
    const cellH = worksheet.getCell(`H${r}`);
    if (cellH && cellH.value) {
      const valStr = String(cellH.value).trim();
      if (valStr.toUpperCase() === "SUBTOTAL") {
        break; // Stop at SUBTOTAL
      }
    }

    // Column C has Code
    const cellC = worksheet.getCell(`C${r}`);
    if (cellC && cellC.value) {
      const rawValue = String(cellC.value).trim();
      const rawCode = normalizeInternalCode(rawValue);
      if (rawValue !== rawCode) {
        gaps.normalizedTypos.push({ row: r, from: rawValue, to: rawCode });
      }
      if (codeRegex.test(rawCode)) {
        // Read other fields
        const description = String(worksheet.getCell(`D${r}`).value || "").trim();
        const uom = String(worksheet.getCell(`G${r}`).value || "SF").trim().toUpperCase();

        // Price cell
        let price = 0;
        const cellPrice = worksheet.getCell(`H${r}`).value;
        if (typeof cellPrice === 'number') {
          price = cellPrice;
        } else if (cellPrice && typeof cellPrice === 'object' && cellPrice.result !== undefined) {
          price = Number(cellPrice.result) || 0;
        } else if (cellPrice) {
          // If it's a formula, we ignore/skip or read price
          const priceStr = String(cellPrice).replace(/[^0-9.]/g, '');
          price = parseFloat(priceStr) || 0;
        }

        const costType = determineCostType(rawCode, description);
        const procoreParentCode = resolveProcoreParentCode(rawCode);
        const resolution = resolveProcoreCode(rawCode, authoritativeMap);
        const isDuplicateRow = Boolean(catalog[rawCode]);

        // Gap-report each unique code once; duplicate col-C rows skip straight
        // to the catalog overwrite below (preserving original harvest behavior).
        if (!isDuplicateRow) switch (resolution.basis) {
          case "sibling":
            gaps.siblingInferred.push({
              internalCode: rawCode, description,
              procoreCode: resolution.procoreCode, viaSibling: resolution.sibling
            });
            break;
          case "user-confirmed":
            gaps.userConfirmed.push({
              internalCode: rawCode, description, procoreCode: resolution.procoreCode
            });
            break;
          case "steps-2-3":
            gaps.handledBySteps2And3.push({
              internalCode: rawCode, description,
              fallbackProcoreCode: resolution.procoreCode,
              note: "Dollars roll up from STEP 2 - GCs / STEP 3 - SITE OPS; division base is a fallback so app-entered dollars never silently drop."
            });
            break;
          case "ambiguous-siblings":
          case "unresolved":
            gaps.unresolved.push({
              internalCode: rawCode, description, basis: resolution.basis,
              siblings: resolution.siblings || []
            });
            break;
          default:
            break; // template-sumif: authoritative, not a gap
        }

        if (!isDuplicateRow && resolution.procoreCode && !importerCodes.has(resolution.procoreCode)) {
          gaps.invalidProcoreCodes.push({
            internalCode: rawCode, procoreCode: resolution.procoreCode, basis: resolution.basis
          });
        }

        catalog[rawCode] = {
          itemId: rawCode,
          procoreParentCode: procoreParentCode,
          procoreCode: resolution.procoreCode,
          description: description,
          targetUom: uom || "SF",
          defaultUnitPrice: price,
          costType: costType
        };

        if (!isDuplicateRow) codesHarvestedCount++;
      }
    }
  }

  gaps.summary = {
    catalogCodes: codesHarvestedCount,
    authoritative: codesHarvestedCount - gaps.siblingInferred.length - gaps.userConfirmed.length
      - gaps.handledBySteps2And3.length - gaps.unresolved.length,
    siblingInferred: gaps.siblingInferred.length,
    userConfirmed: gaps.userConfirmed.length,
    handledBySteps2And3: gaps.handledBySteps2And3.length,
    normalizedTypos: gaps.normalizedTypos.length,
    unresolved: gaps.unresolved.length,
    invalidProcoreCodes: gaps.invalidProcoreCodes.length
  };

  fs.mkdirSync(gapsOutputDir, { recursive: true });
  fs.writeFileSync(gapsOutputPath, JSON.stringify(gaps, null, 2), 'utf-8');

  // Hard gate: no catalog entry may ship without a valid granular Procore code.
  if (gaps.unresolved.length > 0 || gaps.invalidProcoreCodes.length > 0) {
    console.error(`\nERROR: unresolved or invalid Procore mappings detected — catalog NOT written.`);
    console.error(`  Unresolved: ${gaps.unresolved.length}`);
    gaps.unresolved.forEach((g) => console.error(`    ${g.internalCode} (${g.basis})`));
    console.error(`  Invalid (not in ${IMPORTER_SHEET}): ${gaps.invalidProcoreCodes.length}`);
    gaps.invalidProcoreCodes.forEach((g) => console.error(`    ${g.internalCode} -> ${g.procoreCode} (${g.basis})`));
    console.error(`  Full report: ${gapsOutputPath}`);
    process.exit(1);
  }

  // Write out JSON
  fs.writeFileSync(jsonOutputPath, JSON.stringify(catalog, null, 2), 'utf-8');
  console.log(`\n======================================================`);
  console.log(`SCHEMA HARVEST COMPLETED SUCCESSFULLY!`);
  console.log(`======================================================`);
  console.log(`* Rows analyzed: ${totalRowsChecked}`);
  console.log(`* Cost Codes harvested: ${codesHarvestedCount}`);
  console.log(`* Output catalog path: ${jsonOutputPath}`);
  console.log(`* Gap report: ${gapsOutputPath}\n`);

  console.log("Granular Procore mapping summary:");
  Object.entries(gaps.summary).forEach(([k, v]) => console.log(`  - ${k}: ${v}`));

  // Report by division
  const divisionCounts = {};
  Object.keys(catalog).forEach(code => {
    const div = code.split("-")[0];
    divisionCounts[div] = (divisionCounts[div] || 0) + 1;
  });

  console.log("\nHarvest Summary by Division:");
  Object.keys(divisionCounts).sort().forEach(div => {
    console.log(`  - Division ${div}: ${divisionCounts[div]} cost codes`);
  });
  console.log(`======================================================\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
