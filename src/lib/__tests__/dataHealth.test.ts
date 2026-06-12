/**
 * Database fidelity Phase 4 — the pure Data Health audit engine.
 * One engine, two surfaces: every check is asserted here once; the page and
 * the workspace strip only render what computeDataHealth returns.
 */
import { describe, it, expect } from "vitest";
import {
  computeDataHealth,
  findingsForProject,
  isUsableBidDate,
  PRICE_JUMP_FENCE,
  PRICE_JUMP_MIN_GROUP_SIZE,
  LUMP_SHARE_MIN_RATIO,
  LUMP_SHARE_MIN_LINES,
  type DataHealthFinding,
  type DataHealthFindingType,
  type DataHealthInputs,
  type LineItemHealthFact,
} from "@/lib/dataHealth";
import { getCatalogItems } from "@/lib/catalog";
import { STEP23_LINE_DEFS } from "@/lib/step23Normalization";
import type { PriceObservation } from "@/lib/priceHistory";
import type { Project, CustomStep23LineDef, CatalogAddition } from "@/types/db";

// A code shaped like a catalog code but guaranteed absent from the harvested
// catalog — keeps observation tests independent of real template content.
const FAKE_CODE = "99-9999.901";

const makeProject = (overrides: Partial<Project>): Project => ({
  id: "p1",
  name: "Alpha Tower",
  location: "",
  squareFootage: 0,
  unitCount: 0,
  bidDate: "2025-01-15",
  createdAt: "2026-06-01T12:00:00.000Z",
  bidOutcome: "won",
  deliveryMethod: "hard_bid",
  ...overrides,
});

const makeObs = (overrides: Partial<PriceObservation>): PriceObservation => ({
  itemId: FAKE_CODE,
  unitPrice: 10,
  uom: "EA",
  projectName: "Alpha Tower",
  bidDate: "2025-01-15",
  marketSector: "",
  qty: 1,
  ...overrides,
});

const makeFact = (overrides: Partial<LineItemHealthFact>): LineItemHealthFact => ({
  projectId: "p1",
  itemId: FAKE_CODE,
  isMapped: true,
  dataFidelity: "discrete_unit",
  total: 100,
  ...overrides,
});

const makeCustomDef = (overrides: Partial<CustomStep23LineDef>): CustomStep23LineDef => ({
  code: "01-0410.105",
  label: "Some Custom Line",
  unit: "MO",
  procoreCode: null,
  source: "import_gate",
  ...overrides,
});

const makeAddition = (overrides: Partial<CatalogAddition>): CatalogAddition => ({
  itemId: "99-9999.001",
  description: "Zebra Scaffolding Allowance Xyz",
  targetUom: "EA",
  defaultUnitPrice: 1,
  costType: "S",
  procoreCode: "01-310",
  status: "active",
  source: "catalog_manager",
  ...overrides,
});

const makeInputs = (overrides: Partial<DataHealthInputs>): DataHealthInputs => ({
  projects: [makeProject({})],
  estimateTotals: new Map(),
  lineItems: [],
  step4Observations: [],
  step23Observations: [],
  customDefs: [],
  additions: [],
  ...overrides,
});

const ofType = (findings: DataHealthFinding[], type: DataHealthFindingType) =>
  findings.filter((f) => f.type === type);

describe("computeDataHealth — clean data", () => {
  it("produces no findings on clean inputs", () => {
    const findings = computeDataHealth(
      makeInputs({
        lineItems: [makeFact({}), makeFact({ itemId: "99-9999.902" })],
        step4Observations: [
          makeObs({ unitPrice: 10 }),
          makeObs({ unitPrice: 11, projectName: "Beta Plaza", bidDate: "2025-02-01" }),
        ],
      })
    );
    expect(findings).toEqual([]);
  });
});

describe("unmapped lines per project", () => {
  it("counts unmapped lines and their dollars per project", () => {
    const findings = computeDataHealth(
      makeInputs({
        lineItems: [
          makeFact({ isMapped: false, itemId: "", total: 100 }),
          makeFact({ isMapped: false, itemId: "", total: 50.5 }),
          makeFact({}), // mapped — not counted
        ],
      })
    );
    const unmapped = ofType(findings, "unmapped_lines");
    expect(unmapped).toHaveLength(1);
    expect(unmapped[0].title).toContain("2 unmapped lines");
    expect(unmapped[0].title).toContain("$150.50");
    expect(unmapped[0].projects).toEqual([{ id: "p1", name: "Alpha Tower" }]);
    expect(unmapped[0].severity).toBe("medium");
  });

  it("reports nothing when every line is mapped", () => {
    const findings = computeDataHealth(makeInputs({ lineItems: [makeFact({})] }));
    expect(ofType(findings, "unmapped_lines")).toEqual([]);
  });
});

