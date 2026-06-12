/**
 * dataHealth.ts — THE Data Health audit engine (database fidelity Phase 4):
 * one engine, two surfaces. The /data-health page renders every finding
 * company-wide grouped by severity; the project workspace strip renders the
 * same findings filtered to one project (`findingsForProject`). No surface
 * rolls its own checks — the locked plan decision mirrors historyTrust's
 * one-authority rule.
 *
 * PURE and READ-side only: nothing here touches the database or writes
 * anything. The single sanctioned module read is the STEP 4 catalog through
 * the `catalog.ts` chokepoint (`getCatalogItems`) — never
 * `ESTIMATE_ITEMS_MASTER` directly — so in-app catalog additions are covered
 * wherever the caller has primed them.
 *
 * DETECT-only by design: every finding names where its facts live, and the
 * fixes deliberately live elsewhere — /catalog (merge / retire / BLI backfill
 * / promote), the workspace Flags view (assign unmapped lines), the Projects
 * directory (capture-field backfill, deleting a duplicate import), and
 * re-import. Statistical screens are FLAG-ONLY with conservative named
 * thresholds (plan lock 2026-06-11) — nothing is ever deleted or auto-fixed.
 *
 * Price-jump detection reuses historyTrust's observation plumbing
 * (aggregateTrustedHistory) rather than re-mining: jumps are judged over the
 * TRUSTED pool only — validity-screened, alias-folded, IQR outliers already
 * set aside — so the two screens compose instead of double-reporting.
 */

import type { Project, CustomStep23LineDef, CatalogAddition } from "@/types/db";
import type { PriceObservation } from "./priceHistory";
import { aggregateTrustedHistory, canonicalUom, observationExclusion } from "./historyTrust";
import { getCatalogItems } from "./catalog";
import { STEP23_LINE_DEFS } from "./step23Normalization";
import { statusOf } from "./catalogLifecycle";
import { normalizeProjectName } from "./importEstimate";

// ---------------------------------------------------------------------------
// Tunable thresholds (ship conservative — plan §Risks: high-confidence
// findings only; loosen with real backlog evidence, never silently)
// ---------------------------------------------------------------------------

/** Duplicate-import proximity: two estimate grand totals within this fraction
 *  of each other count as "the same money" when the names already match. */
export const DUPLICATE_TOTAL_PROXIMITY = 0.01;

/** Below this many DATED trusted observations in a (code, unit) pool, no
 *  price-jump screening — two points are a difference, not a discontinuity
 *  (same philosophy as historyTrust's OUTLIER_MIN_GROUP_SIZE). */
export const PRICE_JUMP_MIN_GROUP_SIZE = 3;

/** Consecutive-in-time prices that move by more than this multiple (either
 *  direction) get flagged. 3× is deliberately far past any plausible market
 *  move between bids — it catches unit mistakes (SF bid priced as SY), not
 *  escalation. */
export const PRICE_JUMP_FENCE = 3;

/** Fuzzy label matching: edit distance this small flags a near-duplicate... */
export const NEAR_DUPLICATE_MAX_EDIT_DISTANCE = 1;
/** ...but only on labels at least this long — short codeish labels ("Crane")
 *  one letter apart are usually genuinely different things. */
export const NEAR_DUPLICATE_MIN_FUZZY_LENGTH = 8;

/** Lump-share: a code is flagged when at least this fraction of its recorded
 *  lines are combined-line lump sums... */
export const LUMP_SHARE_MIN_RATIO = 0.5;
/** ...and at least this many lines are lumps (one lump out of one line is the
 *  marker doing its job, not a data-health pattern). */
export const LUMP_SHARE_MIN_LINES = 2;

// ---------------------------------------------------------------------------
// Finding model
// ---------------------------------------------------------------------------

export type DataHealthSeverity = "high" | "medium" | "low";

