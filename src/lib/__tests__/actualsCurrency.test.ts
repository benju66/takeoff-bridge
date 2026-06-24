import { describe, it, expect } from "vitest";
import {
  parseActualsCurrency,
  normalizeEventId,
  parseCostCode,
  parseCostCodeDescription,
  parseCostType,
  buildGrainKey,
} from "@/lib/actuals";

describe("parseActualsCurrency", () => {
  it("parses plain and $-prefixed positives", () => {
    expect(parseActualsCurrency("0.0")).toBe(0);
    expect(parseActualsCurrency("$726.63")).toBe(726.63);
    expect(parseActualsCurrency("$125,000.00")).toBe(125000);
  });

  it("tolerates Procore's trailing space", () => {
    expect(parseActualsCurrency("$15,000.00 ")).toBe(15000);
    expect(parseActualsCurrency("$0.00 ")).toBe(0);
  });

  it("reads savings (accounting parentheses) as NEGATIVE — never flips sign", () => {
    expect(parseActualsCurrency("($41,476.26)")).toBe(-41476.26);
    expect(parseActualsCurrency("($1,250.00)")).toBe(-1250);
    expect(parseActualsCurrency("-$54,500.00")).toBe(-54500);
  });

  it("treats blank, null, and Procore 'None' as zero", () => {
    expect(parseActualsCurrency("")).toBe(0);
    expect(parseActualsCurrency("   ")).toBe(0);
    expect(parseActualsCurrency(null)).toBe(0);
    expect(parseActualsCurrency(undefined)).toBe(0);
    expect(parseActualsCurrency("None")).toBe(0);
  });

  it("never guesses a positive for ambiguous input", () => {
    // European decimal-comma is ambiguous → 0, not a wrong positive.
    expect(parseActualsCurrency("1.234,50")).toBe(0);
  });

  it("passes through a plain number", () => {
    expect(parseActualsCurrency(42)).toBe(42);
    expect(parseActualsCurrency(-42.5)).toBe(-42.5);
  });
});

describe("normalizeEventId", () => {
  it("strips leading zeros from numeric ids so detail '097' joins summary '97'", () => {
    expect(normalizeEventId("097")).toBe("97");
    expect(normalizeEventId("97")).toBe("97");
    expect(normalizeEventId("001")).toBe("1");
    expect(normalizeEventId("162")).toBe("162");
  });

  it("keeps internal ids verbatim (uppercased, trimmed)", () => {
    expect(normalizeEventId("INT-001")).toBe("INT-001");
    expect(normalizeEventId(" int-002 ")).toBe("INT-002");
  });

  it("returns empty string for blank input", () => {
    expect(normalizeEventId("")).toBe("");
    expect(normalizeEventId(null)).toBe("");
  });
});

describe("parseCostCode / description", () => {
  it("splits '<code> - <description>'", () => {
    expect(parseCostCode("5-51200.000 - Structural Steel")).toBe("5-51200.000");
    expect(parseCostCodeDescription("5-51200.000 - Structural Steel")).toBe("Structural Steel");
    expect(parseCostCode("60-602020.000 - General Liability Insurance")).toBe("60-602020.000");
  });

  it("returns empty for blank cells", () => {
    expect(parseCostCode("")).toBe("");
    expect(parseCostCode("   ")).toBe("");
    expect(parseCostCodeDescription("")).toBe("");
  });
});

describe("parseCostType", () => {
  it("maps the 'X - X' form to a canonical type", () => {
    expect(parseCostType("Labor - Labor")).toBe("Labor");
    expect(parseCostType("Material - Material")).toBe("Material");
    expect(parseCostType("Subcontract - Subcontract")).toBe("Subcontract");
    expect(parseCostType("Equipment - Equipment")).toBe("Equipment");
  });

  it("maps None / blank / unknown to Other", () => {
    expect(parseCostType("None")).toBe("Other");
    expect(parseCostType("")).toBe("Other");
    expect(parseCostType("Weird")).toBe("Other");
  });
});

describe("buildGrainKey", () => {
  it("composes the Procore Budget Code grain", () => {
    expect(buildGrainKey("1-10320.000", "Labor")).toBe("1-10320.000.Labor");
    expect(buildGrainKey("60-602020.000", "Material")).toBe("60-602020.000.Material");
  });
});
