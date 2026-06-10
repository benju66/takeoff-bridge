/**
 * importEstimate.ts — the pure core of "Import past bids as projects" (Phase 1).
 *
 * Turns an `ExtractedEstimate` (read from a finished company-template workbook by
 * templateExtractor.ts) into the three things the persistence layer needs:
 *   1. a `Project` (inputs + the 7 modifier rates + the `isImported` flag),
 *   2. enriched `ProcessedTakeoffRow[]` line items, and
 *   3. the `project_estimates` totals row.
 *
 * Design rules (AGENTS.md):
 *  - **calculations.ts stays the sole financial authority.** This module never
 *    invents a total; it only RE-READS the sheet's own numbers (the imported
 *    qty/unitPrice) and lets `computeTakeoffSummary` re-derive the rollups, which
 *    the tie-out gate then proves against the workbook's oracle to the cent.
 *  - **Historical fidelity: keep the imported unitPrice.** Enrichment resolves the
 *    granular Procore CODE (resolveProcoreCode) and pulls costType/uom from the
 *    catalog, but NEVER overwrites the bid's price — the whole point of an import.
 *  - **Never drop a dollar.** Conforming-but-uncatalogued codes import unmapped
 *    (Flags worklist + B-4 assign); non-conforming ad-hoc lines import as
 *    `needsReview` rows. Both keep their dollars so the total still ties.
 *  - **Same code, different scope = presentation only.** Two lines sharing a code
 *    (interior vs exterior 08-4000.002) import as independent rows with UNIQUE ids
 *    (`import-${itemId}-r${rowNumber}`) and `source: 'imported'` (cascade-
 *    independent — see src/lib/cascade.ts). Procore rollup sums them into one code.
 */

import type { ProcessedTakeoffRow, EstimateOverrideMap } from "@/types";
import type { Project, ProjectEstimate, CostCodeMapEntry } from "@/types/db";
// TYPE-ONLY: templateExtractor pulls in ExcelJS at runtime. importEstimate uses
// only its interfaces, so `import type` keeps ExcelJS OUT of this module's graph —
// otherwise the workspace page (which imports the pure linkedTotalsFromRows) would
// drag ExcelJS into its static bundle and crash the Turbopack compile worker.
import type { ExtractedEstimate, ExtractedLineItem, ExtractedProjectInputs } from "./templateExtractor";
import type { LinkedDivisionTotal, TakeoffSummary } from "./calculations";
import { ESTIMATE_ITEMS_MASTER } from "./mock-data";
import { resolveProcoreCode } from "./costCodeResolver";
import { getFuzzySuggestions, type SuggestionItem } from "./similarity";
import { LINKED_DIVISION_ROWS, isLinkedDivisionRow } from "./constants";
import { getDivisionCode } from "./division";
import { RECONCILIATION_TOLERANCE } from "./exporter";

/** The 7 modifier rates + rounding fed to computeTakeoffSummary. */
export interface ImportSummaryRates {
  constructionContingencyRate: number;
  designContingencyRate: number;
  buildersRiskRate: number;
  specialInsuranceRate: number;
  glInsuranceRate: number;
  bondRate: number;
  feeRate: number;
  roundingRule: string;
}

/** Stable per-row id; unique even for two lines sharing one itemId (storefront). */
function importRowId(it: ExtractedLineItem): string {
  return it.itemId ? `import-${it.itemId}-r${it.rowNumber}` : `import-r${it.rowNumber}`;
}

/**
 * Enriches one extracted line into a ProcessedTakeoffRow. Resolves the granular
 * Procore code + catalog costType/uom; KEEPS the imported qty/unitPrice. Ad-hoc
 * (non-conforming) lines carry `needsReview` so the override surface flags them.
 */
