/**
 * Linked Values System — authoring helpers (Phase 5).
 *
 * The PRODUCER side of the binding model: pure functions the "Define link…" panel uses
 * to turn estimator choices into a `Binding`, enumerate the source nodes a lookup may
 * reference, validate a draft, surface the conservative cycle guard (graph.ts findCycle)
 * at authoring time, and preview the value live before saving.
 *
 * Kind knowledge here is PRODUCER-side — you cannot author a lookup vs a rollup without
 * naming the kind — and it never leaks into the graph CORE (LD-4): graph.ts and the
 * compiler-composed recompute stay kind-blind; this module only emits `Binding` data and
 * routes it through the existing SET_BINDING / CLEAR_BINDING command path. It does NOT
 * import the Supabase client or write anything — it is decision logic only (the panel is
 * the I/O shell, mirroring overrideSetter.ts / assignCode.ts).
 */

import { evaluateGraph, findCycle } from "./graph";
import { lineFieldNodeId } from "./compile";
import { selectLines } from "./setRule";
import { upsertBinding } from "./store";
import {
  assembleBindingGraphNodes,
  projectLine,
  GC_GRAND_TOTAL_NODE_ID,
  GC_SUPERVISION_NODE_ID,
  GC_GENERAL_NODE_ID,
  GC_NODE_LABELS,
  siteOpsSectionNodeId,
} from "./registry";
import { SITE_OPS_SECTIONS, isLinkedDivisionRow } from "../constants";
import type { PersonnelCalcResult, SiteOpsCalcResult } from "../calculations";
import type { ProcessedTakeoffRow } from "@/types";
import type {
  Binding,
  LookupTransform,
  RollupField,
  RollupOp,
  SetRule,
  SetRuleField,
  SetRuleLeaf,
  SetRuleMatch,
} from "./types";

// ---------------------------------------------------------------------------
// Bindable-row gate (the §6 row-id-stability decision, shared with the workbook)
// ---------------------------------------------------------------------------

/**
 * Volatile CSV-parser ids are `row-<index>` (unstable across re-parse). Template
 * (`row-<itemId>`), manual (uuid), and saved (uuid) rows are stable. A by-id binding
 * (lookup source/target, or `explicitIds`) requires a stable id — rule-based rollups,
 * which reference no specific id, are immune and stay authorable everywhere.
 */
export function isStableBindingRowId(id: string): boolean {
  return !/^row-\d+$/.test(id);
}

/** A bindable target/source: a plain (non-linked-division) row with a stable id. */
export function isBindableRow(row: ProcessedTakeoffRow): boolean {
  return !isLinkedDivisionRow(row.itemId) && isStableBindingRowId(row.id);
}

// ---------------------------------------------------------------------------
// Lookup source picker — the nodes a lookup may reference (the §2.2 ceiling)
// ---------------------------------------------------------------------------

export type SourceGroup =
  | "General Conditions (STEP 2)"
  | "Site Operations (STEP 3)"
  | "Estimate lines";

export interface SourceOption {
  /** Stable node id (e.g. `gc:supervisionSubtotal`, `line:<rowId>:total`). */
  id: string;
  /** Friendly label for the dropdown. */
  label: string;
  /** Optgroup the option belongs to. */
  group: SourceGroup;
}

/**
 * The source nodes a lookup may mirror, grouped for the picker. Exactly the nodes the
 * engine's `userBindingSourceNodes` builds (the addressability ceiling, §2.2): the 3 GC
 * computed values, every Site-Ops section, and every other bindable line's total. The
 * authored target row is excluded so a lookup can never trivially mirror itself.
 */
export function listLookupSourceOptions(
  rows: readonly ProcessedTakeoffRow[],
  targetRowId: string
): SourceOption[] {
  const gc: SourceOption[] = [
    GC_GRAND_TOTAL_NODE_ID,
    GC_SUPERVISION_NODE_ID,
    GC_GENERAL_NODE_ID,
  ].map((id) => ({ id, label: GC_NODE_LABELS[id] ?? id, group: "General Conditions (STEP 2)" }));

  const siteops: SourceOption[] = SITE_OPS_SECTIONS.map((s) => ({
    id: siteOpsSectionNodeId(s.id),
    label: s.label,
    group: "Site Operations (STEP 3)",
  }));

  const lines: SourceOption[] = rows
    .filter((r) => isBindableRow(r) && r.id !== targetRowId)
    .map((r) => ({
      id: lineFieldNodeId(r.id, "total"),
      label: `${r.itemId || "(no code)"}${r.description ? ` · ${r.description}` : ""}`,
      group: "Estimate lines",
    }));

  return [...gc, ...siteops, ...lines];
}

