/**
 * step23FormulaPatterns.ts — per-line formula/write-shape classification for
 * the "STEP 2 - GCs" and "STEP 3 - SITE OPS" sheets (Excel Round-Trip Phase 1).
 *
 * Single source of truth for the live-export write grammar, shared by:
 *  1. the live exporter (Phase 2) — which cells to write as VALUES (estimator
 *     dials) vs which formulas to keep/emit so the workbook recalcs offline;
 *  2. the re-upload dial extractor (Phase 4) — which cells to read back
 *     (input cells only; computed cells are never read back);
 *  3. imported-bid reactivation (import roadmap item 2) — the named second
 *     consumer: classifying a finished bid's STEP 2/3 rows against these same
 *     patterns recovers its dials.
 *
 * Reconciliation rule (plan-of-record, sign-offs 2026-06-12): every qty-area
 * cell is either an app INPUT — written as a value, editable in Excel, read
 * back on re-upload — or app-COMPUTED — carrying a formula in the template's
 * own grammar whose drivers are app inputs. Where the blank template's native
 * cell shape disagrees with the engine's driver model, the ENGINE wins
 * (calculations.ts is the sole math authority), expressed only in
 * template-native patterns. Each native≠write divergence below carries its
 * sign-off.
 *
 * Forensic ground truth (probe: scripts/probe-step23-formulas.cjs against the
 * committed template; CI drift guard: step23-formula-patterns-sync.test.ts):
 *   staffHours : F = $J$5*4.33*E{r}*40   E = utilization fraction, H = rate
 *   superQty   : F = $J$5*E{r}           E = su utilization fraction, H = rate
 *   monthly    : F = $J$5                H = rate
 *   weekly     : F = $J$5*4              H = rate   (native-only; never emitted)
 *   sqft       : F = J8                  H = rate
 *   perSF3000  : F = J8/3000             H = rate
 *   input      : F = typed value         H = rate/amount
 * Dials: $J$5 = duration months ← 'STEP 1'!D28; $J$8 = square footage
 * ← 'STEP 1'!D12 (STEP 3's J8 routes via 'STEP 4 - ESTIMATE'!K8).
 */

import {
  STAFF_ROLE_DEFAULTS,
  OPERATIONAL_EXPENSE_DEFAULTS,
  EQUIPMENT_DEFAULTS,
  GC_MANUAL_DEFAULTS,
  SITE_OPS_DYNAMIC_DEFAULTS,
  SITE_OPS_MANUAL_DEFAULTS,
} from "./constants";

export type Step23SheetName = "STEP 2 - GCs" | "STEP 3 - SITE OPS";

/** Shape a qty-area cell group can natively carry in the blank template. */
export type QtyPatternKind =
  | "staffHours"
  | "superQty"
  | "monthly"
  | "weekly"
  | "sqft"
  | "perSF3000"
  | "input";

/**
 * Shape the live exporter writes. "weekly" is never emitted (its only native
 * row — Dumpsters — is a lump-sum input in the app). "pctFrozen" is the two
 * %-of-estimate lines kept template-faithful as values (F = effective pct,
 * H = estimate basis — the template's own circularity break, findings §5.2).
 */
export type QtyWriteKind = Exclude<QtyPatternKind, "weekly"> | "pctFrozen";

export interface Step23LinePattern {
  sheet: Step23SheetName;
  /** Col-C criterion code — unique across both sheets (asserted at init). */
  code: string;
  /** For findings/test readability. */
  label: string;
  /** What the blank committed template natively carries in the qty cell. */
  native: QtyPatternKind;
  /** What the live exporter writes/keeps (engine-authoritative). */
  write: QtyWriteKind;
  /** Present iff native ≠ write — the architect sign-off for the divergence. */
  signOff?: string;
}

// ─── Native/write divergences (architect sign-offs, 2026-06-12) ─────────────