function enrichOne(it: ExtractedLineItem): ProcessedTakeoffRow {
  const master = ESTIMATE_ITEMS_MASTER[it.itemId];
  const procoreCode = it.itemId ? resolveProcoreCode(it.itemId) : "";

  // Catalogued code → take its Procore parent / costType / uom; otherwise carry
  // neutral defaults and leave the row unmapped (Flags worklist picks it up).
  const procoreParentCode = master?.procoreParentCode ?? "";
  const costType = master?.costType ?? "M";
  const uom = master?.targetUom ?? "";
  // Mapped = a granular Procore code resolved. Linked division rows are always
  // structurally mapped (their dollars ride the linked value, not the rollup).
  const isMapped = it.isLinked || procoreCode !== "";

  const row: ProcessedTakeoffRow = {
    id: importRowId(it),
    classification: it.description,
    itemId: it.itemId,
    procoreParentCode,
    procoreCode,
    description: it.description,
    matchedQty: it.qty,
    uom,
    unitPrice: it.unitPrice,
    total: it.total,
    isMapped,
    rawQuantities: [],
    costType,
    customFields: {},
    source: "imported",
  };
  if (it.isAdHoc) row.needsReview = true;
  return row;
}

/**
 * Maps an ExtractedEstimate to enriched import rows in original sheet order
 * (conforming + ad-hoc merged by source row number, so sort_order preserves the
 * bid's layout). The resolver MUST be primed first (getCostCodeMap →
 * primeCostCodeResolver) exactly as the workspace mount does; on a miss every
 * code resolves to "" and the row imports unmapped rather than guessed.
 */
export function enrichImportedRows(extracted: ExtractedEstimate): ProcessedTakeoffRow[] {
  const all = [...extracted.lineItems, ...extracted.adHocLineItems].sort(
    (a, b) => a.rowNumber - b.rowNumber
  );
  return all.map(enrichOne);
}

// ---------------------------------------------------------------------------
// Code normalization (Phase 2) — suggest deterministic codes for legacy lines
// ---------------------------------------------------------------------------

/**
 * How sure the suggestion is — drives the review UI's chips and which rows
 * "Accept all high-confidence" may touch (bridge + linked ONLY; `similar` is a
 * ranked shortlist a human picks from; `none` stays a flagged manual row).
 */
export type MappingConfidence = "bridge" | "linked" | "similar" | "none";

export interface MappingSuggestion {
  /** The enriched row this belongs to (same id scheme as enrichImportedRows). */
  rowId: string;
  confidence: MappingConfidence;
  /** Primary suggested internal itemId ("" for `none`). */
  itemId: string;
  /** The Procore code the bridge derived ("" when not bridge-informed). */
  procoreCode: string;
  /** Ranked alternatives (similar tier; includes the primary first). */
  candidates: SuggestionItem[];
}

/** Reverses cost-code-map entries to `procoreCode → internalCode[]` (sorted, deterministic). */
export function buildReverseProcoreMap(
  entries: readonly Pick<CostCodeMapEntry, "internalCode" | "procoreCode">[]
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const e of entries) {
    if (!e.procoreCode) continue;
    const list = out.get(e.procoreCode) ?? [];
    if (!list.includes(e.internalCode)) list.push(e.internalCode);
    out.set(e.procoreCode, list);
  }
  for (const list of out.values()) list.sort();
  return out;
}

const normalizeDesc = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const LINKED_BY_DESC = new Map(LINKED_DIVISION_ROWS.map((l) => [normalizeDesc(l.description), l.itemId]));

/** SuggestionItem for an internal code, catalog description when known. */
function asCandidate(itemId: string): SuggestionItem {
  return { itemId, description: ESTIMATE_ITEMS_MASTER[itemId]?.description ?? itemId };
}

/**
 * Ranks ONE extracted line against the legacy bridge + today's mappings.
 * Tiers, strongest first (never an auto-guess — the human confirms every one):
 *  1. `bridge` — the workbook's own BLI SUMIF names a Procore code that
 *     reverse-maps to exactly ONE internal code. Near-certain.
 *  2. `linked` — the description IS one of the 10 GC/Site-Ops linked rows.
 *  3. `similar` — a ranked shortlist: the bridge's ambiguous family when there
 *     is one (storefront interior/exterior), else catalog-wide fuzzy matches.
 *  4. `none` — nothing to offer; the row stays a flagged manual line.
 */
