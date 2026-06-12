/**
 * roundTrip.ts — re-upload extraction + delta engine (Excel Round-Trip
 * Phase 4; plan locked decisions 3 & 5). PURE: no DB, no DOM, no UI.
 *
 * Pipeline: stamped workbook buffer → `extractRoundTrip` (stamp + the
 * workbook's INPUT state) → `computeRoundTripDelta` (three-way classification
 * of every field: exported baseline vs Excel vs current app state).
 *
 * Only INPUT cells are ever read back (pattern-table `inputCellsFor` — the
 * same contract the live exporter writes by). Computed cells are never
 * trusted: the engine recomputes from the dials, and the Phase 3 recalc
 * golden proves engine ↔ workbook agreement.
 *
 * Second consumer (by design): imported-bid reactivation (import roadmap
 * item 2) reuses the extraction half against finished bids.
 */

import JSZip from "jszip";
import {
  readStampFromZip,
  RoundTripStamp,
  RoundTripState,
  BaselineRow,
  BaselineStep23Inputs,
  WrongProjectError,
  ROUNDTRIP_CODE_RE,
} from "./roundTripStamp";
import { loadWorkbookModelFromZip, WorkbookModel, SheetModel } from "./formulaEvaluator";
import {
  STEP23_LINE_PATTERNS,
  inputCellsFor,
  type Step23SheetName,
} from "./step23FormulaPatterns";
import {
  ESTIMATE_MODIFIERS,
  STAFF_ROLE_DEFAULTS,
  isLinkedDivisionRow,
} from "./constants";
import type { Project } from "@/types/db";

// ─── Errors ──────────────────────────────────────────────────────────────────

export class ImportedProjectRoundTripError extends Error {
  constructor() {
    super(
      "Imported bids can't accept Excel re-uploads — the original STEP 2/3 detail isn't app-modeled. Re-upload is available for app-born projects."
    );
    this.name = "ImportedProjectRoundTripError";
  }
}

/** Gate: round-trip is for app-born projects only (locked decision 6),
 * uploaded into the SAME project the file was exported from. */
export function assertRoundTripAllowed(stamp: RoundTripStamp, project: Project): void {
  if (project.isImported) throw new ImportedProjectRoundTripError();
  if (stamp.projectId !== project.id) {
    throw new WrongProjectError(stamp.projectName, stamp.projectId);
  }
}

// ─── Extraction ──────────────────────────────────────────────────────────────

const STEP1 = "STEP 1 - PROJECT DATA";
const STEP4 = "STEP 4 - ESTIMATE";
const CODE_RE = ROUNDTRIP_CODE_RE;
const MODIFIER_CODES = new Set(ESTIMATE_MODIFIERS.map((m) => m.code));

export interface RoundTripExtract {
  stamp: RoundTripStamp;
  state: RoundTripState;
  /** Non-fatal extraction problems (text in numeric cells, missing rows…) —
   * surfaced in the preview, never silently dropped. */
  issues: string[];
}

/** Cached/literal numeric read: formula cells contribute their cached <v>
 * (Excel refreshes caches on save). Returns null for non-numeric content. */
function cellNumber(sheet: SheetModel | undefined, ref: string): number | null {
  const v = sheet?.get(ref)?.v;
  if (typeof v === "number") return v;
  if (v === undefined || v === "") return 0; // blank input cell = 0
  return null;
}

function cellText(sheet: SheetModel | undefined, ref: string): string {
  const v = sheet?.get(ref)?.v;
  return v === undefined ? "" : String(v);
}

/** code → row map from a sheet's col C (criterion/itemId codes). */
function codeRowsOf(sheet: SheetModel): Map<string, number[]> {
  const rows = new Map<string, number[]>();
  for (const [ref, cell] of sheet) {
    if (!ref.startsWith("C") || !/^C\d+$/.test(ref)) continue;
    const code = String(cell.v ?? "").trim();
    if (!CODE_RE.test(code)) continue;
    const row = parseInt(ref.slice(1), 10);
    const list = rows.get(code) ?? [];
    list.push(row);
    rows.set(code, list);
  }
  for (const list of rows.values()) list.sort((a, b) => a - b);
  return rows;
}

