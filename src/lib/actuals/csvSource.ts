/**
 * Actuals Cost-History — CSV implementation of the swappable {@link ActualsSource}.
 *
 * Takes the six Procore export payloads as raw CSV strings (no filesystem
 * access here — callers read the files / receive uploads) and yields a parsed
 * {@link RawActualsExport}. A future `ProcoreApiActualsSource` implements the
 * same interface so the normalization engine never changes (plan: CSV-now,
 * API-later).
 */

import {
  parseBudgetDetail,
  parseChangeEventSummary,
  parseChangeEventDetail,
  parsePotentialChangeOrders,
  parsePrimeContractChangeOrders,
  parseSubcontractorCommitments,
} from "./parseExports";
import type { ActualsSource, RawActualsExport } from "./types";

/** The six CSV payloads a {@link CsvActualsSource} consumes. */
export interface ActualsCsvPayloads {
  budgetCsv: string;
  changeEventSummaryCsv: string;
  changeEventDetailCsv: string;
  /** Optional supplementary exports — absent payloads parse to empty arrays. */
  potentialChangeOrdersCsv?: string;
  primeContractChangeOrdersCsv?: string;
  subcontractorCommitmentsCsv?: string;
}

/** A {@link ActualsSource} backed by raw CSV strings. */
export class CsvActualsSource implements ActualsSource {
  readonly kind = "csv";

  constructor(private readonly payloads: ActualsCsvPayloads) {}

  async loadRawExport(): Promise<RawActualsExport> {
    const p = this.payloads;
    return {
      budget: parseBudgetDetail(p.budgetCsv),
      changeEventSummary: parseChangeEventSummary(p.changeEventSummaryCsv),
      changeEventDetail: parseChangeEventDetail(p.changeEventDetailCsv),
      potentialChangeOrders: p.potentialChangeOrdersCsv
        ? parsePotentialChangeOrders(p.potentialChangeOrdersCsv)
        : [],
      primeContractChangeOrders: p.primeContractChangeOrdersCsv
        ? parsePrimeContractChangeOrders(p.primeContractChangeOrdersCsv)
        : [],
      subcontractorCommitments: p.subcontractorCommitmentsCsv
        ? parseSubcontractorCommitments(p.subcontractorCommitmentsCsv)
        : [],
    };
  }
}
