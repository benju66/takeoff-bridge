/**
 * Actuals Cost-History — Phase 4 reconciliation engine (pure; no DB, no React).
 *
 * The "staging ground": a Procore Budget snapshot is at the *Procore cost-code*
 * grain (e.g. `1-10320.000`), but the estimate is finer — many estimate lines
 * roll up into one Procore code. This module reconstructs that relationship and
 * buckets every code so the UI can recover the estimate's finer granularity
 * **only where a human chooses to**:
 *
 *   - `oneToOne`  — exactly one estimate line maps to a code that has actuals.
 *                   The actual auto-matches; the human only verifies.
 *   - `rollup`    — two or more estimate lines map to one code with actuals.
 *                   Manual entry is OFFERED (optional), and is *targeted* (the
 *                   high-value / high-variance rollups are prompted by default,
 *                   with an "enter all" escape hatch). A declined rollup is
 *                   simply excluded.
 *   - `unbacked`  — the code has actuals but no estimate line (a thin / never-
 *                   estimated project) — informational, code-level only.
 *   - `estimateOnly` — an estimate line with no actual landed — informational.
 *
 * The reconciled view (verified / allocated / declined dispositions, allocated
 * sums, remaining-to-tie) is **recomputed from the frozen snapshot actuals + the
 * mutable overlay on every load** — the frozen rows are never mutated (Phase 2
 * immutability). Nothing financial is fabricated: a `verify` copies the exact
 * frozen numbers; a rollup split is human-entered. (AGENTS.md "No AI Autonomy
 * Over Financials".)
 *
 * Kept pure and DB/React-decoupled (structural {@link EstimateLineLike} /
 * {@link AllocationLike} stand-ins, mirroring `ingest.ts`'s `ProjectLike`) so it
 * is unit-testable against the real `templates/` fixtures without a database.
 */

import type { CodeActual, ActualsCostType } from "./types";

// ---------------------------------------------------------------------------
// Structural inputs (decoupled from the DB / React types)
// ---------------------------------------------------------------------------

/**
 * The minimal estimate-line shape the reconciler needs. The caller resolves each
 * saved line item to its granular Procore code (via `resolveProcoreCode`, falling
 * back to the persisted `procoreCode`) and supplies it here — keeping this module
 * free of the cost-code-map machinery and its module-level cache.
 */
export interface EstimateLineLike {
  id: string;
  /** Granular Procore code the line resolves to (e.g. `"1-10000.000"`); `""` = unmapped. */
  procoreCode: string;
  description: string;
  /** Single-letter estimate cost type (M/S/L/E) or `""` — display only. */
  costType: string;
  /** The line's estimate dollar total. */
  total: number;
}

/**
 * The minimal overlay-allocation shape the reconciler reads — structurally a
 * subset of `BudgetSnapshotAllocation` (`src/types/db.ts`), so the page passes the
 * real rows straight in. Declared here (not imported) to avoid a type-only import
 * cycle with `@/types/db`, which imports the actuals types.
 */
export interface AllocationLike {
  id: string;
  /** The grain key (Procore cost code) this allocation draws from. */
  budgetCode: string;
  /** The receiving estimate line (`""` = code-level: a declined marker). */
  estimateLineItemId: string;
  kind: string;
  allocatedTotal: number;
  allocatedNormalized: number;
}

// ---------------------------------------------------------------------------
// Vocabulary (the overlay's open-enum `kind` — no DDL; see plan)
// ---------------------------------------------------------------------------

/** The Phase-4 overlay `kind` values written to `budget_snapshot_allocations`. */
export const ALLOCATION_KIND = {
  /** A 1:1 code's auto-match, confirmed by a human (exact frozen numbers). */
  VERIFY: "verify",
  /** One human-entered split of a rollup code's actual onto one estimate line. */
  ALLOCATION: "allocation",
  /** A code-level marker that a rollup was reviewed and excluded from history. */
  DECLINED: "declined",
} as const;

export type AllocationKind = (typeof ALLOCATION_KIND)[keyof typeof ALLOCATION_KIND];

// ---------------------------------------------------------------------------
// Model types
// ---------------------------------------------------------------------------

export type ReconciliationBucket = "oneToOne" | "rollup" | "unbacked" | "estimateOnly";

export type ReconciliationStatus = "pending" | "verified" | "allocated" | "declined";

/** Tunable heuristics for which rollups get prompted by default. */
export interface ReconciliationThresholds {
  /** High-value when a code's |normalized| ≥ this share of grand normalized. */
  valueShareThreshold: number;
  /** High-variance requires |normalized − estimate| ≥ this absolute floor (dollars)… */
  varianceAbsoluteFloor: number;
  /** …AND |variance ÷ estimate| ≥ this fraction. */
  variancePctThreshold: number;
  /** |remaining| ≤ this (dollars) counts a rollup split as fully tied out. */
  tieTolerance: number;
}

