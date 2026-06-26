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

import type { ProcessedTakeoffRow, EstimateOverrideMap, InternalEstimateItem } from "@/types";
import type { Project, ProjectEstimate, CostCodeMapEntry, ImportedStep23Lines, ImportedSheetLine, EstimateSectionLine } from "@/types/db";
// TYPE-ONLY: templateExtractor pulls in ExcelJS at runtime. importEstimate uses
// only its interfaces, so `import type` keeps ExcelJS OUT of this module's graph —
// otherwise the workspace page (which imports the pure linkedTotalsFromRows) would
// drag ExcelJS into its static bundle and crash the Turbopack compile worker.
import type { ExtractedEstimate, ExtractedLineItem, ExtractedProjectInputs } from "./templateExtractor";
import type { LinkedDivisionTotal, TakeoffSummary } from "./calculations";
import { getCatalogItems } from "./catalog";
import { resolveProcoreCode } from "./costCodeResolver";
import { resolveStep23Line, type Step23LineDef } from "./step23Normalization";
import { getFuzzySuggestions, type SuggestionItem } from "./similarity";
import { LINKED_DIVISION_ROWS, isLinkedDivisionRow } from "./constants";
import { getDivisionCode } from "./division";
import { RECONCILIATION_TOLERANCE } from "./exporter";
import { RESOLVED_BY, type ResolvedBy } from "./resolvedBy";

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
  const master = getCatalogItems()[it.itemId];
  const procoreCode = it.itemId ? resolveProcoreCode(it.itemId) : "";

  // Catalogued code → take its Procore parent / costType; otherwise carry
  // neutral defaults and leave the row unmapped (Flags worklist picks it up).
  const procoreParentCode = master?.procoreParentCode ?? "";
  const costType = master?.costType ?? "M";
  // AS-BID UOM WINS (Phase 3 Slice 0, architect-locked): the bid's col-G unit
  // travels with the bid's price — a $/SF line must never be relabeled EA by
  // the catalog. The catalog only fills a BLANK cell (on template-family bids
  // only the soft-cost modifier rows are blank, and those never reach here).
  const uom = it.uom || (master?.targetUom ?? "");
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
    // The estimator's STEP 4 col-E note survives as a custom field (fidelity:
    // shown in the import review, persisted with the row, never dropped).
    customFields: it.comment ? { Comment: it.comment } : {},
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
 * "Accept all high-confidence" may touch (bridge + linked ONLY — architect-
 * locked F3: `history` is one-click per row, `similar` is a ranked shortlist
 * a human picks from, `none` stays a flagged manual row).
 */
export type MappingConfidence = "bridge" | "linked" | "history" | "similar" | "none";

export interface MappingSuggestion {
  /** The enriched row this belongs to (same id scheme as enrichImportedRows). */
  rowId: string;
  confidence: MappingConfidence;
  /** Primary suggested internal itemId ("" for `none`). */
  itemId: string;
  /** The Procore code the bridge derived ("" when not bridge-informed). */
  procoreCode: string;
  /** Ranked alternatives (history/similar tiers; includes the primary first). */
  candidates: SuggestionItem[];
  /** `history` tier only: how many past confirmations back the primary code. */
  historyCount?: number;
}

/**
 * Past confirmations per classification string, from classification_history
 * (db.ts getClassificationHistoryBulk): `description → [{resolvedCode, count}]`,
 * BEST SUGGESTION FIRST. `count` is the distinct-bid confirmation count (the
 * "× N" badge), but since fidelity Phase 5 the ORDER is signal-aware
 * (rejection downweights + recency tiebreaks — suggestionRanking.ts), so
 * counts are not necessarily descending; consumers must never re-sort by
 * count. ADVISORY input — when absent/empty every tier behaves exactly as
 * before (fail-soft: history must never block an import).
 */
export type ClassificationHistoryMap = ReadonlyMap<string, { resolvedCode: string; count: number }[]>;

