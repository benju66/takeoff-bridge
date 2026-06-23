import { describe, it, expect } from "vitest";
import {
  canonicalizeScope,
  canonicalizeType,
  canonicalizeReason,
  classifyChangeEvent,
} from "@/lib/actuals";

describe("canonicalize* (export casing variants)", () => {
  it("scope: blank and TBD collapse to Unclassified", () => {
    expect(canonicalizeScope("In Scope")).toBe("In Scope");
    expect(canonicalizeScope("Out of Scope")).toBe("Out of Scope");
    expect(canonicalizeScope("TBD")).toBe("Unclassified");
    expect(canonicalizeScope("")).toBe("Unclassified");
  });

  it("type: exact match, else Unclassified", () => {
    expect(canonicalizeType("FP Contingency/Buyout")).toBe("FP Contingency/Buyout");
    expect(canonicalizeType("Owner Contingency")).toBe("Owner Contingency");
    expect(canonicalizeType("Original Budget")).toBe("Original Budget");
    expect(canonicalizeType("Allowance")).toBe("Allowance");
    expect(canonicalizeType("")).toBe("Unclassified");
  });

  it("reason: keyword-folds the messy casing in the real file", () => {
    expect(canonicalizeReason("Internal (do not send to sub)")).toBe("Internal");
    expect(canonicalizeReason("Internal (DO NOT SEND TO SUB)")).toBe("Internal");
    expect(canonicalizeReason("Fp construction")).toBe("FP Construction");
    expect(canonicalizeReason("Arch/eng")).toBe("Arch/Eng");
    expect(canonicalizeReason("Owner request")).toBe("Owner Request");
    expect(canonicalizeReason("Winter conditions")).toBe("Winter Conditions");
    expect(canonicalizeReason("Ahj")).toBe("AHJ");
    expect(canonicalizeReason("Allowance")).toBe("Allowance");
    expect(canonicalizeReason("")).toBe("Unclassified");
  });
});

describe("classifyChangeEvent — normalization buckets", () => {
  it("in-scope FP Contingency/Buyout is KEPT (the buyout-variance signal)", () => {
    const d = classifyChangeEvent("In Scope", "FP Contingency/Buyout", "FP Construction");
    expect(d.bucket).toBe("fp_buyout");
    expect(d.isNormalizedOut).toBe(false);
  });

  it("in-scope Original Budget change is KEPT", () => {
    const d = classifyChangeEvent("In Scope", "Original Budget", "FP Construction");
    expect(d.bucket).toBe("original_budget");
    expect(d.isNormalizedOut).toBe(false);
  });

  it("Owner Contingency is normalized OUT", () => {
    const d = classifyChangeEvent("Out of Scope", "Owner Contingency", "Owner Request");
    expect(d.bucket).toBe("owner_contingency");
    expect(d.isNormalizedOut).toBe(true);
  });

  it("out-of-scope (non-owner) is normalized OUT", () => {
    const d = classifyChangeEvent("Out of Scope", "FP Contingency/Buyout", "FP Construction");
    expect(d.bucket).toBe("out_of_scope");
    expect(d.isNormalizedOut).toBe(true);
  });

  it("Allowance reconcile is normalized OUT", () => {
    const d = classifyChangeEvent("In Scope", "Allowance", "Allowance");
    expect(d.bucket).toBe("allowance_reconcile");
    expect(d.isNormalizedOut).toBe(true);
  });

  it("Internal reason routes to internal_reclass (engine applies net-zero test)", () => {
    const d = classifyChangeEvent("In Scope", "Original Budget", "Internal");
    expect(d.bucket).toBe("internal_reclass");
    expect(d.isNormalizedOut).toBe(true);
  });

  it("unclassified scope (TBD) is KEPT but flagged — never silently in/out", () => {
    const d = classifyChangeEvent("Unclassified", "FP Contingency/Buyout", "FP Construction");
    expect(d.bucket).toBe("unclassified");
    expect(d.isNormalizedOut).toBe(false);
  });

  it("Internal takes precedence over Out-of-Scope routing", () => {
    const d = classifyChangeEvent("Out of Scope", "Owner Contingency", "Internal");
    expect(d.bucket).toBe("internal_reclass");
  });
});
