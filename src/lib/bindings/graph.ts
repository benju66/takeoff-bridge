/**
 * Linked Values System — dependency graph engine (Phase 1).
 *
 * KIND-BLIND by design (LD-4): this module knows ONLY each node's `inputs` (the
 * node IDs it reads) and its `evaluate(inputs)` function. It MUST NOT import the
 * compiler or switch on binding kind — that is what lets a future binding kind be
 * added without touching this core.
 *
 * Pipeline: build graph → topological sort → conservative cycle detection (reject
 * cycles) → evaluate in dependency order. Cycle detection is correctness-first and
 * conservative; incremental/robust diagnostics are deferred (Future Phase 6).
 */

import type { GraphNode } from "./types";

/** A validated graph: a map of node id → node, with unique ids. */
export interface Graph {
  nodes: Map<string, GraphNode>;
}

/** Thrown for structurally invalid graphs (e.g. duplicate node ids). */
export class GraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphError";
  }
}

/**
 * Thrown when the graph contains a dependency cycle. `cycle` is the offending path,
 * e.g. `["A", "B", "C", "A"]`, ready for a clear authoring-time message (Phase 5).
 */
export class GraphCycleError extends Error {
  readonly cycle: string[];
  constructor(cycle: string[]) {
    super(`Dependency cycle detected: ${cycle.join(" -> ")}`);
    this.name = "GraphCycleError";
    this.cycle = cycle;
  }
}

/**
 * Builds a graph from nodes, rejecting duplicate ids. Inputs referencing IDs that
 * are not present as nodes are treated as external/leaf values (no edge): the graph
 * only orders among the nodes it is given.
 */
export function buildGraph(nodes: GraphNode[]): Graph {
  const map = new Map<string, GraphNode>();
  for (const node of nodes) {
    if (map.has(node.id)) {
      throw new GraphError(`Duplicate node id: ${node.id}`);
    }
    map.set(node.id, node);
  }
  return { nodes: map };
}

// DFS visit colors.
const UNVISITED = 0;
const VISITING = 1;
const DONE = 2;

/**
 * Topologically sorts a graph so every node follows the inputs it reads. Throws
 * {@link GraphCycleError} (with the offending path) on the first cycle found.
 * Edges to IDs absent from the graph are ignored (external/leaf values).
 */
export function topologicalSort(graph: Graph): string[] {
  const { nodes } = graph;
  const state = new Map<string, number>();
  const order: string[] = [];
  const path: string[] = [];

  const visit = (id: string): void => {
    const color = state.get(id) ?? UNVISITED;
    if (color === DONE) return;
    if (color === VISITING) {
      // Re-entered a node still on the current DFS path → cycle.
      const start = path.indexOf(id);
      throw new GraphCycleError(path.slice(start).concat(id));
    }
    state.set(id, VISITING);
    path.push(id);
    const node = nodes.get(id);
    if (node) {
      for (const dep of node.inputs) {
        if (nodes.has(dep)) visit(dep);
      }
    }
    path.pop();
    state.set(id, DONE);
    order.push(id);
  };

  for (const id of nodes.keys()) visit(id);
  return order;
}

/**
 * Conservative cycle check that does NOT throw — returns the offending path (e.g.
 * `["A", "B", "C", "A"]`) or `null` if the graph is acyclic. Intended for the
 * authoring-time guard (Phase 5): test the proposed edges, reject on a cycle.
 */
export function findCycle(nodes: GraphNode[]): string[] | null {
  try {
    topologicalSort(buildGraph(nodes));
    return null;
  } catch (err) {
    if (err instanceof GraphCycleError) return err.cycle;
    throw err;
  }
}

/**
 * Evaluates every node in dependency order, returning each node's value by id.
 * Each node's `evaluate` receives only its present inputs' values (missing/external
 * inputs are simply absent from the map — the evaluate function decides the
 * default). Throws {@link GraphCycleError} on a cycle.
 */
export function evaluateGraph(nodes: GraphNode[]): Map<string, number> {
  const graph = buildGraph(nodes);
  const order = topologicalSort(graph);
  const values = new Map<string, number>();
  for (const id of order) {
    const node = graph.nodes.get(id)!;
    const inputValues = new Map<string, number>();
    for (const dep of node.inputs) {
      if (values.has(dep)) inputValues.set(dep, values.get(dep)!);
    }
    values.set(id, node.evaluate(inputValues));
  }
  return values;
}
