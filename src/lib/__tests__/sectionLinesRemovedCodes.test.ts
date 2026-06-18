import { describe, it, expect } from "vitest";
import { deriveRemovedCodesFromLines } from "../sectionLines/project";
import {
  synthesizePersonnelSectionLines,
  synthesizeSiteOpsSectionLines,
  synthesizeSectionLines,
} from "../sectionLines/synthesize";
import {
  STAFF_ROLE_DEFAULTS,
  OPERATIONAL_EXPENSE_DEFAULTS,
  EQUIPMENT_DEFAULTS,
  GC_MANUAL_DEFAULTS,
  SITE_OPS_DYNAMIC_DEFAULTS,
  SITE_OPS_MANUAL_DEFAULTS,
} from "../constants";

// ---------------------------------------------------------------------------
// GC/Site-Ops Addressability Phase B4 (D2) — removed-codes derivation.
//
// `deriveRemovedCodesFromLines` is the LOAD-READ seam: it reconstructs which catalog
// codes the estimator has removed from a project's persisted `estimate_section_lines`
// (catalog − present), so a removal survives reload. The page passes the result into the
// calc hooks as `initialRemovedCodes`. These tests pin the contract:
//   1. EMPTY persisted set ⇒ removal OFF (a never-saved project keeps the full catalog).
//   2. FULL catalog persisted ⇒ nothing removed.
//   3. A FILTERED set ⇒ exactly the absent codes, per section.
//   4. The synthesize → filter → derive round-trip reproduces the removed set.
// ---------------------------------------------------------------------------

const GC_CATALOG = [
  ...STAFF_ROLE_DEFAULTS.map((r) => r.code),
  ...OPERATIONAL_EXPENSE_DEFAULTS.map((o) => o.code),
  ...EQUIPMENT_DEFAULTS.map((e) => e.code),
  ...GC_MANUAL_DEFAULTS.map((m) => m.code),
];
const SITEOPS_CATALOG = [
  ...SITE_OPS_DYNAMIC_DEFAULTS.map((d) => d.code),
  ...SITE_OPS_MANUAL_DEFAULTS.map((m) => m.code),
];

describe("Phase B4 — deriveRemovedCodesFromLines", () => {
  it("an empty persisted set means removal is OFF (full catalog)", () => {
    expect(deriveRemovedCodesFromLines([])).toEqual({ gc: [], siteOps: [] });
  });

  it("the full app-born catalog persisted has nothing removed", () => {
    const full = synthesizeSectionLines({});
    const removed = deriveRemovedCodesFromLines(full);
    expect(removed.gc).toEqual([]);
    expect(removed.siteOps).toEqual([]);
  });

  it("a filtered persisted set yields exactly the absent codes, per section", () => {
    const gcDrop = STAFF_ROLE_DEFAULTS[0].code; // a staff line
    const siteOpsDrop = SITE_OPS_DYNAMIC_DEFAULTS[0].code; // a dynamic line
    const filtered = synthesizeSectionLines({}).filter(
      (l) => l.code !== gcDrop && l.code !== siteOpsDrop
    );

    const removed = deriveRemovedCodesFromLines(filtered);
    expect(removed.gc).toEqual([gcDrop]);
    expect(removed.siteOps).toEqual([siteOpsDrop]);
  });

  it("removing every line of a section (table non-empty) reports the whole section", () => {
    // Only GC lines persisted ⇒ Site Ops has zero present codes ⇒ its whole catalog
    // is removed (the documented degenerate case; distinct from a never-saved project).
    const gcOnly = synthesizePersonnelSectionLines();
    const removed = deriveRemovedCodesFromLines(gcOnly);
    expect(removed.gc).toEqual([]);
    expect(new Set(removed.siteOps)).toEqual(new Set(SITEOPS_CATALOG));
  });

  it("the synthesize → filter → derive round-trip reproduces an arbitrary removed set", () => {
    const removeGc = [STAFF_ROLE_DEFAULTS[1].code, GC_MANUAL_DEFAULTS[0].code];
    const removeSiteOps = [SITE_OPS_MANUAL_DEFAULTS[0].code];
    const removeSet = new Set([...removeGc, ...removeSiteOps]);

    // The hook synthesizes the full seed then drops the removed codes (its filter).
    const persisted = synthesizeSectionLines({}).filter((l) => !removeSet.has(l.code));
    const derived = deriveRemovedCodesFromLines(persisted);

    expect(new Set(derived.gc)).toEqual(new Set(removeGc));
    expect(new Set(derived.siteOps)).toEqual(new Set(removeSiteOps));
  });

  it("derived removed codes are always a subset of the catalog", () => {
    const filtered = synthesizeSiteOpsSectionLines().filter(
      (l) => l.code !== SITE_OPS_MANUAL_DEFAULTS[0].code
    );
    // A site-ops-only persisted set: GC has no present codes ⇒ whole GC catalog removed.
    const removed = deriveRemovedCodesFromLines(filtered);
    for (const c of removed.gc) expect(GC_CATALOG).toContain(c);
    for (const c of removed.siteOps) expect(SITEOPS_CATALOG).toContain(c);
  });
});
