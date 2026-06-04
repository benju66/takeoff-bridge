import { describe, it, expect } from "vitest";
import {
  ESTIMATE_MODIFIERS,
  HOURS_PER_MONTH,
  STAFF_ROLE_DEFAULTS,
  OPERATIONAL_EXPENSE_DEFAULTS,
  DIVISION_NAMES,
  DIVISION_LABELS,
  SAFETY_RATE_PER_MONTH,
  TEMP_PROTECTION_RATE_PER_SF,
  MATERIAL_HOIST_RATE_PER_MONTH,
  KNOX_BOX_UNIT_COST,
  PAYROLL_CLEANING_RATE_PER_EA,
  HIRED_CLEANING_RATE_PER_EA,
} from "../constants";

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

  it("all cost codes follow 01-XXXX format", () => {
    for (const role of STAFF_ROLE_DEFAULTS) {
      expect(role.code).toMatch(/^01-\d{4}$/);
    }
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
