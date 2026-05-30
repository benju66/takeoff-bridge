import { describe, it, expect } from 'vitest';
import {
  getMonthsBetween,
  computePersonnelCosts,
  computeSiteOperations,
  computeTakeoffSummary,
  computeDivisionBreakdown,
  computeCostTypeBreakdown,
} from '../calculations';
import { ProcessedTakeoffRow } from '@/types';

// ---------------------------------------------------------------------------
// Helper: Minimal ProcessedTakeoffRow factory
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<ProcessedTakeoffRow> = {}): ProcessedTakeoffRow {
  return {
    id: overrides.id ?? 'row-test',
    classification: overrides.classification ?? 'Test Classification',
    itemId: overrides.itemId ?? '03-1000',
    procoreParentCode: overrides.procoreParentCode ?? '',
    description: overrides.description ?? 'Test Item',
    matchedQty: overrides.matchedQty ?? 100,
    uom: overrides.uom ?? 'SF',
    unitPrice: overrides.unitPrice ?? 10,
    total: overrides.total ?? 999, // Deliberately wrong — should NOT be used by calculations
    isMapped: overrides.isMapped ?? true,
    rawQuantities: overrides.rawQuantities ?? [],
    costType: overrides.costType ?? 'M',
    customFields: overrides.customFields ?? {},
  };
}

// ═══════════════════════════════════════════════════════════════════
// getMonthsBetween
// ═══════════════════════════════════════════════════════════════════