/**
 * The static catalog expressed as cost-code-map entries — the OFFLINE fallback
 * for the reverse map, mirroring `primeCostCodeResolverFromCatalog` exactly so
 * the bridge and the resolver can never disagree about a degraded session.
 */
export function catalogCostCodeEntries(): Pick<CostCodeMapEntry, "internalCode" | "procoreCode">[] {
  return Object.values(getCatalogItems()).map((i) => ({
    internalCode: i.itemId,
    procoreCode: i.procoreCode,
  }));
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
  return { itemId, description: getCatalogItems()[itemId]?.description ?? itemId };
}

/**
 * Ranks ONE extracted line against the legacy bridge + today's mappings.
 * Tiers, strongest first (never an auto-guess — the human confirms every one):
 *  1. `bridge` — the workbook's own BLI SUMIF names a Procore code that
 *     reverse-maps to exactly ONE internal code. Near-certain.
 *  2. `linked` — the description IS one of the 10 GC/Site-Ops linked rows.
 *  3. `history` — the team confirmed a code for this EXACT description on past
 *     imports (classification_history). Ranked by confirmation count; only
 *     codes that still exist today are offered (stale codes are skipped).
 *  4. `similar` — a ranked shortlist: the bridge's ambiguous family when there
 *     is one (storefront interior/exterior), else catalog-wide fuzzy matches.
 *  5. `none` — nothing to offer; the row stays a flagged manual line.
 */