export function suggestMapping(
  item: ExtractedLineItem,
  bridge: ReadonlyMap<string, string>,
  reverse: ReadonlyMap<string, string[]>
): MappingSuggestion {
  const rowId = importRowId(item);
  const base = { rowId, procoreCode: "", candidates: [] as SuggestionItem[] };

  const bridgedProcore = item.rawCode ? bridge.get(item.rawCode) : undefined;
  const family = bridgedProcore ? reverse.get(bridgedProcore) ?? [] : [];
  if (bridgedProcore && family.length === 1) {
    return { ...base, confidence: "bridge", itemId: family[0], procoreCode: bridgedProcore };
  }

  const linkedItemId = LINKED_BY_DESC.get(normalizeDesc(item.description));
  if (linkedItemId) {
    return { ...base, confidence: "linked", itemId: linkedItemId };
  }

  if (bridgedProcore && family.length > 1) {
    // Ambiguous bridge family — rank its members by description similarity.
    const subMaster = Object.fromEntries(
      family.map((id) => [id, ESTIMATE_ITEMS_MASTER[id] ?? { itemId: id, description: id }])
    ) as typeof ESTIMATE_ITEMS_MASTER;
    const ranked = getFuzzySuggestions(item.description, subMaster, family.length);
    const candidates = ranked.length > 0 ? ranked : family.map(asCandidate);
    return {
      ...base,
      confidence: "similar",
      itemId: candidates[0].itemId,
      procoreCode: bridgedProcore,
      candidates,
    };
  }

  const fuzzy = item.description ? getFuzzySuggestions(item.description, ESTIMATE_ITEMS_MASTER, 3) : [];
  if (fuzzy.length > 0) {
    return { ...base, confidence: "similar", itemId: fuzzy[0].itemId, candidates: fuzzy };
  }

  return { ...base, confidence: "none", itemId: "" };
}

/**
 * Suggestions for every ad-hoc (legacy / non-conforming) line, keyed by row id.
 * Conforming-but-unmapped lines keep their existing Flags-worklist path.
 */
export function suggestImportMappings(
  extracted: ExtractedEstimate,
  bridge: ReadonlyMap<string, string>,
  reverse: ReadonlyMap<string, string[]>
): Map<string, MappingSuggestion> {
  const out = new Map<string, MappingSuggestion>();
  for (const item of extracted.adHocLineItems) {
    out.set(importRowId(item), suggestMapping(item, bridge, reverse));
  }
  return out;
}

/**
 * Applies a HUMAN-CONFIRMED mapping to an enriched import row, returning a new
 * row (React-state friendly). Sets the deterministic itemId + the catalog's
 * code/costType/uom; NEVER touches qty/unitPrice (historical fidelity) or the
 * row id/source (provenance). Clearing `needsReview` removes it from Flags.
 */
export function applyImportMapping(row: ProcessedTakeoffRow, itemId: string): ProcessedTakeoffRow {
  const master = ESTIMATE_ITEMS_MASTER[itemId];
  const procoreCode = resolveProcoreCode(itemId);
  return {
    ...row,
    itemId,
    procoreCode,
    procoreParentCode: master?.procoreParentCode ?? row.procoreParentCode,
    costType: master?.costType ?? row.costType,
    uom: master?.targetUom ?? row.uom,
    isMapped: isLinkedDivisionRow(itemId) || procoreCode !== "",
    needsReview: false,
  };
}

// ---------------------------------------------------------------------------
// Lump-sum modifiers → audited overrides (Phase 2)
// ---------------------------------------------------------------------------

/**
 * One legacy lump-sum modifier, expressed as an override INTENT — the exact
 * arguments `recordEstimateOverride` takes. Architect-locked (2026-06-09):
 * every lump is LOGGED as an immutable, queryable record carrying its original
 * sheet label, amount, and source (file + row), because recurring items like
 * "Owner's Rep" will appear across hundreds of bids and Phase 3 mines them.
 */
