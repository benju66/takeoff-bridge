/**
 * Evaluator calibration golden (Phase 3, locked decision 4) — LOCAL ONLY.
 *
 * Runs the in-repo formula evaluator over REAL finished bids (gitignored
 * fixtures) and compares every supported formula cell against Excel's own
 * cached result. Excel computed those caches, so agreement proves the
 * evaluator's semantics match genuine Excel — the emitter and the evaluator
 * cannot share a blind spot. The CI-safe twin is
 * golden-roundtrip-recalc.test.ts (synthetic inputs, committed template).
 *
 * Skips cleanly (`describe.skipIf`) on machines without the fixtures
 * (CI, other laptops) — same pattern as golden-care / golden-mckenna.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  loadWorkbookModel,
  FormulaEvaluator,
  UnsupportedFormulaError,
} from "../lib/formulaEvaluator";

function firstExisting(candidates: (string | undefined)[]): string | null {
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) return c;
    } catch {
      /* ignore unreadable candidate */
    }
  }
  return null;
}

const FIXTURES = [
  {
    name: "CARE",
    file: firstExisting([
      process.env.TAKEOFF_PAST_BID_XLSX,
      path.resolve(__dirname, "../../fixtures/past-bids/2026.04.03 CARE Schematic Design Estimate.LIVE.xlsx"),
    ]),
  },
  {
    name: "McKenna",
    file: firstExisting([
      process.env.TAKEOFF_GOLDEN_XLSX,
      path.resolve(__dirname, "../../fixtures/golden/McKenna-Crossing-Estimate.xlsx"),
      "C:\\Users\\BUrness\\takeoff-bridge-fixtures\\McKenna-Crossing-Estimate.xlsx",
    ]),
  },
].filter((f): f is { name: string; file: string } => Boolean(f.file));

const SHEETS = ["STEP 1 - PROJECT DATA", "STEP 2 - GCs", "STEP 3 - SITE OPS", "STEP 4 - ESTIMATE"];

// Absolute dollars-and-cents floor; relative term covers big-number float
// accumulation differences (SUM order etc.).
function withinTolerance(evaluated: number, cached: number): boolean {
  return Math.abs(evaluated - cached) <= Math.max(0.01, Math.abs(cached) * 1e-7);
}

describe.skipIf(FIXTURES.length === 0)("evaluator ↔ Excel cached-result calibration (real bids)", () => {
  it.each(FIXTURES)("$name: every supported formula cell ties Excel's own cached value", async ({ name, file }) => {
    const model = await loadWorkbookModel(fs.readFileSync(file));
    const evaluator = new FormulaEvaluator(model);

    let compared = 0;
    let skippedUnsupported = 0;
    let skippedOther = 0;
    const mismatches: string[] = [];

    for (const sheet of SHEETS) {
      const cells = model.get(sheet);
      expect(cells, `${name}: sheet "${sheet}"`).toBeDefined();
      for (const [ref, cell] of cells!) {
        if (!cell.f || cell.v === undefined) continue;
        let evaluated: number | string | boolean;
        try {
          evaluated = evaluator.evaluateFormula(cell.f, sheet);
        } catch (e) {
          if (e instanceof UnsupportedFormulaError) skippedUnsupported++;
          else skippedOther++; // e.g. chains into an unsupported/errored cell
          continue;
        }
        if (typeof cell.v === "number" && typeof evaluated === "number") {
          compared++;
          if (!withinTolerance(evaluated, cell.v)) {
            mismatches.push(`${sheet}!${ref} "=${cell.f}" → ${evaluated} vs Excel ${cell.v}`);
          }
        } else if (typeof cell.v === "boolean" && typeof evaluated === "boolean") {
          compared++;
          if (evaluated !== cell.v) {
            mismatches.push(`${sheet}!${ref} "=${cell.f}" → ${String(evaluated)} vs Excel ${String(cell.v)}`);
          }
        }
        // string-cached formulas (labels etc.) stay out of scope
      }
    }

    // Loud, specific failure: any disagreement with genuine Excel is an
    // evaluator semantics bug (or a stale cache worth knowing about).
    expect(mismatches, `${name} mismatches:\n${mismatches.slice(0, 20).join("\n")}`).toEqual([]);
    // The calibration must actually cover the grammar, not skip everything.
    expect(compared, `${name}: compared=${compared} unsupported=${skippedUnsupported} other=${skippedOther}`).toBeGreaterThan(200);
  }, 120000);
});