export const DEFAULT_RECONCILIATION_THRESHOLDS: ReconciliationThresholds = {
  valueShareThreshold: 0.02, // 2% of the job
  varianceAbsoluteFloor: 5000, // $5k
  variancePctThreshold: 0.1, // 10% off estimate
  tieTolerance: 0.01, // a cent
};

/** One cost type's actual within a code (kept for the expandable display). */
export interface CodeTypeActual {
  costType: ActualsCostType;
  /** The full `code.costType` grain key, e.g. `"1-10320.000.Labor"`. */
  budgetCode: string;
  total: number;
  normalized: number;
}

/** The reconciliation of a single Procore cost code (the reconciliation grain). */
export interface CodeReconciliation {
  costCode: string;
  description: string;

  // ── snapshot actuals, aggregated to the code (summed across cost types) ──
  hasActual: boolean;
  totalActual: number;
  normalizedActual: number;
  originalBudget: number;
  isBurden: boolean;
  perType: CodeTypeActual[];

  // ── estimate side ──
  estimateLines: EstimateLineLike[];
  estimateTotal: number;

  // ── classification ──
  bucket: ReconciliationBucket;
  /** normalizedActual − estimateTotal (signed). */
  variance: number;
  /** variance ÷ estimateTotal; `null` when there is no estimate baseline. */
  variancePct: number | null;
  /** code's |normalized| ÷ grand normalized (0 when grand ≈ 0). */
  valueShare: number;
  isHighValue: boolean;
  isHighVariance: boolean;
  /** A rollup worth prompting by default (high-value OR high-variance). */
  isTargeted: boolean;

  // ── disposition (recomputed from the overlay; frozen rows never mutated) ──
  status: ReconciliationStatus;
  /** The code's overlay rows (the declined marker excluded from the sums below). */
  allocations: AllocationLike[];
  allocatedTotal: number;
  allocatedNormalized: number;
  /** normalizedActual − allocatedNormalized (the rollup-split residual). */
  remainingNormalized: number;
  /** |remainingNormalized| ≤ tieTolerance. */
  tiesOut: boolean;
}

export interface ReconciliationModel {
  /** One per cost code (union of codes appearing in actuals and/or estimate), code asc. */
  codes: CodeReconciliation[];
  grandTotalActual: number;
  grandNormalizedActual: number;
  /** Estimate lines that resolved to no Procore code (cannot be reconciled). */
  unmappedEstimateLineCount: number;
  counts: {
    oneToOne: number;
    rollup: number;
    targetedRollup: number;
    unbacked: number;
    estimateOnly: number;
    verified: number;
    allocated: number;
    declined: number;
    pending: number;
  };
}