/** Extracts the workbook's input state — the same shape as the stamp baseline. */
export function extractRoundTripState(model: WorkbookModel, issues: string[]): RoundTripState {
  // A missing sheet must REFUSE, never read-as-zero: cellNumber treats absent
  // cells as 0 (blank input = 0), so a deleted/renamed STEP 1 tab would
  // otherwise extract every dial and modifier rate as a clean "edited → 0".
  for (const required of [STEP1, "STEP 2 - GCs", "STEP 3 - SITE OPS", STEP4]) {
    if (!model.get(required)) {
      throw new Error(
        `Sheet "${required}" is missing from the uploaded workbook — re-upload the full exported file with all sheets intact.`
      );
    }
  }

  // ── STEP 4 grid rows (linked + modifier rows excluded — computed/config) ──
  const step4 = model.get(STEP4)!;
  const step4Rows: BaselineRow[] = [];
  const rowNums: { code: string; row: number }[] = [];
  for (const [code, rows] of codeRowsOf(step4)) {
    if (isLinkedDivisionRow(code) || MODIFIER_CODES.has(code)) continue;
    for (const row of rows) rowNums.push({ code, row });
  }
  rowNums.sort((a, b) => a.row - b.row);
  for (const { code, row } of rowNums) {
    const qty = cellNumber(step4, `F${row}`);
    const unitPrice = cellNumber(step4, `H${row}`);
    if (qty === null || unitPrice === null) {
      issues.push(`STEP 4 row ${row} (${code}): non-numeric qty/price — row skipped`);
      continue;
    }
    step4Rows.push({
      itemId: code,
      description: cellText(step4, `D${row}`),
      qty,
      unitPrice,
      uom: cellText(step4, `G${row}`),
    });
  }

  // ── STEP 2/3 input cells (pattern-table contract) ──
  const step23Inputs: Record<string, BaselineStep23Inputs> = {};
  const sheetRows: Record<Step23SheetName, Map<string, number[]> | undefined> = {
    "STEP 2 - GCs": model.get("STEP 2 - GCs") && codeRowsOf(model.get("STEP 2 - GCs")!),
    "STEP 3 - SITE OPS": model.get("STEP 3 - SITE OPS") && codeRowsOf(model.get("STEP 3 - SITE OPS")!),
  };
  for (const line of STEP23_LINE_PATTERNS) {
    const sheet = model.get(line.sheet);
    const row = sheetRows[line.sheet]?.get(line.code)?.[0];
    if (!sheet || row === undefined) {
      issues.push(`${line.sheet}: line ${line.code} (${line.label}) not found`);
      continue;
    }
    const inputs = inputCellsFor(line.write);
    const rec: BaselineStep23Inputs = {};
    const read = (col: "E" | "F" | "H"): number | undefined => {
      const n = cellNumber(sheet, `${col}${row}`);
      if (n === null) {
        issues.push(`${line.sheet} ${col}${row} (${line.code} ${line.label}): non-numeric input`);
        return undefined;
      }
      return n;
    };
    if (inputs.E !== null) rec.E = read("E");
    if (inputs.F !== null) rec.F = read("F");
    rec.H = read("H");
    step23Inputs[line.code] = rec;
  }

  // ── STEP 1 dials ──
  const step1 = model.get(STEP1);
  const dial = (ref: string, label: string): number => {
    const n = cellNumber(step1, ref);
    if (n === null) {
      issues.push(`STEP 1 ${ref} (${label}): non-numeric — treated as 0`);
      return 0;
    }
    return n;
  };
  const modifierRates: Record<string, number> = {};
  for (const mod of ESTIMATE_MODIFIERS) {
    modifierRates[mod.key] = dial(mod.step1Cell, mod.label);
  }
  return {
    step4Rows,
    step23Inputs,
    step1: {
      durationMonths: dial("D28", "duration months"),
      squareFootage: dial("D12", "square footage"),
      unitCount: dial("D58", "unit count"),
      modifierRates,
    },
  };
}

/** Reads stamp + input state from an uploaded workbook buffer (the archive
 * is opened ONCE; only the four STEP sheets are parsed). */
export async function extractRoundTrip(buffer: ArrayBuffer | Buffer): Promise<RoundTripExtract> {
  const zip = await JSZip.loadAsync(buffer);
  const stamp = await readStampFromZip(zip);
  const model = await loadWorkbookModelFromZip(
    zip,
    new Set([STEP1, "STEP 2 - GCs", "STEP 3 - SITE OPS", STEP4])
  );
  const issues: string[] = [];
  const state = extractRoundTripState(model, issues);

  // Su utilization is ONE dial in the app but THREE cells in Excel (staff E +
  // the two su-bound operational lines' E — the template's native design).
  // Disagreement is surfaced, never silently resolved.
  const suCode = STAFF_ROLE_DEFAULTS.find((r) => r.key === "su")!.code;
  const suE = state.step23Inputs[suCode]?.E;
  for (const line of STEP23_LINE_PATTERNS) {
    if (line.write !== "superQty" || line.code === suCode) continue;
    const e = state.step23Inputs[line.code]?.E;
    if (suE !== undefined && e !== undefined && Math.abs(e - suE) > 1e-9) {
      issues.push(
        `${line.label} (${line.code}) utilization ${e} disagrees with the Superintendent dial ${suE} — the app binds both to one dial; the Superintendent value wins on apply`
      );
    }
  }
  return { stamp, state, issues };
}

