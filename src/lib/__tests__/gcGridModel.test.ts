import { describe, it, expect } from "vitest";
import {
  GC_GROUP_LABELS,
  GC_ROW_META,
  buildCalcLookup,
  entryValue,
  gcIsDerivedQtyLine,
  resolveEntryTarget,
  resolveRoleKey,
  type GcGroupKey,
} from "@/lib/sectionLines/gcGridModel";
import { synthesizePersonnelSectionLines } from "@/lib/sectionLines/synthesize";
import { computePersonnelCosts } from "@/lib/calculations";
import { gcStaffLineId, sectionLineTotalOverrideKey } from "@/lib/sectionLines/ids";
import {
  STAFF_ROLE_DEFAULTS,
  OPERATIONAL_EXPENSE_DEFAULTS,
  EQUIPMENT_DEFAULTS,
  GC_MANUAL_DEFAULTS,
} from "@/lib/constants";
import { ENTRY_KIND } from "@/lib/sectionLines/entryKinds";

// ---------------------------------------------------------------------------
// GC Personnel grid MODEL (Phase B2) — the pure presentational + dispatch logic the
// Step-2 grid is built on. These guard the load-bearing pieces that have no React:
// the 01.A–01.F grouping/order, the calc-by-code join, the entry value per kind, the
// section-line → personnel-setter resolution, and the per-line type-over field key.
// ---------------------------------------------------------------------------

const ALL_GC_CODES = [
  ...STAFF_ROLE_DEFAULTS.map((r) => r.code),
  ...OPERATIONAL_EXPENSE_DEFAULTS.map((o) => o.code),
  ...EQUIPMENT_DEFAULTS.map((e) => e.code),
  ...GC_MANUAL_DEFAULTS.map((m) => m.code),
];

describe("GC_ROW_META — section grouping (01.A–01.F)", () => {
  it("groups every GC catalog code, with no stragglers", () => {
    for (const code of ALL_GC_CODES) expect(GC_ROW_META.has(code)).toBe(true);
    expect(GC_ROW_META.size).toBe(ALL_GC_CODES.length);
  });

  it("uses all six labelled groups", () => {
    const groups = new Set([...GC_ROW_META.values()].map((m) => m.group));
    expect([...groups].sort()).toEqual(["01.A", "01.B", "01.C", "01.D", "01.E", "01.F"]);
    for (const g of groups) expect(GC_GROUP_LABELS[g]).toBeTruthy();
  });

  it("display order is a contiguous 0..N-1 permutation in section order", () => {
    const sorted = [...GC_ROW_META.values()].sort((a, b) => a.order - b.order);
    expect(sorted.map((m) => m.order)).toEqual(sorted.map((_, i) => i));
    // Group keys, read in display order, never go backwards (all 01.A before 01.B, …).
    // "01.G" is the one-off divider (B5) — not used by any catalog ROW_META row, but part of GcGroupKey.
    const rank: Record<GcGroupKey, number> = { "01.A": 0, "01.B": 1, "01.C": 2, "01.D": 3, "01.E": 4, "01.F": 5, "01.G": 6 };
    const ranks = sorted.map((m) => rank[m.group]);
    for (let i = 1; i < ranks.length; i++) expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1]);
  });

  it("maps the engine-graph subtotal group per kind", () => {
    expect(GC_ROW_META.get(STAFF_ROLE_DEFAULTS[0].code)?.engineGroup).toBe("staff");
    expect(GC_ROW_META.get(EQUIPMENT_DEFAULTS[0].code)?.engineGroup).toBe("equipment");
    expect(GC_ROW_META.get(OPERATIONAL_EXPENSE_DEFAULTS[0].code)?.engineGroup).toBe("ops");
    expect(GC_ROW_META.get(GC_MANUAL_DEFAULTS[0].code)?.engineGroup).toBe("manual");
  });
});

describe("buildCalcLookup — join calc lines by code", () => {
  it("maps each computed line's total/qty/rate by code", () => {
    const calc = computePersonnelCosts(12, 10000, { ex: 50, su: 25 }, { dumpsters: 1500, toilets: 0, electric: 0 });
    const lookup = buildCalcLookup(calc);
    // one entry per produced line, no collisions
    expect(lookup.size).toBe(
      calc.staffLines.length + calc.operationalLines.length + calc.equipmentLines.length + calc.manualLines.length
    );
    const exStaff = calc.staffLines.find((l) => l.code === STAFF_ROLE_DEFAULTS[0].code)!;
    expect(lookup.get(exStaff.code)).toEqual({ qty: exStaff.qty, rate: exStaff.rate, total: exStaff.total });
  });
});