export type DataHealthFindingType =
  | "duplicate_import"
  | "unit_conflict"
  | "unmapped_lines"
  | "missing_bid_date"
  | "price_jump"
  | "near_duplicate_code"
  | "lump_share"
  | "missing_answers";

/** Fixed severity per finding type — the page groups by these. */
export const FINDING_SEVERITY: Readonly<Record<DataHealthFindingType, DataHealthSeverity>> = {
  duplicate_import: "high", // double-counts every observation it carries
  unit_conflict: "high", // splits one item's history into incomparable pools
  unmapped_lines: "medium", // dollars invisible to history; blocks export
  missing_bid_date: "medium", // observations can never be escalation-adjusted
  price_jump: "medium", // flag-only suspicion, human judges
  near_duplicate_code: "medium", // sprawl splits history across labels
  lump_share: "low", // honest marker doing its job; thin real history
  missing_answers: "low", // backfillable in seconds
};

/** Display labels shared by both surfaces (badge text). */
export const FINDING_TYPE_LABELS: Readonly<Record<DataHealthFindingType, string>> = {
  duplicate_import: "Suspected duplicate import",
  unit_conflict: "Unit conflict",
  unmapped_lines: "Unmapped lines",
  missing_bid_date: "Missing bid date",
  price_jump: "Price jump",
  near_duplicate_code: "Near-duplicate label",
  lump_share: "Combined-line share",
  missing_answers: "Unanswered capture fields",
};

export const DATA_HEALTH_SEVERITY_ORDER: readonly DataHealthSeverity[] = ["high", "medium", "low"];

export interface DataHealthProjectRef {
  id: string;
  name: string;
}

export interface DataHealthFinding {
  type: DataHealthFindingType;
  severity: DataHealthSeverity;
  /** One-line headline. */
  title: string;
  /** Supporting facts, human-readable (may contain newlines). */
  detail: string;
  /** Projects involved — the page's deep links; the strip's filter key. */
  projects: DataHealthProjectRef[];
  /** Code context when code-scoped — the /catalog deep-link target. */
  code?: string;
}

// ---------------------------------------------------------------------------
// Inputs (fetched by the caller through db.ts — the engine never fetches)
// ---------------------------------------------------------------------------

/** Minimal per-line facts for the whole-company line-item scan (unmapped +
 *  lump-share findings). Shape owned here; db.ts maps rows into it. */
export interface LineItemHealthFact {
  projectId: string;
  itemId: string;
  isMapped: boolean;
  dataFidelity: string;
  total: number;
}

export interface DataHealthInputs {
  projects: readonly Project[];
  /** project_estimates.total_cost keyed by project id (duplicate proximity). */
  estimateTotals: ReadonlyMap<string, number>;
  lineItems: readonly LineItemHealthFact[];
  /** The FULL bid observation pool (db.ts getBidPriceHistory: imported bids +
   *  submitted versions, supersede rule applied) — STEP 4 catalog codes. */
  step4Observations: readonly PriceObservation[];
  /** Resolved STEP 2/3 staff-rate observations (step23Observations). Kept
   *  separate from STEP 4 — the same code means different things in the two
   *  worlds (same split /rates maintains). */
  step23Observations: readonly PriceObservation[];
  customDefs: readonly CustomStep23LineDef[];
  additions: readonly CatalogAddition[];
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A bid date escalation math could ever use: ISO-shaped AND a real calendar
 *  date. Round-trips through Date because Date.parse silently rolls an
 *  out-of-range component over (2025-02-30 → March 2) instead of rejecting. */
export function isUsableBidDate(bidDate: string): boolean {
  if (!ISO_DATE_RE.test(bidDate)) return false;
  const [y, m, d] = bidDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  );
}

/** Canonical form for label comparison: the project-name canonicalization
 *  (lowercase, punctuation stripped, whitespace collapsed) applied after
 *  dropping a trailing parenthetical annotation — so "Temp. Office (Monthly)"
 *  matches "temp office". */
