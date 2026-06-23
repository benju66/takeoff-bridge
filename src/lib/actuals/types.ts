/**
 * Actuals Cost-History — Phase 1 type model (pure; no DB, no UI).
 *
 * The grain of everything here is **Procore code + cost type** (e.g.
 * `1-10320.000.Labor`) — the level at which the Budget Detail export and the
 * change-event exports meet, and the resolution ceiling of any Procore-sourced
 * history (see plan "Locked decisions").
 *
 * Two numbers are produced per code+type:
 *   - `totalActual`      = raw Estimated Cost at Completion (EAC) from the budget export.
 *   - `normalizedActual` = EAC − Owner-Contingency/Out-of-Scope − Allowance reconciles
 *                          − net-zero Internal reclasses, KEEPING in-scope FP
 *                          Contingency/Buyout draws. Normalized feeds pricing history.
 *
 * Nothing here imports the Supabase client or touches a database — this is the
 * pure parse + normalization engine, swappable behind {@link ActualsSource}.
 */

// ---------------------------------------------------------------------------
// Canonical enums (raw export strings are messy — see classify.ts for mapping)
// ---------------------------------------------------------------------------

/** Procore cost type, parsed from the export's `"Material - Material"` form. */
export type ActualsCostType =
  | "Labor"
  | "Material"
  | "Subcontract"
  | "Equipment"
  | "Other";

/** Change-event Scope. `Unclassified` covers blank/`TBD` — resolved by a human later. */
export type ChangeEventScope =
  | "In Scope"
  | "Out of Scope"
  | "Unclassified";

/** Change-event Type. `Unclassified` covers blank/unknown. */
export type ChangeEventType =
  | "Original Budget"
  | "FP Contingency/Buyout"
  | "Owner Contingency"
  | "Allowance"
  | "No Cost"
  | "Unclassified";

/** Change-event Reason (canonicalized across export casing variants). */
export type ChangeEventReason =
  | "Internal"
  | "FP Construction"
  | "Arch/Eng"
  | "Owner Request"
  | "Winter Conditions"
  | "AHJ"
  | "Allowance"
  | "Unclassified";

/**
 * Normalization bucket — the deterministic disposition of a change event used to
 * compute the normalized actual. Buckets flagged `isNormalizedOut` (owner
 * contingency / out-of-scope / allowance reconcile / net-zero internal reclass)
 * are subtracted from EAC; the rest are kept.
 */
export type NormalizationBucket =
  | "fp_buyout" // in-scope FP Contingency/Buyout — KEPT
  | "original_budget" // in-scope Original Budget change — KEPT
  | "owner_contingency" // OUT
  | "out_of_scope" // OUT (any out-of-scope event not already owner-contingency)
  | "allowance_reconcile" // OUT
  | "internal_reclass" // net-zero internal shuffle — OUT (cancelled)
  | "internal_nonzero" // internal-reason but NOT net-zero — KEPT + flagged anomaly
  | "no_cost" // zero-dollar — KEPT (no effect)
  | "unclassified"; // blank/TBD — KEPT but flagged for human resolution

// ---------------------------------------------------------------------------
// Parsed raw records (one per export shape)
// ---------------------------------------------------------------------------

/** One parsed row of the Budget Detail export (`active_project_budget_export.csv`). */
export interface BudgetDetailRow {
  /** `Cost Code Tier 1`, e.g. `"1 - Division 01 - General Conditions"`. */
  tier1: string;
  /** `Cost Code Tier 2`, e.g. `"1-10320.000 - Sr Project Manager"`. */
  tier2: string;
  /** Cost code parsed from tier2, e.g. `"1-10320.000"`. */
  costCode: string;
  /** Cost type parsed from the `Cost Type` column. */
  costType: ActualsCostType;
  /** `Budget Code` grain key, e.g. `"1-10320.000.Labor"`. */
  budgetCode: string;
  budgetCodeDescription: string;
  originalBudget: number;
  budgetModifications: number;
  approvedCos: number;
  revisedBudget: number;
  pendingCos: number;
  projectedBudget: number;
  committedCosts: number;
  directCosts: number;
  jobToDateCost: number;
  forecastToComplete: number;
  /** Estimated Cost at Completion (EAC) — the `totalActual`. */
  estimatedCostAtCompletion: number;
  projectedOverUnder: number;
}

