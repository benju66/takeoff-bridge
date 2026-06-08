import { describe, it, expect } from "vitest";
import {
  groupRateCardRows,
  parseRateInput,
  RATE_LINE_DEFS,
  RATE_SECTION_ORDER,
  STAFF_SECTION_ID,
  CATALOG_SECTION_PREFIX,
} from "../rateCardEditor";
import {
  STAFF_ROLE_DEFAULTS,
  OPERATIONAL_EXPENSE_DEFAULTS,
  GC_MANUAL_DEFAULTS,
  SITE_OPS_DYNAMIC_DEFAULTS,
  SITE_OPS_MANUAL_DEFAULTS,
} from "../constants";
import { ESTIMATE_ITEMS_MASTER } from "@/lib/mock-data";
import { getDivisionCode } from "../division";
import type { RateCardEntry } from "@/types/db";

const TEMPLATE = "Company_Estimate_Template.xlsx";

const entry = (
  lineCode: string,
  rate: number,
  source: RateCardEntry["source"] = "seed",
): RateCardEntry => ({ templateName: TEMPLATE, lineCode, rate, source });

/** The rate-bearing constants lines = exactly the rows the seed/card carries. */
function rateBearingCodes(): string[] {
  const candidates: { code: string; rate: number | null }[] = [
    ...STAFF_ROLE_DEFAULTS.map((r) => ({ code: r.code, rate: r.defaultRate })),
    ...OPERATIONAL_EXPENSE_DEFAULTS.map((r) => ({ code: r.code, rate: r.rate })),
    ...GC_MANUAL_DEFAULTS.map((r) => ({ code: r.code, rate: r.rate })),
    ...SITE_OPS_DYNAMIC_DEFAULTS.map((r) => ({ code: r.code, rate: r.rate })),
    ...SITE_OPS_MANUAL_DEFAULTS.map((r) => ({ code: r.code, rate: r.rate })),
  ];
  return candidates
    .filter((c) => typeof c.rate === "number" && Number.isFinite(c.rate) && c.rate >= 0)
    .map((c) => c.code);
}

describe("Rate-card Phase C — editor join (card row → constants line def)", () => {
  it("every rate-bearing constants line has a line def (the card can always render)", () => {
    for (const code of rateBearingCodes()) {
      expect(RATE_LINE_DEFS.has(code), `missing line def for ${code}`).toBe(true);
    }
  });

  it("staff lines join to the staff section and render as hourly", () => {
    const exDef = RATE_LINE_DEFS.get("01-0310.001");
    expect(exDef).toMatchObject({ label: "Project Executive", unit: "hr", sectionId: STAFF_SECTION_ID });
  });

  it("a Site Ops line joins to its template subtotal section", () => {
    const safetyDef = RATE_LINE_DEFS.get("02-9015.001"); // Safety, 02.A
    expect(safetyDef).toMatchObject({ label: "Safety", unit: "mo", sectionId: "siteOperations" });
  });
});

describe("Rate-card Phase C — groupRateCardRows", () => {
  it("groups rows by section in RATE_SECTION_ORDER order, omitting empties", () => {
    const rows = [
      entry("02-9015.001", 500), // Site Ops — siteOperations
      entry("01-0310.001", 175), // staff
      entry("01-1000.001", 500), // GC operational
    ];
    const groups = groupRateCardRows(rows);
    const ids = groups.map((g) => g.id);

    // Present sections appear in the canonical order (staff before GC before Site Ops).
    expect(ids).toEqual([STAFF_SECTION_ID, "operational", "siteOperations"]);
    // Order matches the declared RATE_SECTION_ORDER subsequence.
    const orderIndex = (id: string) => RATE_SECTION_ORDER.findIndex((s) => s.id === id);
    expect(orderIndex("operational")).toBeLessThan(orderIndex("siteOperations"));
  });

  it("surfaces a card row with no matching constants line instead of dropping it", () => {
    const groups = groupRateCardRows([entry("99-9999.999", 42, "manual")]);
    const unmatched = groups.find((g) => g.id === "__unmatched__");
    expect(unmatched).toBeDefined();
    expect(unmatched!.rows).toHaveLength(1);
    expect(unmatched!.rows[0].def).toBeNull();
    expect(unmatched!.rows[0].entry.lineCode).toBe("99-9999.999");
  });

  it("no real seeded code lands in the unmatched group", () => {
    const groups = groupRateCardRows(rateBearingCodes().map((c) => entry(c, 1)));
    expect(groups.find((g) => g.id === "__unmatched__")).toBeUndefined();
  });
});

describe("Rate-card Phase C — parseRateInput (UI gate mirrors db.ts finite >= 0)", () => {
  it("accepts a positive number, zero, and a decimal", () => {
    expect(parseRateInput("150")).toBe(150);
    expect(parseRateInput("0")).toBe(0);
    expect(parseRateInput("12.5")).toBe(12.5);
    expect(parseRateInput("  99  ")).toBe(99); // trims
  });

  it("rejects empty, negative, non-numeric, and non-finite input", () => {
    expect(parseRateInput("")).toBeNull();
    expect(parseRateInput("   ")).toBeNull();
    expect(parseRateInput("-1")).toBeNull();
    expect(parseRateInput("abc")).toBeNull();
    expect(parseRateInput("Infinity")).toBeNull();
  });
});

