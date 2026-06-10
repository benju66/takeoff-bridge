/**
 * Legacy-bid import (Import past bids â€” Phase 2).
 *
 * Real pre-app bids (the CARE probe, 2026-06-09) differ from the modern
 * template in two load-bearing ways: STEP 4 codes are BARE base codes (no
 * deterministic suffix), and the modifier zone carries hand-typed LUMP SUMS in
 * relabeled slots ("Owner's Rep" in 60-1005). These tests prove the extractor
 * reads that shape â€” and that the modern suffixed path is byte-identical to
 * before (the goldens stay the real proof of that).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { extractEstimateFromBuffer, loadTemplateWorkbook, extractEstimate } from "@/lib/templateExtractor";
import { deriveLegacyBridge } from "@/lib/legacyBridge";
import {
  enrichImportedRows,
  buildReverseProcoreMap,
  suggestImportMappings,
  applyImportMapping,
  applyAcceptedMappings,
  linkedMappingConflict,
  lumpOverridesFromExtract,
  overrideMapFromIntents,
  importSummaryRates,
  linkedTotalsFromRows,
  checkImportTieOut,
  catalogCostCodeEntries,
  uomMismatch,
  step23LinesForImport,
} from "@/lib/importEstimate";
import { computeTakeoffSummary } from "@/lib/calculations";
import { ESTIMATE_ITEMS_MASTER } from "@/lib/mock-data";
import { LINKED_DIVISION_ROWS } from "@/lib/constants";
import { primeCostCodeResolverFromCatalog, resetCostCodeResolver } from "@/lib/costCodeResolver";
import {
  buildLegacyPastBidTemplateBuffer,
  buildPastBidTemplateBuffer,
  LEGACY_PAST_BID_ORACLE,
  PAST_BID_ORACLE,
} from "./fixtures/syntheticTemplate";

/** Reverse map built the same way the import page's catalog fallback primes. */
const catalogReverse = () => buildReverseProcoreMap(catalogCostCodeEntries());

describe("templateExtractor â€” legacy bare-code shape (Slice 1)", () => {
  it("preserves bare base codes on ad-hoc lines via rawCode", async () => {
    const extracted = await extractEstimateFromBuffer(await buildLegacyPastBidTemplateBuffer());

    // Nothing conforms (no suffixed codes anywhere) â€” every dollar line is ad-hoc.
    expect(extracted.lineItems).toHaveLength(LEGACY_PAST_BID_ORACLE.conformingLineItemCount);
    expect(extracted.adHocLineItems).toHaveLength(LEGACY_PAST_BID_ORACLE.adHocLineItemCount);

    // The bare code travels on rawCode (itemId stays "" â€” not a guessed mapping).
    const painting = extracted.adHocLineItems.find((i) => i.rawCode === "06-1753");
    expect(painting?.description).toBe("Shop-Fabricated Wood Trusses");
    expect(painting?.itemId).toBe("");
    expect(painting?.total).toBe(4_000);

    // Two lines sharing one bare code stay independent (distinct source rows).
    const storefronts = extracted.adHocLineItems.filter((i) => i.rawCode === "08-4000");
    expect(storefronts).toHaveLength(2);
    expect(new Set(storefronts.map((i) => i.rowNumber)).size).toBe(2);

    // The unknown code is captured too â€” dollars are never dropped.
    const mystery = extracted.adHocLineItems.find((i) => i.rawCode === LEGACY_PAST_BID_ORACLE.noneCode);
    expect(mystery?.total).toBe(3_000);
    // â€¦and the estimator's col-E note rides along (shown in review, persisted).
    expect(mystery?.comment).toBe("Carried from SD pricing set");
    const mysteryRow = enrichImportedRows(extracted).find((r) => r.description === "Mystery Scope")!;
    expect(mysteryRow.customFields).toEqual({ Comment: "Carried from SD pricing set" });

    // GC/Site-Ops rows arrive as bare-coded ad-hoc lines (description is the signal).
    const gc = extracted.adHocLineItems.find((i) => i.rawCode === "01-0000");
    expect(gc?.description).toBe("General Conditions");

    // Subtotal oracle reads the sheet's own cells.
    expect(extracted.oracle.step4Subtotal).toBe(LEGACY_PAST_BID_ORACLE.subtotal);
    expect(extracted.oracle.totalEstimatedCost).toBe(LEGACY_PAST_BID_ORACLE.totalEstimatedCost);
  });

  it("matches modifier rows by base code and classifies hand-typed lumps", async () => {
    const extracted = await extractEstimateFromBuffer(await buildLegacyPastBidTemplateBuffer());
    const byKey = new Map(extracted.oracle.modifiers.map((m) => [m.key, m]));

    // The 60-1005 slot is a lump: relabeled, no rate, hand-typed dollar.
    const lump = byKey.get(LEGACY_PAST_BID_ORACLE.lump.key)!;
    expect(lump.isLump).toBe(true);
    expect(lump.sheetLabel).toBe(LEGACY_PAST_BID_ORACLE.lump.sheetLabel);
    expect(lump.total).toBe(LEGACY_PAST_BID_ORACLE.lump.value);
    expect(lump.rowNumber).toBeGreaterThan(0);

    // Rate-driven rows extract through the bare-code match and are NOT lumps.
    const cc = byKey.get("constructionContingency")!;
    expect(cc.isLump).toBe(false);
    expect(cc.rate).toBe(0.02);
    expect(cc.total).toBe(0.02 * LEGACY_PAST_BID_ORACLE.subtotal);
    const fee = byKey.get("fee")!;
    expect(fee.isLump).toBe(false);
    expect(fee.total).toBe(0.05 * LEGACY_PAST_BID_ORACLE.subtotal);
  });

  it("leaves the modern suffixed-code path untouched (regression)", async () => {
    const extracted = await extractEstimateFromBuffer(await buildPastBidTemplateBuffer());

    // Conforming lines: rawCode mirrors itemId.
    expect(extracted.lineItems).toHaveLength(PAST_BID_ORACLE.conformingLineItemCount);
    for (const it of extracted.lineItems) expect(it.rawCode).toBe(it.itemId);

    // The non-code ad-hoc line ("SPECIAL-CRANE") carries no rawCode â€” not a bare code.
    const adHoc = extracted.adHocLineItems.find((i) => i.description === PAST_BID_ORACLE.adHocDescription);
    expect(adHoc?.rawCode).toBe("");

    // Modern rate-driven modifiers are never lumps.
    for (const m of extracted.oracle.modifiers) expect(m.isLump).toBe(false);
  });
});

