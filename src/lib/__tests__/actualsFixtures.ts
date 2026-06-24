/**
 * Shared loader for the real Procore sample exports in `templates/`.
 * Used by the actuals Phase 1 test suite so every test exercises the actual
 * files the engine must handle (golden totals catch parser/column drift).
 *
 * Not a `.test.ts` file — Vitest will not run it as a suite.
 */
import * as fs from "fs";
import * as path from "path";
import { CsvActualsSource, type ActualsCsvPayloads } from "@/lib/actuals";

const TEMPLATES = path.resolve(__dirname, "../../../templates");

function read(name: string): string {
  return fs.readFileSync(path.join(TEMPLATES, name), "utf8");
}

export const ACTUALS_FILES = {
  budget: "active_project_budget_export.csv",
  changeEventSummary: "active_project_change_events_summary_export.csv",
  changeEventDetail: "active_project_change_events_detail_export.csv",
  potentialChangeOrders: "active_project_potential_change_orders_export.csv",
  primeContractChangeOrders: "active_project_prime_contract_change_orders_export.csv",
  subcontractorCommitments: "active_project_subcontractor_commitments_contracts_export.csv",
} as const;

/** Build the CSV payload bundle from the real sample files. */
export function loadActualsPayloads(): ActualsCsvPayloads {
  return {
    budgetCsv: read(ACTUALS_FILES.budget),
    changeEventSummaryCsv: read(ACTUALS_FILES.changeEventSummary),
    changeEventDetailCsv: read(ACTUALS_FILES.changeEventDetail),
    potentialChangeOrdersCsv: read(ACTUALS_FILES.potentialChangeOrders),
    primeContractChangeOrdersCsv: read(ACTUALS_FILES.primeContractChangeOrders),
    subcontractorCommitmentsCsv: read(ACTUALS_FILES.subcontractorCommitments),
  };
}

/** Build a {@link CsvActualsSource} over the real sample files. */
export function loadActualsSource(): CsvActualsSource {
  return new CsvActualsSource(loadActualsPayloads());
}

/** Read a single raw template CSV by key (for direct parser tests). */
export function readActualsCsv(key: keyof typeof ACTUALS_FILES): string {
  return read(ACTUALS_FILES[key]);
}
