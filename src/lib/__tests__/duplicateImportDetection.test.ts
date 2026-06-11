/**
 * Database fidelity Phase 1 — capture fields + advisory duplicate-import
 * detection (pure logic only; the banner that consumes this never blocks).
 */
import { describe, it, expect } from "vitest";
import {
  normalizeProjectName,
  findLikelyDuplicateImports,
  projectFromExtract,
} from "@/lib/importEstimate";
import type { ExtractedEstimate } from "@/lib/templateExtractor";
import type { Project } from "@/types/db";

const makeProject = (overrides: Partial<Project>): Project => ({
  id: "p-1",
  name: "Maple Court Apartments",
  location: "",
  squareFootage: 0,
  unitCount: 0,
  bidDate: "2025-03-14",
  createdAt: "2026-06-01T12:00:00.000Z",
  ...overrides,
});

describe("normalizeProjectName", () => {
  it("lowercases, strips punctuation, and collapses whitespace", () => {
    expect(normalizeProjectName("The Marquee — Phase 2")).toBe("the marquee phase 2");
    expect(normalizeProjectName("  MAPLE   Court,  Apts.  ")).toBe("maple court apts");
  });

  it("returns '' for blank or punctuation-only names", () => {
    expect(normalizeProjectName("")).toBe("");
    expect(normalizeProjectName(" —— ")).toBe("");
  });
});

describe("findLikelyDuplicateImports", () => {
  const existing = [
    makeProject({ id: "p-1", name: "Maple Court Apartments", bidDate: "2025-03-14" }),
    makeProject({ id: "p-2", name: "Riverside Medical TI", bidDate: "2024-11-02" }),
  ];

  it("matches on normalized name regardless of case/punctuation", () => {
    const matches = findLikelyDuplicateImports("maple court — apartments!", "", existing);
    expect(matches).toHaveLength(1);
    expect(matches[0].projectId).toBe("p-1");
    expect(matches[0].projectName).toBe("Maple Court Apartments");
    expect(matches[0].importedAt).toBe("2026-06-01T12:00:00.000Z");
  });

  it("grades the match with sameBidDate when both dates agree", () => {
    const same = findLikelyDuplicateImports("Maple Court Apartments", "2025-03-14", existing);
    expect(same[0].sameBidDate).toBe(true);

    const different = findLikelyDuplicateImports("Maple Court Apartments", "2025-06-01", existing);
    expect(different[0].sameBidDate).toBe(false);
  });

  it("never claims sameBidDate when either date is blank", () => {
    const blankIncoming = findLikelyDuplicateImports("Maple Court Apartments", "", existing);
    expect(blankIncoming[0].sameBidDate).toBe(false);

    const blankExisting = findLikelyDuplicateImports(
      "Maple Court Apartments",
      "2025-03-14",
      [makeProject({ bidDate: "" })]
    );
    expect(blankExisting[0].sameBidDate).toBe(false);
  });

  it("returns no matches for different names or a blank incoming name", () => {
    expect(findLikelyDuplicateImports("Brand New Tower", "2025-03-14", existing)).toHaveLength(0);
    // A blank name must never match everything.
    expect(findLikelyDuplicateImports("", "", [makeProject({ name: "" })])).toHaveLength(0);
  });
});

describe("projectFromExtract — capture fields (bidOutcome / deliveryMethod)", () => {
  // projectFromExtract only reads `inputs`; the minimal shape is enough here.
  const extracted = {
    inputs: {
      projectName: "Maple Court Apartments",
      squareFootage: 10_000,
      unitCount: 12,
      startDate: "",
      finishDate: "",
      rates: {
        constructionContingencyRate: 0,
        designContingencyRate: 0,
        buildersRiskRate: 0,
        specialInsuranceRate: 0,
        glInsuranceRate: 0.01,
        bondRate: 0,
        feeRate: 0.05,
      },
    },
  } as unknown as ExtractedEstimate;

  it("defaults both capture fields to 'unknown' (an honest answer, never blank)", () => {
    const project = projectFromExtract(extracted, { id: "x" });
    expect(project.bidOutcome).toBe("unknown");
    expect(project.deliveryMethod).toBe("unknown");
  });

  it("carries the estimator's answers through to the Project", () => {
    const project = projectFromExtract(extracted, {
      id: "x",
      bidOutcome: "won",
      deliveryMethod: "gmp",
    });
    expect(project.bidOutcome).toBe("won");
    expect(project.deliveryMethod).toBe("gmp");
  });
});
