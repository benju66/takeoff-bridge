/**
 * GC/Site-Ops Addressability — Phase B5 one-off line model (PURE, no React).
 *
 * D1 — the validated escape hatch. A ONE-OFF line is a generic estimator-authored
 * manual entry that is NOT in the catalog (e.g. a project-specific fee). It is, end
 * to end, a `source: 'manual'` section line whose **`id` === internal `code` ===
 * engine manual-config `key`** — one generated identifier — so the engine, the
 * dual-read bridge (`project.ts`), the grid join (by `code`), and reload all agree
 * by construction.
 *
 * It runs through the EXISTING manual-line evaluator via `buildXLineSet({ addManual })`
 * (no new per-line math, ID-4): a one-off carries an entry kind (`qty` / `lumpSum`
 * for GC; `qty` / `qtyRate` / `lumpSum` for Site-Ops), a typed value, an optional
 * typed rate, a unit, and — once assigned — a valid Procore code + cost type. Until it
 * resolves to a valid `procore_cost_codes` entry it is BLOCKED from export
 * (validateExportReadiness); bespoke STRUCTURED lines are never mintable here.
 */

import type { EstimateSectionLine, SectionDiscriminator, ProcoreCostCodeType } from "@/types/db";
import type { GcManualConfig, GcCostType, SiteOpsManualConfig } from "@/lib/constants";
import { ESTIMATE_TO_PROCORE_TYPE } from "@/lib/procoreTypeReconciliation";
import { isValidProcoreCode, getProcoreCostType } from "@/lib/procoreValidCodes";
import { ENTRY_KIND, isManualEntryKind, type EntryKind } from "./entryKinds";

/**
 * The estimator-typed kinds a one-off may use — `qty` (quantity × typed rate) and `lumpSum`
 * (a typed dollar amount), per D1's "generic manual / lump-sum" scope. `qtyRate` is NOT
 * offered: for a one-off it is redundant with `qty` (both compute value × a typed rate — a
 * one-off `qty` line's rate is its own typed `config.rate`, never a rate-card lookup), so a
 * single kind keeps the escape hatch minimal (no new math, ID-4).
 */
export type OneOffEntryKind = "qty" | "lumpSum";

/** Coerce a JSONB `inputs` value to a finite number (the value/rate are stored as numbers). */
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
/** Read the one-off's unit string from `inputs` ('' when absent). */
export const oneOffUnit = (line: EstimateSectionLine): string =>
  typeof line.inputs.unit === "string" ? line.inputs.unit : "";

/**
 * The single one-off detector, shared by the grid, the synthesis split, and the load
 * reconstruction: a GC/Site-Ops section line authored by the estimator (NOT a catalog seed,
 * which is `'template'`, nor an imported frozen line, which is on its own read-only path).
 * Belt and braces: also require a manual entry kind so a stray non-manual `'manual'`-sourced
 * row can never be treated as a one-off, and require a GC/Site-Ops section so a Division 60
 * markup fee line (also `source: 'manual'` + `lumpSum`) is never misread as a one-off (it
 * belongs to the separate `'markup'` section — Fee-Block Addressability Phase 1).
 */
export function isOneOffLine(line: EstimateSectionLine): boolean {
  return (
    (line.section === "gc" || line.section === "site_ops") &&
    line.source === "manual" &&
    isManualEntryKind(line.entryKind)
  );
}

/** Reverse of {@link ESTIMATE_TO_PROCORE_TYPE}: Procore type → estimate cost type (L/M/S/E). */
const PROCORE_TO_ESTIMATE_TYPE: Readonly<Record<ProcoreCostCodeType, string>> = Object.freeze(
  Object.fromEntries(Object.entries(ESTIMATE_TO_PROCORE_TYPE).map(([est, pro]) => [pro, est])),
) as Readonly<Record<ProcoreCostCodeType, string>>;

/** Narrow a stored L/M/S/E cost type to the calc engine's `GcCostType` (M/L/S). `E`
 *  (Equipment) collapses to `M` — cost type is BLI metadata that moves no rollup dollar,
 *  so the narrowing is purely to satisfy the engine config type; the section line keeps
 *  the true L/M/S/E for display/audit. */
function narrowToGcCostType(costType: string): GcCostType {
  return costType === "L" || costType === "S" ? costType : "M";
}