describe("entryValue / resolveEntryTarget / resolveRoleKey — per kind", () => {
  const lines = synthesizePersonnelSectionLines(
    { utilEx: 40 },
    { eqDumpsters: 1500, preconFees: 5000 }
  );
  const staff = lines.find((l) => l.entryKind === ENTRY_KIND.StaffRole && l.code === STAFF_ROLE_DEFAULTS[0].code)!;
  const equip = lines.find((l) => l.entryKind === ENTRY_KIND.Equipment && l.code === EQUIPMENT_DEFAULTS[0].code)!;
  const operational = lines.find((l) => l.entryKind === ENTRY_KIND.OperationalExpense)!;
  const manual = lines.find((l) => l.code === GC_MANUAL_DEFAULTS.find((m) => m.key === "preconFees")!.code)!;

  it("reads the estimator value the right way per kind", () => {
    expect(entryValue(staff)).toBe(40);      // utilization %
    expect(entryValue(equip)).toBe(1500);    // equipment $
    expect(entryValue(manual)).toBe(5000);   // manual value
    expect(entryValue(operational)).toBe(0); // auto line — no estimator input
  });

  it("resolves the personnel-setter target + key (operational → null)", () => {
    expect(resolveEntryTarget(staff)).toEqual({ target: "utilization", key: STAFF_ROLE_DEFAULTS[0].key });
    expect(resolveEntryTarget(equip)).toEqual({ target: "equipment", key: EQUIPMENT_DEFAULTS[0].key });
    expect(resolveEntryTarget(manual)).toEqual({ target: "manual", key: "preconFees" });
    expect(resolveEntryTarget(operational)).toBeNull();
  });

  it("resolves the staff role key for the rate override (non-staff → null)", () => {
    expect(resolveRoleKey(staff)).toBe(STAFF_ROLE_DEFAULTS[0].key);
    expect(resolveRoleKey(equip)).toBeNull();
    expect(resolveRoleKey(operational)).toBeNull();
  });

  it("gcIsDerivedQtyLine: staff + operational have a DERIVED (locked) quantity; equipment + manual do not", () => {
    expect(gcIsDerivedQtyLine(staff)).toBe(true);
    expect(gcIsDerivedQtyLine(operational)).toBe(true);
    expect(gcIsDerivedQtyLine(equip)).toBe(false);
    expect(gcIsDerivedQtyLine(manual)).toBe(false);
  });
});

describe("per-line type-over (D3) — the field key the grid records under applies in the engine", () => {
  const baseline = computePersonnelCosts(12, 10000, { ex: 50 }, { dumpsters: 0, toilets: 0, electric: 0 });
  const exCode = STAFF_ROLE_DEFAULTS[0].code;
  const computed = baseline.staffLines.find((l) => l.code === exCode)!.total;
  const overrideKey = sectionLineTotalOverrideKey(gcStaffLineId(STAFF_ROLE_DEFAULTS[0].key));

  it("a recorded override substitutes the line total + grand total and retains computed", () => {
    const over = computePersonnelCosts(
      12, 10000, { ex: 50 }, { dumpsters: 0, toilets: 0, electric: 0 },
      {}, undefined, undefined, undefined, { [overrideKey]: 9999 }
    );
    const exLine = over.staffLines.find((l) => l.code === exCode)!;
    expect(exLine.total).toBe(9999);
    // qty / rate stay computed; only the total substitutes.
    expect(exLine.qty).toBe(baseline.staffLines.find((l) => l.code === exCode)!.qty);
    expect(over.grandTotal).toBeCloseTo(baseline.grandTotal - computed + 9999, 6);
    expect(over.overrides?.[overrideKey]).toEqual({ computedValue: computed, overrideValue: 9999 });
  });

  it("is inert with no overrides (byte-identical, no overrides trace) — goldens hold", () => {
    expect(baseline.overrides).toBeUndefined();
    const sameAgain = computePersonnelCosts(12, 10000, { ex: 50 }, { dumpsters: 0, toilets: 0, electric: 0 });
    expect(JSON.stringify(sameAgain)).toBe(JSON.stringify(baseline));
  });

  it("ignores an override for a line this engine does not produce (recognized-keys guard)", () => {
    const foreign = computePersonnelCosts(
      12, 10000, { ex: 50 }, { dumpsters: 0, toilets: 0, electric: 0 },
      {}, undefined, undefined, undefined, { [sectionLineTotalOverrideKey("gc:staff:doesNotExist")]: 1 }
    );
    expect(foreign.overrides).toBeUndefined();
    expect(foreign.grandTotal).toBe(baseline.grandTotal);
  });
});
