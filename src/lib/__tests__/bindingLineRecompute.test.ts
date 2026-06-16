/**
 * Linked Values System Phase 4 — recomputeLineBindingValues + store helpers.
 *
 * Proves the grid-side recompute of USER bindings:
 *   - INERT when there are no bindings (→ empty map; goldens tie $0.00).
 *   - A line→line lookup resolves to the SOURCE line's value (binding WINS over the
 *     target line's own constant — the collision-precedence decision).
 *   - A lookup into a STEP 2/3 source node (gc:grandTotal) resolves correctly.
 *   - A binding targeting a RESERVED linked-division row is SKIPPED (the hardcoded
 *     bridge wins), with no duplicate-id throw.
 * Plus the pure upsert/remove/find store helpers.
 */
import { describe, it, expect, vi } from "vitest";
import {
  computePersonnelCosts,
  computeSiteOperations,
  type PersonnelCalcResult,
  type SiteOpsCalcResult,
} from "../calculations";
import {
  recomputeLineBindingValues,
  assembleBindingGraphNodes,
  userBindingSourceNodes,
  GC_GRAND_TOTAL_NODE_ID,
  GC_SUPERVISION_NODE_ID,
  GC_GENERAL_NODE_ID,
  siteOpsSectionNodeId,
} from "../bindings/registry";
import { lineFieldNodeId } from "../bindings/compile";
import { upsertBinding, removeBinding, findBindingByTarget } from "../bindings/store";
import type { Binding } from "../bindings/types";
import { LINKED_DIVISION_ROWS, SITE_OPS_SECTIONS } from "../constants";
import type { ProcessedTakeoffRow } from "@/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const gc: PersonnelCalcResult = computePersonnelCosts(
  12,
  30000,
  { ex: 50, su: 100, srSu: 25 },
  { dumpsters: 1000, toilets: 2000, electric: 3000 },
  { designCivil: 18500, tempOfficeSetup: 1 }
);
const siteOps: SiteOpsCalcResult = computeSiteOperations(12, 10000, { knox: 2 }, {});

