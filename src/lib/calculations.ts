/**
 * Pure calculation functions extracted from page.tsx.
 * Zero React dependencies — these are testable utility functions.
 */

import { ProcessedTakeoffRow, DivisionAggregation, CostTypeAggregation } from "@/types";
import {
  STAFF_ROLE_DEFAULTS,
  OPERATIONAL_EXPENSE_DEFAULTS,
  HOURS_PER_MONTH,
  DIVISION_NAMES,
} from "./constants";

// ---------------------------------------------------------------------------
// Date Utility
// ---------------------------------------------------------------------------

/**
 * Computes the number of calendar months between two YYYY-MM date strings.
 * Returns 0 for invalid inputs or negative durations.
 */
export function getMonthsBetween(startStr: string, finishStr: string): number {
  if (!startStr || !finishStr) return 0;
  const startParts = startStr.split("-").map(Number);
  const finishParts = finishStr.split("-").map(Number);
  if (startParts.length < 2 || finishParts.length < 2) return 0;
  const yearsDiff = finishParts[0] - startParts[0];
  const monthsDiff = finishParts[1] - startParts[1];
  const totalMonths = yearsDiff * 12 + monthsDiff;
  return totalMonths > 0 ? totalMonths : 0;
}

// ---------------------------------------------------------------------------
// Terminal Progress Bar
// ---------------------------------------------------------------------------

/**
 * Renders a 10-block Unicode progress bar for terminal-style display.
 */
export function getTerminalProgressBar(percentage: number): string {
  const totalBlocks = 10;
  const filledBlocks = Math.min(totalBlocks, Math.max(0, Math.round(percentage / 10)));
  const emptyBlocks = totalBlocks - filledBlocks;
  return "█".repeat(filledBlocks) + "░".repeat(emptyBlocks);
}

// ---------------------------------------------------------------------------
// Division 01 — General Conditions Personnel Calculations
// ---------------------------------------------------------------------------

export interface PersonnelCalcResult {
  staffLines: { code: string; role: string; rate: number; qty: number; total: number }[];
  operationalLines: { code: string; desc: string; unit: string; rate: number; qty: number; total: number }[];
  equipmentTotal: number;
  grandTotal: number;
}

/**
 * Computes Division 01 General Conditions costs.
 * @param durationMonths - Project duration in calendar months.
 * @param utilizations - Map of StaffRoleConfig.key → utilization percentage (0-100).
 * @param equipmentOverrides - Fixed monthly equipment costs entered by user.
 * @param rateOverrides - Optional project-level hourly rate overrides keyed by StaffRoleConfig.key.
 *                        Falls back to STAFF_ROLE_DEFAULTS.defaultRate when a key is absent.
 */
export function computePersonnelCosts(
  durationMonths: number,
  utilizations: Record<string, number>,
  equipmentOverrides: { dumpsters: number; toilets: number; electric: number },
  rateOverrides?: Record<string, number>
): PersonnelCalcResult {
  // Staff labour lines
  const staffLines = STAFF_ROLE_DEFAULTS.map((role) => {
    const effectiveRate = rateOverrides?.[role.key] ?? role.defaultRate;
    const qty = durationMonths * HOURS_PER_MONTH * ((utilizations[role.key] || 0) / 100);
    const total = qty * effectiveRate;
    return { code: role.code, role: role.label, rate: effectiveRate, qty, total };
  });

  // Operational expense lines
  const suUtilization = utilizations["su"] || 0;
  const operationalLines = OPERATIONAL_EXPENSE_DEFAULTS.map((expense) => {
    let qty: number;
    if (expense.quantityDriver === "superintendent") {
      qty = durationMonths * (suUtilization / 100);
    } else {
      qty = durationMonths;
    }
    const total = qty * expense.rate;
    return { code: expense.code, desc: expense.description, unit: expense.unit, rate: expense.rate, qty, total };
  });

  // Equipment total (user-entered fixed values)
  const equipmentTotal = equipmentOverrides.dumpsters + equipmentOverrides.toilets + equipmentOverrides.electric;

  // Grand total
  const staffTotal = staffLines.reduce((sum, l) => sum + l.total, 0);
  const opsTotal = operationalLines.reduce((sum, l) => sum + l.total, 0);
  const grandTotal = staffTotal + opsTotal + equipmentTotal;

  return { staffLines, operationalLines, equipmentTotal, grandTotal };
}

// ---------------------------------------------------------------------------
// Division 02 — Site Operations Calculations
// ---------------------------------------------------------------------------

export interface SiteOpsCalcResult {
  dynamicLines: { code: string; desc: string; unit: string; rate: number; qty: number; total: number }[];
  manualLines: { code: string; desc: string; unit: string; rate: number; qty: number; total: number }[];
  grandTotal: number;
}

/**
 * Computes Division 02 Site Operations costs.
 */
