/**
 * gc-siteops Phase A+1 — audited per-line type-over on the auto-calc GC/Site-Ops lines (D3).
 *
 * An override is an INPUT layered over a line's COMPUTED total (override ?? computed): the
 * engine reports the override as the line's effective `total` but ALWAYS retains the computed
 * value in the result `overrides` trace (so the Trust Inspector shows both). The override is
 * keyed by the line's stable section-line id (`line:<id>:total`) — the SAME address Phase A5
 * projects the line to — so a line's override and a line's Linked-Values binding share one
 * address space. With no overrides the engines are byte-identical to before, so the three
 * export goldens still tie $0.00 (the inert default; this suite pins that).
 *
 * RECOGNIZED-KEYS GUARD (mirrors OVERRIDABLE_SUMMARY_FIELDS): the engine forms the override
 * key only from lines it is actively producing, so a stale override (a removed line, or a
 * foreign/summary key) is never looked up and cannot mis-apply.
 */

import { describe, it, expect } from "vitest";
import {
  computePersonnelCosts,
  computeSiteOperations,
  buildPersonnelLineSet,
} from "../calculations";
import type { PersonnelLineSet, SiteOpsLineSet } from "../calculations";
import { lineFieldNodeId } from "../bindings/compile";
import {
  gcStaffLineId,
  gcOperationalLineId,
  siteOpsDynamicLineId,
  siteOpsManualLineId,
  sectionLineTotalOverrideKey,
  sectionLineQtyOverrideKey,
  sectionLineFieldOverrideKey,
} from "../sectionLines/ids";
import { synthesizePersonnelSectionLines } from "../sectionLines/synthesize";
import { computePersonnelFromSectionLines } from "../sectionLines/project";
import { projectAppBornSectionLines } from "../bindings/registry";
import {
  STAFF_ROLE_DEFAULTS,
  OPERATIONAL_EXPENSE_DEFAULTS,
  SITE_OPS_DYNAMIC_DEFAULTS,
  SITE_OPS_MANUAL_DEFAULTS,
} from "../constants";
import type { EstimateOverrideMap } from "@/types";

// Representative non-trivial inputs (mirror the A1 line-set suite so an override is meaningful).
const DURATION = 10;
const SQFT = 30000;
const GC_UTILS = { ex: 100, su: 50, pm: 25, srSu: 40 };
const GC_EQUIP = { dumpsters: 1000, toilets: 500, electric: 750 };
const GC_MANUAL = { tempOfficeSetup: 2, projectSigns: 3, legalFees: 1, designArch: 5000 };
const SO_QTYS = { payrollCleaning: 100, hiredCleaning: 50, demolition: 1000, knox: 2, equipmentRental: 3 };
const SO_RATES = { soilBorings: 250 };

const gc = (lineOverrides?: EstimateOverrideMap, lines?: PersonnelLineSet) =>
  computePersonnelCosts(DURATION, SQFT, GC_UTILS, GC_EQUIP, GC_MANUAL, undefined, undefined, lines, lineOverrides);

const so = (lineOverrides?: EstimateOverrideMap, lines?: SiteOpsLineSet) =>
  computeSiteOperations(DURATION, SQFT, SO_QTYS, SO_RATES, undefined, lines, lineOverrides);

// Stable targets, looked up from the catalog so the test survives a code change.
const exRole = STAFF_ROLE_DEFAULTS.find((r) => r.key === "ex")!;
const pmRole = STAFF_ROLE_DEFAULTS.find((r) => r.key === "pm")!;
const exNodeKey = sectionLineTotalOverrideKey(gcStaffLineId(exRole.key)); // line:gc:staff:ex:total
const safetyDyn = SITE_OPS_DYNAMIC_DEFAULTS[0]; // 02-9015.001 Safety (duration driver → non-zero)
const safetyNodeKey = sectionLineTotalOverrideKey(siteOpsDynamicLineId(safetyDyn.code));
const knoxManual = SITE_OPS_MANUAL_DEFAULTS.find((m) => m.key === "knox")!;
const knoxNodeKey = sectionLineTotalOverrideKey(siteOpsManualLineId(knoxManual.key));

