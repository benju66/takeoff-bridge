/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

// ═══════════════════════════════════════════════════════════════════
// generate-rate-card-seed.js — Rate-card slice 1, Phase A
//
// Twin of generate-cost-code-map-seed.js. Deterministically emits
// `supabase_seed_rate_card.sql` from the src/lib/constants.ts typed
// arrays — the rate-bearing GC/Site Ops default lines, keyed by each
// line's `code`. The seed equals today's constants values, so nothing
// changes value on day one.
//
// Source of rates (imported directly — no second source of truth, no
// regex parsing): the constants.ts is loaded via Node's native TypeScript
// type-stripping (Node 22.6+/24; the typed arrays have no runtime-only TS
// constructs). Each array contributes its rate-bearing lines:
//   - STAFF_ROLE_DEFAULTS        → .defaultRate (all 8 lines)
//   - OPERATIONAL_EXPENSE_DEFAULTS → .rate      (all 13 lines)
//   - GC_MANUAL_DEFAULTS         → .rate, only the entry:"qty" lines (rate != null)
//   - SITE_OPS_DYNAMIC_DEFAULTS  → .rate        (all 3 lines)
//   - SITE_OPS_MANUAL_DEFAULTS   → .rate, only the entry:"qty" lines (rate != null)
// Lump-sum / qty-rate lines (estimator-typed, rate null) carry NO card row.
//
// UPDATE POLICY (twin of cost_code_map, user-approved 2026-06-07): the seed
// is INSERT-ONLY (ON CONFLICT DO NOTHING). Re-running only ADDS rows for
// brand-new rate lines; it NEVER updates an existing row, so a source='manual'
// editor edit (Phase C) is never clobbered. The /rates editor UI is the sole
// update path. Do not "fix" the ON CONFLICT clause.
// ═══════════════════════════════════════════════════════════════════

const TEMPLATE_NAME = 'Company_Estimate_Template.xlsx';

const CONSTANTS_PATH = path.join(__dirname, '..', 'src', 'lib', 'constants.ts');
const OUT_PATH = path.join(__dirname, '..', 'supabase_seed_rate_card.sql');

function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** A line is rate-bearing iff it carries a finite, non-negative numeric rate. */
function isRateBearing(rate) {
  return typeof rate === 'number' && Number.isFinite(rate) && rate >= 0;
}

async function main() {
  const constants = await import(pathToFileURL(CONSTANTS_PATH).href);

  const {
    STAFF_ROLE_DEFAULTS,
    OPERATIONAL_EXPENSE_DEFAULTS,
    GC_MANUAL_DEFAULTS,
    SITE_OPS_DYNAMIC_DEFAULTS,
    SITE_OPS_MANUAL_DEFAULTS,
  } = constants;

  // Each source maps to { code, rate } using its own rate accessor.
  const candidates = [
    ...STAFF_ROLE_DEFAULTS.map((r) => ({ code: r.code, rate: r.defaultRate })),
    ...OPERATIONAL_EXPENSE_DEFAULTS.map((r) => ({ code: r.code, rate: r.rate })),
    ...GC_MANUAL_DEFAULTS.map((r) => ({ code: r.code, rate: r.rate })),
    ...SITE_OPS_DYNAMIC_DEFAULTS.map((r) => ({ code: r.code, rate: r.rate })),
    ...SITE_OPS_MANUAL_DEFAULTS.map((r) => ({ code: r.code, rate: r.rate })),
  ];

  const lines = candidates.filter((c) => isRateBearing(c.rate));

  // Guard: the line `code` is the card key — it MUST be unique across all
  // rate-bearing arrays (PRIMARY KEY (template_name, line_code)).
  const seen = new Map();
  const collisions = [];
  for (const line of lines) {
    if (seen.has(line.code) && seen.get(line.code) !== line.rate) {
      collisions.push(`${line.code}: ${seen.get(line.code)} vs ${line.rate}`);
    }
    seen.set(line.code, line.rate);
  }
  if (collisions.length > 0) {
    console.error('Seed generation FAILED — duplicate line_code with conflicting rate:');
    collisions.forEach((c) => console.error(`  - ${c}`));
    process.exit(1);
  }

  // Deterministic output: one row per unique code, sorted by code.
  const uniqueCodes = [...seen.keys()].sort();
  const rows = uniqueCodes.map(
    (code) => `  (${sqlQuote(TEMPLATE_NAME)}, ${sqlQuote(code)}, ${seen.get(code)}, ${sqlQuote('seed')})`
  );

  const sql = [
    '-- ═════════════════════════════════════════════════════════════════════',
    '-- rate_card seed — GENERATED FILE, do not edit by hand.',
    '-- Regenerate with: npm run generate-rate-card-seed',
    '-- Source: src/lib/constants.ts (rate-bearing GC/Site Ops default lines)',
    `-- Rows: ${rows.length} (all source='seed'; equals today's constants values)`,
    '-- ═════════════════════════════════════════════════════════════════════',
    '',
    'INSERT INTO rate_card (template_name, line_code, rate, source) VALUES',
    rows.join(',\n'),
    'ON CONFLICT (template_name, line_code) DO NOTHING;',
    '',
  ].join('\n');

  fs.writeFileSync(OUT_PATH, sql, 'utf8');
  console.log(`Wrote ${OUT_PATH}`);
  console.log(`  ${rows.length} rows (all source='seed')`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
