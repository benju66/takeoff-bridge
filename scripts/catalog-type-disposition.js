/* eslint-disable @typescript-eslint/no-require-imports */
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════
// catalog-type-disposition.js — Template + Catalog Reconciliation, Phase 3
//
// The disposition report for the 67 STEP-4 cost-type mismatches (the count
// pinned in src/__tests__/procore-type-reconciliation.test.ts). For each
// mismatch: internalCode, mapped procoreCode, the estimate's current type,
// Procore's type, and the proposed correction — split into
//   - MECHANICAL TYPE FIXES: the code mapping is right (description/family
//     agreement on both sides); only the type label disagrees. Proposed
//     correction = a catalog_cost_type_overrides row setting cost_type to
//     Procore's type. Label-only: cost_type moves no dollars.
//   - SUSPECTED WRONG-CODE MIS-MAPS: the mapping itself looks wrong (the line
//     plausibly belongs to a DIFFERENT Procore code). NOT touched — repointing
//     moves dollars and is explicitly out of scope (plan §Out of scope). These
//     are enumerated for the architect as the standing advisory residual.
//
// Canonical inputs are the same two in-repo sources of truth the pin test
// reads: src/lib/estimate-catalog.json (the cost_code_map seed source) and
// docs/reference/Procore Cost Codes.xlsx (the procore_cost_codes seed source).
// Pure — no DB, no env. The seed script (scripts/seed-cost-type-overrides.js)
// requires computeDisposition() from here, so the seeded rows are BY
// CONSTRUCTION the report's mechanical list — no report/seed drift.
//
// Writes docs/plans/2026-06-12-catalog-type-disposition.md.
// Re-run: `npm run type-disposition`.
// ═══════════════════════════════════════════════════════════════════

const XLSX_PATH = path.join(__dirname, '..', 'docs', 'reference', 'Procore Cost Codes.xlsx');
const CATALOG_PATH = path.join(__dirname, '..', 'src', 'lib', 'estimate-catalog.json');
const OUT_PATH = path.join(__dirname, '..', 'docs', 'plans', '2026-06-12-catalog-type-disposition.md');

/** Estimate L/M/S/E → Procore type (mirrors ESTIMATE_TO_PROCORE_TYPE). */
const TYPE_OF = { L: 'Labor', M: 'Material', S: 'Subcontract', E: 'Equipment' };
/** Procore type → estimate letter (the overlay cost_type to seed). */
const LETTER_OF = { Labor: 'L', Material: 'M', Subcontract: 'S', Equipment: 'E' };

/**
 * Mismatches whose CODE mapping is suspect — reviewed by hand against the full
 * Procore master list (2026-06-12). Keyed by internalCode; the value is the
 * architect-facing reason. These are SKIPPED by the seeding (flipping the type
 * label would paper over a wrong-code mapping) and stay in the advisory as the
 * explained residual. Repointing them moves dollars → separate architect review.
 */
const SUSPECTED_MISMAPS = {
  '01-0400.002': {
    reason:
      'Supervision (typed L, $43,300 default) maps to `1-10000.000` General Conditions ' +
      '(Material). The Procore master list has FIVE dedicated Labor supervision codes ' +
      '(`1-10410.000` Sr Superintendent, `1-10420.000` Superintendent, `1-10430.000` ' +
      'Asst. Superintendent, plus the 1-103xx PM ladder). Relabeling this line M would ' +
      'bury supervision labor inside the GC material bucket; it likely belongs on one ' +
      'of the 1-104xx Labor codes instead.',
  },
  '12-3530.002': {
    reason:
      'Residential Casework - Installation (typed S) maps to `12-123530.000` Residential ' +
      'Casework (Material) — the same code as its sibling `12-3530.001` "- Material" (M, ' +
      'which agrees). The catalog deliberately splits material vs installation; Procore ' +
      'types the shared code Material, so relabeling the INSTALLATION line M would ' +
      'mislabel subcontracted install work. A better-fitting existing code is ' +
      '`6-62000.000` Finish Carpentry Installation (Subcontract). Architect to decide: ' +
      'repoint, or accept the Material label on the install half.',
  },
};

function cellStr(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && 'result' in v) return String(v.result ?? '');
  if (typeof v === 'object' && 'text' in v) return String(v.text ?? '');
  return String(v);
}

async function readProcoreList() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX_PATH);
  const ws = wb.worksheets.find((s) => s.rowCount > 1);
  const map = new Map();
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const code = cellStr(row.getCell(1)).trim();
    if (code) {
      map.set(code, {
        type: cellStr(row.getCell(2)).trim(),
        desc: cellStr(row.getCell(3)).trim(),
      });
    }
  });
  return map;
}

/**
 * Recompute the 67 mismatches (same walk as computeTypeReconciliation over the
 * catalog-seeded mappings) and split them into mechanical fixes vs suspected
 * mis-maps. Returns { mismatches, mechanical, mismaps, seedRows } where
 * seedRows is the exact catalog_cost_type_overrides payload to seed.
 */
