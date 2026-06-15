/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { computeDisposition } = require('./catalog-type-disposition');

// ═══════════════════════════════════════════════════════════════════
// seed-cost-type-overrides.js — Template + Catalog Reconciliation, Phase 3
//
// Seeds catalog_cost_type_overrides with the MECHANICAL type fixes from the
// architect-approved disposition report (docs/plans/2026-06-12-catalog-type-
// disposition.md). The rows come from computeDisposition() — the exact list
// the report shows, by construction. Suspected wrong-code mis-maps are NOT
// in that list and are never written.
//
// Mirrors the db.ts gateway semantics (upsertCatalogCostTypeOverride):
//  - item_id must be a CURRENT BUILT-IN catalog code (estimate-catalog.json);
//  - cost_type must be L/M/S/E;
//  - upsert on the item_id PK (re-running is idempotent; latest write wins);
//  - note carries provenance.
//
// Requires (read from .env.local via `npm run seed-type-overrides`):
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
// ═══════════════════════════════════════════════════════════════════

const CATALOG_PATH = path.join(__dirname, '..', 'src', 'lib', 'estimate-catalog.json');
const VALID_TYPES = new Set(['L', 'M', 'S', 'E']);

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      'ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n' +
      'Run via `npm run seed-type-overrides` with both in .env.local.',
    );
    process.exit(1);
  }

  const { seedRows, mismaps } = await computeDisposition();
  const builtIns = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));

  // Gateway-semantics validation BEFORE any write (all-or-nothing).
  for (const r of seedRows) {
    if (!Object.prototype.hasOwnProperty.call(builtIns, r.item_id)) {
      throw new Error(`Refusing to seed: ${r.item_id} is not a built-in STEP 4 catalog code`);
    }
    if (!VALID_TYPES.has(r.cost_type)) {
      throw new Error(`Refusing to seed: ${r.item_id} has invalid cost_type ${r.cost_type}`);
    }
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { error } = await supabase
    .from('catalog_cost_type_overrides')
    .upsert(seedRows, { onConflict: 'item_id' });
  if (error) throw new Error(`Seed upsert failed: ${error.message}`);

  const { count, error: countErr } = await supabase
    .from('catalog_cost_type_overrides')
    .select('item_id', { count: 'exact', head: true });
  if (countErr) throw new Error(`Post-seed count failed: ${countErr.message}`);

  console.log(`Seeded ${seedRows.length} cost-type overrides (table now holds ${count} rows).`);
  console.log(`Skipped ${mismaps.length} suspected mis-maps (advisory residual):`);
  for (const m of mismaps) console.log(`  ${m.internalCode} — ${m.catalogDesc}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