/** One parsed row of the change-event **summary** export (carries classification). */
export interface ChangeEventSummaryRow {
  /** Raw `#` value, e.g. `"97"` or `"INT-001"`. */
  rawId: string;
  /** Canonical join id (leading zeros stripped from numerics; INT ids uppercased). */
  eventId: string;
  title: string;
  scope: ChangeEventScope;
  type: ChangeEventType;
  reason: ChangeEventReason;
  status: string;
  /** `ROM` column dollar value (signed; savings are negative). */
  rom: number;
  /** `Prime Totals` column dollar value. */
  primeTotals: number;
  /** `Commitment Totals` column dollar value. */
  commitmentTotals: number;
}

/** One parsed line of the change-event **detail** export (per-code dollars). */
export interface ChangeEventDetailRow {
  /** Raw `Event #` value, e.g. `"097"` or `"INT-001"`. */
  rawId: string;
  /** Canonical join id (matches {@link ChangeEventSummaryRow.eventId}). */
  eventId: string;
  eventTitle: string;
  /** Cost code parsed from the `Cost Code` column; `""` when the line has none. */
  costCode: string;
  costType: ActualsCostType;
  description: string;
  vendor: string;
  contract: string;
  /** `Latest Price` (revenue side) — Fee/GL burden markup rides here. */
  latestPrice: number;
  /** `Latest Cost` (cost side) — the direct-cost contribution used for normalization. */
  latestCost: number;
}

/** One parsed row of the Potential Change Orders export (supplementary metadata). */
export interface PotentialChangeOrderRow {
  number: string;
  title: string;
  status: string;
  executed: string;
  amount: number;
  changeReason: string;
  pcco: string;
}

/** One parsed row of the Prime Contract Change Orders export (supplementary). */
export interface PrimeContractChangeOrderRow {
  number: string;
  title: string;
  status: string;
  executed: string;
  amount: number;
  pco: string;
}

/** One parsed row of the Subcontractor Commitments export (supplementary). */
export interface SubcontractorCommitmentRow {
  number: string;
  contractCompany: string;
  title: string;
  status: string;
  originalContractAmount: number;
  approvedChangeOrders: number;
  revisedContractAmount: number;
  /** Embedded `25-117` project token (used by a later phase for auto-suggest). */
  projectNumber: string;
  /** Embedded `"Orchard Path III"` project name (later-phase auto-suggest). */
  projectName: string;
}

/**
 * The full raw bundle a {@link ActualsSource} yields — one payload per export.
 * The first three (budget + change-event detail/summary) are the normalization
 * core; the last three are supplementary metadata parsed but not yet consumed
 * by the engine.
 */
export interface RawActualsExport {
  budget: BudgetDetailRow[];
  changeEventSummary: ChangeEventSummaryRow[];
  changeEventDetail: ChangeEventDetailRow[];
  potentialChangeOrders: PotentialChangeOrderRow[];
  primeContractChangeOrders: PrimeContractChangeOrderRow[];
  subcontractorCommitments: SubcontractorCommitmentRow[];
}

// ---------------------------------------------------------------------------
// Joined change event (summary + its detail lines + disposition)
// ---------------------------------------------------------------------------

/** A change event after the detail↔summary join, classified into a bucket. */
export interface ClassifiedChangeEvent {
  eventId: string;
  title: string;
  scope: ChangeEventScope;
  type: ChangeEventType;
  reason: ChangeEventReason;
  status: string;
  bucket: NormalizationBucket;
  /** True when this event's per-code dollars are subtracted from EAC for normalized. */
  isNormalizedOut: boolean;
  /** All parsed detail lines for this event (including blank-code/burden lines). */
  lines: ChangeEventDetailRow[];
  /** Sum of `latestCost` across this event's detail lines (signed). */
  netLatestCost: number;
  /** True when this event was suppressed as a duplicate of an earlier event. */
  isDuplicate: boolean;
  /** The canonical event id this duplicates, when `isDuplicate`. */
  duplicateOf?: string;
}