export interface BuildReconciliationInput {
  /** The snapshot's frozen per code+type actuals (`getBudgetSnapshotDetail().actuals`). */
  actuals: CodeActual[];
  /** The project's estimate lines, each already resolved to a `procoreCode`. */
  estimateLines: EstimateLineLike[];
  /** The snapshot's mutable overlay rows (`getBudgetSnapshotAllocations`). */
  allocations: AllocationLike[];
  /** Override any default targeting heuristic (defaults applied per-field). */
  thresholds?: Partial<ReconciliationThresholds>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COST_TYPE_SUFFIX = /\.(Labor|Material|Subcontract|Equipment|Other)$/;

/**
 * The snapshot stores a per code+type description (`"Sr Project Manager.Labor"`).
 * Strip the trailing `.<CostType>` so the code-level row reads cleanly.
 */
function codeLevelDescription(desc: string): string {
  return desc.replace(COST_TYPE_SUFFIX, "");
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/**
 * Reconstruct the estimate↔code reconciliation model from the frozen snapshot
 * actuals, the estimate lines (pre-resolved to Procore codes), and the mutable
 * overlay. Pure and idempotent: same inputs → same model. The overlay is the only
 * thing that changes between loads, so re-running this after a write is the
 * "recompute normalized-with-overrides from frozen raw + overlay" step.
 */
export function buildReconciliationModel(
  input: BuildReconciliationInput,
): ReconciliationModel {
  const thresholds = { ...DEFAULT_RECONCILIATION_THRESHOLDS, ...(input.thresholds ?? {}) };

  // 1. Aggregate the per code+type actuals up to the cost-code grain.
  interface CodeAgg {
    costCode: string;
    description: string;
    totalActual: number;
    normalizedActual: number;
    originalBudget: number;
    isBurden: boolean;
    perType: CodeTypeActual[];
  }
  const codeMap = new Map<string, CodeAgg>();
  for (const a of input.actuals) {
    if (a.costCode === "") continue; // the export's blank "None" header row
    let agg = codeMap.get(a.costCode);
    if (!agg) {
      agg = {
        costCode: a.costCode,
        description: codeLevelDescription(a.description),
        totalActual: 0,
        normalizedActual: 0,
        originalBudget: 0,
        isBurden: false,
        perType: [],
      };
      codeMap.set(a.costCode, agg);
    }
    agg.totalActual += a.totalActual;
    agg.normalizedActual += a.normalizedActual;
    agg.originalBudget += a.originalBudget;
    agg.isBurden = agg.isBurden || a.isBurden;
    if (agg.description === "" && a.description !== "") {
      agg.description = codeLevelDescription(a.description);
    }
    agg.perType.push({
      costType: a.costType,
      budgetCode: a.budgetCode,
      total: a.totalActual,
      normalized: a.normalizedActual,
    });
  }

  // 2. Group estimate lines by their resolved Procore code (unmapped → counted, not lost).
  const linesByCode = new Map<string, EstimateLineLike[]>();
  let unmappedEstimateLineCount = 0;
  for (const line of input.estimateLines) {
    if (line.procoreCode === "") {
      unmappedEstimateLineCount += 1;
      continue;
    }
    const arr = linesByCode.get(line.procoreCode);
    if (arr) arr.push(line);
    else linesByCode.set(line.procoreCode, [line]);
  }

  // 3. Group overlay rows by the code they draw from.
  const allocByCode = new Map<string, AllocationLike[]>();
  for (const al of input.allocations) {
    const arr = allocByCode.get(al.budgetCode);
    if (arr) arr.push(al);
    else allocByCode.set(al.budgetCode, [al]);
  }

  // Grand normalized (signed sum across codes) — the value-share denominator.
  let grandTotalActual = 0;
  let grandNormalizedActual = 0;
  for (const agg of codeMap.values()) {
    grandTotalActual += agg.totalActual;
    grandNormalizedActual += agg.normalizedActual;
  }
  const grandNormAbs = Math.abs(grandNormalizedActual);

  // 4. Build a CodeReconciliation per code (union of actuals + estimate codes).
  const allCodes = new Set<string>([...codeMap.keys(), ...linesByCode.keys()]);
  const codes: CodeReconciliation[] = [];

  for (const code of allCodes) {
    const agg = codeMap.get(code);
    const lines = linesByCode.get(code) ?? [];
    const hasActual = agg !== undefined;
    const totalActual = agg?.totalActual ?? 0;
    const normalizedActual = agg?.normalizedActual ?? 0;
    const estimateTotal = lines.reduce((s, l) => s + l.total, 0);

    let bucket: ReconciliationBucket;
    if (hasActual && lines.length === 1) bucket = "oneToOne";
    else if (hasActual && lines.length >= 2) bucket = "rollup";
    else if (hasActual) bucket = "unbacked"; // lines.length === 0
    else bucket = "estimateOnly"; // !hasActual, lines.length >= 1

    const variance = normalizedActual - estimateTotal;
    const variancePct =
      Math.abs(estimateTotal) > 1e-9 ? variance / estimateTotal : null;
    const valueShare = grandNormAbs > 1e-9 ? Math.abs(normalizedActual) / grandNormAbs : 0;
    const isHighValue = valueShare >= thresholds.valueShareThreshold;
    const isHighVariance =
      Math.abs(variance) >= thresholds.varianceAbsoluteFloor &&
      variancePct !== null &&
      Math.abs(variancePct) >= thresholds.variancePctThreshold;
    const isTargeted = bucket === "rollup" && (isHighValue || isHighVariance);

    // Disposition from the overlay (declined marker wins; verify > allocate).
    const codeAllocs = allocByCode.get(code) ?? [];
    const isDeclined = codeAllocs.some((a) => a.kind === ALLOCATION_KIND.DECLINED);
    const contributing = codeAllocs.filter((a) => a.kind !== ALLOCATION_KIND.DECLINED);
    const hasVerify = contributing.some((a) => a.kind === ALLOCATION_KIND.VERIFY);
    const allocatedTotal = contributing.reduce((s, a) => s + a.allocatedTotal, 0);
    const allocatedNormalized = contributing.reduce((s, a) => s + a.allocatedNormalized, 0);

    let status: ReconciliationStatus;
    if (isDeclined) status = "declined";
    else if (hasVerify) status = "verified";
    else if (contributing.length > 0) status = "allocated";
    else status = "pending";

    const remainingNormalized = normalizedActual - allocatedNormalized;
    const tiesOut = Math.abs(remainingNormalized) <= thresholds.tieTolerance;

    codes.push({
      costCode: code,
      description: agg?.description ?? "",
      hasActual,
      totalActual,
      normalizedActual,
      originalBudget: agg?.originalBudget ?? 0,
      isBurden: agg?.isBurden ?? false,
      perType: agg?.perType ?? [],
      estimateLines: lines,
      estimateTotal,
      bucket,
      variance,
      variancePct,
      valueShare,
      isHighValue,
      isHighVariance,
      isTargeted,
      status,
      allocations: codeAllocs,
      allocatedTotal,
      allocatedNormalized,
      remainingNormalized,
      tiesOut,
    });
  }

  // Stable, predictable order: by cost code ascending (the UI groups by bucket).
  codes.sort((a, b) => a.costCode.localeCompare(b.costCode));

  const counts = {
    oneToOne: 0,
    rollup: 0,
    targetedRollup: 0,
    unbacked: 0,
    estimateOnly: 0,
    verified: 0,
    allocated: 0,
    declined: 0,
    pending: 0,
  };
  for (const c of codes) {
    if (c.bucket === "oneToOne") counts.oneToOne += 1;
    else if (c.bucket === "rollup") {
      counts.rollup += 1;
      if (c.isTargeted) counts.targetedRollup += 1;
    } else if (c.bucket === "unbacked") counts.unbacked += 1;
    else counts.estimateOnly += 1;

    if (c.status === "verified") counts.verified += 1;
    else if (c.status === "allocated") counts.allocated += 1;
    else if (c.status === "declined") counts.declined += 1;
    else counts.pending += 1;
  }

  return {
    codes,
    grandTotalActual,
    grandNormalizedActual,
    unmappedEstimateLineCount,
    counts,
  };
}

// ---------------------------------------------------------------------------
// Overlay-write payload builders (pure; the page adds nothing but the call)
// ---------------------------------------------------------------------------

/** The shape `db.ts/saveBudgetSnapshotAllocation` consumes for one overlay write. */
export interface AllocationWriteInput {
  snapshotId: string;
  budgetCode: string;
  estimateLineItemId: string;
  kind: string;
  allocatedTotal: number;
  allocatedNormalized: number;
  detail: Record<string, unknown>;
  note?: string;
}

/**
 * A 1:1 code's verification — copies the exact frozen total + normalized onto the
 * single estimate line (no human number entered; nothing fabricated).
 */
export function buildVerifyAllocation(
  snapshotId: string,
  code: CodeReconciliation,
): AllocationWriteInput {
  const line = code.estimateLines[0];
  return {
    snapshotId,
    budgetCode: code.costCode,
    estimateLineItemId: line?.id ?? "",
    kind: ALLOCATION_KIND.VERIFY,
    allocatedTotal: code.totalActual,
    allocatedNormalized: code.normalizedActual,
    detail: {
      bucket: "oneToOne",
      costCode: code.costCode,
      lineDescription: line?.description ?? "",
    },
  };
}

/**
 * One human-entered split of a rollup code's normalized actual onto one estimate
 * line. The entered amount is the in-scope cost attributed to that line, so it is
 * stored in BOTH `allocatedNormalized` and `allocatedTotal` (the code-level
 * total-vs-normalized split stays visible on the frozen snapshot).
 */
export function buildLineAllocation(
  snapshotId: string,
  code: CodeReconciliation,
  lineId: string,
  amount: number,
): AllocationWriteInput {
  const line = code.estimateLines.find((l) => l.id === lineId);
  return {
    snapshotId,
    budgetCode: code.costCode,
    estimateLineItemId: lineId,
    kind: ALLOCATION_KIND.ALLOCATION,
    allocatedTotal: amount,
    allocatedNormalized: amount,
    detail: {
      bucket: "rollup",
      costCode: code.costCode,
      lineDescription: line?.description ?? "",
    },
  };
}

/**
 * A code-level marker that a rollup was reviewed and deliberately EXCLUDED from
 * finer-grain history (zero-dollar; the code-level actual still lives on the
 * frozen snapshot).
 */
export function buildDeclineAllocation(
  snapshotId: string,
  code: CodeReconciliation,
): AllocationWriteInput {
  return {
    snapshotId,
    budgetCode: code.costCode,
    estimateLineItemId: "",
    kind: ALLOCATION_KIND.DECLINED,
    allocatedTotal: 0,
    allocatedNormalized: 0,
    detail: { bucket: code.bucket, costCode: code.costCode, reason: "excluded" },
  };
}
