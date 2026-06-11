/**
 * Imported STEP 2/3 truthfulness (architect finding, 2026-06-10).
 *
 * A finished bid's hand-authored GC/Site-Ops detail must (1) survive extraction
 * despite bare legacy codes, (2) build the `imported_step23_lines` payload the
 * read-only panels render, (3) drive the PERSISTED section totals (never the
 * parametric defaults that fabricated "Safety $5,000"), and (4) drive the
 * reconciliation gate on the linked-row basis.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { extractEstimateFromBuffer } from "@/lib/templateExtractor";
import {
  enrichImportedRows,
  applyImportMapping,
  step23LinesForImport,
  linkedSectionTotals,
  estimateTotalsForImport,
  importSummaryRates,
  linkedTotalsFromRows,
} from "@/lib/importEstimate";
import { computeTakeoffSummary, type PersonnelCalcResult, type SiteOpsCalcResult } from "@/lib/calculations";
import { validateExportReadiness, importedLinkedGcSiteOpsLines } from "@/lib/exporter";
import { LINKED_DIVISION_ROWS } from "@/lib/constants";
import { primeCostCodeResolverFromCatalog, resetCostCodeResolver } from "@/lib/costCodeResolver";
import { resolveStep23Line } from "@/lib/step23Normalization";
import { buildLegacyPastBidTemplateBuffer, LEGACY_PAST_BID_ORACLE } from "./fixtures/syntheticTemplate";
import type { ProcessedTakeoffRow } from "@/types";

const EMPTY_GC: PersonnelCalcResult = {
  staffLines: [], operationalLines: [], equipmentLines: [], manualLines: [],
  equipmentTotal: 0, grandTotal: 0,
};
const EMPTY_SITEOPS: SiteOpsCalcResult = { dynamicLines: [], manualLines: [], grandTotal: 0 };

/** A parametric calc result carrying DEFAULT-derived junk a bid never had. */
const JUNK_GC: PersonnelCalcResult = {
  ...EMPTY_GC,
  staffLines: [{ code: "01-0310.001", procoreCode: "1-10310.000", costType: "L", role: "Project Executive", rate: 175, qty: 44.4, total: 7_777, utilization: 0.1 }],
  grandTotal: 7_777,
};

/** The legacy rows with every mapping confirmed (linked + granular). */
async function fullyMappedLegacyRows(): Promise<ProcessedTakeoffRow[]> {
  const extracted = await extractEstimateFromBuffer(await buildLegacyPastBidTemplateBuffer());
  const linkedByDesc = new Map(LINKED_DIVISION_ROWS.map((l) => [l.description, l.itemId]));
  const granularByDesc = new Map([
    ["Shop-Fabricated Wood Trusses", "06-1753.001"],
    ["Aluminum Storefront - Interior", "08-4000.001"],
    ["Aluminum Storefront - Exterior", "08-4000.002"],
    ["Mystery Scope", "26-0000.001"],
  ]);
  return enrichImportedRows(extracted).map((r) => {
    const itemId = linkedByDesc.get(r.description) ?? granularByDesc.get(r.description);
    return itemId ? applyImportMapping(r, itemId) : r;
  });
}

describe("imported STEP 2/3 detail — capture + payload", () => {
  it("extracts bare-coded STEP 2/3 lines and filters zero rows into the payload", async () => {
    const extracted = await extractEstimateFromBuffer(await buildLegacyPastBidTemplateBuffer());

    // Bare codes survive extraction (the CARE-verified legacy shape)…
    const supt = extracted.step2Lines.find((l) => l.code === "01-0410");
    expect(supt?.total).toBe(10_000);
    const cleaning = extracted.step3Lines.find((l) => l.code === "02-9010");
    expect(cleaning?.total).toBe(2_000);

    // …and the payload keeps dollar lines only, plus the section-subtotal tie context.
    const payload = step23LinesForImport(extracted);
    expect(payload.step2Lines.map((l) => ({ code: l.code, description: l.description, qty: l.qty, rate: l.rate, total: l.total, uom: l.uom })))
      // Col G is written lowercase (the legacy idiom); extraction uppercases it.
      .toEqual(LEGACY_PAST_BID_ORACLE.step2Detail.map((d) => ({ ...d, uom: d.uom.toUpperCase() })));
    expect(payload.step3Lines).toHaveLength(LEGACY_PAST_BID_ORACLE.step3Detail.length);
    expect(payload.step2Lines.some((l) => l.total === 0)).toBe(false);
    expect(payload.linkedSourceSubtotals.length).toBe(LINKED_DIVISION_ROWS.length);
  });

  it("payload lines resolve to deterministic codes at render time (Slice 3 labeling)", async () => {
    const extracted = await extractEstimateFromBuffer(await buildLegacyPastBidTemplateBuffer());
    const payload = step23LinesForImport(extracted);

    // Unique base (01-0410 → .001) and shared base split by description
    // (02-9010 "Progress Cleaning - Hired" → .002) — the panel's exact call.
    const resolved = [...payload.step2Lines, ...payload.step3Lines].map((l) => ({
      code: l.code,
      to: resolveStep23Line(l.code, l.description)?.code ?? null,
    }));
    expect(resolved).toEqual([
      { code: "01-0410", to: "01-0410.001" },
      { code: "02-9010", to: "02-9010.002" },
      // The hand-inserted scope line on a shared base NEVER resolves on its
      // own (gate Phase 3's unmappable case — assign or mint at the review).
      { code: "02-4100", to: null },
    ]);
  });
});

