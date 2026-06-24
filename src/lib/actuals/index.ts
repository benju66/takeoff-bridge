/**
 * Actuals Cost-History — Phase 1 public surface (pure parse + normalization).
 *
 * No DB, no UI: this barrel exposes the swappable source, the parsers, the
 * classification helpers, and the normalization engine for later phases (the
 * storage spine, ingestion UI, reconciliation, and pricing-pool read pipeline)
 * to build on.
 */

export * from "./types";
export {
  parseActualsCurrency,
  normalizeEventId,
  parseCostCode,
  parseCostCodeDescription,
  parseCostType,
  buildGrainKey,
} from "./currency";
export {
  canonicalizeScope,
  canonicalizeType,
  canonicalizeReason,
  classifyChangeEvent,
  type EventDisposition,
} from "./classify";
export {
  parseBudgetDetail,
  parseChangeEventSummary,
  parseChangeEventDetail,
  parsePotentialChangeOrders,
  parsePrimeContractChangeOrders,
  parseSubcontractorCommitments,
} from "./parseExports";
export {
  computeNormalizedActuals,
  isBurdenCode,
  FEE_CODE,
  GL_INSURANCE_CODE,
} from "./normalize";
export { CsvActualsSource, type ActualsCsvPayloads } from "./csvSource";
export {
  classifyActualsCsv,
  extractEmbeddedProjectToken,
  suggestProjectMatch,
  type ActualsExportKind,
  type EmbeddedProjectToken,
  type ProjectLike,
  type ProjectMatchCandidate,
} from "./ingest";
export {
  buildBudgetSnapshotPayload,
  type BudgetSnapshotPayload,
  type BudgetSnapshotHeaderPayload,
  type BudgetSnapshotActualPayload,
  type BuildBudgetSnapshotOptions,
} from "./snapshotPayload";
export {
  buildReconciliationModel,
  buildVerifyAllocation,
  buildLineAllocation,
  buildDeclineAllocation,
  ALLOCATION_KIND,
  DEFAULT_RECONCILIATION_THRESHOLDS,
  type AllocationKind,
  type EstimateLineLike,
  type AllocationLike,
  type ReconciliationBucket,
  type ReconciliationStatus,
  type ReconciliationThresholds,
  type CodeTypeActual,
  type CodeReconciliation,
  type ReconciliationModel,
  type BuildReconciliationInput,
  type AllocationWriteInput,
} from "./reconcile";
export {
  EVENT_CLASSIFICATION_KIND,
  parseEventOverride,
  collectEventOverrides,
  buildEventOverrideAllocation,
  resolveEffectiveDisposition,
  applyEventClassificationOverrides,
  type EventClassificationOverride,
  type OverlayRowLike,
  type EffectiveEventDisposition,
  type EffectiveChangeEvent,
  type ApplyEventOverridesInput,
  type EffectiveActualsResult,
} from "./eventReview";
