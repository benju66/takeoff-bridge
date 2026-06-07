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
// Market Sector Classification
// ---------------------------------------------------------------------------

/** Market sector options — selected (required) at project creation; stored as display label. */
export const MARKET_SECTORS = [
  "Commercial",
  "Educational",
  "Government",
  "Healthcare",
  "Housing and Hotel",
  "Industrial",
  "Restaurant",
  "Workplace",
] as const;

// ---------------------------------------------------------------------------
// Division 01 — General Conditions Configurable Rate Table
// ---------------------------------------------------------------------------

/** Cost-type letters matching the Procore budget importer ("M"/"L"/"S"). */
export type GcCostType = "M" | "L" | "S";

export interface StaffRoleConfig {
  key: string;            // Internal lookup key (e.g., "ex", "srPm")
  code: string;           // STEP 2 criterion code (e.g., "01-0310.001") — template-aligned (Phase 3)
  procoreCode: string;    // Granular Procore BLI code — user-confirmed mapping (Phase 1 findings §4.1)
  costType: GcCostType;   // Template Budget Line Items col B cost type
  label: string;          // Display name (e.g., "Project Executive")
  defaultRate: number;    // Corporate default hourly rate
}

/**
 * Corporate default rate table. Individual projects may override
 * rates via project-level rate overrides in a future iteration.
 * The calculation layer accepts an optional rateOverrides map
 * keyed by StaffRoleConfig.key to support this.
 *
 * Codes carry the template's `.001` criterion suffix and each line's
 * user-confirmed Budget Line Items code (gc-siteops Phase 1 findings §4.1) —
 * the single source of truth for the GC → BLI export mapping.
 */
export const STAFF_ROLE_DEFAULTS: StaffRoleConfig[] = [
  { key: "ex",     code: "01-0310.001", procoreCode: "1-10310.000", costType: "L", label: "Project Executive",     defaultRate: 175 },
  { key: "srPm",   code: "01-0320.001", procoreCode: "1-10320.000", costType: "L", label: "Sr Project Manager",    defaultRate: 135 },
  { key: "pm",     code: "01-0330.001", procoreCode: "1-10330.000", costType: "L", label: "Project Manager",        defaultRate: 120 },
  { key: "pe",     code: "01-0340.001", procoreCode: "1-10340.000", costType: "L", label: "Project Engineer",       defaultRate: 85 },
  { key: "srSu",   code: "01-0410.001", procoreCode: "1-10410.000", costType: "L", label: "Sr Superintendent",      defaultRate: 125 },
  { key: "su",     code: "01-0420.001", procoreCode: "1-10420.000", costType: "L", label: "Superintendent",          defaultRate: 110 },
  { key: "asstSu", code: "01-0430.001", procoreCode: "1-10430.000", costType: "L", label: "Asst. Superintendent",   defaultRate: 85 },
  { key: "pa",     code: "01-0510.001", procoreCode: "1-10510.000", costType: "L", label: "Project Assistant",       defaultRate: 55 },
];

/** Standard working hours per calendar month */
export const HOURS_PER_MONTH = 173.2;

/**
 * Operational expense line items with an automatic quantity driver.
 * Drivers (all mirror the template STEP 2 column-F formulas — Phase 4 forensic read):
 *  - "superintendent": duration × Su utilization (template `=$J$5*E<n>`)
 *  - "fixed":          project duration in months (template `=$J$5`)
 *  - "sqftPer3000":    building sqft ÷ 3000 (template `=J8/3000`, Fire Extinguishers)
 */
export interface OperationalExpenseConfig {
  code: string;           // STEP 2 criterion code (template-aligned, Phase 3)
  procoreCode: string;    // Granular Procore BLI code (Phase 1 findings §4.1)
  costType: GcCostType;
  description: string;
  unit: string;
  rate: number;
  quantityDriver: "superintendent" | "fixed" | "sqftPer3000";
  /** UI grouping: "operational" = original 01.B rows; "gcMonthly" = Phase 4 auto rows */
  section: "operational" | "gcMonthly";
}

