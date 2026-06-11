/**
 * step23Normalization.ts — read-time resolution of an imported bid's bare
 * STEP 2/3 codes to the app's deterministic GC/Site-Ops codes (Import past
 * bids, Phase 3 Slice 3).
 *
 * Legacy bids write bare base codes on STEP 2/3 (`01-0410 Sr Superintendent`);
 * the app's calculators key the same lines by deterministic suffixed codes
 * (`01-0410.001`). This module derives the mapping as a PURE function over the
 * stored verbatim lines — nothing is persisted, the protected
 * `imported_step23_lines` JSONB is never written, and normalization is
 * LABELING only: the imported dollars ride the linked STEP 4 rows and must
 * never move (AGENTS.md, architect 2026-06-10).
 *
 * Resolution never guesses (forks locked 2026-06-10):
 *  - a base claimed by exactly ONE app line resolves mechanically (the CARE
 *    probe: 68 of 72 bases are 1:1);
 *  - a shared base (e.g. `02-9010` Progress Cleaning Payroll vs Hired)
 *    resolves only on an exact normalized-description match against the def's
 *    label — also matching the label with its trailing parenthetical
 *    annotation stripped ("Temp Office (Monthly)" → "temp office") — and only
 *    when exactly one candidate matches;
 *  - anything else returns null and the line stays bare and visible
 *    (CARE's hand-inserted "Demolition - Openings in CMU" is the honest case);
 *  - EXCEPT: a line carrying an estimator-assigned code from the import
 *    review gate (`assignedCode`, locked 2026-06-10) resolves to that def
 *    directly — assignment wins over description matching.
 *
 * The workbook's own BLI bridge was probed and is provably redundant here:
 * all 72 of CARE's STEP 2/3 SUMIF mappings agree with the app's line defs,
 * and the bridge cannot split shared bases (both `02-9010` lines roll up to
 * the same Procore code) — descriptions can.
 */

import {
  STAFF_ROLE_DEFAULTS,
  OPERATIONAL_EXPENSE_DEFAULTS,
  GC_MANUAL_DEFAULTS,
  EQUIPMENT_DEFAULTS,
  SITE_OPS_DYNAMIC_DEFAULTS,
  SITE_OPS_MANUAL_DEFAULTS,
} from "./constants";
import type { ImportedSheetLine, ImportedStep23Lines } from "@/types/db";
import type { PriceObservation } from "./priceHistory";
import { observationExclusion } from "./historyTrust";
import {
  statusOf,
  resolveMergeTarget,
  type CatalogLifecycleStatus,
} from "./catalogLifecycle";

/** A deterministic GC/Site-Ops line a bare STEP 2/3 code can resolve to. */
export interface Step23LineDef {
  /** Deterministic code, e.g. "01-0410.001". */
  code: string;
  /** The app's display label for the line, e.g. "Sr Superintendent". */
  label: string;
  /** Lifecycle state (Catalog Manager Phase 1). Absent === 'active'; built-ins
   *  never set it. A 'merged' def redirects to `mergedInto` at render time. */
  status?: CatalogLifecycleStatus;
  /** Winning code when `status === 'merged'`. */
  mergedInto?: string | null;
}

const DETERMINISTIC_RE = /^(\d{2}-\d{4})\.\d{3}$/;
const BARE_RE = /^\d{2}-\d{4}$/;

/** Lowercase, trim, collapse internal whitespace. */
function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

/** "Temp Office (Monthly)" → "Temp Office" — app labels carry trailing
 *  parenthetical annotations the bid's hand-typed descriptions omit. */
function stripTrailingParenthetical(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, "");
}

/**
 * Every GC/Site-Ops line the app defines, from the SAME constants arrays the
 * calculators read — the resolver can never drift from the app's own codes.
 */
export const STEP23_LINE_DEFS: Step23LineDef[] = [
  ...STAFF_ROLE_DEFAULTS.map((r) => ({ code: r.code, label: r.label })),
  ...OPERATIONAL_EXPENSE_DEFAULTS.map((e) => ({ code: e.code, label: e.description })),
  ...GC_MANUAL_DEFAULTS.map((g) => ({ code: g.code, label: g.label })),
  ...EQUIPMENT_DEFAULTS.map((e) => ({ code: e.code, label: e.label })),
  ...SITE_OPS_DYNAMIC_DEFAULTS.map((d) => ({ code: d.code, label: d.label })),
  ...SITE_OPS_MANUAL_DEFAULTS.map((s) => ({ code: s.code, label: s.label })),
];

/** True when a code has the deterministic GC/Site-Ops shape (NN-NNNN.NNN). */
export function isStep23DeterministicCode(code: string): boolean {
  return DETERMINISTIC_RE.test(code);
}

/** True when a code is one of the app's built-in GC/Site-Ops lines — the
 *  codes a custom def may never shadow (db.ts rejects them at mint time). */