describe("as-bid UOM capture (Phase 3 Slice 0)", () => {
  beforeEach(() => primeCostCodeResolverFromCatalog());
  afterEach(() => resetCostCodeResolver());

  it("extracts col-G UOMs on STEP 4 (uppercased; blank stays blank)", async () => {
    const extracted = await extractEstimateFromBuffer(await buildLegacyPastBidTemplateBuffer());

    const trusses = extracted.adHocLineItems.find((i) => i.rawCode === "06-1753")!;
    expect(trusses.uom).toBe(LEGACY_PAST_BID_ORACLE.uoms.bridgeUnique); // "sf" -> "SF"
    for (const sf of extracted.adHocLineItems.filter((i) => i.rawCode === "08-4000")) {
      expect(sf.uom).toBe(LEGACY_PAST_BID_ORACLE.uoms.storefront);
    }
    const mystery = extracted.adHocLineItems.find((i) => i.rawCode === LEGACY_PAST_BID_ORACLE.noneCode)!;
    expect(mystery.uom).toBe(LEGACY_PAST_BID_ORACLE.uoms.blank); // no col-G value -> ""
    const gc = extracted.adHocLineItems.find((i) => i.rawCode === "01-0000")!;
    expect(gc.uom).toBe(LEGACY_PAST_BID_ORACLE.uoms.linked); // "ls" -> "LS"
  });

  it("extracts col-G UOMs on STEP 2/3 lines and carries them into the import payload", async () => {
    const extracted = await extractEstimateFromBuffer(await buildLegacyPastBidTemplateBuffer());

    const supt = extracted.step2Lines.find((l) => l.description === "Sr Superintendent")!;
    expect(supt.uom).toBe(LEGACY_PAST_BID_ORACLE.uoms.step2First); // "hr" -> "HR"
    const cleaning = extracted.step3Lines.find((l) => l.description === "Progress Cleaning - Hired")!;
    expect(cleaning.uom).toBe(LEGACY_PAST_BID_ORACLE.uoms.step3First);

    // The imported_step23_lines payload (what the read-only panels render).
    const payload = step23LinesForImport(extracted);
    expect(payload.step2Lines.find((l) => l.description === "Sr Superintendent")!.uom).toBe("HR");
    expect(payload.step3Lines[0].uom).toBe("HR");
  });

  it("a confirmed mapping KEEPS the as-bid UOM and reports the catalog disagreement", async () => {
    const extracted = await extractEstimateFromBuffer(await buildLegacyPastBidTemplateBuffer());
    const rows = enrichImportedRows(extracted);

    // Uncatalogued ad-hoc row: the as-bid UOM rides enrichment untouched.
    const trusses = rows.find((r) => r.description === "Shop-Fabricated Wood Trusses")!;
    expect(trusses.uom).toBe("SF");

    // Mapping to 06-1753.001 (catalog targetUom LS) must NOT stamp LS over SF...
    const mapped = applyImportMapping(trusses, "06-1753.001");
    expect(mapped.uom).toBe("SF");
    // ...but the disagreement is visible (display-only: never blocks, never Flags).
    expect(uomMismatch(mapped)).toEqual({ bid: "SF", catalog: "LS" });
    expect(mapped.needsReview).toBe(false);

    // A blank as-bid UOM is the ONLY case the catalog fills.
    const mystery = rows.find((r) => r.description === "Mystery Scope")!;
    expect(mystery.uom).toBe("");
    const mysteryMapped = applyImportMapping(mystery, "06-1753.001");
    expect(mysteryMapped.uom).toBe("LS");
    expect(uomMismatch(mysteryMapped)).toBeNull();
  });
});