// ---------------------------------------------------------------------------
// Engine output
// ---------------------------------------------------------------------------

/** The per-event dollars a change order contributed to a single code+type. */
export interface CodeChangeContribution {
  eventId: string;
  bucket: NormalizationBucket;
  /** `latestCost` this event contributed to this code+type (signed). */
  amount: number;
}

/** Normalized actuals for a single `code+costType` grain key. */
export interface CodeActual {
  /** Grain key, e.g. `"1-10320.000.Labor"`. */
  budgetCode: string;
  costCode: string;
  costType: ActualsCostType;
  description: string;
  /** `Original Budget Amount` — the estimate-baseline reference. */
  originalBudget: number;
  /** Raw EAC (`totalActual`). */
  totalActual: number;
  /** EAC minus normalized-out change-event contributions (`normalizedActual`). */
  normalizedActual: number;
  /** True for the Fee (`60-604000.000`) and GL insurance (`60-602020.000`) codes. */
  isBurden: boolean;
  /** The normalized-out change-event contributions subtracted from this code. */
  normalizedOutContributions: CodeChangeContribution[];
}

/** A change event flagged for human classification (blank/TBD scope or unknown). */
export interface UnclassifiedEventFlag {
  eventId: string;
  title: string;
  scope: ChangeEventScope;
  type: ChangeEventType;
  reason: ChangeEventReason;
  netLatestCost: number;
}

/** Diagnostics surfaced alongside the computed actuals (never silently dropped). */
export interface ActualsDiagnostics {
  /** Detail event ids with no matching summary row (classification unknown). */
  unjoinedDetailEventIds: string[];
  /** Summary event ids with no matching detail lines. */
  summaryOnlyEventIds: string[];
  /** Duplicate event groups detected by cost-side fingerprint (kept one, suppressed rest). */
  duplicateEventGroups: { keptEventId: string; suppressedEventIds: string[] }[];
  /** Count of detail lines with a blank cost code (cannot be attributed to a code). */
  unattributedDetailLineCount: number;
  /** Internal-reason events that are NOT net-zero (kept + flagged, not cancelled). */
  internalNonZeroEventIds: string[];
  /** Events whose scope/type/reason could not be classified (blank/TBD). */
  unclassifiedEvents: UnclassifiedEventFlag[];
}

/** The full result of {@link computeNormalizedActuals}. */
export interface NormalizedActuals {
  /** Per code+type actuals, in budget-export order. */
  codeActuals: CodeActual[];
  /** All change events after join + classification + dedup. */
  events: ClassifiedChangeEvent[];
  /** Σ totalActual across all codes (ties to the budget export grand total). */
  grandTotalActual: number;
  /** Σ normalizedActual across all codes. */
  grandNormalizedActual: number;
  /** Σ totalActual across the Fee + GL burden codes. */
  burdenTotalActual: number;
  /** Σ totalActual across non-burden (direct-cost) codes. */
  directTotalActual: number;
  diagnostics: ActualsDiagnostics;
}

// ---------------------------------------------------------------------------
// Swappable source interface (CSV now; API later — see plan "CSV-now, API-later")
// ---------------------------------------------------------------------------

/**
 * A pluggable source of raw Procore actuals exports. Phase 1 ships
 * {@link CsvActualsSource}; a Procore-API source can be added later without the
 * normalization engine or any future store changing.
 */
export interface ActualsSource {
  /** A stable identifier for the source kind, e.g. `"csv"` or `"procore-api"`. */
  readonly kind: string;
  /** Yield the parsed raw bundle. */
  loadRawExport(): Promise<RawActualsExport>;
}