// ─── Delta engine (three-way: baseline vs Excel vs current) ─────────────────

export type DeltaClassification = "edited" | "conflict";

export interface FieldDelta {
  field: string;
  baseline: number | string;
  excel: number | string;
  current: number | string;
  classification: DeltaClassification;
}

export interface RowDelta {
  /** itemId plus ordinal for duplicate codes, e.g. "03-0000.001#0" */
  key: string;
  itemId: string;
  description: string;
  kind: "changed" | "added" | "removed";
  fields?: FieldDelta[];
  /** kind "added": the Excel row needing review (no baseline/current twin). */
  excelRow?: BaselineRow;
  /** kind "removed": the current app row the Excel file no longer carries. */
  currentRow?: BaselineRow;
  /** Both sides moved (three-way row conflict): kind "added" = the app
   * deleted a row Excel edited; kind "removed" = Excel deleted a row the app
   * edited since export. */
  conflict?: boolean;
}

export interface DialDelta extends FieldDelta {
  scope: "step23" | "step1" | "modifier";
  /** STEP 2/3 criterion code (scope "step23") or modifier key. */
  code?: string;
  label: string;
}

export interface RoundTripDelta {
  rowDeltas: RowDelta[];
  dialDeltas: DialDelta[];
  /** Any field where the db moved since export (baseline ≠ current). */
  isStale: boolean;
  hasConflicts: boolean;
}

const NUM_EPS = 1e-9;
/** Dollars-and-cents materiality floor for born-in-Excel rows. Kept EQUAL to
 * the exporter's RECONCILIATION_TOLERANCE (0.01) by value — not imported,
 * because this module stays free of the exporter's JSZip/XML dependencies. */
const DOLLARS_EPS = 0.01;

function valuesEqual(a: number | string, b: number | string): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= NUM_EPS;
  return a === b;
}

/**
 * Three-way field classification:
 *  excel == baseline                      → untouched in Excel: no delta
 *  excel ≠ baseline, baseline == current  → clean Excel edit: "edited"
 *  excel ≠ baseline, excel == current     → convergent: no delta (stale only)
 *  all three differ                       → both sides moved: "conflict"
 */
function classifyField(
  field: string,
  baseline: number | string,
  excel: number | string,
  current: number | string,
  stale: { value: boolean }
): FieldDelta | null {
  if (!valuesEqual(baseline, current)) stale.value = true;
  if (valuesEqual(excel, baseline)) return null;
  if (valuesEqual(excel, current)) return null; // convergent
  const classification: DeltaClassification = valuesEqual(baseline, current) ? "edited" : "conflict";
  return { field, baseline, excel, current, classification };
}

/** itemId#ordinal keys preserving sheet/list order for duplicate codes. */
function keyRows(rows: BaselineRow[]): Map<string, BaselineRow> {
  const seen = new Map<string, number>();
  const out = new Map<string, BaselineRow>();
  for (const row of rows) {
    const n = seen.get(row.itemId) ?? 0;
    seen.set(row.itemId, n + 1);
    out.set(`${row.itemId}#${n}`, row);
  }
  return out;
}

const ZERO_ROW = (itemId: string): BaselineRow => ({
  itemId, description: "", qty: 0, unitPrice: 0, uom: "",
});

