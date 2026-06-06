// Phase 2 tie-out: every row in live cost_code_map must match the regenerated seed exactly.
// Run: node --env-file=.env.local scripts/phase2-db-tieout.js
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function parseSeed() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase_seed_cost_code_map.sql'), 'utf8');
  const re = /\('([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'\)/g;
  const rows = new Map();
  let m;
  while ((m = re.exec(sql))) rows.set(`${m[1]}|${m[2]}`, { procore_code: m[3], source: m[4] });
  return rows;
}

async function main() {
  const seed = parseSeed();
  const { data: db, error } = await supabase
    .from('cost_code_map')
    .select('template_name, internal_code, procore_code, source');
  if (error) throw error;

  let mismatches = 0;
  const dbKeys = new Set();
  for (const r of db) {
    const key = `${r.template_name}|${r.internal_code}`;
    dbKeys.add(key);
    const s = seed.get(key);
    if (!s) { console.log(`DB-ONLY: ${key}`); mismatches++; continue; }
    if (s.procore_code !== r.procore_code || s.source !== r.source) {
      console.log(`DIFF ${key}: db=(${r.procore_code},${r.source}) seed=(${s.procore_code},${s.source})`);
      mismatches++;
    }
  }
  for (const key of seed.keys()) {
    if (!dbKeys.has(key)) { console.log(`SEED-ONLY: ${key}`); mismatches++; }
  }
  console.log(`Seed rows: ${seed.size} | DB rows: ${db.length} | Mismatches: ${mismatches}`);
  console.log(mismatches ? 'TIE-OUT FAILED' : 'TIE-OUT PASSED — DB matches seed exactly');
  process.exit(mismatches ? 1 : 0);
}

main().catch(err => { console.error('FAILED:', err.message || err); process.exit(1); });
