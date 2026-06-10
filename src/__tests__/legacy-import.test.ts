/**
 * Legacy-bid import (Import past bids — Phase 2).
 *
 * Real pre-app bids (the CARE probe, 2026-06-09) differ from the modern
 * template in two load-bearing ways: STEP 4 codes are BARE base codes (no
 * deterministic suffix), and the modifier zone carries hand-typed LUMP SUMS in
 * relabeled slots ("Owner's Rep" in 60-1005). These tests prove the extractor
 * reads that shape — and that the modern suffixed path is byte-identical to
 * before (the goldens stay the real proof of that).
 */
import { describe, it, expect } from "vitest";
import { extractEstimateFromBuffer } from "@/lib/templateExtractor";
import {
  buildLegacyPastBidTemplateBuffer,
  buildPastBidTemplateBuffer,
  LEGACY_PAST_BID_ORACLE,
  PAST_BID_ORACLE,
} from "./fixtures/syntheticTemplate";

describe("templateExtractor — legacy bare-code shape (Slice 1)", () => {
  it("preserves bare base codes on ad-hoc lines via rawCode", async () => {
    const extracted = await extractEstimateFromBuffer(await buildLegacyPastBidTemplateBuffer());

    // Nothing conforms (no suffixed codes anywhere) — every dollar line is ad-hoc.
    expect(extracted.lineItems).toHaveLength(LEGACY_PAST_BID_ORACLE.conformingLineItemCount);
    expect(extracted.adHocLineItems).toHaveLength(LEGACY_PAST_BID_ORACLE.adHocLineItemCount);

    // The bare code travels on rawCode (itemId stays "" — not a guessed mapping).
    const painting = extracted.adHocLineItems.find((i) => i.rawCode === "09-9000");
    expect(painting?.description).toBe("Interior Painting");
    expect(painting?.itemId).toBe("");
    expect(painting?.total).toBe(4_000);

    // Two lines sharing one bare code stay independent (distinct source rows).
    const storefronts = extracted.adHocLineItems.filter((i) => i.rawCode === "08-4000");
    expect(storefronts).toHaveLength(2);
    expect(new Set(storefronts.map((i) => i.rowNumber)).size).toBe(2);

    // The unknown code is captured too — dollars are never dropped.
    const mystery = extracted.adHocLineItems.find((i) => i.rawCode === LEGACY_PAST_BID_ORACLE.noneCode);
    expect(mystery?.total).toBe(3_000);

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

    // The non-code ad-hoc line ("SPECIAL-CRANE") carries no rawCode — not a bare code.
    const adHoc = extracted.adHocLineItems.find((i) => i.description === PAST_BID_ORACLE.adHocDescription);
    expect(adHoc?.rawCode).toBe("");

    // Modern rate-driven modifiers are never lumps.
    for (const m of extracted.oracle.modifiers) expect(m.isLump).toBe(false);
  });
});
