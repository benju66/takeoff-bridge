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
// Canonical node-ID scheme (spec §2.2) — by-ID / by-query, never by cell position
// ---------------------------------------------------------------------------

/**
 * The canonical node-ID prefixes the kind-blind graph addresses values by. Each is a
 * stable identity (never a cell position) so a binding/edge survives row churn:
 *  - `gc:<name>`            — a STEP 2 General Conditions computed value (registry.ts).
 *  - `siteops:<section>`    — a STEP 3 Site-Ops section subtotal (`siteOpsSectionNodeId` below).
 *  - `line:<rowId>:<field>` — a STEP 4 line's aggregatable field (compile.ts).
 *  - `summary:<field>`      — a STEP 4 TakeoffSummary field (Bucket B; engineGraph.ts).
 *
 * Bucket B adds the `summary:*` family below; later tiers extend the scheme (e.g.
 * `division:<NN>:total`) without teaching the graph core any new kind (LD-B5).
 */

/**
 * The `TakeoffSummary` fields exposed as `summary:<field>` engine graph nodes (Bucket B,
 * Tier 1). Each node's value ECHOES `computeTakeoffSummary` — the descriptor never
 * re-derives the math (LD-B2). Declared here as a string union (not `keyof TakeoffSummary`)
 * so this leaf module stays free of app/calc-result imports; engineGraph.ts is the only
 * place that binds these IDs to the live summary.
 */
export type SummaryNodeField =
  | "takeoffSubtotal"
  | "linkedDivisionsTotal"
  | "subtotal"
  | "constructionContingency"
  | "designContingency"
  | "buildersRisk"
  | "specialInsurance"
  | "glInsurance"
  | "bond"
  | "fee"
  | "totalEstimatedCost"
  | "costPerSf"
  | "costPerUnit";

/** The `summary:` node-ID prefix. */
export const SUMMARY_NODE_PREFIX = "summary:";

/** Stable node ID for a TakeoffSummary field: `summary:<field>`. */
export function summaryNodeId(field: SummaryNodeField): string {
  return `${SUMMARY_NODE_PREFIX}${field}`;
}

// ---------------------------------------------------------------------------
// GC (STEP 2) node-ID scheme — the canonical `gc:*` IDs + the Bucket B Phase 3 tree
// ---------------------------------------------------------------------------

/**
 * The `gc:` node-ID prefix (a STEP 2 General Conditions computed value). Declared in
 * this leaf module so BOTH registry.ts (the source-node + linked-division path) and
 * engineGraph.ts (the Bucket B decomposition tier) reference one definition without a
 * `registry → engineGraph → registry` import cycle. registry.ts re-exports the three
 * canonical constants below for its existing import sites.
 */
export const GC_NODE_PREFIX = "gc:";

/** STEP 2 — personnel grand total (all GC lines). */
export const GC_GRAND_TOTAL_NODE_ID = "gc:grandTotal";
/** STEP 2 — Σ supervision staff lines (template "Total Supervision", I16). */
export const GC_SUPERVISION_NODE_ID = "gc:supervisionSubtotal";
/** STEP 2 — Design/PM/GCs (grand total − supervision; a DERIVED value, not a raw subtotal). */
export const GC_GENERAL_NODE_ID = "gc:general";

/**
 * The four GC cost groups whose leaf lines roll up into `gc:<group>Subtotal`
 * (Bucket B Phase 3). One per `PersonnelCalcResult` array: staff labour, operational
 * expenses, lump-sum equipment, and manual GC entries.
 */
export type GcSubtotalGroup = "staff" | "ops" | "equipment" | "manual";

/** Stable node ID for a GC group subtotal: `gc:<group>Subtotal`. */
export function gcSubtotalNodeId(group: GcSubtotalGroup): string {
  return `${GC_NODE_PREFIX}${group}Subtotal`;
}

/** The echo-able fields of one GC leaf line. Lump-sum equipment lines expose `total` only. */
export type GcLeafField = "total" | "qty" | "rate";

/**
 * Stable node ID for one GC leaf line's field: `gc:<group>:<code>:<field>`
 * (e.g. `gc:staff:01-0310.001:total`). The `code` is the line's template criterion
 * code — unique within its group — never a cell position (by-ID, not by-position).
 */
export function gcLeafNodeId(group: GcSubtotalGroup, code: string, field: GcLeafField): string {
  return `${GC_NODE_PREFIX}${group}:${code}:${field}`;
}

// ---------------------------------------------------------------------------
// Site-Ops (STEP 3) node-ID scheme — the canonical `siteops:*` IDs + the Phase 4 tree
// ---------------------------------------------------------------------------

/**
 * The `siteops:` node-ID prefix (a STEP 3 Site Operations computed value). Declared in
 * this leaf module — like the `gc:*` IDs above — so BOTH registry.ts (the source-node +
 * linked-division path) and engineGraph.ts (the Bucket B Phase 4 decomposition tier) can
 * build these IDs without a `registry → engineGraph → registry` import cycle. registry.ts
 * re-exports `siteOpsSectionNodeId` for its existing import sites.
 */
