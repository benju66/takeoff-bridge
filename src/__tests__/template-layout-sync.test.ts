import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { MASTER_TEMPLATE_LAYOUT } from "./fixtures/templateLayout";

// ---------------------------------------------------------------------------
// Phase 3b drift guard: the canonical layout lives in TWO repo locations —
// the template_config seed in supabase_schema.sql (runtime source of truth,
// applied to the live DB) and the test fixture in fixtures/templateLayout.ts
// (what the exporter unit suite runs against). If they drift, tests keep
// passing against stale geometry while real exports corrupt. This test
// mechanically pins fixture === seed.
// ---------------------------------------------------------------------------

describe("template layout fixture ↔ supabase_schema.sql seed sync", () => {
  it("fixture exactly matches the template_config seed payload", () => {
    const schemaSql = fs.readFileSync(
      path.resolve(__dirname, "../../supabase_schema.sql"),
      "utf8"
    );

    // Extract the JSONB literal from the template_config seed INSERT
    const match = schemaSql.match(
      /INSERT INTO template_config[\s\S]*?'(\{[\s\S]*?\})'::jsonb/
    );
    expect(match, "template_config seed INSERT with '{...}'::jsonb payload not found in supabase_schema.sql").toBeTruthy();

    const seedConfig = JSON.parse(match![1]);
    expect(seedConfig).toEqual(MASTER_TEMPLATE_LAYOUT);
  });
});
