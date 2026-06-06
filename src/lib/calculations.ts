/**
 * Pure calculation functions extracted from page.tsx.
 * Zero React dependencies — these are testable utility functions.
 */

import { ProcessedTakeoffRow, DivisionAggregation, CostTypeAggregation } from "@/types";
import { getDivisionCode } from "./division";
import {
  STAFF_ROLE_DEFAULTS,
  OPERATIONAL_EXPENSE_DEFAULTS,
  EQUIPMENT_DEFAULTS,
  SITE_OPS_DYNAMIC_DEFAULTS,
  SITE_OPS_MANUAL_DEFAULTS,
  HOURS_PER_MONTH,
  DIVISION_NAMES,
  COMMODITY_THRESHOLD,
  GcCostType,
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
  staffLines: { code: string; procoreCode: string; costType: GcCostType; role: string; rate: number; qty: number; total: number }[];
  operationalLines: { code: string; procoreCode: string; costType: GcCostType; desc: string; unit: string; rate: number; qty: number; total: number }[];
  /** The 3 estimator-entered lump-sum equipment lines (gc-siteops Phase 3) */
  equipmentLines: { code: string; procoreCode: string; costType: GcCostType; desc: string; total: number }[];
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
    return { code: role.code, procoreCode: role.procoreCode, costType: role.costType, role: role.label, rate: effectiveRate, qty, total };
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
    return { code: expense.code, procoreCode: expense.procoreCode, costType: expense.costType, desc: expense.description, unit: expense.unit, rate: expense.rate, qty, total };
  });

  // Equipment lines (user-entered fixed values) — carried as mapped lines so
  // the export can place each on its own Budget Line Items row (Phase 3)
  const equipmentLines = EQUIPMENT_DEFAULTS.map((eq) => ({
    code: eq.code, procoreCode: eq.procoreCode, costType: eq.costType, desc: eq.label,
    total: equipmentOverrides[eq.key],
  }));
  const equipmentTotal = equipmentLines.reduce((sum, l) => sum + l.total, 0);

  // Grand total
  const staffTotal = staffLines.reduce((sum, l) => sum + l.total, 0);
  const opsTotal = operationalLines.reduce((sum, l) => sum + l.total, 0);
  const grandTotal = staffTotal + opsTotal + equipmentTotal;

  return { staffLines, operationalLines, equipmentLines, equipmentTotal, grandTotal };
}

// ---------------------------------------------------------------------------
// Division 02 — Site Operations Calculations
// ---------------------------------------------------------------------------

export interface SiteOpsCalcResult {
  dynamicLines: { code: string; procoreCode: string; costType: GcCostType; desc: string; unit: string; rate: number; qty: number; total: number }[];
  manualLines: { code: string; procoreCode: string; costType: GcCostType; desc: string; unit: string; rate: number; qty: number; total: number }[];
  grandTotal: number;
}

/**
 * Computes Division 02 Site Operations costs.
 * Lines derive from SITE_OPS_*_DEFAULTS (constants.ts) — the template-aligned
 * single source of truth (gc-siteops Phase 3 replaced the stale inline codes).
 */