export function isBuiltInStep23Code(code: string): boolean {
  return builtInLookups.byCode.has(code);
}

interface Step23DefLookups {
  byCode: Map<string, Step23LineDef>;
  byBase: Map<string, Step23LineDef[]>;
}

function buildLookups(defs: readonly Step23LineDef[]): Step23DefLookups {
  const byCode = new Map<string, Step23LineDef>();
  const byBase = new Map<string, Step23LineDef[]>();
  for (const def of defs) {
    if (byCode.has(def.code)) continue; // first claim wins (built-ins precede customs)
    byCode.set(def.code, def);
    const m = DETERMINISTIC_RE.exec(def.code);
    if (!m) continue;
    const list = byBase.get(m[1]) ?? [];
    list.push(def);
    byBase.set(m[1], list);
  }
  return { byCode, byBase };
}

const builtInLookups = buildLookups(STEP23_LINE_DEFS);

/**
 * Memoized built-in + custom overlay (gate Phase 2). Custom defs join BOTH
 * lookup paths — assigned/deterministic codes AND base/description matching —
 * which is what makes a minted code label matching lines in every stored bid
 * retroactively. Collision rule (locked): a custom code that duplicates a
 * built-in is IGNORED here — the built-in def wins, so if constants.ts later
 * ships a code a user already minted, every line shows the built-in label (the
 * conflict surfaces, nothing silently merges). Malformed custom codes resolve
 * nothing. NOTE a custom def under a previously 1:1 base makes that base
 * SHARED — its lines then need an exact description match, same as any shared
 * base (the resolver never guesses between two claims).
 */
const overlayCache = new WeakMap<readonly Step23LineDef[], Step23DefLookups>();

function lookupsFor(extraDefs?: readonly Step23LineDef[]): Step23DefLookups {
  if (!extraDefs || extraDefs.length === 0) return builtInLookups;
  let lookups = overlayCache.get(extraDefs);
  if (!lookups) {
    const usable = extraDefs.filter((d) => DETERMINISTIC_RE.test(d.code));
    lookups = buildLookups([...STEP23_LINE_DEFS, ...usable]);
    overlayCache.set(extraDefs, lookups);
  }
  return lookups;
}

/**
 * Resolves one imported STEP 2/3 line (as-bid code + description) to the
 * app's deterministic GC/Site-Ops line, or null when no certain match exists.
 *
 * An estimator-assigned code from the import review gate (`assignedCode`,
 * locked 2026-06-10) WINS over description matching — but only when it names
 * a known def; a stale assignment (e.g. a def later removed) falls through to
 * normal resolution rather than fabricating a line.
 *
 * `extraDefs` (gate Phase 2) overlays user-minted custom defs on the built-ins
 * — see `lookupsFor` for the collision rule (built-in always beats custom).
 * Pure: same inputs, same answer; the overlay is merely memoized per array.
 *
 * Lifecycle (Catalog Manager Phase 1): once a candidate def is found by any
 * path (assignment, deterministic pass-through, or base/description), a MERGED
 * def redirects to its winner via `resolveMergeTarget`, so every stored bid
 * shows the winning code at render time with nothing rewritten. A RETIRED def
 * still resolves to itself — old lines keep their label, history intact.
 */
export function resolveStep23Line(
  code: string,
  description: string,
  assignedCode?: string,
  extraDefs?: readonly Step23LineDef[]
): Step23LineDef | null {
  const { byCode, byBase } = lookupsFor(extraDefs);
  // Every return follows a merge redirect to the winning def (one hop after
  // chain-collapse; the guard tolerates accidental chains).
  const resolve = (def: Step23LineDef | null) => resolveMergeTarget(def, byCode);

  if (assignedCode) {
    const assigned = byCode.get(assignedCode.trim());
    if (assigned) return resolve(assigned);
  }

  const trimmed = code.trim();

  // Already deterministic and known → itself (future re-imports of app exports).
  if (DETERMINISTIC_RE.test(trimmed)) return resolve(byCode.get(trimmed) ?? null);

  if (!BARE_RE.test(trimmed)) return null;
  const candidates = byBase.get(trimmed);
  if (!candidates) return null;
  if (candidates.length === 1) return resolve(candidates[0]);

  // Shared base — exact normalized-description match, exactly one hit.
  const desc = normalize(description);
  if (desc === "") return null;
  const hits = candidates.filter(
    (c) => desc === normalize(c.label) || desc === normalize(stripTrailingParenthetical(c.label))
  );
  return hits.length === 1 ? resolve(hits[0]) : null;
}

/**
 * The defs a picker should OFFER (gate Phase 3): the built-ins plus only the
 * ACTIVE custom overlay defs, code-ordered. Retired and merged customs keep
 * labeling their old lines through `resolveStep23Line` but leave every dropdown
 * here. Malformed and built-in-shadowing customs are dropped (the resolver's
 * own collision rule). Built-ins are always active. Returns a fresh array.
 */
