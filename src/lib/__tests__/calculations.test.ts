import { describe, it, expect } from 'vitest';
import {
  getMonthsBetween,
  computePersonnelCosts,
  computeSiteOperations,
  computeTakeoffSummary,
  computeDivisionBreakdown,
  computeCostTypeBreakdown,
  evaluateDataFidelity,
  evaluateMathExpression,
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
    procoreCode: overrides.procoreCode ?? '',
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
  it('computes subtotal, GL at 1%, fee at 5%, and total correctly', () => {
    const rows = [
      makeRow({ matchedQty: 100, unitPrice: 10 }),
      makeRow({ matchedQty: 200, unitPrice: 5, id: 'row-2', itemId: '05-1000' }),
    ];
    const result = computeTakeoffSummary(rows, 1000, 10, {
      constructionContingencyRate: 0,
      designContingencyRate: 0,
      buildersRiskRate: 0,
      specialInsuranceRate: 0,
      glInsuranceRate: 0.01,
      bondRate: 0,
      feeRate: 0.05,
      roundingRule: "none"
    });

    // subtotal = (100 * 10) + (200 * 5) = 2000
    expect(result.subtotal).toBe(2000);
    expect(result.glInsurance).toBe(2000 * 0.01); // 20
    expect(result.fee).toBe(2000 * 0.05); // 100
    expect(result.totalEstimatedCost).toBe(2000 + 20 + 100); // 2120
    expect(result.costPerSf).toBeCloseTo(2120 / 1000);
    expect(result.costPerUnit).toBeCloseTo(2120 / 10);
  });

  it('computes all 7 modifiers independently', () => {
    const rows = [
      makeRow({ matchedQty: 100, unitPrice: 100 }), // subtotal = 10000
    ];
    const result = computeTakeoffSummary(rows, 1000, 10, {
      constructionContingencyRate: 0.03,
      designContingencyRate: 0.02,
      buildersRiskRate: 0.005,
      specialInsuranceRate: 0.0075,
      glInsuranceRate: 0.01,
      bondRate: 0.015,
      feeRate: 0.05,
      roundingRule: "none"
    });

    expect(result.subtotal).toBe(10000);
    expect(result.constructionContingency).toBe(10000 * 0.03);   // 300
    expect(result.designContingency).toBe(10000 * 0.02);         // 200
    expect(result.buildersRisk).toBe(10000 * 0.005);             // 50
    expect(result.specialInsurance).toBe(10000 * 0.0075);        // 75
    expect(result.glInsurance).toBe(10000 * 0.01);               // 100
    expect(result.bond).toBe(10000 * 0.015);                     // 150
    expect(result.fee).toBe(10000 * 0.05);                       // 500
    expect(result.totalEstimatedCost).toBe(10000 + 300 + 200 + 50 + 75 + 100 + 150 + 500); // 11375
    expect(result.costPerSf).toBeCloseTo(11375 / 1000);
    expect(result.costPerUnit).toBeCloseTo(11375 / 10);
  });

  it('applies dollar rounding rules to summary components and total', () => {
    const rows = [
      makeRow({ matchedQty: 100, unitPrice: 10.25, costType: 'M' }), // subtotal = 1025
    ];
    const result = computeTakeoffSummary(rows, 1000, 10, {
      constructionContingencyRate: 0.10,  // 102.5 -> rounds to 103
      designContingencyRate: 0.05,        // 51.25 -> rounds to 51
      buildersRiskRate: 0.0125,           // 12.8125 -> rounds to 13
      specialInsuranceRate: 0,
      glInsuranceRate: 0,
      bondRate: 0,
      feeRate: 0,
      roundingRule: "dollar"
    });

    expect(result.subtotal).toBe(1025);
    expect(result.constructionContingency).toBe(103);
    expect(result.designContingency).toBe(51);
    expect(result.buildersRisk).toBe(13);
    // 1025 + 103 + 51 + 13 = 1192
    expect(result.totalEstimatedCost).toBe(1192);
  });

  it('applies ten and hundred rounding rules to components and total', () => {
    const rows = [
      makeRow({ matchedQty: 100, unitPrice: 10.25, costType: 'M' }), // subtotal = 1025
    ];

    // Nearest $10 rounding
    const resultTen = computeTakeoffSummary(rows, 1000, 10, {
      constructionContingencyRate: 0.10,  // 102.5 -> rounds to 100
      designContingencyRate: 0.05,        // 51.25 -> rounds to 50
      buildersRiskRate: 0.0125,           // 12.8125 -> rounds to 10
      specialInsuranceRate: 0,
      glInsuranceRate: 0,
      bondRate: 0,
      feeRate: 0,
      roundingRule: "ten"
    });
    expect(resultTen.subtotal).toBe(1030); // 1025 -> 1030
    expect(resultTen.constructionContingency).toBe(100);
    expect(resultTen.designContingency).toBe(50);
    expect(resultTen.buildersRisk).toBe(10);
    expect(resultTen.totalEstimatedCost).toBe(1030 + 100 + 50 + 10); // 1190

    // Nearest $100 rounding
    const resultHundred = computeTakeoffSummary(rows, 1000, 10, {
      constructionContingencyRate: 0.10,  // 102.5 -> rounds to 100
      designContingencyRate: 0.05,        // 51.25 -> rounds to 100
      buildersRiskRate: 0.0125,           // 12.8125 -> rounds to 0
      specialInsuranceRate: 0,
      glInsuranceRate: 0,
      bondRate: 0,
      feeRate: 0,
      roundingRule: "hundred"
    });
    expect(resultHundred.subtotal).toBe(1000); // 1025 -> 1000
    expect(resultHundred.constructionContingency).toBe(100);
    expect(resultHundred.designContingency).toBe(100);
    expect(resultHundred.buildersRisk).toBe(0);
    expect(resultHundred.totalEstimatedCost).toBe(1000 + 100 + 100 + 0); // 1200
  });

  it('returns all zeros for empty rows', () => {
    const result = computeTakeoffSummary([], 1000, 10, {
      constructionContingencyRate: 0.10,
      designContingencyRate: 0.05,
      buildersRiskRate: 0.01,
      specialInsuranceRate: 0.0075,
      glInsuranceRate: 0.01,
      bondRate: 0.015,
      feeRate: 0.05,
      roundingRule: "dollar"
    });
    expect(result.subtotal).toBe(0);
    expect(result.constructionContingency).toBe(0);
    expect(result.designContingency).toBe(0);
    expect(result.buildersRisk).toBe(0);
    expect(result.specialInsurance).toBe(0);
    expect(result.glInsurance).toBe(0);
    expect(result.bond).toBe(0);
    expect(result.fee).toBe(0);
    expect(result.totalEstimatedCost).toBe(0);
  });

  it('uses fallback divisor of 1 for zero squareFootage', () => {
    const rows = [makeRow({ matchedQty: 100, unitPrice: 10 })];
    const result = computeTakeoffSummary(rows, 0, 10, {
      constructionContingencyRate: 0,
      designContingencyRate: 0,
      buildersRiskRate: 0,
      specialInsuranceRate: 0,
      glInsuranceRate: 0.01,
      bondRate: 0,
      feeRate: 0.05,
      roundingRule: "none"
    });
    // costPerSf should divide by 1, not crash on divide-by-zero
    expect(result.costPerSf).toBe(result.totalEstimatedCost);
  });

  it('uses fallback divisor of 1 for zero unitCount', () => {
    const rows = [makeRow({ matchedQty: 100, unitPrice: 10 })];
    const result = computeTakeoffSummary(rows, 1000, 0, {
      constructionContingencyRate: 0,
      designContingencyRate: 0,
      buildersRiskRate: 0,
      specialInsuranceRate: 0,
      glInsuranceRate: 0.01,
      bondRate: 0,
      feeRate: 0.05,
      roundingRule: "none"
    });
    // costPerUnit should divide by 1, not crash on divide-by-zero
    expect(result.costPerUnit).toBe(result.totalEstimatedCost);
  });

  it('uses matchedQty × unitPrice, NOT row.total (regression)', () => {
    // row.total is set to 999 (wrong value) — summary should ignore it
    const rows = [makeRow({ matchedQty: 50, unitPrice: 20, total: 999 })];
    const result = computeTakeoffSummary(rows, 1000, 10, {
      constructionContingencyRate: 0,
      designContingencyRate: 0,
      buildersRiskRate: 0,
      specialInsuranceRate: 0,
      glInsuranceRate: 0.01,
      bondRate: 0,
      feeRate: 0.05,
      roundingRule: "none"
    });
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

// ═══════════════════════════════════════════════════════════════════
// evaluateDataFidelity
// ═══════════════════════════════════════════════════════════════════

describe('evaluateDataFidelity', () => {
  it('classifies to macro_lump_sum when UOM matches a macro keyword case-insensitively', () => {
    expect(evaluateDataFidelity(10, 'LS', 1000)).toBe('macro_lump_sum');
    expect(evaluateDataFidelity(5, 'sum', 200)).toBe('macro_lump_sum');
    expect(evaluateDataFidelity(1, 'Allw', 50)).toBe('macro_lump_sum');
    expect(evaluateDataFidelity(100, 'LUMP', 25000)).toBe('macro_lump_sum');
    expect(evaluateDataFidelity(1, '  ls  ', 100)).toBe('macro_lump_sum'); // trim support
  });

  it('classifies to macro_lump_sum when qty is exactly 1 and total exceeds standard commodity threshold (5000)', () => {
    expect(evaluateDataFidelity(1, 'SF', 5001)).toBe('macro_lump_sum');
    expect(evaluateDataFidelity(1, 'LF', 10000)).toBe('macro_lump_sum');
  });

  it('classifies to discrete_unit when qty is exactly 1 but total does not exceed standard threshold (5000)', () => {
    expect(evaluateDataFidelity(1, 'SF', 5000)).toBe('discrete_unit');
    expect(evaluateDataFidelity(1, 'LF', 4999)).toBe('discrete_unit');
    expect(evaluateDataFidelity(1, 'EA', 1000)).toBe('discrete_unit');
  });

  it('classifies to discrete_unit when qty is not exactly 1 even if total exceeds threshold', () => {
    expect(evaluateDataFidelity(2, 'SF', 10000)).toBe('discrete_unit');
    expect(evaluateDataFidelity(0.5, 'SF', 6000)).toBe('discrete_unit');
    expect(evaluateDataFidelity(0, 'SF', 10000)).toBe('discrete_unit');
  });

  it('classifies standard itemized components to discrete_unit', () => {
    expect(evaluateDataFidelity(150, 'SF', 1500)).toBe('discrete_unit');
    expect(evaluateDataFidelity(22, 'CY', 4400)).toBe('discrete_unit');
    expect(evaluateDataFidelity(1.5, 'TN', 600)).toBe('discrete_unit');
  });

  it('handles edge cases like empty, undefined, or invalid UOM strings gracefully', () => {
    expect(evaluateDataFidelity(1, '', 6000)).toBe('macro_lump_sum'); // qty=1 and total > 5000
    expect(evaluateDataFidelity(1, '', 4000)).toBe('discrete_unit');
    expect(evaluateDataFidelity(1, '  ', 6000)).toBe('macro_lump_sum');
  });

  it('supports custom commodity price thresholds', () => {
    // Custom threshold of 1000
    expect(evaluateDataFidelity(1, 'SF', 1500, 1000)).toBe('macro_lump_sum');
    expect(evaluateDataFidelity(1, 'SF', 900, 1000)).toBe('discrete_unit');
  });

  it('supports custom UOM keywords overrides list', () => {
    const customKeywords = ['QUOTE', 'FIXED'];
    expect(evaluateDataFidelity(10, 'QUOTE', 1000, 5000, customKeywords)).toBe('macro_lump_sum');
    expect(evaluateDataFidelity(5, 'FIXED', 200, 5000, customKeywords)).toBe('macro_lump_sum');
    expect(evaluateDataFidelity(1, 'LS', 1000, 5000, customKeywords)).toBe('discrete_unit'); // LS no longer macro keyword
  });
});

// ═══════════════════════════════════════════════════════════════════
// evaluateMathExpression
// ═══════════════════════════════════════════════════════════════════

describe('evaluateMathExpression', () => {
  it('evaluates simple math expressions correctly', () => {
    expect(evaluateMathExpression('1 + 2')).toBe(3);
    expect(evaluateMathExpression('10 - 4')).toBe(6);
    expect(evaluateMathExpression('3 * 4')).toBe(12);
    expect(evaluateMathExpression('12 / 3')).toBe(4);
  });

  it('handles leading equals sign correctly', () => {
    expect(evaluateMathExpression('= 5 + 5')).toBe(10);
    expect(evaluateMathExpression('=12 * 2')).toBe(24);
  });

  it('respects standard operator precedence and parentheses', () => {
    expect(evaluateMathExpression('2 + 3 * 4')).toBe(14);
    expect(evaluateMathExpression('(2 + 3) * 4')).toBe(20);
    expect(evaluateMathExpression('10 - 2 * (1 + 2)')).toBe(4);
  });

  it('evaluates decimals and whitespace correctly', () => {
    expect(evaluateMathExpression('1.5 + 2.5')).toBe(4);
    expect(evaluateMathExpression(' 2.5 *   2 ')).toBe(5);
    expect(evaluateMathExpression('.5 * 10')).toBe(5);
  });

  it('handles negative and positive unary operators correctly', () => {
    expect(evaluateMathExpression('-5 + 3')).toBe(-2);
    expect(evaluateMathExpression('+5 - 1')).toBe(4);
    expect(evaluateMathExpression('2 * -3')).toBe(-6);
    expect(evaluateMathExpression('-2 * -3')).toBe(6);
  });

  it('returns NaN for expressions with invalid characters', () => {
    expect(evaluateMathExpression('1 + alert(1)')).toBeNaN();
    expect(evaluateMathExpression('2 * abc')).toBeNaN();
    expect(evaluateMathExpression('1 + @')).toBeNaN();
  });

  it('returns NaN for syntax errors', () => {
    expect(evaluateMathExpression('')).toBeNaN();
    expect(evaluateMathExpression('   ')).toBeNaN();
    expect(evaluateMathExpression('1 +')).toBeNaN();
    expect(evaluateMathExpression('+')).toBeNaN();
    expect(evaluateMathExpression('1 + * 2')).toBeNaN();
    expect(evaluateMathExpression('(1 + 2')).toBeNaN();
    expect(evaluateMathExpression('1 + 2)')).toBeNaN();
    expect(evaluateMathExpression('1.2.3')).toBeNaN();
  });

  it('returns NaN for division by zero (non-finite)', () => {
    expect(evaluateMathExpression('1 / 0')).toBeNaN();
    expect(evaluateMathExpression('10 / (2 - 2)')).toBeNaN();
  });
});
