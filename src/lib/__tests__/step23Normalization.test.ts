/**
 * step23Normalization — bare STEP 2/3 code → deterministic GC/Site-Ops code
 * (Phase 3 Slice 3). Labeling only — resolution never moves a dollar, never
 * guesses, and the unresolvable case stays bare. Cases mirror the CARE probe
 * (2026-06-10): 68/72 bases are 1:1; the shared bases split by description.
 */
import { describe, it, expect } from "vitest";
import {
  resolveStep23Line,
  step23Observations,
  STEP23_LINE_DEFS,
  type Step23HistorySource,
} from "../step23Normalization";
import type { ImportedSheetLine, ImportedStep23Lines } from "@/types/db";

const line = (over: Partial<ImportedSheetLine>): ImportedSheetLine => ({
  code: "01-0410",
  description: "Sr Superintendent",
  utilization: null,
  qty: 1818.6,
  rate: 125,
  total: 227_325,
  rowNumber: 12,
  uom: "HR",
  ...over,
});

const source = (lines2: ImportedSheetLine[], lines3: ImportedSheetLine[] = []): Step23HistorySource => ({
  payload: {
    step2Lines: lines2,
    step3Lines: lines3,
    linkedSourceSubtotals: [],
  } satisfies ImportedStep23Lines,
  projectName: "CARE Relocation",
  bidDate: "2026-04-03",
  marketSector: "Healthcare",
});