describe("unit conflicts per code (canonical units)", () => {
  it("does NOT flag alias spellings of the same unit (SF vs SQFT)", () => {
    const findings = computeDataHealth(
      makeInputs({
        step4Observations: [makeObs({ uom: "SF" }), makeObs({ uom: "SQFT", unitPrice: 12 })],
      })
    );
    expect(ofType(findings, "unit_conflict")).toEqual([]);
  });

  it("flags genuinely different units for one code (SF vs SY) as high severity", () => {
    const findings = computeDataHealth(
      makeInputs({
        step4Observations: [makeObs({ uom: "SF" }), makeObs({ uom: "SY", unitPrice: 12 })],
      })
    );
    const conflicts = ofType(findings, "unit_conflict");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].severity).toBe("high");
    expect(conflicts[0].code).toBe(FAKE_CODE);
    expect(conflicts[0].detail).toContain("SF");
    expect(conflicts[0].detail).toContain("SY");
    // Observation project names resolve to deep links via the projects input.
    expect(conflicts[0].projects).toEqual([{ id: "p1", name: "Alpha Tower" }]);
  });

  it("ignores excluded observations (lumps) and blank units", () => {
    const findings = computeDataHealth(
      makeInputs({
        step4Observations: [
          makeObs({ uom: "SF" }),
          makeObs({ uom: "SY", dataFidelity: "macro_lump_sum" }), // excluded by the trust screen
          makeObs({ uom: "" }), // a gap, not a conflict
        ],
      })
    );
    expect(ofType(findings, "unit_conflict")).toEqual([]);
  });

  it("judges STEP 2/3 observations in their own world", () => {
    const findings = computeDataHealth(
      makeInputs({
        step23Observations: [makeObs({ uom: "MO" }), makeObs({ uom: "HR", unitPrice: 95 })],
      })
    );
    expect(ofType(findings, "unit_conflict")).toHaveLength(1);
  });
});

describe("near-duplicate code labels", () => {
  const builtInStep23 = STEP23_LINE_DEFS[0];

  it("flags an active custom GC/Site-Ops def whose label matches a built-in (modulo punctuation)", () => {
    const findings = computeDataHealth(
      makeInputs({
        customDefs: [makeCustomDef({ label: `${builtInStep23.label}.` })],
      })
    );
    const dupes = ofType(findings, "near_duplicate_code");
    expect(dupes).toHaveLength(1);
    expect(dupes[0].title).toBe(`01-0410.105 looks like ${builtInStep23.code}`);
    expect(dupes[0].code).toBe("01-0410.105");
  });

  it("excludes retired and merged customs — already resolved by definition", () => {
    const findings = computeDataHealth(
      makeInputs({
        customDefs: [
          makeCustomDef({ label: builtInStep23.label, status: "retired" }),
          makeCustomDef({
            code: "01-0410.106",
            label: builtInStep23.label,
            status: "merged",
            mergedInto: builtInStep23.code,
          }),
        ],
      })
    );
    expect(ofType(findings, "near_duplicate_code")).toEqual([]);
  });

  it("flags an active catalog addition that duplicates a built-in catalog description", () => {
    const builtIn = Object.values(getCatalogItems()).find((i) => i.description.trim().length > 0)!;
    const findings = computeDataHealth(
      makeInputs({
        additions: [makeAddition({ description: builtIn.description })],
      })
    );
    const dupes = ofType(findings, "near_duplicate_code");
    expect(dupes.length).toBeGreaterThanOrEqual(1);
    expect(dupes.some((d) => d.title === `99-9999.001 looks like ${builtIn.itemId}`)).toBe(true);
  });

  it("excludes landed additions and emits one finding per addition pair", () => {
    const landed = computeDataHealth(
      makeInputs({
        additions: [
          makeAddition({
            status: "landed",
            description: Object.values(getCatalogItems())[0].description,
          }),
        ],
      })
    );
    expect(ofType(landed, "near_duplicate_code")).toEqual([]);

    const pair = computeDataHealth(
      makeInputs({
        additions: [
          makeAddition({ itemId: "99-9999.001" }),
          makeAddition({ itemId: "99-9999.002" }),
        ],
      })
    );
    expect(ofType(pair, "near_duplicate_code")).toHaveLength(1);
  });
});

