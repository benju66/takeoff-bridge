import { describe, it, expect } from "vitest";
import {
  groupRateCardRows,
  parseRateInput,
  RATE_LINE_DEFS,
  RATE_SECTION_ORDER,
  STAFF_SECTION_ID,
} from "../rateCardEditor";
import {
  STAFF_ROLE_DEFAULTS,
  OPERATIONAL_EXPENSE_DEFAULTS,
  GC_MANUAL_DEFAULTS,
  SITE_OPS_DYNAMIC_DEFAULTS,
  SITE_OPS_MANUAL_DEFAULTS,
} from "../constants";
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
