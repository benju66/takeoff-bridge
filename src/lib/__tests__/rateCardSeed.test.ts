import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import ESTIMATE_CATALOG from "../estimate-catalog.json";
import {
  STAFF_ROLE_DEFAULTS,
  OPERATIONAL_EXPENSE_DEFAULTS,
  GC_MANUAL_DEFAULTS,
  SITE_OPS_DYNAMIC_DEFAULTS,
  SITE_OPS_MANUAL_DEFAULTS,
} from "../constants";

// ---------------------------------------------------------------------------
// Drift guard for the GC/Site Ops slice of the rate_card seed (Rate-card
// slice 1, Phase A): the committed supabase_seed_rate_card.sql MUST contain
// every rate-bearing GC/Site Ops default line in constants.ts — same codes,
// same rates, no lump-sum/qty-rate (null-rate) lines leaking in, no duplicate
// line_codes. If constants change, regenerate with
// `npm run generate-rate-card-seed`.
//
// NOTE (Slice 2, Phase A): the same seed file now ALSO carries the 221 catalog
// rows (src/lib/estimate-catalog.json) — see catalogRateSeed.test.ts. This
// suite therefore scopes its assertions to the GC/Site Ops subset (the catalog
// keys are disjoint), rather than asserting the total row count.
//
// This is the day-one invariant in repo form: GC/Site Ops seed == constants,
// so nothing changes value when the card goes live.
// ---------------------------------------------------------------------------

const SEED_PATH = path.resolve(__dirname, "../../../supabase_seed_rate_card.sql");
// `-?` so catalog negatives (e.g. 03-5413.002 = -2) parse too — they belong to
// the catalog slice but share the same row syntax.
const SEED_ROW_RE =
  /\('Company_Estimate_Template\.xlsx', '([^']+)', (-?[0-9.]+), 'seed'\)/g;

/** Rebuild the expected { code → rate } using the generator's own selection logic. */
function expectedRateBearing(): Map<string, number> {
  const candidates: { code: string; rate: number | null }[] = [
    ...STAFF_ROLE_DEFAULTS.map((r) => ({ code: r.code, rate: r.defaultRate })),
    ...OPERATIONAL_EXPENSE_DEFAULTS.map((r) => ({ code: r.code, rate: r.rate })),
    ...GC_MANUAL_DEFAULTS.map((r) => ({ code: r.code, rate: r.rate })),
    ...SITE_OPS_DYNAMIC_DEFAULTS.map((r) => ({ code: r.code, rate: r.rate })),
    ...SITE_OPS_MANUAL_DEFAULTS.map((r) => ({ code: r.code, rate: r.rate })),
  ];
  const map = new Map<string, number>();
  for (const c of candidates) {
    if (typeof c.rate === "number" && Number.isFinite(c.rate) && c.rate >= 0) {
      map.set(c.code, c.rate);
    }
  }
  return map;
}

/** Codes whose lines carry NO rate (lumpSum / qtyRate) — must NOT appear in the seed. */
function nullRateCodes(): Set<string> {
  const out = new Set<string>();
  for (const r of [...GC_MANUAL_DEFAULTS, ...SITE_OPS_MANUAL_DEFAULTS]) {
    if (r.rate === null) out.add(r.code);
  }
  return out;
}

function parseSeed(): Map<string, number> {
  const sql = fs.readFileSync(SEED_PATH, "utf8");
  const map = new Map<string, number>();
  let m: RegExpExecArray | null;
  while ((m = SEED_ROW_RE.exec(sql)) !== null) {
    const code = m[1];
    expect(map.has(code), `duplicate line_code in seed: ${code}`).toBe(false);
    map.set(code, Number(m[2]));
  }
  return map;
}

describe("supabase_seed_rate_card.sql ↔ constants.ts rate-bearing lines", () => {
  it("every rate-bearing constants line appears in the seed with the right rate", () => {
    const expected = expectedRateBearing();
    const seed = parseSeed();

    for (const [code, rate] of expected) {
      expect(seed.get(code), `missing/mismatched seed row for ${code}`).toBe(rate);
    }
  });

  it("contains exactly 44 rate-bearing GC/Site Ops lines", () => {
    const expected = expectedRateBearing();
    expect(expected.size).toBe(44);

    const seed = parseSeed();
    const present = [...expected.keys()].filter((code) => seed.has(code));
    expect(present.length).toBe(44);
  });

  it("contains no GC null-rate (lump-sum / qty-rate) lines", () => {
    const seed = parseSeed();
    const nullCodes = nullRateCodes();
    // A GC null-rate code string may coincide with a catalog itemId (e.g.
    // 02-4100.002 "Demolition"), which the catalog source (Slice 2) seeds
    // legitimately. The GC invariant is only that GC did not emit a card row;
    // exclude catalog itemIds so the surviving codes are GC-only.
    const catalogIds = new Set(Object.keys(ESTIMATE_CATALOG));
    const gcOnlyNullCodes = [...nullCodes].filter((c) => !catalogIds.has(c));
    expect(gcOnlyNullCodes.length).toBeGreaterThan(0); // sanity: such lines exist
    for (const code of gcOnlyNullCodes) {
      expect(seed.has(code), `null-rate line leaked into seed: ${code}`).toBe(false);
    }
  });

  it("every seeded GC/Site Ops rate is a finite number >= 0", () => {
    const seed = parseSeed();
    for (const code of expectedRateBearing().keys()) {
      const rate = seed.get(code)!;
      expect(Number.isFinite(rate), `${code} rate not finite`).toBe(true);
      expect(rate, `${code} rate negative`).toBeGreaterThanOrEqual(0);
    }
  });
});