export const OPERATIONAL_EXPENSE_DEFAULTS: OperationalExpenseConfig[] = [
  { code: "01-1000.001", procoreCode: "1-11000.000", costType: "M", description: "Small Tools (Bound to Superintendent)", unit: "mo", rate: 500, quantityDriver: "superintendent", section: "operational" },
  { code: "01-1200.001", procoreCode: "1-11200.000", costType: "M", description: "Fuel and Vehicle Charges (Bound to Superintendent)", unit: "mo", rate: 1200, quantityDriver: "superintendent", section: "operational" },
  { code: "01-5111.001", procoreCode: "1-15111.000", costType: "M", description: "Cell Phone (Fixed Baseline)", unit: "mo", rate: 135, quantityDriver: "fixed", section: "operational" },
  // --- Phase 4: duration/sqft-driven GC lines, harvested forensically from template STEP 2 ---
  { code: "01-4010.001", procoreCode: "1-14010.000", costType: "M", description: "Quality", unit: "mo", rate: 500, quantityDriver: "fixed", section: "gcMonthly" },
  // D2a sign-off (findings §9): 01-5110.002 has no BLI row of its own → sibling 1-15110.000
  { code: "01-5110.002", procoreCode: "1-15110.000", costType: "M", description: "Temp Office (Monthly)", unit: "mo", rate: 850, quantityDriver: "fixed", section: "gcMonthly" },
  { code: "01-5112.001", procoreCode: "1-15112.000", costType: "M", description: "Jobsite Office Equipment", unit: "mo", rate: 250, quantityDriver: "fixed", section: "gcMonthly" },
  { code: "01-5114.001", procoreCode: "1-15114.000", costType: "M", description: "Project Computers / Internet", unit: "mo", rate: 300, quantityDriver: "fixed", section: "gcMonthly" },
  { code: "01-5120.001", procoreCode: "1-15120.000", costType: "M", description: "Storage Trailer", unit: "mo", rate: 800, quantityDriver: "fixed", section: "gcMonthly" },
  { code: "01-5150.001", procoreCode: "1-15150.000", costType: "M", description: "Temporary Fire Extinguishers (sqft ÷ 3000)", unit: "ea", rate: 100, quantityDriver: "sqftPer3000", section: "gcMonthly" },
  { code: "01-5180.001", procoreCode: "1-15180.000", costType: "M", description: "Temporary Gas (not winter heat)", unit: "mo", rate: 900, quantityDriver: "fixed", section: "gcMonthly" },
  { code: "01-5190.001", procoreCode: "1-15190.000", costType: "M", description: "Temporary Water", unit: "mo", rate: 650, quantityDriver: "fixed", section: "gcMonthly" },
  { code: "01-6010.001", procoreCode: "1-16010.000", costType: "M", description: "Courier services", unit: "mo", rate: 350, quantityDriver: "fixed", section: "gcMonthly" },
  { code: "01-6020.001", procoreCode: "1-16020.000", costType: "M", description: "Plan Reproduction", unit: "mo", rate: 250, quantityDriver: "fixed", section: "gcMonthly" },
];

// ---------------------------------------------------------------------------
// Division 01 — Phase 4 Manual GC Entry Lines
// ---------------------------------------------------------------------------

/**
 * GC line with an estimator-typed value (Phase 4).
 *  - entry "qty":     estimator types a quantity; total = qty × template rate
 *  - entry "lumpSum": estimator types a dollar amount; total = the amount
 *    (used for template rows with no default rate, and for the two
 *    %-of-estimate lines where the template has the estimator hand-type the
 *    dollar amount to break circularity — findings §5.2)
 * Values persist under `key` in the `gc_equipment_overrides` JSONB snapshot
 * (free-form Record<string, number> — no schema change).
 */
export interface GcManualConfig {
  key: string;            // persistence key in the gc_equipment_overrides JSONB
  code: string;           // STEP 2 criterion code (template-aligned)
  procoreCode: string;    // Granular Procore BLI code (Phase 1 findings §4.1)
  costType: GcCostType;
  label: string;
  unit: string;
  entry: "qty" | "lumpSum";
  rate: number | null;    // template rate for "qty" lines; null for lumpSum
  /** Template % guidance for the two %-of-estimate lines (e.g. 0.0019 = 0.19%) */
  pctHint?: number;
  /** UI grouping: "design" = Design & Preconstruction; "gcManual" = GC manual entries */
  section: "design" | "gcManual";
}

/**
 * Phase 4 manual GC lines — codes/descriptions/units/rates harvested
 * forensically from template STEP 2 (rows 19–23, 35, 38–39, 41, 50, 56).
 * All BLI cost types verified "Material" in template BLI col B.
 */