describe("resolveStep23Line", () => {
  it("resolves a unique base mechanically (1:1, description not required to match)", () => {
    expect(resolveStep23Line("01-0410", "Sr Superintendent")).toMatchObject({
      code: "01-0410.001",
      label: "Sr Superintendent",
    });
    // CARE writes "Small Tools"; the app label carries an annotation — base wins.
    expect(resolveStep23Line("01-1000", "Small Tools")?.code).toBe("01-1000.001");
    // Equipment lines (no rate-card row) still resolve for labeling.
    expect(resolveStep23Line("01-5130", "Dumpsters")?.code).toBe("01-5130.001");
  });

  it("splits a shared base by exact normalized description (CARE 02-9010)", () => {
    expect(resolveStep23Line("02-9010", "Progress Cleaning - Payroll")?.code).toBe("02-9010.001");
    expect(resolveStep23Line("02-9010", "Progress Cleaning - Hired")?.code).toBe("02-9010.002");
    // Case/whitespace-insensitive.
    expect(resolveStep23Line("02-9010", "  progress cleaning - HIRED ")?.code).toBe("02-9010.002");
  });

  it("matches a def label with its trailing parenthetical stripped (CARE 01-5110)", () => {
    // App labels: "Temp Office Set up and Takedown" (.001) / "Temp Office (Monthly)" (.002).
    expect(resolveStep23Line("01-5110", "Temp Office Set up and Takedown")?.code).toBe("01-5110.001");
    expect(resolveStep23Line("01-5110", "Temp Office")?.code).toBe("01-5110.002");
  });

  it("splits the demolition and survey families (CARE 02-4100 / 02-9200)", () => {
    expect(resolveStep23Line("02-4100", "Demolition")?.code).toBe("02-4100.001");
    expect(resolveStep23Line("02-4100", "Demolition - Sawcutting")?.code).toBe("02-4100.002");
    expect(resolveStep23Line("02-9200", "Survey & Layout")?.code).toBe("02-9200.001");
    expect(resolveStep23Line("02-9200", "Survey & Layout - Floor Scanning")?.code).toBe("02-9200.002");
  });

  it("NEVER guesses: a hand-inserted scope line on a shared base stays bare", () => {
    // CARE's real case — $280k of demolition with no app line. Stays unresolved.
    expect(resolveStep23Line("02-4100", "Demolition - Openings in CMU")).toBeNull();
    expect(resolveStep23Line("02-4100", "")).toBeNull();
  });

  it("passes through an already-deterministic known code and rejects unknown ones", () => {
    expect(resolveStep23Line("02-9010.002", "anything")?.code).toBe("02-9010.002");
    expect(resolveStep23Line("99-9999.001", "anything")).toBeNull();
  });

  it("returns null for invalid or uncatalogued codes", () => {
    expect(resolveStep23Line("", "Sr Superintendent")).toBeNull();
    expect(resolveStep23Line("abc", "Sr Superintendent")).toBeNull();
    // A bare STEP 4-style trade code is not a GC/Site-Ops line.
    expect(resolveStep23Line("03-3000", "Concrete")).toBeNull();
  });

  it("an assigned code WINS over description matching (import review gate, Phase 1)", () => {
    // CARE's hand-inserted line — unresolvable on its own — resolves once assigned.
    expect(resolveStep23Line("02-4100", "Demolition - Openings in CMU", "02-4100.001")).toMatchObject({
      code: "02-4100.001",
      label: "Demolition",
    });
    // Assignment beats a description that would match a DIFFERENT def.
    expect(resolveStep23Line("02-9010", "Progress Cleaning - Hired", "02-9010.001")?.code).toBe("02-9010.001");
    // Whitespace-tolerant, same as the other inputs.
    expect(resolveStep23Line("02-4100", "Demolition - Openings in CMU", " 02-4100.001 ")?.code).toBe("02-4100.001");
  });

  it("a stale assignment (unknown def) falls through to normal resolution, never fabricates", () => {
    expect(resolveStep23Line("02-9010", "Progress Cleaning - Hired", "99-9999.001")?.code).toBe("02-9010.002");
    expect(resolveStep23Line("02-4100", "Demolition - Openings in CMU", "99-9999.001")).toBeNull();
    // Absent/blank assignment = exactly the old behavior.
    expect(resolveStep23Line("02-4100", "Demolition - Openings in CMU", "")).toBeNull();
  });

  it("derives defs from the app's own constants (no duplicated codes)", () => {
    const codes = STEP23_LINE_DEFS.map((d) => d.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain("01-0410.001");
    expect(codes).toContain("02-9530.001");
  });
});

describe("step23Observations (fork F-B: carried + priced lines only)", () => {
  it("emits an observation keyed by the RESOLVED code, with as-bid rate and UOM", () => {
    const out = step23Observations([source([line({})])]);
    expect(out).toEqual([
      {
        itemId: "01-0410.001",
        unitPrice: 125,
        uom: "HR",
        projectName: "CARE Relocation",
        bidDate: "2026-04-03",
        marketSector: "Healthcare",
      },
    ]);
  });

  it("skips zero-qty template rows, zero rates, %-UOM pseudo-rates, and non-finite values", () => {
    const out = step23Observations([
      source([
        line({ code: "01-0420", description: "Superintendent", qty: 0, rate: 110 }),
        line({ code: "01-0610", description: "Safety Consultant", qty: 0.0002, rate: 16_000_000, uom: "%" }),
        line({ code: "02-9200", description: "Survey & Layout - Floor Scanning", qty: 1, rate: 0, uom: "LS" }),
        // JSON can carry null where a number belongs — never a junk observation.
        line({ qty: null as unknown as number }),
        line({ rate: null as unknown as number }),
      ]),
    ]);
    expect(out).toEqual([]);
  });

  it("skips unresolved lines (they stay visible in the panel, not in the stats)", () => {
    const out = step23Observations([
      source(
        [],
        [line({ code: "02-4100", description: "Demolition - Openings in CMU", qty: 82, rate: 3419.44, uom: "EA" })]
      ),
    ]);
    expect(out).toEqual([]);
  });

  it("files an ASSIGNED line under its assigned code (assignment = resolution, gate Phase 1)", () => {
    const out = step23Observations([
      source(
        [],
        [
          line({
            code: "02-4100",
            description: "Demolition - Openings in CMU",
            qty: 82,
            rate: 3419.44,
            uom: "EA",
            assignedCode: "02-4100.001",
          }),
        ]
      ),
    ]);
    expect(out.map((o) => o.itemId)).toEqual(["02-4100.001"]);
    expect(out[0].unitPrice).toBe(3419.44);
    // The minable filter still applies to assigned lines (zero-qty stays out).
    const zeroQty = step23Observations([
      source([], [line({ code: "02-4100", description: "Demolition - Openings in CMU", qty: 0, assignedCode: "02-4100.001" })]),
    ]);
    expect(zeroQty).toEqual([]);
  });

  it("reads both sheets and tolerates a pre-Slice-0 payload with no uom", () => {
    const out = step23Observations([
      source(
        [line({})],
        [line({ code: "02-9010", description: "Progress Cleaning - Hired", qty: 181.86, rate: 54, uom: undefined })]
      ),
    ]);
    expect(out.map((o) => o.itemId)).toEqual(["01-0410.001", "02-9010.002"]);
    expect(out[1].uom).toBe("");
  });
});