function canonicalLabel(label: string): string {
  return normalizeProjectName(label.replace(/\s*\([^)]*\)\s*$/, ""));
}

/** Levenshtein distance with an early exit past `max` (only tiny distances
 *  matter here, so the classic DP stays cheap). */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(
        prev[j] + 1,
        next[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      if (next[j] < rowMin) rowMin = next[j];
    }
    if (rowMin > max) return max + 1;
    prev = next;
  }
  return prev[b.length];
}

/** True when two canonical labels are the same name for data-health purposes:
 *  exact, or within the conservative fuzzy fence on long-enough labels. */
function labelsNearDuplicate(a: string, b: string): boolean {
  if (a === "" || b === "") return false;
  if (a === b) return true;
  if (a.length < NEAR_DUPLICATE_MIN_FUZZY_LENGTH || b.length < NEAR_DUPLICATE_MIN_FUZZY_LENGTH) {
    return false;
  }
  return editDistance(a, b, NEAR_DUPLICATE_MAX_EDIT_DISTANCE) <= NEAR_DUPLICATE_MAX_EDIT_DISTANCE;
}

function refOf(p: Project): DataHealthProjectRef {
  return { id: p.id, name: p.name || "Unnamed" };
}

/** Best-effort deep links for observation-backed findings: observations carry
 *  project NAMES only, so names resolve to the first project wearing them.
 *  A name no project wears stays in the detail text without a link. */
