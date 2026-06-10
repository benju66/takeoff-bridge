/**
 * Import past bids — Phase 1 tie-out + same-code/ad-hoc proof (CI-safe).
 *
 * Mirrors the B-1 synthetic-golden pattern: builds a non-confidential past-bid
 * workbook in-memory, runs the FULL import path
 * (loadTemplateWorkbook → extractEstimate → enrichImportedRows →
 * computeTakeoffSummary), and proves on EVERY machine that:
 *   - the imported total ties the workbook's own oracle to the cent (import AND
 *     reload paths),
 *   - an ad-hoc (non-conforming) line is imported, not dropped, and flagged,
 *   - a conforming-but-uncatalogued line imports unmapped,
 *   - two lines sharing one code stay independent (unique ids, kept imported
 *     price) yet roll up to a single Procore code.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { computeTakeoffSummary } from "../lib/calculations";
import { rollupByProcoreCode, RECONCILIATION_TOLERANCE } from "../lib/exporter";
import {
  extractEstimate,
  loadTemplateWorkbook,
  linkedTotalsFromExtract,
  type ExtractedEstimate,
} from "../lib/templateExtractor";
import {
  enrichImportedRows,
  linkedTotalsFromRows,
  importSummaryRates,
  projectFromExtract,
  estimateTotalsForImport,
  checkImportTieOut,
  uomMismatch,
} from "../lib/importEstimate";
import { ESTIMATE_ITEMS_MASTER } from "../lib/mock-data";
import {
  primeCostCodeResolverFromCatalog,
  resetCostCodeResolver,
} from "../lib/costCodeResolver";
import type { ProcessedTakeoffRow } from "../types";
import { buildPastBidTemplateBuffer, PAST_BID_ORACLE, SYNTHETIC_INPUTS } from "./fixtures/syntheticTemplate";

function ties(a: number, b: number): boolean {
  return Math.abs(a - b) <= RECONCILIATION_TOLERANCE;
}

describe("Import past bids — Phase 1 (enrich + tie-out, CI-safe)", () => {
  let extracted: ExtractedEstimate;
  let rows: ProcessedTakeoffRow[];

  beforeAll(async () => {
    // Prime the granular-code resolver exactly as the workspace mount does, but
    // from the static catalog (the DB-backed map is identical at seed time).
    primeCostCodeResolverFromCatalog();
    const buffer = await buildPastBidTemplateBuffer();
    const wb = await loadTemplateWorkbook(buffer);
    extracted = extractEstimate(wb);
    rows = enrichImportedRows(extracted);
  });

  afterAll(() => resetCostCodeResolver());

  // ── Extraction: ad-hoc gap closed without disturbing the conforming path ──
  it("captures conforming lines in lineItems and ad-hoc lines separately", () => {
    expect(extracted.lineItems).toHaveLength(PAST_BID_ORACLE.conformingLineItemCount);
    expect(extracted.adHocLineItems).toHaveLength(PAST_BID_ORACLE.adHocLineItemCount);
    // Every conforming line is NOT flagged ad-hoc; the ad-hoc one is.
    expect(extracted.lineItems.every((l) => !l.isAdHoc)).toBe(true);
    expect(extracted.adHocLineItems.every((l) => l.isAdHoc && l.itemId === "")).toBe(true);
  });

  // ── Enrichment fidelity ──
  it("keeps the imported unit price and resolves the granular Procore code", () => {
    const storefront = rows.filter((r) => r.itemId === PAST_BID_ORACLE.sameCodeItemId);
    expect(storefront).toHaveLength(2);
    for (const r of storefront) {
      expect(r.unitPrice).toBe(PAST_BID_ORACLE.sameCodeImportedUnitPrice); // 1000, NOT catalog 6500
      expect(r.procoreCode).toBe(PAST_BID_ORACLE.sameCodeProcoreCode);
      expect(r.source).toBe("imported");
      expect(r.isMapped).toBe(true);
    }
  });

  it("gives same-code lines UNIQUE ids and keeps their distinct descriptions", () => {
    const storefront = rows.filter((r) => r.itemId === PAST_BID_ORACLE.sameCodeItemId);
    const ids = new Set(storefront.map((r) => r.id));
    expect(ids.size).toBe(2); // no collision (bare import-${itemId} would collide)
    const descriptions = new Set(storefront.map((r) => r.description));
    expect(descriptions.size).toBe(2); // interior vs exterior preserved
  });

  it("imports a conforming-but-uncatalogued code as unmapped (Flags worklist)", () => {
    const unmapped = rows.find((r) => r.itemId === PAST_BID_ORACLE.uncataloguedItemId);
    expect(unmapped).toBeDefined();
    expect(unmapped!.procoreCode).toBe(""); // not in catalog → no guessed code
    expect(unmapped!.isMapped).toBe(false);
    expect(unmapped!.source).toBe("imported");
  });

  it("imports the ad-hoc line (never dropped) and flags it for review", () => {
    const adHoc = rows.find((r) => r.description === PAST_BID_ORACLE.adHocDescription);
    expect(adHoc).toBeDefined();
    expect(adHoc!.needsReview).toBe(true);
    expect(adHoc!.itemId).toBe(""); // no valid code
    expect(adHoc!.source).toBe("imported");
    // Its dollars survive: matchedQty × unitPrice reproduces the line total.
    expect(adHoc!.matchedQty * adHoc!.unitPrice).toBe(PAST_BID_ORACLE.adHocTotal);
  });

  // ── As-bid UOM fidelity (Phase 3 Slice 0) ──
  it("keeps the bid's UOM on enriched rows — the catalog never overwrites it", () => {
    const storefront = rows.filter((r) => r.itemId === PAST_BID_ORACLE.sameCodeItemId);
    expect(storefront).toHaveLength(2);
    for (const r of storefront) {
      // Written lowercase "sf" in col G; extracted uppercase; catalog says EA.
      expect(r.uom).toBe(PAST_BID_ORACLE.sameCodeBidUom);
      expect(r.uom).not.toBe(PAST_BID_ORACLE.sameCodeCatalogUom);
      // The disagreement is REPORTED (display-only), never silently resolved.
      expect(uomMismatch(r)).toEqual({
        bid: PAST_BID_ORACLE.sameCodeBidUom,
        catalog: PAST_BID_ORACLE.sameCodeCatalogUom,
      });
    }
  });

  it("falls back to the catalog UOM only when the bid's col-G cell is blank", () => {
    const blank = rows.find((r) => r.itemId === PAST_BID_ORACLE.blankUomItemId)!;
    expect(blank.uom).toBe(ESTIMATE_ITEMS_MASTER[PAST_BID_ORACLE.blankUomItemId].targetUom);
    expect(uomMismatch(blank)).toBeNull(); // a fallback is not a mismatch
  });

  // ── Same code, different scope = presentation only → one Procore code ──
  it("rolls both same-code lines up into a single Procore code", () => {
    const rollup = rollupByProcoreCode(rows);
    expect(rollup[PAST_BID_ORACLE.sameCodeProcoreCode]).toBe(PAST_BID_ORACLE.sameCodeTotal); // 3000 + 5000
  });

  it("keeps same-code lines as independent objects (editing one cannot mutate the other)", () => {
    // Fresh rows so this mutation never pollutes the shared tie-out fixtures.
    const fresh = enrichImportedRows(extracted);
    const storefront = fresh.filter((r) => r.itemId === PAST_BID_ORACLE.sameCodeItemId);
    const [a, b] = storefront;
    const bPrice = b.unitPrice;
    a.unitPrice = 99_999; // mutate one row object
    expect(b.unitPrice).toBe(bPrice); // the other is untouched (distinct objects)
  });

  // ── The tie-out acceptance gate (import time) ──
  it("INV-1: imported total ties the workbook oracle to the cent (import path)", () => {
    const summary = computeTakeoffSummary(
      rows,
      extracted.inputs.squareFootage,
      extracted.inputs.unitCount,
      importSummaryRates(extracted.inputs),
      linkedTotalsFromExtract(extracted.lineItems)
    );
    expect(ties(summary.subtotal, PAST_BID_ORACLE.subtotal)).toBe(true);
    expect(ties(summary.totalEstimatedCost, PAST_BID_ORACLE.totalEstimatedCost)).toBe(true);

    const gate = checkImportTieOut(summary, extracted.oracle);
    expect(gate.ok).toBe(true);
    expect(Math.abs(gate.deltaSubtotal)).toBeLessThanOrEqual(RECONCILIATION_TOLERANCE);
    expect(Math.abs(gate.deltaTotal)).toBeLessThanOrEqual(RECONCILIATION_TOLERANCE);
  });

  // ── Reload path: linked statics derived from the SAVED rows still tie (G-2) ──
  it("INV-1 (reload): saved imported rows still tie via linkedTotalsFromRows", () => {
    const summary = computeTakeoffSummary(
      rows,
      extracted.inputs.squareFootage,
      extracted.inputs.unitCount,
      importSummaryRates(extracted.inputs),
      linkedTotalsFromRows(rows) // simulates reopen — no STEP 2/3 recompute
    );
    expect(ties(summary.subtotal, PAST_BID_ORACLE.subtotal)).toBe(true);
    expect(ties(summary.totalEstimatedCost, PAST_BID_ORACLE.totalEstimatedCost)).toBe(true);
    expect(ties(summary.linkedDivisionsTotal, PAST_BID_ORACLE.linkedDivisionsTotal)).toBe(true);
    expect(ties(summary.takeoffSubtotal, PAST_BID_ORACLE.takeoffSubtotal)).toBe(true);
  });

  // ── Project + estimate mapping ──
  it("maps extracted inputs to an imported Project carrying the bid's rates", () => {
    const project = projectFromExtract(extracted, { id: "test-import-1" });
    expect(project.isImported).toBe(true);
    expect(project.squareFootage).toBe(SYNTHETIC_INPUTS.squareFootage);
    expect(project.unitCount).toBe(SYNTHETIC_INPUTS.unitCount);
    expect(project.feeRate).toBe(SYNTHETIC_INPUTS.rates.fee);
    expect(project.roundingRule).toBe("none");
  });

  it("maps the computed summary to estimate totals (sole authority preserved)", () => {
    const summary = computeTakeoffSummary(
      rows,
      extracted.inputs.squareFootage,
      extracted.inputs.unitCount,
      importSummaryRates(extracted.inputs),
      linkedTotalsFromRows(rows)
    );
    const est = estimateTotalsForImport("test-import-1", summary, rows);
    expect(ties(est.subtotal, PAST_BID_ORACLE.subtotal)).toBe(true);
    expect(ties(est.totalCost, PAST_BID_ORACLE.totalEstimatedCost)).toBe(true);
    // GC (Div 01) + Site Ops (Div 02) linked subtotals sum to the linked total.
    expect(ties((est.generalConditionsTotal ?? 0) + (est.siteOperationsTotal ?? 0), PAST_BID_ORACLE.linkedDivisionsTotal)).toBe(true);
  });
});
