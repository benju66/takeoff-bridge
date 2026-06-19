import { describe, it, expect, afterEach } from "vitest";
import {
  isOneOffLine,
  newOneOffLine,
  oneOffToGcManualConfig,
  oneOffToSiteOpsManualConfig,
  oneOffValueInjection,
  validateOneOffCode,
} from "@/lib/sectionLines/oneOff";
import {
  computePersonnelCosts,
  computeSiteOperations,
  buildPersonnelLineSet,
  buildSiteOpsLineSet,
} from "@/lib/calculations";
import {
  computePersonnelFromSectionLines,
  computeSiteOpsFromSectionLines,
  deriveOneOffsFromLines,
} from "@/lib/sectionLines/project";
import { synthesizePersonnelSectionLines, synthesizeSiteOpsSectionLines } from "@/lib/sectionLines/synthesize";
import { validateExportReadiness } from "@/lib/exporter";
import { primeProcoreValidCodes, resetProcoreValidCodes } from "@/lib/procoreValidCodes";
import type { EstimateSectionLine } from "@/types/db";

// GC/Site-Ops Addressability — Phase B5 (D1): the validated one-off escape hatch.
// Proves the one-off model, the dual-read bridge parity (the invariant that keeps the live
// tripwire green), the load reconstruction, and the export gate (uncoded blocked / coded ok).

afterEach(() => resetProcoreValidCodes());

const DUR = 12;
const SQFT = 10000;

describe("one-off model", () => {
  it("newOneOffLine mints an uncoded, source:'manual' line with id === code", () => {
    const line = newOneOffLine({ section: "gc", label: "Site permit fee", unit: "ls", entry: "lumpSum", value: 5000 });
    expect(line.source).toBe("manual");
    expect(line.id).toBe(line.code);
    expect(line.procoreCode).toBe("");
    expect(line.costType).toBe("");
    expect(line.entryKind).toBe("lumpSum");
    expect(line.inputs.value).toBe(5000);
    expect(line.inputs.unit).toBe("ls");
    expect(isOneOffLine(line)).toBe(true);
  });

  it("isOneOffLine is false for a catalog seed line", () => {
    const [catalogLine] = synthesizePersonnelSectionLines({}, {});
    expect(isOneOffLine(catalogLine)).toBe(false);
  });

  it("oneOffValueInjection carries the value keyed by id (a qty rate rides config.rate, not a rate map)", () => {
    const qty = newOneOffLine({ section: "site_ops", label: "x", unit: "ea", entry: "qty", value: 4, rate: 100 });
    expect(oneOffValueInjection(qty)).toEqual({ key: qty.id, value: 4 });
    const lump = newOneOffLine({ section: "gc", label: "z", unit: "ls", entry: "lumpSum", value: 9000 });
    expect(oneOffValueInjection(lump)).toEqual({ key: lump.id, value: 9000 });
  });

  it("oneOffToGcManualConfig / SiteOps keys the config by the line id", () => {
    const gc = newOneOffLine({ section: "gc", label: "g", unit: "ea", entry: "qty", value: 2, rate: 50 });
    const gcCfg = oneOffToGcManualConfig({ ...gc, procoreCode: "1-10001.000", costType: "M" });
    expect(gcCfg.key).toBe(gc.id);
    expect(gcCfg.code).toBe(gc.code);
    expect(gcCfg.procoreCode).toBe("1-10001.000");
    expect(gcCfg.entry).toBe("qty");
    expect(gcCfg.rate).toBe(50);

    const so = newOneOffLine({ section: "site_ops", label: "s", unit: "ls", entry: "lumpSum", value: 3000 });
    const soCfg = oneOffToSiteOpsManualConfig(so);
    expect(soCfg.key).toBe(so.id);
    expect(soCfg.entry).toBe("lumpSum");
    expect(soCfg.rate).toBeNull();
  });
});

describe("validateOneOffCode (D1 — valid procore_cost_codes entry, with a cost type)", () => {
  it("rejects empty + unknown codes", () => {
    expect(validateOneOffCode("")).toEqual({ ok: false, error: expect.any(String) });
    expect(validateOneOffCode("99-99999.999")).toEqual({ ok: false, error: expect.any(String) });
  });

  it("accepts a baseline code (type unknown → defaults to M)", () => {
    // A real GC/Site-Ops catalog procore code, present in the JSON baseline (no type there).
    const res = validateOneOffCode("2-29010.000");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.costType).toBe("M");
  });

  it("maps the Procore type to the estimate cost type when primed", () => {
    primeProcoreValidCodes([
      { code: "1-10001.000", description: "Precon", type: "Labor" },
      { code: "2-23200.000", description: "Soil", type: "Subcontract" },
    ]);
    const labor = validateOneOffCode("1-10001.000");
    const sub = validateOneOffCode("2-23200.000");
    expect(labor.ok && labor.costType).toBe("L");
    expect(sub.ok && sub.costType).toBe("S");
  });
});