describe("legacyBridge â€” the workbook's own BLI mapping (Slice 2)", () => {
  it("derives bareCode â†’ procoreCode from SUMIF criteria, skipping non-STEP-4 and shared formulas", async () => {
    const wb = await loadTemplateWorkbook(await buildLegacyPastBidTemplateBuffer());
    const bridge = deriveLegacyBridge(wb);

    expect(bridge.get("06-1753")).toBe(LEGACY_PAST_BID_ORACLE.bridge["06-1753"]);
    expect(bridge.get("08-4000")).toBe(LEGACY_PAST_BID_ORACLE.bridge["08-4000"]);
    // The STEP-2 SUMIF row and the sharedFormula-only row contribute NOTHING.
    expect(bridge.size).toBe(2);
    expect([...bridge.values()]).not.toContain("9-92900.000");
  });

  it("returns an empty map for a workbook without a parsable BLI sheet", async () => {
    // The modern synthetic past-bid fixture has no BLI sheet at all.
    const wb = await loadTemplateWorkbook(await buildPastBidTemplateBuffer());
    expect(deriveLegacyBridge(wb).size).toBe(0);
  });
});

describe("suggestImportMappings â€” confidence tiers (Slice 2)", () => {
  beforeEach(() => primeCostCodeResolverFromCatalog());
  afterEach(() => resetCostCodeResolver());

  async function legacySetup() {
    const wb = await loadTemplateWorkbook(await buildLegacyPastBidTemplateBuffer());
    const extracted = extractEstimate(wb);
    const bridge = deriveLegacyBridge(wb);
    const suggestions = suggestImportMappings(extracted, bridge, catalogReverse());
    const rows = enrichImportedRows(extracted);
    return { extracted, suggestions, rows };
  }

  it("bridge tier: a uniquely reverse-mapped Procore code names ONE internal itemId", async () => {
    const { suggestions, rows } = await legacySetup();
    const painting = rows.find((r) => r.description === "Shop-Fabricated Wood Trusses")!;
    const s = suggestions.get(painting.id)!;
    expect(s.confidence).toBe("bridge");
    expect(s.itemId).toBe(LEGACY_PAST_BID_ORACLE.bridgeUniqueItemId);
    expect(s.procoreCode).toBe(LEGACY_PAST_BID_ORACLE.bridge["06-1753"]);
  });

  it("linked tier: GC/Site-Ops descriptions map to the 10 linked itemIds", async () => {
    const { suggestions, rows } = await legacySetup();
    const gc = rows.find((r) => r.description === "General Conditions")!;
    expect(suggestions.get(gc.id)!.confidence).toBe("linked");
    expect(suggestions.get(gc.id)!.itemId).toBe("01-0000.001");
    const inspections = rows.find((r) => r.description === "Special Inspections")!;
    expect(suggestions.get(inspections.id)!.itemId).toBe("02-9500.008");
  });

  it("similar tier: an ambiguous bridge family becomes a ranked shortlist, not a guess", async () => {
    const { suggestions, rows } = await legacySetup();
    const storefronts = rows.filter((r) => r.description.startsWith("Aluminum Storefront"));
    expect(storefronts).toHaveLength(2);
    for (const sf of storefronts) {
      const s = suggestions.get(sf.id)!;
      expect(s.confidence).toBe("similar"); // 8-84000.000 has TWO internal codes
      expect(s.procoreCode).toBe(LEGACY_PAST_BID_ORACLE.bridge["08-4000"]);
      expect(s.candidates.map((c) => c.itemId).sort()).toEqual(["08-4000.001", "08-4000.002"]);
    }
  });

  it("similar tier (no bridge): unknown codes get catalog-wide fuzzy candidates only", async () => {
    const { suggestions, rows } = await legacySetup();
    const mystery = rows.find((r) => r.description === "Mystery Scope")!;
    const s = suggestions.get(mystery.id)!;
    expect(s.confidence).toBe("similar");
    expect(s.procoreCode).toBe(""); // nothing bridge-derived â€” human picks or leaves flagged
    expect(s.candidates.length).toBeGreaterThan(0);
  });

  it("applyImportMapping sets the deterministic code but never touches price, id, or source", async () => {
    const { suggestions, rows } = await legacySetup();
    const painting = rows.find((r) => r.description === "Shop-Fabricated Wood Trusses")!;
    const mapped = applyImportMapping(painting, suggestions.get(painting.id)!.itemId);

    expect(mapped.itemId).toBe("06-1753.001");
    expect(mapped.procoreCode).toBe(ESTIMATE_ITEMS_MASTER["06-1753.001"].procoreCode);
    expect(mapped.isMapped).toBe(true);
    expect(mapped.needsReview).toBe(false);
    // Historical fidelity + provenance: untouched.
    expect(mapped.unitPrice).toBe(painting.unitPrice);
    expect(mapped.matchedQty).toBe(painting.matchedQty);
    expect(mapped.id).toBe(painting.id);
    expect(mapped.source).toBe("imported");

    // A linked mapping is structurally mapped even without a granular code.
    const gc = rows.find((r) => r.description === "General Conditions")!;
    const linked = applyImportMapping(gc, "01-0000.001");
    expect(linked.isMapped).toBe(true);
    expect(linked.itemId).toBe("01-0000.001");
  });
});

