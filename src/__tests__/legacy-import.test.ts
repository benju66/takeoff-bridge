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
  applyStep23Corrections,
  step23LineKey,
  step23ReviewStats,
} from "@/lib/importEstimate";
import { resolveStep23Line } from "@/lib/step23Normalization";
import type { ImportedSheetLine, ImportedStep23Lines } from "@/types/db";
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

describe("applyStep23Corrections â€” review-gate edits over the immutable payload (gate Phase 1)", () => {
  const sheetLine = (over: Partial<ImportedSheetLine>): ImportedSheetLine => ({
    code: "02-4100",
    description: "Demolition - Openings in CMU",
    utilization: null,
    qty: 82,
    rate: 3419.44,
    total: 280_394.08,
    rowNumber: 30,
    uom: "EA",
    ...over,
  });
  const payload = (): ImportedStep23Lines => ({
    step2Lines: [
      sheetLine({ code: "01-0410", description: "Sr Superintendent", qty: 1818.6, rate: 125, total: 227_325, rowNumber: 12, uom: "HR" }),
      sheetLine({ code: "01-1000", description: "Small Tools", qty: 1, rate: 5000, total: 5000, rowNumber: 30, uom: "LS" }),
    ],
    step3Lines: [sheetLine({})],
    linkedSourceSubtotals: [{ itemId: "01-0000", total: 232_325 }],
  });

  it("is the identity with no corrections and NEVER mutates the originals", () => {
    const original = payload();
    const snapshot = structuredClone(original);

    expect(applyStep23Corrections(original, {})).toEqual(snapshot);

    const corrected = applyStep23Corrections(original, {
      uomCorrections: new Map([[step23LineKey("step2", 12), "WK"]]),
      assignments: new Map([[step23LineKey("step3", 30), "02-4100.001"]]),
    });
    expect(original).toEqual(snapshot); // escape hatch: originals untouched
    expect(corrected).not.toEqual(snapshot);
  });

  it("a UOM correction REPLACES the stored value (normalized), on the keyed line only", () => {
    const corrected = applyStep23Corrections(payload(), {
      uomCorrections: new Map([[step23LineKey("step2", 12), " wk "]]),
    });
    expect(corrected.step2Lines[0].uom).toBe("WK");
    expect(corrected.step2Lines[1].uom).toBe("LS");
    expect(corrected.step3Lines[0].uom).toBe("EA");
  });

  it("an assignment writes the ADDITIVE assignedCode; the as-bid code is never rewritten", () => {
    const corrected = applyStep23Corrections(payload(), {
      assignments: new Map([[step23LineKey("step3", 30), "02-4100.001"]]),
    });
    expect(corrected.step3Lines[0].assignedCode).toBe("02-4100.001");
    expect(corrected.step3Lines[0].code).toBe("02-4100");
    // Withdrawing = re-deriving from the originals without the map entry.
    expect(applyStep23Corrections(payload(), {}).step3Lines[0].assignedCode).toBeUndefined();
  });

  it("keys are sheet-scoped: step2 and step3 lines sharing a rowNumber stay independent", () => {
    const corrected = applyStep23Corrections(payload(), {
      assignments: new Map([[step23LineKey("step2", 30), "01-1000.001"]]),
    });
    expect(corrected.step2Lines[1].assignedCode).toBe("01-1000.001");
    expect(corrected.step3Lines[0].assignedCode).toBeUndefined(); // same rowNumber 30
  });

  it("dollars cannot move BY CONSTRUCTION: qty, rate, total, and subtotals survive any correction", () => {
    const original = payload();
    const corrected = applyStep23Corrections(original, {
      uomCorrections: new Map([
        [step23LineKey("step2", 12), "WK"],
        [step23LineKey("step3", 30), "SF"],
      ]),
      assignments: new Map([
        [step23LineKey("step2", 30), "01-1000.001"],
        [step23LineKey("step3", 30), "02-4100.001"],
      ]),
    });
    const dollars = (p: ImportedStep23Lines) =>
      [...p.step2Lines, ...p.step3Lines].map((l) => [l.qty, l.rate, l.total]);
    expect(dollars(corrected)).toEqual(dollars(original));
    expect(corrected.linkedSourceSubtotals).toEqual(original.linkedSourceSubtotals);
  });

  it("ignores unknown keys and blank values (no phantom lines, no empty assignments)", () => {
    const corrected = applyStep23Corrections(payload(), {
      uomCorrections: new Map([
        [step23LineKey("step2", 999), "WK"],
        [step23LineKey("step2", 12), "  "],
      ]),
      assignments: new Map([[step23LineKey("step3", 30), ""]]),
    });
    expect(corrected).toEqual(payload());
  });
});

