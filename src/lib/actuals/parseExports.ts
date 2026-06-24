/**
 * Actuals Cost-History — CSV parsers for the six Procore export shapes.
 *
 * Pure string-in / records-out (no filesystem, no DB): callers supply the CSV
 * text. PapaParse with `header: true` keys rows by their column header; we read
 * by header name so column-order drift in a re-export does not silently
 * misalign fields. Ascending-column discipline is moot here (we never address
 * cells by letter), but currency/code parsing is centralized in `./currency`.
 */

import Papa from "papaparse";
import {
  parseActualsCurrency,
  parseCostCode,
  parseCostCodeDescription,
  parseCostType,
  buildGrainKey,
  normalizeEventId,
} from "./currency";
import { canonicalizeScope, canonicalizeType, canonicalizeReason } from "./classify";
import type {
  BudgetDetailRow,
  ChangeEventSummaryRow,
  ChangeEventDetailRow,
  PotentialChangeOrderRow,
  PrimeContractChangeOrderRow,
  SubcontractorCommitmentRow,
} from "./types";

/** Parse CSV text into header-keyed string rows (empty lines skipped). */
function parseRows(csv: string): Record<string, string>[] {
  const result = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
  });
  return result.data ?? [];
}

/** Trim a string cell, tolerating undefined. */
function str(v: unknown): string {
  return String(v ?? "").trim();
}

/**
 * Parse the Budget Detail export. The leading sentinel row (`None,None,None`
 * with a blank `Budget Code`) carries no grain and is skipped — Procore writes
 * the literal `"None"`, not an empty cell, so we key the skip off the blank
 * `Budget Code` column (the authoritative grain marker).
 */
export function parseBudgetDetail(csv: string): BudgetDetailRow[] {
  const rows = parseRows(csv);
  const out: BudgetDetailRow[] = [];
  for (const r of rows) {
    if (str(r["Budget Code"]) === "") continue; // skip the sentinel/total row
    const tier2 = str(r["Cost Code Tier 2"]);
    const costCode = parseCostCode(tier2);
    if (costCode === "") continue; // defensive: no parsable grain
    const costType = parseCostType(r["Cost Type"]);
    out.push({
      tier1: str(r["Cost Code Tier 1"]),
      tier2,
      costCode,
      costType,
      budgetCode: buildGrainKey(costCode, costType),
      budgetCodeDescription: str(r["Budget Code Description"]),
      originalBudget: parseActualsCurrency(r["Original Budget Amount"]),
      budgetModifications: parseActualsCurrency(r["Budget Modifications"]),
      approvedCos: parseActualsCurrency(r["Approved COs"]),
      revisedBudget: parseActualsCurrency(r["Revised Budget"]),
      pendingCos: parseActualsCurrency(r["Pending COs"]),
      projectedBudget: parseActualsCurrency(r["Projected Budget"]),
      committedCosts: parseActualsCurrency(r["Committed Costs"]),
      directCosts: parseActualsCurrency(r["Direct Costs"]),
      jobToDateCost: parseActualsCurrency(r["ERP Job to Date Cost"]),
      forecastToComplete: parseActualsCurrency(r["Forecast To Complete"]),
      estimatedCostAtCompletion: parseActualsCurrency(r["Estimated Cost at Completion"]),
      projectedOverUnder: parseActualsCurrency(r["Projected over Under"]),
    });
  }
  return out;
}

/** Parse the change-event **summary** export (carries Scope/Type/Reason). */
export function parseChangeEventSummary(csv: string): ChangeEventSummaryRow[] {
  const rows = parseRows(csv);
  const out: ChangeEventSummaryRow[] = [];
  for (const r of rows) {
    const rawId = str(r["#"]);
    if (rawId === "") continue;
    out.push({
      rawId,
      eventId: normalizeEventId(rawId),
      title: str(r["Title"]),
      scope: canonicalizeScope(r["Scope"]),
      type: canonicalizeType(r["Type"]),
      reason: canonicalizeReason(r["Reason"]),
      status: str(r["Status"]),
      rom: parseActualsCurrency(r["ROM"]),
      primeTotals: parseActualsCurrency(r["Prime Totals"]),
      commitmentTotals: parseActualsCurrency(r["Commitment Totals"]),
    });
  }
  return out;
}

/** Parse the change-event **detail** export (per-code dollars). */
export function parseChangeEventDetail(csv: string): ChangeEventDetailRow[] {
  const rows = parseRows(csv);
  const out: ChangeEventDetailRow[] = [];
  for (const r of rows) {
    const rawId = str(r["Event #"]);
    if (rawId === "") continue;
    out.push({
      rawId,
      eventId: normalizeEventId(rawId),
      eventTitle: str(r["Event Title"]),
      costCode: parseCostCode(r["Cost Code"]),
      costType: parseCostType(r["Cost Type"]),
      description: str(r["Description"]),
      vendor: str(r["Vendor"]),
      contract: str(r["Contract"]),
      latestPrice: parseActualsCurrency(r["Latest Price"]),
      latestCost: parseActualsCurrency(r["Latest Cost"]),
    });
  }
  return out;
}

/** Parse the Potential Change Orders export (supplementary metadata). */
export function parsePotentialChangeOrders(csv: string): PotentialChangeOrderRow[] {
  const rows = parseRows(csv);
  const out: PotentialChangeOrderRow[] = [];
  for (const r of rows) {
    const number = str(r["Number"]);
    if (number === "") continue;
    out.push({
      number,
      title: str(r["Title"]),
      status: str(r["Status"]),
      executed: str(r["Executed"]),
      amount: parseActualsCurrency(r["Amount"]),
      changeReason: str(r["Change Reason"]),
      pcco: str(r["PCCO"]),
    });
  }
  return out;
}

/** Parse the Prime Contract Change Orders export (supplementary metadata). */
export function parsePrimeContractChangeOrders(csv: string): PrimeContractChangeOrderRow[] {
  const rows = parseRows(csv);
  const out: PrimeContractChangeOrderRow[] = [];
  for (const r of rows) {
    const number = str(r["Number"]);
    if (number === "") continue;
    out.push({
      number,
      title: str(r["Title"]),
      status: str(r["Status"]),
      executed: str(r["Executed"]),
      amount: parseActualsCurrency(r["Amount"]),
      pco: str(r["PCO"]),
    });
  }
  return out;
}

/** Parse the Subcontractor Commitments export (supplementary; carries project token). */
export function parseSubcontractorCommitments(csv: string): SubcontractorCommitmentRow[] {
  const rows = parseRows(csv);
  const out: SubcontractorCommitmentRow[] = [];
  for (const r of rows) {
    const number = str(r["Number"]);
    if (number === "") continue;
    out.push({
      number,
      contractCompany: str(r["Contract Company"]),
      title: str(r["Title"]),
      status: str(r["Status"]),
      originalContractAmount: parseActualsCurrency(r["Original Contract Amount"]),
      approvedChangeOrders: parseActualsCurrency(r["Approved Change Orders"]),
      revisedContractAmount: parseActualsCurrency(r["Revised Contract Amount"]),
      projectNumber: str(r["Project Number"]),
      projectName: str(r["Project Name"]),
    });
  }
  return out;
}
