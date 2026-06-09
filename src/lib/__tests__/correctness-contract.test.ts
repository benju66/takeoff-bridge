/**
 * The Correctness Contract — executable guard tests.
 *
 * These encode the invariants documented in `docs/correctness-contract.md`. Each test
 * references the invariant ID (INV-n) it guards, so a failure points straight back to the
 * written promise it breaks. The invariants exercised here ALREADY HOLD against today's
 * `calculations.ts` — they are a tripwire against silent regression, not a spec of new work.
 *
 * Invariants that land in a later phase (the full cross-layer tie-out in Phase 2, the
 * fail-loud import behavior in Phase 3, the provenance badge in Phase 5) are recorded as
 * `it.todo` so the promise stays on the board without failing the suite.
 *
 * NO BEHAVIOR CHANGE accompanies this file — it is pure specification-as-test.
 */

import { describe, it, expect } from 'vitest';
import {
  computeTakeoffSummary,
  computePersonnelCosts,
  computeSiteOperations,
  type LinkedDivisionTotal,
} from '../calculations';
import { rollupByProcoreCode, validateExportReadiness } from '../exporter';
import { LINKED_DIVISION_ROWS } from '../constants';
import { parseUsNumber } from '../parser';
import { computeMergeResult, applyMergeInverse } from '../mergeTakeoff';
import { ProcessedTakeoffRow } from '@/types';

// ---------------------------------------------------------------------------
// Helper: Minimal ProcessedTakeoffRow factory (mirrors calculations.test.ts).
// `total` defaults to a deliberately wrong 999 so any test that accidentally
// reads the cached row.total instead of matchedQty × unitPrice fails loudly.
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<ProcessedTakeoffRow> = {}): ProcessedTakeoffRow {
  return {
    id: overrides.id ?? 'row-test',
    classification: overrides.classification ?? 'Test Classification',
    itemId: overrides.itemId ?? '03-1000',
    procoreParentCode: overrides.procoreParentCode ?? '',
    procoreCode: overrides.procoreCode ?? '',
    description: overrides.description ?? 'Test Item',
    matchedQty: overrides.matchedQty ?? 100,
    uom: overrides.uom ?? 'SF',
    unitPrice: overrides.unitPrice ?? 10,
    total: overrides.total ?? 999, // Deliberately wrong — must NOT be used by calculations
    isMapped: overrides.isMapped ?? true,
    rawQuantities: overrides.rawQuantities ?? [],
    costType: overrides.costType ?? 'M',
    customFields: overrides.customFields ?? {},
    source: overrides.source ?? 'template',
  };
}

// Real linked division itemIds, drawn from the calc authority (never invented).
const GC_LINKED_ID = LINKED_DIVISION_ROWS[0].itemId;      // "01-0000.001" General Conditions
const SITE_LINKED_ID = LINKED_DIVISION_ROWS[2].itemId;    // "02-0000.001" Site Operations

const NO_ROUNDING = {
  constructionContingencyRate: 0,
  designContingencyRate: 0,
  buildersRiskRate: 0,
  specialInsuranceRate: 0,
  glInsuranceRate: 0.01,
  bondRate: 0,
  feeRate: 0.05,
  roundingRule: 'none',
};

// ═══════════════════════════════════════════════════════════════════
// INV-1 — Single total (engine half: the reported subtotal is the basis
// every modifier and per-unit figure is computed on). The full cross-layer
// tie-out to a REAL bid, to the cent, is the Phase 2 golden harness
// (src/__tests__/golden-mckenna.test.ts); the synthetic engine→export-rollup
// guard below runs everywhere.
// ═══════════════════════════════════════════════════════════════════

