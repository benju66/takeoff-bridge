/**
 * Linked Values System Phase 5 — buildLinksModel (the Trust Inspector "Links" tab).
 *
 * Links = one cell's direct depends-on / used-by, two views of the same kind-blind graph
 * the grid recomputes. These assert the pure view-model: focus labelling + value, the
 * bound/unbound flag, direct dependencies, reverse "used-by" edges, line-node rowIds for
 * click-to-jump, and the cheap empty-graph path (no bindings → focus only).
 */
import { describe, it, expect } from "vitest";
import {
  computePersonnelCosts,
  computeSiteOperations,
  type PersonnelCalcResult,
  type SiteOpsCalcResult,
} from "../calculations";
import { buildLinksModel } from "../trustInspector";
import { lineFieldNodeId } from "../bindings/compile";
import { buildLookupBinding } from "../bindings/authoring";
import { GC_GRAND_TOTAL_NODE_ID } from "../bindings/registry";
import type { ProcessedTakeoffRow } from "@/types";

const gc: PersonnelCalcResult = computePersonnelCosts(
  12,
  30000,
  { ex: 50, su: 100, srSu: 25 },
  { dumpsters: 1000, toilets: 2000, electric: 3000 },
  { designCivil: 18500, tempOfficeSetup: 1 }
);
const siteOps: SiteOpsCalcResult = computeSiteOperations(12, 10000, { knox: 2 }, {});

function makeRow(over: Partial<ProcessedTakeoffRow> = {}): ProcessedTakeoffRow {
  return {
    id: "uuid",
    classification: "",
    itemId: "",
    procoreParentCode: "",
    procoreCode: "",
    description: "",
    matchedQty: 0,
    uom: "",
    unitPrice: 0,
    total: 0,
    isMapped: false,
    rawQuantities: [],
    costType: "",
    ...over,
  };
}

describe("buildLinksModel", () => {
  it("an unbound line is focus-only (no deps, no used-by, jumpable rowId)", () => {
    const a = makeRow({ id: "uuid-a", itemId: "09-9000.001", description: "Drywall", total: 100 });
    const model = buildLinksModel({
      focusNodeId: lineFieldNodeId("uuid-a", "total"),
      bindings: [],
      gc,
      siteOps,
      rows: [a],
    });
    expect(model.isBound).toBe(false);
    expect(model.dependsOn).toEqual([]);
    expect(model.usedBy).toEqual([]);
    expect(model.focus.rowId).toBe("uuid-a");
    expect(model.focus.label).toContain("09-9000.001");
    expect(model.focus.label).toContain("Drywall");
  });

  it("a bound cell shows its direct dependency (the mirrored source) with value + jump", () => {
    const a = makeRow({ id: "uuid-a", itemId: "09-9000.001", description: "Source", total: 100 });
    const b = makeRow({ id: "uuid-b", itemId: "09-9000.002", description: "Mirror" });
    const bToA = buildLookupBinding("uuid-b", lineFieldNodeId("uuid-a", "total"));

    const model = buildLinksModel({
      focusNodeId: lineFieldNodeId("uuid-b", "total"),
      bindings: [bToA],
      gc,
      siteOps,
      rows: [a, b],
    });

    expect(model.isBound).toBe(true);
    expect(model.bindingDescription).toBeTruthy();
    expect(model.focus.value).toBeCloseTo(100, 8); // mirrors A
    expect(model.dependsOn).toHaveLength(1);
    expect(model.dependsOn[0].rowId).toBe("uuid-a");
    expect(model.dependsOn[0].label).toContain("09-9000.001");
    expect(model.dependsOn[0].value).toBeCloseTo(100, 8);
    expect(model.usedBy).toEqual([]);
  });

  it("the mirrored source reports the binding that reads it under used-by", () => {
    const a = makeRow({ id: "uuid-a", itemId: "09-9000.001", total: 100 });
    const b = makeRow({ id: "uuid-b", itemId: "09-9000.002" });
    const bToA = buildLookupBinding("uuid-b", lineFieldNodeId("uuid-a", "total"));

    const model = buildLinksModel({
      focusNodeId: lineFieldNodeId("uuid-a", "total"),
      bindings: [bToA],
      gc,
      siteOps,
      rows: [a, b],
    });

    expect(model.isBound).toBe(false); // A itself is not bound
    expect(model.usedBy).toHaveLength(1);
    expect(model.usedBy[0].rowId).toBe("uuid-b");
  });

  it("a lookup into a STEP 2 GC node shows a non-jumpable, labelled dependency", () => {
    const c = makeRow({ id: "uuid-c", itemId: "10-0000.001" });
    const cToGc = buildLookupBinding("uuid-c", GC_GRAND_TOTAL_NODE_ID);
    const model = buildLinksModel({
      focusNodeId: lineFieldNodeId("uuid-c", "total"),
      bindings: [cToGc],
      gc,
      siteOps,
      rows: [c],
    });
    expect(model.isBound).toBe(true);
    expect(model.focus.value).toBeCloseTo(gc.grandTotal, 8);
    expect(model.dependsOn).toHaveLength(1);
    expect(model.dependsOn[0].nodeId).toBe(GC_GRAND_TOTAL_NODE_ID);
    expect(model.dependsOn[0].rowId).toBeUndefined(); // a STEP 2 value isn't a grid row
    expect(model.dependsOn[0].label).toContain("STEP 2");
  });
});
