/* eslint-disable @typescript-eslint/no-require-imports */
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ═══════════════════════════════════════════════════════════════════
// procore-cost-codes-reconcile.js — Procore Cost Codes, Phase 1
//
// Cross-references the codes in the OLD JSON oracle (src/lib/procore-valid-
// codes.json, 224 codes) that are ABSENT from the NEW Procore master list
// (docs/reference/Procore Cost Codes.xlsx, 217 typed codes) — the "dropped"
// codes — against everything that could break if a code were blind-deleted:
//   - cost_code_map           (procore_code as a mapping/rollup TARGET; also
//                              internal_code, in case a dropped code is keyed)
//   - estimate_line_items     (procore_code on saved rows; also item_id)
//   - estimate-catalog.json   (procoreCode = export destination; procoreParentCode
//                              = STEP-2/3 display rollup parent — NOT an export
//                              target)
//
// Writes a human-readable report to
//   docs/plans/2026-06-12-procore-cost-codes-reconciliation.md
// so the architect can decide each dropped code per-code in Phase 4
// (retire vs. merge-redirect vs. repoint-then-retire).
//
// Requires (read from .env.local via `npm run procore-codes-reconcile`):
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   (service role — reads corporate tables without
//                                tripping RLS; never expose to the browser)
// ═══════════════════════════════════════════════════════════════════

const XLSX_PATH = path.join(__dirname, '..', 'docs', 'reference', 'Procore Cost Codes.xlsx');
const ORACLE_PATH = path.join(__dirname, '..', 'src', 'lib', 'procore-valid-codes.json');
const CATALOG_PATH = path.join(__dirname, '..', 'src', 'lib', 'estimate-catalog.json');
const OUT_PATH = path.join(__dirname, '..', 'docs', 'plans', '2026-06-12-procore-cost-codes-reconciliation.md');

function cellStr(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && v !== null && 'result' in v) return String(v.result ?? '');
  if (typeof v === 'object' && v !== null && 'text' in v) return String(v.text ?? '');
  return String(v);
}

