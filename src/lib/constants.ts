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
  "02": "Site Operations",
  "03": "Concrete",
  "04": "Masonry",
  "05": "Metals",
  "06": "Wood, Plastics, Composites",
  "07": "Thermal & Moisture Protection",
  "08": "Openings",
  "09": "Finishes",
  "10": "Specialties",
  "11": "Equipment",
  "12": "Furnishings",
  "13": "Special Construction",
  "14": "Conveying Equipment",
  "21": "Fire Suppression",
  "22": "Plumbing",
  "23": "HVAC",
  "26": "Electrical",
  "27": "Communications",
  "28": "Electronic Safety and Security",
  "31": "Earthwork",
  "32": "Exterior Improvements",
  "33": "Utilities",
  "50": "Winter Conditions",
  "80": "Allowances",
};

/** Full division labels including descriptive suffixes for Step 4 divider rows */
export const DIVISION_LABELS: Record<string, string> = {
  "01": "DIVISION 01 — GENERAL CONDITIONS",
  "02": "DIVISION 02 — SITE OPERATIONS",
  "03": "DIVISION 03 — CONCRETE",
  "04": "DIVISION 04 — MASONRY",
  "05": "DIVISION 05 — METALS",
  "06": "DIVISION 06 — WOOD, PLASTICS, COMPOSITES",
  "07": "DIVISION 07 — THERMAL & MOISTURE PROTECTION",
  "08": "DIVISION 08 — OPENINGS",
  "09": "DIVISION 09 — FINISHES",
  "10": "DIVISION 10 — SPECIALTIES",
  "11": "DIVISION 11 — EQUIPMENT",
  "12": "DIVISION 12 — FURNISHINGS",
  "13": "DIVISION 13 — SPECIAL CONSTRUCTION",
  "14": "DIVISION 14 — CONVEYING EQUIPMENT",
  "21": "DIVISION 21 — FIRE SUPPRESSION",
  "22": "DIVISION 22 — PLUMBING",
  "23": "DIVISION 23 — HVAC",
  "26": "DIVISION 26 — ELECTRICAL",
  "27": "DIVISION 27 — COMMUNICATIONS",
  "28": "DIVISION 28 — ELECTRONIC SAFETY AND SECURITY",
  "31": "DIVISION 31 — EARTHWORK",
  "32": "DIVISION 32 — EXTERIOR IMPROVEMENTS",
  "33": "DIVISION 33 — UTILITIES",
  "50": "DIVISION 50 — WINTER CONDITIONS",
  "80": "DIVISION 80 — ALLOWANCES",
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
// Estimate Modifier Definitions (Template-Aligned)
// ---------------------------------------------------------------------------

/** Configuration for a single estimate modifier row matching the company Excel template */
export interface EstimateModifierConfig {
  /** Internal lookup key (camelCase, matches TakeoffSummary field) */
  key: string;
  /** DB rate column suffix (snake_case, matches projects table column) */
  rateColumn: string;
  /** Human-readable label matching the template description */
  label: string;
  /** Cost code from STEP 4 - ESTIMATE (e.g., "60-1000.001") */
  code: string;
  /** Template default rate as a decimal (e.g., 0.05 = 5%) */
  defaultRate: number;
  /** Cell reference in "STEP 1 - PROJECT DATA" sheet */
  step1Cell: string;
}

/**
 * The 7 estimate modifier rows from the company Excel template.
 * Drives the EstimateTable footer, calculations, exports, and
 * ArchitecturalParametersStep UI. Eliminates magic strings.
 */
export const ESTIMATE_MODIFIERS: readonly EstimateModifierConfig[] = [
  { key: 'constructionContingency', rateColumn: 'construction_contingency_rate', label: 'Construction Contingency', code: '60-1000.001', defaultRate: 0, step1Cell: 'G18' },
  { key: 'designContingency', rateColumn: 'design_contingency_rate', label: 'Design Contingency', code: '60-1005.001', defaultRate: 0, step1Cell: 'G19' },
  { key: 'buildersRisk', rateColumn: 'builders_risk_rate', label: 'Builders Risk Insurance', code: '60-2010.001', defaultRate: 0, step1Cell: 'G20' },
  { key: 'specialInsurance', rateColumn: 'special_insurance_rate', label: 'Special Insurance', code: '60-2015.001', defaultRate: 0, step1Cell: 'G21' },
  { key: 'glInsurance', rateColumn: 'gl_insurance_rate', label: 'General Liability Insurance', code: '60-2020.001', defaultRate: 0.01, step1Cell: 'G22' },
  { key: 'bond', rateColumn: 'bond_rate', label: 'Bond', code: '60-2025.001', defaultRate: 0, step1Cell: 'G23' },
  { key: 'fee', rateColumn: 'fee_rate', label: 'Fee', code: '60-4000.001', defaultRate: 0.05, step1Cell: 'G24' },
];

/** Standard Commodity threshold for lump sum evaluation */
export const COMMODITY_THRESHOLD = 5000;

// ---------------------------------------------------------------------------
// Corporate Estimate Template (Phase 3b)
// ---------------------------------------------------------------------------

/**
 * Canonical filename of the single master estimate template.
 * Keys template_config + cost_code_map rows and the Storage object name.
 * (Per-project-type templates are deferred — see §8.0 of the Phase 3 plan.)
 */
export const MASTER_TEMPLATE_NAME = "Company_Estimate_Template.xlsx";

/**
 * Private Supabase Storage bucket holding the template .xlsx files.
 * Read requires an authenticated session; writes go through
 * `npm run upload-template` (service role) only.
 */
export const TEMPLATE_STORAGE_BUCKET = "templates";

// ---------------------------------------------------------------------------
// Grid Display Defaults
// ---------------------------------------------------------------------------

/** Default decimal places for currency columns (unitPrice, total, costPerUnit, costPerSf) */
export const DEFAULT_CURRENCY_DECIMALS = 2;

/** Default decimal places for quantity columns (matchedQty) */
export const DEFAULT_QTY_DECIMALS = 2;

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

// ---------------------------------------------------------------------------
// Search & Filter Defaults
// ---------------------------------------------------------------------------
export const SEARCH_DEBOUNCE_MS = 300;