describe("Phase A+1 — the override key is the A5 binding address", () => {
  it("sectionLineTotalOverrideKey(id) === lineFieldNodeId(id, 'total')", () => {
    // The two MUST agree so a line's override and its binding share one address.
    expect(sectionLineTotalOverrideKey("gc:staff:ex")).toBe(lineFieldNodeId("gc:staff:ex", "total"));
    expect(sectionLineTotalOverrideKey(siteOpsManualLineId("knox"))).toBe(
      lineFieldNodeId("siteops:manual:knox", "total")
    );
    expect(exNodeKey).toBe("line:gc:staff:ex:total");
  });
});

describe("Phase A+1 — inert with no overrides (goldens tie $0.00)", () => {
  it("computePersonnelCosts: no map, empty map, and {} are byte-identical; no overrides key", () => {
    const base = gc();
    expect(base.overrides).toBeUndefined();
    expect(gc({})).toEqual(base);
    expect(computePersonnelCosts(DURATION, SQFT, GC_UTILS, GC_EQUIP, GC_MANUAL)).toEqual(base);
  });

  it("computeSiteOperations: no map, empty map, and {} are byte-identical; no overrides key", () => {
    const base = so();
    expect(base.overrides).toBeUndefined();
    expect(so({})).toEqual(base);
    expect(computeSiteOperations(DURATION, SQFT, SO_QTYS, SO_RATES)).toEqual(base);
  });
});

describe("Phase A+1 — a recorded line override layers over the computed total", () => {
  it("GC staff: overridden line uses the override; computed retained; un-overridden lines derive live", () => {
    const base = gc();
    const baseEx = base.staffLines.find((l) => l.code === exRole.code)!;
    const basePm = base.staffLines.find((l) => l.code === pmRole.code)!;
    expect(baseEx.total).toBeGreaterThan(0); // a meaningful override target

    const r = gc({ [exNodeKey]: 999_999 });

    const ex = r.staffLines.find((l) => l.code === exRole.code)!;
    expect(ex.total).toBe(999_999); // effective value is the override
    // qty / rate stay COMPUTED — the type-over substitutes the line TOTAL only.
    expect(ex.qty).toBe(baseEx.qty);
    expect(ex.rate).toBe(baseEx.rate);
    // The computed value is retained in the trace.
    expect(r.overrides).toEqual({ [exNodeKey]: { computedValue: baseEx.total, overrideValue: 999_999 } });
    // An un-overridden line is untouched (still derives live).
    expect(r.staffLines.find((l) => l.code === pmRole.code)!.total).toBe(basePm.total);
    // Grand total moves by exactly the override delta.
    expect(r.grandTotal).toBe(base.grandTotal + (999_999 - baseEx.total));
  });

  it("an override of 0 is honored, not treated as 'no override' (INV-3)", () => {
    const base = gc();
    const baseEx = base.staffLines.find((l) => l.code === exRole.code)!;
    const r = gc({ [exNodeKey]: 0 });
    expect(r.staffLines.find((l) => l.code === exRole.code)!.total).toBe(0);
    expect(r.overrides).toEqual({ [exNodeKey]: { computedValue: baseEx.total, overrideValue: 0 } });
    expect(r.grandTotal).toBe(base.grandTotal - baseEx.total);
  });

  it("Site-Ops dynamic + manual lines layer the same way (one map, both kinds)", () => {
    const base = so();
    const baseSafety = base.dynamicLines.find((l) => l.code === safetyDyn.code)!;
    const baseKnox = base.manualLines.find((l) => l.code === knoxManual.code)!;
    expect(baseSafety.total).toBeGreaterThan(0);
    expect(baseKnox.total).toBeGreaterThan(0);

    const r = so({ [safetyNodeKey]: 12_345, [knoxNodeKey]: 678 });
    expect(r.dynamicLines.find((l) => l.code === safetyDyn.code)!.total).toBe(12_345);
    expect(r.manualLines.find((l) => l.code === knoxManual.code)!.total).toBe(678);
    expect(r.overrides).toEqual({
      [safetyNodeKey]: { computedValue: baseSafety.total, overrideValue: 12_345 },
      [knoxNodeKey]: { computedValue: baseKnox.total, overrideValue: 678 },
    });
    expect(r.grandTotal).toBe(base.grandTotal + (12_345 - baseSafety.total) + (678 - baseKnox.total));
  });
});