async function readNewList() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX_PATH);
  const ws = wb.worksheets.find((s) => s.rowCount > 1);
  const map = new Map();
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const code = cellStr(row.getCell(1)).trim();
    if (code) map.set(code, { type: cellStr(row.getCell(2)).trim(), desc: cellStr(row.getCell(3)).trim() });
  });
  return map;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      'ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n' +
      'Add SUPABASE_SERVICE_ROLE_KEY to .env.local (Supabase Dashboard -> Settings -> API).',
    );
    process.exit(1);
  }
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const newMap = await readNewList();
  const oracle = JSON.parse(fs.readFileSync(ORACLE_PATH, 'utf8'));
  const oracleMap = new Map(oracle.map((o) => [o.code, o.description]));
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));

  const dropped = [...oracleMap.keys()].filter((c) => !newMap.has(c));
  const added = [...newMap.keys()].filter((c) => !oracleMap.has(c));

  // DB cross-reference (read whole tables; corporate tables are small).
  const { data: ccm, error: ccmErr } = await supabase
    .from('cost_code_map')
    .select('template_name, internal_code, procore_code, source');
  if (ccmErr) throw new Error(`cost_code_map read failed: ${ccmErr.message}`);

  // estimate_line_items can be large — page to be safe.
  const eli = [];
  let from = 0;
  const PAGE = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from('estimate_line_items')
      .select('item_id, procore_code')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`estimate_line_items read failed: ${error.message}`);
    eli.push(...(data || []));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }

  function refsFor(code) {
    const catalogAsCode = [];
    const catalogAsParent = [];
    for (const itemId of Object.keys(catalog)) {
      const e = catalog[itemId];
      if (e.procoreCode === code) catalogAsCode.push(itemId);
      if (e.procoreParentCode === code) catalogAsParent.push(itemId);
    }
    return {
      ccmAsTarget: ccm.filter((r) => r.procore_code === code),
      ccmAsInternal: ccm.filter((r) => r.internal_code === code),
      eliAsProcore: eli.filter((r) => r.procore_code === code).length,
      eliAsItemId: eli.filter((r) => r.item_id === code).length,
      catalogAsCode,
      catalogAsParent,
    };
  }

  const findings = dropped.map((code) => ({ code, desc: oracleMap.get(code), refs: refsFor(code) }));

  // ── Build the markdown report ──────────────────────────────────────
  const now = new Date().toISOString().slice(0, 10);
  const L = [];
  L.push('# Procore Cost Codes — Phase 1 Reconciliation Report');
  L.push(`_Generated ${now} by \`npm run procore-codes-reconcile\` — regenerate after any data change._`);
  L.push('');
  L.push('## What this is');
  L.push('The new Procore master list (`docs/reference/Procore Cost Codes.xlsx`, **217** typed');
  L.push('codes) is a strict subset of the old JSON oracle (`src/lib/procore-valid-codes.json`,');
  L.push('**224** codes). This report cross-references each **dropped** code (in the old oracle,');
  L.push('absent from the new list) against everything that would break if it were blind-deleted,');
  L.push('so the architect can decide each one in Phase 4 (retire / merge-redirect / repoint-then-retire).');
  L.push('');
  L.push('## Diff summary');
  L.push('');
  L.push('| Metric | Count |');
  L.push('| --- | --- |');
  L.push(`| Old JSON oracle codes | ${oracleMap.size} |`);
  L.push(`| New Procore list codes | ${newMap.size} |`);
  L.push(`| Dropped (old, not new) | ${dropped.length} |`);
  L.push(`| Added (new, not old) | ${added.length} |`);
  L.push('');
  if (added.length) {
    L.push('> NOTE: unexpected ADDED codes (the plan measured 0):');
    for (const c of added) L.push(`> - \`${c}\``);
    L.push('');
  }
  // Honest callout: the plan named both 2-20000.000 AND 1-10440.000 as live
  // rollup targets. Only the live data decides; surface any divergence.
  {
    const planNamedLive = ['2-20000.000', '1-10440.000'];
    const actuallyLive = new Set(
      dropped.filter((code) => {
        const r = refsFor(code);
        return r.ccmAsTarget.length > 0 || r.eliAsProcore > 0 || r.catalogAsCode.length > 0;
      }),
    );
    const planMisses = planNamedLive.filter((c) => !actuallyLive.has(c));
    if (planMisses.length) {
      L.push('> CORRECTION vs. the plan: the plan-of-record assumed these were live rollup');
      L.push('> targets, but the live data shows ZERO references — they are safe retire');
      L.push('> candidates, not repoint-first:');
      for (const c of planMisses) L.push(`> - \`${c}\` (${oracleMap.get(c)})`);
      L.push('>');
      L.push('> Only `2-20000.000` Site Operations is an actual live export target.');
      L.push('');
    }
  }
  L.push('## Reference legend');
  L.push('- **cost_code_map target** — internal estimate codes whose dollars roll up to this');
  L.push('  Procore code on export. **Retiring a code with live targets WOULD break the export');
  L.push('  golden unless the targets are repointed first (Phase 4).**');
  L.push('- **estimate_line_items (procore_code)** — saved estimate rows currently carrying this');
  L.push('  code as their Procore destination.');
  L.push('- **catalog procoreCode** — STEP 4 catalog rows that export to this code (seed source for');
  L.push('  cost_code_map; should mirror it).');
  L.push('- **catalog procoreParentCode** — STEP 2/3 *display* rollup parent only; **NOT** an export');
  L.push('  destination. A code referenced solely as a parent is display-grouping, not a dollar target.');
  L.push('');
  L.push('## Per-code findings');
  L.push('');

  for (const f of findings) {
    const r = f.refs;
    const liveTarget = r.ccmAsTarget.length > 0 || r.eliAsProcore > 0 || r.catalogAsCode.length > 0;
    L.push(`### \`${f.code}\` — ${f.desc}`);
    L.push('');
    L.push('| Reference | Count | Detail |');
    L.push('| --- | --- | --- |');
    L.push(`| cost_code_map target | ${r.ccmAsTarget.length} | ${r.ccmAsTarget.map((x) => x.internal_code).join(', ') || '—'} |`);
    L.push(`| cost_code_map internal_code | ${r.ccmAsInternal.length} | ${r.ccmAsInternal.map((x) => x.procore_code).join(', ') || '—'} |`);
    L.push(`| estimate_line_items procore_code | ${r.eliAsProcore} | saved rows |`);
    L.push(`| estimate_line_items item_id | ${r.eliAsItemId} | saved rows |`);
    L.push(`| catalog procoreCode (export target) | ${r.catalogAsCode.length} | ${r.catalogAsCode.join(', ') || '—'} |`);
    L.push(`| catalog procoreParentCode (display only) | ${r.catalogAsParent.length} | ${r.catalogAsParent.join(', ') || '—'} |`);
    L.push('');
    if (liveTarget) {
      L.push('**Verdict: LIVE EXPORT TARGET — must repoint before retiring (Phase 4), or the export');
      L.push('golden breaks.** Repoint the listed cost_code_map rows (via `updateCostCodeMapping`)');
      L.push('to a retained code, then retire/merge this one.');
    } else if (r.catalogAsParent.length > 0) {
      L.push('**Verdict: display-only rollup parent — safe to retire for export.** It is never a dollar');
      L.push(`destination; the ${r.catalogAsParent.length} child row(s) export to their own retained codes.`);
      L.push('Phase 4 note: the catalog still references it as a `procoreParentCode` display label — a');
      L.push('cosmetic grouping question, not an export break. Consider `merged` → a retained parent if a');
      L.push('grouping label is still wanted, else `retired`.');
    } else {
      L.push('**Verdict: zero references anywhere — safe retire candidate.** No mapping, no saved row, no');
      L.push('catalog reference. Phase 4 can `retired` it with no repoint.');
    }
    L.push('');
  }

  L.push('## Recommended Phase 4 dispositions (architect decides)');
  L.push('');
  L.push('| Code | Description | Live export target? | Suggested disposition |');
  L.push('| --- | --- | --- | --- |');
  for (const f of findings) {
    const r = f.refs;
    const live = r.ccmAsTarget.length > 0 || r.eliAsProcore > 0 || r.catalogAsCode.length > 0;
    let disp;
    if (live) disp = `**REPOINT then retire** (${r.ccmAsTarget.length} mapping(s), ${r.eliAsProcore} saved row(s))`;
    else if (r.catalogAsParent.length > 0) disp = 'retire (or merge to a retained parent for the display label)';
    else disp = 'retire (no references)';
    L.push(`| \`${f.code}\` | ${f.desc} | ${live ? 'YES' : 'no'} | ${disp} |`);
  }
  L.push('');
  L.push('## Method / reproducibility');
  L.push('- Dropped set = `procore-valid-codes.json` codes minus `Procore Cost Codes.xlsx` codes.');
  L.push('- DB facts read live from `cost_code_map` + `estimate_line_items` via the service role.');
  L.push('- Catalog references read from `src/lib/estimate-catalog.json` (the cost_code_map seed source).');
  L.push('- Re-run: `npm run procore-codes-reconcile` (requires `.env.local` service-role key).');
  L.push('');

  fs.writeFileSync(OUT_PATH, L.join('\n'), 'utf8');
  console.log(`Wrote ${OUT_PATH}`);
  console.log(`  Dropped codes analyzed: ${dropped.length}`);
  for (const f of findings) {
    const r = f.refs;
    const live = r.ccmAsTarget.length > 0 || r.eliAsProcore > 0 || r.catalogAsCode.length > 0;
    console.log(`    ${f.code} — ${live ? 'LIVE TARGET' : (r.catalogAsParent.length ? 'display parent' : 'no refs')}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
