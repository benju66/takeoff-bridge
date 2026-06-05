/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════
// generate-cost-code-map-seed.js — Phase 3a
//
// Deterministically emits `supabase_seed_cost_code_map.sql` (221 rows)
// from the app-owned catalog + the provenance report written by
// `npm run sync-codes`. Provenance → cost_code_map.source:
//   - sibling-inferred                → 'sibling'
//   - user-confirmed (plan §13)       → 'manual'
//   - authoritative BLI SUMIF and the
//     Steps-2/3 division-base codes   → 'template'
// The seed uses ON CONFLICT DO NOTHING so re-running it never clobbers
// manual mapping-editor edits (Phase 3c).
// ═══════════════════════════════════════════════════════════════════

const TEMPLATE_NAME = 'Company_Estimate_Template.xlsx';

const CATALOG_PATH = path.join(__dirname, '..', 'src', 'lib', 'estimate-catalog.json');
const GAPS_PATH = path.join(__dirname, 'output', 'cost-code-gaps.json');
const OUT_PATH = path.join(__dirname, '..', 'supabase_seed_cost_code_map.sql');

function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function main() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const gaps = JSON.parse(fs.readFileSync(GAPS_PATH, 'utf8'));

  const siblingCodes = new Set((gaps.siblingInferred || []).map((e) => e.internalCode));
  const manualCodes = new Set((gaps.userConfirmed || []).map((e) => e.internalCode));

  const itemIds = Object.keys(catalog).sort();
  const failures = [];
  const counts = { template: 0, sibling: 0, manual: 0 };

  const rows = itemIds.map((itemId) => {
    const entry = catalog[itemId];
    if (!entry.procoreCode) {
      failures.push(`${itemId}: empty procoreCode in catalog`);
      return null;
    }
    const source = manualCodes.has(itemId) ? 'manual' : siblingCodes.has(itemId) ? 'sibling' : 'template';
    counts[source] += 1;
    return `  (${sqlQuote(TEMPLATE_NAME)}, ${sqlQuote(itemId)}, ${sqlQuote(entry.procoreCode)}, ${sqlQuote(source)})`;
  });

  if (failures.length > 0) {
    console.error('Seed generation FAILED — catalog entries without procoreCode:');
    failures.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }

  const sql = [
    '-- ═════════════════════════════════════════════════════════════════════',
    '-- cost_code_map seed — GENERATED FILE, do not edit by hand.',
    '-- Regenerate with: npm run generate-seed',
    `-- Source: src/lib/estimate-catalog.json + scripts/output/cost-code-gaps.json`,
    `-- Rows: ${itemIds.length} (template: ${counts.template}, sibling: ${counts.sibling}, manual: ${counts.manual})`,
    '-- ═════════════════════════════════════════════════════════════════════',
    '',
    'INSERT INTO cost_code_map (template_name, internal_code, procore_code, source) VALUES',
    rows.join(',\n'),
    'ON CONFLICT (template_name, internal_code) DO NOTHING;',
    '',
  ].join('\n');

  fs.writeFileSync(OUT_PATH, sql, 'utf8');
  console.log(`Wrote ${OUT_PATH}`);
  console.log(`  ${itemIds.length} rows — template: ${counts.template}, sibling: ${counts.sibling}, manual: ${counts.manual}`);
}

main();
