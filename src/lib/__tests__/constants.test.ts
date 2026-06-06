import { describe, it, expect } from "vitest";
import {
  ESTIMATE_MODIFIERS,
  HOURS_PER_MONTH,
  STAFF_ROLE_DEFAULTS,
  OPERATIONAL_EXPENSE_DEFAULTS,
  EQUIPMENT_DEFAULTS,
  SITE_OPS_DYNAMIC_DEFAULTS,
  SITE_OPS_MANUAL_DEFAULTS,
  DIVISION_NAMES,
  DIVISION_LABELS,
  SAFETY_RATE_PER_MONTH,
  TEMP_PROTECTION_RATE_PER_SF,
  MATERIAL_HOIST_RATE_PER_MONTH,
  KNOX_BOX_UNIT_COST,
  PAYROLL_CLEANING_RATE_PER_EA,
  HIRED_CLEANING_RATE_PER_EA,
} from "../constants";
import PROCORE_VALID_CODES from "../procore-valid-codes.json";

describe("Estimate Modifiers", () => {
  it("has exactly 7 entries", () => {
    expect(ESTIMATE_MODIFIERS).toHaveLength(7);
  });

  it("all entries have unique keys", () => {
    const keys = ESTIMATE_MODIFIERS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("all entries have unique cost codes", () => {
    const codes = ESTIMATE_MODIFIERS.map((m) => m.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("GL Insurance default rate is 1% (0.01)", () => {
    const gl = ESTIMATE_MODIFIERS.find((m) => m.key === "glInsurance");
    expect(gl).toBeDefined();
    expect(gl!.defaultRate).toBe(0.01);
  });

  it("Fee default rate is 5% (0.05)", () => {
    const fee = ESTIMATE_MODIFIERS.find((m) => m.key === "fee");
    expect(fee).toBeDefined();
    expect(fee!.defaultRate).toBe(0.05);
  });
});

describe("Financial Constants", () => {
  it("HOURS_PER_MONTH is standard 173.2", () => {
    expect(HOURS_PER_MONTH).toBe(173.2);
  });
});

describe("Staff Role Defaults", () => {
  it("has exactly 8 roles", () => {
    expect(STAFF_ROLE_DEFAULTS).toHaveLength(8);
  });

  it("all roles have unique keys", () => {
    const keys = STAFF_ROLE_DEFAULTS.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("all roles have unique cost codes", () => {
    const codes = STAFF_ROLE_DEFAULTS.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("all rates are positive numbers", () => {
    for (const role of STAFF_ROLE_DEFAULTS) {
      expect(role.defaultRate).toBeGreaterThan(0);
      expect(typeof role.defaultRate).toBe("number");
    }
  });

  it("all cost codes follow the template's 01-XXXX.XXX criterion format (gc-siteops Phase 3)", () => {
    for (const role of STAFF_ROLE_DEFAULTS) {
      expect(role.code).toMatch(/^01-\d{4}\.\d{3}$/);
    }
  });
});

describe("GC / Site Ops → Budget Line Items mapping (gc-siteops Phase 3)", () => {
  const allLines = [
    ...STAFF_ROLE_DEFAULTS,
    ...OPERATIONAL_EXPENSE_DEFAULTS,
    ...EQUIPMENT_DEFAULTS,
    ...SITE_OPS_DYNAMIC_DEFAULTS,
    ...SITE_OPS_MANUAL_DEFAULTS,
  ];

  it("every line carries a BLI code that exists in Procore's valid-code list (§0.D rule 4)", () => {
    const valid = new Set((PROCORE_VALID_CODES as { code: string }[]).map((c) => c.code));
    for (const line of allLines) {
      expect(line.procoreCode, `procoreCode for ${line.code}`).toMatch(/^\d+-\d+\.\d{3}$/);
      expect(valid.has(line.procoreCode), `${line.code} → ${line.procoreCode} not in procore-valid-codes.json`).toBe(true);
    }
  });

  it("internal criterion codes are unique across all GC/Site Ops lines", () => {
    const codes = allLines.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("D2 sign-off encoded: hired cleaning maps to its sibling's BLI code", () => {
    const hired = SITE_OPS_MANUAL_DEFAULTS.find((l) => l.code === "02-9010.002");
    expect(hired).toBeDefined();
    expect(hired!.procoreCode).toBe("2-29010.000");
  });
});

describe("Operational Expense Defaults", () => {
  it("has exactly 3 expense types", () => {
    expect(OPERATIONAL_EXPENSE_DEFAULTS).toHaveLength(3);
  });

  it("all expenses have valid quantity drivers", () => {
    for (const exp of OPERATIONAL_EXPENSE_DEFAULTS) {
      expect(["superintendent", "fixed"]).toContain(exp.quantityDriver);
    }
  });
});

describe("Division Labels", () => {
  it("DIVISION_NAMES covers standard divisions", () => {
    const keys = Object.keys(DIVISION_NAMES);
    expect(keys).toHaveLength(25);
    const expectedDivisions = [
      "01", "02", "03", "04", "05", "06", "07", "08", "09", "10",
      "11", "12", "13", "14", "21", "22", "23", "26", "27", "28",
      "31", "32", "33", "50", "80"
    ];
    for (const div of expectedDivisions) {
      expect(DIVISION_NAMES[div]).toBeDefined();
    }
  });

  it("DIVISION_LABELS covers same divisions as DIVISION_NAMES", () => {
    expect(Object.keys(DIVISION_LABELS).sort()).toEqual(
      Object.keys(DIVISION_NAMES).sort()
    );
  });
});

describe("Site Operations Default Rates", () => {
  it("all site ops rates are positive numbers", () => {
    expect(SAFETY_RATE_PER_MONTH).toBeGreaterThan(0);
    expect(TEMP_PROTECTION_RATE_PER_SF).toBeGreaterThan(0);
    expect(MATERIAL_HOIST_RATE_PER_MONTH).toBeGreaterThan(0);
    expect(KNOX_BOX_UNIT_COST).toBeGreaterThan(0);
    expect(PAYROLL_CLEANING_RATE_PER_EA).toBeGreaterThan(0);
    expect(HIRED_CLEANING_RATE_PER_EA).toBeGreaterThan(0);
  });
});
