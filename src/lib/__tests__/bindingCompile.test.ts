import { describe, it, expect } from "vitest";
import {
  compileBinding,
  compileBindingToNode,
  lineFieldNodeId,
  DEFAULT_ROLLUP_FIELD,
  BindingCompileError,
} from "../bindings/compile";
import type { Binding, BindingLine, CompileContext } from "../bindings/types";

const NO_LINES: CompileContext = { lines: [] };

function ctx(lines: BindingLine[]): CompileContext {
  return { lines };
}

function bindingLine(overrides: Partial<BindingLine> = {}): BindingLine {
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

describe("lineFieldNodeId", () => {
  it("builds the by-ID line field node address", () => {
    expect(lineFieldNodeId("abc", "total")).toBe("line:abc:total");
    expect(lineFieldNodeId("abc", "unitPrice")).toBe("line:abc:unitPrice");
    expect(lineFieldNodeId("abc", "matchedQty")).toBe("line:abc:matchedQty");
  });
});

describe("compileBinding — lookup", () => {
  it("mirrors the source value with no transform", () => {
    const binding: Binding = {
      targetNodeId: "line:row1:total",
      basis: "currency",
      definition: { kind: "lookup", source: "gc:supervisionSubtotal" },
    };
    const { inputs, evaluate } = compileBinding(binding, NO_LINES);
    expect(inputs).toEqual(["gc:supervisionSubtotal"]);
    expect(evaluate(new Map([["gc:supervisionSubtotal", 1234.56]]))).toBe(1234.56);
  });

  it("applies multiply then add", () => {
    const binding: Binding = {
      targetNodeId: "line:row1:total",
      basis: "currency",
      definition: {
        kind: "lookup",
        source: "gc:grandTotal",
        transform: { multiply: 0.5, add: 10 },
      },
    };
    const { evaluate } = compileBinding(binding, NO_LINES);
    // 200 * 0.5 + 10 = 110
    expect(evaluate(new Map([["gc:grandTotal", 200]]))).toBe(110);
  });

  it("defaults multiply to 1 and add to 0 when transform fields are omitted", () => {
    const onlyMultiply = compileBinding(
      {
        targetNodeId: "t",
        basis: "currency",
        definition: { kind: "lookup", source: "s", transform: { multiply: 3 } },
      },
      NO_LINES
    );
    expect(onlyMultiply.evaluate(new Map([["s", 7]]))).toBe(21);

    const onlyAdd = compileBinding(
      {
        targetNodeId: "t",
        basis: "currency",
        definition: { kind: "lookup", source: "s", transform: { add: 5 } },
      },
      NO_LINES
    );
    expect(onlyAdd.evaluate(new Map([["s", 7]]))).toBe(12);
  });

  it("treats a missing source value as 0", () => {
    const { evaluate } = compileBinding(
      { targetNodeId: "t", basis: "currency", definition: { kind: "lookup", source: "s" } },
      NO_LINES
    );
    expect(evaluate(new Map())).toBe(0);
  });
});

describe("compileBinding — rollup", () => {
  const lines = [
    bindingLine({ id: "a", itemId: "03-0000.001", total: 100, unitPrice: 10, matchedQty: 10 }),
    bindingLine({ id: "b", itemId: "03-1000.002", total: 250, unitPrice: 25, matchedQty: 10 }),
    bindingLine({ id: "c", itemId: "09-2100.001", total: 999, unitPrice: 99, matchedQty: 1 }),
  ];

  it("defaults the aggregated field to total", () => {
    expect(DEFAULT_ROLLUP_FIELD).toBe("total");
    const { inputs } = compileBinding(
      {
        targetNodeId: "summary:div03",
        basis: "currency",
        definition: { kind: "rollup", op: "sum", set: { field: "division", match: "equals", value: "03" } },
      },
      ctx(lines)
    );
    expect(inputs).toEqual(["line:a:total", "line:b:total"]);
  });

  it("sums the matched members' field values", () => {
    const { inputs, evaluate } = compileBinding(
      {
        targetNodeId: "summary:div03",
        basis: "currency",
        definition: { kind: "rollup", op: "sum", set: { field: "division", match: "equals", value: "03" } },
      },
      ctx(lines)
    );
    const values = new Map(inputs.map((id, i) => [id, [100, 250][i]] as const));
    expect(evaluate(values)).toBe(350);
  });

  it("counts matched members regardless of value", () => {
    const { evaluate } = compileBinding(
      {
        targetNodeId: "summary:div03count",
        basis: "each",
        definition: { kind: "rollup", op: "count", set: { field: "division", match: "equals", value: "03" } },
      },
      ctx(lines)
    );
    // count ignores input values entirely.
    expect(evaluate(new Map())).toBe(2);
  });

  it("computes avg/min/max over the matched members", () => {
    const base = { set: { field: "division", match: "equals", value: "03" } as const };
    const mk = (op: "avg" | "min" | "max") =>
      compileBinding(
        { targetNodeId: "t", basis: "currency", definition: { kind: "rollup", op, ...base } },
        ctx(lines)
      );
    const vals = new Map([
      ["line:a:total", 100],
      ["line:b:total", 250],
    ]);
    expect(mk("avg").evaluate(vals)).toBe(175);
    expect(mk("min").evaluate(vals)).toBe(100);
    expect(mk("max").evaluate(vals)).toBe(250);
  });

  it("aggregates a non-default field (unitPrice)", () => {
    const { inputs, evaluate } = compileBinding(
      {
        targetNodeId: "t",
        basis: "rate",
        definition: {
          kind: "rollup",
          op: "sum",
          field: "unitPrice",
          set: { field: "division", match: "equals", value: "03" },
        },
      },
      ctx(lines)
    );
    expect(inputs).toEqual(["line:a:unitPrice", "line:b:unitPrice"]);
    expect(evaluate(new Map([["line:a:unitPrice", 10], ["line:b:unitPrice", 25]]))).toBe(35);
  });

  it("returns 0 / empty for an empty member set", () => {
    const mk = (op: "sum" | "count" | "avg" | "min" | "max") =>
      compileBinding(
        {
          targetNodeId: "t",
          basis: "currency",
          definition: { kind: "rollup", op, set: { field: "division", match: "equals", value: "77" } },
        },
        ctx(lines)
      );
    expect(mk("sum").inputs).toEqual([]);
    expect(mk("sum").evaluate(new Map())).toBe(0);
    expect(mk("count").evaluate(new Map())).toBe(0);
    expect(mk("avg").evaluate(new Map())).toBe(0);
    expect(mk("min").evaluate(new Map())).toBe(0);
    expect(mk("max").evaluate(new Map())).toBe(0);
  });

  it("treats missing member values as 0 in sum", () => {
    const { inputs, evaluate } = compileBinding(
      {
        targetNodeId: "t",
        basis: "currency",
        definition: { kind: "rollup", op: "sum", set: { field: "division", match: "equals", value: "03" } },
      },
      ctx(lines)
    );
    expect(inputs).toEqual(["line:a:total", "line:b:total"]);
    // Only one of the two member values supplied; the other defaults to 0.
    expect(evaluate(new Map([["line:a:total", 100]]))).toBe(100);
  });
});

describe("compileBinding — kind gate (LD-4)", () => {
  it("rejects an unknown binding kind (open enum, single gate)", () => {
    const rogue = {
      targetNodeId: "t",
      basis: "currency",
      definition: { kind: "expression", formula: "A1*B2" },
    } as unknown as Binding;
    expect(() => compileBinding(rogue, NO_LINES)).toThrow(BindingCompileError);
    expect(() => compileBinding(rogue, NO_LINES)).toThrow(/Unknown binding kind: expression/);
  });
});

describe("compileBindingToNode", () => {
  it("assembles a GraphNode carrying id, basis, inputs, and evaluate", () => {
    const node = compileBindingToNode(
      {
        targetNodeId: "line:row1:total",
        basis: "currency",
        definition: { kind: "lookup", source: "gc:supervisionSubtotal", transform: { multiply: 2 } },
      },
      NO_LINES
    );
    expect(node.id).toBe("line:row1:total");
    expect(node.basis).toBe("currency");
    expect(node.inputs).toEqual(["gc:supervisionSubtotal"]);
    expect(node.evaluate(new Map([["gc:supervisionSubtotal", 50]]))).toBe(100);
  });
});
