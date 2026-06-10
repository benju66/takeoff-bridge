/**
 * Legacy-bid golden — a REAL pre-app bid through the Phase-2 import path.
 *
 * The CARE workbook (gitignored, local-only) is the legacy shape the importer
 * must normalize: 142 dollar lines under BARE base codes, three hand-typed
 * lump-sum modifier rows ("Owner's Rep", "Professional Service Fees"), and the
 * workbook's own BLI SUMIF mapping. This harness proves on real data that:
 *
 *   1. The SUBTOTAL and GRAND TOTAL tie to the cent ($0.01) with the lump
 *      overrides applied — before AND after accepting every high-confidence
 *      mapping suggestion (the exact flow the import page runs).
 *   2. The legacy bridge actually derives a usable share of the bid's own
 *      code mapping (it isn't an empty best-effort).
 *
 * Skips cleanly (`describe.skipIf`) on machines without the file (CI, other
 * laptops) — the synthetic legacy golden in legacy-import.test.ts is the
 * CI-safe twin of this proof.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { computeTakeoffSummary, type TakeoffSummary } from "../lib/calculations";
import { RECONCILIATION_TOLERANCE } from "../lib/exporter";
import { extractEstimate, loadTemplateWorkbook, type ExtractedEstimate } from "../lib/templateExtractor";
import { deriveLegacyBridge } from "../lib/legacyBridge";
import {
  enrichImportedRows,
  importSummaryRates,
  linkedTotalsFromRows,
  buildReverseProcoreMap,
  suggestImportMappings,
  applyImportMapping,
  lumpOverridesFromExtract,
  overrideMapFromIntents,
  checkImportTieOut,
  catalogCostCodeEntries,
  step23LinesForImport,
  type MappingSuggestion,
} from "../lib/importEstimate";
import { primeCostCodeResolverFromCatalog, resetCostCodeResolver } from "../lib/costCodeResolver";
import type { ProcessedTakeoffRow } from "@/types";

function resolvePastBidFixture(): string | null {
  const candidates = [
    process.env.TAKEOFF_PAST_BID_XLSX,
    path.resolve(__dirname, "../../fixtures/past-bids/2026.04.03 CARE Schematic Design Estimate.LIVE.xlsx"),
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

const FIXTURE = resolvePastBidFixture();

describe.skipIf(!FIXTURE)("Golden legacy import — CARE bid to the cent", () => {
  let extracted: ExtractedEstimate;
  let rows: ProcessedTakeoffRow[];
  let suggestions: Map<string, MappingSuggestion>;
  let overrides: Record<string, number>;

  const summarize = (r: ProcessedTakeoffRow[]): TakeoffSummary =>
    computeTakeoffSummary(
      r,
      extracted.inputs.squareFootage,
      extracted.inputs.unitCount,
      importSummaryRates(extracted.inputs),
      linkedTotalsFromRows(r),
      overrides
    );

  beforeAll(async () => {
    primeCostCodeResolverFromCatalog(); // offline harness — catalog fallback, same as the page's
    const wb = await loadTemplateWorkbook(fs.readFileSync(FIXTURE as string));
    extracted = extractEstimate(wb);
    rows = enrichImportedRows(extracted);
    const reverse = buildReverseProcoreMap(catalogCostCodeEntries());
    suggestions = suggestImportMappings(extracted, deriveLegacyBridge(wb), reverse);
    overrides = overrideMapFromIntents(lumpOverridesFromExtract(extracted, path.basename(FIXTURE as string)));
  });
  afterAll(() => resetCostCodeResolver());

  it("extracts the legacy shape: all dollar lines are bare-coded ad-hoc rows", () => {
    expect(extracted.lineItems).toHaveLength(0); // no suffixed codes anywhere
    expect(extracted.adHocLineItems.length).toBeGreaterThan(100);
    const withBareCode = extracted.adHocLineItems.filter((i) => i.rawCode !== "").length;
    expect(withBareCode).toBe(extracted.adHocLineItems.length); // every line keeps its code
  });

  it("classifies the bid's hand-typed lump-sum modifiers", () => {
    const lumps = lumpOverridesFromExtract(extracted, "care.xlsx");
    expect(lumps.length).toBeGreaterThanOrEqual(3);
    const lumpSum = lumps.reduce((s, l) => s + l.overrideValue, 0);
    // The CARE probe traced the grand-total gap to exactly this figure.
    expect(Math.abs(lumpSum - 2_380_850)).toBeLessThanOrEqual(RECONCILIATION_TOLERANCE);
    const labels = lumps.map((l) => l.reason).join(" ");
    expect(labels).toContain("Owner's Rep");
    expect(labels).toContain("Professional Service Fees");
  });

  it("captures the bid's hand-authored STEP 2/3 detail for the read-only panels", () => {
    // The CARE probe (2026-06-10) found 19 STEP 2 and 16 STEP 3 dollar lines
    // under bare codes — the payload must keep carrying a healthy share.
    const payload = step23LinesForImport(extracted);
    expect(payload.step2Lines.length).toBeGreaterThanOrEqual(15);
    expect(payload.step3Lines.length).toBeGreaterThanOrEqual(10);
    expect(payload.step2Lines.every((l) => l.total !== 0)).toBe(true);
    // Known real lines from the probe.
    const supt = payload.step2Lines.find((l) => l.description === "Sr Superintendent");
    expect(Math.abs((supt?.total ?? 0) - 227_325)).toBeLessThanOrEqual(0.01);
    expect(payload.step3Lines.filter((l) => l.code === "02-4100").length).toBe(3); // three demolition scopes
    expect(payload.linkedSourceSubtotals.length).toBeGreaterThan(0);
  });

  it("derives a usable bridge + suggestions (not an empty best-effort)", () => {
    const tally: Record<string, number> = { bridge: 0, linked: 0, similar: 0, none: 0 };
    for (const s of suggestions.values()) tally[s.confidence]++;
    // Floors set from the real file with margin — regressions here mean the
    // bridge or tiers stopped reading this workbook's own mapping.
    expect(tally.bridge + tally.linked).toBeGreaterThanOrEqual(40);
    expect(tally.none).toBeLessThanOrEqual(10);
  });

  it("ties SUBTOTAL and GRAND TOTAL to the cent — raw, and after accepting high-confidence mappings", () => {
    // Raw import (nothing confirmed yet) — the state the tie-out gate sees first.
    const raw = checkImportTieOut(summarize(rows), extracted.oracle);
    expect(Math.abs(raw.deltaSubtotal)).toBeLessThanOrEqual(RECONCILIATION_TOLERANCE);
    expect(Math.abs(raw.deltaTotal)).toBeLessThanOrEqual(RECONCILIATION_TOLERANCE);
    expect(raw.ok).toBe(true);

    // Accept-all-high-confidence — exactly what the page button does.
    const mapped = rows.map((r) => {
      const s = suggestions.get(r.id);
      return s && (s.confidence === "bridge" || s.confidence === "linked") && s.itemId
        ? applyImportMapping(r, s.itemId)
        : r;
    });
    const after = checkImportTieOut(summarize(mapped), extracted.oracle);
    expect(Math.abs(after.deltaSubtotal)).toBeLessThanOrEqual(RECONCILIATION_TOLERANCE);
    expect(Math.abs(after.deltaTotal)).toBeLessThanOrEqual(RECONCILIATION_TOLERANCE);
    expect(after.ok).toBe(true);
  });
});
