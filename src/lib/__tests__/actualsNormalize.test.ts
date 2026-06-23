import { describe, it, expect, beforeAll } from "vitest";
import {
  computeNormalizedActuals,
  type NormalizedActuals,
  type RawActualsExport,
} from "@/lib/actuals";
import { loadActualsSource } from "./actualsFixtures";

let raw: RawActualsExport;
let result: NormalizedActuals;

beforeAll(async () => {
  raw = await loadActualsSource().loadRawExport();
  result = computeNormalizedActuals(raw);
});

describe("change-event join (canonical id)", () => {
  it("joins every detail event to its summary — none orphaned by id padding", () => {
    expect(result.diagnostics.unjoinedDetailEventIds).toEqual([]);
  });

  it("classifies all 162 events", () => {
    expect(result.events.length).toBe(162);
  });

  it("the id-canonicalization actually mattered (097 ↔ 97 joined, not unclassified)", () => {
    const e97 = result.events.find((e) => e.eventId === "97");
    expect(e97).toBeDefined();
    // If the join had failed, scope/type would be Unclassified.
    expect(e97!.scope).toBe("In Scope");
    expect(e97!.type).toBe("FP Contingency/Buyout");
  });
});

describe("duplicate tolerance", () => {
  it("suppresses the 97/98 duplicate (identical −$41,476.26 cost fingerprint)", () => {
    const groups = result.diagnostics.duplicateEventGroups;
    const insulationDup = groups.find(
      (g) => g.keptEventId === "98" || g.suppressedEventIds.includes("97"),
    );
    expect(insulationDup).toBeDefined();
    expect(insulationDup!.keptEventId).toBe("98");
    expect(insulationDup!.suppressedEventIds).toContain("97");
    expect(result.events.find((e) => e.eventId === "97")!.isDuplicate).toBe(true);
    expect(result.events.find((e) => e.eventId === "98")!.isDuplicate).toBe(false);
  });

  it("does NOT treat same-title-but-different-amount events as duplicates (79 vs 72)", () => {
    // Both "Additional Build Wrap" but $6,922.16 vs $4,865.63 — distinct.
    const e79 = result.events.find((e) => e.eventId === "79");
    const e72 = result.events.find((e) => e.eventId === "72");
    expect(e79!.isDuplicate).toBe(false);
    expect(e72!.isDuplicate).toBe(false);
  });
});

describe("internal reclass netting", () => {
  it("cancels net-zero internal reclasses (INT-001, INT-003)", () => {
    const int1 = result.events.find((e) => e.eventId === "INT-001")!;
    const int3 = result.events.find((e) => e.eventId === "INT-003")!;
    expect(int1.bucket).toBe("internal_reclass");
    expect(int1.isNormalizedOut).toBe(true);
    expect(Math.abs(int1.netLatestCost)).toBeLessThan(0.01);
    expect(int3.bucket).toBe("internal_reclass");
    expect(Math.abs(int3.netLatestCost)).toBeLessThan(0.01);
  });

  it("keeps + flags a non-net-zero internal event (INT-002, +$15,000)", () => {
    const int2 = result.events.find((e) => e.eventId === "INT-002")!;
    expect(int2.bucket).toBe("internal_nonzero");
    expect(int2.isNormalizedOut).toBe(false);
    expect(int2.netLatestCost).toBe(15000);
    expect(result.diagnostics.internalNonZeroEventIds).toContain("INT-002");
  });
});

describe("per-code actuals", () => {
  it("totalActual for each code equals its budget EAC", () => {
    const byKey = new Map(raw.budget.map((b) => [b.budgetCode, b]));
    for (const c of result.codeActuals) {
      const b = byKey.get(c.budgetCode);
      if (!b) continue; // synthetic code (none expected in this dataset)
      expect(c.totalActual).toBeCloseTo(b.estimatedCostAtCompletion, 2);
    }
  });

  it("produces one code per budget grain (no synthetic codes in this dataset)", () => {
    expect(result.codeActuals.length).toBe(130);
  });

  it("normalizedActual never exceeds totalActual for an out-stripped code", () => {
    // Stripping owner/oos/allowance/reclass dollars only removes value.
    const totalNorm = result.codeActuals.reduce((s, c) => s + c.normalizedActual, 0);
    const totalAll = result.codeActuals.reduce((s, c) => s + c.totalActual, 0);
    expect(totalNorm).toBeLessThanOrEqual(totalAll + 0.01);
  });
});

describe("Fee / GL burden split", () => {
  it("flags exactly the Fee and GL insurance codes as burden", () => {
    const burden = result.codeActuals.filter((c) => c.isBurden);
    const codes = burden.map((c) => c.costCode).sort();
    expect(codes).toEqual(["60-602020.000", "60-604000.000"]);
  });

  it("direct + burden reconciles to the grand total", () => {
    expect(result.directTotalActual + result.burdenTotalActual).toBeCloseTo(
      result.grandTotalActual,
      2,
    );
  });
});

describe("savings tolerated end to end", () => {
  it("a code receiving a negative CO keeps the credit (no sign flip)", () => {
    // Event 38 deducts a $150,000 light-fixture allowance (In Scope, Allowance → OUT).
    // Its detail line carries a negative Latest Cost; normalization adds it back.
    const e38 = result.events.find((e) => e.eventId === "38")!;
    expect(e38.bucket).toBe("allowance_reconcile");
    expect(e38.netLatestCost).toBeLessThan(0);
  });
});
