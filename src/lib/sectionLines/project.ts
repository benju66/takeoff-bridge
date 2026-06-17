/**
 * GC/Site-Ops Addressability — Phase A3 projection bridge (PURE).
 *
 * The inverse of `synthesize.ts`: take `EstimateSectionLine[]` and drive the
 * A1-parameterized calc engine off them. Reconstructs the engine input maps from
 * each line's `inputs`, builds the ACTIVE line set via A1's
 * `buildPersonnelLineSet` / `buildSiteOpsLineSet` (a catalog line absent from the
 * section lines becomes a `removeCodes` entry — D2-ready), then calls
 * `computePersonnelCosts` / `computeSiteOperations`. Per-line math is untouched.
 *
 * This is the bridge the dual-read assertion uses (A3) and that B2/B3 grids will
 * drive their live totals through. For an app-born project synthesized by A3 the
 * full catalog is present and no one-offs exist, so the active set === the catalog
 * defaults and the result is byte-identical to today's blob-driven calc.
 *
 * One-off (non-catalog) lines are the D1 escape hatch — deferred to Phase B5,
 * which extends synthesis (storing a one-off's unit/section in `inputs`) and this
 * bridge together. A3 emits none, so the dormant branch is left unbuilt.
 */

import {
  computePersonnelCosts,
  computeSiteOperations,
  buildPersonnelLineSet,
  buildSiteOpsLineSet,
  type PersonnelCalcResult,
  type SiteOpsCalcResult,
  type RateLookup,
} from "@/lib/calculations";
import {
  STAFF_ROLE_DEFAULTS,
  OPERATIONAL_EXPENSE_DEFAULTS,
  EQUIPMENT_DEFAULTS,
  GC_MANUAL_DEFAULTS,
  SITE_OPS_DYNAMIC_DEFAULTS,
  SITE_OPS_MANUAL_DEFAULTS,
} from "@/lib/constants";
import type { EstimateSectionLine } from "@/types/db";
import { ENTRY_KIND, isManualEntryKind } from "./entryKinds";

// ---------------------------------------------------------------------------
// Catalog lookups (code → config) and the full catalog code sets
// ---------------------------------------------------------------------------

const STAFF_BY_CODE = new Map(STAFF_ROLE_DEFAULTS.map((r) => [r.code, r]));
const EQUIP_BY_CODE = new Map(EQUIPMENT_DEFAULTS.map((e) => [e.code, e]));
const GC_MANUAL_BY_CODE = new Map(GC_MANUAL_DEFAULTS.map((m) => [m.code, m]));
const SITEOPS_MANUAL_BY_CODE = new Map(SITE_OPS_MANUAL_DEFAULTS.map((m) => [m.code, m]));

const GC_CATALOG_CODES: ReadonlySet<string> = new Set([
  ...STAFF_ROLE_DEFAULTS.map((r) => r.code),
  ...OPERATIONAL_EXPENSE_DEFAULTS.map((o) => o.code),
  ...EQUIPMENT_DEFAULTS.map((e) => e.code),
  ...GC_MANUAL_DEFAULTS.map((m) => m.code),
]);
const SITEOPS_CATALOG_CODES: ReadonlySet<string> = new Set([
  ...SITE_OPS_DYNAMIC_DEFAULTS.map((d) => d.code),
  ...SITE_OPS_MANUAL_DEFAULTS.map((m) => m.code),
]);

/** Coerce a JSONB `inputs` value to a finite number (synthesis writes numbers; this guards reads). */
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The project-level (non-line) calc inputs the engine still needs. */
export interface SectionCalcContext {
  durationMonths: number;
  squareFootage: number;
  /** Injected company-default rate resolver (defaults to the engine's identity fallback). */
  rateLookup?: RateLookup;
}

// ---------------------------------------------------------------------------
// Step 2 (GC Personnel)
// ---------------------------------------------------------------------------

/**
 * Drives `computePersonnelCosts` off the GC section lines. Reconstructs
 * utilizations / rate overrides / equipment / manual entries from each line's
 * `inputs`, and the active line set from which catalog codes are present.
 */
export function computePersonnelFromSectionLines(
  sectionLines: readonly EstimateSectionLine[],
  ctx: SectionCalcContext
): PersonnelCalcResult {
  const utilizations: Record<string, number> = {};
  const rateOverrides: Record<string, number> = {};
  const equipment = { dumpsters: 0, toilets: 0, electric: 0 };
  const manualEntries: Record<string, number> = {};
  const presentCodes = new Set<string>();

  for (const line of sectionLines) {
    if (line.section !== "gc") continue;
    presentCodes.add(line.code);

    if (line.entryKind === ENTRY_KIND.StaffRole) {
      const role = STAFF_BY_CODE.get(line.code);
      if (!role) continue;
      utilizations[role.key] = num(line.inputs.utilization);
      // A rate override is present only when the line carries one (synthesis guard `>= 0`).
      if (typeof line.inputs.rate === "number") rateOverrides[role.key] = line.inputs.rate;
    } else if (line.entryKind === ENTRY_KIND.Equipment) {
      const eq = EQUIP_BY_CODE.get(line.code);
      if (!eq) continue;
      equipment[eq.key] = num(line.inputs.amount);
    } else if (isManualEntryKind(line.entryKind)) {
      const cfg = GC_MANUAL_BY_CODE.get(line.code);
      if (cfg) manualEntries[cfg.key] = num(line.inputs.value);
      // else: a non-catalog one-off (B5) — deferred.
    }
    // operationalExpense: no per-line estimator input.
  }

  const removeCodes = [...GC_CATALOG_CODES].filter((c) => !presentCodes.has(c));
  const lines = buildPersonnelLineSet({ removeCodes });

  return computePersonnelCosts(
    ctx.durationMonths,
    ctx.squareFootage,
    utilizations,
    equipment,
    manualEntries,
    rateOverrides,
    ctx.rateLookup,
    lines
  );
}

// ---------------------------------------------------------------------------
// Step 3 (Site Operations)
// ---------------------------------------------------------------------------

/**
 * Drives `computeSiteOperations` off the Site Ops section lines. Reconstructs
 * quantities / typed rates and the active line set from which catalog codes are
 * present.
 */
export function computeSiteOpsFromSectionLines(
  sectionLines: readonly EstimateSectionLine[],
  ctx: SectionCalcContext
): SiteOpsCalcResult {
  const quantities: Record<string, number> = {};
  const rates: Record<string, number> = {};
  const presentCodes = new Set<string>();

  for (const line of sectionLines) {
    if (line.section !== "site_ops") continue;
    presentCodes.add(line.code);

    if (line.entryKind === ENTRY_KIND.Dynamic) continue; // no per-line input
    if (!isManualEntryKind(line.entryKind)) continue;

    const cfg = SITEOPS_MANUAL_BY_CODE.get(line.code);
    if (!cfg) continue; // a non-catalog one-off (B5) — deferred.
    quantities[cfg.key] = num(line.inputs.value);
    if (cfg.entry === "qtyRate" && typeof line.inputs.rate === "number") {
      rates[cfg.key] = line.inputs.rate;
    }
  }

  const removeCodes = [...SITEOPS_CATALOG_CODES].filter((c) => !presentCodes.has(c));
  const lines = buildSiteOpsLineSet({ removeCodes });

  return computeSiteOperations(
    ctx.durationMonths,
    ctx.squareFootage,
    quantities,
    rates,
    ctx.rateLookup,
    lines
  );
}
