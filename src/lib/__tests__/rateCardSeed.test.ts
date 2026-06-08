import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  STAFF_ROLE_DEFAULTS,
  OPERATIONAL_EXPENSE_DEFAULTS,
  GC_MANUAL_DEFAULTS,
  SITE_OPS_DYNAMIC_DEFAULTS,
  SITE_OPS_MANUAL_DEFAULTS,
} from "../constants";

// ---------------------------------------------------------------------------
// Drift guard for the rate_card seed (Rate-card slice 1, Phase A): the
// committed supabase_seed_rate_card.sql MUST exactly match the rate-bearing
// GC/Site Ops default lines in constants.ts — same codes, same rates, no
// lump-sum/qty-rate (null-rate) lines leaking in, no duplicate line_codes.
// If constants change, regenerate with `npm run generate-rate-card-seed`.
//
// This is the day-one invariant in repo form: seed == constants, so nothing
// changes value when the card goes live.
// ---------------------------------------------------------------------------

const SEED_PATH = path.resolve(__dirname, "../../../supabase_seed_rate_card.sql");
const SEED_ROW_RE =
  /\('Company_Estimate_Template\.xlsx', '([^']+)', ([0-9.]+), 'seed'\)/g;

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
  it("seed rows exactly match the rate-bearing constants lines (codes + rates)", () => {
    const expected = expectedRateBearing();
    const seed = parseSeed();

    expect(seed.size).toBe(expected.size);
    for (const [code, rate] of expected) {
      expect(seed.get(code), `missing/mismatched seed row for ${code}`).toBe(rate);
    }
  });

  it("contains exactly 44 rate-bearing GC/Site Ops lines", () => {
    expect(parseSeed().size).toBe(44);
  });

  it("contains no null-rate (lump-sum / qty-rate) lines", () => {
    const seed = parseSeed();
    const nullCodes = nullRateCodes();
    expect(nullCodes.size).toBeGreaterThan(0); // sanity: such lines exist
    for (const code of nullCodes) {
      expect(seed.has(code), `null-rate line leaked into seed: ${code}`).toBe(false);
    }
  });

  it("every seeded rate is a finite number >= 0", () => {
    for (const [code, rate] of parseSeed()) {
      expect(Number.isFinite(rate), `${code} rate not finite`).toBe(true);
      expect(rate, `${code} rate negative`).toBeGreaterThanOrEqual(0);
    }
  });
});