export function computeSiteOperations(
  durationMonths: number,
  squareFootage: number,
  quantities: { knox: number; payrollCleaning: number; hiredCleaning: number; soilBorings: number },
  rates: { soilBorings: number }
): SiteOpsCalcResult {
  const dynamicLines = [
    { code: "01-3000", desc: "Safety", unit: "mo", rate: 500, qty: durationMonths, total: durationMonths * 500 },
    { code: "01-5000", desc: "Temporary Protection", unit: "sf", rate: 0.25, qty: squareFootage, total: squareFootage * 0.25 },
    { code: "01-5400", desc: "Material Hoist", unit: "mo", rate: 6500, qty: durationMonths, total: durationMonths * 6500 },
  ];

  const manualLines = [
    { code: "01-5200", desc: "Knox Boxes", unit: "ea", rate: 650, qty: quantities.knox, total: quantities.knox * 650 },
    { code: "01-5300", desc: "Payroll Cleaning", unit: "ea", rate: 74, qty: quantities.payrollCleaning, total: quantities.payrollCleaning * 74 },
    { code: "01-5310", desc: "Hired Cleaning", unit: "ea", rate: 54, qty: quantities.hiredCleaning, total: quantities.hiredCleaning * 54 },
    { code: "01-5600", desc: "Soil Borings", unit: "ea", rate: rates.soilBorings, qty: quantities.soilBorings, total: quantities.soilBorings * rates.soilBorings },
  ];

  const dynamicTotal = dynamicLines.reduce((sum, l) => sum + l.total, 0);
  const manualTotal = manualLines.reduce((sum, l) => sum + l.total, 0);
  const grandTotal = dynamicTotal + manualTotal;

  return { dynamicLines, manualLines, grandTotal };
}

// ---------------------------------------------------------------------------
// Step 4 — Takeoff Summary Calculations
// ---------------------------------------------------------------------------

export interface TakeoffSummary {
  subtotal: number;
  generalLiability: number;   // subtotal × 0.01
  contractorFee: number;      // subtotal × 0.05
  totalEstimatedCost: number;
  costPerSf: number;
  costPerUnit: number;
}

/**
 * Computes Step 4 takeoff summary totals.
 * 
 * AMENDMENT (BUG-1): Subtotal is computed as SUM(matchedQty × unitPrice)
 * per row, NOT from the cached row.total field, to prevent silent drift
 * between UI subtotal and exported subtotal.
 */
export function computeTakeoffSummary(
  rows: ProcessedTakeoffRow[],
  squareFootage: number,
  unitCount: number
): TakeoffSummary {
  const subtotal = rows.reduce((sum, r) => sum + (r.matchedQty * r.unitPrice), 0);
  const generalLiability = subtotal * 0.01;
  const contractorFee = subtotal * 0.05;
  const totalEstimatedCost = subtotal + generalLiability + contractorFee;
  const costPerSf = totalEstimatedCost / (squareFootage || 1);
  const costPerUnit = totalEstimatedCost / (unitCount || 1);

  return { subtotal, generalLiability, contractorFee, totalEstimatedCost, costPerSf, costPerUnit };
}

// ---------------------------------------------------------------------------
// Divisional & Cost Type Budget Aggregations
// ---------------------------------------------------------------------------

/**
 * Computes division-level budget breakdown for the analytics drawer.
 */
export function computeDivisionBreakdown(
  rows: ProcessedTakeoffRow[],
  subtotal: number
): DivisionAggregation[] {
  const divisionTotals: Record<string, number> = {};

  rows.forEach((row) => {
    const code = row.itemId && row.itemId.length >= 2 ? row.itemId.substring(0, 2) : "";
    const division = /^\d{2}$/.test(code) ? code : "Unmapped";
    divisionTotals[division] = (divisionTotals[division] || 0) + row.total;
  });

  return Object.entries(divisionTotals)
    .filter(([, total]) => total > 0)
    .map(([code, total]) => {
      const name = code === "Unmapped" ? "Unmapped Scope" : (DIVISION_NAMES[code] || `Division ${code}`);
      const percentage = (total / (subtotal || 1)) * 100;
      return { code, name, total, percentage };
    })
    .sort((a, b) => {
      if (a.code === "Unmapped") return 1;
      if (b.code === "Unmapped") return -1;
      return a.code.localeCompare(b.code);
    });
}

/**
 * Computes cost-type budget breakdown (Materials / Labor / Subcontract).
 */
export function computeCostTypeBreakdown(
  rows: ProcessedTakeoffRow[],
  subtotal: number
): CostTypeAggregation[] {
  const costTotals: Record<string, number> = { M: 0, L: 0, S: 0 };

  rows.forEach((row) => {
    const type = (row.costType || "M").toUpperCase();
    if (type in costTotals) {
      costTotals[type] += row.total;
    } else {
      costTotals.M += row.total;
    }
  });

  return [
    { key: "M", label: "Materials", total: costTotals.M, percentage: (costTotals.M / (subtotal || 1)) * 100 },
    { key: "L", label: "Labor", total: costTotals.L, percentage: (costTotals.L / (subtotal || 1)) * 100 },
    { key: "S", label: "Subcontract", total: costTotals.S, percentage: (costTotals.S / (subtotal || 1)) * 100 },
  ];
}
