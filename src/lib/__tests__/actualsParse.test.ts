import { describe, it, expect } from "vitest";
import {
  parseBudgetDetail,
  parseChangeEventSummary,
  parseChangeEventDetail,
  parsePotentialChangeOrders,
  parsePrimeContractChangeOrders,
  parseSubcontractorCommitments,
} from "@/lib/actuals";
import { readActualsCsv } from "./actualsFixtures";

describe("parseBudgetDetail (real export)", () => {
  const rows = parseBudgetDetail(readActualsCsv("budget"));

  it("skips the leading blank/None row and keeps every code row", () => {
    // 131 data lines − 1 blank (None,None,None) row = 130 grain rows.
    expect(rows.length).toBe(130);
    expect(rows.every((r) => r.costCode !== "")).toBe(true);
  });

  it("parses the grain key, cost type, and EAC for a known Labor row", () => {
    const srPm = rows.find((r) => r.budgetCode === "1-10320.000.Labor");
    expect(srPm).toBeDefined();
    expect(srPm!.costType).toBe("Labor");
    expect(srPm!.originalBudget).toBe(303966);
    expect(srPm!.estimatedCostAtCompletion).toBe(305640);
  });

  it("derives a Budget Code that matches Procore's own column form", () => {
    const concrete = rows.find((r) => r.costCode === "32-321613.000");
    expect(concrete!.budgetCode).toBe("32-321613.000.Subcontract");
  });
});

describe("parseChangeEventSummary (real export)", () => {
  const rows = parseChangeEventSummary(readActualsCsv("changeEventSummary"));

  it("parses all 162 events including the three INT reclasses", () => {
    expect(rows.length).toBe(162);
    expect(rows.some((r) => r.eventId === "INT-001")).toBe(true);
    expect(rows.some((r) => r.eventId === "INT-002")).toBe(true);
    expect(rows.some((r) => r.eventId === "INT-003")).toBe(true);
  });

  it("canonicalizes a savings allowance reconcile (event 3, Fire Pump Credit)", () => {
    const e3 = rows.find((r) => r.eventId === "3");
    expect(e3!.type).toBe("Allowance");
    expect(e3!.reason).toBe("Allowance");
    expect(e3!.rom).toBe(-54500);
  });

  it("canonicalizes inconsistent reason/scope casing", () => {
    const e162 = rows.find((r) => r.eventId === "162");
    expect(e162!.scope).toBe("In Scope");
    expect(e162!.type).toBe("FP Contingency/Buyout");
    expect(e162!.reason).toBe("FP Construction"); // raw was "Fp construction"
  });
});

describe("parseChangeEventDetail (real export)", () => {
  const rows = parseChangeEventDetail(readActualsCsv("changeEventDetail"));

  it("parses every detail line and canonicalizes the zero-padded event ids", () => {
    expect(rows.length).toBe(555);
    // Detail zero-pads to 3 digits — canonical id must drop the padding.
    expect(rows.some((r) => r.rawId === "097" && r.eventId === "97")).toBe(true);
  });

  it("reads the Fee/GL burden lines on the revenue side with zero cost", () => {
    const fee162 = rows.find(
      (r) => r.eventId === "162" && r.costCode === "60-604000.000",
    );
    expect(fee162!.latestCost).toBe(0);
    expect(fee162!.latestPrice).toBe(25.43);
  });

  it("reads a direct-cost line's Latest Cost", () => {
    const fec = rows.find(
      (r) => r.eventId === "162" && r.costCode === "10-104413.000",
    );
    expect(fec!.latestCost).toBe(726.63);
  });

  it("preserves blank-code detail lines (event 154) for diagnostics", () => {
    const blank154 = rows.filter((r) => r.eventId === "154" && r.costCode === "");
    expect(blank154.length).toBeGreaterThan(0);
  });
});

describe("supplementary exports parse without error", () => {
  it("potential change orders", () => {
    const rows = parsePotentialChangeOrders(readActualsCsv("potentialChangeOrders"));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.number === "015" && r.amount === -150000)).toBe(true);
  });

  it("prime contract change orders", () => {
    const rows = parsePrimeContractChangeOrders(
      readActualsCsv("primeContractChangeOrders"),
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it("subcontractor commitments carry the embedded project token", () => {
    const rows = parseSubcontractorCommitments(
      readActualsCsv("subcontractorCommitments"),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.projectNumber === "25-117")).toBe(true);
    expect(rows.some((r) => r.projectName === "Orchard Path III")).toBe(true);
  });
});
