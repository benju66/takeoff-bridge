/**
 * Linked Values — Bucket B Phase 5: the division-tier structural-completeness guard.
 *
 * The load-bearing test for the `division` tier (plan §6 — "edge-authoring drift"), the
 * analog of the GC / Site-Ops structure tests. The division rollup edges are hand-authored
 * from the STEP 4 rows; if the grouping drifts (wrong division split, a member dropped, a
 * duplicate leaf minted) the inspection graph would silently LIE. It asserts:
 *
 *   1. NODE SET COMPLETENESS — exactly one `division:<NN>:total` per DISTINCT present division
 *      (a row whose `getDivisionCode` is a real 2-digit code); NO node for unmapped rows
 *      (`getDivisionCode === ""`), none spurious.
 *   2. VALUE/EDGE FIDELITY — each division node's inputs are its member rows' `line:<id>:total`
 *      ids (REUSED, not duplicated); each value === Σ of those member line totals === Σ member
 *      `row.total`; Σ(all division nodes) === Σ `row.total` over valid-division rows.
 *   3. ECHO === captured value (LD-B2), with NO orphan edges once composed with the line
 *      source nodes (the tier reuses external `line:*` ids the seam supplies), and acyclic.
 *
 * Division extraction flows through `getDivisionCode` (AGENTS.md) — never invented.
 */
import { describe, it, expect } from "vitest";
import {
  computePersonnelCosts,
  computeSiteOperations,
  computeTakeoffSummary,
  type PersonnelCalcResult,
  type SiteOpsCalcResult,
  type TakeoffSummary,
} from "../calculations";
import { describeEngineGraph } from "../bindings/engineGraph";
import { lineFieldSourceNodes, projectLine } from "../bindings/registry";
import { lineFieldNodeId } from "../bindings/compile";
import { evaluateGraph, findCycle } from "../bindings/graph";
import { divisionTotalNodeId, type GraphNode } from "../bindings/types";
import { getDivisionCode } from "../division";
import { LINKED_DIVISION_ROWS } from "../constants";
import type { ProcessedTakeoffRow } from "@/types";

// --- Fixtures (the division tier reads only `rows`; gc/siteOps/summary are in-scope dummies) -
const gc: PersonnelCalcResult = computePersonnelCosts(
  12,
  30000,
  { ex: 50, su: 100, srSu: 25 },
  { dumpsters: 1000, toilets: 2000, electric: 3000 },
  { designCivil: 18500 }
);
const siteOps: SiteOpsCalcResult = computeSiteOperations(12, 10000, { knox: 2 }, {});
const summary: TakeoffSummary = computeTakeoffSummary([], 30000, 100, undefined, []);