const SIGN_OFFS: Record<string, { native: QtyPatternKind; write: QtyWriteKind; signOff: string }> = {
  // Engine drives Small Tools by duration × su utilization ("Bound to
  // Superintendent"); the template's native F36==$J$5 would miss whenever su
  // utilization ≠ 100%. Emit the template's own Fuel-line pattern instead.
  "01-1000.001": { native: "monthly", write: "superQty", signOff: "A: emit superQty (Fuel-row pattern) so the row ties the engine and stays live on both dials" },
  // The app's input model for the equipment trio is a single typed lump-sum
  // dollar amount (gc_equipment_overrides) — the template's rate×duration
  // formulas compute numbers the app has no input for. Plain editable values.
  "01-5130.001": { native: "weekly", write: "input", signOff: "B: lump-sum input cells (app input model); native weekly rate formula not emitted" },
  "01-5140.001": { native: "monthly", write: "input", signOff: "B: lump-sum input cells (app input model); native monthly rate formula not emitted" },
  "01-5170.001": { native: "monthly", write: "input", signOff: "B: lump-sum input cells (app input model); native monthly rate formula not emitted" },
  // Engine auto-drives Safety & Material Hoist qty = duration months; the
  // template leaves F as a typed input. Emit the monthly pattern so the rows
  // recalc with duration like every other duration-bound line.
  "02-9015.001": { native: "input", write: "monthly", signOff: "C: emit monthly pattern — engine auto-drives qty by duration" },
  "02-9405.001": { native: "input", write: "monthly", signOff: "C: emit monthly pattern — engine auto-drives qty by duration" },
  // Progress Cleaning is a typed hours quantity in the app; the template's
  // native staffHours formula would force a synthetic back-derived
  // utilization. Hours stay an honest editable value.
  "02-9010.001": { native: "staffHours", write: "input", signOff: "D: typed hours value overwrites native staffHours formula (app input model)" },
  "02-9010.002": { native: "staffHours", write: "input", signOff: "D: typed hours value overwrites native staffHours formula (app input model)" },
  // The two %-of-estimate lines stay template-faithful frozen values
  // (locked decision 1 — the template's own circularity break).
  "01-0610.001": { native: "input", write: "pctFrozen", signOff: "locked decision 1: %-line frozen template-faithful (F=pct, H=basis)" },
  "01-1600.001": { native: "input", write: "pctFrozen", signOff: "locked decision 1: %-line frozen template-faithful (F=pct, H=basis)" },
};

// ─── Pattern table (derived from the line configs → coverage by construction) ─

function makeLine(
  sheet: Step23SheetName,
  code: string,
  label: string,
  defaultNative: QtyPatternKind,
  defaultWrite: QtyWriteKind
): Step23LinePattern {
  const override = SIGN_OFFS[code];
  if (override) {
    return { sheet, code, label, native: override.native, write: override.write, signOff: override.signOff };
  }
  return { sheet, code, label, native: defaultNative, write: defaultWrite };
}

function operationalKind(driver: "superintendent" | "fixed" | "sqftPer3000"): "superQty" | "monthly" | "perSF3000" {
  switch (driver) {
    case "superintendent": return "superQty";
    case "fixed": return "monthly";
    case "sqftPer3000": return "perSF3000";
  }
}

export const STEP23_LINE_PATTERNS: readonly Step23LinePattern[] = [
  // STEP 2 — staff roles (template rows 12–14, 27–31)
  ...STAFF_ROLE_DEFAULTS.map((cfg) =>
    makeLine("STEP 2 - GCs", cfg.code, cfg.label, "staffHours", "staffHours")
  ),
  // STEP 2 — operational/gcMonthly auto-driven lines
  ...OPERATIONAL_EXPENSE_DEFAULTS.map((cfg) =>
    makeLine("STEP 2 - GCs", cfg.code, cfg.description, operationalKind(cfg.quantityDriver), operationalKind(cfg.quantityDriver))
  ),
  // STEP 2 — equipment trio (lump-sum app inputs; see sign-off B)
  ...EQUIPMENT_DEFAULTS.map((cfg) =>
    makeLine("STEP 2 - GCs", cfg.code, cfg.label, "input", "input")
  ),
  // STEP 2 — manual/design lines (typed values; %-lines via sign-off table)
  ...GC_MANUAL_DEFAULTS.map((cfg) =>
    makeLine("STEP 2 - GCs", cfg.code, cfg.label, "input", "input")
  ),
  // STEP 3 — dynamic lines (Temp Protection natively sqft; Safety/Hoist via sign-off C)
  ...SITE_OPS_DYNAMIC_DEFAULTS.map((cfg) =>
    makeLine(
      "STEP 3 - SITE OPS",
      cfg.code,
      cfg.label,
      cfg.quantityDriver === "squareFootage" ? "sqft" : "input",
      cfg.quantityDriver === "squareFootage" ? "sqft" : "monthly"
    )
  ),
  // STEP 3 — manual lines (typed values; progress cleaning via sign-off D)
  ...SITE_OPS_MANUAL_DEFAULTS.map((cfg) =>
    makeLine("STEP 3 - SITE OPS", cfg.code, cfg.label, "input", "input")
  ),
];