async function computeDisposition() {
  const procore = await readProcoreList();
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));

  const mismatches = [];
  for (const internalCode of Object.keys(catalog).sort()) {
    const item = catalog[internalCode];
    const p = procore.get(item.procoreCode);
    if (!p) continue; // missing-base (the linked-division 8) — not a type mismatch
    const estimateType = TYPE_OF[(item.costType || '').trim().toUpperCase()] ?? null;
    if (estimateType === p.type) continue;
    mismatches.push({
      internalCode,
      catalogDesc: item.description,
      estimateCostType: item.costType,
      estimateType,
      procoreCode: item.procoreCode,
      procoreType: p.type,
      procoreDesc: p.desc,
      proposedLetter: LETTER_OF[p.type],
      mismapReason: SUSPECTED_MISMAPS[internalCode]?.reason ?? null,
    });
  }

  const mechanical = mismatches.filter((m) => !m.mismapReason);
  const mismaps = mismatches.filter((m) => m.mismapReason);
  const seedRows = mechanical.map((m) => ({
    item_id: m.internalCode,
    cost_type: m.proposedLetter,
    note:
      `Phase 3 bulk-fix 2026-06-12: Procore types ${m.procoreCode} (${m.procoreDesc}) as ` +
      `${m.procoreType}; was ${m.estimateCostType}. See docs/plans/2026-06-12-catalog-type-disposition.md.`,
  }));
  return { mismatches, mechanical, mismaps, seedRows, procoreCount: procore.size };
}

function flipLabel(m) {
  return `${m.estimateCostType} (${m.estimateType ?? 'unmapped'}) → ${m.proposedLetter} (${m.procoreType})`;
}

async function main() {
  const { mismatches, mechanical, mismaps, procoreCount } = await computeDisposition();

  const flips = {};
  for (const m of mechanical) {
    const k = `${m.estimateCostType}→${m.proposedLetter}`;
    flips[k] = (flips[k] ?? 0) + 1;
  }

  const now = new Date().toISOString().slice(0, 10);
  const L = [];
  L.push('# Template + Catalog Reconciliation — Phase 3 Cost-Type Disposition Report');
  L.push(`_Generated ${now} by \`npm run type-disposition\` — regenerate after any catalog or master-list change._`);
  L.push('');
  L.push('## What this is');
  L.push('Each of the STEP-4 cost-type mismatches (the advisory pinned in');
  L.push('`procore-type-reconciliation.test.ts`): the estimate code, its mapped Procore base,');
  L.push('both types, and the proposed correction. **Mechanical type fixes** get a');
  L.push('`catalog_cost_type_overrides` row (`cost_type` = Procore\'s type — label-only, moves');
  L.push('no dollars). **Suspected wrong-code mis-maps** are NOT touched: repointing a code');
  L.push('moves dollars and is explicitly out of scope (plan §Out of scope); they remain in');
  L.push('the advisory as the explained residual, awaiting a separate architect review.');
  L.push('');
  L.push('## Summary');
  L.push('');
  L.push('| Metric | Count |');
  L.push('| --- | --- |');
  L.push(`| Procore master-list codes | ${procoreCount} |`);
  L.push(`| Type mismatches (advisory) | ${mismatches.length} |`);
  L.push(`| → Mechanical type fixes (seeded) | ${mechanical.length} |`);
  L.push(`| → Suspected wrong-code mis-maps (NOT touched) | ${mismaps.length} |`);
  for (const [k, n] of Object.entries(flips)) L.push(`| Mechanical flip ${k} | ${n} |`);
  L.push('');
  L.push('> Only ONE mismatch resolves to Equipment (`10-2113.001` Toilet Partitions → E).');
  L.push('> The Equipment vocabulary (Phase 1) was still required — without it that code');
  L.push('> could never agree — but the bulk of the 67 are Material↔Subcontract flips.');
  L.push('');
  L.push('## Suspected wrong-code mis-maps (architect review — NOT seeded)');
  L.push('');
  for (const m of mismaps) {
    L.push(`### \`${m.internalCode}\` — ${m.catalogDesc}`);
    L.push('');
    L.push(`Maps to \`${m.procoreCode}\` ${m.procoreDesc} (${m.procoreType}); estimate type ${m.estimateCostType} (${m.estimateType}).`);
    L.push('');
    L.push(m.mismapReason);
    L.push('');
  }
  L.push('## Mechanical type fixes (seeded into `catalog_cost_type_overrides`)');
  L.push('');
  L.push('| Internal code | Catalog description | Procore code | Procore description | Fix |');
  L.push('| --- | --- | --- | --- | --- |');
  for (const m of mechanical) {
    L.push(
      `| \`${m.internalCode}\` | ${m.catalogDesc} | \`${m.procoreCode}\` | ${m.procoreDesc} | ${flipLabel(m)} |`,
    );
  }
  L.push('');
  L.push('## Method / reproducibility');
  L.push('- Mismatch set = the same catalog-vs-master-list walk the pin test runs');
  L.push('  (`src/lib/estimate-catalog.json` × `docs/reference/Procore Cost Codes.xlsx`).');
  L.push('- The mis-map split is a hand review encoded in `SUSPECTED_MISMAPS`');
  L.push('  (`scripts/catalog-type-disposition.js`) so the report regenerates deterministically.');
  L.push('- Seeding (`scripts/seed-cost-type-overrides.js`) requires `computeDisposition()` from');
  L.push('  this script — the seeded rows are the mechanical list by construction.');
  L.push('- Re-run: `npm run type-disposition`.');
  L.push('');

  fs.writeFileSync(OUT_PATH, L.join('\n'), 'utf8');
  console.log(`Wrote ${OUT_PATH}`);
  console.log(`  mismatches: ${mismatches.length}`);
  console.log(`  mechanical: ${mechanical.length}  (${Object.entries(flips).map(([k, n]) => `${k}:${n}`).join('  ')})`);
  console.log(`  suspected mis-maps (residual): ${mismaps.length}`);
  for (const m of mismaps) console.log(`    ${m.internalCode} — ${m.catalogDesc} (→ ${m.procoreCode})`);
}

module.exports = { computeDisposition };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
