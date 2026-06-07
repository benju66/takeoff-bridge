import { describe, it, expect } from "vitest";
import {
  ESTIMATE_MODIFIERS,
  HOURS_PER_MONTH,
  STAFF_ROLE_DEFAULTS,
  OPERATIONAL_EXPENSE_DEFAULTS,
  EQUIPMENT_DEFAULTS,
  GC_MANUAL_DEFAULTS,
  SITE_OPS_DYNAMIC_DEFAULTS,
  SITE_OPS_MANUAL_DEFAULTS,
  SITE_OPS_SECTIONS,
  DIVISION_NAMES,
  DIVISION_LABELS,
  SAFETY_RATE_PER_MONTH,
  TEMP_PROTECTION_RATE_PER_SF,
  MATERIAL_HOIST_RATE_PER_MONTH,
  KNOX_BOX_UNIT_COST,
  PAYROLL_CLEANING_RATE_PER_EA,
  HIRED_CLEANING_RATE_PER_EA,
  LINKED_DIVISION_ROWS,
  SUPERVISION_STAFF_CODES,
  isLinkedDivisionRow,
} from "../constants";
import PROCORE_VALID_CODES from "../procore-valid-codes.json";
import ESTIMATE_CATALOG from "../estimate-catalog.json";

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

describe("GC / Site Ops → Budget Line Items mapping (gc-siteops Phase 3 + 4)", () => {
  const allLines = [
    ...STAFF_ROLE_DEFAULTS,
    ...OPERATIONAL_EXPENSE_DEFAULTS,
    ...EQUIPMENT_DEFAULTS,
    ...GC_MANUAL_DEFAULTS,
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

  it("D2 sign-off encoded: all 4 orphan lines map to their sibling's BLI code", () => {
    const hired = SITE_OPS_MANUAL_DEFAULTS.find((l) => l.code === "02-9010.002");
    expect(hired!.procoreCode).toBe("2-29010.000");
    const tempOffice = OPERATIONAL_EXPENSE_DEFAULTS.find((l) => l.code === "01-5110.002");
    expect(tempOffice!.procoreCode).toBe("1-15110.000");
    const sawcutting = SITE_OPS_MANUAL_DEFAULTS.find((l) => l.code === "02-4100.002");
    expect(sawcutting!.procoreCode).toBe("2-24100.000");
    const floorScanning = SITE_OPS_MANUAL_DEFAULTS.find((l) => l.code === "02-9200.002");
    expect(floorScanning!.procoreCode).toBe("2-29200.000");
  });

  // ─── Phase 4: full input coverage ──────────────────────────────────

  it("GC lines cover all 34 STEP-2-sourced BLI codes (findings §4.1)", () => {
    const gcBliCodes = new Set(
      [...STAFF_ROLE_DEFAULTS, ...OPERATIONAL_EXPENSE_DEFAULTS, ...EQUIPMENT_DEFAULTS, ...GC_MANUAL_DEFAULTS]
        .map((l) => l.procoreCode)
    );
    expect(gcBliCodes.size).toBe(34);
    for (const code of gcBliCodes) expect(code.startsWith("1-1"), code).toBe(true);
  });

  it("Site Ops lines cover all 38 STEP-3-sourced BLI codes (findings §4.2)", () => {
    const siteOpsBliCodes = new Set(
      [...SITE_OPS_DYNAMIC_DEFAULTS, ...SITE_OPS_MANUAL_DEFAULTS].map((l) => l.procoreCode)
    );
    expect(siteOpsBliCodes.size).toBe(38);
    for (const code of siteOpsBliCodes) expect(code.startsWith("2-2"), code).toBe(true);
  });

  it("Subcontract cost types match template BLI col B (Phase 4 forensic re-verification, incl. FFE Relocation)", () => {
    const expectedSubcontract = new Set([
      "2-24100.000", // Demolition
      "2-25100.000", // FFE Relocation (caught in Phase 4 — not in the Phase 3 list)
      "2-28213.000", // Abatement
      "2-29005.000", // Final Cleaning
      "2-29045.000", // Temp Access Roads
      "2-29200.000", // Survey & Layout
    ]);
    for (const line of allLines) {
      const expected = line.costType === "L" ? "L" : expectedSubcontract.has(line.procoreCode) ? "S" : "M";
      expect(line.costType, `${line.code} → ${line.procoreCode}`).toBe(expected);
    }
    // Staff lines are the only Labor lines
    const laborLines = allLines.filter((l) => l.costType === "L");
    expect(laborLines).toHaveLength(STAFF_ROLE_DEFAULTS.length);
  });

  it("persistence keys are unique within each JSONB bucket", () => {
    const gcKeys = [...EQUIPMENT_DEFAULTS.map((l) => l.key), ...GC_MANUAL_DEFAULTS.map((l) => l.key)];
    expect(new Set(gcKeys).size).toBe(gcKeys.length);
    const siteOpsKeys = SITE_OPS_MANUAL_DEFAULTS.map((l) => l.key);
    expect(new Set(siteOpsKeys).size).toBe(siteOpsKeys.length);
  });

  it("every Site Ops line belongs to a declared template section", () => {
    const sectionIds = new Set(SITE_OPS_SECTIONS.map((s) => s.id));
    for (const line of [...SITE_OPS_DYNAMIC_DEFAULTS, ...SITE_OPS_MANUAL_DEFAULTS]) {
      expect(sectionIds.has(line.section), `${line.code} section "${line.section}"`).toBe(true);
    }
  });

  it("the two %-of-estimate lines carry the template % guidance (findings §5.2)", () => {
    const safety = GC_MANUAL_DEFAULTS.find((l) => l.code === "01-0610.001");
    expect(safety!.pctHint).toBe(0.0002);
    const procore = GC_MANUAL_DEFAULTS.find((l) => l.code === "01-1600.001");
    expect(procore!.pctHint).toBe(0.0019);
  });
});

describe("Operational Expense Defaults", () => {
  it("has exactly 13 expense lines (3 original + 10 Phase 4 auto lines)", () => {
    expect(OPERATIONAL_EXPENSE_DEFAULTS).toHaveLength(13);
  });

  it("all expenses have valid quantity drivers", () => {
    for (const exp of OPERATIONAL_EXPENSE_DEFAULTS) {
      expect(["superintendent", "fixed", "sqftPer3000"]).toContain(exp.quantityDriver);
    }
  });

  it("only Temporary Fire Extinguishers uses the sqftPer3000 driver (template =J8/3000)", () => {
    const sqftLines = OPERATIONAL_EXPENSE_DEFAULTS.filter((e) => e.quantityDriver === "sqftPer3000");
    expect(sqftLines).toHaveLength(1);
    expect(sqftLines[0].code).toBe("01-5150.001");
    expect(sqftLines[0].rate).toBe(100);
  });
});

describe("Phase 4 manual GC lines", () => {
  it("has exactly 11 lines (3 qty + 8 lump-sum incl. the two %-lines)", () => {
    expect(GC_MANUAL_DEFAULTS).toHaveLength(11);
    expect(GC_MANUAL_DEFAULTS.filter((l) => l.entry === "qty")).toHaveLength(3);
    expect(GC_MANUAL_DEFAULTS.filter((l) => l.entry === "lumpSum")).toHaveLength(8);
  });

  it("qty lines carry their template rates; lump-sum lines carry none", () => {
    for (const line of GC_MANUAL_DEFAULTS) {
      if (line.entry === "qty") {
        expect(line.rate, line.code).toBeGreaterThan(0);
      } else {
        expect(line.rate, line.code).toBeNull();
      }
    }
  });
});

describe("Linked division rows (gc-siteops Phase 5)", () => {
  it("declares exactly the 10 template link rows (STEP 4 rows 12–24, findings §5.1)", () => {
    expect(LINKED_DIVISION_ROWS.map((r) => r.itemId)).toEqual([
      "01-0000.001", "01-0400.002", "02-0000.001", "02-4100.002", "02-9005.003",
      "02-9070.004", "02-9200.005", "02-9300.006", "02-9400.007", "02-9500.008",
    ]);
  });

  it("every linked itemId exists in the STEP 4 catalog and maps to a division parent BLI code", () => {
    const catalog = ESTIMATE_CATALOG as Record<string, { procoreCode: string; description: string }>;
    for (const row of LINKED_DIVISION_ROWS) {
      const entry = catalog[row.itemId];
      expect(entry, row.itemId).toBeDefined();
      const expectedParent = row.itemId.startsWith("01") ? "1-10000.000" : "2-20000.000";
      expect(entry.procoreCode, row.itemId).toBe(expectedParent);
    }
  });

  it("the 8 Site Ops link rows cover all 8 template sections exactly once", () => {
    const sections = LINKED_DIVISION_ROWS
      .filter((r) => r.source.kind === "siteOpsSection")
      .map((r) => (r.source.kind === "siteOpsSection" ? r.source.section : ""));
    expect(sections.sort()).toEqual(SITE_OPS_SECTIONS.map((s) => s.id).sort());
  });

  it("supervision = the 3 superintendent staff roles (template STEP 2 I16)", () => {
    expect(SUPERVISION_STAFF_CODES).toEqual(["01-0410.001", "01-0420.001", "01-0430.001"]);
    const staffCodes = new Set(STAFF_ROLE_DEFAULTS.map((r) => r.code));
    for (const code of SUPERVISION_STAFF_CODES) {
      expect(staffCodes.has(code), code).toBe(true);
    }
  });

  it("isLinkedDivisionRow matches linked itemIds only (incl. trim + empty handling)", () => {
    expect(isLinkedDivisionRow("01-0000.001")).toBe(true);
    expect(isLinkedDivisionRow(" 02-4100.002 ")).toBe(true);
    expect(isLinkedDivisionRow("02-4100.001")).toBe(false); // STEP 3 demolition source line
    expect(isLinkedDivisionRow("03-0000.001")).toBe(false);
    expect(isLinkedDivisionRow("")).toBe(false);
    expect(isLinkedDivisionRow(undefined)).toBe(false);
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