describe('getMonthsBetween', () => {
  it('computes a standard 6-month range', () => {
    expect(getMonthsBetween('2026-01', '2026-07')).toBe(6);
  });

  it('computes a cross-year range', () => {
    expect(getMonthsBetween('2025-11', '2026-03')).toBe(4);
  });

  it('returns 0 for same month', () => {
    expect(getMonthsBetween('2026-05', '2026-05')).toBe(0);
  });

  it('returns 0 for empty inputs', () => {
    expect(getMonthsBetween('', '2026-01')).toBe(0);
    expect(getMonthsBetween('2026-01', '')).toBe(0);
    expect(getMonthsBetween('', '')).toBe(0);
  });

  it('returns 0 for negative duration', () => {
    expect(getMonthsBetween('2026-07', '2026-01')).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// computeTakeoffSummary
// ═══════════════════════════════════════════════════════════════════

describe('computeTakeoffSummary', () => {
  it('computes subtotal, GL at 1%, fee at 5%, and total at 1.06x', () => {
    const rows = [
      makeRow({ matchedQty: 100, unitPrice: 10 }),
      makeRow({ matchedQty: 200, unitPrice: 5, id: 'row-2', itemId: '05-1000' }),
    ];
    const result = computeTakeoffSummary(rows, 1000, 10);

    // subtotal = (100 * 10) + (200 * 5) = 2000
    expect(result.subtotal).toBe(2000);
    expect(result.generalLiability).toBe(2000 * 0.01); // 20
    expect(result.contractorFee).toBe(2000 * 0.05); // 100
    expect(result.totalEstimatedCost).toBe(2000 * 1.06); // 2120
    expect(result.costPerSf).toBeCloseTo(2120 / 1000);
    expect(result.costPerUnit).toBeCloseTo(2120 / 10);
  });

  it('returns all zeros for empty rows', () => {
    const result = computeTakeoffSummary([], 1000, 10);
    expect(result.subtotal).toBe(0);
    expect(result.generalLiability).toBe(0);
    expect(result.contractorFee).toBe(0);
    expect(result.totalEstimatedCost).toBe(0);
  });

  it('uses fallback divisor of 1 for zero squareFootage', () => {
    const rows = [makeRow({ matchedQty: 100, unitPrice: 10 })];
    const result = computeTakeoffSummary(rows, 0, 10);
    // costPerSf should divide by 1, not crash on divide-by-zero
    expect(result.costPerSf).toBe(result.totalEstimatedCost);
  });

  it('uses fallback divisor of 1 for zero unitCount', () => {
    const rows = [makeRow({ matchedQty: 100, unitPrice: 10 })];
    const result = computeTakeoffSummary(rows, 1000, 0);
    // costPerUnit should divide by 1, not crash on divide-by-zero
    expect(result.costPerUnit).toBe(result.totalEstimatedCost);
  });

  it('uses matchedQty × unitPrice, NOT row.total (regression)', () => {
    // row.total is set to 999 (wrong value) — summary should ignore it
    const rows = [makeRow({ matchedQty: 50, unitPrice: 20, total: 999 })];
    const result = computeTakeoffSummary(rows, 1000, 10);
    // subtotal should be 50 * 20 = 1000, NOT 999
    expect(result.subtotal).toBe(1000);
  });
});

// ═══════════════════════════════════════════════════════════════════
// computeDivisionBreakdown
// ═══════════════════════════════════════════════════════════════════

describe('computeDivisionBreakdown', () => {
  it('groups rows by first two digits of itemId', () => {
    const rows = [
      makeRow({ itemId: '03-1000', matchedQty: 100, unitPrice: 10 }),
      makeRow({ itemId: '03-2000', matchedQty: 50, unitPrice: 5, id: 'row-2' }),
      makeRow({ itemId: '05-1000', matchedQty: 200, unitPrice: 3, id: 'row-3' }),
    ];
    // subtotal = 1000 + 250 + 600 = 1850
    const result = computeDivisionBreakdown(rows, 1850);

    const div03 = result.find((d) => d.code === '03');
    const div05 = result.find((d) => d.code === '05');

    expect(div03).toBeDefined();
    expect(div03!.total).toBe(1250); // (100*10) + (50*5)
    expect(div05).toBeDefined();
    expect(div05!.total).toBe(600); // 200*3
  });

  it('places rows with no itemId into "Unmapped"', () => {
    const rows = [
      makeRow({ itemId: '', matchedQty: 100, unitPrice: 10 }),
    ];
    const result = computeDivisionBreakdown(rows, 1000);

    const unmapped = result.find((d) => d.code === 'Unmapped');
    expect(unmapped).toBeDefined();
    expect(unmapped!.total).toBe(1000);
  });

  it('computes percentages that sum to approximately 100%', () => {
    const rows = [
      makeRow({ itemId: '03-1000', matchedQty: 75, unitPrice: 10, id: 'row-1' }),
      makeRow({ itemId: '05-1000', matchedQty: 25, unitPrice: 10, id: 'row-2' }),
    ];
    const subtotal = 1000;
    const result = computeDivisionBreakdown(rows, subtotal);

    const totalPercentage = result.reduce((sum, d) => sum + d.percentage, 0);
    expect(totalPercentage).toBeCloseTo(100);
  });

  it('uses matchedQty × unitPrice, NOT row.total (regression)', () => {
    const rows = [
      makeRow({ itemId: '03-1000', matchedQty: 50, unitPrice: 20, total: 999 }),
    ];
    const result = computeDivisionBreakdown(rows, 1000);

    const div03 = result.find((d) => d.code === '03');
    expect(div03).toBeDefined();
    // Should be 50 * 20 = 1000, NOT 999 from row.total
    expect(div03!.total).toBe(1000);
  });
});

// ═══════════════════════════════════════════════════════════════════
// computeCostTypeBreakdown
// ═══════════════════════════════════════════════════════════════════

describe('computeCostTypeBreakdown', () => {
  it('groups by costType (M/L/S)', () => {
    const rows = [
      makeRow({ costType: 'M', matchedQty: 100, unitPrice: 10, id: 'row-1' }),
      makeRow({ costType: 'L', matchedQty: 50, unitPrice: 20, id: 'row-2' }),
      makeRow({ costType: 'S', matchedQty: 30, unitPrice: 15, id: 'row-3' }),
    ];
    const subtotal = 2450; // 1000 + 1000 + 450
    const result = computeCostTypeBreakdown(rows, subtotal);

    const materials = result.find((c) => c.key === 'M');
    const labor = result.find((c) => c.key === 'L');
    const sub = result.find((c) => c.key === 'S');

    expect(materials!.total).toBe(1000);
    expect(labor!.total).toBe(1000);
    expect(sub!.total).toBe(450);
  });

  it('falls back unknown cost types to "M"', () => {
    const rows = [
      makeRow({ costType: 'X', matchedQty: 100, unitPrice: 10 }),
    ];
    const result = computeCostTypeBreakdown(rows, 1000);

    const materials = result.find((c) => c.key === 'M');
    expect(materials!.total).toBe(1000);
  });

  it('uses matchedQty × unitPrice, NOT row.total (regression)', () => {
    const rows = [
      makeRow({ costType: 'M', matchedQty: 50, unitPrice: 20, total: 999 }),
    ];
    const result = computeCostTypeBreakdown(rows, 1000);

    const materials = result.find((c) => c.key === 'M');
    // Should be 50 * 20 = 1000, NOT 999 from row.total
    expect(materials!.total).toBe(1000);
  });
});

// ═══════════════════════════════════════════════════════════════════
// computePersonnelCosts
// ═══════════════════════════════════════════════════════════════════

describe('computePersonnelCosts', () => {
  it('returns zero staff costs when all utilizations are 0', () => {
    const result = computePersonnelCosts(
      12,
      {},
      { dumpsters: 0, toilets: 0, electric: 0 }
    );
    // Staff lines should all be zero
    result.staffLines.forEach((line) => {
      expect(line.qty).toBe(0);
      expect(line.total).toBe(0);
    });
    // Operational lines should also be zero (su utilization is 0, fixed lines still have qty = 12)
    // But grandTotal should include operational fixed lines
    expect(result.equipmentTotal).toBe(0);
  });

  it('computes correct qty for 100% utilization on one role', () => {
    // 173.2 hours per month × 12 months × (100/100) = 2078.4
    const result = computePersonnelCosts(
      12,
      { ex: 100 },
      { dumpsters: 0, toilets: 0, electric: 0 }
    );
    const exLine = result.staffLines.find((l) => l.code === '01-0310');
    expect(exLine).toBeDefined();
    expect(exLine!.qty).toBeCloseTo(12 * 173.2);
    expect(exLine!.total).toBeCloseTo(12 * 173.2 * 175);
  });

  it('includes equipment overrides in grand total', () => {
    const result = computePersonnelCosts(
      12,
      {},
      { dumpsters: 1000, toilets: 2000, electric: 3000 }
    );
    expect(result.equipmentTotal).toBe(6000);
    // grandTotal should include the equipment
    expect(result.grandTotal).toBeGreaterThanOrEqual(6000);
  });
});

// ═══════════════════════════════════════════════════════════════════
// computeSiteOperations
// ═══════════════════════════════════════════════════════════════════

describe('computeSiteOperations', () => {
  it('produces expected dynamic lines for standard inputs', () => {
    const result = computeSiteOperations(
      12,
      10000,
      { knox: 2, payrollCleaning: 10, hiredCleaning: 5, soilBorings: 3 },
      { soilBorings: 1500 }
    );

    // Dynamic: Safety = 12 * 500, Temp Protection = 10000 * 0.25, Material Hoist = 12 * 6500
    const safety = result.dynamicLines.find((l) => l.desc === 'Safety');
    expect(safety!.total).toBe(12 * 500);

    const tempProt = result.dynamicLines.find((l) => l.desc === 'Temporary Protection');
    expect(tempProt!.total).toBe(10000 * 0.25);

    const hoist = result.dynamicLines.find((l) => l.desc === 'Material Hoist');
    expect(hoist!.total).toBe(12 * 6500);

    // Manual: Soil Borings = 3 * 1500
    const borings = result.manualLines.find((l) => l.desc === 'Soil Borings');
    expect(borings!.total).toBe(3 * 1500);
  });

  it('returns zero totals for zero quantities', () => {
    const result = computeSiteOperations(
      0,
      0,
      { knox: 0, payrollCleaning: 0, hiredCleaning: 0, soilBorings: 0 },
      { soilBorings: 0 }
    );
    expect(result.grandTotal).toBe(0);
  });
});
