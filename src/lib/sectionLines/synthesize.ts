/**
 * GC/Site-Ops Addressability — Phase A3 synthesis (PURE).
 *
 * Turns the four legacy JSONB blobs into in-memory `EstimateSectionLine[]`:
 *   - GC (Step 2):       `gc_utilization` + `gc_equipment_overrides`
 *   - Site Ops (Step 3): `site_ops_quantities` + `site_ops_rates`
 *
 * Each catalog line (the A1 constants) becomes one addressable section line
 * carrying its identity (code / procoreCode / costType / label) + the project's
 * saved estimator inputs in `inputs`. There is NO total — totals stay derived by
 * the calc engine ("derived, never frozen", plan ID-1).
 *
 * The blob-key remapping mirrors EXACTLY what the Step 2/3 hooks already do on
 * load (`usePersonnelCalculations` / `useInfrastructureCalculations`), including
 * the legacy `qtyKnox`/`rateSoilBorings`-style keys and the `util*`/`rate*`/`eq*`
 * capitalized GC keys. Cross-references to those hooks are noted inline; the
 * round-trip is proven byte-identical in `sectionLinesSynthesis.test.ts`.
 *
 * APP-BORN PROJECTS ONLY. Imported projects synthesize from the frozen
 * `imported_step23_lines` detail and stay non-derived — that is Phase A4.
 */

import {
  STAFF_ROLE_DEFAULTS,
  OPERATIONAL_EXPENSE_DEFAULTS,
  EQUIPMENT_DEFAULTS,
  GC_MANUAL_DEFAULTS,
  SITE_OPS_DYNAMIC_DEFAULTS,
  SITE_OPS_MANUAL_DEFAULTS,
} from "@/lib/constants";
import type { EstimateSectionLine, SectionDiscriminator } from "@/types/db";
import { ENTRY_KIND, type EntryKind } from "./entryKinds";
import {
  gcStaffLineId,
  gcOperationalLineId,
  gcEquipmentLineId,
  gcManualLineId,
  siteOpsDynamicLineId,
  siteOpsManualLineId,
} from "./ids";

// ---------------------------------------------------------------------------
// Blob-key helpers (mirror the Step 2/3 hooks' persistence contract)
// ---------------------------------------------------------------------------

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** gc_utilization key for a staff role's utilization (e.g. "ex" → "utilEx"). */
const utilKeyFor = (roleKey: string) => "util" + cap(roleKey);
/** gc_utilization key for a staff rate override (e.g. "srSu" → "rateSrSu"). Matches usePersonnelCalculations.rateKeyFor. */
const rateOverrideKeyFor = (roleKey: string) => "rate" + cap(roleKey);
/** gc_equipment_overrides key for a lump-sum equipment line (e.g. "dumpsters" → "eqDumpsters"). */
const eqKeyFor = (eqKey: string) => "eq" + cap(eqKey);

/**
 * Legacy site_ops_quantities keys: the original 4 manual lines persist under
 * `qty…`-prefixed JSONB keys (mirrors useInfrastructureCalculations.LEGACY_QTY_KEYS).
 * Phase 4+ lines persist under their raw config key.
 */
const LEGACY_QTY_KEYS: Record<string, string> = {
  knox: "qtyKnox",
  payrollCleaning: "qtyPayrollCleaning",
  hiredCleaning: "qtyHiredCleaning",
  soilBorings: "qtySoilBorings",
};
/** Legacy site_ops_rates keys (mirrors useInfrastructureCalculations.LEGACY_RATE_KEYS). */
const LEGACY_RATE_KEYS: Record<string, string> = {
  soilBorings: "rateSoilBorings",
};

/** Reads a site-ops quantity for a manual line, honoring its legacy `qty…` key. */
const readSiteOpsQty = (snapshot: Record<string, number>, key: string): number => {
  const blobKey = LEGACY_QTY_KEYS[key] ?? key;
  const v = snapshot[blobKey];
  return typeof v === "number" ? v : 0;
};
/** Reads a site-ops typed rate for a `qtyRate` line, honoring its legacy `rate…` key. */
const readSiteOpsRate = (snapshot: Record<string, number>, key: string): number => {
  const blobKey = LEGACY_RATE_KEYS[key] ?? key;
  const v = snapshot[blobKey];
  return typeof v === "number" ? v : 0;
};

// ---------------------------------------------------------------------------
// Section-line factory
// ---------------------------------------------------------------------------

interface LineIdentity {
  code: string;
  procoreCode: string;
  costType: string;
  label: string;
}

/**
 * Builds one synthesized section line. `projectId` and `updatedAt` are carried
 * for the in-memory shape only — `saveSectionLines` sets `project_id` from its
 * own argument and the DB stamps `updated_at`, so both are inert on write.
 * `sortOrder` is informational here; the gateway re-stamps it from array index.
 */
