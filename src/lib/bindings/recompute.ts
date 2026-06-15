/**
 * Linked Values System — recompute-on-load (Phase 3).
 *
 * Composes the kind-aware compiler (compile.ts) with the kind-blind graph engine
 * (graph.ts) to recompute PERSISTED bindings FROM SOURCE. This is the load-side half
 * of the persistence story: a stored binding's value is NEVER trusted — on load each
 * binding is recompiled onto the live source-node graph and re-evaluated in dependency
 * order (spec §2.7), matching the app's "stored derived values are cache" philosophy.
 *
 * KIND-BLIND at this layer too: it only knows `Binding`/`GraphNode`/`BindingLine` and
 * delegates all kind knowledge to `compileBindingToNode`. A future binding kind flows
 * through here unchanged (LD-4).
 */

import { compileBindingToNode } from "./compile";
import { evaluateGraph } from "./graph";
import type { Binding, BindingLine, GraphNode } from "./types";

/**
 * Recomputes every persisted binding from source. Each binding is compiled against the
 * current line set (for rollup membership) and evaluated together with the supplied
 * source nodes, in topological order. Returns target node id → recomputed value.
 *
 * INERT when `bindings` is empty: the result is exactly the source-node values, so a
 * project with NO persisted bindings recomputes identically to before (the export
 * goldens tie $0.00). Throws {@link GraphCycleError} if the bindings introduce a cycle.
 *
 * Note: a binding whose inputs reference node IDs not present among `sourceNodes` reads
 * them as external/absent (lookup → 0, rollup → over present members only) — the graph
 * orders only among the nodes it is given (see graph.ts buildGraph/topologicalSort).
 */
export function recomputeBindingValues(
  bindings: readonly Binding[],
  sourceNodes: readonly GraphNode[],
  lines: readonly BindingLine[]
): Map<string, number> {
  const ctx = { lines: [...lines] };
  const bindingNodes = bindings.map((b) => compileBindingToNode(b, ctx));
  return evaluateGraph([...sourceNodes, ...bindingNodes]);
}