export function computeRoundTripDelta(
  excel: RoundTripState,
  baseline: RoundTripState,
  current: RoundTripState
): RoundTripDelta {
  const stale = { value: false };
  const rowDeltas: RowDelta[] = [];
  const dialDeltas: DialDelta[] = [];

  // ── STEP 4 rows ──
  const excelRows = keyRows(excel.step4Rows);
  const baselineRows = keyRows(baseline.step4Rows);
  const currentRows = keyRows(current.step4Rows);
  const allKeys = new Set([...excelRows.keys(), ...baselineRows.keys(), ...currentRows.keys()]);

  for (const key of allKeys) {
    const itemId = key.replace(/#\d+$/, "");
    const e = excelRows.get(key);
    const b = baselineRows.get(key);
    const c = currentRows.get(key);

    if (e && !c) {
      if (!b) {
        // Born in Excel. Only rows CARRYING DOLLARS are additions — the
        // template ships catalog furniture outside the app grid (default
        // rates at qty 0, and even 0.001-qty nudge rows at $0 rates) that
        // contributes nothing and must not phantom into the preview.
        if (Math.abs(e.qty * e.unitPrice) > DOLLARS_EPS) {
          rowDeltas.push({ key, itemId, description: e.description, kind: "added", excelRow: e });
        }
        continue;
      }
      // Exported, app since deleted it
      stale.value = true;
      const excelTouched =
        !valuesEqual(e.qty, b.qty) || !valuesEqual(e.unitPrice, b.unitPrice) || !valuesEqual(e.description, b.description);
      if (excelTouched) {
        rowDeltas.push({ key, itemId, description: e.description, kind: "added", excelRow: e, conflict: true });
      }
      continue;
    }
    if (!e && c) {
      if (!b) {
        // Added in the app after export — Excel never saw it; keep it.
        stale.value = true;
        continue;
      }
      // Exported, vanished from the Excel file → user deleted it. If the app
      // ALSO changed the row since export, both sides moved → row conflict.
      const currentMoved =
        !valuesEqual(b.qty, c.qty) || !valuesEqual(b.unitPrice, c.unitPrice) || !valuesEqual(b.description, c.description);
      if (currentMoved) stale.value = true;
      rowDeltas.push({
        key, itemId, description: c.description, kind: "removed", currentRow: c,
        ...(currentMoved ? { conflict: true } : {}),
      });
      continue;
    }
    if (!e || !c) continue;

    const base = b ?? ZERO_ROW(itemId);
    const fields = [
      classifyField("qty", base.qty, e.qty, c.qty, stale),
      classifyField("unitPrice", base.unitPrice, e.unitPrice, c.unitPrice, stale),
      classifyField("description", base.description, e.description, c.description, stale),
    ].filter((f): f is FieldDelta => f !== null);
    if (fields.length > 0) {
      rowDeltas.push({ key, itemId, description: e.description || c.description, kind: "changed", fields });
    }
  }

  // ── STEP 2/3 dials ──
  for (const line of STEP23_LINE_PATTERNS) {
    const e = excel.step23Inputs[line.code];
    const b = baseline.step23Inputs[line.code];
    const c = current.step23Inputs[line.code];
    if (!e || !b || !c) continue;
    for (const col of ["E", "F", "H"] as const) {
      if (e[col] === undefined || b[col] === undefined || c[col] === undefined) continue;
      const delta = classifyField(col, b[col]!, e[col]!, c[col]!, stale);
      if (delta) dialDeltas.push({ ...delta, scope: "step23", code: line.code, label: line.label });
    }
  }

  // ── STEP 1 dials + modifier rates ──
  const step1Fields: { field: keyof RoundTripState["step1"]; label: string }[] = [
    { field: "durationMonths", label: "Duration (months)" },
    { field: "squareFootage", label: "Square footage" },
    { field: "unitCount", label: "Unit count" },
  ];
  for (const { field, label } of step1Fields) {
    const delta = classifyField(
      field,
      baseline.step1[field] as number,
      excel.step1[field] as number,
      current.step1[field] as number,
      stale
    );
    if (delta) dialDeltas.push({ ...delta, scope: "step1", label });
  }
  for (const mod of ESTIMATE_MODIFIERS) {
    const delta = classifyField(
      mod.key,
      baseline.step1.modifierRates[mod.key] ?? 0,
      excel.step1.modifierRates[mod.key] ?? 0,
      current.step1.modifierRates[mod.key] ?? 0,
      stale
    );
    if (delta) dialDeltas.push({ ...delta, scope: "modifier", code: mod.key, label: mod.label });
  }

  return {
    rowDeltas,
    dialDeltas,
    isStale: stale.value,
    hasConflicts:
      rowDeltas.some((r) => r.conflict || r.fields?.some((f) => f.classification === "conflict")) ||
      dialDeltas.some((d) => d.classification === "conflict"),
  };
}

// Re-export the shared error types so UI code has one import surface.
export { UnstampedWorkbookError, WrongProjectError, StampSchemaError } from "./roundTripStamp";
export type { RoundTripStamp, RoundTripState, BaselineRow } from "./roundTripStamp";
