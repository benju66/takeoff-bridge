import { describe, it, expect } from "vitest";
import {
  SITEOPS_GROUP_LABELS,
  SITEOPS_ROW_META,
  buildSiteOpsCalcLookup,
  entryValue,
  resolveQtyKey,
  resolveRateKey,
} from "@/lib/sectionLines/siteOpsGridModel";
import { synthesizeSiteOpsSectionLines } from "@/lib/sectionLines/synthesize";
import { computeSiteOperations } from "@/lib/calculations";
import { sectionLineTotalOverrideKey, siteOpsDynamicLineId, siteOpsManualLineId } from "@/lib/sectionLines/ids";
import {
  SITE_OPS_SECTIONS,
  SITE_OPS_DYNAMIC_DEFAULTS,
  SITE_OPS_MANUAL_DEFAULTS,
} from "@/lib/constants";
import { ENTRY_KIND } from "@/lib/sectionLines/entryKinds";

// ---------------------------------------------------------------------------
// Site-Ops grid MODEL (Phase B3) — the pure presentational + dispatch logic the
// Step-3 grid is built on. Twin of gcGridModel.test.ts. These guard the load-bearing
// pieces that have no React: the 02.A–02.H grouping/order, the calc-by-code join, the
// entry value per kind, the section-line → infrastructure-setter resolution (incl. the
// Site-Ops-specific editable `qtyRate` rate cell), and the per-line type-over field key.
// ---------------------------------------------------------------------------

const ALL_SITEOPS_CODES = [
  ...SITE_OPS_DYNAMIC_DEFAULTS.map((d) => d.code),
  ...SITE_OPS_MANUAL_DEFAULTS.map((m) => m.code),
];

// Codes are unique across the dynamic + manual arrays (the join + row-meta depend on it).
const codeOf = (key: string) => SITE_OPS_MANUAL_DEFAULTS.find((m) => m.key === key)!.code;

describe("SITEOPS_ROW_META — section grouping (02.A–02.H)", () => {
  it("groups every Site-Ops catalog code, with no stragglers and no collisions", () => {
    for (const code of ALL_SITEOPS_CODES) expect(SITEOPS_ROW_META.has(code)).toBe(true);
    expect(SITEOPS_ROW_META.size).toBe(ALL_SITEOPS_CODES.length);
    // every code is unique → the size equality above also proves no dynamic/manual collision
    expect(new Set(ALL_SITEOPS_CODES).size).toBe(ALL_SITEOPS_CODES.length);
  });

  it("uses all eight labelled sections", () => {
    const groups = new Set([...SITEOPS_ROW_META.values()].map((m) => m.group));
    expect(groups.size).toBe(SITE_OPS_SECTIONS.length);
    for (const s of SITE_OPS_SECTIONS) {
      expect(groups.has(s.id)).toBe(true);
      expect(SITEOPS_GROUP_LABELS[s.id]).toBe(s.label);
    }
  });

  it("display order is a contiguous 0..N-1 permutation in section order", () => {
    const sorted = [...SITEOPS_ROW_META.values()].sort((a, b) => a.order - b.order);
    expect(sorted.map((m) => m.order)).toEqual(sorted.map((_, i) => i));
    // Group keys, read in display order, never go backwards (all of 02.A before 02.B, …).
    const rank = Object.fromEntries(SITE_OPS_SECTIONS.map((s, i) => [s.id, i]));
    const ranks = sorted.map((m) => rank[m.group]);
    for (let i = 1; i < ranks.length; i++) expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1]);
  });

  it("maps the engine-graph line group per kind (dynamic vs manual)", () => {
    expect(SITEOPS_ROW_META.get(SITE_OPS_DYNAMIC_DEFAULTS[0].code)?.engineGroup).toBe("dynamic");
    expect(SITEOPS_ROW_META.get(SITE_OPS_MANUAL_DEFAULTS[0].code)?.engineGroup).toBe("manual");
  });
});

describe("buildSiteOpsCalcLookup — join calc lines by code", () => {
  it("maps each computed line's total/qty/rate by code", () => {
    const calc = computeSiteOperations(12, 10000, { knox: 2, soilBorings: 3 }, { soilBorings: 100 });
    const lookup = buildSiteOpsCalcLookup(calc);
    expect(lookup.size).toBe(calc.dynamicLines.length + calc.manualLines.length);
    const knox = calc.manualLines.find((l) => l.code === codeOf("knox"))!;
    expect(lookup.get(knox.code)).toEqual({ qty: knox.qty, rate: knox.rate, total: knox.total });
  });
});

