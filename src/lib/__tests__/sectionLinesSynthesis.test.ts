import { describe, it, expect } from "vitest";
import {
  synthesizePersonnelSectionLines,
  synthesizeSiteOpsSectionLines,
  synthesizeSectionLines,
} from "../sectionLines/synthesize";
import {
  computePersonnelFromSectionLines,
  computeSiteOpsFromSectionLines,
  type SectionCalcContext,
} from "../sectionLines/project";
import {
  ENTRY_KIND,
  ENTRY_KINDS,
  isManualEntryKind,
  isStructuredEntryKind,
} from "../sectionLines/entryKinds";
import {
  computePersonnelCosts,
  computeSiteOperations,
  type RateLookup,
} from "../calculations";
import {
  STAFF_ROLE_DEFAULTS,
  OPERATIONAL_EXPENSE_DEFAULTS,
  EQUIPMENT_DEFAULTS,
  GC_MANUAL_DEFAULTS,
  SITE_OPS_DYNAMIC_DEFAULTS,
  SITE_OPS_MANUAL_DEFAULTS,
} from "../constants";

// ---------------------------------------------------------------------------
// GC/Site-Ops Addressability Phase A3 — synthesis + dual-read round-trip.
//
// The hard exit gate: feeding the calc engine off SYNTHESIZED section lines
// (blobs → EstimateSectionLine[] → projected input maps → A1 engine) must be
// BYTE-IDENTICAL to today's blob-driven calc. We build the engine input maps as
// ground truth, compute the legacy result, serialize the maps into the exact
// legacy blob shape, then synthesize + project and assert deep equality.
// ---------------------------------------------------------------------------

// --- Blob serializers: mirror the Step 2/3 hooks' persistence contract -------
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const utilKeyFor = (k: string) => "util" + cap(k);
const rateOverrideKeyFor = (k: string) => "rate" + cap(k);
const LEGACY_QTY_KEYS: Record<string, string> = {
  knox: "qtyKnox",
  payrollCleaning: "qtyPayrollCleaning",
  hiredCleaning: "qtyHiredCleaning",
  soilBorings: "qtySoilBorings",
};
const LEGACY_RATE_KEYS: Record<string, string> = { soilBorings: "rateSoilBorings" };

interface GcInputs {
  utilizations: Record<string, number>;
  equipment: { dumpsters: number; toilets: number; electric: number };
  manualEntries: Record<string, number>;
  rateOverrides: Record<string, number>;
}
interface SoInputs {
  quantities: Record<string, number>;
  rates: Record<string, number>;
}

function gcBlobs(i: GcInputs) {
  const gcUtilization: Record<string, number> = {};
  for (const [k, v] of Object.entries(i.utilizations)) gcUtilization[utilKeyFor(k)] = v;
  for (const [k, v] of Object.entries(i.rateOverrides)) gcUtilization[rateOverrideKeyFor(k)] = v;
  const gcEquipmentOverrides: Record<string, number> = {
    eqDumpsters: i.equipment.dumpsters,
    eqToilets: i.equipment.toilets,
    eqElectric: i.equipment.electric,
    ...i.manualEntries,
  };
  return { gcUtilization, gcEquipmentOverrides };
}
function soBlobs(i: SoInputs) {
  const siteOpsQuantities: Record<string, number> = {};
  for (const [k, v] of Object.entries(i.quantities)) siteOpsQuantities[LEGACY_QTY_KEYS[k] ?? k] = v;
  const siteOpsRates: Record<string, number> = {};
  for (const [k, v] of Object.entries(i.rates)) siteOpsRates[LEGACY_RATE_KEYS[k] ?? k] = v;
  return { siteOpsQuantities, siteOpsRates };
}

const CTX: SectionCalcContext = { durationMonths: 10, squareFootage: 30000 };

function legacyGc(i: GcInputs, rateLookup?: RateLookup) {
  return computePersonnelCosts(
    CTX.durationMonths,
    CTX.squareFootage,
    i.utilizations,
    i.equipment,
    i.manualEntries,
    i.rateOverrides,
    rateLookup
  );
}
function viaLinesGc(i: GcInputs, rateLookup?: RateLookup) {
  const { gcUtilization, gcEquipmentOverrides } = gcBlobs(i);
  return computePersonnelFromSectionLines(
    synthesizePersonnelSectionLines(gcUtilization, gcEquipmentOverrides),
    { ...CTX, rateLookup }
  );
}
function legacySo(i: SoInputs, rateLookup?: RateLookup) {
  return computeSiteOperations(CTX.durationMonths, CTX.squareFootage, i.quantities, i.rates, rateLookup);
}
function viaLinesSo(i: SoInputs, rateLookup?: RateLookup) {
  const { siteOpsQuantities, siteOpsRates } = soBlobs(i);
  return computeSiteOpsFromSectionLines(
    synthesizeSiteOpsSectionLines(siteOpsQuantities, siteOpsRates),
    { ...CTX, rateLookup }
  );
}

