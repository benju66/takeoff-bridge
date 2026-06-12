/* eslint-disable @typescript-eslint/no-require-imports */
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════
// generate-procore-cost-codes-seed.js — Procore Cost Codes master list, Phase 1
//
// Twin of generate-cost-code-map-seed.js. Deterministically emits
// `supabase_seed_procore_cost_codes.sql` from the Procore export
// `docs/reference/Procore Cost Codes.xlsx` (3 columns: Cost Code | Type |
// Description). Loads the 217 typed codes into the procore_cost_codes table.
//
// The seed uses ON CONFLICT (code) DO NOTHING so re-running it never clobbers a
// Phase 4 lifecycle edit (status/merged_into) or a Phase 2 import-apply edit —
// INSERT-ONLY by design, mirroring the cost_code_map / rate_card seed precedent.
// status defaults to 'active' via the column default (every seeded code is live).
//
// FAIL-LOUD: any row with a missing code/type/description, a type outside the
// CHECK vocabulary, or a duplicate base code aborts the generation — the seed
// must be a clean, total reflection of the reference file or it is not written.
// ═══════════════════════════════════════════════════════════════════

const VALID_TYPES = ['Labor', 'Material', 'Subcontract', 'Equipment'];

const XLSX_PATH = path.join(__dirname, '..', 'docs', 'reference', 'Procore Cost Codes.xlsx');
const OUT_PATH = path.join(__dirname, '..', 'supabase_seed_procore_cost_codes.sql');

function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// Mirror xlsx-reader.ts's cell extraction: handle formula/rich-text cells.
function cellStr(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && v !== null && 'result' in v) return String(v.result ?? '');
  if (typeof v === 'object' && v !== null && 'text' in v) return String(v.text ?? '');
  return String(v);
}

async function readReferenceRows() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX_PATH);
  const ws = wb.worksheets.find((s) => s.rowCount > 1);
  if (!ws) throw new Error(`No data sheet found in ${XLSX_PATH}`);

  // Header check (row 1): Cost Code | Type | Description.
  const header = [1, 2, 3].map((n) => cellStr(ws.getRow(1).getCell(n)).trim().toLowerCase());
  const expected = ['cost code', 'type', 'description'];
  if (header.join('|') !== expected.join('|')) {
    throw new Error(`Unexpected header row: got [${header.join(', ')}], expected [${expected.join(', ')}]`);
  }

  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return; // header
    const code = cellStr(row.getCell(1)).trim();
    const type = cellStr(row.getCell(2)).trim();
    const description = cellStr(row.getCell(3)).trim();
    if (!code && !type && !description) return; // skip fully-blank rows
    rows.push({ rowNumber: n, code, type, description });
  });
  return rows;
}

async function main() {
  const rows = await readReferenceRows();

  const failures = [];
  const seen = new Set();
  const counts = { Labor: 0, Material: 0, Subcontract: 0, Equipment: 0 };

  for (const r of rows) {
    if (!r.code) failures.push(`row ${r.rowNumber}: empty Cost Code`);
    if (!r.description) failures.push(`row ${r.rowNumber}: empty Description for ${r.code}`);
    if (!VALID_TYPES.includes(r.type)) {
      failures.push(`row ${r.rowNumber}: invalid Type "${r.type}" for ${r.code} (must be ${VALID_TYPES.join('/')})`);
    } else {
      counts[r.type] += 1;
    }
    if (seen.has(r.code)) failures.push(`row ${r.rowNumber}: duplicate code ${r.code}`);
    seen.add(r.code);
  }

  if (failures.length > 0) {
    console.error('Seed generation FAILED — reference file problems:');
    failures.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }

  const values = rows
    .map((r) => `  (${sqlQuote(r.code)}, ${sqlQuote(r.type)}, ${sqlQuote(r.description)})`)
    .join(',\n');

  const sql = [
    '-- ═════════════════════════════════════════════════════════════════════',
    '-- procore_cost_codes seed — GENERATED FILE, do not edit by hand.',
    '-- Regenerate with: npm run generate-procore-codes-seed',
    '-- Source: docs/reference/Procore Cost Codes.xlsx (Cost Code | Type | Description)',
    `-- Rows: ${rows.length} (Material: ${counts.Material}, Subcontract: ${counts.Subcontract}, Labor: ${counts.Labor}, Equipment: ${counts.Equipment})`,
    '-- INSERT-ONLY: ON CONFLICT (code) DO NOTHING never clobbers a lifecycle edit.',
    '-- ═════════════════════════════════════════════════════════════════════',
    '',
    'INSERT INTO procore_cost_codes (code, type, description) VALUES',
    values,
    'ON CONFLICT (code) DO NOTHING;',
    '',
  ].join('\n');

  fs.writeFileSync(OUT_PATH, sql, 'utf8');
  console.log(`Wrote ${OUT_PATH}`);
  console.log(
    `  ${rows.length} rows — Material: ${counts.Material}, Subcontract: ${counts.Subcontract}, Labor: ${counts.Labor}, Equipment: ${counts.Equipment}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
