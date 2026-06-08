/**
 * Golden reproduction harness — the ⭐ keystone trust artifact (Phase 2 of
 * `docs/plans/make-the-math-trustworthy.md`).
 *
 * Proves, on a REAL completed bid, that the calculation engine reproduces the
 * company Excel template's live "STEP 4 - ESTIMATE" sheet **to the cent**
 * ($0.01). The oracle is read at runtime from a git-ignored workbook — both the
 * inputs AND the expected outputs come from that one file, so no confidential
 * bid figure is ever hardcoded in this committed test.
 *
 * The suite **skips cleanly** (`describe.skipIf`) on any machine without the
 * fixture (CI, a teammate's laptop): it never fails for lack of the file.
 *
 * What is proven to the cent (INV-1 / INV-2 / INV-4 on real data):
 *   computeTakeoffSummary, fed the extracted STEP 4 line items (incl. the 10
 *   GC/Site-Ops linked-row values Excel pulled from STEP 2/3) and the STEP 1
 *   modifier rates, reproduces the bid's SUBTOTAL → 7 modifiers → TOTAL → cost/
 *   unit exactly.
 *
 * Dispositioned residual deltas (see docs/correctness-contract.md §"Golden
 * reproduction — McKenna findings"):
 *   - The Excel applies NO rounding, so the engine runs roundingRule:"none" to
 *     match (a "dollar" rounding rule would diverge by up to ~$0.50/modifier).
 *   - The bid's STEP 2/3 sheets are hand-authored and do NOT follow the app's
 *     parametric GC/Site-Ops driver model, so the deep STEP 2/3 reconstruction
 *     is NOT asserted; instead the harness ties each STEP 2/3 section subtotal
 *     to its STEP 4 linked row (the template's own internal linkage).
 *   - The bid's Budget Line Items rollup is #REF!-broken — which is exactly why
 *     the exporter rewrites BLI as computed values; recorded, not asserted.
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { computeTakeoffSummary, type TakeoffSummary } from "../lib/calculations";
import { RECONCILIATION_TOLERANCE } from "../lib/exporter";
import {
  extractEstimate,
  loadTemplateWorkbook,
  toProcessedRows,
  linkedTotalsFromExtract,
  type ExtractedEstimate,
} from "../lib/templateExtractor";

// ---------------------------------------------------------------------------
// Oracle resolution — env → fixtures/golden → architect's master copy.
// ---------------------------------------------------------------------------
function resolveGoldenFixture(): string | null {
  const candidates = [
    process.env.TAKEOFF_GOLDEN_XLSX,
    path.resolve(__dirname, "../../fixtures/golden/McKenna-Crossing-Estimate.xlsx"),
    "C:\\Users\\BUrness\\takeoff-bridge-fixtures\\McKenna-Crossing-Estimate.xlsx",
  ].filter((c): c is string => Boolean(c));
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore unreadable candidate */
    }
  }
  return null;
}

const FIXTURE = resolveGoldenFixture();

/** Within the $0.01 match bar (the exact constant the exporter reconciles on). */
function ties(a: number, b: number): boolean {
  return Math.abs(a - b) <= RECONCILIATION_TOLERANCE;
}

// The McKenna Excel applies NO rounding to its modifiers/total, so the engine
// must reproduce it with "none" (Phase 2.4 finding — see file header).
const NONE_ROUNDING = "none";