describe("dual-read bridge parity (the live-tripwire invariant)", () => {
  it("GC: bridge over [catalog + one-off] === direct engine addManual call", () => {
    const oneOff = newOneOffLine({ section: "gc", label: "One-off fee", unit: "ls", entry: "lumpSum", value: 5000 });
    const lines: EstimateSectionLine[] = [...synthesizePersonnelSectionLines({}, {}), oneOff];

    const viaBridge = computePersonnelFromSectionLines(lines, { durationMonths: DUR, squareFootage: SQFT });
    const direct = computePersonnelCosts(
      DUR, SQFT, {}, { dumpsters: 0, toilets: 0, electric: 0 }, { [oneOff.id]: 5000 }, {}, undefined,
      buildPersonnelLineSet({ addManual: [oneOffToGcManualConfig(oneOff)] })
    );
    expect(JSON.stringify(viaBridge)).toBe(JSON.stringify(direct));
    // The one-off shows up as a manual line carrying its $5,000.
    const ooLine = viaBridge.manualLines.find((l) => l.code === oneOff.code);
    expect(ooLine?.total).toBe(5000);
  });

  it("Site-Ops: bridge over [catalog + one-off qty] === direct engine addManual call", () => {
    const oneOff = newOneOffLine({ section: "site_ops", label: "One-off unit work", unit: "ea", entry: "qty", value: 10, rate: 250 });
    const lines: EstimateSectionLine[] = [...synthesizeSiteOpsSectionLines({}, {}), oneOff];

    const viaBridge = computeSiteOpsFromSectionLines(lines, { durationMonths: DUR, squareFootage: SQFT });
    const direct = computeSiteOperations(
      DUR, SQFT, { [oneOff.id]: 10 }, {}, undefined,
      buildSiteOpsLineSet({ addManual: [oneOffToSiteOpsManualConfig(oneOff)] })
    );
    expect(JSON.stringify(viaBridge)).toBe(JSON.stringify(direct));
    const ooLine = viaBridge.manualLines.find((l) => l.code === oneOff.code);
    expect(ooLine?.total).toBe(2500); // 10 × $250
  });
});

describe("deriveOneOffsFromLines (load reconstruction)", () => {
  it("splits the source:'manual' lines by section; ignores catalog seed", () => {
    const gcOneOff = newOneOffLine({ section: "gc", label: "g", unit: "ls", entry: "lumpSum", value: 1 });
    const soOneOff = newOneOffLine({ section: "site_ops", label: "s", unit: "ls", entry: "lumpSum", value: 2 });
    const lines: EstimateSectionLine[] = [
      ...synthesizePersonnelSectionLines({}, {}),
      ...synthesizeSiteOpsSectionLines({}, {}),
      gcOneOff,
      soOneOff,
    ];
    const { gc, siteOps } = deriveOneOffsFromLines(lines);
    expect(gc.map((l) => l.id)).toEqual([gcOneOff.id]);
    expect(siteOps.map((l) => l.id)).toEqual([soOneOff.id]);
  });

  it("empty when there are no one-offs", () => {
    const { gc, siteOps } = deriveOneOffsFromLines(synthesizePersonnelSectionLines({}, {}));
    expect(gc).toEqual([]);
    expect(siteOps).toEqual([]);
  });
});

describe("export gate (D1 — uncoded one-off blocked, coded one-off exports)", () => {
  const gcCalc = computePersonnelCosts(DUR, SQFT, {}, { dumpsters: 0, toilets: 0, electric: 0 });

  it("blocks an UNCODED one-off carrying dollars with a kind:'oneOff' blocker", () => {
    const oneOff = newOneOffLine({ section: "site_ops", label: "Uncoded fee", unit: "ls", entry: "lumpSum", value: 5000 });
    const siteOpsCalc = computeSiteOperations(
      DUR, SQFT, { [oneOff.id]: 5000 }, {}, undefined,
      buildSiteOpsLineSet({ addManual: [oneOffToSiteOpsManualConfig(oneOff)] })
    );
    const readiness = validateExportReadiness([], gcCalc, siteOpsCalc);
    expect(readiness.ok).toBe(false);
    const ooBlocker = readiness.blockers.find((b) => b.kind === "oneOff");
    expect(ooBlocker).toBeTruthy();
    expect(ooBlocker?.description).toBe("Uncoded fee");
    expect(ooBlocker?.amount).toBe(5000);
  });

  it("a CODED one-off (valid procore code) raises no one-off blocker", () => {
    const oneOff = {
      ...newOneOffLine({ section: "site_ops", label: "Coded fee", unit: "ls", entry: "lumpSum", value: 5000 }),
      procoreCode: "2-29010.000", // valid baseline code
      costType: "M",
    };
    const siteOpsCalc = computeSiteOperations(
      DUR, SQFT, { [oneOff.id]: 5000 }, {}, undefined,
      buildSiteOpsLineSet({ addManual: [oneOffToSiteOpsManualConfig(oneOff)] })
    );
    const readiness = validateExportReadiness([], gcCalc, siteOpsCalc);
    expect(readiness.blockers.some((b) => b.kind === "oneOff")).toBe(false);
  });

  it("a default project (no one-offs) raises no one-off blocker", () => {
    const siteOpsCalc = computeSiteOperations(DUR, SQFT, {}, {});
    const readiness = validateExportReadiness([], gcCalc, siteOpsCalc);
    expect(readiness.blockers.some((b) => b.kind === "oneOff")).toBe(false);
  });
});
