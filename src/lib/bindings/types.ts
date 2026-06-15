/**
 * Linked Values System — core binding types (Phase 1).
 *
 * The binding model is an OPEN system (see docs/plans/2026-06-15-linked-values-system.md §2):
 *  - `BindingKind` is an OPEN enum (widenable to any string).
 *  - The dependency graph (graph.ts) is INDIFFERENT to kind — it knows only each
 *    node's input IDs and its `evaluate(inputs)` function.
 *  - ALL kind-specific knowledge is isolated in the binding compiler (compile.ts).
 *
 * v1 ships two kinds: `lookup` and `rollup`. A future `expression` kind (HyperFormula)
 * arrives as ONE more compiler case with ZERO graph-core changes — that is the
 * load-bearing architectural constraint (LD-4) this file is shaped to preserve.
 */

// ---------------------------------------------------------------------------
// Binding kind — the OPEN enum
// ---------------------------------------------------------------------------

/** The binding kinds the v1 compiler understands. */
export type KnownBindingKind = "lookup" | "rollup";

/**
 * OPEN binding-kind enum. Widenable to any string so future kinds (e.g.
 * `'expression'`) round-trip through free-text storage and the kind-blind graph
 * with ZERO core changes; only `compileBinding` (compile.ts) narrows/validates it.
 * The `string & {}` member keeps literal autocomplete for the known kinds while
 * leaving the type open.
 */
export type BindingKind = KnownBindingKind | (string & {});

// ---------------------------------------------------------------------------
// Basis — the unit/dimension of a node's value (spec §2.5)
// ---------------------------------------------------------------------------

/**
 * The unit/dimension a node's value is measured in, so (a) a rollup never sums
 * dimensionally incompatible lines and (b) a scalar transform stays meaningful.
 * v1 set; the field and its check are reserved from day one but v1 enforcement is
 * intentionally minimal (widening the rules is future work, not a migration).
 */
export type Basis = "currency" | "quantity" | "rate" | "percent" | "each";

// ---------------------------------------------------------------------------
// Set rules — rollup membership predicate (spec §2.4)
// ---------------------------------------------------------------------------

/** Line attribute a SetRule leaf may test. The grammar is capped to this set. */
export type SetRuleField =
  | "itemId"
  | "division"
  | "baseCode"
  | "suffix"
  | "costType"
  | "source"
  | "procoreCode";

/** Comparison a SetRule leaf may apply. Capped grammar. */
export type SetRuleMatch = "equals" | "startsWith" | "in";

/**
 * A single predicate over one line attribute. `equals`/`startsWith` take a string
 * `value`; `in` takes a `string[]`. The evaluator (setRule.ts) enforces the shape.
 */
export interface SetRuleLeaf {
  field: SetRuleField;
  match: SetRuleMatch;
  value: string | string[];
}

/** Conjunction — a line matches when every sub-rule matches (empty = vacuously true). */
export interface SetRuleAll {
  all: SetRule[];
}

/** Disjunction — a line matches when any sub-rule matches (empty = vacuously false). */
export interface SetRuleAny {
  any: SetRule[];
}

/**
 * Hand-picked membership by line id. SUPPORTED but DISCOURAGED — it is the only
 * form vulnerable to row-id churn. Rule-based leaves reference no specific id and
 * are immune, which is why they are the default.
 */
export interface SetRuleExplicit {
  explicitIds: string[];
}

/** A rollup membership predicate over line attributes only. */
export type SetRule = SetRuleLeaf | SetRuleAll | SetRuleAny | SetRuleExplicit;

// ---------------------------------------------------------------------------
// Binding definitions — the kind-specific rule (the stored `definition` JSONB)
// ---------------------------------------------------------------------------

/** Scalar transform applied to a lookup's source value: `source × multiply + add`. */
export interface LookupTransform {
  /** Defaults to 1 when absent. */
  multiply?: number;
  /** Defaults to 0 when absent. */
  add?: number;
}

/**
 * Reference binding: mirror one source node, with an optional `×multiply +add`
 * transform (multiply then add). The transform is CAPPED to multiply + add only.
 */
export interface LookupDefinition {
  kind: "lookup";
  /** Node ID this binding mirrors (by ID — never by cell position). */
  source: string;
  transform?: LookupTransform;
}

/** Capped rollup aggregation operators. The cap is the feature — nothing else compiles. */
export type RollupOp = "sum" | "count" | "avg" | "min" | "max";

/** Numeric line field a rollup aggregates. Defaults to `total`. */
export type RollupField = "total" | "unitPrice" | "matchedQty";

/**
 * Aggregation binding: `op` over `field` (default `total`) of the lines matched by
 * `set`. References are by predicate (the SetRule) — never by cell range.
 */
export interface RollupDefinition {
  kind: "rollup";
  op: RollupOp;
  set: SetRule;
  field?: RollupField;
}

/**
 * The kind-specific rule of a binding (stored as the `definition` JSONB). A
 * discriminated union on `kind`; widens by ADDING a member (e.g. an
 * `ExpressionDefinition`) — never by teaching the graph a new kind.
 */
export type BindingDefinition = LookupDefinition | RollupDefinition;

/**
 * A complete binding: which node it computes, the unit/dimension of its value, and
 * the kind-specific rule. `definition.kind` is the OPEN binding kind.
 */
export interface Binding {
  /** Node this binding computes, by stable ID (e.g. `line:<uuid>:total`, `summary:subtotal`). */
  targetNodeId: string;
  /** Unit/dimension of the produced value (see Basis). */
  basis: Basis;
  /** Kind-specific rule. */
  definition: BindingDefinition;
}

// ---------------------------------------------------------------------------
// Graph node — the ONLY shape the kind-blind graph engine understands (spec §2.1)
// ---------------------------------------------------------------------------

/**
 * A node in the dependency graph. The graph core knows ONLY these fields; it never
 * inspects how `evaluate` was produced (lookup vs rollup vs future expression).
 */
export interface GraphNode {
  /** Stable id, by-ID never by-position. */
  id: string;
  /** Unit/dimension of this node's value. */
  basis: Basis;
  /** Node IDs this node reads. */
  inputs: string[];
  /** Pure: produces this node's value from its input values. */
  evaluate: (inputs: Map<string, number>) => number;
}

/** The compiler's output for a binding: the graph-ready half of a {@link GraphNode}. */
export interface CompiledBinding {
  inputs: string[];
  evaluate: (inputs: Map<string, number>) => number;
}

// ---------------------------------------------------------------------------
// Compile context — the line attributes a rollup reads to resolve membership
// ---------------------------------------------------------------------------

/**
 * The minimal line attributes the binding compiler and SetRule evaluator read.
 * A projection of `ProcessedTakeoffRow` (id + the SetRule-addressable attributes +
 * the aggregatable numeric fields), so the bindings layer never depends on the full
 * row type.
 */
export interface BindingLine {
  id: string;
  itemId: string;
  costType: string;
  source: string;
  procoreCode: string;
  total: number;
  unitPrice: number;
  matchedQty: number;
}

/** Context handed to `compileBinding`: the candidate lines a rollup may aggregate over. */
export interface CompileContext {
  lines: BindingLine[];
}
