/**
 * Drift guard for the architect-confirmed MANUAL catalog additions
 * (CARE legacy-import sweep, 2026-06-10).
 *
 * These codes do NOT yet exist as STEP 4 rows in the canonical template
 * (`templates/Company_Estimate_Template.xlsx`), so a re-run of
 * `npm run sync-codes` — which rebuilds estimate-catalog.json FROM the
 * template — would silently drop them. This test makes that loss LOUD.
 *
 * If this test fails after a harvest: add the missing rows to the master
 * template's STEP 4 sheet (the durable fix) and re-harvest, or restore the
 * entries. SAC Determination's Procore bucket is additionally pinned in the
 * harvest script's USER_CONFIRMED_PROCORE_CODES (sibling inference would
 * wrongly send it to Building Permit).
 */
import { describe, it, expect } from "vitest";
import { ESTIMATE_ITEMS_MASTER } from "../mock-data";
import { isValidProcoreCode } from "../procoreValidCodes";

const MANUAL_ADDITIONS: { itemId: string; description: string; procoreCode: string }[] = [
  { itemId: "01-0230.002", description: "SAC Determination", procoreCode: "1-10260.000" },
  { itemId: "03-3543.002", description: "Sealed Concrete", procoreCode: "3-33543.000" },
  { itemId: "07-1000.003", description: "Tuckpointing", procoreCode: "7-71000.000" },
  { itemId: "09-9000.002", description: "Painting - Exterior", procoreCode: "9-99000.000" },
  { itemId: "26-0000.006", description: "Electrical - Generator", procoreCode: "26-260000.000" },
  { itemId: "32-1613.007", description: "Concrete Curb Stops", procoreCode: "32-321613.000" },
];

describe("catalog manual additions (2026-06-10) — survive re-harvest", () => {
  it("every architect-confirmed addition exists with its confirmed Procore code", () => {
    for (const add of MANUAL_ADDITIONS) {
      const entry = ESTIMATE_ITEMS_MASTER[add.itemId];
      expect(entry, `${add.itemId} (${add.description}) missing from estimate-catalog.json — was the catalog re-harvested without adding these rows to the master template?`).toBeDefined();
      expect(entry.description).toBe(add.description);
      expect(entry.procoreCode).toBe(add.procoreCode);
      expect(isValidProcoreCode(entry.procoreCode)).toBe(true);
    }
  });

  it("SAC Determination does NOT inherit its sibling's Building Permit bucket", () => {
    // The architect-corrected bucket (2026-06-10): City Licenses/Misc Permits.
    expect(ESTIMATE_ITEMS_MASTER["01-0230.002"].procoreCode).toBe("1-10260.000");
    expect(ESTIMATE_ITEMS_MASTER["01-0230.001"].procoreCode).toBe("1-10230.000");
  });
});