function makeLine(
  projectId: string,
  section: SectionDiscriminator,
  id: string,
  identity: LineIdentity,
  entryKind: EntryKind,
  inputs: Record<string, number>,
  sortOrder: number
): EstimateSectionLine {
  return {
    id,
    projectId,
    section,
    code: identity.code,
    procoreCode: identity.procoreCode,
    costType: identity.costType,
    label: identity.label,
    entryKind,
    inputs,
    sortOrder,
    source: "template", // app-born catalog seed
    updatedAt: "",
  };
}

// ---------------------------------------------------------------------------
// Step 2 (GC Personnel) synthesis
// ---------------------------------------------------------------------------

/**
 * Synthesizes the GC (Step 2) section lines from the two GC blobs. Emits one
 * line per catalog entry, in catalog order: staff → operational → equipment →
 * manual. A staff line carries `{ utilization }` (0–100, the blob scale) plus
 * `{ rate }` ONLY when the project saved a rate override (guard `>= 0`, mirroring
 * the hook). Operational/dynamic lines carry no estimator input. Equipment lines
 * carry `{ amount }`; manual lines carry `{ value }`.
 */
export function synthesizePersonnelSectionLines(
  gcUtilization: Record<string, number> = {},
  gcEquipmentOverrides: Record<string, number> = {},
  projectId = ""
): EstimateSectionLine[] {
  const lines: EstimateSectionLine[] = [];
  let order = 0;

  for (const role of STAFF_ROLE_DEFAULTS) {
    const inputs: Record<string, number> = {
      utilization: gcUtilization[utilKeyFor(role.key)] ?? 0,
    };
    // Rate override rides gc_utilization as a rate* key; present only when saved.
    // Guard `>= 0` mirrors the hook so a legit 0 override round-trips as an override.
    const rateOverride = gcUtilization[rateOverrideKeyFor(role.key)];
    if (typeof rateOverride === "number" && rateOverride >= 0) inputs.rate = rateOverride;
    lines.push(
      makeLine(projectId, "gc", gcStaffLineId(role.key), role, ENTRY_KIND.StaffRole, inputs, order++)
    );
  }

  for (const op of OPERATIONAL_EXPENSE_DEFAULTS) {
    // Auto-driver line — quantity derives from duration/sqft/Su utilization, no per-line input.
    lines.push(
      makeLine(
        projectId,
        "gc",
        gcOperationalLineId(op.code),
        { code: op.code, procoreCode: op.procoreCode, costType: op.costType, label: op.description },
        ENTRY_KIND.OperationalExpense,
        {},
        order++
      )
    );
  }

  for (const eq of EQUIPMENT_DEFAULTS) {
    lines.push(
      makeLine(
        projectId,
        "gc",
        gcEquipmentLineId(eq.key),
        { code: eq.code, procoreCode: eq.procoreCode, costType: eq.costType, label: eq.label },
        ENTRY_KIND.Equipment,
        { amount: gcEquipmentOverrides[eqKeyFor(eq.key)] ?? 0 },
        order++
      )
    );
  }

  for (const m of GC_MANUAL_DEFAULTS) {
    const v = gcEquipmentOverrides[m.key];
    lines.push(
      makeLine(
        projectId,
        "gc",
        gcManualLineId(m.key),
        { code: m.code, procoreCode: m.procoreCode, costType: m.costType, label: m.label },
        m.entry as EntryKind, // 'qty' | 'lumpSum' — a manual config's entry IS its entry kind
        { value: typeof v === "number" ? v : 0 },
        order++
      )
    );
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Step 3 (Site Operations) synthesis
// ---------------------------------------------------------------------------

/**
 * Synthesizes the Site Ops (Step 3) section lines from the two site-ops blobs.
 * Emits one line per catalog entry, in catalog order: dynamic → manual. Dynamic
 * lines carry no estimator input. Manual lines carry `{ value }` (the typed
 * quantity or lump-sum dollar amount), plus `{ rate }` for `qtyRate` lines. The
 * legacy `qtyKnox`/`rateSoilBorings`-style keys are remapped exactly as the hook
 * does on load.
 */
export function synthesizeSiteOpsSectionLines(
  siteOpsQuantities: Record<string, number> = {},
  siteOpsRates: Record<string, number> = {},
  projectId = ""
): EstimateSectionLine[] {
  const lines: EstimateSectionLine[] = [];
  let order = 0;

  for (const d of SITE_OPS_DYNAMIC_DEFAULTS) {
    lines.push(
      makeLine(
        projectId,
        "site_ops",
        siteOpsDynamicLineId(d.code),
        { code: d.code, procoreCode: d.procoreCode, costType: d.costType, label: d.label },
        ENTRY_KIND.Dynamic,
        {},
        order++
      )
    );
  }

  for (const m of SITE_OPS_MANUAL_DEFAULTS) {
    const inputs: Record<string, number> = { value: readSiteOpsQty(siteOpsQuantities, m.key) };
    if (m.entry === "qtyRate") inputs.rate = readSiteOpsRate(siteOpsRates, m.key);
    lines.push(
      makeLine(
        projectId,
        "site_ops",
        siteOpsManualLineId(m.key),
        { code: m.code, procoreCode: m.procoreCode, costType: m.costType, label: m.label },
        m.entry as EntryKind, // 'qty' | 'qtyRate' | 'lumpSum'
        inputs,
        order++
      )
    );
  }

  return lines;
}

/**
 * Convenience: the full app-born section-line set for a project (GC first, then
 * Site Ops), in the visual order the gateway persists (`sort_order` = index).
 */
export function synthesizeSectionLines(
  blobs: {
    gcUtilization?: Record<string, number>;
    gcEquipmentOverrides?: Record<string, number>;
    siteOpsQuantities?: Record<string, number>;
    siteOpsRates?: Record<string, number>;
  },
  projectId = ""
): EstimateSectionLine[] {
  return [
    ...synthesizePersonnelSectionLines(blobs.gcUtilization, blobs.gcEquipmentOverrides, projectId),
    ...synthesizeSiteOpsSectionLines(blobs.siteOpsQuantities, blobs.siteOpsRates, projectId),
  ];
}

// ---------------------------------------------------------------------------
// Inverse: section lines → legacy blob records (GC/Site-Ops Addressability
// Phase B6 — the section-lines table is now the SOLE store).
// ---------------------------------------------------------------------------

/** Coerce a JSONB `inputs` value to a finite number. */
const numIn = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * The EXACT inverse of `synthesize.ts`: rebuilds the four legacy blob records from
 * a project's persisted catalog section lines, so the Step 2/3 calc hooks can keep
 * consuming their blob-shaped initial state UNCHANGED after the blob columns were
 * retired (Phase B6). Iterates the catalog by stable line id (mirroring the forward
 * synthesizer), reading each PRESENT line's `inputs`:
 *   - a catalog line ABSENT from `lines` is a B4 removal → its blob key is omitted
 *     (the hook reads 0; the removal is tracked separately via removed-codes);
 *   - a NON-catalog line (a B5 one-off, `id` not in the catalog id set) is skipped
 *     here — one-offs are reconstructed separately by `deriveOneOffsFromLines`.
 *
 * Round-trip identity on the full catalog (`synthesizeSectionLines(sectionLinesToBlobs(
 * lines)) === lines`) is proven in `sectionLinesSynthesis.test.ts`; combined with the
 * forward dual-read proof this guarantees totals are unchanged to the cent. APP-BORN
 * ONLY (imported lines are frozen lumpSum constants, never round-tripped — D4).
 */
export function sectionLinesToBlobs(lines: readonly EstimateSectionLine[]): {
  gcUtilization: Record<string, number>;
  gcEquipmentOverrides: Record<string, number>;
  siteOpsQuantities: Record<string, number>;
  siteOpsRates: Record<string, number>;
} {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const gcUtilization: Record<string, number> = {};
  const gcEquipmentOverrides: Record<string, number> = {};
  const siteOpsQuantities: Record<string, number> = {};
  const siteOpsRates: Record<string, number> = {};

  for (const role of STAFF_ROLE_DEFAULTS) {
    const line = byId.get(gcStaffLineId(role.key));
    if (!line) continue;
    gcUtilization[utilKeyFor(role.key)] = numIn(line.inputs.utilization);
    // Rate override rode gc_utilization as a rate* key; present only when the line carries one.
    if (typeof line.inputs.rate === "number") gcUtilization[rateOverrideKeyFor(role.key)] = line.inputs.rate;
  }

  for (const eq of EQUIPMENT_DEFAULTS) {
    const line = byId.get(gcEquipmentLineId(eq.key));
    if (line) gcEquipmentOverrides[eqKeyFor(eq.key)] = numIn(line.inputs.amount);
  }

  for (const m of GC_MANUAL_DEFAULTS) {
    const line = byId.get(gcManualLineId(m.key));
    if (line) gcEquipmentOverrides[m.key] = numIn(line.inputs.value);
  }

  for (const m of SITE_OPS_MANUAL_DEFAULTS) {
    const line = byId.get(siteOpsManualLineId(m.key));
    if (!line) continue;
    siteOpsQuantities[LEGACY_QTY_KEYS[m.key] ?? m.key] = numIn(line.inputs.value);
    if (m.entry === "qtyRate" && typeof line.inputs.rate === "number") {
      siteOpsRates[LEGACY_RATE_KEYS[m.key] ?? m.key] = line.inputs.rate;
    }
  }

  return { gcUtilization, gcEquipmentOverrides, siteOpsQuantities, siteOpsRates };
}
