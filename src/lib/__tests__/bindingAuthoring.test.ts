/**
 * Linked Values System Phase 5 — authoring helpers (the "Define link…" producer).
 *
 * Covers the pure decision logic the panel is an I/O shell over: the bindable-row gate,
 * the lookup source picker (the §2.2 addressability ceiling), the lookup/rollup builders,
 * the set-rule builder, input validation, the conservative cycle guard surfaced at
 * authoring time, and the live value preview. No DOM, no DB — node-testable.
 */
import { describe, it, expect } from "vitest";
import {
  computePersonnelCosts,
  computeSiteOperations,
  type PersonnelCalcResult,
  type SiteOpsCalcResult,
} from "../calculations";
import { lineFieldNodeId } from "../bindings/compile";
import {
  isStableBindingRowId,
  isBindableRow,
  listLookupSourceOptions,
  buildLookupBinding,
  buildRollupBinding,
  setRuleFromLeaves,
  leafFromDraft,
  explicitIdsRule,
  validateLookupDraft,
  validateLeafDraft,
  validateRollupDraft,
  bindingCycle,
  previewBinding,
  type LeafDraft,
} from "../bindings/authoring";
import {
  GC_GRAND_TOTAL_NODE_ID,
  GC_SUPERVISION_NODE_ID,
  GC_GENERAL_NODE_ID,
} from "../bindings/registry";
import { SITE_OPS_SECTIONS, LINKED_DIVISION_ROWS } from "../constants";
import type { Binding } from "../bindings/types";
import type { ProcessedTakeoffRow } from "@/types";

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
    id: over.id ?? `uuid-${nextId++}`,
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