// --- Fixtures ----------------------------------------------------------------
const GC_ZERO: GcInputs = {
  utilizations: {},
  equipment: { dumpsters: 0, toilets: 0, electric: 0 },
  manualEntries: {},
  rateOverrides: {},
};
const GC_REAL: GcInputs = {
  utilizations: { ex: 100, su: 50, pm: 25, srSu: 40, pa: 80 },
  equipment: { dumpsters: 1000, toilets: 500, electric: 750 },
  manualEntries: { tempOfficeSetup: 2, projectSigns: 3, legalFees: 1, designArch: 5000, procoreFee: 4200 },
  rateOverrides: {},
};
const GC_RATE_OVERRIDES: GcInputs = {
  utilizations: { ex: 100, su: 60, pm: 30 },
  equipment: { dumpsters: 0, toilets: 0, electric: 0 },
  manualEntries: {},
  // Includes a LEGIT ZERO override (su rate = 0): the engine must honor 0, not fall back to the default rate.
  rateOverrides: { ex: 200, su: 0, pm: 99 },
};

const SO_ZERO: SoInputs = { quantities: {}, rates: {} };
// Exercises the LEGACY qty… keys (knox/payrollCleaning/hiredCleaning/soilBorings) + qtyRate.
const SO_REAL: SoInputs = {
  quantities: {
    payrollCleaning: 100,
    hiredCleaning: 50,
    demolition: 1000,
    knox: 4,
    equipmentRental: 3,
    soilBorings: 5,
    abatement: 7500,
    finalCleaning: 1,
  },
  rates: { soilBorings: 250 },
};

describe("Phase A3 — GC dual-read is byte-identical to the blob path", () => {
  it.each([
    ["zeroed inputs", GC_ZERO],
    ["realistic inputs", GC_REAL],
    ["rate overrides incl. a legit 0", GC_RATE_OVERRIDES],
  ])("%s", (_label, input) => {
    expect(viaLinesGc(input)).toEqual(legacyGc(input));
  });

  it("threads an injected rateLookup identically through both paths", () => {
    const lookup: RateLookup = (code, fb) => (code === "01-0310.001" ? 999 : fb);
    expect(viaLinesGc(GC_REAL, lookup)).toEqual(legacyGc(GC_REAL, lookup));
  });

  it("honors a legit 0 rate override (su total is 0, not the default rate)", () => {
    const result = viaLinesGc(GC_RATE_OVERRIDES);
    const su = result.staffLines.find((l) => l.code === "01-0420.001")!;
    expect(su.rate).toBe(0);
    expect(su.total).toBe(0);
  });
});

describe("Phase A3 — Site Ops dual-read is byte-identical to the blob path", () => {
  it.each([
    ["zeroed inputs", SO_ZERO],
    ["realistic inputs (legacy qty… keys + qtyRate)", SO_REAL],
  ])("%s", (_label, input) => {
    expect(viaLinesSo(input)).toEqual(legacySo(input));
  });

  it("threads an injected rateLookup identically through both paths", () => {
    const lookup: RateLookup = (code, fb) => (code === "02-9015.001" ? 700 : fb);
    expect(viaLinesSo(SO_REAL, lookup)).toEqual(legacySo(SO_REAL, lookup));
  });

  it("remaps the legacy qtyKnox key (knox qty 4 → Knox Box line total)", () => {
    const { siteOpsQuantities } = soBlobs(SO_REAL);
    expect(siteOpsQuantities.qtyKnox).toBe(4); // serialized under the legacy key
    const result = viaLinesSo(SO_REAL);
    const knox = result.manualLines.find((l) => l.code === "02-9307.001")!;
    expect(knox.qty).toBe(4);
    expect(knox.total).toBe(4 * 650); // KNOX_BOX_UNIT_COST
  });
});

describe("Phase A3 — combined synthesis", () => {
  it("synthesizeSectionLines emits GC lines first, then Site Ops", () => {
    const { gcUtilization, gcEquipmentOverrides } = gcBlobs(GC_REAL);
    const { siteOpsQuantities, siteOpsRates } = soBlobs(SO_REAL);
    const all = synthesizeSectionLines({ gcUtilization, gcEquipmentOverrides, siteOpsQuantities, siteOpsRates }, "proj-1");
    const gcCount = STAFF_ROLE_DEFAULTS.length + OPERATIONAL_EXPENSE_DEFAULTS.length + EQUIPMENT_DEFAULTS.length + GC_MANUAL_DEFAULTS.length;
    expect(all.slice(0, gcCount).every((l) => l.section === "gc")).toBe(true);
    expect(all.slice(gcCount).every((l) => l.section === "site_ops")).toBe(true);
    expect(all.every((l) => l.projectId === "proj-1")).toBe(true);
  });
});