// ---------------------------------------------------------------------------
// Builders — estimator choices → a `Binding` (always targets line:<rowId>:total)
// ---------------------------------------------------------------------------

/** Drop an identity transform (×1 +0) so a plain mirror stores no transform clutter. */
function normalizeTransform(t: LookupTransform | undefined): LookupTransform | undefined {
  const multiply = t?.multiply ?? 1;
  const add = t?.add ?? 0;
  if (multiply === 1 && add === 0) return undefined;
  const out: LookupTransform = {};
  if (multiply !== 1) out.multiply = multiply;
  if (add !== 0) out.add = add;
  return out;
}

/** Build a lookup binding on `targetRowId`'s total, mirroring `source` (× then +). */
export function buildLookupBinding(
  targetRowId: string,
  source: string,
  transform?: LookupTransform
): Binding {
  const t = normalizeTransform(transform);
  return {
    targetNodeId: lineFieldNodeId(targetRowId, "total"),
    basis: "currency",
    definition: t ? { kind: "lookup", source, transform: t } : { kind: "lookup", source },
  };
}

/** Build a rollup binding on `targetRowId`'s total (`field` defaults to `total`). */
export function buildRollupBinding(
  targetRowId: string,
  op: RollupOp,
  set: SetRule,
  field: RollupField = "total"
): Binding {
  return {
    targetNodeId: lineFieldNodeId(targetRowId, "total"),
    basis: "currency",
    definition:
      field === "total"
        ? { kind: "rollup", op, set }
        : { kind: "rollup", op, set, field },
  };
}

// ---------------------------------------------------------------------------
// Set-rule builder — leaves → a SetRule (rule-based default; explicitIds discouraged)
// ---------------------------------------------------------------------------

export type SetCombinator = "all" | "any";

/** One row of the rule builder. `value` is raw text; for `in` it is comma-separated. */
export interface LeafDraft {
  field: SetRuleField;
  match: SetRuleMatch;
  value: string;
}

/** Parse a leaf draft into a {@link SetRuleLeaf} (splitting `in` into a trimmed list). */
export function leafFromDraft(draft: LeafDraft): SetRuleLeaf {
  if (draft.match === "in") {
    const value = draft.value.split(",").map((s) => s.trim()).filter(Boolean);
    return { field: draft.field, match: "in", value };
  }
  return { field: draft.field, match: draft.match, value: draft.value.trim() };
}

/**
 * Combine leaves into a SetRule. A lone leaf needs no `all`/`any` wrapper; multiple
 * leaves combine under the chosen combinator. Membership stays DERIVED (recomputed
 * whenever the line set changes) — rule-based rollups never go stale on row-id churn.
 */
export function setRuleFromLeaves(combinator: SetCombinator, leaves: LeafDraft[]): SetRule {
  const parsed = leaves.map(leafFromDraft);
  if (parsed.length === 1) return parsed[0];
  return combinator === "all" ? { all: parsed } : { any: parsed };
}

/** Hand-picked membership (SUPPORTED but DISCOURAGED — the only form id-churn breaks). */
export function explicitIdsRule(ids: string[]): SetRule {
  return { explicitIds: ids };
}

/** Why hand-picked rows are discouraged — surfaced in the panel when that mode is on. */
export const EXPLICIT_IDS_WARNING =
  "Hand-picked rows break if the estimate is re-imported or rows are reordered. Prefer a rule " +
  "(e.g. by division or cost type) — a rule never goes stale.";

// Option lists for the panel's selects (single source so labels can't drift).
export const ROLLUP_OPS: { value: RollupOp; label: string }[] = [
  { value: "sum", label: "Sum" },
  { value: "count", label: "Count" },
  { value: "avg", label: "Average" },
  { value: "min", label: "Minimum" },
  { value: "max", label: "Maximum" },
];

export const ROLLUP_FIELDS: { value: RollupField; label: string }[] = [
  { value: "total", label: "Total ($)" },
  { value: "unitPrice", label: "Unit price ($)" },
  { value: "matchedQty", label: "Quantity" },
];

