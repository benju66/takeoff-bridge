import { describe, it, expect } from "vitest";
import { synthesizeImportedSectionLines } from "../sectionLines/imported";
import { ENTRY_KIND } from "../sectionLines/entryKinds";
import type { ImportedSheetLine, ImportedStep23Lines } from "@/types/db";
import { extractEstimateFromBuffer } from "../templateExtractor";
import { step23LinesForImport } from "../importEstimate";
import {
  buildLegacyPastBidTemplateBuffer,
  LEGACY_PAST_BID_ORACLE,
} from "../../__tests__/fixtures/syntheticTemplate";

// ---------------------------------------------------------------------------
// GC/Site-Ops Addressability Phase A4 — IMPORTED synthesis (the #1-risk phase).
//
// An imported bid's GC/Site-Ops values are hand-authored lump sums the app
// cannot re-derive. The hard exit gate: synthesized imported section lines must
// be CONSTANTS — each line's value IS the frozen as-bid `total`, NEVER a live
// `qty × rate` recompute, and a change to a per-line input that a recompute would
// read cannot move it. The frozen-total authority + the export are untouched, so
// both goldens tie $0.00 (proven in golden-care / golden-synthetic).
// ---------------------------------------------------------------------------

/** A frozen as-bid line. `utilization` is irrelevant to a lump sum → null. */
const line = (
  code: string,
  description: string,
  qty: number,
  rate: number,
  total: number,
  rowNumber: number,
  extra: Partial<ImportedSheetLine> = {}
): ImportedSheetLine => ({
  code,
  description,
  utilization: null,
  qty,
  rate,
  total,
  rowNumber,
  ...extra,
});

// A hand-authored payload spanning the resolution cases:
//  - a bare GC base that resolves 1:1 (01-0410 → 01-0410.001);
//  - a shared Site-Ops base that resolves by description (02-9010 "…Hired" → .002);
//  - an unmappable Site-Ops line (02-4100 hand-inserted scope) that stays bare;
//  - an assigned-code line where the review-gate assignment wins over the bare code;
//  - a line whose qty × rate DISAGREES with its frozen total (the constants proof).
const PAYLOAD: ImportedStep23Lines = {
  step2Lines: [
    line("01-0410", "Sr Superintendent", 10, 1_000, 10_000, 5),
    // qty*rate = 500, but the bid's frozen total is 9,999 — the lump must win.
    line("01-9999", "Hand-typed GC allowance", 5, 100, 9_999, 6),
  ],
  step3Lines: [
    line("02-9010", "Progress Cleaning - Hired", 2, 1_000, 2_000, 3),
    line("02-4100", "Demolition - Openings in CMU", 40, 25, 1_000, 8),
    // Unmappable on its own, but the estimator assigned Soil Borings at review.
    line("02-4100", "Misc sitework", 1, 0, 1_500, 9, { assignedCode: "02-3200.001" }),
  ],
  linkedSourceSubtotals: [],
};

describe("Phase A4 — imported synthesis emits frozen lumpSum constants", () => {
  const lines = synthesizeImportedSectionLines(PAYLOAD, undefined, "proj-import");

  it("emits one lumpSum line per as-bid line, GC first then Site Ops", () => {
    expect(lines).toHaveLength(5);
    expect(lines.every((l) => l.entryKind === ENTRY_KIND.LumpSum)).toBe(true);
    expect(lines.slice(0, 2).every((l) => l.section === "gc")).toBe(true);
    expect(lines.slice(2).every((l) => l.section === "site_ops")).toBe(true);
    expect(lines.every((l) => l.projectId === "proj-import")).toBe(true);
    expect(lines.every((l) => l.source === "csv_import")).toBe(true);
    // Stable, unique, namespaced ids (distinct from app-born gc:/siteops: ids).
    expect(lines.map((l) => l.id)).toEqual([
      "imported:gc:5",
      "imported:gc:6",
      "imported:siteops:3",
      "imported:siteops:8",
      "imported:siteops:9",
    ]);
    expect(new Set(lines.map((l) => l.id)).size).toBe(lines.length);
  });

  it("every line's value IS the frozen as-bid total (never qty × rate)", () => {
    for (let i = 0; i < lines.length; i++) {
      const src = [...PAYLOAD.step2Lines, ...PAYLOAD.step3Lines][i];
      expect(lines[i].inputs.value).toBe(src.total);
    }
    // The crux: a line whose detail does NOT multiply cleanly takes the frozen
    // total, not the product — the imported number can never be re-derived.
    const allowance = lines.find((l) => l.id === "imported:gc:6")!;
    expect(allowance.inputs.value).toBe(9_999);
    expect(allowance.inputs.value).not.toBe(5 * 100);
  });

  it("never carries an authoritative total field (ID-1)", () => {
    for (const l of lines) {
      expect("total" in l).toBe(false);
      expect("total" in l.inputs).toBe(false);
    }
  });

  it("carries as-bid qty / rate / uom for display only", () => {
    const supt = lines.find((l) => l.id === "imported:gc:5")!;
    expect(supt.inputs.qty).toBe(10);
    expect(supt.inputs.rate).toBe(1_000);
  });
});

