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
  isStep23DeterministicCode,
  isBuiltInStep23Code,
  suggestNextStep23Code,
  activeStep23Defs,
  STEP23_LINE_DEFS,
  type Step23HistorySource,
  type Step23LineDef,
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

describe("custom def overlay (extra defs parameter, gate Phase 2)", () => {
  // A user-minted code for CARE's hand-inserted scope line, plus a second
  // custom under a base that is 1:1 among the built-ins (01-0410).
  const CUSTOM: Step23LineDef[] = [
    { code: "02-4100.003", label: "Demolition - Openings in CMU" },
    { code: "01-0410.002", label: "Night Superintendent" },
  ];

  it("an assigned CUSTOM code resolves like any known def", () => {
    expect(resolveStep23Line("02-4100", "whatever the bid says", "02-4100.003", CUSTOM)).toEqual({
      code: "02-4100.003",
      label: "Demolition - Openings in CMU",
    });
    // Without the overlay the same assignment is stale and falls through.
    expect(resolveStep23Line("02-4100", "whatever the bid says", "02-4100.003")).toBeNull();
  });

  it("a minted code auto-resolves matching lines RETROACTIVELY (bare base + description)", () => {
    // CARE's real case: unresolvable before the mint, labeled after — no re-import.
    expect(resolveStep23Line("02-4100", "Demolition - Openings in CMU", undefined, CUSTOM)?.code).toBe(
      "02-4100.003"
    );
    // Deterministic pass-through works for customs too (future re-imports).
    expect(resolveStep23Line("02-4100.003", "anything", undefined, CUSTOM)?.code).toBe("02-4100.003");
    // The built-in shared-base splits are untouched by the overlay.
    expect(resolveStep23Line("02-4100", "Demolition", undefined, CUSTOM)?.code).toBe("02-4100.001");
    expect(resolveStep23Line("02-4100", "Demolition - Sawcutting", undefined, CUSTOM)?.code).toBe("02-4100.002");
  });

  it("a BUILT-IN def always beats a colliding custom (conflict surfaces as the built-in label)", () => {
    const hijack: Step23LineDef[] = [{ code: "02-4100.001", label: "Hijacked Label" }];
    // Assignment to the contested code resolves to the BUILT-IN def.
    expect(resolveStep23Line("02-4100", "x", "02-4100.001", hijack)).toMatchObject({
      code: "02-4100.001",
      label: "Demolition",
    });
    // The custom label never becomes a resolution target (no silent merge).
    expect(resolveStep23Line("02-4100", "Hijacked Label", undefined, hijack)).toBeNull();
  });

  it("a malformed custom code resolves nothing (db gate backstop)", () => {
    const malformed: Step23LineDef[] = [{ code: "02-4100", label: "Bare Code" }];
    expect(resolveStep23Line("02-4100", "Bare Code", undefined, malformed)).toBeNull();
    expect(resolveStep23Line("02-4100", "x", "02-4100", malformed)).toBeNull();
  });

  it("a custom under a previously 1:1 base makes it SHARED — description now required", () => {
    // 01-0410 is 1:1 among the built-ins (mechanical resolution)…
    expect(resolveStep23Line("01-0410", "any description at all")?.code).toBe("01-0410.001");
    // …but with a second claim the resolver never guesses between them.
    expect(resolveStep23Line("01-0410", "Sr Superintendent", undefined, CUSTOM)?.code).toBe("01-0410.001");
    expect(resolveStep23Line("01-0410", "Night Superintendent", undefined, CUSTOM)?.code).toBe("01-0410.002");
    expect(resolveStep23Line("01-0410", "any description at all", undefined, CUSTOM)).toBeNull();
  });

  it("an empty overlay is EXACTLY the built-in behavior", () => {
    expect(resolveStep23Line("01-0410", "any description at all", undefined, [])?.code).toBe("01-0410.001");
    expect(resolveStep23Line("02-4100", "Demolition - Openings in CMU", undefined, [])).toBeNull();
  });

  it("step23Observations files lines under a minted code (report-only mining)", () => {
    const cmu = line({ code: "02-4100", description: "Demolition - Openings in CMU", qty: 82, rate: 3419.44, uom: "EA" });
    // Without the overlay the line is unresolved and skipped…
    expect(step23Observations([source([], [cmu])])).toEqual([]);
    // …with it, the observation files under the custom code (no rate_card row
    // for 02-4100.003 → no ADOPT surface on /rates, by construction).
    const out = step23Observations([source([], [cmu])], CUSTOM);
    expect(out.map((o) => o.itemId)).toEqual(["02-4100.003"]);
    expect(out[0].unitPrice).toBe(3419.44);
  });

  it("exposes the validation helpers db.ts mints against", () => {
    expect(isStep23DeterministicCode("02-4100.003")).toBe(true);
    expect(isStep23DeterministicCode("02-4100")).toBe(false);
    expect(isStep23DeterministicCode("2-4100.003")).toBe(false);
    expect(isBuiltInStep23Code("02-4100.001")).toBe(true);
    expect(isBuiltInStep23Code("02-4100.003")).toBe(false);
  });
});