describe("acceptance map â€” confirm, change, withdraw (architect escape hatch)", () => {
  beforeEach(() => primeCostCodeResolverFromCatalog());
  afterEach(() => resetCostCodeResolver());

  it("a confirmation can be changed or withdrawn without touching the originals", async () => {
    const extracted = await extractEstimateFromBuffer(await buildLegacyPastBidTemplateBuffer());
    const originals = enrichImportedRows(extracted);
    const painting = originals.find((r) => r.description === "Shop-Fabricated Wood Trusses")!;

    // Accept the wrong code, then CHANGE it, then WITHDRAW it.
    const wrong = applyAcceptedMappings(originals, new Map([[painting.id, "08-4000.001"]]));
    expect(wrong.find((r) => r.id === painting.id)!.itemId).toBe("08-4000.001");

    const fixed = applyAcceptedMappings(originals, new Map([[painting.id, "06-1753.001"]]));
    expect(fixed.find((r) => r.id === painting.id)!.itemId).toBe("06-1753.001");

    const withdrawn = applyAcceptedMappings(originals, new Map());
    const back = withdrawn.find((r) => r.id === painting.id)!;
    expect(back.itemId).toBe("");
    expect(back.isMapped).toBe(false);
    expect(back.needsReview).toBe(true); // exactly the pre-confirmation state

    // Originals are never mutated by any of it.
    expect(painting.itemId).toBe("");
    expect(painting.needsReview).toBe(true);
  });

  it("refuses a linked code already claimed by an acceptance or a born-linked row", async () => {
    const extracted = await extractEstimateFromBuffer(await buildLegacyPastBidTemplateBuffer());
    const originals = enrichImportedRows(extracted);
    const gc = originals.find((r) => r.description === "General Conditions")!;
    const other = originals.find((r) => r.description === "Supervision")!;

    const accepted = new Map([[gc.id, "01-0000.001"]]);
    // Another row asking for the same linked code â†’ conflict.
    expect(linkedMappingConflict(originals, accepted, other.id, "01-0000.001")).toBe(true);
    // Re-confirming the SAME row is not a conflict (that's a change).
    expect(linkedMappingConflict(originals, accepted, gc.id, "01-0000.001")).toBe(false);
    // Granular (non-linked) codes may repeat freely â€” the storefront case.
    expect(linkedMappingConflict(originals, accepted, other.id, "08-4000.002")).toBe(false);
    // A MODERN bid's born-linked row also blocks an acceptance of its code.
    const modern = enrichImportedRows(await extractEstimateFromBuffer(await buildPastBidTemplateBuffer()));
    const adhoc = modern.find((r) => r.needsReview)!;
    expect(linkedMappingConflict(modern, new Map(), adhoc.id, "01-0000.001")).toBe(true);
  });
});

