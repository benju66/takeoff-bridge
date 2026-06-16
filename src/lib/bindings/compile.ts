/**
 * Linked Values System — binding compiler (Phase 1).
 *
 * This is the ONE module allowed to know binding kinds (LD-4). It turns a stored
 * `Binding` into the graph-ready `{ inputs, evaluate }` pair the kind-blind graph
 * (graph.ts) consumes. Adding a future kind (e.g. `'expression'` → HyperFormula)
 * means adding ONE case here and ZERO changes to the graph core.
 *
 * Everything kind-aware is enforced here: the `switch (kind)` has a single gate
 * whose `default` rejects unknown kinds (the OPEN enum, arriving from free-text
 * storage), and operations are CAPPED to the enumerated sets.
 */

import { selectLines } from "./setRule";
import type {
  Binding,
  CompileContext,
  CompiledBinding,
  GraphNode,
  LookupDefinition,
  RollupDefinition,
  RollupField,
} from "./types";

/** Thrown when a binding cannot be compiled (unknown kind, op, or field). */
export class BindingCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BindingCompileError";
  }
}

/** The rollup field aggregated when a rollup definition omits `field`. */
export const DEFAULT_ROLLUP_FIELD: RollupField = "total";

/**
 * The stable node ID for a line's numeric field — the by-ID address a rollup
 * depends on. Mirrors the node-ID scheme in spec §2.2 (`line:<rowId>:<field>`).
 */
export function lineFieldNodeId(lineId: string, field: RollupField): string {
  return `line:${lineId}:${field}`;
}

/**
 * Compiles a binding into `{ inputs, evaluate }`. The SOLE `switch (kind)` site;
 * its `default` rejects any kind the v1 compiler does not implement.
 */
export function compileBinding(binding: Binding, ctx: CompileContext): CompiledBinding {
  const def = binding.definition;
  switch (def.kind) {
    case "lookup":
      return compileLookup(def);
    case "rollup":
      return compileRollup(def, ctx);
    default:
      throw new BindingCompileError(
        `Unknown binding kind: ${String((def as { kind?: unknown }).kind ?? "(none)")}`
      );
  }
}

/** Convenience: compile a binding and assemble the full {@link GraphNode}. */
export function compileBindingToNode(binding: Binding, ctx: CompileContext): GraphNode {
  const { inputs, evaluate } = compileBinding(binding, ctx);
  return { id: binding.targetNodeId, basis: binding.basis, inputs, evaluate };
}

// ---------------------------------------------------------------------------
// lookup — mirror one source node, optional ×multiply +add (multiply then add)
// ---------------------------------------------------------------------------

function compileLookup(def: LookupDefinition): CompiledBinding {
  const source = def.source;
  const multiply = def.transform?.multiply ?? 1;
  const add = def.transform?.add ?? 0;
  return {
    inputs: [source],
    evaluate: (inputs) => (inputs.get(source) ?? 0) * multiply + add,
  };
}

// ---------------------------------------------------------------------------
// rollup — op over a line field across the SetRule-matched members
// ---------------------------------------------------------------------------

function compileRollup(def: RollupDefinition, ctx: CompileContext): CompiledBinding {
  const field = def.field ?? DEFAULT_ROLLUP_FIELD;
  const op = def.op;
  // Membership is derived now from the current line set. Each member contributes a
  // by-ID dependency on its field node, so the graph orders the rollup after them
  // and a rollup that includes its own target is caught as a cycle (conservative).
  const matched = selectLines(ctx.lines, def.set);
  const inputs = matched.map((line) => lineFieldNodeId(line.id, field));
  const memberCount = matched.length;

  return {
    inputs,
    evaluate: (inputValues) => {
      const values = inputs.map((id) => inputValues.get(id) ?? 0);
      switch (op) {
        case "sum":
          return values.reduce((a, b) => a + b, 0);
        case "count":
          return memberCount;
        case "avg":
          return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        case "min":
          return values.length ? Math.min(...values) : 0;
        case "max":
          return values.length ? Math.max(...values) : 0;
        default:
          throw new BindingCompileError(`Unknown rollup op: ${String(op)}`);
      }
    },
  };
}