describe.skipIf(!FIXTURE)("Golden reproduction — McKenna STEP 4 to the cent", () => {
  let extracted: ExtractedEstimate;
  let summary: TakeoffSummary;

  beforeAll(async () => {
    const buffer = fs.readFileSync(FIXTURE as string);
    const wb = await loadTemplateWorkbook(buffer);
    extracted = extractEstimate(wb);

    // Feed ALL STEP 4 line items + the linked-row values through the engine.
    // computeTakeoffSummary counts non-linked rows as qty×price and each linked
    // itemId once as its linked value (the typed qty×price of a linked row never
    // counts — the double-count trap closure).
    const rows = toProcessedRows(extracted.lineItems);
    const linked = linkedTotalsFromExtract(extracted.lineItems);
    summary = computeTakeoffSummary(
      rows,
      extracted.inputs.squareFootage,
      extracted.inputs.unitCount,
      { ...extracted.inputs.rates, roundingRule: NONE_ROUNDING },
      linked
    );
  });

  it("extracts a structurally-sound oracle (sanity, no hardcoded bid figures)", () => {
    expect(extracted.lineItems.length).toBeGreaterThan(50);
    expect(extracted.lineItems.filter((l) => l.isLinked)).toHaveLength(10);
    expect(extracted.inputs.squareFootage).toBeGreaterThan(0);
    expect(extracted.inputs.unitCount).toBeGreaterThan(0);
    expect(extracted.oracle.step4Subtotal).toBeGreaterThan(0);
    expect(extracted.oracle.totalEstimatedCost).toBeGreaterThan(extracted.oracle.step4Subtotal);
  });

  it("INV-1 keystone: reproduces the live STEP 4 SUBTOTAL to the cent", () => {
    const delta = summary.subtotal - extracted.oracle.step4Subtotal;
    expect(Math.abs(delta), `subtotal delta $${delta.toFixed(4)} exceeds $0.01`).toBeLessThanOrEqual(
      RECONCILIATION_TOLERANCE
    );
  });

  it("INV-2 on real data: subtotal = takeoff rows + linked division values, deduped", () => {
    // The decomposition the contract promises, on the real bid.
    expect(ties(summary.takeoffSubtotal + summary.linkedDivisionsTotal, summary.subtotal)).toBe(true);
    // linkedDivisionsTotal == Σ of the 10 extracted linked-row values, each once.
    const sumLinked = extracted.oracle.linkedDivisionValues.reduce((s, l) => s + l.total, 0);
    expect(ties(summary.linkedDivisionsTotal, sumLinked)).toBe(true);
  });

  it("reproduces every estimate modifier to the cent", () => {
    const fieldByKey: Record<string, keyof TakeoffSummary> = {
      constructionContingency: "constructionContingency",
      designContingency: "designContingency",
      buildersRisk: "buildersRisk",
      specialInsurance: "specialInsurance",
      glInsurance: "glInsurance",
      bond: "bond",
      fee: "fee",
    };
    let asserted = 0;
    for (const mod of extracted.oracle.modifiers) {
      if (mod.total === null) continue; // uncached zero-rate modifier cell — nothing to tie to
      const engineValue = summary[fieldByKey[mod.key]] as number;
      expect(ties(engineValue, mod.total), `${mod.key} engine $${engineValue} vs oracle $${mod.total}`).toBe(true);
      asserted++;
    }
    // McKenna carries Construction Contingency, GL, and Fee at minimum.
    expect(asserted).toBeGreaterThanOrEqual(3);
  });

  it("INV-1 keystone: reproduces the Total Estimated Cost and cost/unit to the cent", () => {
    const delta = summary.totalEstimatedCost - extracted.oracle.totalEstimatedCost;
    expect(Math.abs(delta), `total delta $${delta.toFixed(4)} exceeds $0.01`).toBeLessThanOrEqual(
      RECONCILIATION_TOLERANCE
    );
    if (extracted.oracle.costPerUnit !== null) {
      expect(ties(summary.costPerUnit, extracted.oracle.costPerUnit)).toBe(true);
    }
    // cost/SF reconstitutes the (independently-tied) total over the bid's sqft.
    expect(ties(summary.costPerSf, extracted.oracle.totalEstimatedCost / extracted.inputs.squareFootage)).toBe(true);
  });

  it("ties each STEP 2/3 section subtotal to its STEP 4 linked row (template linkage)", () => {
    const linkedByItemId = new Map(extracted.oracle.linkedDivisionValues.map((l) => [l.itemId, l.total]));
    // STEP 2 named subtotals feed the two GC linked rows.
    expect(extracted.oracle.step2SupervisionSubtotal).not.toBeNull();
    expect(extracted.oracle.step2DesignPmGcSubtotal).not.toBeNull();
    expect(ties(extracted.oracle.step2SupervisionSubtotal!, linkedByItemId.get("01-0400.002")!)).toBe(true);
    expect(ties(extracted.oracle.step2DesignPmGcSubtotal!, linkedByItemId.get("01-0000.001")!)).toBe(true);

    // Every cached STEP 2/3 section subtotal must equal its STEP 4 linked row.
    let tied = 0;
    for (const src of extracted.oracle.linkedSourceSubtotals) {
      if (src.total === null) continue; // uncached subtotal (e.g. Special Inspections, qty 0) — dispositioned
      const linkedVal = linkedByItemId.get(src.itemId);
      expect(linkedVal, `no STEP 4 linked row for ${src.itemId}`).toBeDefined();
      expect(ties(src.total, linkedVal!), `${src.itemId}: STEP 2/3 $${src.total} vs STEP 4 $${linkedVal}`).toBe(true);
      tied++;
    }
    expect(tied).toBeGreaterThanOrEqual(9); // 9 of 10 cached; Special Inspections dispositioned
  });

  it("records the oracle's Budget Line Items rollup state (broken → app rewrites as values)", () => {
    // The 217 granular Budget Line Item codes the exporter targets.
    expect(extracted.oracle.bliRowCount).toBe(217);
    // This bid's BLI rollup is #REF!-broken in places — recorded, not asserted as
    // a tie-out. It is the concrete reason the exporter writes BLI as computed
    // values (see docs/correctness-contract.md §Golden findings). This canary
    // guards the *source spreadsheet's* defect; if a future oracle is refreshed
    // through the app's own exporter (which produces a clean value-based BLI),
    // revisit this expectation rather than the engine.
    expect(extracted.oracle.bliBrokenRowCount).toBeGreaterThan(0);
  });
});
