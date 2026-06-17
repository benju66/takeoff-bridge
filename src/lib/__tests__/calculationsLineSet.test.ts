import { describe, it, expect } from "vitest";
import {
  computePersonnelCosts,
  computeSiteOperations,
  buildPersonnelLineSet,
  buildSiteOpsLineSet,
  DEFAULT_PERSONNEL_LINES,
  DEFAULT_SITE_OPS_LINES,
} from "../calculations";
import type {
  PersonnelLineSet,
  SiteOpsLineSet,
  OneOffGcLine,
  OneOffSiteOpsLine,
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
// gc-siteops Phase A1 — parameterized active line set.
//
// The two calc engines now accept the active line set as a trailing argument
// that DEFAULTS to the full catalog constants (mirrors the RateLookup pattern).
// These tests pin the three invariants the phase exits on:
//   1. DEFAULT === LEGACY — a default-argument call is byte-identical to passing
//      the explicit default set / the full builder; the default set IS the
//      catalog constants (so every existing total and both goldens stay put).
//   2. REMOVAL (D2) — a filtered subset computes over fewer lines; per-line math
//      is untouched, the grand total drops by exactly the removed lines.
//   3. ONE-OFF (D1) — a user-authored generic MANUAL line appended to the set
//      runs through the SAME manual-line evaluator (no new math), drawing its
//      value from the existing entries/quantities map by key. Structured lines
//      are removable but not mintable (the additive path is manual only).
// ---------------------------------------------------------------------------

// Representative non-trivial inputs exercising every line kind (mirrors the
// rate-lookup invariant suite so "default === legacy" is meaningful, not empty).
const gc = (lines?: PersonnelLineSet) =>
  computePersonnelCosts(
    10,
    30000,
    { ex: 100, su: 50, pm: 25, srSu: 40 },
    { dumpsters: 1000, toilets: 500, electric: 750 },
    { tempOfficeSetup: 2, projectSigns: 3, legalFees: 1, designArch: 5000 },
    undefined, // rateOverrides
    undefined, // rateLookup → identity default
    lines,     // undefined → DEFAULT_PERSONNEL_LINES
  );

const so = (lines?: SiteOpsLineSet) =>
  computeSiteOperations(
    10,
    30000,
    { payrollCleaning: 100, hiredCleaning: 50, demolition: 1000, knox: 2, equipmentRental: 3, soilBorings: 5, abatement: 7500 },
    { soilBorings: 250 },
    undefined, // rateLookup → identity default
    lines,     // undefined → DEFAULT_SITE_OPS_LINES
  );

describe("Phase A1 — default line set === legacy catalog", () => {
  it("DEFAULT_PERSONNEL_LINES holds the exact catalog constant arrays", () => {
    expect(DEFAULT_PERSONNEL_LINES.staffRoles).toBe(STAFF_ROLE_DEFAULTS);
    expect(DEFAULT_PERSONNEL_LINES.operationalExpenses).toBe(OPERATIONAL_EXPENSE_DEFAULTS);
    expect(DEFAULT_PERSONNEL_LINES.equipment).toBe(EQUIPMENT_DEFAULTS);
    expect(DEFAULT_PERSONNEL_LINES.manualLines).toBe(GC_MANUAL_DEFAULTS);
  });

  it("DEFAULT_SITE_OPS_LINES holds the exact catalog constant arrays", () => {
    expect(DEFAULT_SITE_OPS_LINES.dynamicLines).toBe(SITE_OPS_DYNAMIC_DEFAULTS);
    expect(DEFAULT_SITE_OPS_LINES.manualLines).toBe(SITE_OPS_MANUAL_DEFAULTS);
  });

  it("computePersonnelCosts default-arg == explicit default set == full builder", () => {
    const fromDefault = gc();
    expect(gc(DEFAULT_PERSONNEL_LINES)).toEqual(fromDefault);
    expect(gc(buildPersonnelLineSet())).toEqual(fromDefault);
  });

  it("computeSiteOperations default-arg == explicit default set == full builder", () => {
    const fromDefault = so();
    expect(so(DEFAULT_SITE_OPS_LINES)).toEqual(fromDefault);
    expect(so(buildSiteOpsLineSet())).toEqual(fromDefault);
  });

  it("an empty builder reproduces every catalog line (no drop, no add)", () => {
    const p = buildPersonnelLineSet();
    expect(p.staffRoles.length).toBe(STAFF_ROLE_DEFAULTS.length);
    expect(p.operationalExpenses.length).toBe(OPERATIONAL_EXPENSE_DEFAULTS.length);
    expect(p.equipment.length).toBe(EQUIPMENT_DEFAULTS.length);
    expect(p.manualLines.length).toBe(GC_MANUAL_DEFAULTS.length);
    const s = buildSiteOpsLineSet();
    expect(s.dynamicLines.length).toBe(SITE_OPS_DYNAMIC_DEFAULTS.length);
    expect(s.manualLines.length).toBe(SITE_OPS_MANUAL_DEFAULTS.length);
  });
});

describe("Phase A1 — removal subset (D2)", () => {
  it("GC: removing a staff line drops it and its total only", () => {
    const full = gc();
    const subset = gc(buildPersonnelLineSet({ removeCodes: ["01-0310.001"] })); // Project Executive
    expect(subset.staffLines.find((l) => l.code === "01-0310.001")).toBeUndefined();
    expect(full.staffLines.length - subset.staffLines.length).toBe(1);

    const exTotal = full.staffLines.find((l) => l.code === "01-0310.001")!.total;
    expect(exTotal).toBeGreaterThan(0);
    expect(full.grandTotal - subset.grandTotal).toBeCloseTo(exTotal);

    // A surviving staff line is unchanged (per-line math untouched).
    const suFull = full.staffLines.find((l) => l.code === "01-0420.001")!;
    const suSub = subset.staffLines.find((l) => l.code === "01-0420.001")!;
    expect(suSub.total).toBe(suFull.total);
  });

  it("GC: removal spans operational + manual kinds in one set", () => {
    const full = gc();
    const subset = gc(buildPersonnelLineSet({ removeCodes: ["01-1000.001", "01-5110.001"] }));
    expect(subset.operationalLines.find((l) => l.code === "01-1000.001")).toBeUndefined();
    expect(subset.manualLines.find((l) => l.code === "01-5110.001")).toBeUndefined();

    const removedTotal =
      full.operationalLines.find((l) => l.code === "01-1000.001")!.total +
      full.manualLines.find((l) => l.code === "01-5110.001")!.total;
    expect(full.grandTotal - subset.grandTotal).toBeCloseTo(removedTotal);
  });

  it("Site Ops: removing a dynamic + a manual line drops both totals", () => {
    const full = so();
    const subset = so(buildSiteOpsLineSet({ removeCodes: ["02-9015.001", "02-3200.001"] }));
    expect(subset.dynamicLines.find((l) => l.code === "02-9015.001")).toBeUndefined();
    expect(subset.manualLines.find((l) => l.code === "02-3200.001")).toBeUndefined();

    const safetyTotal = full.dynamicLines.find((l) => l.code === "02-9015.001")!.total; // 10 × 500
    const boringsTotal = full.manualLines.find((l) => l.code === "02-3200.001")!.total; // 5 × 250
    expect(safetyTotal).toBe(5000);
    expect(boringsTotal).toBe(1250);
    expect(full.grandTotal - subset.grandTotal).toBeCloseTo(safetyTotal + boringsTotal);
  });
});

describe("Phase A1 — one-off manual addition (D1) via the existing evaluator", () => {
  it("GC lump-sum one-off totals the typed dollar amount, routed as a manual line", () => {
    const oneOff: OneOffGcLine = {
      key: "oneOffHauling", code: "01-9999.001", procoreCode: "1-19999.000",
      costType: "M", label: "One-off Debris Hauling", unit: "ls",
      entry: "lumpSum", rate: null, section: "gcManual",
    };
    const lines = buildPersonnelLineSet({ addManual: [oneOff] });
    const result = computePersonnelCosts(
      0, 0, {}, { dumpsters: 0, toilets: 0, electric: 0 },
      { oneOffHauling: 4200 }, undefined, undefined, lines,
    );
    const line = result.manualLines.find((l) => l.code === "01-9999.001");
    expect(line).toBeDefined();
    expect(line!.total).toBe(4200);
    // Routed as a generic MANUAL line — never synthesized as a structured line.
    expect(result.staffLines.find((l) => l.code === "01-9999.001")).toBeUndefined();
    expect(result.operationalLines.find((l) => l.code === "01-9999.001")).toBeUndefined();
    // Catalog manual lines remain.
    expect(result.manualLines.find((l) => l.code === "01-0001.001")).toBeDefined();
    expect(result.grandTotal).toBe(4200);
  });

  it("GC qty one-off computes typed qty × its rate (manual evaluator)", () => {
    const oneOff: OneOffGcLine = {
      key: "oneOffWatchman", code: "01-9998.001", procoreCode: "1-19998.000",
      costType: "L", label: "One-off Watchman", unit: "ea",
      entry: "qty", rate: 80, section: "gcManual",
    };
    const lines = buildPersonnelLineSet({ addManual: [oneOff] });
    const result = computePersonnelCosts(
      0, 0, {}, { dumpsters: 0, toilets: 0, electric: 0 },
      { oneOffWatchman: 3 }, undefined, undefined, lines,
    );
    const line = result.manualLines.find((l) => l.code === "01-9998.001")!;
    expect(line.qty).toBe(3);
    expect(line.rate).toBe(80);
    expect(line.total).toBe(240);
  });

  it("Site Ops qtyRate one-off computes typed qty × typed rate; absent value → $0", () => {
    const oneOff: OneOffSiteOpsLine = {
      key: "oneOffDewater", code: "02-9999.001", procoreCode: "2-29999.000",
      costType: "M", label: "One-off Dewatering", unit: "ls",
      entry: "qtyRate", rate: null, section: "siteOperations",
    };
    const lines = buildSiteOpsLineSet({ addManual: [oneOff] });

    const result = computeSiteOperations(
      0, 0, { oneOffDewater: 4 }, { oneOffDewater: 1200 }, undefined, lines,
    );
    const line = result.manualLines.find((l) => l.code === "02-9999.001")!;
    expect(line.qty).toBe(4);
    expect(line.rate).toBe(1200);
    expect(line.total).toBe(4800);

    // With no entry value the appended line is present but contributes nothing.
    const idle = computeSiteOperations(0, 0, {}, {}, undefined, lines);
    expect(idle.manualLines.find((l) => l.code === "02-9999.001")!.total).toBe(0);
    expect(idle.grandTotal).toBe(0);
  });

  it("the additive path touches the MANUAL array only (structured stay catalog-sized)", () => {
    const oneOff: OneOffGcLine = {
      key: "oneOffHauling", code: "01-9999.001", procoreCode: "1-19999.000",
      costType: "M", label: "One-off Debris Hauling", unit: "ls",
      entry: "lumpSum", rate: null, section: "gcManual",
    };
    const lines = buildPersonnelLineSet({ addManual: [oneOff] });
    expect(lines.staffRoles.length).toBe(STAFF_ROLE_DEFAULTS.length);
    expect(lines.operationalExpenses.length).toBe(OPERATIONAL_EXPENSE_DEFAULTS.length);
    expect(lines.equipment.length).toBe(EQUIPMENT_DEFAULTS.length);
    expect(lines.manualLines.length).toBe(GC_MANUAL_DEFAULTS.length + 1);
  });
});