describe("suspected duplicate imports", () => {
  const totals = (a: number, b: number) =>
    new Map([
      ["p1", a],
      ["p2", b],
    ]);

  it("flags same normalized name + same bid date", () => {
    const findings = computeDataHealth(
      makeInputs({
        projects: [
          makeProject({ id: "p1", name: "Maple Court — Apts" }),
          makeProject({ id: "p2", name: "maple court apts" }),
        ],
      })
    );
    const dupes = ofType(findings, "duplicate_import");
    expect(dupes).toHaveLength(1);
    expect(dupes[0].severity).toBe("high");
    expect(dupes[0].projects.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
  });

  it("flags same name + totals within 1% even when dates differ", () => {
    const findings = computeDataHealth(
      makeInputs({
        projects: [
          makeProject({ id: "p1", name: "Maple Court" }),
          makeProject({ id: "p2", name: "Maple Court", bidDate: "2024-09-01" }),
        ],
        estimateTotals: totals(100_000, 100_500),
      })
    );
    expect(ofType(findings, "duplicate_import")).toHaveLength(1);
  });

  it("does NOT flag same name alone when dates and totals both diverge", () => {
    const findings = computeDataHealth(
      makeInputs({
        projects: [
          makeProject({ id: "p1", name: "Maple Court" }),
          makeProject({ id: "p2", name: "Maple Court", bidDate: "2024-09-01" }),
        ],
        estimateTotals: totals(100_000, 150_000),
      })
    );
    expect(ofType(findings, "duplicate_import")).toEqual([]);
  });

  it("flags a renamed re-import: same bid date + identical total", () => {
    const findings = computeDataHealth(
      makeInputs({
        projects: [
          makeProject({ id: "p1", name: "Maple Court" }),
          makeProject({ id: "p2", name: "Maple Ct (rebid)" }),
        ],
        estimateTotals: totals(123_456.78, 123_456.78),
      })
    );
    expect(ofType(findings, "duplicate_import")).toHaveLength(1);
  });

  it("treats a missing estimate total as not comparable, never as $0", () => {
    const findings = computeDataHealth(
      makeInputs({
        projects: [
          makeProject({ id: "p1", name: "Alpha" }),
          makeProject({ id: "p2", name: "Beta" }),
        ],
        estimateTotals: new Map(), // same date, but no totals to corroborate
      })
    );
    expect(ofType(findings, "duplicate_import")).toEqual([]);
  });
});

describe("missing won/lost and delivery-method answers", () => {
  it("flags 'unknown' (and absent) capture fields, naming what is missing", () => {
    const findings = computeDataHealth(
      makeInputs({
        projects: [
          makeProject({ id: "p1", bidOutcome: "unknown" }),
          makeProject({ id: "p2", name: "Beta", bidOutcome: undefined, deliveryMethod: undefined }),
        ],
      })
    );
    const missing = ofType(findings, "missing_answers");
    expect(missing).toHaveLength(2);
    const p1 = missing.find((f) => f.projects[0].id === "p1")!;
    expect(p1.title).toContain("won/lost outcome unanswered");
    expect(p1.title).not.toContain("delivery method");
    const p2 = missing.find((f) => f.projects[0].id === "p2")!;
    expect(p2.title).toContain("won/lost outcome and delivery method");
  });

  it("reports nothing when both answers are recorded", () => {
    const findings = computeDataHealth(
      makeInputs({ projects: [makeProject({ bidOutcome: "lost", deliveryMethod: "gmp" })] })
    );
    expect(ofType(findings, "missing_answers")).toEqual([]);
  });
});

describe("lump-share per code", () => {
  it(`flags a code at >= ${LUMP_SHARE_MIN_RATIO * 100}% lumps with >= ${LUMP_SHARE_MIN_LINES} lump lines`, () => {
    const findings = computeDataHealth(
      makeInputs({
        lineItems: [
          makeFact({ dataFidelity: "macro_lump_sum" }),
          makeFact({ dataFidelity: "macro_lump_sum" }),
          makeFact({}),
        ],
      })
    );
    const lumps = ofType(findings, "lump_share");
    expect(lumps).toHaveLength(1);
    expect(lumps[0].title).toContain("2 of 3");
    expect(lumps[0].code).toBe(FAKE_CODE);
    expect(lumps[0].severity).toBe("low");
  });

  it("stays quiet below either threshold", () => {
    const oneLump = computeDataHealth(
      makeInputs({
        lineItems: [makeFact({ dataFidelity: "macro_lump_sum" }), makeFact({})],
      })
    );
    expect(ofType(oneLump, "lump_share")).toEqual([]); // 1 lump < min lines

    const lowRatio = computeDataHealth(
      makeInputs({
        lineItems: [
          makeFact({ dataFidelity: "macro_lump_sum" }),
          makeFact({ dataFidelity: "macro_lump_sum" }),
          makeFact({}),
          makeFact({}),
          makeFact({}),
        ],
      })
    );
    expect(ofType(lowRatio, "lump_share")).toEqual([]); // 2/5 < 50%
  });
});

describe("missing / unparseable bid dates", () => {
  it("isUsableBidDate accepts only real ISO calendar dates", () => {
    expect(isUsableBidDate("2025-01-15")).toBe(true);
    expect(isUsableBidDate("")).toBe(false);
    expect(isUsableBidDate("junk")).toBe(false);
    expect(isUsableBidDate("2025-02-30")).toBe(false); // ISO-shaped but not a date
  });

  it("flags projects whose observations can never be escalation-adjusted", () => {
    const findings = computeDataHealth(
      makeInputs({
        projects: [
          makeProject({ id: "p1", bidDate: "" }),
          makeProject({ id: "p2", name: "Beta", bidDate: "TBD" }),
          makeProject({ id: "p3", name: "Gamma" }),
        ],
      })
    );
    const dates = ofType(findings, "missing_bid_date");
    expect(dates).toHaveLength(2);
    expect(dates.map((f) => f.projects[0].id).sort()).toEqual(["p1", "p2"]);
  });
});

describe("price-jump detection (flag-only, trusted pool)", () => {
  const datedObs = (bidDate: string, unitPrice: number, projectName = "Alpha Tower") =>
    makeObs({ bidDate, unitPrice, projectName });

  it(`flags a consecutive move past ${PRICE_JUMP_FENCE}x for the same (code, unit)`, () => {
    const findings = computeDataHealth(
      makeInputs({
        step4Observations: [
          datedObs("2024-01-01", 10),
          datedObs("2024-06-01", 11, "Beta Plaza"),
          datedObs("2025-01-01", 40),
        ],
      })
    );
    const jumps = ofType(findings, "price_jump");
    expect(jumps).toHaveLength(1);
    expect(jumps[0].title).toContain(FAKE_CODE);
    expect(jumps[0].detail).toContain("$11.00");
    expect(jumps[0].detail).toContain("$40.00");
    expect(jumps[0].code).toBe(FAKE_CODE);
  });

  it("stays quiet on ordinary movement and on tiny pools", () => {
    const ordinary = computeDataHealth(
      makeInputs({
        step4Observations: [
          datedObs("2024-01-01", 10),
          datedObs("2024-06-01", 11),
          datedObs("2025-01-01", 12),
        ],
      })
    );
    expect(ofType(ordinary, "price_jump")).toEqual([]);

    const tiny = computeDataHealth(
      makeInputs({
        // a 10x move, but below PRICE_JUMP_MIN_GROUP_SIZE dated observations
        step4Observations: [datedObs("2024-01-01", 10), datedObs("2025-01-01", 100)].slice(
          0,
          PRICE_JUMP_MIN_GROUP_SIZE - 1
        ),
      })
    );
    expect(ofType(tiny, "price_jump")).toEqual([]);
  });

  it("ignores same-day spreads — a jump is a move over time", () => {
    const findings = computeDataHealth(
      makeInputs({
        step4Observations: [
          datedObs("2024-01-01", 10),
          datedObs("2024-01-01", 45),
          datedObs("2024-01-01", 11),
        ],
      })
    );
    expect(ofType(findings, "price_jump")).toEqual([]);
  });

  it("composes with the outlier screen: an IQR-flagged outlier cannot also be a jump", () => {
    const findings = computeDataHealth(
      makeInputs({
        step4Observations: [
          datedObs("2024-01-01", 10),
          datedObs("2024-02-01", 10),
          datedObs("2024-03-01", 10),
          datedObs("2024-04-01", 10),
          datedObs("2024-05-01", 10),
          datedObs("2024-06-01", 200), // flagged outlier — set aside before the jump walk
        ],
      })
    );
    expect(ofType(findings, "price_jump")).toEqual([]);
  });
});

describe("output shape and the project filter", () => {
  it("orders findings by severity (high first)", () => {
    const findings = computeDataHealth(
      makeInputs({
        projects: [
          makeProject({ id: "p1", name: "Maple Court", bidOutcome: "unknown" }),
          makeProject({ id: "p2", name: "Maple Court" }),
        ],
      })
    );
    expect(findings[0].type).toBe("duplicate_import");
    expect(findings[findings.length - 1].severity).toBe("low");
  });

  it("findingsForProject keeps only findings involving the project", () => {
    const findings = computeDataHealth(
      makeInputs({
        projects: [
          makeProject({ id: "p1", bidOutcome: "unknown" }),
          makeProject({ id: "p2", name: "Beta", bidDate: "" }),
        ],
      })
    );
    expect(findingsForProject(findings, "p1").every((f) => f.projects.some((p) => p.id === "p1"))).toBe(true);
    expect(findingsForProject(findings, "p1").some((f) => f.type === "missing_answers")).toBe(true);
    expect(findingsForProject(findings, "p1").some((f) => f.type === "missing_bid_date")).toBe(false);
  });
});
