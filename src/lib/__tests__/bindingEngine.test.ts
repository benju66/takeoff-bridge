/**
 * End-to-end proof for Phase 1 (the smallest shippable slice): a binding referenced
 * BY ID flows compile -> graph -> evaluate, reproducing values via the same pattern
 * the app already trusts for the 10 hardcoded linked-division rows — with zero DB,
 * zero UI, and zero golden movement. Cycle rejection is proven through the binding
 * path too (self-reference and multi-hop). The exact reproduction of
 * computeLinkedDivisionTotals is Phase 2's deliverable, not this one.
 */
import { describe, it, expect } from "vitest";
import { compileBindingToNode } from "../bindings/compile";
import { evaluateGraph, findCycle } from "../bindings/graph";
import type { Binding, BindingLine, GraphNode } from "../bindings/types";

/** A constant source node (stands in for a STEP 2/3 computed value or a saved line field). */
function source(id: string, value: number): GraphNode {
  return { id, basis: "currency", inputs: [], evaluate: () => value };
}

describe("binding engine — lookup by ID end to end", () => {
  it("mirrors a STEP 2/3 source value into a linked STEP 4 row (the bridge pattern)", () => {
    // Source: the GC supervision subtotal, as the registry would expose it (Phase 2).
    const gcSupervision = source("gc:supervisionSubtotal", 48250.75);

    // Binding: the linked Supervision division row pulls from that source by ID.
    const binding: Binding = {
      targetNodeId: "line:linked-supervision:total",
      basis: "currency",
      definition: { kind: "lookup", source: "gc:supervisionSubtotal" },
    };

    const values = evaluateGraph([gcSupervision, compileBindingToNode(binding, { lines: [] })]);
    expect(values.get("line:linked-supervision:total")).toBe(48250.75);
  });

  it("applies a capped ×/+ transform end to end", () => {
    const node = compileBindingToNode(
      {
        targetNodeId: "line:scaled:total",
        basis: "currency",
        definition: { kind: "lookup", source: "siteops:demolition", transform: { multiply: 1.1 } },
      },
      { lines: [] }
    );
    const values = evaluateGraph([source("siteops:demolition", 1000), node]);
    expect(values.get("line:scaled:total")).toBeCloseTo(1100, 6);
  });
});

describe("binding engine — rollup by predicate end to end", () => {
  const lines: BindingLine[] = [
    { id: "a", itemId: "03-0000.001", costType: "L", source: "template", procoreCode: "3-33543.000", total: 100, unitPrice: 10, matchedQty: 10 },
    { id: "b", itemId: "03-1000.002", costType: "M", source: "manual", procoreCode: "3-33000.000", total: 250, unitPrice: 25, matchedQty: 10 },
    { id: "c", itemId: "09-2100.001", costType: "L", source: "template", procoreCode: "9-90000.000", total: 999, unitPrice: 99, matchedQty: 1 },
  ];

  it("sums a division's line totals through the graph", () => {
    const rollup = compileBindingToNode(
      {
        targetNodeId: "summary:division03",
        basis: "currency",
        definition: { kind: "rollup", op: "sum", set: { field: "division", match: "equals", value: "03" } },
      },
      { lines }
    );
    // The line field nodes are the graph's source constants (Phase 2's registry job).
    const lineNodes = lines.map((l) => source(`line:${l.id}:total`, l.total));
    const values = evaluateGraph([...lineNodes, rollup]);
    expect(values.get("summary:division03")).toBe(350);
  });
});

describe("binding engine — cycle rejection through the binding path", () => {
  it("rejects a lookup that references its own target (self-cycle)", () => {
    const node = compileBindingToNode(
      {
        targetNodeId: "line:a:total",
        basis: "currency",
        definition: { kind: "lookup", source: "line:a:total" },
      },
      { lines: [] }
    );
    expect(findCycle([node])).toEqual(["line:a:total", "line:a:total"]);
    expect(() => evaluateGraph([node])).toThrow();
  });

  it("rejects a rollup whose membership includes its own target", () => {
    // The rollup targets line a's total while summing division 03, of which a is a member.
    const lines: BindingLine[] = [
      { id: "a", itemId: "03-0000.001", costType: "L", source: "template", procoreCode: "3-33543.000", total: 100, unitPrice: 10, matchedQty: 10 },
      { id: "b", itemId: "03-1000.002", costType: "L", source: "template", procoreCode: "3-33000.000", total: 250, unitPrice: 25, matchedQty: 10 },
    ];
    const rollup = compileBindingToNode(
      {
        targetNodeId: "line:a:total",
        basis: "currency",
        definition: { kind: "rollup", op: "sum", set: { field: "division", match: "equals", value: "03" } },
      },
      { lines }
    );
    const cycle = findCycle([rollup, source("line:b:total", 250)]);
    expect(cycle).not.toBeNull();
    expect(cycle).toContain("line:a:total");
  });

  it("rejects a multi-hop cycle expressed as chained lookups", () => {
    const mk = (target: string, src: string): GraphNode =>
      compileBindingToNode(
        { targetNodeId: target, basis: "currency", definition: { kind: "lookup", source: src } },
        { lines: [] }
      );
    // A -> B -> C -> A
    const nodes = [mk("A", "B"), mk("B", "C"), mk("C", "A")];
    const cycle = findCycle(nodes)!;
    expect(cycle[0]).toBe(cycle[cycle.length - 1]);
    expect(new Set(cycle)).toEqual(new Set(["A", "B", "C"]));
  });
});