describe("Phase A+1 — recognized-keys guard (a stale override cannot mis-apply)", () => {
  it("ignores a foreign/summary key and a non-existent line key (result === no-override)", () => {
    const base = gc();
    const r = gc({
      fee: 50_000, // a summary override field — not a line key
      "line:gc:staff:DOESNOTEXIST:total": 777, // a line id this engine never produces
      "subtotal": 1, // another summary key
    });
    expect(r).toEqual(base); // no overrides key, every total unchanged
  });

  it("ignores an override for a REMOVED line (the engine no longer produces its id)", () => {
    // Remove the EX line from the active set, then try to override it.
    const subset = buildPersonnelLineSet({ removeCodes: [exRole.code] });
    const baseSubset = gc(undefined, subset);
    const r = gc({ [exNodeKey]: 999_999 }, subset);
    // EX is gone, so its override is never looked up — result is byte-identical to the subset.
    expect(r).toEqual(baseSubset);
    expect(r.overrides).toBeUndefined();
    expect(r.staffLines.some((l) => l.code === exRole.code)).toBe(false);
  });
});

describe("B3 follow-on — audited QUANTITY override on the duration/sqft-driven lines (D3 on :qty)", () => {
  const exQtyKey = sectionLineQtyOverrideKey(gcStaffLineId(exRole.key)); // line:gc:staff:ex:qty
  const opLine = OPERATIONAL_EXPENSE_DEFAULTS[0];
  const opQtyKey = sectionLineQtyOverrideKey(gcOperationalLineId(opLine.code));
  const safetyQtyKey = sectionLineQtyOverrideKey(siteOpsDynamicLineId(safetyDyn.code));
  const knoxQtyKey = sectionLineQtyOverrideKey(siteOpsManualLineId(knoxManual.key));

  it("the qty key is the line's `:qty` field address (a private override field, not a binding rollup field)", () => {
    expect(exQtyKey).toBe("line:gc:staff:ex:qty");
    // Same `line:<id>:<field>` scheme as the total key, just on the `qty` field.
    expect(sectionLineQtyOverrideKey("gc:staff:ex")).toBe(sectionLineFieldOverrideKey("gc:staff:ex", "qty"));
  });

  it("GC staff: an overridden quantity recomputes total = override-qty × rate; computed qty retained", () => {
    const base = gc();
    const baseEx = base.staffLines.find((l) => l.code === exRole.code)!;
    expect(baseEx.qty).toBeGreaterThan(0);

    const r = gc({ [exQtyKey]: 100 }); // override the computed hours to 100
    const ex = r.staffLines.find((l) => l.code === exRole.code)!;
    expect(ex.qty).toBe(100);                       // effective qty is the override
    expect(ex.rate).toBe(baseEx.rate);              // rate untouched
    expect(ex.total).toBe(100 * baseEx.rate);       // total recomputes as override-qty × rate
    expect(r.overrides).toEqual({ [exQtyKey]: { computedValue: baseEx.qty, overrideValue: 100 } });
    expect(r.grandTotal).toBe(base.grandTotal + (100 * baseEx.rate - baseEx.total));
  });

  it("GC operational + Site-Ops dynamic lines carry the qty override too", () => {
    const baseGc = gc();
    const baseOp = baseGc.operationalLines.find((l) => l.code === opLine.code)!;
    const rGc = gc({ [opQtyKey]: 3 });
    const op = rGc.operationalLines.find((l) => l.code === opLine.code)!;
    expect(op.qty).toBe(3);
    expect(op.total).toBe(3 * baseOp.rate);

    const baseSo = so();
    const baseSafety = baseSo.dynamicLines.find((l) => l.code === safetyDyn.code)!;
    const rSo = so({ [safetyQtyKey]: 7 });
    const safety = rSo.dynamicLines.find((l) => l.code === safetyDyn.code)!;
    expect(safety.qty).toBe(7);
    expect(safety.total).toBe(7 * baseSafety.rate);
    expect(rSo.overrides).toEqual({ [safetyQtyKey]: { computedValue: baseSafety.qty, overrideValue: 7 } });
  });

  it("a qty override is IGNORED for a MANUAL line (its quantity is a direct input, not derived)", () => {
    const base = so();
    const r = so({ [knoxQtyKey]: 999 }); // knox is a manual `qty` line — `:qty` is never looked up
    expect(r).toEqual(base);
    expect(r.overrides).toBeUndefined();
  });

  it("when BOTH a qty and a total override exist, the total override wins (applied last)", () => {
    const base = gc();
    const baseEx = base.staffLines.find((l) => l.code === exRole.code)!;
    const r = gc({ [exQtyKey]: 100, [exNodeKey]: 555 });
    const ex = r.staffLines.find((l) => l.code === exRole.code)!;
    expect(ex.qty).toBe(100);     // the qty override still drives the displayed quantity
    expect(ex.total).toBe(555);   // but the explicit total override wins for the total
    // The total trace's computedValue is the override-qty-based total (qty applied first).
    expect(r.overrides).toEqual({
      [exQtyKey]: { computedValue: baseEx.qty, overrideValue: 100 },
      [exNodeKey]: { computedValue: 100 * baseEx.rate, overrideValue: 555 },
    });
  });
});