export const STEP23_PATTERN_BY_CODE: ReadonlyMap<string, Step23LinePattern> = (() => {
  const map = new Map<string, Step23LinePattern>();
  for (const line of STEP23_LINE_PATTERNS) {
    if (map.has(line.code)) {
      // Codes are unique across both sheets (STEP 2 = 01-*, STEP 3 = 02-*).
      // ⚠ Never join this map against STEP 4 itemIds — "02-4100.002" is also
      // a STEP 4 linked-row itemId (unrelated line, P5 collision note).
      throw new Error(`Duplicate STEP 2/3 criterion code in pattern table: ${line.code}`);
    }
    map.set(line.code, line);
  }
  return map;
})();

// ─── Formula text per pattern ────────────────────────────────────────────────

/**
 * The formula text (no leading "=") a pattern carries in the qty cell at a
 * given row, or null when the qty cell is a typed value. Used both to verify
 * the template's native shapes (sync test) and to emit live formulas
 * (Phase 2). Single grammar — emitter and verifier cannot drift.
 */
export function qtyFormulaFor(kind: QtyPatternKind | QtyWriteKind, row: number): string | null {
  switch (kind) {
    case "staffHours": return `$J$5*4.33*E${row}*40`;
    case "superQty": return `$J$5*E${row}`;
    case "monthly": return "$J$5";
    case "weekly": return "$J$5*4";
    case "sqft": return "J8";
    case "perSF3000": return "J8/3000";
    case "input":
    case "pctFrozen": return null;
  }
}

/**
 * Which cells of a line are app INPUTS under its write shape — written as
 * values on export, editable in Excel, read back on re-upload. Cells not
 * listed are computed (formula-carrying) and must never be written as values
 * or read back.
 *  - E "utilization"/"suUtilization": the fraction (e.g. 0.5), not percent.
 *  - F "qty": typed/engine quantity; F "pct": effective % (pctFrozen only).
 *  - H "rate": unit rate; H "amount": lump-sum dollars; H "basis": the
 *    estimate total the %-lines multiply against.
 */
export interface QtyInputCells {
  E: "utilization" | "suUtilization" | null;
  F: "qty" | "pct" | null;
  H: "rate" | "amount" | "basis";
}

export function inputCellsFor(write: QtyWriteKind): QtyInputCells {
  switch (write) {
    case "staffHours": return { E: "utilization", F: null, H: "rate" };
    case "superQty": return { E: "suUtilization", F: null, H: "rate" };
    case "monthly":
    case "sqft":
    case "perSF3000": return { E: null, F: null, H: "rate" };
    case "input": return { E: null, F: "qty", H: "rate" };
    case "pctFrozen": return { E: null, F: "pct", H: "basis" };
  }
}

// ─── Dial cells ──────────────────────────────────────────────────────────────

/**
 * The two project dials each sheet reads. The exporter must leave these
 * formulas native (and write the duration VALUE to 'STEP 1'!D28 — the engine's
 * durationMonths replaces the template's YEARFRAC, which the current exporter
 * already breaks by writing D10/D11 as text). 'STEP 1'!D12 carries the
 * square-footage value (already written today).
 */
export const STEP23_DIAL_CELLS: Record<Step23SheetName, { J5: string; J8: string }> = {
  "STEP 2 - GCs": { J5: "'STEP 1 - PROJECT DATA'!D28", J8: "'STEP 1 - PROJECT DATA'!D12" },
  "STEP 3 - SITE OPS": { J5: "'STEP 1 - PROJECT DATA'!D28", J8: "'STEP 4 - ESTIMATE'!K8" },
};

/** STEP 1 dial coordinates (write targets for the values feeding the chain). */
export const STEP1_DURATION_CELL = "D28";
export const STEP1_SQFT_CELL = "D12";
