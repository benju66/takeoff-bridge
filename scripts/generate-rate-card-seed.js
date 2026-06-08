/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

// ═══════════════════════════════════════════════════════════════════
// generate-rate-card-seed.js — Rate-card slices 1 + 2, Phase A
//
// Twin of generate-cost-code-map-seed.js. Deterministically emits
// `supabase_seed_rate_card.sql` from TWO sources, both keyed into the same
// rate_card table (PK (template_name, line_code)). The seed equals today's
// values for both sources, so nothing changes value on day one.
//
// SOURCE 1 — Slice 1: GC/Site Ops default lines (src/lib/constants.ts typed
// arrays), keyed by each line's `code`. constants.ts is loaded via Node's
// native TypeScript type-stripping (Node 22.6+/24; the typed arrays have no
// runtime-only TS constructs). Each array contributes its rate-bearing lines:
//   - STAFF_ROLE_DEFAULTS        → .defaultRate (all 8 lines)
//   - OPERATIONAL_EXPENSE_DEFAULTS → .rate      (all 13 lines)
//   - GC_MANUAL_DEFAULTS         → .rate, only the entry:"qty" lines (rate != null)
//   - SITE_OPS_DYNAMIC_DEFAULTS  → .rate        (all 3 lines)
//   - SITE_OPS_MANUAL_DEFAULTS   → .rate, only the entry:"qty" lines (rate != null)
// Lump-sum / qty-rate lines (estimator-typed, rate null) carry NO card row.
// Filter: rate must be a finite number >= 0 (isRateBearing).
//
// SOURCE 2 — Slice 2: the 221 STEP 4 catalog unit prices
// (src/lib/estimate-catalog.json), keyed by each entry's `itemId`,
// rate = defaultUnitPrice. Filter: FINITE NUMBER ONLY — catalog prices can be
// legitimately $0 (64 lines), NEGATIVE (intentional deductions, e.g.
// 03-5413.002 = -2), or the 0.001 placeholder (5 lines); every line stays
// editable, so the GC/Site Ops `>= 0` gate does NOT apply here.
//
// The two key spaces are disjoint (verified 0 collision), so both coexist in
// rate_card. The collision guard below runs across the COMBINED key set.
//
// UPDATE POLICY (twin of cost_code_map, user-approved 2026-06-07): the seed
// is INSERT-ONLY (ON CONFLICT DO NOTHING). Re-running only ADDS rows for
// brand-new rate lines; it NEVER updates an existing row, so a source='manual'
// editor edit (Phase C) is never clobbered. The /rates editor UI is the sole
// update path. Do not "fix" the ON CONFLICT clause.
// ═══════════════════════════════════════════════════════════════════

const TEMPLATE_NAME = 'Company_Estimate_Template.xlsx';

const CONSTANTS_PATH = path.join(__dirname, '..', 'src', 'lib', 'constants.ts');
const CATALOG_PATH = path.join(__dirname, '..', 'src', 'lib', 'estimate-catalog.json');
const OUT_PATH = path.join(__dirname, '..', 'supabase_seed_rate_card.sql');

function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** A GC/Site Ops line is rate-bearing iff it carries a finite, non-negative numeric rate. */
function isRateBearing(rate) {
  return typeof rate === 'number' && Number.isFinite(rate) && rate >= 0;
}

/** A catalog line is seedable iff its price is a finite number (negatives/$0/0.001 kept). */
function isFiniteRate(rate) {
  return typeof rate === 'number' && Number.isFinite(rate);
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

  // ── SOURCE 1: GC/Site Ops (Slice 1) — each array maps to { code, rate }. ──
  const gcCandidates = [
    ...STAFF_ROLE_DEFAULTS.map((r) => ({ code: r.code, rate: r.defaultRate })),
    ...OPERATIONAL_EXPENSE_DEFAULTS.map((r) => ({ code: r.code, rate: r.rate })),
    ...GC_MANUAL_DEFAULTS.map((r) => ({ code: r.code, rate: r.rate })),
    ...SITE_OPS_DYNAMIC_DEFAULTS.map((r) => ({ code: r.code, rate: r.rate })),
    ...SITE_OPS_MANUAL_DEFAULTS.map((r) => ({ code: r.code, rate: r.rate })),
  ];
  const gcLines = gcCandidates.filter((c) => isRateBearing(c.rate));

  // ── SOURCE 2: catalog (Slice 2) — one row per itemId, finite-only filter. ──
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const catLines = Object.values(catalog)
    .map((entry) => ({ code: entry.itemId, rate: entry.defaultUnitPrice }))
    .filter((c) => isFiniteRate(c.rate));

  // Guard: line_code is the card key — it MUST be unique across the COMBINED
  // key set (PRIMARY KEY (template_name, line_code)). The two sources are
  // verified disjoint; any overlap (or an intra-source conflict) is fatal.
  const seen = new Map();
  const collisions = [];
  for (const line of [...gcLines, ...catLines]) {
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

  // Deterministic output: one row per unique code, sorted by code within each
  // block. GC/Site Ops block first (stable diff for Slice 1), catalog after.
  const toRow = (code) =>
    `  (${sqlQuote(TEMPLATE_NAME)}, ${sqlQuote(code)}, ${seen.get(code)}, ${sqlQuote('seed')})`;
  const gcCodes = [...new Set(gcLines.map((l) => l.code))].sort();
  const catCodes = [...new Set(catLines.map((l) => l.code))].sort();
  const rows = [...gcCodes, ...catCodes].map(toRow);

  const sql = [
    '-- ═════════════════════════════════════════════════════════════════════',
    '-- rate_card seed — GENERATED FILE, do not edit by hand.',
    '-- Regenerate with: npm run generate-rate-card-seed',
    '-- Source 1: src/lib/constants.ts (rate-bearing GC/Site Ops default lines)',
    '-- Source 2: src/lib/estimate-catalog.json (STEP 4 catalog unit prices)',
    `-- Rows: ${rows.length} (${gcCodes.length} GC/Site Ops + ${catCodes.length} catalog;`,
    "--       all source='seed'; equals today's constants + catalog values)",
    '-- ═════════════════════════════════════════════════════════════════════',
    '',
    'INSERT INTO rate_card (template_name, line_code, rate, source) VALUES',
    rows.join(',\n'),
    'ON CONFLICT (template_name, line_code) DO NOTHING;',
    '',
  ].join('\n');

  fs.writeFileSync(OUT_PATH, sql, 'utf8');
  console.log(`Wrote ${OUT_PATH}`);
  console.log(`  ${rows.length} rows (${gcCodes.length} GC/Site Ops + ${catCodes.length} catalog; all source='seed')`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