describe("lifecycle: merge redirects + retire (Catalog Manager Phase 1)", () => {
  // A minted custom (02-4100.003) that duplicated CARE's hand-inserted scope
  // line, later MERGED into the built-in 02-4100.001 (the common repair).
  const MERGED_TO_BUILTIN: Step23LineDef[] = [
    { code: "02-4100.003", label: "Demolition - Openings in CMU", status: "merged", mergedInto: "02-4100.001" },
  ];

  it("a merged code redirects to its winner at render time (no payload rewrite)", () => {
    // Assignment to the merged code now shows the WINNER's def…
    expect(resolveStep23Line("02-4100", "x", "02-4100.003", MERGED_TO_BUILTIN)).toMatchObject({
      code: "02-4100.001",
      label: "Demolition",
    });
    // …and so does the deterministic pass-through of the merged code itself.
    expect(resolveStep23Line("02-4100.003", "anything", undefined, MERGED_TO_BUILTIN)?.code).toBe("02-4100.001");
  });

  it("two custom codes, one merged into the other, redirect to the active winner", () => {
    const defs: Step23LineDef[] = [
      { code: "02-4100.003", label: "CMU Openings (old)", status: "merged", mergedInto: "02-4100.004" },
      { code: "02-4100.004", label: "CMU Openings" },
    ];
    expect(resolveStep23Line("02-4100.003", "x", undefined, defs)?.code).toBe("02-4100.004");
    // The winner resolves to itself.
    expect(resolveStep23Line("02-4100.004", "x", undefined, defs)?.code).toBe("02-4100.004");
  });

  it("a retired code STILL labels its old lines (history intact) but its label is its own", () => {
    const retired: Step23LineDef[] = [
      { code: "02-4100.003", label: "Demolition - Openings in CMU", status: "retired" },
    ];
    expect(resolveStep23Line("02-4100.003", "anything", undefined, retired)).toMatchObject({
      code: "02-4100.003",
      label: "Demolition - Openings in CMU",
      status: "retired",
    });
    // Assignment to a retired code still resolves it.
    expect(resolveStep23Line("02-4100", "x", "02-4100.003", retired)?.code).toBe("02-4100.003");
  });

  it("activeStep23Defs drops retired/merged customs from pickers but keeps active ones + all built-ins", () => {
    const overlay: Step23LineDef[] = [
      { code: "01-0410.002", label: "Night Superintendent" }, // active (status absent)
      { code: "02-4100.003", label: "Retired Line", status: "retired" },
      { code: "02-4100.004", label: "Merged Line", status: "merged", mergedInto: "02-4100.001" },
      { code: "02-4100.001", label: "Hijack", status: "active" }, // shadows a built-in → dropped
      { code: "02-4100", label: "Malformed" }, // not deterministic → dropped
    ];
    const codes = activeStep23Defs(overlay).map((d) => d.code);
    expect(codes).toContain("01-0410.002"); // active custom offered
    expect(codes).not.toContain("02-4100.003"); // retired gone
    expect(codes).not.toContain("02-4100.004"); // merged gone
    expect(codes).not.toContain("02-4100"); // malformed gone
    // Built-ins are always present, and the shadowing custom never doubles them.
    expect(codes.filter((c) => c === "02-4100.001")).toEqual(["02-4100.001"]);
    expect(codes).toContain("01-0410.001");
    // Empty/absent overlay === the built-in list.
    expect(activeStep23Defs().map((d) => d.code)).toEqual(activeStep23Defs([]).map((d) => d.code));
    expect(activeStep23Defs().every((d) => isBuiltInStep23Code(d.code))).toBe(true);
  });

  it("suggestNextStep23Code keeps counting retired/merged suffixes (never reused)", () => {
    // .003 is retired and .004 merged, but both still occupy the suffix space.
    const defs: Step23LineDef[] = [
      { code: "02-4100.003", label: "Retired", status: "retired" },
      { code: "02-4100.004", label: "Merged", status: "merged", mergedInto: "02-4100.001" },
    ];
    expect(suggestNextStep23Code("02-4100", defs)).toBe("02-4100.005");
  });

  it("no dollars move: merging refiles history under the winner with the SAME rate", () => {
    const cmu = line({ code: "02-4100", description: "Demolition - Openings in CMU", qty: 82, rate: 3419.44, uom: "EA" });
    const active: Step23LineDef[] = [{ code: "02-4100.003", label: "Demolition - Openings in CMU" }];
    const merged: Step23LineDef[] = [
      { code: "02-4100.003", label: "Demolition - Openings in CMU", status: "merged", mergedInto: "02-4100.001" },
    ];
    const before = step23Observations([source([], [cmu])], active);
    const after = step23Observations([source([], [cmu])], merged);
    // The code the observation files under moves to the winner…
    expect(before.map((o) => o.itemId)).toEqual(["02-4100.003"]);
    expect(after.map((o) => o.itemId)).toEqual(["02-4100.001"]);
    // …but the mined RATE (the only number) is byte-identical — a merge is a
    // label/redirect, never a dollar.
    expect(after[0].unitPrice).toBe(before[0].unitPrice);
    expect(after[0].unitPrice).toBe(3419.44);
  });
});

describe("suggestNextStep23Code (mint mini-form pre-fill, gate Phase 3)", () => {
  it("suggests one past the highest suffix the built-ins claim under the base", () => {
    expect(suggestNextStep23Code("02-4100")).toBe("02-4100.003"); // .001/.002 built-in
    expect(suggestNextStep23Code("01-0410")).toBe("01-0410.002"); // 1:1 base
  });

  it("counts custom defs under the base too (never re-suggests a minted code)", () => {
    expect(suggestNextStep23Code("02-4100", [{ code: "02-4100.003", label: "CMU Openings" }])).toBe(
      "02-4100.004"
    );
  });

  it("starts at .001 for a base no def claims", () => {
    expect(suggestNextStep23Code("02-7777")).toBe("02-7777.001");
  });

  it("takes the base from an already-deterministic as-bid code", () => {
    expect(suggestNextStep23Code("02-4100.002")).toBe("02-4100.003");
  });

  it("returns '' when there is no usable base — the estimator types the code", () => {
    expect(suggestNextStep23Code("")).toBe("");
    expect(suggestNextStep23Code("SPECIAL-CRANE")).toBe("");
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
