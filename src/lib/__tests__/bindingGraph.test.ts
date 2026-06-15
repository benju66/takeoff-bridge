import { describe, it, expect } from "vitest";
import {
  buildGraph,
  topologicalSort,
  findCycle,
  evaluateGraph,
  GraphError,
  GraphCycleError,
} from "../bindings/graph";
import type { GraphNode } from "../bindings/types";

/** A leaf node holding a constant value (no inputs). */
function constNode(id: string, value: number): GraphNode {
  return { id, basis: "currency", inputs: [], evaluate: () => value };
}

/** A node that sums its declared inputs (missing inputs default to 0). */
function sumNode(id: string, inputs: string[]): GraphNode {
  return {
    id,
    basis: "currency",
    inputs,
    evaluate: (vals) => inputs.reduce((acc, i) => acc + (vals.get(i) ?? 0), 0),
  };
}

describe("buildGraph", () => {
  it("indexes nodes by id", () => {
    const g = buildGraph([constNode("a", 1), constNode("b", 2)]);
    expect(g.nodes.size).toBe(2);
    expect(g.nodes.get("a")?.evaluate(new Map())).toBe(1);
  });

  it("rejects duplicate node ids", () => {
    expect(() => buildGraph([constNode("a", 1), constNode("a", 2)])).toThrow(GraphError);
  });
});

describe("topologicalSort", () => {
  it("orders every node after the inputs it reads", () => {
    // c <- b <- a ; d <- a
    const order = topologicalSort(
      buildGraph([sumNode("c", ["b"]), sumNode("b", ["a"]), constNode("a", 1), sumNode("d", ["a"])])
    );
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("d"));
  });

  it("ignores inputs that reference IDs absent from the graph (external leaves)", () => {
    const order = topologicalSort(buildGraph([sumNode("b", ["a", "external"]), constNode("a", 1)]));
    expect(order).toContain("a");
    expect(order).toContain("b");
    expect(order).not.toContain("external");
  });
});

describe("cycle detection", () => {
  it("rejects a self-reference", () => {
    const nodes = [sumNode("a", ["a"])];
    expect(() => topologicalSort(buildGraph(nodes))).toThrow(GraphCycleError);
    expect(findCycle(nodes)).toEqual(["a", "a"]);
  });

  it("rejects a two-hop cycle A -> B -> A", () => {
    const nodes = [sumNode("a", ["b"]), sumNode("b", ["a"])];
    expect(() => topologicalSort(buildGraph(nodes))).toThrow(GraphCycleError);
    const cycle = findCycle(nodes)!;
    expect(cycle[0]).toBe(cycle[cycle.length - 1]);
    expect(new Set(cycle)).toEqual(new Set(["a", "b"]));
  });

  it("rejects a multi-hop cycle A -> B -> C -> A and reports the path", () => {
    const nodes = [sumNode("A", ["B"]), sumNode("B", ["C"]), sumNode("C", ["A"])];
    let caught: GraphCycleError | null = null;
    try {
      topologicalSort(buildGraph(nodes));
    } catch (err) {
      caught = err as GraphCycleError;
    }
    expect(caught).toBeInstanceOf(GraphCycleError);
    // Path is closed (first === last) and covers all three nodes.
    expect(caught!.cycle[0]).toBe(caught!.cycle[caught!.cycle.length - 1]);
    expect(new Set(caught!.cycle)).toEqual(new Set(["A", "B", "C"]));
    expect(caught!.message).toContain("->");
  });

  it("findCycle returns null for an acyclic graph", () => {
    expect(findCycle([sumNode("b", ["a"]), constNode("a", 1)])).toBeNull();
  });

  it("evaluateGraph throws on a cycle", () => {
    expect(() => evaluateGraph([sumNode("a", ["b"]), sumNode("b", ["a"])])).toThrow(GraphCycleError);
  });
});

describe("evaluateGraph", () => {
  it("evaluates a dependency chain in order", () => {
    // a = 10 ; b = a + 5(const) ; c = b + a
    const values = evaluateGraph([
      constNode("a", 10),
      constNode("five", 5),
      sumNode("b", ["a", "five"]),
      sumNode("c", ["b", "a"]),
    ]);
    expect(values.get("a")).toBe(10);
    expect(values.get("b")).toBe(15);
    expect(values.get("c")).toBe(25);
  });

  it("supplies a node only its present inputs (external ids absent from the map)", () => {
    // b reads 'a' (present) and 'ghost' (absent) -> ghost defaults to 0 in evaluate.
    const values = evaluateGraph([constNode("a", 7), sumNode("b", ["a", "ghost"])]);
    expect(values.get("b")).toBe(7);
  });

  it("returns an empty map for no nodes", () => {
    expect(evaluateGraph([]).size).toBe(0);
  });

  it("evaluates a diamond (shared dependency) exactly once each", () => {
    // d <- b,c ; b <- a ; c <- a ; a = 3
    const values = evaluateGraph([
      constNode("a", 3),
      sumNode("b", ["a"]),
      sumNode("c", ["a"]),
      sumNode("d", ["b", "c"]),
    ]);
    expect(values.get("d")).toBe(6);
  });
});