let oneOffCounter = 0;
/** A stable, unique one-off identifier (`<section>:oneoff:<rand>`) used as id === code === key. */
function newOneOffId(section: SectionDiscriminator): string {
  const prefix = section === "gc" ? "gc" : "siteops";
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${(oneOffCounter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}:oneoff:${rand}`;
}

export interface NewOneOffInput {
  section: SectionDiscriminator;
  label: string;
  unit: string;
  entry: OneOffEntryKind;
  /** Typed quantity (qty/qtyRate) or dollar amount (lumpSum). */
  value: number;
  /** Typed rate ($/unit) for qty / qtyRate lines (ignored for lumpSum). */
  rate?: number;
}

/**
 * Builds a brand-new, UNCODED one-off section line (`procoreCode`/`costType` empty — the
 * estimator assigns the code in the row afterward). `id === code` is the generated marker;
 * the unit/value/rate ride `inputs`. `sortOrder` is informational (the gateway re-stamps it).
 */
export function newOneOffLine(input: NewOneOffInput): EstimateSectionLine {
  const id = newOneOffId(input.section);
  const inputs: Record<string, unknown> = { value: num(input.value), unit: input.unit };
  if (input.entry === "qty") inputs.rate = num(input.rate);
  return {
    id,
    projectId: "",
    section: input.section,
    code: id,
    procoreCode: "",
    costType: "",
    label: input.label,
    entryKind: input.entry as EntryKind,
    inputs,
    sortOrder: 0,
    source: "manual",
    updatedAt: "",
  };
}

/**
 * Projects a one-off section line to the engine's manual-line config (GC or Site-Ops). The
 * config `key === line.id` so the engine reads the one-off's typed value from the
 * `manualEntries` / `quantities` map under that key (see {@link oneOffValueInjection}). A
 * `qty` line carries its typed rate as `config.rate` (the engine's `rateLookup(code, rate)`
 * fallback wins because a one-off code is never on the rate card); a `qtyRate` line's rate
 * rides the `rates` map; a `lumpSum` line carries no rate. Per-line math is untouched.
 */
export function oneOffToGcManualConfig(line: EstimateSectionLine): GcManualConfig {
  const entry = line.entryKind === ENTRY_KIND.LumpSum ? "lumpSum" : "qty";
  return {
    key: line.id,
    code: line.code,
    procoreCode: line.procoreCode,
    costType: narrowToGcCostType(line.costType),
    label: line.label,
    unit: oneOffUnit(line),
    entry,
    rate: entry === "qty" ? num(line.inputs.rate) : null,
    section: "gcManual",
  };
}

export function oneOffToSiteOpsManualConfig(line: EstimateSectionLine): SiteOpsManualConfig {
  const entry = line.entryKind === ENTRY_KIND.LumpSum ? "lumpSum" : "qty";
  return {
    key: line.id,
    code: line.code,
    procoreCode: line.procoreCode,
    costType: narrowToGcCostType(line.costType),
    label: line.label,
    unit: oneOffUnit(line),
    entry,
    // qty lines carry their own typed rate as config.rate (never a rate-card lookup, since a
    // one-off code is never on the card); lumpSum lines carry no rate.
    rate: entry === "qty" ? num(line.inputs.rate) : null,
    section: "siteOperations",
  };
}

/**
 * The typed value a one-off injects into the engine input map, keyed by `line.id` — the GC
 * `manualEntries` / Site-Ops `quantities` map. A `qty` one-off's rate rides `config.rate`
 * (see {@link oneOffToSiteOpsManualConfig}), so it is NOT injected into any rate map; a
 * `lumpSum` one-off has no rate.
 */
export function oneOffValueInjection(line: EstimateSectionLine): { key: string; value: number } {
  return { key: line.id, value: num(line.inputs.value) };
}

/** Result of validating a free-entry Procore code for a one-off (mirrors assignCode.ts). */
export type OneOffCodeValidation =
  | { ok: true; procoreCode: string; costType: string }
  | { ok: false; error: string };

/**
 * Validate + resolve a free-entry Procore code for a one-off (D1). A code is valid only when
 * it is on the active `procore_cost_codes` master list (`isValidProcoreCode`, the primed
 * oracle). The resolved cost type is the code's Procore type mapped to L/M/S/E, defaulting to
 * `'M'` when the type is unknown (the JSON baseline carries no type, or an unprimed window) —
 * cost type is BLI metadata that moves no dollar, so the default is safe. Empty input is
 * rejected.
 */
export function validateOneOffCode(code: string): OneOffCodeValidation {
  const trimmed = code.trim();
  if (trimmed === "") return { ok: false, error: "Enter a Procore code to assign." };
  if (!isValidProcoreCode(trimmed)) {
    return { ok: false, error: `"${trimmed}" is not a valid Procore cost code.` };
  }
  const procoreType = getProcoreCostType(trimmed);
  const costType = procoreType ? (PROCORE_TO_ESTIMATE_TYPE[procoreType] ?? "M") : "M";
  return { ok: true, procoreCode: trimmed, costType };
}
