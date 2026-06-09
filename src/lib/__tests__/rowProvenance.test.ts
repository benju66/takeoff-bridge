/**
 * Phase 5, slice 5 (5c.1) — row provenance badge (`rowProvenanceBadge`).
 *
 * Pure decision logic for the grid's item-id glyph. These tests assert the mapping
 * is TOTAL (every source + needsReview combination yields a defined badge — the
 * INV-7 provenance-completeness promise), that each source maps to its own kind,
 * and that needsReview takes visual priority (the ⚠ worklist signal).
 */

import { describe, it, expect } from "vitest";
import { rowProvenanceBadge } from "../rowProvenance";
import type { ProcessedTakeoffRow } from "@/types";

const SOURCES: NonNullable<ProcessedTakeoffRow["source"]>[] = [
  "template",
  "csv_import",
  "manual",
  "ai_suggestion",
];

describe("rowProvenanceBadge", () => {
  it("maps each concrete source to its own kind", () => {
    expect(rowProvenanceBadge({ source: "template" }).kind).toBe("template");
    expect(rowProvenanceBadge({ source: "csv_import" }).kind).toBe("imported");
    expect(rowProvenanceBadge({ source: "manual" }).kind).toBe("manual");
    expect(rowProvenanceBadge({ source: "ai_suggestion" }).kind).toBe("ai_suggestion");
  });

  it("returns a defined badge with a label + tooltip for every source", () => {
    for (const source of SOURCES) {
      const badge = rowProvenanceBadge({ source });
      expect(badge.label).toBeTruthy();
      expect(badge.tooltip).toBeTruthy();
    }
  });

  it("gives needsReview visual priority over the source", () => {
    for (const source of SOURCES) {
      expect(rowProvenanceBadge({ source, needsReview: true }).kind).toBe("needs_review");
    }
    // even with no source
    expect(rowProvenanceBadge({ needsReview: true }).kind).toBe("needs_review");
  });

  it("falls back to a template badge for an unset/unknown source (totality)", () => {
    expect(rowProvenanceBadge({}).kind).toBe("template");
    expect(rowProvenanceBadge({ source: undefined }).kind).toBe("template");
  });
});