export interface LumpOverrideIntent {
  /** A TakeoffSummary modifier key (member of OVERRIDABLE_SUMMARY_FIELDS). */
  field: string;
  /** What the engine computes from the bid's rate (the audit-trail baseline). */
  computedValue: number;
  /** The hand-typed as-bid dollar that must be honored. */
  overrideValue: number;
  /** Carries the legacy label + provenance into the append-only audit trail. */
  reason: string;
}

/**
 * Maps every lump-classified modifier row to an override intent. Inert for
 * modern rate-driven bids (no `isLump` rows → empty array → no overrides).
 */
export function lumpOverridesFromExtract(
  extracted: ExtractedEstimate,
  fileName: string
): LumpOverrideIntent[] {
  return extracted.oracle.modifiers
    .filter((m) => m.isLump && m.total !== null)
    .map((m) => ({
      field: m.key,
      computedValue: m.rate * extracted.oracle.step4Subtotal,
      overrideValue: m.total as number,
      reason: `Imported as-bid lump "${m.sheetLabel || m.label}" (STEP 4 r${m.rowNumber}) from ${fileName}`,
    }));
}

/** Collapses intents to the `overrides` map computeTakeoffSummary consumes. */
export function overrideMapFromIntents(intents: readonly LumpOverrideIntent[]): EstimateOverrideMap {
  const map: EstimateOverrideMap = {};
  for (const i of intents) map[i.field] = i.overrideValue;
  return map;
}

/**
 * Builds the `linkedTotals` for the RELOAD path from the saved linked-division
 * rows themselves (their stored qty×unitPrice IS the linked total). This is what
 * makes a reopened import still tie: a finished bid's GC/Site-Ops lump sums are
 * hand-authored and cannot be re-derived from staffing inputs (finding G-2), so
 * the workspace feeds these instead of recomputing from STEP 2/3 when
 * `project.isImported`. Counts each linked itemId once.
 */
export function linkedTotalsFromRows(rows: ProcessedTakeoffRow[]): LinkedDivisionTotal[] {
  const cfgByItemId = new Map(LINKED_DIVISION_ROWS.map((c) => [c.itemId, c]));
  const seen = new Set<string>();
  const out: LinkedDivisionTotal[] = [];
  for (const r of rows) {
    if (!isLinkedDivisionRow(r.itemId)) continue;
    const id = (r.itemId || "").trim();
    if (seen.has(id)) continue;
    seen.add(id);
    const cfg = cfgByItemId.get(id);
    out.push({
      itemId: id,
      description: cfg?.description ?? r.description,
      sourceLabel: cfg?.sourceLabel ?? "",
      total: r.matchedQty * r.unitPrice,
    });
  }
  return out;
}

/** The 7 modifier rates from the extracted inputs, with rounding fixed to 'none'
 *  (template-faithful — ties the unrounded company spreadsheet to the cent). */
export function importSummaryRates(inputs: ExtractedProjectInputs): ImportSummaryRates {
  return { ...inputs.rates, roundingRule: "none" };
}

/**
 * Maps extracted inputs → a new imported Project. `location` / `marketSector` /
 * `bidDate` default (the estimator can edit them); the 7 modifier rates + sqft /
 * units / dates come straight from the bid. `isImported: true` is the G-2 flag.
 */
