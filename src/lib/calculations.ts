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
  GC_MANUAL_DEFAULTS,
  SITE_OPS_DYNAMIC_DEFAULTS,
  SITE_OPS_MANUAL_DEFAULTS,
  HOURS_PER_MONTH,
  DIVISION_NAMES,
  COMMODITY_THRESHOLD,
  GcCostType,
  LINKED_DIVISION_ROWS,
  SUPERVISION_STAFF_CODES,
  SiteOpsSection,
  isLinkedDivisionRow,
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
  /** `utilization` is the input fraction (0–1), exposed for the STEP 2 sheet's col E (gc-siteops Phase 6) */
  staffLines: { code: string; procoreCode: string; costType: GcCostType; role: string; rate: number; qty: number; total: number; utilization: number }[];
  operationalLines: { code: string; procoreCode: string; costType: GcCostType; desc: string; unit: string; rate: number; qty: number; total: number }[];
  /** The 3 estimator-entered lump-sum equipment lines (gc-siteops Phase 3) */
  equipmentLines: { code: string; procoreCode: string; costType: GcCostType; desc: string; total: number }[];
  /** Phase 4: estimator-typed GC entries (qty × rate and lump-sum lines, GC_MANUAL_DEFAULTS) */
  manualLines: { code: string; procoreCode: string; costType: GcCostType; desc: string; unit: string; rate: number; qty: number; total: number }[];
  equipmentTotal: number;
  grandTotal: number;
}

/**
 * Computes Division 01 General Conditions costs.
 * @param durationMonths - Project duration in calendar months.
 * @param squareFootage - Building square footage (drives the sqftPer3000 lines — Phase 4).
 * @param utilizations - Map of StaffRoleConfig.key → utilization percentage (0-100).
 * @param equipmentOverrides - Fixed monthly equipment costs entered by user.
 * @param manualEntries - Estimator-typed GC values keyed by GcManualConfig.key (Phase 4).
 *                        "qty" lines hold a quantity; "lumpSum" lines hold a dollar amount.
 * @param rateOverrides - Optional project-level hourly rate overrides keyed by StaffRoleConfig.key.
 *                        Falls back to STAFF_ROLE_DEFAULTS.defaultRate when a key is absent.
 */
