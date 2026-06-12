/**
 * applyRoundTrip.ts — PURE planning + row application for confirmed Excel
 * re-uploads (round-trip Phase 5). Twin of mergeTakeoff.ts: the build
 * (planRoundTripApply) and the undo/redo row application
 * (applyRoundTripRowsForward / applyRoundTripRowsInverse) are pure and unit
 * tested directly — no React harness (repo convention).
 *
 * Apply doctrine (plan locked decisions 3, 5, 7 + AGENTS.md):
 *  - Only INPUT-cell deltas resolve to app changes. Workbook fields with NO
 *    app input (operational/dynamic line rates, %-line basis edits, su-bound
 *    operational E cells) are returned as `inapplicable` — surfaced to the
 *    user, never guessed at (the interactive-override doctrine).
 *  - "edited" fields apply; "conflict" fields apply ONLY when the caller
 *    passes applyConflicts=true (the UI's acknowledgment gate).
 *  - Duration edits reverse-map by anchoring expectedStart and recomputing
 *    expectedFinish; the derived date change rides the same command.
 *  - The whole upload is ONE ApplyRoundTripCommand: one push, one Ctrl+Z.
 */

import {
  ProcessedTakeoffRow,
  ApplyRoundTripCommand,
  RoundTripDialChanges,
} from "@/types";
import type { Project, EstimateVersionMeta } from "@/types/db";
import type { RoundTripDelta, DialDelta } from "./roundTrip";
import type { RoundTripState, BaselineRow } from "./roundTripStamp";
import { STEP23_PATTERN_BY_CODE } from "./step23FormulaPatterns";
import { evaluateDataFidelity } from "./calculations";
import { divisionInsertIndex } from "./mergeTakeoff";
import {
  STAFF_ROLE_DEFAULTS,
  EQUIPMENT_DEFAULTS,
  GC_MANUAL_DEFAULTS,
  SITE_OPS_MANUAL_DEFAULTS,
  ESTIMATE_MODIFIERS,
  isLinkedDivisionRow,
} from "./constants";

// ─── Config lookups (by STEP 2/3 criterion code) ─────────────────────────────

const STAFF_BY_CODE = new Map(STAFF_ROLE_DEFAULTS.map((c) => [c.code, c]));
const EQUIPMENT_BY_CODE = new Map(EQUIPMENT_DEFAULTS.map((c) => [c.code, c]));
const GC_MANUAL_BY_CODE = new Map(GC_MANUAL_DEFAULTS.map((c) => [c.code, c]));
const SITE_OPS_MANUAL_BY_CODE = new Map(SITE_OPS_MANUAL_DEFAULTS.map((c) => [c.code, c]));

const NUM_EPS = 1e-9;

// ─── Inputs / outputs ────────────────────────────────────────────────────────

/** Live dial snapshots from the page hooks at plan time (prev values). */
export interface RoundTripDialSnapshots {
  /** StaffRoleConfig.key → percent (0–100) */
  utilizations: Record<string, number>;
  /** StaffRoleConfig.key → $/hr (absent = corporate default) */
  rateOverrides: Record<string, number>;
  equipment: { dumpsters: number; toilets: number; electric: number };
  gcManualEntries: Record<string, number>;
  siteOpsQuantities: Record<string, number>;
  siteOpsRates: Record<string, number>;
}

export interface RoundTripApplyInputs {
  delta: RoundTripDelta;
  /** The uploaded workbook's full extracted input state (value source). */
  excel: RoundTripState;
  currentRows: ProcessedTakeoffRow[];
  dials: RoundTripDialSnapshots;
  project: Project;
  /** Filename / exportedAt for version titling + audit. */
  sourceLabel: string;
  /** The UI's conflict acknowledgment: false (default) skips every
   *  conflict-classified field; true applies Excel's value over them. */
  applyConflicts?: boolean;
  /** Injectable id factory for appended rows (tests pass a deterministic one). */
  idFactory?: (itemId: string) => string;
}