function refsForNames(
  names: Iterable<string>,
  projects: readonly Project[]
): DataHealthProjectRef[] {
  const byName = new Map<string, Project>();
  for (const p of projects) {
    if (p.name && !byName.has(p.name)) byName.set(p.name, p);
  }
  const out: DataHealthProjectRef[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const p = byName.get(name);
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      out.push(refOf(p));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// (1) Unmapped lines per project
// ---------------------------------------------------------------------------

function unmappedLineFindings(
  lineItems: readonly LineItemHealthFact[],
  projects: readonly Project[]
): DataHealthFinding[] {
  const byProject = new Map<string, { count: number; dollars: number }>();
  for (const li of lineItems) {
    if (li.isMapped) continue;
    const g = byProject.get(li.projectId) ?? { count: 0, dollars: 0 };
    g.count += 1;
    g.dollars += Math.abs(li.total);
    byProject.set(li.projectId, g);
  }
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const out: DataHealthFinding[] = [];
  for (const [projectId, g] of byProject) {
    const project = projectById.get(projectId);
    const ref = project ? refOf(project) : { id: projectId, name: projectId };
    out.push({
      type: "unmapped_lines",
      severity: FINDING_SEVERITY.unmapped_lines,
      title: `${ref.name}: ${g.count} unmapped line${g.count === 1 ? "" : "s"} (${currency.format(g.dollars)})`,
      detail:
        "Lines with no catalog code never enter cost history and block export. " +
        "Assign codes from the workspace Flags view (or mint one on /catalog).",
      projects: [ref],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// (2) Unit conflicts per code (canonical units — alias spellings never
//     false-positive; SF vs SY is a conflict, SF vs SQFT is not)
// ---------------------------------------------------------------------------

function unitConflictFindings(
  observations: readonly PriceObservation[],
  world: "step4" | "step23",
  projects: readonly Project[]
): DataHealthFinding[] {
  // code → canonical unit → { count, project names }
  const byCode = new Map<string, Map<string, { count: number; names: Set<string> }>>();
  for (const o of observations) {
    if (!o.itemId) continue;
    if (observationExclusion(o) !== null) continue; // judge real observations only
    const unit = canonicalUom(o.uom);
    if (unit === "") continue; // a missing unit is a gap, not a conflict
    const units = byCode.get(o.itemId) ?? new Map();
    const g = units.get(unit) ?? { count: 0, names: new Set<string>() };
    g.count += 1;
    if (o.projectName) g.names.add(o.projectName);
    units.set(unit, g);
    byCode.set(o.itemId, units);
  }

  // STEP 4 codes have a catalog-expected unit for context (chokepoint read;
  // captured ONCE — the merged catalog is rebuilt on every getCatalogItems()
  // call when additions are primed).
  const catalog = world === "step4" ? getCatalogItems() : null;

  const out: DataHealthFinding[] = [];
  for (const [code, units] of byCode) {
    if (units.size < 2) continue;
    const parts = [...units.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([unit, g]) => `${unit} (${g.count} observation${g.count === 1 ? "" : "s"})`);
    const allNames = new Set<string>();
    for (const [, g] of units) for (const n of g.names) allNames.add(n);
    const expected = catalog?.[code]?.targetUom ?? "";
    out.push({
      type: "unit_conflict",
      severity: FINDING_SEVERITY.unit_conflict,
      title: `${code} is priced in ${units.size} different units`,
      detail:
        `Observed units: ${parts.join(", ")}.` +
        (expected ? ` Catalog unit: ${expected}.` : "") +
        " Prices are only comparable within one unit, so this code's history is split. " +
        "If a spelling (not a real unit difference) caused this, the alias table in historyTrust is the fix point.",
      projects: refsForNames(allNames, projects),
      code,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// (3) Near-duplicate code labels — custom defs AND catalog additions vs
//     built-ins (and each other). Retired/merged customs and landed additions
//     are EXCLUDED: already resolved by definition.
// ---------------------------------------------------------------------------

interface LabeledCode {
  code: string;
  label: string;
  /** True for rows /catalog can act on (the finding's candidate side). */
  custom: boolean;
}

function nearDuplicateFor(
  candidates: readonly LabeledCode[],
  universe: readonly LabeledCode[],
  worldLabel: string
): DataHealthFinding[] {
  const out: DataHealthFinding[] = [];
  const canon = new Map<LabeledCode, string>();
  const all = [...universe];
  for (const c of all) canon.set(c, canonicalLabel(c.label));
  for (const candidate of candidates) {
    const a = canon.get(candidate) ?? canonicalLabel(candidate.label);
    for (const other of all) {
      if (other.code === candidate.code) continue;
      // Custom-vs-custom pairs would otherwise emit twice (once per side).
      if (other.custom && candidate.code > other.code) continue;
      const b = canon.get(other) ?? "";
      if (!labelsNearDuplicate(a, b)) continue;
      out.push({
        type: "near_duplicate_code",
        severity: FINDING_SEVERITY.near_duplicate_code,
        title: `${candidate.code} looks like ${other.code}`,
        detail:
          `${worldLabel}: "${candidate.label}" (${candidate.code}) nearly duplicates ` +
          `"${other.label}" (${other.code}${other.custom ? "" : ", built-in"}). ` +
          "If they are the same thing, merging on /catalog refiles the history under one code.",
        projects: [],
        code: candidate.code,
      });
    }
  }
  return out;
}

function nearDuplicateFindings(
  customDefs: readonly CustomStep23LineDef[],
  additions: readonly CatalogAddition[]
): DataHealthFinding[] {
  // GC/Site-Ops world: active customs vs built-in line defs + each other.
  const activeCustoms: LabeledCode[] = customDefs
    .filter((d) => statusOf(d) === "active")
    .map((d) => ({ code: d.code, label: d.label, custom: true }));
  const step23Universe: LabeledCode[] = [
    ...STEP23_LINE_DEFS.map((d) => ({ code: d.code, label: d.label, custom: false })),
    ...activeCustoms,
  ];

  // STEP 4 world: active additions vs the merged runtime catalog (chokepoint
  // read — covers built-ins plus whatever overlay the caller primed) + each
  // other. Landed additions are reconciled rows; their built-in twin already
  // sits in the catalog, so they are excluded from both sides.
  const activeAdditions: LabeledCode[] = additions
    .filter((a) => a.status === "active")
    .map((a) => ({ code: a.itemId, label: a.description, custom: true }));
  const catalogCodes = new Map<string, LabeledCode>();
  for (const item of Object.values(getCatalogItems())) {
    catalogCodes.set(item.itemId, { code: item.itemId, label: item.description, custom: false });
  }
  for (const a of activeAdditions) {
    // Primed or not, an addition is its own row — but a BUILT-IN always wins a
    // code collision (catalog.ts's locked rule; db.ts rejects new collisions,
    // this guards any row that predates that gate).
    if (!catalogCodes.has(a.code)) catalogCodes.set(a.code, a);
  }
  const step4Universe = [...catalogCodes.values()];

  return [
    ...nearDuplicateFor(activeCustoms, step23Universe, "GC/Site-Ops"),
    ...nearDuplicateFor(activeAdditions, step4Universe, "STEP 4 catalog"),
  ];
}

// ---------------------------------------------------------------------------
// (4) Suspected duplicate imports — the retroactive net for the push window.
//     Conservative pairwise screen: a name match needs a corroborating signal
//     (same bid date, or grand totals within DUPLICATE_TOTAL_PROXIMITY); a
//     renamed re-import is caught by same date + identical total.
// ---------------------------------------------------------------------------

function duplicateImportFindings(
  projects: readonly Project[],
  estimateTotals: ReadonlyMap<string, number>
): DataHealthFinding[] {
  const out: DataHealthFinding[] = [];
  for (let i = 0; i < projects.length; i++) {
    for (let j = i + 1; j < projects.length; j++) {
      const a = projects[i];
      const b = projects[j];
      const nameA = normalizeProjectName(a.name);
      const sameName = nameA !== "" && nameA === normalizeProjectName(b.name);
      const sameDate = !!a.bidDate && a.bidDate === b.bidDate;
      const ta = estimateTotals.get(a.id);
      const tb = estimateTotals.get(b.id);
      // Deliberately conservative: a $0 total is no evidence of sameness —
      // half-finished imports all share it, and flagging every such pair
      // would bury the real duplicates. Missing totals stay "not comparable".
      const bothTotals = ta !== undefined && tb !== undefined && ta !== 0 && tb !== 0;
      const totalsNear =
        bothTotals &&
        Math.abs(ta - tb) <= DUPLICATE_TOTAL_PROXIMITY * Math.max(Math.abs(ta), Math.abs(tb));
      const totalsIdentical = bothTotals && Math.abs(ta - tb) < 0.005; // to the cent
      if (!((sameName && (sameDate || totalsNear)) || (sameDate && totalsIdentical))) continue;

      const signals = [
        sameName ? "same name" : "different names",
        sameDate ? `same bid date (${a.bidDate})` : "different bid dates",
        bothTotals
          ? `totals ${currency.format(ta)} vs ${currency.format(tb)}${totalsIdentical ? " (identical)" : totalsNear ? " (within 1%)" : ""}`
          : "totals not comparable",
      ];
      out.push({
        type: "duplicate_import",
        severity: FINDING_SEVERITY.duplicate_import,
        title: `"${a.name || "Unnamed"}" and "${b.name || "Unnamed"}" look like the same bid`,
        detail:
          `Signals: ${signals.join("; ")}. A duplicate double-counts every price observation it carries. ` +
          "Verify side by side; the redundant copy can be deleted from the Projects directory.",
        projects: [refOf(a), refOf(b)],
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// (5) Missing won/lost and delivery-method answers ('unknown' = unanswered)
// ---------------------------------------------------------------------------

function missingAnswerFindings(projects: readonly Project[]): DataHealthFinding[] {
  const out: DataHealthFinding[] = [];
  for (const p of projects) {
    const missing: string[] = [];
    if ((p.bidOutcome ?? "unknown") === "unknown") missing.push("won/lost outcome");
    if ((p.deliveryMethod ?? "unknown") === "unknown") missing.push("delivery method");
    if (missing.length === 0) continue;
    out.push({
      type: "missing_answers",
      severity: FINDING_SEVERITY.missing_answers,
      title: `${p.name || "Unnamed"}: ${missing.join(" and ")} unanswered`,
      detail:
        "Won/lost and delivery method qualify every price this project contributes to history. " +
        "Both are backfillable in seconds from the Projects directory or the project's STEP 1.",
      projects: [refOf(p)],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// (6) Lump-share per code (data_fidelity='macro_lump_sum' ratio)
// ---------------------------------------------------------------------------

function lumpShareFindings(
  lineItems: readonly LineItemHealthFact[],
  projects: readonly Project[]
): DataHealthFinding[] {
  const byCode = new Map<string, { total: number; lumps: number; lumpProjects: Set<string> }>();
  for (const li of lineItems) {
    if (!li.itemId) continue;
    const g = byCode.get(li.itemId) ?? { total: 0, lumps: 0, lumpProjects: new Set<string>() };
    g.total += 1;
    if (li.dataFidelity === "macro_lump_sum") {
      g.lumps += 1;
      g.lumpProjects.add(li.projectId);
    }
    byCode.set(li.itemId, g);
  }
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const out: DataHealthFinding[] = [];
  for (const [code, g] of byCode) {
    if (g.lumps < LUMP_SHARE_MIN_LINES || g.lumps / g.total < LUMP_SHARE_MIN_RATIO) continue;
    const unitCount = g.total - g.lumps;
    out.push({
      type: "lump_share",
      severity: FINDING_SEVERITY.lump_share,
      title: `${code}: ${g.lumps} of ${g.total} recorded lines are combined-line lumps`,
      detail:
        `Lump-marked lines are honestly excluded from price statistics, so this code's usable history rests on ` +
        `${unitCount} unit-price observation${unitCount === 1 ? "" : "s"}. ` +
        "Nothing to fix on existing rows — but expect low confidence until cleaner bids arrive.",
      projects: [...g.lumpProjects]
        .map((id) => projectById.get(id))
        .filter((p): p is Project => !!p)
        .map(refOf),
      code,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// (7) Missing / unparseable bid dates (un-escalatable observations)
// ---------------------------------------------------------------------------

function missingBidDateFindings(projects: readonly Project[]): DataHealthFinding[] {
  const out: DataHealthFinding[] = [];
  for (const p of projects) {
    if (isUsableBidDate(p.bidDate)) continue;
    out.push({
      type: "missing_bid_date",
      severity: FINDING_SEVERITY.missing_bid_date,
      title: `${p.name || "Unnamed"}: ${p.bidDate ? `bid date "${p.bidDate}" is unusable` : "no bid date"}`,
      detail:
        "An observation without a usable date can never be escalation-adjusted, and history reports " +
        "cannot order it honestly. Set the bid date on the project's STEP 1.",
      projects: [refOf(p)],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// (8) Price-jump detection across bids over time, per (code, canonical unit).
//     FLAG-ONLY. Consumes the TRUSTED pool from aggregateTrustedHistory —
//     validity-screened, alias-folded, IQR outliers already set aside — so a
//     jump is a real discontinuity between bids that each look internally fine.
// ---------------------------------------------------------------------------

function priceJumpFindings(
  observations: readonly PriceObservation[],
  worldLabel: string,
  projects: readonly Project[]
): DataHealthFinding[] {
  // Re-pool the trusted observations per (code, canonical unit) ACROSS
  // sectors — a discontinuity over time is judged on the whole pool, same
  // pooling the outlier screen uses.
  const pools = new Map<string, { code: string; uom: string; obs: PriceObservation[] }>();
  for (const [code, stats] of aggregateTrustedHistory(observations)) {
    for (const stat of stats) {
      const key = `${code} ${stat.uom}`;
      const pool = pools.get(key) ?? { code, uom: stat.uom, obs: [] };
      pool.obs.push(...stat.observations); // trusted only; flaggedOutliers stay out
      pools.set(key, pool);
    }
  }

  const out: DataHealthFinding[] = [];
  for (const { code, uom, obs } of pools.values()) {
    const dated = obs
      .filter((o) => isUsableBidDate(o.bidDate))
      .sort((a, b) => a.bidDate.localeCompare(b.bidDate));
    if (dated.length < PRICE_JUMP_MIN_GROUP_SIZE) continue;

    const jumps: string[] = [];
    const names = new Set<string>();
    for (let i = 1; i < dated.length; i++) {
      const prev = dated[i - 1];
      const next = dated[i];
      if (prev.bidDate === next.bidDate) continue; // a same-day spread is not a move over time
      if (prev.unitPrice <= 0 || next.unitPrice <= 0) continue; // deduction lines are not jump material
      const ratio = next.unitPrice / prev.unitPrice;
      if (ratio <= PRICE_JUMP_FENCE && ratio >= 1 / PRICE_JUMP_FENCE) continue;
      const factor = ratio >= 1 ? ratio : 1 / ratio;
      // The pool spans sectors (the outlier screen's locked pooling), so name
      // each side's sector — a cross-sector "jump" may be a sector price band,
      // and the human should see that explanation without digging.
      const side = (o: PriceObservation) =>
        `${currency.format(o.unitPrice)} (${o.projectName || "Unnamed"}${o.marketSector ? `, ${o.marketSector}` : ""}, ${o.bidDate})`;
      jumps.push(`${side(prev)} → ${side(next)} — ${factor.toFixed(1)}× ${ratio >= 1 ? "up" : "down"}`);
      if (prev.projectName) names.add(prev.projectName);
      if (next.projectName) names.add(next.projectName);
    }
    if (jumps.length === 0) continue;
    out.push({
      type: "price_jump",
      severity: FINDING_SEVERITY.price_jump,
      title: `${code} (${uom || "no UOM"}) moved more than ${PRICE_JUMP_FENCE}× between bids`,
      detail:
        `${worldLabel}:\n${jumps.join("\n")}\n` +
        "Flag-only: every observation stays on record. A move this size usually means a unit or " +
        "data-entry issue in one of the bids, not escalation — verify against the source workbooks.",
      projects: refsForNames(names, projects),
      code,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<DataHealthSeverity, number> = { high: 0, medium: 1, low: 2 };

/**
 * Runs every audit over the supplied inputs and returns the full company-wide
 * findings list, severity-ordered (high first), stable within a severity by
 * type then title. Both surfaces consume this one list — the project strip
 * filters it with `findingsForProject`.
 */
export function computeDataHealth(inputs: DataHealthInputs): DataHealthFinding[] {
  const findings = [
    ...duplicateImportFindings(inputs.projects, inputs.estimateTotals),
    ...unitConflictFindings(inputs.step4Observations, "step4", inputs.projects),
    ...unitConflictFindings(inputs.step23Observations, "step23", inputs.projects),
    ...unmappedLineFindings(inputs.lineItems, inputs.projects),
    ...missingBidDateFindings(inputs.projects),
    ...priceJumpFindings(inputs.step4Observations, "As-bid STEP 4 prices", inputs.projects),
    ...priceJumpFindings(inputs.step23Observations, "As-bid GC/Site-Ops rates", inputs.projects),
    ...nearDuplicateFindings(inputs.customDefs, inputs.additions),
    ...lumpShareFindings(inputs.lineItems, inputs.projects),
    ...missingAnswerFindings(inputs.projects),
  ];
  return findings.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.type.localeCompare(b.type) ||
      a.title.localeCompare(b.title)
  );
}

/** The project workspace strip's view: only findings that involve the given
 *  project (same engine, filtered — the locked two-surfaces decision). */
export function findingsForProject(
  findings: readonly DataHealthFinding[],
  projectId: string
): DataHealthFinding[] {
  return findings.filter((f) => f.projects.some((p) => p.id === projectId));
}
