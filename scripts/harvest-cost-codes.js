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

async function main() {
  const rootDir = path.join(__dirname, '..');
  const templatePath = path.join(rootDir, 'public', 'templates', 'Company_Estimate_Template.xlsx');
  const jsonOutputPath = path.join(rootDir, 'src', 'lib', 'estimate-catalog.json');

  console.log(`Loading spreadsheet template: ${templatePath}`);
  if (!fs.existsSync(templatePath)) {
    console.error(`ERROR: Template file not found at ${templatePath}`);
    process.exit(1);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);

  const worksheet = workbook.getWorksheet("STEP 4 - ESTIMATE");
  if (!worksheet) {
    console.error(`ERROR: Worksheet "STEP 4 - ESTIMATE" not found in template!`);
    process.exit(1);
  }

  const codeRegex = /^\d{2}-\d{4}\.\d{3}$|^\d{2}-\d{4}$/;
  const catalog = {};
  let totalRowsChecked = 0;
  let codesHarvestedCount = 0;

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
      const rawCode = String(cellC.value).trim();
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

        catalog[rawCode] = {
          itemId: rawCode,
          procoreParentCode: procoreParentCode,
          description: description,
          targetUom: uom || "SF",
          defaultUnitPrice: price,
          costType: costType
        };

        codesHarvestedCount++;
      }
    }
  }

  // Write out JSON
  fs.writeFileSync(jsonOutputPath, JSON.stringify(catalog, null, 2), 'utf-8');
  console.log(`\n======================================================`);
  console.log(`SCHEMA HARVEST COMPLETED SUCCESSFULLY!`);
  console.log(`======================================================`);
  console.log(`* Rows analyzed: ${totalRowsChecked}`);
  console.log(`* Cost Codes harvested: ${codesHarvestedCount}`);
  console.log(`* Output catalog path: ${jsonOutputPath}\n`);

  // Report by division
  const divisionCounts = {};
  Object.keys(catalog).forEach(code => {
    const div = code.split("-")[0];
    divisionCounts[div] = (divisionCounts[div] || 0) + 1;
  });

  console.log("Harvest Summary by Division:");
  Object.keys(divisionCounts).sort().forEach(div => {
    console.log(`  - Division ${div}: ${divisionCounts[div]} cost codes`);
  });
  console.log(`======================================================\n`);
}

main().catch(console.error);