let nextId = 0;
function makeRow(over: Partial<ProcessedTakeoffRow> = {}): ProcessedTakeoffRow {
  return {
    id: over.id ?? `row-fixture-${nextId++}`,
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

function lookup(targetRowId: string, sourceRowId: string): Binding {
  return {
    targetNodeId: lineFieldNodeId(targetRowId, "total"),
    basis: "currency",
    definition: { kind: "lookup", source: lineFieldNodeId(sourceRowId, "total") },
  };
}

// ---------------------------------------------------------------------------
// recomputeLineBindingValues
// ---------------------------------------------------------------------------

describe("recomputeLineBindingValues", () => {
  it("is inert (empty map) when there are no bindings", () => {
    const rows = [makeRow({ id: "row-a", total: 100 }), makeRow({ id: "row-b", total: 999 })];
    const result = recomputeLineBindingValues([], gc, siteOps, rows);
    expect(result.size).toBe(0);
  });

  it("resolves a line→line lookup to the SOURCE line's value (binding wins over the target's constant)", () => {
    const a = makeRow({ id: "row-a", total: 100 });
    const b = makeRow({ id: "row-b", total: 999 });
    const binding = lookup("row-b", "row-a");

    const result = recomputeLineBindingValues([binding], gc, siteOps, [a, b]);

    // B's bound total is A's total (100), NOT its own stored 999.
    expect(result.get(lineFieldNodeId("row-b", "total"))).toBeCloseTo(100, 8);
    // A's own source value is unchanged.
    expect(result.get(lineFieldNodeId("row-a", "total"))).toBeCloseTo(100, 8);
  });

  it("resolves a lookup into a STEP 2/3 source node (gc:grandTotal)", () => {
    const b = makeRow({ id: "row-b", total: 0 });
    const binding: Binding = {
      targetNodeId: lineFieldNodeId("row-b", "total"),
      basis: "currency",
      definition: { kind: "lookup", source: GC_GRAND_TOTAL_NODE_ID },
    };

    const result = recomputeLineBindingValues([binding], gc, siteOps, [b]);

    expect(result.get(lineFieldNodeId("row-b", "total"))).toBeCloseTo(gc.grandTotal, 8);
  });

  it("SKIPS a binding targeting a reserved linked-division row (no duplicate-id throw)", () => {
    const linkedItemId = LINKED_DIVISION_ROWS[0].itemId;
    const linkedRowId = `row-${linkedItemId}`;
    const linkedRow = makeRow({ id: linkedRowId, itemId: linkedItemId, total: 500 });
    const a = makeRow({ id: "row-a", total: 100 });
    const b = makeRow({ id: "row-b", total: 0 });

    // One binding on the reserved linked row (must be skipped) + one valid line lookup.
    const reservedBinding = lookup(linkedRowId, "row-a");
    const validBinding = lookup("row-b", "row-a");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = recomputeLineBindingValues(
      [reservedBinding, validBinding],
      gc,
      siteOps,
      [linkedRow, a, b]
    );
    warn.mockRestore();

    // The valid binding still computed…
    expect(result.get(lineFieldNodeId("row-b", "total"))).toBeCloseTo(100, 8);
    // …and the reserved linked node kept its own constant (the bridge wins, not the user binding).
    expect(result.get(lineFieldNodeId(linkedRowId, "total"))).toBeCloseTo(500, 8);
  });

  it("is inert when the only binding is on a reserved linked-division row", () => {
    const linkedItemId = LINKED_DIVISION_ROWS[0].itemId;
    const linkedRowId = `row-${linkedItemId}`;
    const linkedRow = makeRow({ id: linkedRowId, itemId: linkedItemId, total: 500 });
    const a = makeRow({ id: "row-a", total: 100 });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = recomputeLineBindingValues([lookup(linkedRowId, "row-a")], gc, siteOps, [linkedRow, a]);
    warn.mockRestore();

    expect(result.size).toBe(0);
  });

  it("resolves a lookup into a Site-Ops section NOT referenced by any linked row (Phase 5 widening)", () => {
    // The golden source set only builds sections a linked row reads; the user-binding set
    // builds EVERY section, so the authoring picker can offer any of them and it resolves.
    const section = "specialInspections" as const;
    const sectionNode = userBindingSourceNodes(gc, siteOps, []).find(
      (n) => n.id === siteOpsSectionNodeId(section)
    );
    expect(sectionNode).toBeDefined();
    const sectionValue = sectionNode!.evaluate(new Map());

    const b = makeRow({ id: "uuid-b", total: 0 });
    const binding: Binding = {
      targetNodeId: lineFieldNodeId("uuid-b", "total"),
      basis: "currency",
      definition: { kind: "lookup", source: siteOpsSectionNodeId(section) },
    };
    const result = recomputeLineBindingValues([binding], gc, siteOps, [b]);
    expect(result.get(lineFieldNodeId("uuid-b", "total"))).toBeCloseTo(sectionValue, 8);
  });
});

describe("userBindingSourceNodes / assembleBindingGraphNodes", () => {
  it("userBindingSourceNodes emits the 3 GC nodes, every Site-Ops section, and each line field", () => {
    const rows = [
      { id: "L1", itemId: "03-0000.001", costType: "", source: "", procoreCode: "", total: 10, unitPrice: 1, matchedQty: 10 },
    ];
    const ids = new Set(userBindingSourceNodes(gc, siteOps, rows).map((n) => n.id));
    expect(ids.has(GC_GRAND_TOTAL_NODE_ID)).toBe(true);
    expect(ids.has(GC_SUPERVISION_NODE_ID)).toBe(true);
    expect(ids.has(GC_GENERAL_NODE_ID)).toBe(true);
    for (const s of SITE_OPS_SECTIONS) expect(ids.has(siteOpsSectionNodeId(s.id))).toBe(true);
    expect(ids.has(lineFieldNodeId("L1", "total"))).toBe(true);
    expect(ids.has(lineFieldNodeId("L1", "unitPrice"))).toBe(true);
    expect(ids.has(lineFieldNodeId("L1", "matchedQty"))).toBe(true);
  });

  it("assembleBindingGraphNodes is inert (empty) with no bindings (goldens tie $0.00)", () => {
    expect(assembleBindingGraphNodes([], gc, siteOps, [makeRow({ id: "uuid-a" })])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// store helpers (pure, kind-blind)
// ---------------------------------------------------------------------------

describe("binding store helpers", () => {
  const a = lookup("row-a", "row-x");
  const b = lookup("row-b", "row-y");

  it("upsertBinding appends a new binding", () => {
    const next = upsertBinding([a], b);
    expect(next).toHaveLength(2);
    expect(findBindingByTarget(next, b.targetNodeId)).toBe(b);
  });

  it("upsertBinding replaces in place on the same target (keeps order)", () => {
    const replacement = lookup("row-a", "row-z");
    const next = upsertBinding([a, b], replacement);
    expect(next).toHaveLength(2);
    expect(next[0]).toBe(replacement); // same slot as the original `a`
    expect(next[1]).toBe(b);
  });

  it("removeBinding drops by target id (idempotent)", () => {
    expect(removeBinding([a, b], a.targetNodeId)).toEqual([b]);
    expect(removeBinding([b], a.targetNodeId)).toEqual([b]); // no-op when absent
  });

  it("findBindingByTarget returns the match or undefined", () => {
    expect(findBindingByTarget([a, b], b.targetNodeId)).toBe(b);
    expect(findBindingByTarget([a, b], "line:row-nope:total")).toBeUndefined();
  });
});