describe("isStableBindingRowId / isBindableRow", () => {
  it("rejects volatile parser ids (row-<index>) but accepts template/manual/saved ids", () => {
    expect(isStableBindingRowId("row-5")).toBe(false);
    expect(isStableBindingRowId("row-12")).toBe(false);
    expect(isStableBindingRowId("row-09-9000.001")).toBe(true); // template row-<itemId>
    expect(isStableBindingRowId("manual-abc")).toBe(true);
    expect(isStableBindingRowId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("a bindable row is non-linked-division with a stable id", () => {
    expect(isBindableRow(makeRow({ id: "uuid-x", itemId: "09-9000.001" }))).toBe(true);
    expect(isBindableRow(makeRow({ id: "row-3", itemId: "09-9000.001" }))).toBe(false); // volatile
    const linkedItemId = LINKED_DIVISION_ROWS[0].itemId;
    expect(isBindableRow(makeRow({ id: "uuid-y", itemId: linkedItemId }))).toBe(false); // reserved
  });
});

describe("listLookupSourceOptions", () => {
  it("offers the 3 GC nodes, every Site-Ops section, and bindable lines (minus the target)", () => {
    const target = makeRow({ id: "uuid-target", itemId: "09-9000.005" });
    const sibling = makeRow({ id: "uuid-sibling", itemId: "03-0000.001", description: "Concrete" });
    const volatile = makeRow({ id: "row-7", itemId: "04-0000.001" });
    const linked = makeRow({ id: "uuid-linked", itemId: LINKED_DIVISION_ROWS[0].itemId });

    const opts = listLookupSourceOptions([target, sibling, volatile, linked], target.id);
    const ids = opts.map((o) => o.id);

    expect(ids).toContain(GC_GRAND_TOTAL_NODE_ID);
    expect(ids).toContain(GC_SUPERVISION_NODE_ID);
    expect(ids).toContain(GC_GENERAL_NODE_ID);
    // every site-ops section is offered
    for (const s of SITE_OPS_SECTIONS) expect(ids).toContain(`siteops:${s.id}`);
    // the sibling line is offered; the target, the volatile row, and the linked row are NOT
    expect(ids).toContain(lineFieldNodeId("uuid-sibling", "total"));
    expect(ids).not.toContain(lineFieldNodeId("uuid-target", "total"));
    expect(ids).not.toContain(lineFieldNodeId("row-7", "total"));
    expect(ids).not.toContain(lineFieldNodeId("uuid-linked", "total"));
  });
});

describe("builders", () => {
  it("buildLookupBinding drops an identity transform but keeps a real one", () => {
    const plain = buildLookupBinding("uuid-1", GC_GRAND_TOTAL_NODE_ID, { multiply: 1, add: 0 });
    expect(plain).toEqual({
      targetNodeId: "line:uuid-1:total",
      basis: "currency",
      definition: { kind: "lookup", source: GC_GRAND_TOTAL_NODE_ID },
    });
    const scaled = buildLookupBinding("uuid-1", GC_GRAND_TOTAL_NODE_ID, { multiply: 2, add: 50 });
    expect(scaled.definition).toEqual({ kind: "lookup", source: GC_GRAND_TOTAL_NODE_ID, transform: { multiply: 2, add: 50 } });
  });

  it("buildRollupBinding omits field for total and includes it otherwise", () => {
    const set = { field: "division", match: "equals", value: "03" } as const;
    expect(buildRollupBinding("uuid-1", "sum", set).definition).toEqual({ kind: "rollup", op: "sum", set });
    expect(buildRollupBinding("uuid-1", "avg", set, "unitPrice").definition).toEqual({ kind: "rollup", op: "avg", set, field: "unitPrice" });
  });
});

describe("set-rule builder", () => {
  it("leafFromDraft splits an `in` list and trims; equals/startsWith keep a string", () => {
    expect(leafFromDraft({ field: "division", match: "in", value: " 03 , 04 ,09 " })).toEqual({
      field: "division",
      match: "in",
      value: ["03", "04", "09"],
    });
    expect(leafFromDraft({ field: "division", match: "equals", value: " 03 " })).toEqual({
      field: "division",
      match: "equals",
      value: "03",
    });
  });

  it("setRuleFromLeaves: a lone leaf needs no wrapper; many combine under all/any", () => {
    const a: LeafDraft = { field: "division", match: "equals", value: "03" };
    const b: LeafDraft = { field: "costType", match: "equals", value: "L" };
    expect(setRuleFromLeaves("all", [a])).toEqual({ field: "division", match: "equals", value: "03" });
    expect(setRuleFromLeaves("all", [a, b])).toEqual({
      all: [
        { field: "division", match: "equals", value: "03" },
        { field: "costType", match: "equals", value: "L" },
      ],
    });
    expect(setRuleFromLeaves("any", [a, b])).toHaveProperty("any");
  });

  it("explicitIdsRule wraps the picked ids", () => {
    expect(explicitIdsRule(["a", "b"])).toEqual({ explicitIds: ["a", "b"] });
  });
});

describe("validation", () => {
  it("validateLookupDraft requires a source and numeric transforms", () => {
    expect(validateLookupDraft("", "1", "0").ok).toBe(false);
    expect(validateLookupDraft("gc:grandTotal", "x", "0").ok).toBe(false);
    expect(validateLookupDraft("gc:grandTotal", "", "").ok).toBe(true); // blank → defaults
    expect(validateLookupDraft("gc:grandTotal", "2", "50").ok).toBe(true);
  });

  it("validateLeafDraft / validateRollupDraft enforce non-empty values", () => {
    expect(validateLeafDraft({ field: "division", match: "equals", value: "" }).ok).toBe(false);
    expect(validateLeafDraft({ field: "division", match: "in", value: " , " }).ok).toBe(false);
    expect(validateRollupDraft(false, [], []).ok).toBe(false);
    expect(validateRollupDraft(true, [], []).ok).toBe(false); // explicit but nothing picked
    expect(validateRollupDraft(true, [], ["a"]).ok).toBe(true);
    expect(validateRollupDraft(false, [{ field: "division", match: "equals", value: "03" }], []).ok).toBe(true);
  });
});

describe("bindingCycle (conservative guard surfaced at authoring time)", () => {
  it("returns a path for a lookup onto its own line (self-reference)", () => {
    const target = makeRow({ id: "uuid-self", itemId: "09-9000.001" });
    const selfish = buildLookupBinding("uuid-self", lineFieldNodeId("uuid-self", "total"));
    const cycle = bindingCycle(selfish, [], gc, siteOps, [target]);
    expect(cycle).not.toBeNull();
    expect(cycle).toContain("line:uuid-self:total");
  });

  it("detects a two-binding A→B→A cycle when the second binding is added", () => {
    const a = makeRow({ id: "uuid-a", itemId: "09-9000.001" });
    const b = makeRow({ id: "uuid-b", itemId: "09-9000.002" });
    const aToB = buildLookupBinding("uuid-a", lineFieldNodeId("uuid-b", "total"));
    const bToA = buildLookupBinding("uuid-b", lineFieldNodeId("uuid-a", "total"));
    // Adding bToA while aToB exists closes the loop.
    expect(bindingCycle(bToA, [aToB], gc, siteOps, [a, b])).not.toBeNull();
    // aToB alone is acyclic.
    expect(bindingCycle(aToB, [], gc, siteOps, [a, b])).toBeNull();
  });
});

describe("previewBinding (live value the panel shows before saving)", () => {
  it("recomputes a lookup value from source (× then +)", () => {
    const target = makeRow({ id: "uuid-t", itemId: "09-9000.001" });
    const binding: Binding = buildLookupBinding("uuid-t", GC_GRAND_TOTAL_NODE_ID, { multiply: 2, add: 100 });
    const preview = previewBinding(binding, [], gc, siteOps, [target]);
    expect(preview.cycle).toBeUndefined();
    // gc.grandTotal is a known engine value → transform is source × 2 + 100.
    expect(preview.value).toBeCloseTo(gc.grandTotal * 2 + 100, 8);
  });

  it("reports a rollup's value and matched member count", () => {
    const target = makeRow({ id: "uuid-t", itemId: "10-0000.001" });
    const r1 = makeRow({ id: "uuid-1", itemId: "03-0000.001", total: 100 });
    const r2 = makeRow({ id: "uuid-2", itemId: "03-0000.002", total: 250 });
    const r3 = makeRow({ id: "uuid-3", itemId: "09-0000.001", total: 999 });
    const binding = buildRollupBinding("uuid-t", "sum", setRuleFromLeaves("all", [
      { field: "division", match: "equals", value: "03" },
    ]));
    const preview = previewBinding(binding, [], gc, siteOps, [target, r1, r2, r3]);
    expect(preview.value).toBeCloseTo(350, 8); // r1 + r2, not r3
    expect(preview.memberCount).toBe(2);
  });

  it("returns the cycle (and value 0) for a circular draft", () => {
    const target = makeRow({ id: "uuid-self", itemId: "09-9000.001" });
    const selfish = buildLookupBinding("uuid-self", lineFieldNodeId("uuid-self", "total"));
    const preview = previewBinding(selfish, [], gc, siteOps, [target]);
    expect(preview.cycle).toBeTruthy();
    expect(preview.value).toBe(0);
  });
});
