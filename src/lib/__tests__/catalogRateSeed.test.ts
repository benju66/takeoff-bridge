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
// Drift guard for the catalog slice of the rate_card seed (Rate-card slice 2,
// Phase A): the committed supabase_seed_rate_card.sql MUST carry one row per
// catalog itemId, rate = defaultUnitPrice, with NO finite-value filtering loss
// — $0, negative deductions (e.g. 03-5413.002 = -2), and the 0.001 placeholder
// all survive (the GC/Site Ops `>= 0` gate does NOT apply to catalog rows).
//
// This is the day-one invariant in repo form: catalog seed == today's
// estimate-catalog.json, so nothing changes value when the card goes live.
// The catalog keys are also verified disjoint from the 44 GC/Site Ops codes,
// so both coexist under PK (template_name, line_code).
// If estimate-catalog.json changes, regenerate with
// `npm run generate-rate-card-seed`.
// ---------------------------------------------------------------------------

const SEED_PATH = path.resolve(__dirname, "../../../supabase_seed_rate_card.sql");
// `-?` so catalog negatives parse — catalog prices may be legitimately < 0.
const SEED_ROW_RE =
  /\('Company_Estimate_Template\.xlsx', '([^']+)', (-?[0-9.]+), 'seed'\)/g;

type CatalogEntry = { itemId: string; defaultUnitPrice: number };
const CATALOG = ESTIMATE_CATALOG as Record<string, CatalogEntry>;

/** Every catalog itemId → defaultUnitPrice (all are finite — verified). */
function expectedCatalog(): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of Object.values(CATALOG)) {
    map.set(entry.itemId, entry.defaultUnitPrice);
  }
  return map;
}

/** The 44 GC/Site Ops rate-bearing codes (Slice 1) — used for the collision check. */
function gcSiteOpsCodes(): Set<string> {
  const candidates: { code: string; rate: number | null }[] = [
    ...STAFF_ROLE_DEFAULTS.map((r) => ({ code: r.code, rate: r.defaultRate })),
    ...OPERATIONAL_EXPENSE_DEFAULTS.map((r) => ({ code: r.code, rate: r.rate })),
    ...GC_MANUAL_DEFAULTS.map((r) => ({ code: r.code, rate: r.rate })),
    ...SITE_OPS_DYNAMIC_DEFAULTS.map((r) => ({ code: r.code, rate: r.rate })),
    ...SITE_OPS_MANUAL_DEFAULTS.map((r) => ({ code: r.code, rate: r.rate })),
  ];
  const out = new Set<string>();
  for (const c of candidates) {
    if (typeof c.rate === "number" && Number.isFinite(c.rate) && c.rate >= 0) {
      out.add(c.code);
    }
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

describe("supabase_seed_rate_card.sql ↔ estimate-catalog.json unit prices", () => {
  it("seeds all 227 catalog itemIds with the right defaultUnitPrice", () => {
    const expected = expectedCatalog();
    // 221 harvested + 6 architect-confirmed manual additions (2026-06-10).
    expect(expected.size).toBe(227);

    const seed = parseSeed();
    for (const [itemId, price] of expected) {
      expect(seed.get(itemId), `missing/mismatched catalog row for ${itemId}`).toBe(price);
    }
  });

  it("preserves $0, negative, and 0.001 placeholder rows (no >= 0 filter)", () => {
    const seed = parseSeed();
    // Negative deduction line is kept, not dropped.
    expect(seed.get("03-5413.002")).toBe(-2);
    // A known $0 line is kept.
    expect(seed.get("02-4100.002")).toBe(0);
    // 64 harvested $0 rows + the 6 manual additions (seeded at $0 — defaults
    // are set by humans on /rates, never invented) and 5 placeholder rows.
    const expected = expectedCatalog();
    const zeros = [...expected].filter(([, p]) => p === 0).length;
    const placeholders = [...expected].filter(([, p]) => p === 0.001).length;
    expect(zeros).toBe(70);
    expect(placeholders).toBe(5);
    for (const [itemId, price] of expected) {
      if (price === 0 || price === 0.001) {
        expect(seed.has(itemId), `placeholder/zero row dropped: ${itemId}`).toBe(true);
        expect(seed.get(itemId)).toBe(price);
      }
    }
  });

  it("has 0 key collision with the 44 GC/Site Ops codes", () => {
    const gc = gcSiteOpsCodes();
    expect(gc.size).toBe(44);
    const collisions = [...expectedCatalog().keys()].filter((id) => gc.has(id));
    expect(collisions, `unexpected collisions: ${collisions.join(", ")}`).toEqual([]);
  });

  it("the combined seed has exactly 271 rows (44 GC/Site Ops + 227 catalog)", () => {
    expect(parseSeed().size).toBe(271);
  });
});