describe("Phase A4 — imported section lines are CONSTANTS, not recomputed", () => {
  it("changing a per-line qty/rate (a live recompute input) does not move the value", () => {
    const base = synthesizeImportedSectionLines(PAYLOAD);
    // Same payload, but every line's qty AND rate mutated — total held fixed.
    const mutated: ImportedStep23Lines = {
      ...PAYLOAD,
      step2Lines: PAYLOAD.step2Lines.map((l) => ({ ...l, qty: l.qty + 999, rate: l.rate + 999 })),
      step3Lines: PAYLOAD.step3Lines.map((l) => ({ ...l, qty: l.qty + 999, rate: l.rate + 999 })),
    };
    const after = synthesizeImportedSectionLines(mutated);
    expect(after.map((l) => l.inputs.value)).toEqual(base.map((l) => l.inputs.value));
  });

  it("only the frozen total moves the value", () => {
    const base = synthesizeImportedSectionLines(PAYLOAD);
    const reTotalled: ImportedStep23Lines = {
      ...PAYLOAD,
      step2Lines: PAYLOAD.step2Lines.map((l) => ({ ...l, total: l.total + 1 })),
      step3Lines: PAYLOAD.step3Lines.map((l) => ({ ...l, total: l.total + 1 })),
    };
    const after = synthesizeImportedSectionLines(reTotalled);
    for (let i = 0; i < base.length; i++) {
      expect(after[i].inputs.value).toBe((base[i].inputs.value as number) + 1);
    }
  });
});

describe("Phase A4 — code resolution honors the import review gate", () => {
  const lines = synthesizeImportedSectionLines(PAYLOAD);
  const byId = new Map(lines.map((l) => [l.id, l]));

  it("resolves a bare 1:1 base to the deterministic code + catalog Procore identity", () => {
    const supt = byId.get("imported:gc:5")!;
    expect(supt.code).toBe("01-0410.001"); // Sr Superintendent
    expect(supt.procoreCode).toBe("1-10410.000");
    expect(supt.costType).toBe("L");
    expect(supt.label).toBe("Sr Superintendent");
  });

  it("resolves a shared base by description (02-9010 → .002 Hired)", () => {
    const hired = byId.get("imported:siteops:3")!;
    expect(hired.code).toBe("02-9010.002");
    expect(hired.procoreCode).toBe("2-29010.000");
    expect(hired.costType).toBe("M");
  });

  it("keeps an unmappable line bare with no Procore identity", () => {
    const unmapped = byId.get("imported:siteops:8")!;
    expect(unmapped.code).toBe("02-4100"); // as-bid bare code, never guessed
    expect(unmapped.procoreCode).toBe("");
    expect(unmapped.costType).toBe("");
    expect(unmapped.label).toBe("Demolition - Openings in CMU");
  });

  it("an estimator-assigned code wins over the bare code", () => {
    const assigned = byId.get("imported:siteops:9")!;
    expect(assigned.code).toBe("02-3200.001"); // Soil Borings, assigned at review
    expect(assigned.procoreCode).toBe("2-23200.000");
    // …but the value is still the frozen lump, not a recompute.
    expect(assigned.inputs.value).toBe(1_500);
  });

  it("returns [] for an undefined payload (import predating detail capture)", () => {
    expect(synthesizeImportedSectionLines(undefined)).toEqual([]);
  });
});

describe("Phase A4 — realistic CI-safe payload (synthetic legacy bid)", () => {
  it("reproduces the frozen as-bid detail through the new row model", async () => {
    const extracted = await extractEstimateFromBuffer(await buildLegacyPastBidTemplateBuffer());
    const payload = step23LinesForImport(extracted);
    const lines = synthesizeImportedSectionLines(payload);

    // One lumpSum line per captured dollar line; value === frozen total.
    expect(lines).toHaveLength(payload.step2Lines.length + payload.step3Lines.length);
    const sources = [...payload.step2Lines, ...payload.step3Lines];
    lines.forEach((l, i) => {
      expect(l.entryKind).toBe(ENTRY_KIND.LumpSum);
      expect(l.inputs.value).toBe(sources[i].total);
    });

    // Section sums equal the as-bid line sums — the imported detail is preserved
    // exactly, independent of any STEP 2/3 input.
    const gcSum = lines.filter((l) => l.section === "gc").reduce((s, l) => s + (l.inputs.value as number), 0);
    const soSum = lines.filter((l) => l.section === "site_ops").reduce((s, l) => s + (l.inputs.value as number), 0);
    expect(gcSum).toBe(LEGACY_PAST_BID_ORACLE.step2Detail.reduce((s, d) => s + d.total, 0));
    expect(soSum).toBe(LEGACY_PAST_BID_ORACLE.step3Detail.reduce((s, d) => s + d.total, 0));
  });
});
