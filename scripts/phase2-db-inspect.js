// Phase 2 READ-ONLY inspection: live cost_code_map state + affected estimate_line_items.
// Run: node --env-file=.env.local scripts/phase2-db-inspect.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  // 1. cost_code_map rows in the 32-1313 / 32-1613 block
  const { data: mapRows, error: e1 } = await supabase
    .from('cost_code_map')
    .select('internal_code, procore_code, source')
    .or('internal_code.like.32-1313%,internal_code.like.32-1613%')
    .order('internal_code');
  if (e1) throw e1;
  console.log('--- cost_code_map (32-1313* / 32-1613*) ---');
  for (const r of mapRows) console.log(`${r.internal_code}  ->  ${r.procore_code}  [${r.source}]`);

  // 2. total row count
  const { count, error: e2 } = await supabase
    .from('cost_code_map')
    .select('*', { count: 'exact', head: true });
  if (e2) throw e2;
  console.log(`\ncost_code_map total rows: ${count}`);

  // 3. estimate_line_items on 32-1313.001–.005 (any project)
  const codes = ['32-1313.001', '32-1313.002', '32-1313.003', '32-1313.004', '32-1313.005'];
  const { data: items, error: e3 } = await supabase
    .from('estimate_line_items')
    .select('project_id, item_id, description, matched_qty, total, source')
    .in('item_id', codes)
    .order('project_id');
  if (e3) throw e3;
  console.log(`\n--- estimate_line_items on 32-1313.001–.005: ${items.length} row(s) ---`);

  const projIds = [...new Set(items.map(i => i.project_id))];
  let names = {};
  if (projIds.length) {
    const { data: projs, error: e4 } = await supabase
      .from('projects').select('id, name').in('id', projIds);
    if (e4) throw e4;
    names = Object.fromEntries(projs.map(p => [p.id, p.name]));
  }
  for (const i of items) {
    console.log(`${names[i.project_id] || i.project_id} | ${i.item_id} | ${i.description} | qty=${i.matched_qty} | $${i.total} | ${i.source}`);
  }

  // 4. also check 32-1613.* line items (should be none yet, but verify)
  const { data: items16, error: e5 } = await supabase
    .from('estimate_line_items')
    .select('project_id, item_id, total')
    .like('item_id', '32-1613%');
  if (e5) throw e5;
  console.log(`\nestimate_line_items on 32-1613.*: ${items16.length} row(s)`);
  for (const i of items16) console.log(`${names[i.project_id] || i.project_id} | ${i.item_id} | $${i.total}`);
}

main().catch(err => { console.error('FAILED:', err.message || err); process.exit(1); });