describe("lump-sum modifiers as audited overrides (Slice 3)", () => {
  beforeEach(() => primeCostCodeResolverFromCatalog());
  afterEach(() => resetCostCodeResolver());

  it("builds one intent per lump, carrying the legacy label + provenance", async () => {
    const extracted = await extractEstimateFromBuffer(await buildLegacyPastBidTemplateBuffer());
    const intents = lumpOverridesFromExtract(extracted, "legacy-bid.xlsx");

    expect(intents).toHaveLength(1);
    const [intent] = intents;
    expect(intent.field).toBe(LEGACY_PAST_BID_ORACLE.lump.key);
    expect(intent.overrideValue).toBe(LEGACY_PAST_BID_ORACLE.lump.value);
    expect(intent.computedValue).toBe(0); // rate cell is empty â†’ engine computes 0
    expect(intent.reason).toContain(LEGACY_PAST_BID_ORACLE.lump.sheetLabel);
    expect(intent.reason).toContain("legacy-bid.xlsx");
    expect(intent.reason).toMatch(/STEP 4 r\d+/);

    expect(overrideMapFromIntents(intents)).toEqual({
      [LEGACY_PAST_BID_ORACLE.lump.key]: LEGACY_PAST_BID_ORACLE.lump.value,
    });
  });

  it("is inert for modern rate-driven bids", async () => {
    const extracted = await extractEstimateFromBuffer(await buildPastBidTemplateBuffer());
    expect(lumpOverridesFromExtract(extracted, "modern.xlsx")).toHaveLength(0);
  });

  it("ties the legacy GRAND TOTAL to the cent â€” before and after linked mappings", async () => {
    const extracted = await extractEstimateFromBuffer(await buildLegacyPastBidTemplateBuffer());
    const rates = importSummaryRates(extracted.inputs);
    const overrides = overrideMapFromIntents(lumpOverridesFromExtract(extracted, "legacy-bid.xlsx"));

    // BEFORE any mapping: every line is an ordinary ad-hoc row; no linked totals.
    const rows = enrichImportedRows(extracted);
    const before = computeTakeoffSummary(
      rows,
      extracted.inputs.squareFootage,
      extracted.inputs.unitCount,
      rates,
      linkedTotalsFromRows(rows),
      overrides
    );
    const tieBefore = checkImportTieOut(before, extracted.oracle);
    expect(tieBefore.deltaSubtotal).toBe(0);
    expect(tieBefore.deltaTotal).toBe(0);
    expect(tieBefore.ok).toBe(true);

    // AFTER mapping the 10 GC/Site-Ops rows to linked itemIds: the engine
    // excludes their typed qtyÃ—price and counts linkedTotalsFromRows instead â€”
    // the totals must NOT move (the slice-4 review flow rests on this).
    const linkedByDesc = new Map(LINKED_DIVISION_ROWS.map((l) => [l.description, l.itemId]));
    const mappedRows = rows.map((r) =>
      linkedByDesc.has(r.description) ? applyImportMapping(r, linkedByDesc.get(r.description)!) : r
    );
    const after = computeTakeoffSummary(
      mappedRows,
      extracted.inputs.squareFootage,
      extracted.inputs.unitCount,
      rates,
      linkedTotalsFromRows(mappedRows),
      overrides
    );
    const tieAfter = checkImportTieOut(after, extracted.oracle);
    expect(tieAfter.deltaSubtotal).toBe(0);
    expect(tieAfter.deltaTotal).toBe(0);
    expect(tieAfter.ok).toBe(true);

    // Without the lump override the total must NOT tie â€” proving the override
    // is what carries the as-bid dollars (not a coincidence of the fixture).
    const withoutLump = computeTakeoffSummary(
      rows,
      extracted.inputs.squareFootage,
      extracted.inputs.unitCount,
      rates,
      linkedTotalsFromRows(rows)
    );
    expect(checkImportTieOut(withoutLump, extracted.oracle).ok).toBe(false);
    expect(checkImportTieOut(withoutLump, extracted.oracle).deltaTotal).toBe(-LEGACY_PAST_BID_ORACLE.lump.value);
  });
});