export interface RoundTripApplyPlan {
  command: ApplyRoundTripCommand;
  /** The grid after the row half applies (post-apply version payload). */
  nextRows: ProcessedTakeoffRow[];
  /** Dial deltas with no app-side input — informational, never applied. */
  inapplicable: DialDelta[];
  /** Human-readable planner decisions (derived dates, skipped conflicts…). */
  notes: string[];
  /** True when the command would change nothing (UI disables Apply). */
  isEmpty: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** "YYYY-MM" + n months → "YYYY-MM" (duration reverse-map, decision 7). */
export function addMonthsToYearMonth(startStr: string, months: number): string | null {
  const parts = startStr.split("-").map(Number);
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null;
  const total = parts[0] * 12 + (parts[1] - 1) + Math.round(months);
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Locked decision 2 pre-check: is the working copy already captured by the
 * newest version? Cheap proxy — the version meta carries the engine summary
 * verbatim at freeze time; equal summaries ⇒ no "Pre-upload baseline" needed.
 */
export function isWorkingCopyCaptured(
  newest: EstimateVersionMeta | undefined,
  currentSummary: Record<string, number>
): boolean {
  if (!newest) return false;
  const keys = Object.keys(currentSummary);
  if (keys.length === 0) return false;
  return keys.every((k) => {
    const frozen = newest.summary[k];
    return typeof frozen === "number" && Math.abs(frozen - currentSummary[k]) <= 0.005;
  });
}

/** itemId#ordinal keys over the grid's comparable rows — MUST mirror
 * buildRoundTripBaseline's filter so delta keys resolve to the right rows. */
function keyCurrentRows(rows: ProcessedTakeoffRow[]): Map<string, ProcessedTakeoffRow> {
  const seen = new Map<string, number>();
  const out = new Map<string, ProcessedTakeoffRow>();
  for (const row of rows) {
    const itemId = (row.itemId || "").trim();
    if (isLinkedDivisionRow(itemId)) continue;
    const n = seen.get(itemId) ?? 0;
    seen.set(itemId, n + 1);
    out.set(`${itemId}#${n}`, row);
  }
  return out;
}

function deepCloneRow(r: ProcessedTakeoffRow): ProcessedTakeoffRow {
  return {
    ...r,
    rawQuantities: r.rawQuantities.map((rq) => ({ ...rq })),
    customFields: { ...(r.customFields || {}) },
  };
}

// ─── Planner ─────────────────────────────────────────────────────────────────

export function planRoundTripApply(inputs: RoundTripApplyInputs): RoundTripApplyPlan {
  const { delta, excel, currentRows, dials, project, applyConflicts = false } = inputs;
  const idFactory =
    inputs.idFactory ??
    ((itemId: string) => `roundtrip-${itemId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);

  const inapplicable: DialDelta[] = [];
  const notes: string[] = [];

  const applies = (classification: "edited" | "conflict"): boolean =>
    classification === "edited" || applyConflicts;

  // ── Row half ──
  const byKey = keyCurrentRows(currentRows);
  const prevRowStates: ApplyRoundTripCommand["prevRowStates"] = [];
  const nextRowStates: ApplyRoundTripCommand["nextRowStates"] = [];
  const appendedRows: ProcessedTakeoffRow[] = [];
  const removedRows: ProcessedTakeoffRow[] = [];

  const buildAppendedRow = (excelRow: BaselineRow): ProcessedTakeoffRow => ({
    // Mirrors insertManualRow's conformant defaults (AGENTS.md data-interface
    // integrity); isMapped:false + empty procoreCode routes the row through
    // the existing unmapped-code export gate instead of guessing a mapping.
    id: idFactory(excelRow.itemId),
    classification: "EXCEL RE-UPLOAD",
    itemId: excelRow.itemId,
    procoreParentCode: "",
    procoreCode: "",
    description: excelRow.description,
    matchedQty: excelRow.qty,
    uom: excelRow.uom || "LS",
    unitPrice: excelRow.unitPrice,
    total: excelRow.qty * excelRow.unitPrice,
    isMapped: false,
    rawQuantities: [],
    costType: "M",
    customFields: {},
    source: "manual",
    dataFidelity: evaluateDataFidelity(excelRow.qty, excelRow.uom || "LS", excelRow.qty * excelRow.unitPrice),
  });

  for (const rowDelta of delta.rowDeltas) {
    if (rowDelta.kind === "added") {
      if (rowDelta.conflict && !applyConflicts) {
        notes.push(`Skipped conflicted Excel row ${rowDelta.itemId} (app deleted it; conflicts not acknowledged)`);
        continue;
      }
      if (rowDelta.excelRow) appendedRows.push(buildAppendedRow(rowDelta.excelRow));
      continue;
    }
    if (rowDelta.kind === "removed") {
      if (rowDelta.conflict && !applyConflicts) {
        notes.push(`Kept ${rowDelta.itemId}: deleted in Excel but edited in the app (conflicts not acknowledged)`);
        continue;
      }
      const row = byKey.get(rowDelta.key);
      if (!row) continue;
      removedRows.push(deepCloneRow(row));
      continue;
    }
    // changed
    const row = byKey.get(rowDelta.key);
    if (!row || !rowDelta.fields) continue;
    const prevFields: Partial<ProcessedTakeoffRow> = {};
    const nextFields: Partial<ProcessedTakeoffRow> = {};
    let qtyOrPriceChanged = false;
    for (const f of rowDelta.fields) {
      if (!applies(f.classification)) {
        notes.push(`Skipped conflicted ${f.field} on ${rowDelta.itemId} (conflicts not acknowledged)`);
        continue;
      }
      if (f.field === "qty") {
        prevFields.matchedQty = row.matchedQty;
        nextFields.matchedQty = f.excel as number;
        qtyOrPriceChanged = true;
      } else if (f.field === "unitPrice") {
        prevFields.unitPrice = row.unitPrice;
        nextFields.unitPrice = f.excel as number;
        qtyOrPriceChanged = true;
      } else if (f.field === "description") {
        prevFields.description = row.description;
        nextFields.description = String(f.excel);
      }
    }
    if (Object.keys(nextFields).length === 0) continue;
    if (qtyOrPriceChanged) {
      const nextQty = nextFields.matchedQty ?? row.matchedQty;
      const nextPrice = nextFields.unitPrice ?? row.unitPrice;
      prevFields.total = row.total;
      nextFields.total = nextQty * nextPrice;
      prevFields.dataFidelity = row.dataFidelity;
      nextFields.dataFidelity = evaluateDataFidelity(nextQty, row.uom, nextQty * nextPrice);
    }
    prevRowStates.push({ rowId: row.id, fields: prevFields });
    nextRowStates.push({ rowId: row.id, fields: nextFields });
  }

  // ── Dial half ──
  const dialChanges: RoundTripDialChanges = {};
  const put = <K extends keyof RoundTripDialChanges>(
    bucket: K,
    key: string,
    prev: number | string | null,
    next: number | string
  ) => {
    if (typeof prev === "number" && typeof next === "number" && Math.abs(prev - next) <= NUM_EPS) return;
    if (prev === next) return;
    const target = (dialChanges[bucket] ?? {}) as Record<string, { prev: unknown; next: unknown }>;
    target[key] = { prev, next };
    (dialChanges as Record<string, unknown>)[bucket] = target;
  };

  /** F×H of a line in the uploaded workbook — lump-sum dollar amount. */
  const excelAmount = (code: string): number => {
    const rec = excel.step23Inputs[code];
    return (rec?.F ?? 0) * (rec?.H ?? 0);
  };

  for (const d of delta.dialDeltas) {
    if (!applies(d.classification)) {
      notes.push(`Skipped conflicted dial ${d.label} (${d.field}) — conflicts not acknowledged`);
      continue;
    }
    if (d.scope === "step23" && d.code) {
      const pattern = STEP23_PATTERN_BY_CODE.get(d.code);
      const staff = STAFF_BY_CODE.get(d.code);
      if (staff) {
        if (d.field === "E") {
          put("utilizations", staff.key, dials.utilizations[staff.key] ?? 0, (d.excel as number) * 100);
        } else if (d.field === "H") {
          put("rateOverrides", staff.key, dials.rateOverrides[staff.key] ?? null, d.excel as number);
        }
        continue;
      }
      const equip = EQUIPMENT_BY_CODE.get(d.code);
      if (equip) {
        put("equipment", equip.key, dials.equipment[equip.key], excelAmount(d.code));
        continue;
      }
      const gcManual = GC_MANUAL_BY_CODE.get(d.code);
      if (gcManual) {
        if (pattern?.write === "pctFrozen") {
          // %-lines: F is the effective pct (intent); an H-only edit is the
          // stale basis, not an estimator entry (handoff watch-out).
          if (d.field === "F") {
            put("gcManualEntries", gcManual.key, dials.gcManualEntries[gcManual.key] ?? 0, excelAmount(d.code));
          } else {
            inapplicable.push(d);
          }
        } else if (gcManual.entry === "lumpSum") {
          put("gcManualEntries", gcManual.key, dials.gcManualEntries[gcManual.key] ?? 0, excelAmount(d.code));
        } else if (d.field === "F") {
          put("gcManualEntries", gcManual.key, dials.gcManualEntries[gcManual.key] ?? 0, d.excel as number);
        } else {
          inapplicable.push(d); // qty-entry line rate: template constant
        }
        continue;
      }
      const siteOps = SITE_OPS_MANUAL_BY_CODE.get(d.code);
      if (siteOps) {
        if (siteOps.entry === "lumpSum") {
          put("siteOpsQuantities", siteOps.key, dials.siteOpsQuantities[siteOps.key] ?? 0, excelAmount(d.code));
        } else if (siteOps.entry === "qtyRate") {
          if (d.field === "F") put("siteOpsQuantities", siteOps.key, dials.siteOpsQuantities[siteOps.key] ?? 0, d.excel as number);
          else if (d.field === "H") put("siteOpsRates", siteOps.key, dials.siteOpsRates[siteOps.key] ?? 0, d.excel as number);
        } else if (d.field === "F") {
          put("siteOpsQuantities", siteOps.key, dials.siteOpsQuantities[siteOps.key] ?? 0, d.excel as number);
        } else {
          inapplicable.push(d); // qty-entry rate: template/rate-card constant
        }
        continue;
      }
      // Operational / dynamic lines: E on su-bound lines is overridden by the
      // staff dial (extraction already flags disagreement); rates have no
      // per-project app input (rate-card domain).
      if (d.field === "E") {
        notes.push(`${d.label}: utilization cell follows the Superintendent staff dial — Excel value ignored`);
      } else {
        inapplicable.push(d);
      }
      continue;
    }
    if (d.scope === "step1") {
      if (d.field === "durationMonths") {
        const start = project.expectedStart || "";
        const newFinish = addMonthsToYearMonth(start, d.excel as number);
        if (!newFinish) {
          inapplicable.push(d);
          notes.push("Duration edit can't be applied: the project has no expected start date to anchor to");
        } else {
          put("projectFields", "expectedFinish", project.expectedFinish || "", newFinish);
          notes.push(`Duration ${d.excel} months → expected finish ${newFinish} (start ${start} anchored)`);
        }
      } else if (d.field === "squareFootage") {
        put("projectFields", "squareFootage", project.squareFootage, d.excel as number);
      } else if (d.field === "unitCount") {
        put("projectFields", "unitCount", project.unitCount, d.excel as number);
      }
      continue;
    }
    if (d.scope === "modifier" && d.code) {
      const mod = ESTIMATE_MODIFIERS.find((m) => m.key === d.code);
      if (mod) {
        const field = `${mod.key}Rate` as keyof Project;
        put("projectFields", field as string, (project[field] as number) ?? mod.defaultRate, d.excel as number);
      }
      continue;
    }
  }

  const command: ApplyRoundTripCommand = {
    type: "APPLY_ROUNDTRIP",
    prevRowStates,
    nextRowStates,
    ...(appendedRows.length ? { appendedRows } : {}),
    ...(removedRows.length ? { removedRows } : {}),
    dialChanges,
    sourceLabel: inputs.sourceLabel,
  };

  const isEmpty =
    nextRowStates.length === 0 &&
    appendedRows.length === 0 &&
    removedRows.length === 0 &&
    Object.keys(dialChanges).length === 0;

  return {
    command,
    nextRows: applyRoundTripRowsForward(currentRows, command),
    inapplicable,
    notes,
    isEmpty,
  };
}

// ─── Row application (forward / inverse) — dispatch + version payloads ───────

export function applyRoundTripRowsForward(
  rows: ProcessedTakeoffRow[],
  cmd: ApplyRoundTripCommand
): ProcessedTakeoffRow[] {
  let updated = [...rows];
  if (cmd.removedRows?.length) {
    const removeIds = new Set(cmd.removedRows.map((r) => r.id));
    updated = updated.filter((r) => !removeIds.has(r.id));
  }
  for (const ns of cmd.nextRowStates) {
    const idx = updated.findIndex((r) => r.id === ns.rowId);
    if (idx !== -1) updated[idx] = { ...updated[idx], ...ns.fields };
  }
  for (const row of cmd.appendedRows ?? []) {
    updated.splice(divisionInsertIndex(updated, row.itemId), 0, deepCloneRow(row));
  }
  return updated;
}

export function applyRoundTripRowsInverse(
  rows: ProcessedTakeoffRow[],
  cmd: ApplyRoundTripCommand
): ProcessedTakeoffRow[] {
  let updated = [...rows];
  if (cmd.appendedRows?.length) {
    const removeIds = new Set(cmd.appendedRows.map((r) => r.id));
    updated = updated.filter((r) => !removeIds.has(r.id));
  }
  for (const ps of cmd.prevRowStates) {
    const idx = updated.findIndex((r) => r.id === ps.rowId);
    if (idx !== -1) updated[idx] = { ...updated[idx], ...ps.fields };
  }
  for (const row of cmd.removedRows ?? []) {
    updated.splice(divisionInsertIndex(updated, row.itemId), 0, deepCloneRow(row));
  }
  return updated;
}
