/**
 * Synthetic golden — the CI-safe twin of `golden-mckenna.test.ts` (math-trust
 * backlog B-1).
 *
 * The McKenna harness proves the engine on a REAL bid but reads a confidential
 * file and `skipIf`s when it is absent — so it does NOT run on CI or a teammate's
 * machine. This test runs the SAME machinery (`loadTemplateWorkbook →
 * extractEstimate → computeTakeoffSummary`) against a fabricated, non-confidential
 * workbook built in-memory (`fixtures/syntheticTemplate.ts`), so a regression in
 * the extractor or the STEP 4 summary math is caught EVERYWHERE, every run — no
 * external fixture, no skip.
 *
 * The numbers are hand-authored round values; the workbook carries them as its
 * oracle cells and the engine, fed only the inputs, must reproduce them to the cent.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { computeTakeoffSummary, type TakeoffSummary } from "../lib/calculations";
import { RECONCILIATION_TOLERANCE } from "../lib/exporter";
import { ESTIMATE_MODIFIERS } from "../lib/constants";
import {
  extractEstimate,
  loadTemplateWorkbook,
  toProcessedRows,
  linkedTotalsFromExtract,
  type ExtractedEstimate,
} from "../lib/templateExtractor";
import { buildSyntheticTemplateBuffer, SYNTHETIC_INPUTS, SYNTHETIC_ORACLE } from "./fixtures/syntheticTemplate";

/** Within the $0.01 match bar (the exact constant the exporter reconciles on). */
function ties(a: number, b: number): boolean {
  return Math.abs(a - b) <= RECONCILIATION_TOLERANCE;
}

describe("Golden reproduction — synthetic template (CI-safe machinery proof)", () => {
  let extracted: ExtractedEstimate;
  let summary: TakeoffSummary;

  beforeAll(async () => {
    const buffer = await buildSyntheticTemplateBuffer();
    const wb = await loadTemplateWorkbook(buffer);
    extracted = extractEstimate(wb);

    const rows = toProcessedRows(extracted.lineItems);
    const linked = linkedTotalsFromExtract(extracted.lineItems);
    summary = computeTakeoffSummary(
      rows,
      extracted.inputs.squareFootage,
      extracted.inputs.unitCount,
      { ...extracted.inputs.rates, roundingRule: "none" },
      linked
    );
  });

  it("extracts a structurally-sound workbook (the extractor read the template shape)", () => {
    expect(extracted.inputs.projectName).toBe(SYNTHETIC_INPUTS.projectName);
    expect(extracted.inputs.squareFootage).toBe(SYNTHETIC_INPUTS.squareFootage);
    expect(extracted.inputs.unitCount).toBe(SYNTHETIC_INPUTS.unitCount);
    expect(extracted.lineItems).toHaveLength(SYNTHETIC_ORACLE.lineItemCount);
    expect(extracted.lineItems.filter((l) => l.isLinked)).toHaveLength(SYNTHETIC_ORACLE.linkedRowCount);
    // The extractor read each modifier RATE from STEP 1.
    expect(extracted.inputs.rates.constructionContingencyRate).toBe(SYNTHETIC_INPUTS.rates.constructionContingency);
    expect(extracted.inputs.rates.glInsuranceRate).toBe(SYNTHETIC_INPUTS.rates.glInsurance);
    expect(extracted.inputs.rates.feeRate).toBe(SYNTHETIC_INPUTS.rates.fee);
  });

  it("round-trips the oracle cells through xlsx write/read intact", () => {
    // The workbook the builder wrote carries these literal oracle values; reading
    // them back proves loadTemplateWorkbook + readCell handle the .xlsx faithfully.
    expect(extracted.oracle.step4Subtotal).toBe(SYNTHETIC_ORACLE.subtotal);
    expect(extracted.oracle.totalEstimatedCost).toBe(SYNTHETIC_ORACLE.totalEstimatedCost);
    expect(extracted.oracle.costPerUnit).toBe(SYNTHETIC_ORACLE.costPerUnit);
  });

  it("INV-1 keystone: the engine reproduces SUBTOTAL and TOTAL to the cent", () => {
    expect(ties(summary.subtotal, extracted.oracle.step4Subtotal)).toBe(true);
    expect(ties(summary.subtotal, SYNTHETIC_ORACLE.subtotal)).toBe(true);
    expect(ties(summary.totalEstimatedCost, extracted.oracle.totalEstimatedCost)).toBe(true);
    expect(ties(summary.totalEstimatedCost, SYNTHETIC_ORACLE.totalEstimatedCost)).toBe(true);
  });

  it("INV-2: subtotal = takeoff rows + linked division values, deduped", () => {
    expect(ties(summary.takeoffSubtotal, SYNTHETIC_ORACLE.takeoffSubtotal)).toBe(true);
    expect(ties(summary.linkedDivisionsTotal, SYNTHETIC_ORACLE.linkedDivisionsTotal)).toBe(true);
    expect(ties(summary.takeoffSubtotal + summary.linkedDivisionsTotal, summary.subtotal)).toBe(true);
  });

  it("reproduces every estimate modifier to the cent", () => {
    for (const m of ESTIMATE_MODIFIERS) {
      const engineValue = summary[m.key as keyof TakeoffSummary] as number;
      const oracleValue = SYNTHETIC_ORACLE.modifiers[m.key];
      expect(ties(engineValue, oracleValue), `${m.key}: engine $${engineValue} vs oracle $${oracleValue}`).toBe(true);
    }
  });

  it("reproduces cost/unit and cost/SF to the cent", () => {
    expect(ties(summary.costPerUnit, SYNTHETIC_ORACLE.costPerUnit)).toBe(true);
    expect(ties(summary.costPerSf, SYNTHETIC_ORACLE.costPerSf)).toBe(true);
  });

  it("ties each STEP 2/3 section subtotal to its STEP 4 linked row (template linkage)", () => {
    const linkedByItemId = new Map(extracted.oracle.linkedDivisionValues.map((l) => [l.itemId, l.total]));
    let tied = 0;
    for (const src of extracted.oracle.linkedSourceSubtotals) {
      expect(src.total, `no cached STEP 2/3 subtotal for ${src.itemId}`).not.toBeNull();
      const linkedVal = linkedByItemId.get(src.itemId);
      expect(linkedVal, `no STEP 4 linked row for ${src.itemId}`).toBeDefined();
      expect(ties(src.total as number, linkedVal as number), `${src.itemId}: STEP 2/3 $${src.total} vs STEP 4 $${linkedVal}`).toBe(true);
      // The linked value also matches the hand-authored expectation.
      expect(ties(linkedVal as number, SYNTHETIC_ORACLE.linkedValuesByItemId[src.itemId])).toBe(true);
      tied++;
    }
    // All 10 linkages are cached in the synthetic fixture (vs 9 of 10 on McKenna).
    expect(tied).toBe(SYNTHETIC_ORACLE.linkedRowCount);
  });
});