export function activeStep23Defs(extraDefs?: readonly Step23LineDef[]): Step23LineDef[] {
  const usableExtras = (extraDefs ?? []).filter(
    (d) =>
      DETERMINISTIC_RE.test(d.code) &&
      statusOf(d) === "active" &&
      !builtInLookups.byCode.has(d.code)
  );
  return [...STEP23_LINE_DEFS, ...usableExtras].sort((a, b) =>
    a.code.localeCompare(b.code, undefined, { numeric: true })
  );
}

/**
 * The code the import gate's "create new code" mini-form pre-fills (gate
 * Phase 3): the as-bid code's base with the next free `.NNN` suffix — one
 * past the HIGHEST suffix any known def (built-in + custom) claims under that
 * base, never filling gaps (a gap may be a future built-in's slot; see the
 * plan's suffix-collision risk). Returns "" when the as-bid code carries no
 * usable base (non-code junk) or the suffix space is exhausted — the
 * estimator types the code by hand.
 */
export function suggestNextStep23Code(
  asBidCode: string,
  extraDefs?: readonly Step23LineDef[]
): string {
  const trimmed = asBidCode.trim();
  const base = BARE_RE.test(trimmed) ? trimmed : DETERMINISTIC_RE.exec(trimmed)?.[1] ?? "";
  if (!base) return "";
  const { byBase } = lookupsFor(extraDefs);
  let highest = 0;
  for (const def of byBase.get(base) ?? []) {
    const suffix = Number(def.code.slice(-3));
    if (suffix > highest) highest = suffix;
  }
  if (highest >= 999) return "";
  return `${base}.${String(highest + 1).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// Staff-rate mining (Slice C) — stored STEP 2/3 lines → PriceObservations
// ---------------------------------------------------------------------------

/** One imported project's stored STEP 2/3 payload with its project context. */
export interface Step23HistorySource {
  payload: ImportedStep23Lines;
  projectName: string;
  /** "YYYY-MM-DD" bid date ("" when unset). */
  bidDate: string;
  marketSector: string;
}

/**
 * True when a stored line is an actual bid decision worth mining (fork F-B,
 * locked 2026-06-10): the line was USED (qty ≠ 0) at a real rate (rate ≠ 0),
 * and is not a %-UOM row — those carry the project base in the rate column
 * (e.g. Safety Consultant qty 0.0002 × $16,000,000), not a unit rate.
 * Zero-qty template rows merely echo that era's default and are skipped.
 * The rules themselves live in historyTrust (fidelity Phase 3, single
 * authority) — this is the F-B contract delegating to that one copy.
 */
function isMinableLine(line: ImportedSheetLine): boolean {
  return (
    observationExclusion({
      unitPrice: line.rate,
      uom: line.uom ?? "",
      qty: line.qty,
    }) === null
  );
}

/**
 * Flattens stored `imported_step23_lines` payloads into Slice 2's
 * PriceObservation shape, keyed by the RESOLVED deterministic code (a line
 * that doesn't resolve has no code to file under and is skipped — it stays
 * visible in the panel instead). Feed the result to `aggregatePriceHistory`;
 * REPORT-only, same as the catalog price history.
 *
 * `extraDefs` (gate Phase 2): lines resolving to a custom code file under it —
 * report-only by construction, since a custom code has no rate_card row and
 * therefore no ADOPT surface on /rates.
 */
export function step23Observations(
  sources: readonly Step23HistorySource[],
  extraDefs?: readonly Step23LineDef[]
): PriceObservation[] {
  const out: PriceObservation[] = [];
  for (const src of sources) {
    const lines = [...src.payload.step2Lines, ...src.payload.step3Lines];
    for (const line of lines) {
      if (!isMinableLine(line)) continue;
      // Assignment = resolution (locked 2026-06-10): an assigned line files
      // its observations under the assigned code, same minable filter.
      const resolved = resolveStep23Line(line.code, line.description, line.assignedCode, extraDefs);
      if (!resolved) continue;
      out.push({
        itemId: resolved.code,
        unitPrice: line.rate,
        uom: (line.uom ?? "").trim().toUpperCase(),
        projectName: src.projectName,
        bidDate: src.bidDate,
        marketSector: src.marketSector,
        // Quantity rides along (fidelity Phase 3) so historyTrust can apply
        // its zero-qty rule itself — isMinableLine already enforced it here.
        // No dataFidelity: STEP 2/3 payload lines carry no lump marker today
        // (the "combined" mark is a STEP 4 line-item flag). If a later phase
        // adds one to ImportedSheetLine, surface it here or lumps would pass
        // the trust screen on this feed.
        qty: line.qty,
      });
    }
  }
  return out;
}