describe("Phase A+1 — the override layers in the calc result (A5 tie point)", () => {
  it("projectAppBornSectionLines reads the overridden total for free (binding/rollup reflects it)", () => {
    // The override layers INSIDE the GC calc result, so the A5 projection — which resolves a
    // section line's total from that result by (section, code) — surfaces the override with no
    // extra wiring. This is what makes a bound or rolled-up GC line reflect a type-over.
    const gcOver = gc({ [exNodeKey]: 999_999 });
    const so0 = so();
    const sectionLines = synthesizePersonnelSectionLines(
      { utilEx: 100, utilSu: 50, utilPm: 25 },
      {}
    );
    const projected = projectAppBornSectionLines(sectionLines, gcOver, so0);
    const exLine = projected.find((l) => l.id === gcStaffLineId(exRole.key))!;
    expect(exLine.total).toBe(999_999);
  });

  it("the project.ts bridge forwards lineOverrides through to the engine", () => {
    const sectionLines = synthesizePersonnelSectionLines(
      { utilEx: 100, utilSu: 50, utilPm: 25 },
      {}
    );
    const baseline = computePersonnelFromSectionLines(sectionLines, {
      durationMonths: DURATION,
      squareFootage: SQFT,
    });
    const baseEx = baseline.staffLines.find((l) => l.code === exRole.code)!;
    expect(baseEx.total).toBeGreaterThan(0);

    const overridden = computePersonnelFromSectionLines(sectionLines, {
      durationMonths: DURATION,
      squareFootage: SQFT,
      lineOverrides: { [exNodeKey]: 424_242 },
    });
    expect(overridden.staffLines.find((l) => l.code === exRole.code)!.total).toBe(424_242);
    expect(overridden.overrides).toEqual({
      [exNodeKey]: { computedValue: baseEx.total, overrideValue: 424_242 },
    });
  });
});