export function projectFromExtract(
  extracted: ExtractedEstimate,
  opts: { id: string; location?: string; marketSector?: string; bidDate?: string }
): Project {
  const inp = extracted.inputs;
  return {
    id: opts.id,
    name: inp.projectName || "Imported Estimate",
    location: opts.location ?? "",
    squareFootage: inp.squareFootage,
    unitCount: inp.unitCount,
    bidDate: opts.bidDate ?? new Date().toISOString().split("T")[0],
    createdAt: new Date().toISOString(),
    expectedStart: inp.startDate || undefined,
    expectedFinish: inp.finishDate || undefined,
    constructionContingencyRate: inp.rates.constructionContingencyRate,
    designContingencyRate: inp.rates.designContingencyRate,
    buildersRiskRate: inp.rates.buildersRiskRate,
    specialInsuranceRate: inp.rates.specialInsuranceRate,
    glInsuranceRate: inp.rates.glInsuranceRate,
    bondRate: inp.rates.bondRate,
    feeRate: inp.rates.feeRate,
    roundingRule: "none",
    marketSector: opts.marketSector ?? "",
    isImported: true,
  };
}

/**
 * Maps a computed TakeoffSummary → the project_estimates totals row. The summary
 * is the sole authority; this only relabels its fields. generalConditionsTotal /
 * siteOperationsTotal are the Division 01 / 02 linked subtotals (derived from the
 * saved linked rows) so the GC/Site-Ops panels read a meaningful figure on reload.
 */
export function estimateTotalsForImport(
  projectId: string,
  summary: TakeoffSummary,
  rows: ProcessedTakeoffRow[]
): Omit<ProjectEstimate, "items"> {
  const linked = linkedTotalsFromRows(rows);
  let generalConditionsTotal = 0;
  let siteOperationsTotal = 0;
  for (const l of linked) {
    const div = getDivisionCode(l.itemId);
    if (div === "01") generalConditionsTotal += l.total;
    else if (div === "02") siteOperationsTotal += l.total;
  }

  return {
    projectId,
    subtotal: summary.subtotal,
    constructionContingency: summary.constructionContingency,
    designContingency: summary.designContingency,
    buildersRisk: summary.buildersRisk,
    specialInsurance: summary.specialInsurance,
    glInsurance: summary.glInsurance,
    bond: summary.bond,
    fee: summary.fee,
    totalCost: summary.totalEstimatedCost,
    generalConditionsTotal,
    siteOperationsTotal,
    gcUtilization: {},
    gcEquipmentOverrides: {},
    siteOpsQuantities: {},
    siteOpsRates: {},
    rateCardSnapshot: {},
  };
}

/** Tie-out gate result — the imported total vs the workbook's own oracle. */
export interface ImportTieOut {
  importedSubtotal: number;
  oracleSubtotal: number;
  importedTotal: number;
  oracleTotal: number;
  deltaSubtotal: number;
  deltaTotal: number;
  tiesSubtotal: boolean;
  tiesTotal: boolean;
  /** Both subtotal AND grand total within RECONCILIATION_TOLERANCE. */
  ok: boolean;
}

/**
 * The tie-out acceptance gate: compares the engine-computed summary against the
 * workbook's own oracle cells (extracted.oracle) at the cent bar
 * (RECONCILIATION_TOLERANCE). The import flow MUST NOT save silently when this
 * fails — it surfaces the delta + the unmapped/ad-hoc rows instead.
 */
export function checkImportTieOut(
  summary: TakeoffSummary,
  oracle: ExtractedEstimate["oracle"]
): ImportTieOut {
  const ties = (a: number, b: number) => Math.abs(a - b) <= RECONCILIATION_TOLERANCE;
  const deltaSubtotal = summary.subtotal - oracle.step4Subtotal;
  const deltaTotal = summary.totalEstimatedCost - oracle.totalEstimatedCost;
  const tiesSubtotal = ties(summary.subtotal, oracle.step4Subtotal);
  const tiesTotal = ties(summary.totalEstimatedCost, oracle.totalEstimatedCost);
  return {
    importedSubtotal: summary.subtotal,
    oracleSubtotal: oracle.step4Subtotal,
    importedTotal: summary.totalEstimatedCost,
    oracleTotal: oracle.totalEstimatedCost,
    deltaSubtotal,
    deltaTotal,
    tiesSubtotal,
    tiesTotal,
    ok: tiesSubtotal && tiesTotal,
  };
}