export function computeSiteOperations(
  durationMonths: number,
  squareFootage: number,
  quantities: { knox: number; payrollCleaning: number; hiredCleaning: number; soilBorings: number },
  rates: { soilBorings: number }
): SiteOpsCalcResult {
  const dynamicLines = SITE_OPS_DYNAMIC_DEFAULTS.map((cfg) => {
    const qty = cfg.quantityDriver === "duration" ? durationMonths : squareFootage;
    return { code: cfg.code, procoreCode: cfg.procoreCode, costType: cfg.costType, desc: cfg.label, unit: cfg.unit, rate: cfg.rate, qty, total: qty * cfg.rate };
  });

  const manualLines = SITE_OPS_MANUAL_DEFAULTS.map((cfg) => {
    const rate = cfg.rate ?? rates.soilBorings; // null rate = estimator-entered (soil borings)
    const qty = quantities[cfg.key];
    return { code: cfg.code, procoreCode: cfg.procoreCode, costType: cfg.costType, desc: cfg.label, unit: cfg.unit, rate, qty, total: qty * rate };
  });

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
  constructionContingency: number;
  designContingency: number;
  buildersRisk: number;
  specialInsurance: number;
  glInsurance: number;
  bond: number;
  fee: number;
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
 *
 * All 7 modifier rates are decimals (e.g., 0.05 = 5%), matching the
 * company Excel template's "STEP 1 - PROJECT DATA" cells G18–G24.
 */
export function computeTakeoffSummary(
  rows: ProcessedTakeoffRow[],
  squareFootage: number,
  unitCount: number,
  rates?: {
    constructionContingencyRate: number;
    designContingencyRate: number;
    buildersRiskRate: number;
    specialInsuranceRate: number;
    glInsuranceRate: number;
    bondRate: number;
    feeRate: number;
    roundingRule: string;
  }
): TakeoffSummary {
  const subtotal = rows.reduce((sum, r) => sum + (r.matchedQty * r.unitPrice), 0);

  // Extract rates (decimals) with template defaults
  const ccRate = rates?.constructionContingencyRate ?? 0;
  const dcRate = rates?.designContingencyRate ?? 0;
  const brRate = rates?.buildersRiskRate ?? 0;
  const siRate = rates?.specialInsuranceRate ?? 0;
  const glRate = rates?.glInsuranceRate ?? 0.01;
  const bondRate = rates?.bondRate ?? 0;
  const feeRate = rates?.feeRate ?? 0.05;
  const roundingRule = rates?.roundingRule ?? "dollar";

  // Compute raw modifier values (subtotal × rate)
  const rawCC = subtotal * ccRate;
  const rawDC = subtotal * dcRate;
  const rawBR = subtotal * brRate;
  const rawSI = subtotal * siRate;
  const rawGL = subtotal * glRate;
  const rawBond = subtotal * bondRate;
  const rawFee = subtotal * feeRate;

  // Helper function for rounding
  const applyRounding = (val: number): number => {
    if (roundingRule === "dollar") {
      return Math.round(val);
    } else if (roundingRule === "ten") {
      return Math.round(val / 10) * 10;
    } else if (roundingRule === "hundred") {
      return Math.round(val / 100) * 100;
    }
    return val; // "none"
  };

  // Apply rounding to each component for visual sum alignment (Zero Budget Leaks)
  const roundedSubtotal = applyRounding(subtotal);
  const constructionContingency = applyRounding(rawCC);
  const designContingency = applyRounding(rawDC);
  const buildersRisk = applyRounding(rawBR);
  const specialInsurance = applyRounding(rawSI);
  const glInsurance = applyRounding(rawGL);
  const bond = applyRounding(rawBond);
  const fee = applyRounding(rawFee);

  // Total Estimated Cost is the exact sum of the rounded components
  const totalEstimatedCost = roundedSubtotal + constructionContingency + designContingency
    + buildersRisk + specialInsurance + glInsurance + bond + fee;
  const costPerSf = totalEstimatedCost / (squareFootage || 1);
  const costPerUnit = totalEstimatedCost / (unitCount || 1);

  return {
    subtotal: roundedSubtotal,
    constructionContingency,
    designContingency,
    buildersRisk,
    specialInsurance,
    glInsurance,
    bond,
    fee,
    totalEstimatedCost,
    costPerSf,
    costPerUnit,
  };
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
    const code = getDivisionCode(row.itemId);
    const division = code || "Unmapped";
    divisionTotals[division] = (divisionTotals[division] || 0) + (row.matchedQty * row.unitPrice);
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
      costTotals[type] += (row.matchedQty * row.unitPrice);
    } else {
      costTotals.M += (row.matchedQty * row.unitPrice);
    }
  });

  return [
    { key: "M", label: "Materials", total: costTotals.M, percentage: (costTotals.M / (subtotal || 1)) * 100 },
    { key: "L", label: "Labor", total: costTotals.L, percentage: (costTotals.L / (subtotal || 1)) * 100 },
    { key: "S", label: "Subcontract", total: costTotals.S, percentage: (costTotals.S / (subtotal || 1)) * 100 },
  ];
}