export const SITEOPS_NODE_PREFIX = "siteops:";

/** STEP 3 — Site Operations grand total (all dynamic + manual lines). */
export const SITEOPS_GRAND_TOTAL_NODE_ID = "siteops:grandTotal";

/**
 * Stable node ID for a STEP 3 Site-Ops template subtotal section: `siteops:<section>`
 * (e.g. `siteops:demolition`). The parameter is a plain `string` (not the
 * `SiteOpsSection` union from constants.ts) so this leaf module stays free of app
 * imports; the section ids are validated where they originate (the constants test).
 */
export function siteOpsSectionNodeId(section: string): string {
  return `${SITEOPS_NODE_PREFIX}${section}`;
}

/**
 * The two Site-Ops line groups whose leaf lines roll up into `siteops:<group>Subtotal`
 * (Bucket B Phase 4). One per `SiteOpsCalcResult` array: parameter-driven `dynamic` lines
 * and estimator-typed `manual` lines. Their sum is the engine's literal
 * `grandTotal = dynamicTotal + manualTotal` decomposition.
 */
export type SiteOpsLineGroup = "dynamic" | "manual";

/** Stable node ID for a Site-Ops group subtotal: `siteops:<group>Subtotal`. */
export function siteOpsSubtotalNodeId(group: SiteOpsLineGroup): string {
  return `${SITEOPS_NODE_PREFIX}${group}Subtotal`;
}

/** The echo-able fields of one Site-Ops leaf line. Every line carries qty + rate + total
 * (the engine sets qty/rate even for lump-sum entries — see engineGraph.ts). */
export type SiteOpsLeafField = "total" | "qty" | "rate";

/**
 * Stable node ID for one Site-Ops leaf line's field: `siteops:<group>:<code>:<field>`
 * (e.g. `siteops:manual:02-4100.001:total`). The `code` is the line's STEP 3 criterion
 * code — unique within its group — never a cell position (by-ID, not by-position). The
 * `<group>` segment keeps a code that appears in both arrays collision-free.
 */
export function siteOpsLeafNodeId(
  group: SiteOpsLineGroup,
  code: string,
  field: SiteOpsLeafField
): string {
  return `${SITEOPS_NODE_PREFIX}${group}:${code}:${field}`;
}

// ---------------------------------------------------------------------------
// Division (STEP 4) node-ID scheme — the Bucket B Phase 5 division rollup tier
// ---------------------------------------------------------------------------

/**
 * The `division:` node-ID prefix (a STEP 4 division rollup). Declared in this leaf module
 * — like the `gc:*` / `siteops:*` IDs above — so engineGraph.ts (the Bucket B Phase 5
 * division tier) and registry.ts (the `describeSourceNode` labeller) reference one
 * definition without an import cycle.
 */
export const DIVISION_NODE_PREFIX = "division:";

/**
 * Stable node ID for a STEP 4 division rollup total: `division:<NN>:total` (e.g.
 * `division:09:total`). The `<NN>` is the 2-digit CSI division from `getDivisionCode`
 * (src/lib/division.ts) — never a cell position. The Phase 5 `division` echo tier emits one
 * such node per present division; it ECHOES the Σ of its member lines' `line:<id>:total`
 * source nodes (REUSING those canonical ids as edges — no duplicate leaves).
 */
export function divisionTotalNodeId(code: string): string {
  return `${DIVISION_NODE_PREFIX}${code}:total`;
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

// ---------------------------------------------------------------------------
// Persistence shape (Phase 3) — the `estimate_bindings` row, reconstructed
// ---------------------------------------------------------------------------

/**
 * The JSONB payload stored in `estimate_bindings.definition`: the value's `basis`
 * plus the kind-specific `rule`. Kept distinct from the `target_node_id`/`kind`
 * columns (which are denormalized projections of this payload — `target_node_id` =
 * `Binding.targetNodeId`, `kind` = `rule.kind` — so the UNIQUE key and the
 * open-enum-at-the-column-level have dedicated columns while the DB stays blind to
 * binding kind). db.ts is the single writer and derives the columns from one
 * {@link Binding}, so they cannot drift.
 */
export interface StoredBindingDefinition {
  basis: Basis;
  rule: BindingDefinition;
}

/**
 * One persisted `estimate_bindings` row, reconstructed by the db gateway into a full
 * {@link Binding} (targetNodeId + basis + definition) plus audit metadata. MUTABLE —
 * unlike the append-only override record, a binding is edited in place or cleared
 * (LD-3). Stored binding VALUES are never persisted/trusted; they are recomputed from
 * source on load (the row carries only the rule, never a cached result).
 */
export interface EstimateBindingRecord {
  /** Present on rows read back from the DB; omit when constructing a new binding. */
  id?: string;
  projectId: string;
  /** The authored binding (targetNodeId + basis + definition), reconstructed from the row. */
  binding: Binding;
  /** auth.uid() of who saved it; null if that user was later removed. */
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}
