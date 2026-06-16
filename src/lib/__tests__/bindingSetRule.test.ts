import { describe, it, expect } from "vitest";
import {
  matchesSetRule,
  selectLines,
  lineAttribute,
  SetRuleError,
} from "../bindings/setRule";
import type { BindingLine, SetRule } from "../bindings/types";

function line(overrides: Partial<BindingLine> = {}): BindingLine {
  return {
    id: "id-1",
    itemId: "03-0000.001",
    costType: "L",
    source: "template",
    procoreCode: "3-33543.000",
    total: 100,
    unitPrice: 10,
    matchedQty: 10,
    ...overrides,
  };
}

describe("lineAttribute", () => {
  it("routes division/baseCode/suffix through the division.ts parsers", () => {
    const l = line({ itemId: "09-2100.005" });
    expect(lineAttribute(l, "itemId")).toBe("09-2100.005");
    expect(lineAttribute(l, "division")).toBe("09");
    expect(lineAttribute(l, "baseCode")).toBe("09-2100");
    expect(lineAttribute(l, "suffix")).toBe("005");
  });

  it("reads the raw line attributes for costType/source/procoreCode", () => {
    const l = line({ costType: "M", source: "manual", procoreCode: "4-40000.000" });
    expect(lineAttribute(l, "costType")).toBe("M");
    expect(lineAttribute(l, "source")).toBe("manual");
    expect(lineAttribute(l, "procoreCode")).toBe("4-40000.000");
  });

  it("throws for an out-of-grammar field", () => {
    expect(() =>
      lineAttribute(line(), "nope" as unknown as Parameters<typeof lineAttribute>[1])
    ).toThrow(SetRuleError);
  });
});

describe("matchesSetRule — leaves", () => {
  it("equals matches an exact attribute value", () => {
    expect(matchesSetRule(line(), { field: "division", match: "equals", value: "03" })).toBe(true);
    expect(matchesSetRule(line(), { field: "division", match: "equals", value: "09" })).toBe(false);
  });

  it("startsWith matches a prefix", () => {
    expect(
      matchesSetRule(line({ itemId: "03-0000.001" }), {
        field: "baseCode",
        match: "startsWith",
        value: "03-",
      })
    ).toBe(true);
    expect(
      matchesSetRule(line({ itemId: "03-0000.001" }), {
        field: "baseCode",
        match: "startsWith",
        value: "09-",
      })
    ).toBe(false);
  });

  it("in matches membership in a value list", () => {
    const rule: SetRule = { field: "costType", match: "in", value: ["L", "E"] };
    expect(matchesSetRule(line({ costType: "L" }), rule)).toBe(true);
    expect(matchesSetRule(line({ costType: "E" }), rule)).toBe(true);
    expect(matchesSetRule(line({ costType: "M" }), rule)).toBe(false);
  });

  it("throws when equals/startsWith receive a non-string value", () => {
    expect(() =>
      matchesSetRule(line(), {
        field: "division",
        match: "equals",
        value: ["03"] as unknown as string,
      })
    ).toThrow(SetRuleError);
    expect(() =>
      matchesSetRule(line(), {
        field: "division",
        match: "startsWith",
        value: ["03"] as unknown as string,
      })
    ).toThrow(SetRuleError);
  });

  it("throws when in receives a non-array value", () => {
    expect(() =>
      matchesSetRule(line(), {
        field: "costType",
        match: "in",
        value: "L" as unknown as string[],
      })
    ).toThrow(SetRuleError);
  });

  it("throws for an unknown match operator", () => {
    expect(() =>
      matchesSetRule(line(), {
        field: "division",
        match: "regex" as unknown as "equals",
        value: "03",
      })
    ).toThrow(SetRuleError);
  });
});

describe("matchesSetRule — combinators", () => {
  it("all requires every sub-rule to match", () => {
    const rule: SetRule = {
      all: [
        { field: "division", match: "equals", value: "03" },
        { field: "costType", match: "equals", value: "L" },
      ],
    };
    expect(matchesSetRule(line({ itemId: "03-0000.001", costType: "L" }), rule)).toBe(true);
    expect(matchesSetRule(line({ itemId: "03-0000.001", costType: "M" }), rule)).toBe(false);
  });

  it("any requires at least one sub-rule to match", () => {
    const rule: SetRule = {
      any: [
        { field: "costType", match: "equals", value: "L" },
        { field: "costType", match: "equals", value: "E" },
      ],
    };
    expect(matchesSetRule(line({ costType: "E" }), rule)).toBe(true);
    expect(matchesSetRule(line({ costType: "M" }), rule)).toBe(false);
  });

  it("nests combinators", () => {
    const rule: SetRule = {
      all: [
        { field: "division", match: "equals", value: "03" },
        { any: [
          { field: "costType", match: "equals", value: "L" },
          { field: "costType", match: "equals", value: "M" },
        ] },
      ],
    };
    expect(matchesSetRule(line({ itemId: "03-0000.001", costType: "M" }), rule)).toBe(true);
    expect(matchesSetRule(line({ itemId: "03-0000.001", costType: "S" }), rule)).toBe(false);
  });

  it("treats empty all as vacuously true and empty any as vacuously false", () => {
    expect(matchesSetRule(line(), { all: [] })).toBe(true);
    expect(matchesSetRule(line(), { any: [] })).toBe(false);
  });

  it("explicitIds matches by line id", () => {
    expect(matchesSetRule(line({ id: "x" }), { explicitIds: ["x", "y"] })).toBe(true);
    expect(matchesSetRule(line({ id: "z" }), { explicitIds: ["x", "y"] })).toBe(false);
  });

  it("throws for a malformed rule object", () => {
    expect(() => matchesSetRule(line(), {} as unknown as SetRule)).toThrow(SetRuleError);
  });
});

describe("selectLines", () => {
  const lines: BindingLine[] = [
    line({ id: "a", itemId: "03-0000.001", costType: "L", total: 100 }),
    line({ id: "b", itemId: "03-1000.002", costType: "M", total: 200 }),
    line({ id: "c", itemId: "09-2100.001", costType: "L", total: 300 }),
  ];

  it("returns matching lines in original order", () => {
    const result = selectLines(lines, { field: "division", match: "equals", value: "03" });
    expect(result.map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(selectLines(lines, { field: "division", match: "equals", value: "99" })).toEqual([]);
  });

  it("supports rule-based filtering combining division and costType", () => {
    const result = selectLines(lines, {
      all: [
        { field: "division", match: "equals", value: "03" },
        { field: "costType", match: "equals", value: "L" },
      ],
    });
    expect(result.map((l) => l.id)).toEqual(["a"]);
  });
});