export const GC_MANUAL_DEFAULTS: GcManualConfig[] = [
  { key: "preconFees",       code: "01-0001.001", procoreCode: "1-10001.000", costType: "M", label: "Preconstruction Fees",   unit: "ls", entry: "lumpSum", rate: null, section: "design" },
  { key: "designArch",       code: "01-0130.001", procoreCode: "1-10130.000", costType: "M", label: "Design - Architecture",  unit: "ls", entry: "lumpSum", rate: null, section: "design" },
  { key: "designCivil",      code: "01-0160.001", procoreCode: "1-10160.000", costType: "M", label: "Design - Civil",         unit: "ls", entry: "lumpSum", rate: null, section: "design" },
  { key: "designMep",        code: "01-0180.001", procoreCode: "1-10180.000", costType: "M", label: "Design - MEP",           unit: "ls", entry: "lumpSum", rate: null, section: "design" },
  { key: "designStructural", code: "01-0210.001", procoreCode: "1-10210.000", costType: "M", label: "Design - Structural",    unit: "ls", entry: "lumpSum", rate: null, section: "design" },
  { key: "safetyConsultant", code: "01-0610.001", procoreCode: "1-10610.000", costType: "M", label: "Safety Consultant",      unit: "ls", entry: "lumpSum", rate: null, pctHint: 0.0002, section: "gcManual" },
  { key: "travelMeals",      code: "01-1400.001", procoreCode: "1-11400.000", costType: "M", label: "Travel and Meals",       unit: "ls", entry: "lumpSum", rate: null, section: "gcManual" },
  { key: "procoreFee",       code: "01-1600.001", procoreCode: "1-11600.000", costType: "M", label: "Procore",                unit: "ls", entry: "lumpSum", rate: null, pctHint: 0.0019, section: "gcManual" },
  { key: "tempOfficeSetup",  code: "01-5110.001", procoreCode: "1-15110.000", costType: "M", label: "Temp Office Set up and Takedown", unit: "ea", entry: "qty", rate: 9000, section: "gcManual" },
  { key: "projectSigns",     code: "01-5160.001", procoreCode: "1-15160.000", costType: "M", label: "Temporary Project Signs", unit: "ea", entry: "qty", rate: 1500, section: "gcManual" },
  { key: "legalFees",        code: "01-7010.001", procoreCode: "1-17010.000", costType: "M", label: "Legal Fees",             unit: "ls", entry: "qty", rate: 5000, section: "gcManual" },
];

/** Fixed lump-sum equipment lines entered by the estimator on STEP 2 */
export interface EquipmentExpenseConfig {
  key: "dumpsters" | "toilets" | "electric"; // matches the equipmentOverrides field
  code: string;           // STEP 2 criterion code (template-aligned, Phase 3)
  procoreCode: string;    // Granular Procore BLI code (Phase 1 findings §4.1)
  costType: GcCostType;
  label: string;
}

/**
 * Single source of truth for the 3 GC equipment lines (previously inlined in
 * PersonnelPricingStep.tsx as EQ_DISPLAY) — added in gc-siteops Phase 3 so the
 * export mapping and the UI cannot drift.
 */