// ===========================================================================
// Slice 2 Phase C — catalog (STEP 4 unit prices) section of the /rates editor
// ===========================================================================

describe("Slice 2 Phase C — catalog join completeness", () => {
  it("every catalog itemId has a line def tagged 'catalog' in a known section", () => {
    const knownSectionIds = new Set(RATE_SECTION_ORDER.map((s) => s.id));
    for (const item of Object.values(ESTIMATE_ITEMS_MASTER)) {
      const def = RATE_LINE_DEFS.get(item.itemId);
      expect(def, `missing line def for catalog itemId ${item.itemId}`).toBeDefined();
      expect(def!.kind, `wrong kind for ${item.itemId}`).toBe("catalog");
      expect(def!.label).toBe(item.description);
      expect(def!.unit).toBe(item.targetUom);
      expect(
        knownSectionIds.has(def!.sectionId),
        `catalog itemId ${item.itemId} has unknown section ${def!.sectionId}`,
      ).toBe(true);
    }
  });

  it("no seeded catalog itemId lands in the Unmatched group", () => {
    const rows = Object.values(ESTIMATE_ITEMS_MASTER).map((i) => entry(i.itemId, 1));
    const groups = groupRateCardRows(rows);
    expect(groups.find((g) => g.id === "__unmatched__")).toBeUndefined();
  });
});

describe("Slice 2 Phase C — division grouping order", () => {
  it("all GC/Site Ops sections precede every catalog division section", () => {
    const ids = RATE_SECTION_ORDER.map((s) => s.id);
    const firstCatalog = ids.findIndex((id) => id.startsWith(CATALOG_SECTION_PREFIX));
    const lastGc = ids.reduce(
      (acc, id, i) => (id.startsWith(CATALOG_SECTION_PREFIX) ? acc : i),
      -1,
    );
    expect(firstCatalog).toBeGreaterThan(-1); // catalog sections exist
    expect(lastGc).toBeLessThan(firstCatalog); // every GC id comes before the first catalog id
  });

  it("catalog division sections are ordered by CSI division ascending", () => {
    const catalogIds = RATE_SECTION_ORDER.map((s) => s.id).filter((id) =>
      id.startsWith(CATALOG_SECTION_PREFIX),
    );
    const divisions = catalogIds.map((id) => id.slice(CATALOG_SECTION_PREFIX.length));
    expect(divisions).toEqual([...divisions].sort());
  });

  it("groups a GC row before a catalog row", () => {
    const groups = groupRateCardRows([
      entry("03-0000.001", 5), // a catalog itemId (division 03)
      entry("01-0310.001", 175), // staff (GC/Site Ops)
    ]);
    const ids = groups.map((g) => g.id);
    expect(ids.indexOf(STAFF_SECTION_ID)).toBeLessThan(
      ids.indexOf(`${CATALOG_SECTION_PREFIX}03`),
    );
  });
});

describe("Slice 2 Phase C — parseRateInput per-kind gate", () => {
  it("accepts negatives and zero for catalog (allowNegative)", () => {
    expect(parseRateInput("-2", { allowNegative: true })).toBe(-2);
    expect(parseRateInput("0", { allowNegative: true })).toBe(0);
    expect(parseRateInput("0.001", { allowNegative: true })).toBe(0.001);
  });

  it("still rejects negatives by default (GC/Site Ops) but keeps zero", () => {
    expect(parseRateInput("-2")).toBeNull();
    expect(parseRateInput("0")).toBe(0);
  });

  it("rejects non-finite even when negatives are allowed", () => {
    expect(parseRateInput("Infinity", { allowNegative: true })).toBeNull();
    expect(parseRateInput("-Infinity", { allowNegative: true })).toBeNull();
    expect(parseRateInput("abc", { allowNegative: true })).toBeNull();
  });
});

describe("Slice 2 Phase C — 02-4100.002 catalog precedence (no double-listing)", () => {
  it("classifies the dual-use code as catalog in its division group, not GC", () => {
    const def = RATE_LINE_DEFS.get("02-4100.002");
    expect(def).toBeDefined();
    expect(def!.kind).toBe("catalog");
    expect(def!.sectionId).toBe(`${CATALOG_SECTION_PREFIX}${getDivisionCode("02-4100.002")}`);
    expect(def!.sectionId).toBe(`${CATALOG_SECTION_PREFIX}02`);
  });

  it("lists the dual-use card row exactly once, in its catalog division group", () => {
    const groups = groupRateCardRows([entry("02-4100.002", 0)]);
    const containing = groups.filter((g) =>
      g.rows.some((r) => r.entry.lineCode === "02-4100.002"),
    );
    expect(containing).toHaveLength(1);
    expect(containing[0].id).toBe(`${CATALOG_SECTION_PREFIX}02`);
    expect(containing[0].rows.find((r) => r.entry.lineCode === "02-4100.002")!.def!.kind).toBe(
      "catalog",
    );
  });
});