export function computePersonnelCosts(
  durationMonths: number,
  squareFootage: number,
  utilizations: Record<string, number>,
  equipmentOverrides: { dumpsters: number; toilets: number; electric: number },
  manualEntries: Record<string, number> = {},
  rateOverrides?: Record<string, number>
): PersonnelCalcResult {
  // Staff labour lines
  const staffLines = STAFF_ROLE_DEFAULTS.map((role) => {
    const effectiveRate = rateOverrides?.[role.key] ?? role.defaultRate;
    const utilization = (utilizations[role.key] || 0) / 100;
    const qty = durationMonths * HOURS_PER_MONTH * utilization;
    const total = qty * effectiveRate;
    return { code: role.code, procoreCode: role.procoreCode, costType: role.costType, role: role.label, rate: effectiveRate, qty, total, utilization };
  });

  // Operational expense lines (auto quantity drivers mirroring template STEP 2 col F)
  const suUtilization = utilizations["su"] || 0;
  const operationalLines = OPERATIONAL_EXPENSE_DEFAULTS.map((expense) => {
    let qty: number;
    if (expense.quantityDriver === "superintendent") {
      qty = durationMonths * (suUtilization / 100);
    } else if (expense.quantityDriver === "sqftPer3000") {
      qty = squareFootage / 3000; // template: =J8/3000 (Temporary Fire Extinguishers)
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

  // Manual GC entry lines (Phase 4): "qty" = typed qty × template rate;
  // "lumpSum" = typed dollar amount (incl. the two %-of-estimate lines, which
  // the template has the estimator hand-type to break circularity — §5.2)
  const manualLines = GC_MANUAL_DEFAULTS.map((cfg) => {
    const value = manualEntries[cfg.key] ?? 0;
    const isQty = cfg.entry === "qty";
    const qty = isQty ? value : value > 0 ? 1 : 0;
    const rate = isQty ? (cfg.rate ?? 0) : value;
    const total = isQty ? value * (cfg.rate ?? 0) : value;
    return { code: cfg.code, procoreCode: cfg.procoreCode, costType: cfg.costType, desc: cfg.label, unit: cfg.unit, rate, qty, total };
  });
  const manualTotal = manualLines.reduce((sum, l) => sum + l.total, 0);

  // Grand total
  const staffTotal = staffLines.reduce((sum, l) => sum + l.total, 0);
  const opsTotal = operationalLines.reduce((sum, l) => sum + l.total, 0);
  const grandTotal = staffTotal + opsTotal + equipmentTotal + manualTotal;

  return { staffLines, operationalLines, equipmentLines, manualLines, equipmentTotal, grandTotal };
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
 * Phase 4 entry kinds: "qty" = typed qty × template rate; "qtyRate" = typed
 * qty × typed rate; "lumpSum" = typed dollar amount.
 */
export function computeSiteOperations(
  durationMonths: number,
  squareFootage: number,
  quantities: Record<string, number>,
  rates: Record<string, number>
): SiteOpsCalcResult {
  const dynamicLines = SITE_OPS_DYNAMIC_DEFAULTS.map((cfg) => {
    const qty = cfg.quantityDriver === "duration" ? durationMonths : squareFootage;
    return { code: cfg.code, procoreCode: cfg.procoreCode, costType: cfg.costType, desc: cfg.label, unit: cfg.unit, rate: cfg.rate, qty, total: qty * cfg.rate };
  });

  const manualLines = SITE_OPS_MANUAL_DEFAULTS.map((cfg) => {
    const value = quantities[cfg.key] ?? 0;
    let qty: number;
    let rate: number;
    if (cfg.entry === "lumpSum") {
      qty = value > 0 ? 1 : 0;
      rate = value; // the typed dollar amount IS the line total
    } else if (cfg.entry === "qtyRate") {
      qty = value;
      rate = rates[cfg.key] ?? 0; // estimator-typed rate (soil borings)
    } else {
      qty = value;
      rate = cfg.rate ?? 0;
    }
    const total = cfg.entry === "lumpSum" ? value : qty * rate;
    return { code: cfg.code, procoreCode: cfg.procoreCode, costType: cfg.costType, desc: cfg.label, unit: cfg.unit, rate, qty, total };
  });

  const dynamicTotal = dynamicLines.reduce((sum, l) => sum + l.total, 0);
  const manualTotal = manualLines.reduce((sum, l) => sum + l.total, 0);
  const grandTotal = dynamicTotal + manualTotal;

  return { dynamicLines, manualLines, grandTotal };
}

// ---------------------------------------------------------------------------
// STEP 4 ← STEP 2/3 Linked Division Totals (gc-siteops Phase 5)
// ---------------------------------------------------------------------------

export interface LinkedDivisionTotal {
  itemId: string;
  description: string;
  sourceLabel: string;
  total: number;
}

/**
 * Computes the live value of each of the 10 linked STEP 4 division rows from
 * the Step 2/3 calc results, per the template pull map (findings §5.1 INTENT —
 * the D4 single-cell bugs are not reproduced). Invariant: the 10 totals sum to
 * gcCalcResult.grandTotal + siteOpsCalcResult.grandTotal exactly (every GC and
 * Site Ops line belongs to exactly one linked row).
 */
export function computeLinkedDivisionTotals(
  gcCalcResult: PersonnelCalcResult,
  siteOpsCalcResult: SiteOpsCalcResult
): LinkedDivisionTotal[] {
  const supervisionTotal = gcCalcResult.staffLines
    .filter((l) => SUPERVISION_STAFF_CODES.includes(l.code))
    .reduce((sum, l) => sum + l.total, 0);
  const gcGeneralTotal = gcCalcResult.grandTotal - supervisionTotal;

  // Section lookup: Site Ops line code → template subtotal section. Codes are
  // unique within the Site Ops configs; this never consults STEP 4 itemIds
  // (the "02-4100.002" string collision is between different sheets).
  const sectionByCode = new Map<string, SiteOpsSection>();
  for (const cfg of SITE_OPS_DYNAMIC_DEFAULTS) sectionByCode.set(cfg.code, cfg.section);
  for (const cfg of SITE_OPS_MANUAL_DEFAULTS) sectionByCode.set(cfg.code, cfg.section);

  const sectionTotals = new Map<SiteOpsSection, number>();
  for (const line of [...siteOpsCalcResult.dynamicLines, ...siteOpsCalcResult.manualLines]) {
    const section = sectionByCode.get(line.code);
    if (!section) continue; // unknown line — constants test guards against this
    sectionTotals.set(section, (sectionTotals.get(section) || 0) + line.total);
  }

  return LINKED_DIVISION_ROWS.map((cfg) => {
    let total = 0;
    if (cfg.source.kind === "gcSupervision") total = supervisionTotal;
    else if (cfg.source.kind === "gcGeneral") total = gcGeneralTotal;
    else total = sectionTotals.get(cfg.source.section) || 0;
    return { itemId: cfg.itemId, description: cfg.description, sourceLabel: cfg.sourceLabel, total };
  });
}

// ---------------------------------------------------------------------------
// Step 4 — Takeoff Summary Calculations
// ---------------------------------------------------------------------------

export interface TakeoffSummary {
  /** Whole-job subtotal: takeoff rows + linked GC/Site Ops division values (Phase 5) */
  subtotal: number;
  /** STEP 4 takeoff rows only (linked division rows excluded) */
  takeoffSubtotal: number;
  /** Σ linked division values counted into `subtotal` */
  linkedDivisionsTotal: number;
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
 *
 * MODIFIER BASIS (gc-siteops Phase 5, user-approved 2026-06-06): the subtotal
 * the modifiers and cost-per-SF/unit compute on INCLUDES the linked GC + Site
 * Ops division values — matching the template, whose modifiers compute on
 * STEP 4 I331 (which includes rows 12–24). The 10 linked division rows are
 * display-only: their typed qty×price NEVER counts (double-count trap
 * closure); each contributes its linked value instead, and only while the row
 * is present in `rows` (so Amendment-F filtered views stay coherent).
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
  },
  linkedTotals?: LinkedDivisionTotal[]
): TakeoffSummary {
  const linkedByItemId = new Map((linkedTotals ?? []).map((l) => [l.itemId, l.total]));
  let takeoffSubtotal = 0;
  let linkedDivisionsTotal = 0;
  const seenLinked = new Set<string>();
  for (const r of rows) {
    if (isLinkedDivisionRow(r.itemId)) {
      // Count each linked value once, even if a duplicate row carries the itemId
      const id = (r.itemId || "").trim();
      if (!seenLinked.has(id)) {
        seenLinked.add(id);
        linkedDivisionsTotal += linkedByItemId.get(id) ?? 0;
      }
    } else {
      takeoffSubtotal += r.matchedQty * r.unitPrice;
    }
  }
  const subtotal = takeoffSubtotal + linkedDivisionsTotal;

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
    takeoffSubtotal,
    linkedDivisionsTotal,
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
 * Per-row dollar value for aggregations: linked division rows contribute their
 * linked value (typed qty×price never counts — Phase 5 trap closure), all
 * other rows contribute matchedQty × unitPrice. Counts each linked itemId once.
 */
function makeEffectiveAmount(linkedTotals?: LinkedDivisionTotal[]) {
  const linkedByItemId = new Map((linkedTotals ?? []).map((l) => [l.itemId, l.total]));
  const seenLinked = new Set<string>();
  return (row: ProcessedTakeoffRow): number => {
    if (isLinkedDivisionRow(row.itemId)) {
      const id = (row.itemId || "").trim();
      if (seenLinked.has(id)) return 0;
      seenLinked.add(id);
      return linkedByItemId.get(id) ?? 0;
    }
    return row.matchedQty * row.unitPrice;
  };
}

/**
 * Computes division-level budget breakdown for the analytics drawer.
 */
export function computeDivisionBreakdown(
  rows: ProcessedTakeoffRow[],
  subtotal: number,
  linkedTotals?: LinkedDivisionTotal[]
): DivisionAggregation[] {
  const divisionTotals: Record<string, number> = {};
  const effectiveAmount = makeEffectiveAmount(linkedTotals);

  rows.forEach((row) => {
    const code = getDivisionCode(row.itemId);
    const division = code || "Unmapped";
    divisionTotals[division] = (divisionTotals[division] || 0) + effectiveAmount(row);
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
  subtotal: number,
  linkedTotals?: LinkedDivisionTotal[]
): CostTypeAggregation[] {
  const costTotals: Record<string, number> = { M: 0, L: 0, S: 0 };
  const effectiveAmount = makeEffectiveAmount(linkedTotals);

  rows.forEach((row) => {
    const type = (row.costType || "M").toUpperCase();
    const amount = effectiveAmount(row);
    if (type in costTotals) {
      costTotals[type] += amount;
    } else {
      costTotals.M += amount;
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


