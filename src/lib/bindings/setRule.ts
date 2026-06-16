/**
 * Linked Values System — SetRule evaluator (Phase 1).
 *
 * A capped predicate language over LINE ATTRIBUTES ONLY (spec §2.4). It decides
 * which lines a rollup binding aggregates over. References are by attribute or by
 * line id (`explicitIds`) — never by cell position or range.
 *
 * The grammar is CAPPED: an out-of-grammar field, match, or value shape throws a
 * clear {@link SetRuleError}. The cap is the feature — it is what keeps bindings
 * inspectable and impossible to silently break.
 */

import { getDivisionCode, getBaseCode, getCodeSuffix } from "../division";
import type { BindingLine, SetRule, SetRuleField, SetRuleLeaf } from "./types";

/** Thrown when a SetRule falls outside the capped grammar. */
export class SetRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetRuleError";
  }
}

/**
 * Resolves the string value of a line attribute addressed by a SetRule field.
 * `division`/`baseCode`/`suffix` route through the single-source-of-truth parsers
 * in division.ts so derivation stays consistent app-wide.
 */
export function lineAttribute(line: BindingLine, field: SetRuleField): string {
  switch (field) {
    case "itemId":
      return line.itemId;
    case "division":
      return getDivisionCode(line.itemId);
    case "baseCode":
      return getBaseCode(line.itemId);
    case "suffix":
      return getCodeSuffix(line.itemId);
    case "costType":
      return line.costType;
    case "source":
      return line.source;
    case "procoreCode":
      return line.procoreCode;
    default:
      throw new SetRuleError(`Unknown SetRule field: ${String(field)}`);
  }
}

function matchesLeaf(line: BindingLine, leaf: SetRuleLeaf): boolean {
  const attr = lineAttribute(line, leaf.field);
  switch (leaf.match) {
    case "equals":
      if (typeof leaf.value !== "string") {
        throw new SetRuleError("SetRule 'equals' requires a string value");
      }
      return attr === leaf.value;
    case "startsWith":
      if (typeof leaf.value !== "string") {
        throw new SetRuleError("SetRule 'startsWith' requires a string value");
      }
      return attr.startsWith(leaf.value);
    case "in":
      if (!Array.isArray(leaf.value)) {
        throw new SetRuleError("SetRule 'in' requires a string[] value");
      }
      return leaf.value.includes(attr);
    default:
      throw new SetRuleError(`Unknown SetRule match: ${String((leaf as SetRuleLeaf).match)}`);
  }
}

/**
 * Tests whether a single line satisfies a SetRule. `all` of an empty list is
 * vacuously true; `any` of an empty list is vacuously false (standard semantics,
 * locked by tests). Throws {@link SetRuleError} for out-of-grammar rules.
 */
export function matchesSetRule(line: BindingLine, rule: SetRule): boolean {
  if ("all" in rule) {
    return rule.all.every((sub) => matchesSetRule(line, sub));
  }
  if ("any" in rule) {
    return rule.any.some((sub) => matchesSetRule(line, sub));
  }
  if ("explicitIds" in rule) {
    return rule.explicitIds.includes(line.id);
  }
  if ("field" in rule && "match" in rule) {
    return matchesLeaf(line, rule);
  }
  throw new SetRuleError(`Malformed SetRule: ${JSON.stringify(rule)}`);
}

/**
 * Selects the lines (in their original order) that satisfy a SetRule. Membership is
 * DERIVED, never stored (except the `explicitIds` form) — recompute it whenever the
 * line set changes.
 */
export function selectLines(lines: BindingLine[], rule: SetRule): BindingLine[] {
  return lines.filter((line) => matchesSetRule(line, rule));
}