describe("STEP 2/3 review section — stats + save wiring over the fixture (gate Phase 3)", () => {
  /** The fixture's unmappable line (shared base, hand-inserted description). */
  const unmappable = LEGACY_PAST_BID_ORACLE.unmappableStep23;

  async function fixturePayload() {
    const extracted = await extractEstimateFromBuffer(await buildLegacyPastBidTemplateBuffer());
    const payload = step23LinesForImport(extracted);
    const cmu = payload.step3Lines.find((l) => l.description === unmappable.description)!;
    return { payload, cmu, key: step23LineKey("step3", cmu.rowNumber) };
  }

  it("counts resolved/unmapped live as corrections change — assignment moves the needle", async () => {
    const { payload, key } = await fixturePayload();

    // Baseline: Sr Superintendent + Progress Cleaning resolve; the CMU line cannot.
    expect(step23ReviewStats(payload, {})).toEqual({
      lineCount: 3,
      resolved: 2,
      unmapped: 1,
      corrected: 0,
    });

    // Assigning the line to a freshly-minted custom def resolves it (and counts
    // as ONE corrected line even with a UOM fix on the same line).
    const minted = [{ code: "02-4100.003", label: unmappable.description }];
    const corrections = {
      uomCorrections: new Map([[key, "EA"]]),
      assignments: new Map([[key, "02-4100.003"]]),
    };
    expect(step23ReviewStats(payload, corrections, minted)).toEqual({
      lineCount: 3,
      resolved: 3,
      unmapped: 0,
      corrected: 1,
    });

    // Inert corrections (the bid's own value, stale keys) count nothing.
    const inert = step23ReviewStats(payload, {
      uomCorrections: new Map([
        [key, "SF"], // the as-bid unit — no change
        [step23LineKey("step2", 999), "WK"], // no such line
      ]),
    });
    expect(inert.corrected).toBe(0);
  });

  it("the saved payload carries the corrections, never the dollars (handleSave's exact call)", async () => {
    const { payload, cmu, key } = await fixturePayload();
    const saved = applyStep23Corrections(payload, {
      uomCorrections: new Map([[key, " ea "]]),
      assignments: new Map([[key, "02-4100.003"]]),
    });

    const savedCmu = saved.step3Lines.find((l) => l.rowNumber === cmu.rowNumber)!;
    expect(savedCmu.assignedCode).toBe("02-4100.003");
    expect(savedCmu.uom).toBe("EA");
    expect(savedCmu.code).toBe(unmappable.code); // as-bid code never rewritten
    expect([savedCmu.qty, savedCmu.rate, savedCmu.total]).toEqual([cmu.qty, cmu.rate, cmu.total]);

    // The workspace panel's exact render-time call then labels the stored line
    // under the minted def — retroactively, with no re-import.
    const minted = [{ code: "02-4100.003", label: unmappable.description }];
    expect(resolveStep23Line(savedCmu.code, savedCmu.description, savedCmu.assignedCode, minted)?.code).toBe(
      "02-4100.003"
    );
    // Without the custom def the assignment is stale and the line stays bare.
    expect(resolveStep23Line(savedCmu.code, savedCmu.description, savedCmu.assignedCode)).toBeNull();
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

  it("UOM corrections layer over acceptances and are fully revertible (architect 2026-06-10)", async () => {
    const extracted = await extractEstimateFromBuffer(await buildLegacyPastBidTemplateBuffer());
    const originals = enrichImportedRows(extracted);
    const trusses = originals.find((r) => r.description === "Shop-Fabricated Wood Trusses")!;
    expect(trusses.uom).toBe("SF"); // as bid

    // Correction wins over the as-bid value — and survives a code acceptance
    // (applied AFTER the mapping, so the catalog can't reassert its unit).
    const corrected = applyAcceptedMappings(
      originals,
      new Map([[trusses.id, "06-1753.001"]]),
      new Map([[trusses.id, "EA"]])
    ).find((r) => r.id === trusses.id)!;
    expect(corrected.uom).toBe("EA");
    expect(corrected.itemId).toBe("06-1753.001");
    // Non-financial: the dollars never move.
    expect(corrected.unitPrice).toBe(trusses.unitPrice);
    expect(corrected.matchedQty).toBe(trusses.matchedQty);

    // Clearing the correction restores the bid's own unit; originals untouched.
    const reverted = applyAcceptedMappings(originals, new Map(), new Map())
      .find((r) => r.id === trusses.id)!;
    expect(reverted.uom).toBe("SF");
    expect(trusses.uom).toBe("SF");

    // A correction on a BLANK as-bid unit also sticks (Mystery Scope has none).
    const mystery = originals.find((r) => r.description === "Mystery Scope")!;
    const filled = applyAcceptedMappings(originals, new Map(), new Map([[mystery.id, "LS"]]))
      .find((r) => r.id === mystery.id)!;
    expect(filled.uom).toBe("LS");
  });

  it("combined marks tag dataFidelity, layer with other edits, and are fully revertible (fidelity Phase 2)", async () => {
    const extracted = await extractEstimateFromBuffer(await buildLegacyPastBidTemplateBuffer());
    const originals = enrichImportedRows(extracted);
    const trusses = originals.find((r) => r.description === "Shop-Fabricated Wood Trusses")!;
    const mystery = originals.find((r) => r.description === "Mystery Scope")!;

    // A mark tags ONLY the marked row — and layers over an acceptance + UOM
    // correction on the same row without disturbing either.
    const marked = applyAcceptedMappings(
      originals,
      new Map([[trusses.id, "06-1753.001"]]),
      new Map([[trusses.id, "EA"]]),
      new Set([trusses.id])
    );
    const lumped = marked.find((r) => r.id === trusses.id)!;
    expect(lumped.dataFidelity).toBe("macro_lump_sum");
    expect(lumped.itemId).toBe("06-1753.001");
    expect(lumped.uom).toBe("EA");
    // A pure tag: the dollars (and therefore the tie-out) cannot move.
    expect(lumped.unitPrice).toBe(trusses.unitPrice);
    expect(lumped.matchedQty).toBe(trusses.matchedQty);
    expect(lumped.total).toBe(trusses.total);
    // Unmarked rows are untouched (no fidelity tag → saves as discrete_unit).
    expect(marked.find((r) => r.id === mystery.id)!.dataFidelity).toBeUndefined();

    // Removing the mark restores the row exactly; originals are never mutated.
    const reverted = applyAcceptedMappings(originals, new Map(), new Map(), new Set())
      .find((r) => r.id === trusses.id)!;
    expect(reverted.dataFidelity).toBeUndefined();
    expect(trusses.dataFidelity).toBeUndefined();
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

describe("history suggestion tier (Phase 3 Slice 1)", () => {
  beforeEach(() => primeCostCodeResolverFromCatalog());
  afterEach(() => resetCostCodeResolver());

  /** History keyed by the legacy fixture's exact descriptions. */
  const HISTORY = new Map([
    // Mystery Scope: today it lands in `similar` (fuzzy) — history should win.
    ["Mystery Scope", [
      { resolvedCode: "26-0000.001", count: 4 },
      { resolvedCode: "06-1753.001", count: 1 },
    ]],
    // Trusses: bridge-unique — bridge must STILL win over history.
    ["Shop-Fabricated Wood Trusses", [{ resolvedCode: "09-2900.001", count: 9 }]],
    // General Conditions: linked-tier description — linked must STILL win.
    ["General Conditions", [{ resolvedCode: "03-0000.001", count: 9 }]],
  ]);

  async function legacySuggestions(history?: Parameters<typeof suggestImportMappings>[3]) {
    const wb = await loadTemplateWorkbook(await buildLegacyPastBidTemplateBuffer());
    const extracted = extractEstimate(wb);
    const suggestions = suggestImportMappings(extracted, deriveLegacyBridge(wb), catalogReverse(), history);
    return { suggestions, rows: enrichImportedRows(extracted) };
  }

  it("suggests past confirmations ranked by count, between linked and similar", async () => {
    const { suggestions, rows } = await legacySuggestions(HISTORY);
    const mystery = rows.find((r) => r.description === "Mystery Scope")!;
    const s = suggestions.get(mystery.id)!;
    expect(s.confidence).toBe("history");
    expect(s.itemId).toBe("26-0000.001"); // count 4 beats count 1
    expect(s.historyCount).toBe(4);
    expect(s.candidates.map((c) => c.itemId)).toEqual(["26-0000.001", "06-1753.001"]);
  });

  it("never outranks the deterministic tiers: bridge and linked still win", async () => {
    const { suggestions, rows } = await legacySuggestions(HISTORY);
    const trusses = rows.find((r) => r.description === "Shop-Fabricated Wood Trusses")!;
    expect(suggestions.get(trusses.id)!.confidence).toBe("bridge");
    expect(suggestions.get(trusses.id)!.itemId).toBe(LEGACY_PAST_BID_ORACLE.bridgeUniqueItemId);
    const gc = rows.find((r) => r.description === "General Conditions")!;
    expect(suggestions.get(gc.id)!.confidence).toBe("linked");
  });

  it("skips stale codes (no longer assignable) and falls through to similar", async () => {
    const stale = new Map([["Mystery Scope", [{ resolvedCode: "99-9999.999", count: 7 }]]]);
    const { suggestions, rows } = await legacySuggestions(stale);
    const mystery = rows.find((r) => r.description === "Mystery Scope")!;
    const s = suggestions.get(mystery.id)!;
    expect(s.confidence).toBe("similar"); // identical to the no-history outcome
    expect(s.itemId).not.toBe("99-9999.999");
  });

  it("accepts linked division codes from history (assignable though uncatalogued)", async () => {
    const linkedHistory = new Map([["Mystery Scope", [{ resolvedCode: "02-9400.007", count: 2 }]]]);
    const { suggestions, rows } = await legacySuggestions(linkedHistory);
    const mystery = rows.find((r) => r.description === "Mystery Scope")!;
    expect(suggestions.get(mystery.id)!.confidence).toBe("history");
    expect(suggestions.get(mystery.id)!.itemId).toBe("02-9400.007");
  });

  it("fail-soft: omitted or empty history yields EXACTLY the pre-history suggestions", async () => {
    const { suggestions: without } = await legacySuggestions(undefined);
    const { suggestions: empty } = await legacySuggestions(new Map());
    expect([...empty.entries()]).toEqual([...without.entries()]);
    for (const s of without.values()) expect(s.confidence).not.toBe("history");
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
