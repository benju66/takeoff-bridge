/**
 * Shared constants for the Takeoff Bridge estimation platform.
 * Consolidates division labels and configurable rate tables
 * that were previously duplicated across multiple page-level components.
 */

// ---------------------------------------------------------------------------
// Division Reference Labels
// ---------------------------------------------------------------------------

/** Short division names for analytics display and registry scope columns */
export const DIVISION_NAMES: Record<string, string> = {
  "01": "General Conditions",
  "02": "Existing Conditions",
  "03": "Concrete",
  "04": "Masonry",
  "05": "Metals",
  "06": "Wood & Plastics",
  "07": "Thermal & Moisture",
  "08": "Openings",
  "09": "Finishes",
};

/** Full division labels including descriptive suffixes for Step 4 divider rows */
export const DIVISION_LABELS: Record<string, string> = {
  "01": "DIVISION 01 — GENERAL CONDITIONS",
  "02": "DIVISION 02 — SITE REQUIREMENTS",
  "03": "DIVISION 03 — CONCRETE",
  "04": "DIVISION 04 — MASONRY",
  "05": "DIVISION 05 — METALS",
  "06": "DIVISION 06 — WOOD & PLASTICS",
  "07": "DIVISION 07 — THERMAL & MOISTURE",
  "08": "DIVISION 08 — OPENINGS",
  "09": "DIVISION 09 — FINISHES",
};

// ---------------------------------------------------------------------------
// Division 01 — General Conditions Configurable Rate Table
// ---------------------------------------------------------------------------

export interface StaffRoleConfig {
  key: string;          // Internal lookup key (e.g., "ex", "srPm")
  code: string;         // Cost code (e.g., "01-0310")
  label: string;        // Display name (e.g., "Project Executive")
  defaultRate: number;  // Corporate default hourly rate
}

/**
 * Corporate default rate table. Individual projects may override
 * rates via project-level rate overrides in a future iteration.
 * The calculation layer accepts an optional rateOverrides map
 * keyed by StaffRoleConfig.key to support this.
 */
export const STAFF_ROLE_DEFAULTS: StaffRoleConfig[] = [
  { key: "ex",     code: "01-0310", label: "Project Executive",     defaultRate: 175 },
  { key: "srPm",   code: "01-0320", label: "Sr Project Manager",    defaultRate: 135 },
  { key: "pm",     code: "01-0330", label: "Project Manager",        defaultRate: 120 },
  { key: "pe",     code: "01-0340", label: "Project Engineer",       defaultRate: 85 },
  { key: "srSu",   code: "01-0410", label: "Sr Superintendent",      defaultRate: 125 },
  { key: "su",     code: "01-0420", label: "Superintendent",          defaultRate: 110 },
  { key: "asstSu", code: "01-0430", label: "Asst. Superintendent",   defaultRate: 85 },
  { key: "pa",     code: "01-0510", label: "Project Assistant",       defaultRate: 55 },
];

/** Standard working hours per calendar month */
export const HOURS_PER_MONTH = 173.2;

/** Operational expense line items bound to superintendent utilization or fixed baselines */
export interface OperationalExpenseConfig {
  code: string;
  description: string;
  unit: string;
  rate: number;
  quantityDriver: "superintendent" | "fixed"; // "superintendent" = bound to Su utilization, "fixed" = bound to duration
}

export const OPERATIONAL_EXPENSE_DEFAULTS: OperationalExpenseConfig[] = [
  { code: "01-1000", description: "Small Tools (Bound to Superintendent)", unit: "mo", rate: 500, quantityDriver: "superintendent" },
  { code: "01-1200", description: "Fuel and Vehicle Charges (Bound to Superintendent)", unit: "mo", rate: 1200, quantityDriver: "superintendent" },
  { code: "01-5111", description: "Cell Phone (Fixed Baseline)", unit: "mo", rate: 135, quantityDriver: "fixed" },
];

// ---------------------------------------------------------------------------
// Financial Markup Rates
// ---------------------------------------------------------------------------

/** General Liability Insurance — 1% of subtotal */
export const GL_RATE = 0.01;

/** Contractor Fee — 5% of subtotal */
export const FEE_RATE = 0.05;

// ---------------------------------------------------------------------------
// Division 02 — Site Operations Default Rates
// ---------------------------------------------------------------------------

// Dynamic rates (quantity driven by project duration or square footage)
export const SAFETY_RATE_PER_MONTH = 500;
export const TEMP_PROTECTION_RATE_PER_SF = 0.25;
export const MATERIAL_HOIST_RATE_PER_MONTH = 6500;

// Manual rates (quantity entered by estimator)
export const KNOX_BOX_UNIT_COST = 650;
export const PAYROLL_CLEANING_RATE_PER_EA = 74;
export const HIRED_CLEANING_RATE_PER_EA = 54;