export function suggestMapping(
  item: ExtractedLineItem,
  bridge: ReadonlyMap<string, string>,
  reverse: ReadonlyMap<string, string[]>,
  history?: ClassificationHistoryMap
): MappingSuggestion {
  const rowId = importRowId(item);
  const base = { rowId, procoreCode: "", candidates: [] as SuggestionItem[] };
  const catalog = getCatalogItems();

  const bridgedProcore = item.rawCode ? bridge.get(item.rawCode) : undefined;
  const family = bridgedProcore ? reverse.get(bridgedProcore) ?? [] : [];
  if (bridgedProcore && family.length === 1) {
    return { ...base, confidence: "bridge", itemId: family[0], procoreCode: bridgedProcore };
  }

  const linkedItemId = LINKED_BY_DESC.get(normalizeDesc(item.description));
  if (linkedItemId) {
    return { ...base, confidence: "linked", itemId: linkedItemId };
  }

  // History tier: exact-description matches the team confirmed before. A code
  // must still be assignable TODAY (catalogued or a linked division row) — the
  // catalog evolves, and a stale confirmation must not become a suggestion.
  const past = (history?.get(item.description) ?? []).filter(
    (h) => catalog[h.resolvedCode] !== undefined || isLinkedDivisionRow(h.resolvedCode)
  );
  if (past.length > 0) {
    return {
      ...base,
      confidence: "history",
      itemId: past[0].resolvedCode,
      candidates: past.slice(0, 3).map((h) => asCandidate(h.resolvedCode)),
      historyCount: past[0].count,
    };
  }

  if (bridgedProcore && family.length > 1) {
    // Ambiguous bridge family — rank its members by description similarity.
    const subMaster = Object.fromEntries(
      family.map((id) => [id, catalog[id] ?? { itemId: id, description: id }])
    ) as Record<string, InternalEstimateItem>;
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

  const fuzzy = item.description ? getFuzzySuggestions(item.description, catalog, 3) : [];
  if (fuzzy.length > 0) {
    return { ...base, confidence: "similar", itemId: fuzzy[0].itemId, candidates: fuzzy };
  }

  return { ...base, confidence: "none", itemId: "" };
}

/**
 * Suggestions for every ad-hoc (legacy / non-conforming) line, keyed by row id.
 * Conforming-but-unmapped lines keep their existing Flags-worklist path.
 * `history` is optional and advisory (Phase 3 Slice 1) — omitted/empty, the
 * output is identical to the pre-history tiers.
 */
export function suggestImportMappings(
  extracted: ExtractedEstimate,
  bridge: ReadonlyMap<string, string>,
  reverse: ReadonlyMap<string, string[]>,
  history?: ClassificationHistoryMap
): Map<string, MappingSuggestion> {
  const out = new Map<string, MappingSuggestion>();
  for (const item of extracted.adHocLineItems) {
    out.set(importRowId(item), suggestMapping(item, bridge, reverse, history));
  }
  return out;
}

/** One suggestion-signal training row the import save records (Phase 5). */
export interface SuggestionSignal {
  classification: string;
  resolvedCode: string;
  resolvedBy: ResolvedBy;
}

/**
 * The tiers whose UI presents ONE distinguished primary (the colored ✓
 * button) — the only tiers where confirming a different code is a JUDGMENT on
 * that primary. `similar` renders a flat shortlist of equals (architect F3:
 * "a ranked shortlist a human picks from", no recommendation made), so
 * picking its second chip rejects nothing.
 */
const SIGNAL_TIERS: readonly MappingConfidence[] = ["bridge", "linked", "history"];

/**
 * What the estimator DID with each primary suggestion — derived at save time
 * from the confirmed rows vs the (immutable) suggestions (fidelity Phase 5).
 * These rows ride ALONGSIDE the clean `user`/`user_lump` observation, tagged
 * with the resolvedBy.ts signal vocabulary; they are the accept/reject/override
 * training signal a future ML tier needs and that cannot be backfilled.
 *
 *  - confirmed the suggested primary (bridge/linked/history tier) →
 *    `suggestion_accepted`;
 *  - confirmed a DIFFERENT code → `suggestion_rejected` against the declined
 *    primary PLUS `suggestion_overridden` against the chosen one;
 *  - left unconfirmed, nothing was suggested (`none`), or the tier shows no
 *    distinguished primary (`similar`) → NO signal;
 *  - marked "combined" (`macro_lump_sum`) → NO signal: a lump line is not a
 *    clean observation in EITHER direction (Phase 2 quarantine) — its
 *    confirmation is tagged `user_lump` and never ranks, so its assignment
 *    must not downweight the suggested pairing either.
 *
 * Deliberately conservative throughout: a phantom rejection would sink a
 * pairing nobody actually declined, forever, in an append-only table.
 */
export function suggestionSignalsForSave(
  rows: readonly Pick<ProcessedTakeoffRow, "id" | "itemId" | "description" | "dataFidelity">[],
  suggestions: ReadonlyMap<string, MappingSuggestion>
): SuggestionSignal[] {
  const out: SuggestionSignal[] = [];
  for (const r of rows) {
    const s = suggestions.get(r.id);
    if (!s || !s.itemId || !r.itemId) continue;
    if (!SIGNAL_TIERS.includes(s.confidence)) continue;
    if (r.dataFidelity === "macro_lump_sum") continue;
    const push = (resolvedCode: string, resolvedBy: ResolvedBy) =>
      out.push({ classification: r.description, resolvedCode, resolvedBy });
    if (r.itemId === s.itemId) {
      push(r.itemId, RESOLVED_BY.SUGGESTION_ACCEPTED);
    } else {
      push(s.itemId, RESOLVED_BY.SUGGESTION_REJECTED);
      push(r.itemId, RESOLVED_BY.SUGGESTION_OVERRIDDEN);
    }
  }
  return out;
}

/**
 * Applies a HUMAN-CONFIRMED mapping to an enriched import row, returning a new
 * row (React-state friendly). Sets the deterministic itemId + the catalog's
 * code/costType; NEVER touches qty/unitPrice or a non-blank as-bid uom
 * (historical fidelity) or the row id/source (provenance). Clearing
 * `needsReview` removes it from Flags.
 */
export function applyImportMapping(row: ProcessedTakeoffRow, itemId: string): ProcessedTakeoffRow {
  const master = getCatalogItems()[itemId];
  const procoreCode = resolveProcoreCode(itemId);
  return {
    ...row,
    itemId,
    procoreCode,
    procoreParentCode: master?.procoreParentCode ?? row.procoreParentCode,
    costType: master?.costType ?? row.costType,
    // As-bid UOM survives the mapping; the catalog only fills a blank.
    uom: row.uom || (master?.targetUom ?? ""),
    isMapped: isLinkedDivisionRow(itemId) || procoreCode !== "",
    needsReview: false,
  };
}

/**
 * The bid's UOM vs the catalog's for the row's confirmed code — non-null when
 * BOTH exist and disagree (e.g. bid priced SF, catalog says EA). Display-only
 * (architect-locked F2): the import review shows a subtle indicator; nothing
 * blocks, nothing enters Flags, and the as-bid UOM stays on the row (editable
 * later in the grid like any cell).
 */
export function uomMismatch(row: ProcessedTakeoffRow): { bid: string; catalog: string } | null {
  const catalog = getCatalogItems()[row.itemId]?.targetUom?.trim().toUpperCase() ?? "";
  const bid = row.uom.trim().toUpperCase();
  return bid && catalog && bid !== catalog ? { bid, catalog } : null;
}

// ---------------------------------------------------------------------------
// Imported STEP 2/3 detail (architect-approved 2026-06-10)
// ---------------------------------------------------------------------------

/**
 * The `imported_step23_lines` JSONB payload: the bid's own hand-authored
 * STEP 2/3 lines (dollar-carrying only — hand-authored sheets are full of
 * zero template rows that would drown the read-only panels) plus the bid's
 * section subtotals for tie context. Captured once at import save; the
 * workspace renders it read-only in place of the parametric GC/Site-Ops
 * calculators, which would otherwise fabricate default-derived numbers.
 */
export function step23LinesForImport(extracted: ExtractedEstimate): ImportedStep23Lines {
  const dollarLines = (lines: ExtractedEstimate["step2Lines"]) => lines.filter((l) => l.total !== 0);
  return {
    step2Lines: dollarLines(extracted.step2Lines),
    step3Lines: dollarLines(extracted.step3Lines),
    linkedSourceSubtotals: extracted.oracle.linkedSourceSubtotals,
  };
}

/**
 * Stable key for one STEP 2/3 line inside its payload — what the review gate's
 * correction maps are keyed by. `rowNumber` is unique within a sheet but the
 * two sheets can reuse numbers, so the key carries the sheet.
 */
export function step23LineKey(step: "step2" | "step3", rowNumber: number): string {
  return `${step}:${rowNumber}`;
}

/** The estimator's STEP 2/3 review-gate edits, keyed by `step23LineKey`. */
export interface Step23Corrections {
  /** lineKey → corrected UOM. REPLACES the stored value (architect-locked
   *  2026-06-10: a wrong unit is not history worth preserving); normalized to
   *  the payload's uppercase contract. */
  uomCorrections?: ReadonlyMap<string, string>;
  /** lineKey → assigned deterministic GC/Site-Ops code, written to the
   *  ADDITIVE `assignedCode` field — the as-bid `code` is never rewritten. */
  assignments?: ReadonlyMap<string, string>;
}

/**
 * Derives the payload to persist from the ORIGINAL parsed STEP 2/3 payload +
 * the estimator's current corrections, mirroring `applyAcceptedMappings`: the
 * originals are never mutated, so changing or withdrawing an edit is just
 * editing a map (the proven escape-hatch pattern), and corrections win over
 * stored values. Only `uom` and `assignedCode` can change — qty, rate, total,
 * and the linked subtotals are untouched BY CONSTRUCTION, so the imported
 * dollars and the tie-out cannot move. Applied in memory immediately before
 * the single `saveImportedStep23Lines` write; the stored column stays
 * write-once.
 *
 * CONTRACT (step23ReviewStats depends on it): the output arrays preserve the
 * input's length and order, and a line object is CLONED only when a correction
 * actually changes it — an untouched line keeps its reference identity.
 */
export function applyStep23Corrections(
  payload: ImportedStep23Lines,
  corrections: Step23Corrections
): ImportedStep23Lines {
  const correctLines = (step: "step2" | "step3", lines: readonly ImportedSheetLine[]) =>
    lines.map((l) => {
      const key = step23LineKey(step, l.rowNumber);
      let line = l;
      const uom = corrections.uomCorrections?.get(key)?.trim().toUpperCase();
      if (uom && uom !== (line.uom ?? "")) {
        line = { ...line, uom };
      }
      const assigned = corrections.assignments?.get(key)?.trim();
      if (assigned && assigned !== line.assignedCode) {
        line = { ...line, assignedCode: assigned };
      }
      return line;
    });
  return {
    ...payload,
    step2Lines: correctLines("step2", payload.step2Lines),
    step3Lines: correctLines("step3", payload.step3Lines),
  };
}

/** The import page's parsed-summary counts for the STEP 2/3 review section
 *  (gate Phase 3), computed over the payload WITH the estimator's current
 *  corrections applied — so assigning a line moves it unmapped → resolved live. */
export interface Step23ReviewStats {
  /** Captured dollar lines across both sheets. */
  lineCount: number;
  /** Lines resolving to a deterministic GC/Site-Ops code (auto, assigned, or minted). */
  resolved: number;
  /** Lines with no certain match — they save verbatim, exactly as today. */
  unmapped: number;
  /** Lines the current corrections actually change (UOM and/or assignment). */
  corrected: number;
}

/**
 * Counts over `applyStep23Corrections(payload, corrections)`. A line counts as
 * corrected when a correction CHANGED it — applyStep23Corrections clones a
 * line only in that case, so reference identity against the original is the
 * exact "changed" test (inert or stale map entries count nothing). Pure.
 */
export function step23ReviewStats(
  payload: ImportedStep23Lines,
  corrections: Step23Corrections,
  extraDefs?: readonly Step23LineDef[]
): Step23ReviewStats {
  const correctedPayload = applyStep23Corrections(payload, corrections);
  const originals = [...payload.step2Lines, ...payload.step3Lines];
  const lines = [...correctedPayload.step2Lines, ...correctedPayload.step3Lines];
  let resolved = 0;
  let corrected = 0;
  lines.forEach((l, i) => {
    if (resolveStep23Line(l.code, l.description, l.assignedCode, extraDefs)) resolved++;
    if (l !== originals[i]) corrected++;
  });
  return { lineCount: lines.length, resolved, unmapped: lines.length - resolved, corrected };
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
 * Derives the working row set from the ORIGINAL enriched rows + the estimator's
 * current acceptances (rowId → confirmed itemId) + their UOM corrections
 * (rowId → unit, architect-approved 2026-06-10: a hand-authored bid can carry
 * a wrong unit; fixing it at the review gate keeps the pricing database clean
 * at the source). The originals are never mutated, so changing or withdrawing
 * either kind of edit is just editing a map — the architect-required
 * "I approved the wrong one" escape hatch. A UOM correction is applied AFTER
 * the mapping, so it wins over both the as-bid value and a catalog blank-fill;
 * UOM is non-financial, so dollars and the tie-out never move.
 *
 * `lumpMarks` (database fidelity Phase 2) is the same escape hatch for the
 * per-line "combined" toggle: a marked row carries
 * `dataFidelity='macro_lump_sum'` into the save — one price lumping several
 * scopes, excluded from price history and suggestion ranking on the READ side
 * but never discarded. Removing the mark restores the row untouched BY
 * CONSTRUCTION: the originals are enriched import rows, which never carry a
 * fidelity tag, so an unmarked row needs no clearing. A pure tag: dollars and
 * the tie-out cannot move, and the save is never gated on it.
 */
export function applyAcceptedMappings(
  originals: readonly ProcessedTakeoffRow[],
  accepted: ReadonlyMap<string, string>,
  uomOverrides?: ReadonlyMap<string, string>,
  lumpMarks?: ReadonlySet<string>
): ProcessedTakeoffRow[] {
  return originals.map((r) => {
    const itemId = accepted.get(r.id);
    let row = itemId ? applyImportMapping(r, itemId) : r;
    const uom = uomOverrides?.get(r.id);
    if (uom && uom !== row.uom) {
      row = { ...row, uom };
    }
    if (lumpMarks?.has(r.id)) {
      row = { ...row, dataFidelity: "macro_lump_sum" };
    }
    return row;
  });
}

// ---------------------------------------------------------------------------
// Division 60 fee-block lines (Fee-Block Addressability Phase 6)
// ---------------------------------------------------------------------------

/**
 * Applies the estimator's import-review Procore assignments to the captured fee-block
 * lines (`extracted.feeLines`), returning the markup section lines the engine + the
 * full-replace `save_section_lines` write consume. The assignment map (fee-line id →
 * `{ procoreCode, costType }`, resolved through `validateOneOffCode` so a code is never
 * guessed) is the same revertible escape hatch as `applyAcceptedMappings`: the originals
 * are never mutated, so withdrawing an assignment (deleting the map entry) restores the
 * unmapped line. The `inputs.amount` is NEVER touched — a Procore assignment moves no
 * dollar, so the import tie-out cannot move. With no assignments this is the identity
 * (every line stays unmapped, `procoreCode=''`).
 */
export function applyFeeLineMappings(
  feeLines: readonly EstimateSectionLine[],
  assignments: ReadonlyMap<string, { procoreCode: string; costType: string }>
): EstimateSectionLine[] {
  return feeLines.map((line) => {
    const a = assignments.get(line.id);
    return a ? { ...line, procoreCode: a.procoreCode, costType: a.costType } : line;
  });
}

/**
 * True when assigning `itemId` to `rowId` would put a LINKED division code on
 * two rows. The engine counts a linked value once per itemId but excludes
 * EVERY row carrying it, so a duplicate silently drops the second row's
 * dollars and breaks the tie. Checks both prior acceptances and rows that were
 * born with the code (a mixed bid's real linked rows).
 */
export function linkedMappingConflict(
  originals: readonly ProcessedTakeoffRow[],
  accepted: ReadonlyMap<string, string>,
  rowId: string,
  itemId: string
): boolean {
  if (!isLinkedDivisionRow(itemId)) return false;
  for (const [id, code] of accepted) {
    if (id !== rowId && code === itemId) return true;
  }
  return originals.some((r) => r.id !== rowId && r.itemId === itemId);
}

/**
 * Builds the `linkedTotals` for the RELOAD path from the saved linked-division
 * rows themselves (their stored qty×unitPrice IS the linked total). This is what
 * makes a reopened import still tie: a finished bid's GC/Site-Ops lump sums are
 * hand-authored and cannot be re-derived from staffing inputs (finding G-2), so
 * the workspace feeds these instead of recomputing from STEP 2/3 when
 * `project.isImported`. Counts each linked itemId once.
 */
export function linkedTotalsFromRows(rows: readonly ProcessedTakeoffRow[]): LinkedDivisionTotal[] {
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
  opts: {
    id: string;
    location?: string;
    marketSector?: string;
    bidDate?: string;
    bidOutcome?: Project["bidOutcome"];
    deliveryMethod?: Project["deliveryMethod"];
  }
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
    bidOutcome: opts.bidOutcome ?? "unknown",
    deliveryMethod: opts.deliveryMethod ?? "unknown",
  };
}

// ---------------------------------------------------------------------------
// Advisory duplicate-import detection (database fidelity Phase 1)
// ---------------------------------------------------------------------------

/**
 * Canonical form for project-name comparison: lowercased, punctuation stripped,
 * whitespace collapsed — so "The Marquee — Phase 2" matches "the marquee phase 2".
 */
export function normalizeProjectName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** One existing project that looks like the bid being imported. */
export interface DuplicateImportMatch {
  projectId: string;
  projectName: string;
  /** The existing project's bid date ("" when unset). */
  bidDate: string;
  /** When the existing project entered the app (created_at, ISO). */
  importedAt: string;
  /** True when the existing project's bid date equals the incoming one. */
  sameBidDate: boolean;
}

/**
 * ADVISORY near-match check run before an import save: does an existing project
 * look like this same bid? Conservative by design — a match requires normalized-
 * name equality; the bid date only grades the match (`sameBidDate`), because the
 * incoming date is often still blank while the estimator reviews. The caller
 * shows a banner and NEVER blocks the save (duplicates that slip through are
 * caught retroactively by the Phase 4 Data Health detector).
 */
export function findLikelyDuplicateImports(
  incomingName: string,
  incomingBidDate: string,
  existing: readonly Project[]
): DuplicateImportMatch[] {
  const needle = normalizeProjectName(incomingName);
  if (!needle) return [];
  return existing
    .filter((p) => normalizeProjectName(p.name) === needle)
    .map((p) => ({
      projectId: p.id,
      projectName: p.name,
      bidDate: p.bidDate || "",
      importedAt: p.createdAt,
      sameBidDate: !!incomingBidDate && !!p.bidDate && incomingBidDate === p.bidDate,
    }));
}

/**
 * Maps a computed TakeoffSummary → the project_estimates totals row. The summary
 * is the sole authority; this only relabels its fields. generalConditionsTotal /
 * siteOperationsTotal are the Division 01 / 02 linked subtotals (derived from the
 * saved linked rows) so the GC/Site-Ops panels read a meaningful figure on reload.
 */
/**
 * The GC (div 01) / Site-Ops (div 02) section totals an IMPORTED project must
 * persist — derived from its saved linked rows, never from the parametric
 * calculators (which compute app DEFAULTS for imports). Used at import save
 * AND by the workspace auto-save, so a later edit can never overwrite the
 * as-imported totals with default-derived numbers.
 *
 * Takes the ALREADY-DERIVED linked totals so callers that have them memoized
 * (the workspace's linkedDivisionTotals) don't walk the rows a second time.
 */
export function sectionTotalsFromLinked(linked: readonly LinkedDivisionTotal[]): {
  generalConditionsTotal: number;
  siteOperationsTotal: number;
} {
  let generalConditionsTotal = 0;
  let siteOperationsTotal = 0;
  for (const l of linked) {
    const div = getDivisionCode(l.itemId);
    if (div === "01") generalConditionsTotal += l.total;
    else if (div === "02") siteOperationsTotal += l.total;
  }
  return { generalConditionsTotal, siteOperationsTotal };
}

/** Convenience over rows (import-save path; the workspace uses its memo). */
export function linkedSectionTotals(rows: readonly ProcessedTakeoffRow[]): {
  generalConditionsTotal: number;
  siteOperationsTotal: number;
} {
  return sectionTotalsFromLinked(linkedTotalsFromRows(rows));
}

export function estimateTotalsForImport(
  projectId: string,
  summary: TakeoffSummary,
  rows: ProcessedTakeoffRow[]
): Omit<ProjectEstimate, "items"> {
  const { generalConditionsTotal, siteOperationsTotal } = linkedSectionTotals(rows);

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
    // GC/Site-Ops Addressability Phase B6: the four Step 2/3 input blobs were retired.
    // An imported bid has no live Step 2/3 inputs anyway (its GC/Site-Ops detail is the
    // frozen imported_step23_lines); section lines are synthesized from that frozen detail.
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
