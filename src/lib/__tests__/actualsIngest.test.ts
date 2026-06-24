/**
 * Phase 3 ingestion helpers: the pure bridge between dropped CSV files and the
 * ingestion UI. Exercised against the real `templates/` fixtures so header-
 * signature drift in a re-export is caught the same way the engine's golden test
 * catches column drift.
 */
import { describe, it, expect } from "vitest";
import {
  classifyActualsCsv,
  extractEmbeddedProjectToken,
  suggestProjectMatch,
  type RawActualsExport,
} from "@/lib/actuals";
import { readActualsCsv, loadActualsSource, ACTUALS_FILES } from "./actualsFixtures";

describe("classifyActualsCsv", () => {
  it("routes every real export fixture to its kind", () => {
    expect(classifyActualsCsv(readActualsCsv("budget"))).toBe("budget");
    expect(classifyActualsCsv(readActualsCsv("changeEventSummary"))).toBe(
      "changeEventSummary",
    );
    expect(classifyActualsCsv(readActualsCsv("changeEventDetail"))).toBe(
      "changeEventDetail",
    );
    expect(classifyActualsCsv(readActualsCsv("potentialChangeOrders"))).toBe(
      "potentialChangeOrders",
    );
    expect(classifyActualsCsv(readActualsCsv("primeContractChangeOrders"))).toBe(
      "primeContractChangeOrders",
    );
    expect(classifyActualsCsv(readActualsCsv("subcontractorCommitments"))).toBe(
      "subcontractorCommitments",
    );
  });

  it("disambiguates budget vs change-event detail (both carry `Budget Code`)", () => {
    // The shared `Budget Code` column must not decide either match.
    expect(classifyActualsCsv(readActualsCsv("budget"))).not.toBe(
      "changeEventDetail",
    );
    expect(classifyActualsCsv(readActualsCsv("changeEventDetail"))).not.toBe(
      "budget",
    );
  });

  it("returns null for an unrecognized / empty CSV", () => {
    expect(classifyActualsCsv("")).toBeNull();
    expect(classifyActualsCsv("foo,bar,baz\n1,2,3")).toBeNull();
  });

  it("tolerates a UTF-8 BOM on the first header column", () => {
    const bommed = String.fromCharCode(0xfeff) + readActualsCsv("budget");
    expect(classifyActualsCsv(bommed)).toBe("budget");
  });

  it("is the inverse of the slot it feeds — every fixture lands in a distinct slot", () => {
    const kinds = (Object.keys(ACTUALS_FILES) as (keyof typeof ACTUALS_FILES)[]).map(
      (k) => classifyActualsCsv(readActualsCsv(k)),
    );
    expect(new Set(kinds).size).toBe(kinds.length); // no two fixtures collide
    expect(kinds).not.toContain(null);
  });
});

describe("extractEmbeddedProjectToken", () => {
  it("reads the embedded 25-117 / Orchard Path III token from the real export", async () => {
    const raw = await loadActualsSource().loadRawExport();
    const token = extractEmbeddedProjectToken(raw);
    expect(token).not.toBeNull();
    expect(token!.projectNumber).toBe("25-117");
    expect(token!.projectName).toBe("Orchard Path III");
  });

  it("returns null when no subcontractor commitments carry a token", () => {
    const raw = { subcontractorCommitments: [] } as unknown as RawActualsExport;
    expect(extractEmbeddedProjectToken(raw)).toBeNull();
  });
});

describe("suggestProjectMatch", () => {
  const token = { projectNumber: "25-117", projectName: "Orchard Path III" };

  it("returns null when there is no token", () => {
    expect(suggestProjectMatch(null, [{ id: "a", name: "Anything" }])).toBeNull();
  });

  it("matches when the project NUMBER token appears in a project name", () => {
    const match = suggestProjectMatch(token, [
      { id: "p1", name: "Some Other Job" },
      { id: "p2", name: "25-117 Orchard Path III" },
    ]);
    expect(match).toEqual({
      projectId: "p2",
      projectName: "25-117 Orchard Path III",
      matchedOn: "number",
    });
  });

  it("matches on a normalized exact name when no number is embedded", () => {
    const match = suggestProjectMatch(
      { projectNumber: "", projectName: "Orchard Path III" },
      [{ id: "p3", name: "orchard   path  iii" }],
    );
    expect(match).toEqual({
      projectId: "p3",
      projectName: "orchard   path  iii",
      matchedOn: "name",
    });
  });

  it("matches on name containment in either direction", () => {
    const match = suggestProjectMatch(
      { projectNumber: "", projectName: "Orchard Path III" },
      [{ id: "p4", name: "Orchard Path III — Apple Valley Senior Housing" }],
    );
    expect(match?.projectId).toBe("p4");
    expect(match?.matchedOn).toBe("name");
  });

  it("prefers a number match over a name match", () => {
    const match = suggestProjectMatch(token, [
      { id: "name-hit", name: "Orchard Path III" },
      { id: "number-hit", name: "Job 25-117" },
    ]);
    // The number scan runs first; the explicit job code wins.
    expect(match?.projectId).toBe("number-hit");
    expect(match?.matchedOn).toBe("number");
  });

  it("returns null when nothing matches (never guesses)", () => {
    expect(
      suggestProjectMatch(token, [
        { id: "x", name: "Completely Unrelated Tower" },
      ]),
    ).toBeNull();
  });
});
