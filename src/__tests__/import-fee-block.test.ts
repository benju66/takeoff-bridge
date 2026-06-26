/**
 * Division 60 Fee-Block Addressability — Phase 6 import fold-in + tie-out golden (CI-safe).
 *
 * Proves, on every machine, the capstone behaviour: a past bid carrying a HAND-KEYED flat
 * fee line in the Division 60 fee block (below the SUBTOTAL — today silently dropped) is
 * CAPTURED as a markup section line so the import ties out to the cent.
 *
 *   - the extractor captures the fee row as a markup line (section='markup',
 *     entry_kind='lumpSum', source='csv_import') with its dollar intact and its Procore
 *     code BLANK (needs-review — never guessed);
 *   - WITHOUT the captured fee the engine total is short by exactly the fee ($2,500) — the
 *     off-by-$2,500 tie-out failure;
 *   - WITH it (passed as markupLines into computeTakeoffSummary) the total ties to $0.00
 *     while the subtotal and all 7 modifiers are byte-identical (a flat below-subtotal
 *     addend, never marked up);
 *   - the captured line is editable + unmapped in the review: applyFeeLineMappings layers a
 *     validateOneOffCode-resolved Procore assignment without moving the dollar (tie stays
 *     $0.00) and is fully revertible, never mutating the originals;
 *   - a bid whose fee block is the 7 modifiers only extracts feeLines === [] (regression).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { computeTakeoffSummary } from "../lib/calculations";
import { RECONCILIATION_TOLERANCE } from "../lib/exporter";
import {
  extractEstimate,
  loadTemplateWorkbook,
  linkedTotalsFromExtract,
  type ExtractedEstimate,
} from "../lib/templateExtractor";
import {
  enrichImportedRows,
  importSummaryRates,
  checkImportTieOut,
  applyFeeLineMappings,
} from "../lib/importEstimate";
import { feeLineAmount, isMarkupLine, MARKUP_SECTION } from "../lib/sectionLines/markup";
import { ENTRY_KIND } from "../lib/sectionLines/entryKinds";
import { validateOneOffCode } from "../lib/sectionLines/oneOff";
import {
  primeCostCodeResolverFromCatalog,
  resetCostCodeResolver,
} from "../lib/costCodeResolver";
import type { ProcessedTakeoffRow } from "../types";
import type { EstimateSectionLine } from "../types/db";
import {
  buildFeeBlockPastBidTemplateBuffer,
  buildPastBidTemplateBuffer,
  FEE_BLOCK_PAST_BID_ORACLE,
} from "./fixtures/syntheticTemplate";

function ties(a: number, b: number): boolean {
  return Math.abs(a - b) <= RECONCILIATION_TOLERANCE;
}

describe("Import past bids — Phase 6 fee-block fold-in (CI-safe)", () => {
  let extracted: ExtractedEstimate;
  let rows: ProcessedTakeoffRow[];

  beforeAll(async () => {
    primeCostCodeResolverFromCatalog();
    const wb = await loadTemplateWorkbook(await buildFeeBlockPastBidTemplateBuffer());
    extracted = extractEstimate(wb);
    rows = enrichImportedRows(extracted);
  });

  afterAll(() => resetCostCodeResolver());

  /** The engine summary fed the captured fee lines (the import-page path). */
  const summaryWith = (markupLines: EstimateSectionLine[]) =>
    computeTakeoffSummary(
      rows,
      extracted.inputs.squareFootage,
      extracted.inputs.unitCount,
      importSummaryRates(extracted.inputs),
      linkedTotalsFromExtract(extracted.lineItems),
      undefined,
      markupLines
    );

  // ── Capture: the dropped fee line is now a markup section line ──
  it("captures the hand-keyed fee row as one unmapped markup line", () => {
    expect(extracted.feeLines).toHaveLength(1);
    const [fee] = extracted.feeLines;
    expect(fee.section).toBe(MARKUP_SECTION);
    expect(fee.entryKind).toBe(ENTRY_KIND.LumpSum);
    expect(fee.source).toBe("csv_import");
    expect(fee.label).toBe(FEE_BLOCK_PAST_BID_ORACLE.feeLineLabel);
    expect(feeLineAmount(fee)).toBe(FEE_BLOCK_PAST_BID_ORACLE.feeLineAmount); // 2,500
    // Procore code BLANK (needs-review — never guessed, AGENTS.md), even though the sheet
    // row carried a 60-4000.002 code (an internal code, not a Procore BLI).
    expect(fee.procoreCode).toBe("");
    expect(fee.costType).toBe("");
    expect(isMarkupLine(fee)).toBe(true);
  });

  // ── The bug: without the captured fee the total is short by exactly the fee ──
  it("does NOT tie without the captured fee (the off-by-$2,500 failure)", () => {
    const gate = checkImportTieOut(summaryWith([]), extracted.oracle);
    expect(gate.ok).toBe(false);
    expect(gate.deltaTotal).toBe(-FEE_BLOCK_PAST_BID_ORACLE.feeLineAmount); // -2,500
    expect(gate.tiesSubtotal).toBe(true); // the gap is the fee alone, not the subtotal
  });

  // ── The fix: with the captured fee the import ties to $0.00 ──
  it("ties to $0.00 with the captured fee — subtotal + 7 modifiers byte-identical", () => {
    const without = summaryWith([]);
    const summary = summaryWith(extracted.feeLines);

    const gate = checkImportTieOut(summary, extracted.oracle);
    expect(gate.ok).toBe(true);
    expect(gate.deltaTotal).toBe(0);
    expect(gate.deltaSubtotal).toBe(0);
    expect(ties(summary.totalEstimatedCost, FEE_BLOCK_PAST_BID_ORACLE.totalEstimatedCost)).toBe(true);

    // The fee is a FLAT below-subtotal addend: only additionalFees rises by the fee; the
    // subtotal and every one of the 7 modifiers are unchanged (no compounding).
    expect(summary.additionalFees).toBe(FEE_BLOCK_PAST_BID_ORACLE.feeLineAmount);
    expect(summary.subtotal).toBe(without.subtotal);
    expect(summary.constructionContingency).toBe(without.constructionContingency);
    expect(summary.designContingency).toBe(without.designContingency);
    expect(summary.buildersRisk).toBe(without.buildersRisk);
    expect(summary.specialInsurance).toBe(without.specialInsurance);
    expect(summary.glInsurance).toBe(without.glInsurance);
    expect(summary.bond).toBe(without.bond);
    expect(summary.fee).toBe(without.fee);
    // The whole gap the bug opened is exactly the fee.
    expect(summary.totalEstimatedCost - without.totalEstimatedCost).toBe(
      FEE_BLOCK_PAST_BID_ORACLE.feeLineAmount
    );
  });

  // ── Review: editable + unmapped; assigning a Procore code moves no dollar ──
  it("is editable + unmapped, and a valid assignment ties unchanged + reverts cleanly", () => {
    const [fee] = extracted.feeLines;
    // A real Procore code resolved through the SAME validation the fee block uses — a
    // baseline GC/Site-Ops code (type unknown in the JSON baseline → defaults to M).
    const resolved = validateOneOffCode("2-29010.000");
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const assignments = new Map([
      [fee.id, { procoreCode: resolved.procoreCode, costType: resolved.costType }],
    ]);

    const mapped = applyFeeLineMappings(extracted.feeLines, assignments);
    expect(mapped[0].procoreCode).toBe(resolved.procoreCode);
    expect(mapped[0].costType).toBe(resolved.costType);
    // The amount — and therefore the tie-out — never moves.
    expect(feeLineAmount(mapped[0])).toBe(FEE_BLOCK_PAST_BID_ORACLE.feeLineAmount);
    expect(checkImportTieOut(summaryWith(mapped), extracted.oracle).deltaTotal).toBe(0);

    // Revertible (withdraw the entry → unmapped again); originals never mutated.
    const reverted = applyFeeLineMappings(extracted.feeLines, new Map());
    expect(reverted[0].procoreCode).toBe("");
    expect(extracted.feeLines[0].procoreCode).toBe("");
  });
});

describe("Phase 6 regression — a 7-modifier-only fee block captures nothing", () => {
  it("extracts feeLines === [] for an ordinary past bid", async () => {
    const wb = await loadTemplateWorkbook(await buildPastBidTemplateBuffer());
    expect(extractEstimate(wb).feeLines).toEqual([]);
  });
});