describe("Phase A3 — structural completeness (no straggler catalog lines)", () => {
  const gcLines = synthesizePersonnelSectionLines(gcBlobs(GC_REAL).gcUtilization, gcBlobs(GC_REAL).gcEquipmentOverrides);
  const soLines = synthesizeSiteOpsSectionLines(soBlobs(SO_REAL).siteOpsQuantities, soBlobs(SO_REAL).siteOpsRates);

  it("emits exactly one line per catalog entry, in catalog order", () => {
    expect(gcLines).toHaveLength(
      STAFF_ROLE_DEFAULTS.length + OPERATIONAL_EXPENSE_DEFAULTS.length + EQUIPMENT_DEFAULTS.length + GC_MANUAL_DEFAULTS.length
    );
    expect(soLines).toHaveLength(SITE_OPS_DYNAMIC_DEFAULTS.length + SITE_OPS_MANUAL_DEFAULTS.length);
  });

  it("every catalog code appears exactly once across the synthesized lines", () => {
    const gcCodes = gcLines.map((l) => l.code).sort();
    const expectedGc = [
      ...STAFF_ROLE_DEFAULTS.map((r) => r.code),
      ...OPERATIONAL_EXPENSE_DEFAULTS.map((o) => o.code),
      ...EQUIPMENT_DEFAULTS.map((e) => e.code),
      ...GC_MANUAL_DEFAULTS.map((m) => m.code),
    ].sort();
    expect(gcCodes).toEqual(expectedGc);
  });

  it("every line's id is unique and stable, and entryKind is a known kind", () => {
    const all = [...gcLines, ...soLines];
    const ids = all.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length); // unique
    for (const l of all) expect(ENTRY_KINDS).toContain(l.entryKind);
  });

  it("structured lines carry a structured kind; manual lines carry a manual kind", () => {
    const staff = gcLines.filter((l) => l.id.startsWith("gc:staff:"));
    expect(staff.every((l) => l.entryKind === ENTRY_KIND.StaffRole)).toBe(true);
    expect(staff.every((l) => isStructuredEntryKind(l.entryKind))).toBe(true);
    const gcManual = gcLines.filter((l) => l.id.startsWith("gc:manual:"));
    expect(gcManual.every((l) => isManualEntryKind(l.entryKind))).toBe(true);
    const soDynamic = soLines.filter((l) => l.id.startsWith("siteops:dynamic:"));
    expect(soDynamic.every((l) => l.entryKind === ENTRY_KIND.Dynamic)).toBe(true);
  });

  it("never synthesizes a total (derived, never frozen — ID-1)", () => {
    for (const l of [...gcLines, ...soLines]) {
      expect("total" in l).toBe(false);
      expect("total" in l.inputs).toBe(false);
    }
  });
});

describe("Phase A3 — removal generality (D2-ready bridge)", () => {
  it("dropping a GC section line removes exactly that line's total", () => {
    const lines = synthesizePersonnelSectionLines(gcBlobs(GC_REAL).gcUtilization, gcBlobs(GC_REAL).gcEquipmentOverrides);
    const full = computePersonnelFromSectionLines(lines, CTX);
    const exId = "gc:staff:ex";
    const exTotal = full.staffLines.find((l) => l.code === "01-0310.001")!.total;
    expect(exTotal).toBeGreaterThan(0);

    const subset = computePersonnelFromSectionLines(
      lines.filter((l) => l.id !== exId),
      CTX
    );
    expect(subset.staffLines.find((l) => l.code === "01-0310.001")).toBeUndefined();
    expect(full.grandTotal - subset.grandTotal).toBeCloseTo(exTotal);
  });

  it("dropping a Site Ops section line removes exactly that line's total", () => {
    const lines = synthesizeSiteOpsSectionLines(soBlobs(SO_REAL).siteOpsQuantities, soBlobs(SO_REAL).siteOpsRates);
    const full = computeSiteOpsFromSectionLines(lines, CTX);
    const safetyTotal = full.dynamicLines.find((l) => l.code === "02-9015.001")!.total;
    expect(safetyTotal).toBe(5000); // 10 mo × $500

    const subset = computeSiteOpsFromSectionLines(
      lines.filter((l) => l.id !== "siteops:dynamic:02-9015.001"),
      CTX
    );
    expect(subset.dynamicLines.find((l) => l.code === "02-9015.001")).toBeUndefined();
    expect(full.grandTotal - subset.grandTotal).toBeCloseTo(safetyTotal);
  });
});