describe('INV-1 single-total: reported subtotal is the modifier basis', () => {
  it('every modifier and per-unit figure keys off the one reported subtotal', () => {
    const linkedTotals: LinkedDivisionTotal[] = [
      { itemId: GC_LINKED_ID, description: 'General Conditions', sourceLabel: '', total: 150000 },
      { itemId: SITE_LINKED_ID, description: 'Site Operations', sourceLabel: '', total: 80000 },
    ];
    const rows = [
      makeRow({ matchedQty: 100, unitPrice: 10000 }),                              // takeoff $1,000,000
      makeRow({ id: 'row-gc', itemId: GC_LINKED_ID, matchedQty: 0, unitPrice: 0 }),
      makeRow({ id: 'row-so', itemId: SITE_LINKED_ID, matchedQty: 0, unitPrice: 0 }),
    ];
    const sqft = 50000;
    const units = 10;
    const r = computeTakeoffSummary(rows, sqft, units, NO_ROUNDING, linkedTotals);

    // The reported subtotal is exactly its two published components (no rounding).
    expect(r.takeoffSubtotal + r.linkedDivisionsTotal).toBe(r.subtotal);

    // Each modifier is that same subtotal × its rate — one basis, no hidden second total.
    expect(r.glInsurance).toBeCloseTo(r.subtotal * 0.01, 2);
    expect(r.fee).toBeCloseTo(r.subtotal * 0.05, 2);

    // Per-unit figures divide the one Total Estimated Cost — same number, every view.
    expect(r.costPerSf).toBeCloseTo(r.totalEstimatedCost / sqft, 6);
    expect(r.costPerUnit).toBeCloseTo(r.totalEstimatedCost / units, 6);
  });

  it('INV-1 full tie-out: on-screen subtotal == exported Procore rollup (real-bid proof in golden-mckenna.test.ts)', () => {
    // Phase 2 flipped this from `it.todo`. The to-the-cent proof against the
    // real McKenna bid lives in src/__tests__/golden-mckenna.test.ts (skips
    // cleanly without the confidential fixture); this synthetic guard runs
    // everywhere and locks the engine → export-rollup half of the promise.
    const rows = [
      makeRow({ id: 'a', itemId: '03-1000.001', procoreCode: '3-30000.000', matchedQty: 150, unitPrice: 120 }), // 18,000
      makeRow({ id: 'b', itemId: '05-2000.001', procoreCode: '5-50000.000', matchedQty: 10, unitPrice: 250 }),  //  2,500
    ];
    const gc = computePersonnelCosts(0, 0, {}, { dumpsters: 0, toilets: 0, electric: 0 });
    const so = computeSiteOperations(0, 0, {}, {});
    const summary = computeTakeoffSummary(rows, 1000, 10, NO_ROUNDING);
    const rollupTotal = Object.values(rollupByProcoreCode(rows)).reduce((s, v) => s + v, 0);
    const readiness = validateExportReadiness(rows, gc, so);

    // On-screen takeoff subtotal == exported Procore rollup, to the cent.
    expect(Math.abs(summary.takeoffSubtotal - rollupTotal)).toBeLessThanOrEqual(0.01);
    // The exporter's own reconciliation gate ties line items to the rollup and passes.
    expect(Math.abs(readiness.reconciliation.lineItemTotal - readiness.reconciliation.rollupTotal)).toBeLessThanOrEqual(0.01);
    expect(readiness.reconciliation.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// INV-2 — Subtotal identity (incl. linked-row dedup)
// ═══════════════════════════════════════════════════════════════════

describe('INV-2 subtotal identity', () => {
  it('subtotal == Σ(qty×price) over non-linked rows + each linked value once', () => {
    const linkedTotals: LinkedDivisionTotal[] = [
      { itemId: GC_LINKED_ID, description: 'General Conditions', sourceLabel: '', total: 150000 },
    ];
    const rows = [
      makeRow({ id: 'a', itemId: '03-1000', matchedQty: 100, unitPrice: 10, total: 999 }), // 1,000
      makeRow({ id: 'b', itemId: '05-1000', matchedQty: 200, unitPrice: 5, total: 999 }),  // 1,000
      makeRow({ id: 'c', itemId: '09-1000', matchedQty: 3, unitPrice: 7, total: 999 }),    //    21
      // Linked row appears TWICE — its value must still count exactly once.
      makeRow({ id: 'gc1', itemId: GC_LINKED_ID, matchedQty: 0, unitPrice: 0 }),
      makeRow({ id: 'gc2', itemId: GC_LINKED_ID, matchedQty: 0, unitPrice: 0 }),
    ];
    const expectedTakeoff = 100 * 10 + 200 * 5 + 3 * 7; // 2,021 — NOT 3 × row.total(999)
    const r = computeTakeoffSummary(rows, 1000, 10, NO_ROUNDING, linkedTotals);

    expect(r.takeoffSubtotal).toBe(expectedTakeoff);
    expect(r.linkedDivisionsTotal).toBe(150000); // counted once despite the duplicate row
    expect(r.subtotal).toBe(expectedTakeoff + 150000);
  });
});

// ═══════════════════════════════════════════════════════════════════
// INV-3 — Explicit-zero protection
// ═══════════════════════════════════════════════════════════════════

describe('INV-3 explicit-zero protection', () => {
  it('an explicitly-entered 0% rate is never replaced by a system default', () => {
    const rows = [makeRow({ matchedQty: 100, unitPrice: 100 })]; // subtotal 10,000
    const r = computeTakeoffSummary(rows, 1000, 10, {
      constructionContingencyRate: 0,
      designContingencyRate: 0,
      buildersRiskRate: 0,
      specialInsuranceRate: 0,
      glInsuranceRate: 0, // explicit zero — must stay 0, NOT fall back to 1%
      bondRate: 0,
      feeRate: 0,         // explicit zero — must stay 0, NOT fall back to 5%
      roundingRule: 'none',
    });
    expect(r.glInsurance).toBe(0);
    expect(r.fee).toBe(0);
    expect(r.totalEstimatedCost).toBe(10000); // subtotal only; no defaulted markups crept in
  });

  it('the boundary: a genuinely UNSET (omitted) rate object falls back to the system defaults', () => {
    // Documents the distinction the invariant rests on: only null/undefined defaults.
    const rows = [makeRow({ matchedQty: 100, unitPrice: 100 })]; // subtotal 10,000
    const r = computeTakeoffSummary(rows, 1000, 10); // no rates object at all
    expect(r.glInsurance).toBeCloseTo(10000 * 0.01, 2); // 100 — system default 1%
    expect(r.fee).toBeCloseTo(10000 * 0.05, 2);         // 500 — system default 5%
  });
});

// ═══════════════════════════════════════════════════════════════════
// INV-4 — Rounding neutrality (rounded components sum to the rounded total;
// no penny created or lost; modifiers round independently before summing)
// ═══════════════════════════════════════════════════════════════════

describe('INV-4 rounding neutrality', () => {
  it('Total Estimated Cost is the EXACT sum of the displayed rounded components', () => {
    const rows = [makeRow({ matchedQty: 100, unitPrice: 10.25 })]; // subtotal 1,025
    const r = computeTakeoffSummary(rows, 1000, 10, {
      constructionContingencyRate: 0.10,  // 102.5    -> 103
      designContingencyRate: 0.05,        //  51.25   ->  51
      buildersRiskRate: 0.0125,           //  12.8125 ->  13
      specialInsuranceRate: 0,
      glInsuranceRate: 0,
      bondRate: 0,
      feeRate: 0,
      roundingRule: 'dollar',
    });

    // Each component is rounded independently.
    expect(r.subtotal).toBe(1025);
    expect(r.constructionContingency).toBe(103);
    expect(r.designContingency).toBe(51);
    expect(r.buildersRisk).toBe(13);

    // Neutrality core: the total equals the sum of the ROUNDED fields the user sees, to
    // the penny — nothing is gained or lost between the screen and the total.
    const sumOfDisplayed =
      r.subtotal + r.constructionContingency + r.designContingency + r.buildersRisk +
      r.specialInsurance + r.glInsurance + r.bond + r.fee;
    expect(r.totalEstimatedCost).toBe(sumOfDisplayed);
    expect(r.totalEstimatedCost).toBe(1192);
  });

  it('modifiers round INDEPENDENTLY before summing (not summed-then-rounded)', () => {
    // Exactly-representable values (subtotal 1; rate 0.5 → 0.5; all binary-exact) so the
    // demonstration cannot be muddied by floating-point noise.
    const rows = [makeRow({ matchedQty: 1, unitPrice: 1 })]; // subtotal 1
    const r = computeTakeoffSummary(rows, 1000, 10, {
      constructionContingencyRate: 0.5, // 0.5 -> rounds up to 1 on its own
      designContingencyRate: 0.5,       // 0.5 -> rounds up to 1 on its own
      buildersRiskRate: 0,
      specialInsuranceRate: 0,
      glInsuranceRate: 0,
      bondRate: 0,
      feeRate: 0,
      roundingRule: 'dollar',
    });
    // Per-line rounding: 1 + 1 added on top of the subtotal of 1 → total 3.
    expect(r.constructionContingency).toBe(1);
    expect(r.designContingency).toBe(1);
    expect(r.totalEstimatedCost).toBe(3);
    // Summing the RAW components first (0.5 + 0.5 = 1.0) then rounding would give 2 — a
    // different answer. Independent per-line rounding is what makes the displayed lines tie.
    expect(r.totalEstimatedCost).not.toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// INV-5 — Order independence (re-ordering rows never changes the subtotal
// at the cent; guards floating-point summation order)
// ═══════════════════════════════════════════════════════════════════

describe('INV-5 order independence', () => {
  it('reversing row order leaves the rounded subtotal and total identical', () => {
    // Fractional-dollar prices whose partial sums are order-sensitive in IEEE-754.
    const prices = [0.1, 0.2, 0.3, 0.7, 1.1, 2.3, 5.9, 7.7, 11.13, 0.07, 0.07, 0.09];
    const rows = prices.map((p, i) =>
      makeRow({ id: `r${i}`, itemId: `03-${1000 + i}`, matchedQty: 1, unitPrice: p, total: 999 })
    );
    const rates = { ...NO_ROUNDING, roundingRule: 'dollar' };

    const forward = computeTakeoffSummary(rows, 1000, 10, rates);
    const reversed = computeTakeoffSummary([...rows].reverse(), 1000, 10, rates);

    expect(reversed.subtotal).toBe(forward.subtotal);
    expect(reversed.totalEstimatedCost).toBe(forward.totalEstimatedCost);
    // Even the raw (pre-rounding) takeoff agrees within the $0.01 match bar.
    expect(reversed.takeoffSubtotal).toBeCloseTo(forward.takeoffSubtotal, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// INV-6 — Linked-row non-duplication (a linked division's typed qty×price
// never enters any total; its STEP 2/3 value is its only representation)
// ═══════════════════════════════════════════════════════════════════

describe('INV-6 linked-row non-duplication', () => {
  it('stray typed dollars on a linked row (and a duplicate of it) count nowhere', () => {
    const linkedTotals: LinkedDivisionTotal[] = [
      { itemId: GC_LINKED_ID, description: 'General Conditions', sourceLabel: '', total: 150000 },
    ];
    const rows = [
      makeRow({ id: 'take', matchedQty: 100, unitPrice: 10 }),                          // takeoff 1,000
      makeRow({ id: 'gc1', itemId: GC_LINKED_ID, matchedQty: 2, unitPrice: 500 }),      // stray 1,000
      makeRow({ id: 'gc2', itemId: GC_LINKED_ID, matchedQty: 3, unitPrice: 1000 }),     // stray 3,000 (dup)
    ];
    const r = computeTakeoffSummary(rows, 1000, 10, NO_ROUNDING, linkedTotals);
    // Only takeoff 1,000 + the single linked value 150,000 — none of the stray typed dollars.
    expect(r.subtotal).toBe(1000 + 150000);
    expect(r.linkedDivisionsTotal).toBe(150000);
  });

  it('without a linkedTotals fixture a linked row contributes $0, never its typed dollars', () => {
    const rows = [
      makeRow({ id: 'take', matchedQty: 100, unitPrice: 10 }),                          // takeoff 1,000
      makeRow({ id: 'gc', itemId: GC_LINKED_ID, matchedQty: 1, unitPrice: 99999 }),     // stray 99,999
    ];
    const r = computeTakeoffSummary(rows, 1000, 10, NO_ROUNDING);
    expect(r.subtotal).toBe(1000);
    expect(r.linkedDivisionsTotal).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// INV-7 — Provenance completeness (every row carries a source; every
// persisted number traces to template/import/manual/override). Enforced
// today by the type system + ingestion/command paths; the visible per-row
// badge is Phase 5.
// ═══════════════════════════════════════════════════════════════════

describe('INV-7 provenance completeness', () => {
  it.todo('INV-7 every persisted row carries a source and shows its provenance badge — Phase 5');
});

// ═══════════════════════════════════════════════════════════════════
// INV-8 — Loud failure on import (no dropped rows, no silent sign flips).
// SPECIFIED in the contract; IMPLEMENTED in Phase 3.
// ═══════════════════════════════════════════════════════════════════

describe('INV-8 loud failure on import', () => {
  it('INV-8 no silent sign flip: "(1,234.50)" and "1,234.50-" parse to -1234.50 (full coverage in parser-numbers.test.ts)', () => {
    // A credit must REDUCE the bid — never silently become a positive number.
    expect(parseUsNumber('(1,234.50)')).toEqual({ value: -1234.5, ambiguous: false });
    expect(parseUsNumber('1,234.50-')).toEqual({ value: -1234.5, ambiguous: false });
    expect(parseUsNumber('1,234.50')).toEqual({ value: 1234.5, ambiguous: false });
    // Genuinely ambiguous input fails loud (flagged, value not trusted) rather than guessed.
    expect(parseUsNumber('1.234,50')).toEqual({ value: 0, ambiguous: true });
  });

  it('INV-8 no dropped rows: an off-template valid code is appended and reverses in one undo (full coverage in import-integrity.test.ts)', () => {
    const currentRows = [makeRow({ id: 'row-03-1000', itemId: '03-1000', matchedQty: 0, total: 0 })];
    // A parsed row with a VALID itemId absent from the template grid (targetIdx === -1).
    const offTemplate = makeRow({
      id: 'parsed-0', itemId: '09-9000.001', classification: 'Painting',
      matchedQty: 42, unitPrice: 3, total: 126, source: 'csv_import',
    });
    const { updatedRows, command } = computeMergeResult(
      currentRows, [offTemplate], [], true, 5000, ['LS', 'SUM', 'ALLW', 'LUMP'],
    );

    // Appended (not dropped), visible, with its quantity and provenance.
    const appended = updatedRows.find((r) => r.itemId === '09-9000.001');
    expect(appended).toBeDefined();
    expect(appended!.matchedQty).toBe(42);
    expect(appended!.source).toBe('csv_import');
    expect(updatedRows).toHaveLength(currentRows.length + 1);
    expect(command.appendedRows).toHaveLength(1);

    // One Ctrl+Z reverses the whole merge.
    const undone = applyMergeInverse(updatedRows, command);
    expect(undone).toHaveLength(currentRows.length);
    expect(undone.find((r) => r.itemId === '09-9000.001')).toBeUndefined();
  });
});