export const EQUIPMENT_DEFAULTS: EquipmentExpenseConfig[] = [
  { key: "dumpsters", code: "01-5130.001", procoreCode: "1-15130.000", costType: "M", label: "Dumpsters (Lump Sum)" },
  { key: "toilets",   code: "01-5140.001", procoreCode: "1-15140.000", costType: "M", label: "Temp Toilets (Lump Sum)" },
  { key: "electric",  code: "01-5170.001", procoreCode: "1-15170.000", costType: "M", label: "Temp Electric (Lump Sum)" },
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

/**
 * STEP 3 subtotal sections, in template row order (Phase 4 forensic read).
 * The Step 3 UI mirrors these groups; each section id is carried on every
 * Site Ops line config below.
 */
export type SiteOpsSection =
  | "siteOperations"
  | "demolition"
  | "finalCleaning"
  | "swppp"
  | "survey"
  | "buildingServices"
  | "siteEquipment"
  | "specialInspections";

export const SITE_OPS_SECTIONS: { id: SiteOpsSection; label: string }[] = [
  { id: "siteOperations",     label: "02.A — Site Operations" },
  { id: "demolition",         label: "02.B — Demolition" },
  { id: "finalCleaning",      label: "02.C — Final Cleaning" },
  { id: "swppp",              label: "02.D — SWPPP Permit" },
  { id: "survey",             label: "02.E — Survey & Layout" },
  { id: "buildingServices",   label: "02.F — Building and Site Services" },
  { id: "siteEquipment",      label: "02.G — Site Equipment" },
  { id: "specialInspections", label: "02.H — Special Inspections" },
];

/** Site Ops line driven by a project parameter (duration / square footage) */
export interface SiteOpsDynamicConfig {
  code: string;           // STEP 3 criterion code (template-aligned, Phase 3)
  procoreCode: string;    // Granular Procore BLI code (Phase 1 findings §4.2)
  costType: GcCostType;
  label: string;
  unit: string;
  rate: number;
  quantityDriver: "duration" | "squareFootage";
  section: SiteOpsSection;
}

/**
 * Site Ops line with an estimator-typed value (entry kinds — Phase 4):
 *  - "qty":     typed quantity × template rate
 *  - "qtyRate": typed quantity × typed rate (soil borings)
 *  - "lumpSum": typed dollar amount (template rows with no default rate)
 * Values persist under `key` in the `site_ops_quantities` JSONB snapshot
 * (legacy lines keep their original `qty…` keys via the hook).
 */
export interface SiteOpsManualConfig {
  key: string;            // persistence/lookup key in the quantities record
  code: string;
  procoreCode: string;
  costType: GcCostType;
  label: string;
  unit: string;
  entry: "qty" | "qtyRate" | "lumpSum";
  rate: number | null;    // template rate for "qty"; null for "qtyRate"/"lumpSum"
  section: SiteOpsSection;
}

/**
 * Single source of truth for the Site Ops lines (previously inlined in
 * InfrastructureStep.tsx and duplicated with stale codes in calculations.ts).
 * Codes carry the template's STEP 3 criterion suffix; each line's BLI code is
 * the user-confirmed mapping (gc-siteops Phase 1 findings §4.2 + D2 sign-off:
 * orphan lines 02-9010.002 / 02-4100.002 / 02-9200.002 have no BLI row of
 * their own and map to their sibling's code).
 */
export const SITE_OPS_DYNAMIC_DEFAULTS: SiteOpsDynamicConfig[] = [
  { code: "02-9015.001", procoreCode: "2-29015.000", costType: "M", label: "Safety", unit: "mo", rate: SAFETY_RATE_PER_MONTH, quantityDriver: "duration", section: "siteOperations" },
  { code: "02-9020.001", procoreCode: "2-29020.000", costType: "M", label: "Temp Protection", unit: "sf", rate: TEMP_PROTECTION_RATE_PER_SF, quantityDriver: "squareFootage", section: "siteOperations" },
  { code: "02-9405.001", procoreCode: "2-29405.000", costType: "M", label: "Material Hoist / Trash Chute", unit: "mo", rate: MATERIAL_HOIST_RATE_PER_MONTH, quantityDriver: "duration", section: "siteEquipment" },
];

/**
 * Phase 4: full STEP 3 input coverage — codes/descriptions/units/rates
 * harvested forensically from the template; BLI codes from findings §4.2;
 * cost types re-verified against template BLI col B (note FFE Relocation
 * 2-25100.000 is "S" — caught in the Phase 4 re-verification).
 */
export const SITE_OPS_MANUAL_DEFAULTS: SiteOpsManualConfig[] = [
  // --- 02.A Site Operations (template rows 12–27) ---
  { key: "soilBorings",     code: "02-3200.001", procoreCode: "2-23200.000", costType: "M", label: "Soil Borings", unit: "ls", entry: "qtyRate", rate: null, section: "siteOperations" },
  { key: "ffeRelocation",   code: "02-5100.001", procoreCode: "2-25100.000", costType: "S", label: "FFE Relocation", unit: "ls", entry: "lumpSum", rate: null, section: "siteOperations" },
  { key: "abatement",       code: "02-8213.001", procoreCode: "2-28213.000", costType: "S", label: "Abatement", unit: "ls", entry: "lumpSum", rate: null, section: "siteOperations" },
  { key: "payrollCleaning", code: "02-9010.001", procoreCode: "2-29010.000", costType: "M", label: "Progress Cleaning - Payroll", unit: "hr", entry: "qty", rate: PAYROLL_CLEANING_RATE_PER_EA, section: "siteOperations" },
  { key: "hiredCleaning",   code: "02-9010.002", procoreCode: "2-29010.000", costType: "M", label: "Progress Cleaning - Hired", unit: "hr", entry: "qty", rate: HIRED_CLEANING_RATE_PER_EA, section: "siteOperations" },
  { key: "tempPartitions",  code: "02-9025.001", procoreCode: "2-29025.000", costType: "M", label: "Temporary Partitions", unit: "ea", entry: "qty", rate: 5000, section: "siteOperations" },
  { key: "trafficControl",  code: "02-9030.001", procoreCode: "2-29030.000", costType: "M", label: "Traffic Control and Jersey Barriers", unit: "lf", entry: "qty", rate: 25, section: "siteOperations" },
  { key: "tempFencing",     code: "02-9035.001", procoreCode: "2-29035.000", costType: "M", label: "Temporary Fencing", unit: "lf", entry: "qty", rate: 15, section: "siteOperations" },
  { key: "scrim",           code: "02-9040.001", procoreCode: "2-29040.000", costType: "M", label: "Scrim", unit: "lf", entry: "qty", rate: 20, section: "siteOperations" },
  { key: "tempAccessRoads", code: "02-9045.001", procoreCode: "2-29045.000", costType: "S", label: "Temp Access Roads", unit: "ls", entry: "qty", rate: 5000, section: "siteOperations" },
  { key: "siteSecurity",    code: "02-9050.001", procoreCode: "2-29050.000", costType: "M", label: "Site Security", unit: "mo", entry: "qty", rate: 2000, section: "siteOperations" },
  { key: "securityCameras", code: "02-9055.001", procoreCode: "2-29055.000", costType: "M", label: "Site Security Cameras", unit: "mo", entry: "qty", rate: 1000, section: "siteOperations" },
  { key: "jobsiteCamera",   code: "02-9060.001", procoreCode: "2-29060.000", costType: "M", label: "Jobsite Camera", unit: "mo", entry: "qty", rate: 1000, section: "siteOperations" },
  { key: "constructionPermits", code: "02-9065.001", procoreCode: "2-29065.000", costType: "M", label: "Construction Permits (not building permit)", unit: "ea", entry: "lumpSum", rate: null, section: "siteOperations" },
  { key: "knox",            code: "02-9307.001", procoreCode: "2-29307.000", costType: "M", label: "Knox Box", unit: "ea", entry: "qty", rate: KNOX_BOX_UNIT_COST, section: "buildingServices" },
  // --- 02.B Demolition (rows 32–33; D2c: sawcutting → sibling BLI) ---
  { key: "demolition",      code: "02-4100.001", procoreCode: "2-24100.000", costType: "S", label: "Demolition", unit: "sf", entry: "qty", rate: 6, section: "demolition" },
  { key: "sawcutting",      code: "02-4100.002", procoreCode: "2-24100.000", costType: "S", label: "Demolition - Sawcutting", unit: "ls", entry: "lumpSum", rate: null, section: "demolition" },
  // --- 02.C Final Cleaning (row 38) ---
  { key: "finalCleaning",   code: "02-9005.001", procoreCode: "2-29005.000", costType: "S", label: "Final Cleaning", unit: "ea", entry: "qty", rate: 2500, section: "finalCleaning" },
  // --- 02.D SWPPP Permit (row 43) ---
  { key: "swpppPermit",     code: "02-9070.001", procoreCode: "2-29070.000", costType: "M", label: "SWPPP Permit", unit: "ea", entry: "qty", rate: 400, section: "swppp" },
  // --- 02.E Survey & Layout (rows 48–49; D2d: floor scanning → sibling BLI) ---
  { key: "surveyLayout",    code: "02-9200.001", procoreCode: "2-29200.000", costType: "S", label: "Survey & Layout", unit: "ls", entry: "lumpSum", rate: null, section: "survey" },
  { key: "floorScanning",   code: "02-9200.002", procoreCode: "2-29200.000", costType: "S", label: "Survey & Layout - Floor Scanning", unit: "ls", entry: "lumpSum", rate: null, section: "survey" },
  // --- 02.F Building and Site Services (rows 54–60) ---
  { key: "cityRequirements", code: "02-9305.001", procoreCode: "2-29305.000", costType: "M", label: "City Requirements", unit: "ls", entry: "lumpSum", rate: null, section: "buildingServices" },
  { key: "permPowerService", code: "02-9310.001", procoreCode: "2-29310.000", costType: "M", label: "Permanent Power Service", unit: "ls", entry: "lumpSum", rate: null, section: "buildingServices" },
  { key: "tempPowerService", code: "02-9315.001", procoreCode: "2-29315.000", costType: "M", label: "Temporary Power Service", unit: "ls", entry: "lumpSum", rate: null, section: "buildingServices" },
  { key: "gasService",      code: "02-9320.001", procoreCode: "2-29320.000", costType: "M", label: "Gas Service", unit: "ls", entry: "lumpSum", rate: null, section: "buildingServices" },
  { key: "cableService",    code: "02-9325.001", procoreCode: "2-29325.000", costType: "M", label: "Cable Service", unit: "ls", entry: "lumpSum", rate: null, section: "buildingServices" },
  { key: "dataService",     code: "02-9330.001", procoreCode: "2-29330.000", costType: "M", label: "Data Service", unit: "ls", entry: "lumpSum", rate: null, section: "buildingServices" },
  // --- 02.G Site Equipment (rows 66–70) ---
  { key: "scaffolding",     code: "02-9410.001", procoreCode: "2-29410.000", costType: "M", label: "Scaffolding & Platforms", unit: "mo", entry: "lumpSum", rate: null, section: "siteEquipment" },
  { key: "craneRental",     code: "02-9415.001", procoreCode: "2-29415.000", costType: "M", label: "Crane Rental", unit: "mo", entry: "lumpSum", rate: null, section: "siteEquipment" },
  { key: "equipmentRental", code: "02-9420.001", procoreCode: "2-29420.000", costType: "M", label: "Equipment Rental", unit: "mo", entry: "qty", rate: 2000, section: "siteEquipment" },
  { key: "forkliftRental",  code: "02-9425.001", procoreCode: "2-29425.000", costType: "M", label: "Forklift Rental", unit: "mo", entry: "qty", rate: 4000, section: "siteEquipment" },
  { key: "streetSweeping",  code: "02-9430.001", procoreCode: "2-29430.000", costType: "M", label: "Street Sweeping", unit: "mo", entry: "qty", rate: 300, section: "siteEquipment" },
  // --- 02.H Special Inspections (rows 75–80) ---
  { key: "materialsTesting",      code: "02-9505.001", procoreCode: "2-29505.000", costType: "M", label: "Construction Materials Testing", unit: "ls", entry: "lumpSum", rate: null, section: "specialInspections" },
  { key: "vibrationMonitoring",   code: "02-9510.001", procoreCode: "2-29510.000", costType: "M", label: "Vibration Monitoring", unit: "ls", entry: "lumpSum", rate: null, section: "specialInspections" },
  { key: "acousticTesting",       code: "02-9515.001", procoreCode: "2-29515.000", costType: "M", label: "Acoustic Testing", unit: "ls", entry: "lumpSum", rate: null, section: "specialInspections" },
  { key: "windowTesting",         code: "02-9520.001", procoreCode: "2-29520.000", costType: "M", label: "Window Testing", unit: "ls", entry: "lumpSum", rate: null, section: "specialInspections" },
  { key: "weatherBarrierTesting", code: "02-9525.001", procoreCode: "2-29525.000", costType: "M", label: "Weather Barrier Testing", unit: "ls", entry: "lumpSum", rate: null, section: "specialInspections" },
  { key: "gypcreteTesting",       code: "02-9530.001", procoreCode: "2-29530.000", costType: "M", label: "Gypcrete Testing", unit: "ls", entry: "lumpSum", rate: null, section: "specialInspections" },
];

// ---------------------------------------------------------------------------
// STEP 4 ← STEP 2/3 Linked Division Rows (gc-siteops Phase 5)
// ---------------------------------------------------------------------------

/**
 * How a linked STEP 4 division row derives its value from the Step 2/3 calc
 * results (template pull map — Phase 1 findings §5.1, INTENT not the D4 bugs):
 *  - "gcSupervision": Σ staff lines whose code is in SUPERVISION_STAFF_CODES
 *                     (template STEP 2 I16 = Total Supervision)
 *  - "gcGeneral":     personnel grandTotal − supervision
 *                     (template STEP 2 I58 = Total Design, PM and GCs)
 *  - "siteOpsSection": Σ Site Ops lines in one template subtotal section
 */
export type LinkedDivisionSource =
  | { kind: "gcSupervision" }
  | { kind: "gcGeneral" }
  | { kind: "siteOpsSection"; section: SiteOpsSection };

export interface LinkedDivisionRowConfig {
  /** STEP 4 catalog itemId (template col C — codes kept as-is, user decision 2026-06-06) */
  itemId: string;
  /** Catalog description, for banner/test readability */
  description: string;
  /** Where the linked value comes from */
  source: LinkedDivisionSource;
  /** UI hint, e.g. "Step 3 — 02.B Demolition" */
  sourceLabel: string;
}

/** STEP 2 staff codes forming the template's "Total Supervision" subtotal (I16). */
export const SUPERVISION_STAFF_CODES = ["01-0410.001", "01-0420.001", "01-0430.001"];

/**
 * The 10 STEP 4 division-total rows that the template links to STEP 2/3
 * subtotals (rows 12–24). In the app these rows are READ-ONLY displays fed by
 * the Step 2/3 modules and are EXCLUDED from the Procore rollup, the export
 * gate, and manual entry — the 34+38 granular GC/Site Ops BLI codes carry the
 * dollars (double-count trap closure, user-approved 2026-06-06).
 *
 * ⚠ Match these itemIds against STEP 4 grid rows ONLY. The Step 3 source line
 * "Demolition - Sawcutting" reuses the string "02-4100.002" as its STEP 3
 * criterion code — same text, different sheet, unrelated line. Never join this
 * table to GC/Site Ops line configs by code.
 */
export const LINKED_DIVISION_ROWS: readonly LinkedDivisionRowConfig[] = [
  { itemId: "01-0000.001", description: "General Conditions",          source: { kind: "gcGeneral" },     sourceLabel: "Step 2 — Design, PM and GCs" },
  { itemId: "01-0400.002", description: "Supervision",                 source: { kind: "gcSupervision" }, sourceLabel: "Step 2 — Supervision" },
  { itemId: "02-0000.001", description: "Site Operations",             source: { kind: "siteOpsSection", section: "siteOperations" },     sourceLabel: "Step 3 — 02.A Site Operations" },
  { itemId: "02-4100.002", description: "Demolition",                  source: { kind: "siteOpsSection", section: "demolition" },         sourceLabel: "Step 3 — 02.B Demolition" },
  { itemId: "02-9005.003", description: "Final Cleaning",              source: { kind: "siteOpsSection", section: "finalCleaning" },      sourceLabel: "Step 3 — 02.C Final Cleaning" },
  { itemId: "02-9070.004", description: "SWPPP Permit",                source: { kind: "siteOpsSection", section: "swppp" },              sourceLabel: "Step 3 — 02.D SWPPP Permit" },
  { itemId: "02-9200.005", description: "Survey and Layout",           source: { kind: "siteOpsSection", section: "survey" },             sourceLabel: "Step 3 — 02.E Survey & Layout" },
  { itemId: "02-9300.006", description: "Building and Site Services",  source: { kind: "siteOpsSection", section: "buildingServices" },   sourceLabel: "Step 3 — 02.F Building and Site Services" },
  { itemId: "02-9400.007", description: "Site Equipment",              source: { kind: "siteOpsSection", section: "siteEquipment" },      sourceLabel: "Step 3 — 02.G Site Equipment" },
  { itemId: "02-9500.008", description: "Special Inspections",         source: { kind: "siteOpsSection", section: "specialInspections" }, sourceLabel: "Step 3 — 02.H Special Inspections" },
];

const LINKED_DIVISION_ITEM_ID_SET = new Set(LINKED_DIVISION_ROWS.map((r) => r.itemId));

/** True when a STEP 4 grid row is one of the 10 linked division-total rows. */
export function isLinkedDivisionRow(itemId: string | null | undefined): boolean {
  return LINKED_DIVISION_ITEM_ID_SET.has((itemId || "").trim());
}

// ---------------------------------------------------------------------------
// Search & Filter Defaults
// ---------------------------------------------------------------------------
export const SEARCH_DEBOUNCE_MS = 300;
