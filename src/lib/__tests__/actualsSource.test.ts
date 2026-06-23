/**
 * The normalization engine consumes a {@link ActualsSource}, not files — this
 * verifies the CSV source is swappable (a future Procore-API source plugs into
 * the same interface) and that the engine output is identical regardless of
 * which source produced the raw bundle.
 */
import { describe, it, expect } from "vitest";
import {
  CsvActualsSource,
  computeNormalizedActuals,
  type ActualsSource,
  type RawActualsExport,
} from "@/lib/actuals";
import { loadActualsPayloads, loadActualsSource } from "./actualsFixtures";

describe("ActualsSource contract", () => {
  it("CsvActualsSource reports its kind and yields a parsed bundle", async () => {
    const src = loadActualsSource();
    expect(src.kind).toBe("csv");
    const raw = await src.loadRawExport();
    expect(raw.budget.length).toBe(130);
    expect(raw.changeEventSummary.length).toBe(162);
    expect(raw.changeEventDetail.length).toBe(555);
    expect(raw.subcontractorCommitments.length).toBeGreaterThan(0);
  });

  it("supplementary CSVs are optional (absent payloads → empty arrays)", async () => {
    const p = loadActualsPayloads();
    const minimal = new CsvActualsSource({
      budgetCsv: p.budgetCsv,
      changeEventSummaryCsv: p.changeEventSummaryCsv,
      changeEventDetailCsv: p.changeEventDetailCsv,
    });
    const raw = await minimal.loadRawExport();
    expect(raw.potentialChangeOrders).toEqual([]);
    expect(raw.primeContractChangeOrders).toEqual([]);
    expect(raw.subcontractorCommitments).toEqual([]);
    // The core three still drive a full normalization.
    const result = computeNormalizedActuals(raw);
    expect(result.codeActuals.length).toBe(130);
  });

  it("the engine is source-agnostic — any ActualsSource impl produces the same totals", async () => {
    // A trivial in-memory source standing in for a future API source.
    const bundle = await loadActualsSource().loadRawExport();
    const fakeApiSource: ActualsSource = {
      kind: "fake-api",
      loadRawExport: async (): Promise<RawActualsExport> => bundle,
    };
    const fromCsv = computeNormalizedActuals(await loadActualsSource().loadRawExport());
    const fromApi = computeNormalizedActuals(await fakeApiSource.loadRawExport());
    expect(fromApi.grandTotalActual).toBe(fromCsv.grandTotalActual);
    expect(fromApi.grandNormalizedActual).toBe(fromCsv.grandNormalizedActual);
  });
});