// ---------------------------------------------------------------------------
// Data Fidelity Classification Tagging
// ---------------------------------------------------------------------------

export type DataFidelity = "discrete_unit" | "macro_lump_sum";

/**
 * Evaluates row attributes to derive the data fidelity enum classification tag.
 */
export function evaluateDataFidelity(
  qty: number,
  uom: string,
  total: number,
  threshold: number = COMMODITY_THRESHOLD,
  keywords: string[] = ["LS", "SUM", "ALLW", "LUMP"]
): DataFidelity {
  const normalizedUom = (uom || "").trim().toUpperCase();
  const macroKeywords = keywords.map((k) => k.trim().toUpperCase());
  
  if (macroKeywords.includes(normalizedUom)) {
    return "macro_lump_sum";
  }
  
  if (qty === 1 && total > threshold) {
    return "macro_lump_sum";
  }
  
  return "discrete_unit";
}

/**
 * Safely parses and evaluates basic mathematical expressions.
 * Acceptable characters: numbers, decimals, basic math operators (+, -, *, /), parentheses, and whitespace.
 * Strips a leading '=' if present.
 * Returns NaN if expression contains unsafe characters, invalid syntax, or evaluates to a non-finite number.
 */
export function evaluateMathExpression(str: string): number {
  if (typeof str !== "string") return NaN;
  let trimmed = str.trim();
  if (trimmed.startsWith("=")) {
    trimmed = trimmed.substring(1).trim();
  }
  if (!trimmed) return NaN;
  
  // Validate characters: digits, decimals, whitespace, +, -, *, /, (, )
  if (!/^[0-9.+\-*/()\s]+$/.test(trimmed)) {
    return NaN;
  }

  // Tokenizer
  const tokens: string[] = [];
  let i = 0;
  while (i < trimmed.length) {
    const char = trimmed[i];
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    if (/[+\-*/()]/.test(char)) {
      tokens.push(char);
      i++;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      let numStr = "";
      while (i < trimmed.length && /[0-9.]/.test(trimmed[i])) {
        numStr += trimmed[i];
        i++;
      }
      tokens.push(numStr);
      continue;
    }
    return NaN;
  }

  if (tokens.length === 0) return NaN;

  let tokenIndex = 0;

  function peek(): string | undefined {
    return tokens[tokenIndex];
  }

  function consume(expected?: string): string {
    const token = tokens[tokenIndex];
    if (expected !== undefined && token !== expected) {
      throw new Error(`Expected ${expected} but got ${token}`);
    }
    tokenIndex++;
    return token;
  }

  function parseExpression(): number {
    let result = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = consume();
      const right = parseTerm();
      if (op === "+") {
        result += right;
      } else {
        result -= right;
      }
    }
    return result;
  }

  function parseTerm(): number {
    let result = parseFactor();
    while (peek() === "*" || peek() === "/") {
      const op = consume();
      const right = parseFactor();
      if (op === "*") {
        result *= right;
      } else {
        result /= right;
      }
    }
    return result;
  }

  function parseFactor(): number {
    const token = peek();
    if (!token) {
      throw new Error("Unexpected end of input");
    }

    if (token === "+") {
      consume();
      return parseFactor();
    }
    if (token === "-") {
      consume();
      return -parseFactor();
    }
    if (token === "(") {
      consume("(");
      const val = parseExpression();
      consume(")");
      return val;
    }

    // Number
    consume();
    const num = Number(token);
    if (isNaN(num)) {
      throw new Error(`Invalid number: ${token}`);
    }
    return num;
  }

  try {
    const val = parseExpression();
    if (tokenIndex < tokens.length) {
      return NaN;
    }
    return isFinite(val) && !isNaN(val) ? val : NaN;
  } catch {
    return NaN;
  }
}