describe("imported section totals — linked rows, never parametric defaults", () => {
  beforeEach(() => primeCostCodeResolverFromCatalog());
  afterEach(() => resetCostCodeResolver());

  it("linkedSectionTotals derives GC (div 01) / Site-Ops (div 02) from linked rows only", async () => {
    const rows = await fullyMappedLegacyRows();
    const totals = linkedSectionTotals(rows);
    expect(totals.generalConditionsTotal).toBe(LEGACY_PAST_BID_ORACLE.gcSectionTotal);
    expect(totals.siteOperationsTotal).toBe(LEGACY_PAST_BID_ORACLE.siteOpsSectionTotal);

    // Before any mapping, no row carries a linked itemId → zeros (not defaults).
    const extracted = await extractEstimateFromBuffer(await buildLegacyPastBidTemplateBuffer());
    const unmapped = linkedSectionTotals(enrichImportedRows(extracted));
    expect(unmapped).toEqual({ generalConditionsTotal: 0, siteOperationsTotal: 0 });
  });

  it("estimateTotalsForImport persists the same row-derived section totals", async () => {
    const rows = await fullyMappedLegacyRows();
    const extracted = await extractEstimateFromBuffer(await buildLegacyPastBidTemplateBuffer());
    const summary = computeTakeoffSummary(
      rows,
      extracted.inputs.squareFootage,
      extracted.inputs.unitCount,
      importSummaryRates(extracted.inputs),
      linkedTotalsFromRows(rows)
    );
    const totals = estimateTotalsForImport("p1", summary, rows);
    expect(totals.generalConditionsTotal).toBe(LEGACY_PAST_BID_ORACLE.gcSectionTotal);
    expect(totals.siteOperationsTotal).toBe(LEGACY_PAST_BID_ORACLE.siteOpsSectionTotal);
  });
});

describe("reconciliation gate — imported linked-row basis", () => {
  beforeEach(() => primeCostCodeResolverFromCatalog());
  afterEach(() => resetCostCodeResolver());

  it("gates a fully-mapped import on the linked rows and ties to the estimate subtotal", async () => {
    const rows = await fullyMappedLegacyRows();

    // The imported basis ignores the calc results entirely — feed it junk to prove it.
    const readiness = validateExportReadiness(rows, JUNK_GC, EMPTY_SITEOPS, { importedLinkedBasis: true });
    expect(readiness.blockers).toEqual([]);
    expect(readiness.reconciliation.ok).toBe(true);
    // Both gate sides equal the estimate subtotal: takeoff 15,000 + linked 50,000.
    expect(readiness.reconciliation.lineItemTotal).toBe(LEGACY_PAST_BID_ORACLE.subtotal);
    expect(readiness.reconciliation.rollupTotal).toBe(LEGACY_PAST_BID_ORACLE.subtotal);

    // The linked basis is one line per linked itemId, each with a granular code.
    const lines = importedLinkedGcSiteOpsLines(rows);
    expect(lines).toHaveLength(LINKED_DIVISION_ROWS.length);
    for (const l of lines) expect(l.procoreCode).not.toBe("");

    // WITHOUT the imported basis the gate would read the parametric junk —
    // its total ignores the bid's linked dollars entirely.
    const parametric = validateExportReadiness(rows, JUNK_GC, EMPTY_SITEOPS);
    expect(parametric.reconciliation.lineItemTotal).not.toBe(LEGACY_PAST_BID_ORACLE.subtotal);
  });
});