export const SET_RULE_FIELDS: { value: SetRuleField; label: string }[] = [
  { value: "division", label: "Division" },
  { value: "baseCode", label: "Base code" },
  { value: "suffix", label: "Suffix" },
  { value: "costType", label: "Cost type" },
  { value: "itemId", label: "Item code" },
  { value: "procoreCode", label: "Procore code" },
  { value: "source", label: "Source" },
];

export const SET_RULE_MATCHES: { value: SetRuleMatch; label: string }[] = [
  { value: "equals", label: "equals" },
  { value: "startsWith", label: "starts with" },
  { value: "in", label: "is one of" },
];

// ---------------------------------------------------------------------------
// Validation — input checks before a draft becomes a Binding
// ---------------------------------------------------------------------------

export type DraftValidation = { ok: true } | { ok: false; error: string };

/** A non-empty numeric-string check (blank → defaults applied; non-numeric → error). */
function isOptionalNumber(raw: string): boolean {
  return raw.trim() === "" || Number.isFinite(Number(raw));
}

export function validateLookupDraft(
  source: string,
  multiplyRaw: string,
  addRaw: string
): DraftValidation {
  if (!source) return { ok: false, error: "Pick a source value to mirror." };
  if (!isOptionalNumber(multiplyRaw)) return { ok: false, error: "Multiply must be a number." };
  if (!isOptionalNumber(addRaw)) return { ok: false, error: "Add must be a number." };
  return { ok: true };
}

export function validateLeafDraft(d: LeafDraft): DraftValidation {
  if (d.match === "in") {
    const vals = d.value.split(",").map((s) => s.trim()).filter(Boolean);
    if (vals.length === 0) return { ok: false, error: "Enter at least one comma-separated value." };
  } else if (d.value.trim() === "") {
    return { ok: false, error: "Enter a value to match." };
  }
  return { ok: true };
}

export function validateRollupDraft(
  useExplicit: boolean,
  leaves: LeafDraft[],
  explicitIds: string[]
): DraftValidation {
  if (useExplicit) {
    if (explicitIds.length === 0) return { ok: false, error: "Pick at least one row." };
    return { ok: true };
  }
  if (leaves.length === 0) return { ok: false, error: "Add at least one rule." };
  for (const leaf of leaves) {
    const v = validateLeafDraft(leaf);
    if (!v.ok) return v;
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Cycle guard + live preview (compose the same engine the recompute evaluates)
// ---------------------------------------------------------------------------

/**
 * The conservative cycle guard (spec §2.6) at authoring time: would adding `next` to
 * `existing` (replacing any prior binding on the same target) create a dependency cycle?
 * Returns the offending node path (graph.ts `findCycle`) or `null`. Builds the SAME
 * assembled graph the recompute evaluates, so a self-reference (a rollup whose set
 * matches its own target row, or a lookup onto its own line) is caught exactly.
 */
export function bindingCycle(
  next: Binding,
  existing: readonly Binding[],
  gc: PersonnelCalcResult,
  siteOps: SiteOpsCalcResult,
  rows: readonly ProcessedTakeoffRow[]
): string[] | null {
  const candidate = upsertBinding(existing, next);
  return findCycle(assembleBindingGraphNodes(candidate, gc, siteOps, rows));
}

export interface BindingPreview {
  /** The recomputed value of the binding's target node (0 when a cycle blocks it). */
  value: number;
  /** For a rollup: how many lines its set currently matches. */
  memberCount?: number;
  /** Set when the draft would create a cycle — the value is not meaningful; show this path. */
  cycle?: string[];
}

/**
 * Recompute the draft binding's value FROM SOURCE so the panel can show it live before
 * saving (the glass-box guarantee). Returns the cycle path instead when the draft is
 * circular. For a rollup it also reports the matched member count.
 */
export function previewBinding(
  next: Binding,
  existing: readonly Binding[],
  gc: PersonnelCalcResult,
  siteOps: SiteOpsCalcResult,
  rows: readonly ProcessedTakeoffRow[]
): BindingPreview {
  const cycle = bindingCycle(next, existing, gc, siteOps, rows);
  if (cycle) return { value: 0, cycle };

  const candidate = upsertBinding(existing, next);
  const values = evaluateGraph(assembleBindingGraphNodes(candidate, gc, siteOps, rows));
  const value = values.get(next.targetNodeId) ?? 0;

  let memberCount: number | undefined;
  if (next.definition.kind === "rollup") {
    memberCount = selectLines(rows.map(projectLine), next.definition.set).length;
  }
  return { value, memberCount };
}
