// Phase 2 verification: check the re-synced catalog against Phase 1 expected facts.
// Read-only; safe to run anytime. Delete after Phase 2 if desired.
const catalog = require('../src/lib/estimate-catalog.json');

const expected = [
  // [itemId, description, procoreCode, targetUom (lc), defaultUnitPrice]
  ['32-1313.001', 'Concrete Paving', '32-321313.000', null, null],
  ['32-1613.001', 'Site Concrete', '32-321613.000', null, null],
  ['32-1613.002', 'Surmountable Curb', '32-321613.000', 'lf', 29],
  ['32-1613.003', 'B612 Curb', '32-321613.000', 'lf', 29],
  ['32-1613.004', 'Cross Gutter', '32-321613.000', 'lf', 48],
  ['32-1613.005', 'Light Duty Concrete', '32-321613.000', 'sf', 11.5],
  ['32-1613.006', 'Heavy Duty Concrete', '32-321613.000', 'sf', 14],
];
const mustBeAbsent = ['32-1313.000', '32-1313.002', '32-1313.003', '32-1313.004', '32-1313.005'];

let fail = 0;
for (const [id, desc, pc, uom, price] of expected) {
  const e = catalog[id];
  if (!e) { console.log(`FAIL missing ${id}`); fail++; continue; }
  const probs = [];
  if (e.description !== desc) probs.push(`desc="${e.description}" want "${desc}"`);
  if (e.procoreCode !== pc) probs.push(`procoreCode=${e.procoreCode} want ${pc}`);
  if (uom && String(e.targetUom).toLowerCase() !== uom) probs.push(`uom=${e.targetUom} want ${uom}`);
  if (price !== null && e.defaultUnitPrice !== price) probs.push(`price=${e.defaultUnitPrice} want ${price}`);
  console.log(probs.length ? `FAIL ${id}: ${probs.join('; ')}` : `OK   ${id}  ${e.description}  ->  ${e.procoreCode}  ${e.targetUom||''} $${e.defaultUnitPrice}`);
  if (probs.length) fail++;
}
for (const id of mustBeAbsent) {
  const present = !!catalog[id];
  console.log(present ? `FAIL ${id} still present` : `OK   ${id} absent`);
  if (present) fail++;
}
console.log(`\nTotal catalog entries: ${Object.keys(catalog).length}`);
console.log(fail ? `\n${fail} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(fail ? 1 : 0);