describe("entryValue / resolveQtyKey / resolveRateKey — per kind", () => {
  const lines = synthesizeSiteOpsSectionLines(
    { qtyKnox: 5, qtySoilBorings: 3, ffeRelocation: 7500 },
    { rateSoilBorings: 120 }
  );
  const dynamic = lines.find((l) => l.entryKind === ENTRY_KIND.Dynamic)!;
  const knox = lines.find((l) => l.code === codeOf("knox"))!;        // qty
  const soil = lines.find((l) => l.code === codeOf("soilBorings"))!; // qtyRate
  const ffe = lines.find((l) => l.code === codeOf("ffeRelocation"))!; // lumpSum

  it("reads the estimator value the right way per kind", () => {
    expect(entryValue(knox)).toBe(5);     // typed quantity
    expect(entryValue(soil)).toBe(3);     // typed quantity (qtyRate)
    expect(entryValue(ffe)).toBe(7500);   // lump-sum dollars
    expect(entryValue(dynamic)).toBe(0);  // auto line — no estimator input
  });

  it("resolves the quantity-setter key (dynamic → null)", () => {
    expect(resolveQtyKey(knox)).toBe("knox");
    expect(resolveQtyKey(soil)).toBe("soilBorings");
    expect(resolveQtyKey(ffe)).toBe("ffeRelocation");
    expect(resolveQtyKey(dynamic)).toBeNull();
  });

  it("resolves the rate-setter key for qtyRate ONLY (qty / lumpSum / dynamic → null)", () => {
    expect(resolveRateKey(soil)).toBe("soilBorings"); // the editable rate cell
    expect(resolveRateKey(knox)).toBeNull();
    expect(resolveRateKey(ffe)).toBeNull();
    expect(resolveRateKey(dynamic)).toBeNull();
  });
});

describe("per-line type-over (D3) — the field key the grid records under applies in the engine", () => {
  const baseline = computeSiteOperations(12, 10000, { knox: 2, soilBorings: 3 }, { soilBorings: 100 });
  const knoxComputed = baseline.manualLines.find((l) => l.code === codeOf("knox"))!.total;
  const knoxOverrideKey = sectionLineTotalOverrideKey(siteOpsManualLineId("knox"));
  const soilOverrideKey = sectionLineTotalOverrideKey(siteOpsManualLineId("soilBorings"));

  it("a recorded override substitutes the line total + grand total and retains computed qty/rate", () => {
    const over = computeSiteOperations(
      12, 10000, { knox: 2, soilBorings: 3 }, { soilBorings: 100 },
      undefined, undefined, { [knoxOverrideKey]: 9999 }
    );
    const knoxLine = over.manualLines.find((l) => l.code === codeOf("knox"))!;
    const baseKnox = baseline.manualLines.find((l) => l.code === codeOf("knox"))!;
    expect(knoxLine.total).toBe(9999);
    expect(knoxLine.qty).toBe(baseKnox.qty);   // qty / rate stay computed; only total substitutes
    expect(knoxLine.rate).toBe(baseKnox.rate);
    expect(over.grandTotal).toBeCloseTo(baseline.grandTotal - knoxComputed + 9999, 6);
    expect(over.overrides?.[knoxOverrideKey]).toEqual({ computedValue: knoxComputed, overrideValue: 9999 });
  });

  it("applies to a qtyRate line too (Site-Ops's editable-rate kind)", () => {
    const soilComputed = baseline.manualLines.find((l) => l.code === codeOf("soilBorings"))!.total; // 3 * 100 = 300
    expect(soilComputed).toBe(300);
    const over = computeSiteOperations(
      12, 10000, { knox: 2, soilBorings: 3 }, { soilBorings: 100 },
      undefined, undefined, { [soilOverrideKey]: 5000 }
    );
    const soilLine = over.manualLines.find((l) => l.code === codeOf("soilBorings"))!;
    expect(soilLine.total).toBe(5000);
    expect(soilLine.qty).toBe(3);
    expect(soilLine.rate).toBe(100);
    expect(over.overrides?.[soilOverrideKey]).toEqual({ computedValue: 300, overrideValue: 5000 });
  });

  it("is inert with no overrides (byte-identical, no overrides trace) — goldens hold", () => {
    expect(baseline.overrides).toBeUndefined();
    const sameAgain = computeSiteOperations(12, 10000, { knox: 2, soilBorings: 3 }, { soilBorings: 100 });
    expect(JSON.stringify(sameAgain)).toBe(JSON.stringify(baseline));
  });

  it("ignores an override for a line this engine does not produce (recognized-keys guard)", () => {
    const foreign = computeSiteOperations(
      12, 10000, { knox: 2 }, {},
      undefined, undefined, { [sectionLineTotalOverrideKey(siteOpsDynamicLineId("02-0000.999"))]: 1 }
    );
    expect(foreign.overrides).toBeUndefined();
  });
});