let nextId = 0;
function makeRow(over: Partial<ProcessedTakeoffRow> = {}): ProcessedTakeoffRow {
  return {
    id: over.id ?? `row-${nextId++}`,
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

// Rows spanning several divisions (09 twice, 03 once), one LINKED-division row (carries a
// real 2-digit division and a stored total), and one UNMAPPED row (no valid division).
const linkedCfg = LINKED_DIVISION_ROWS[0];
const rows: ProcessedTakeoffRow[] = [
  makeRow({ id: "r-drywall", itemId: "09-2100.001", total: 2940, description: "Drywall" }),
  makeRow({ id: "r-acoustic", itemId: "09-5100.001", total: 1500, description: "Acoustic" }),
  makeRow({ id: "r-concrete", itemId: "03-3000.001", total: 32840, description: "Concrete" }),
  makeRow({ id: "r-linked", itemId: linkedCfg.itemId, total: 777, description: linkedCfg.description }),
  makeRow({ id: "r-unmapped", itemId: "MANUAL", total: 999, description: "no division" }),
];

/** Distinct present division codes, derived independently via getDivisionCode. */
function presentDivisions(rs: readonly ProcessedTakeoffRow[]): Set<string> {
  const s = new Set<string>();
  for (const r of rs) {
    const code = getDivisionCode(r.itemId);
    if (code) s.add(code);
  }
  return s;
}

/** Compose the division-tier nodes WITH the line source nodes the seam supplies (so the
 *  reused `line:*` edges resolve) and evaluate. */
function build(rs: ProcessedTakeoffRow[]): {
  divisionNodes: GraphNode[];
  all: GraphNode[];
  byId: Map<string, GraphNode>;
  values: Map<string, number>;
} {
  const divisionNodes = describeEngineGraph(gc, siteOps, rs, summary, "division");
  const all = [...lineFieldSourceNodes(rs.map(projectLine)), ...divisionNodes];
  return {
    divisionNodes,
    all,
    byId: new Map(divisionNodes.map((n) => [n.id, n])),
    values: evaluateGraph(all),
  };
}

describe("division structural completeness — node set matches the present divisions", () => {
  const { divisionNodes } = build(rows);
  const ids = new Set(divisionNodes.map((n) => n.id));

  it("emits exactly one division:<NN>:total per DISTINCT present division (none for unmapped)", () => {
    const expected = new Set([...presentDivisions(rows)].map((c) => divisionTotalNodeId(c)));
    expect(ids).toEqual(expected);
  });

  it("mints no node for the unmapped (no-division) row", () => {
    // The MANUAL row has no valid division → no division node carries its $999.
    const unmappedDivision = getDivisionCode("MANUAL");
    expect(unmappedDivision).toBe("");
    expect([...ids].some((id) => id.includes("MANUAL"))).toBe(false);
  });

  it("every division node id is unique", () => {
    expect(divisionNodes.length).toBe(ids.size);
  });

  it("emits divisions in ascending code order (stable output)", () => {
    const codes = divisionNodes.map((n) => n.id);
    expect(codes).toEqual([...codes].sort((a, b) => a.localeCompare(b)));
  });
});

describe("division structural completeness — value/edge fidelity (the drift catch)", () => {
  const { divisionNodes, all, byId, values } = build(rows);

  it("each division node reads its member rows' line:<id>:total ids, in row order", () => {
    // division 09 = drywall + acoustic (in row order); division 03 = concrete.
    expect(byId.get(divisionTotalNodeId("09"))!.inputs).toEqual([
      lineFieldNodeId("r-drywall", "total"),
      lineFieldNodeId("r-acoustic", "total"),
    ]);
    expect(byId.get(divisionTotalNodeId("03"))!.inputs).toEqual([
      lineFieldNodeId("r-concrete", "total"),
    ]);
  });

  it("each division value === Σ its member line:total === Σ member row.total", () => {
    for (const code of presentDivisions(rows)) {
      const members = rows.filter((r) => getDivisionCode(r.itemId) === code);
      const sumRowTotals = members.reduce((s, r) => s + r.total, 0);
      const sumLineTotals = members.reduce(
        (s, r) => s + (values.get(lineFieldNodeId(r.id, "total")) ?? 0),
        0
      );
      const divisionValue = values.get(divisionTotalNodeId(code))!;
      expect(divisionValue).toBeCloseTo(sumLineTotals, 6);
      expect(divisionValue).toBeCloseTo(sumRowTotals, 6);
    }
  });

  it("the linked-division row's stored total folds into its division (documented semantics)", () => {
    const code = getDivisionCode(linkedCfg.itemId);
    expect(code).not.toBe("");
    // The linked row's $777 stored total is part of its division's Σ (echo of line totals).
    expect(values.get(divisionTotalNodeId(code))!).toBeGreaterThanOrEqual(777);
  });

  it("Σ(all division nodes) === Σ row.total over valid-division rows", () => {
    const sumDivisions = divisionNodes.reduce((s, n) => s + (values.get(n.id) ?? 0), 0);
    const sumValidRows = rows
      .filter((r) => getDivisionCode(r.itemId) !== "")
      .reduce((s, r) => s + r.total, 0);
    expect(sumDivisions).toBeCloseTo(sumValidRows, 6);
  });

  it("echo === captured value, no orphan edges (composed), acyclic", () => {
    // echo: every division node returns its captured value ignoring inputs.
    for (const n of divisionNodes) {
      expect(n.evaluate(new Map())).toBeCloseTo(values.get(n.id)!, 6);
    }
    // no orphan edges: every division input id is present in the composed node set.
    const composedIds = new Set(all.map((n) => n.id));
    for (const n of divisionNodes) {
      for (const dep of n.inputs) expect(composedIds.has(dep)).toBe(true);
    }
    expect(findCycle(all)).toBeNull();
  });
});

describe("division tier — inert when there is no STEP 4 division scope", () => {
  it("emits no nodes for an empty row set", () => {
    expect(describeEngineGraph(gc, siteOps, [], summary, "division")).toEqual([]);
  });

  it("emits no nodes when every row is unmapped", () => {
    const unmapped = [makeRow({ itemId: "" }), makeRow({ itemId: "MANUAL" })];
    expect(describeEngineGraph(gc, siteOps, unmapped, summary, "division")).toEqual([]);
  });
});
