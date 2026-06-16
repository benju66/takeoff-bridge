/**
 * Phase 3 — estimate_bindings db gateway (MUTABLE) + round-trip → recompute-on-load.
 *
 * Unlike the append-only estimate_overrides trail, this table is mutable (LD-3):
 * saveEstimateBinding UPSERTs one binding per (project_id, target_node_id) and
 * deleteEstimateBinding removes it. The gateway THROWS on failure (authored intent must
 * persist — not fire-and-forget). The round-trip proves the load story: a binding saved
 * in code reloads and RECOMPUTES FROM SOURCE to the same value (stored values are never
 * trusted), and with NO bindings the recompute is inert (goldens tie $0.00).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Chainable Supabase mock. Terminal chains:
//   from().select(cols).eq(col,val).order(col,opts)              -> { data, error }
//   from().update(payload).eq(col,val).eq(col,val).select(cols)  -> { data, error }
//   from().insert(payload)                                       -> { error }
//   from().delete().eq(col,val).eq(col,val)                      -> { error }
// plus auth.getSession(). saveEstimateBinding UPDATEs first (preserving created_by) and
// only INSERTs when no row matched. Mirrors estimateOverridesDb.test.ts's approach.
// ---------------------------------------------------------------------------
const mockOrder = vi.fn();
const mockSelectEq = vi.fn(() => ({ order: mockOrder }));
const mockSelect = vi.fn(() => ({ eq: mockSelectEq }));
const mockUpdateSelect = vi.fn();
const mockUpdateEq2 = vi.fn(() => ({ select: mockUpdateSelect }));
const mockUpdateEq1 = vi.fn(() => ({ eq: mockUpdateEq2 }));
const mockUpdate = vi.fn((..._args: unknown[]) => {
  void _args;
  return { eq: mockUpdateEq1 };
});
const mockInsert = vi.fn();
const mockDeleteEq2 = vi.fn();
const mockDeleteEq1 = vi.fn(() => ({ eq: mockDeleteEq2 }));
const mockDelete = vi.fn(() => ({ eq: mockDeleteEq1 }));
const mockFrom = vi.fn((...args: unknown[]) => {
  void args; // rest param keeps the spread at the call site type-safe; args are recorded by vi.fn
  return { update: mockUpdate, insert: mockInsert, select: mockSelect, delete: mockDelete };
});
const mockGetSession = vi.fn();

vi.mock("../supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    auth: { getSession: () => mockGetSession() },
  },
}));

import * as db from "../db";
import { getEstimateBindings, saveEstimateBinding, deleteEstimateBinding } from "../db";
import { recomputeBindingValues } from "../bindings/recompute";
import { lineFieldNodeId } from "../bindings/compile";
import { lineFieldSourceNodes } from "../bindings/registry";
import type { Binding, BindingLine, GraphNode } from "../bindings/types";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: "user-7" } } } });
});

describe("saveEstimateBinding — update-then-insert (mutable, one per project+target)", () => {
  it("CREATE: update misses, then inserts { basis, rule } with derived columns + created_by", async () => {
    mockUpdateSelect.mockResolvedValueOnce({ data: [], error: null }); // no existing row matched
    mockInsert.mockResolvedValueOnce({ error: null });
    const binding: Binding = {
      targetNodeId: "line:abc:total",
      basis: "currency",
      definition: { kind: "lookup", source: "gc:supervisionSubtotal", transform: { multiply: 2, add: 50 } },
    };

    await saveEstimateBinding("p1", binding);

    expect(mockFrom).toHaveBeenCalledWith("estimate_bindings");
    // UPDATE path runs first, scoped by both keys, and never touches created_by.
    const [updatePayload] = mockUpdate.mock.calls[0];
    expect(updatePayload).toEqual({
      kind: "lookup",
      definition: {
        basis: "currency",
        rule: { kind: "lookup", source: "gc:supervisionSubtotal", transform: { multiply: 2, add: 50 } },
      },
    });
    expect(updatePayload).not.toHaveProperty("created_by");
    expect(mockUpdateEq1).toHaveBeenCalledWith("project_id", "p1");
    expect(mockUpdateEq2).toHaveBeenCalledWith("target_node_id", "line:abc:total");
    // No row matched → INSERT stamps created_by from the session.
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const [insertPayload] = mockInsert.mock.calls[0];
    expect(insertPayload).toEqual({
      project_id: "p1",
      target_node_id: "line:abc:total",
      kind: "lookup",
      definition: {
        basis: "currency",
        rule: { kind: "lookup", source: "gc:supervisionSubtotal", transform: { multiply: 2, add: 50 } },
      },
      created_by: "user-7",
    });
  });

  it("EDIT: a matching row is updated in place and never re-inserted (created_by preserved)", async () => {
    mockUpdateSelect.mockResolvedValueOnce({ data: [{ id: "b1" }], error: null }); // existing row matched
    const binding: Binding = {
      targetNodeId: "line:abc:total",
      basis: "currency",
      definition: { kind: "lookup", source: "gc:grandTotal" },
    };

    await saveEstimateBinding("p1", binding);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockInsert).not.toHaveBeenCalled(); // edit path: no insert → created_by untouched
  });

  it("THROWS on update error (authored intent must persist — not fire-and-forget)", async () => {
    mockUpdateSelect.mockResolvedValueOnce({ data: null, error: { message: "permission denied" } });
    const binding: Binding = {
      targetNodeId: "line:abc:total",
      basis: "currency",
      definition: { kind: "lookup", source: "gc:grandTotal" },
    };
    await expect(saveEstimateBinding("p1", binding)).rejects.toThrow(
      "Failed to save estimate binding: permission denied"
    );
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("THROWS on insert error (create path)", async () => {
    mockUpdateSelect.mockResolvedValueOnce({ data: [], error: null });
    mockInsert.mockResolvedValueOnce({ error: { message: "boom" } });
    const binding: Binding = {
      targetNodeId: "line:abc:total",
      basis: "currency",
      definition: { kind: "lookup", source: "gc:grandTotal" },
    };
    await expect(saveEstimateBinding("p1", binding)).rejects.toThrow(
      "Failed to save estimate binding: boom"
    );
  });
});

describe("getEstimateBindings — read + reconstruct Binding", () => {
  it("reads project rows ordered by target_node_id and reconstructs the Binding", async () => {
    mockOrder.mockResolvedValueOnce({
      data: [
        {
          id: "b1",
          project_id: "p1",
          target_node_id: "line:abc:total",
          kind: "lookup",
          definition: { basis: "currency", rule: { kind: "lookup", source: "gc:grandTotal", transform: { multiply: 1 } } },
          created_by: "user-7",
          created_at: "2026-06-15T01:00:00.000Z",
          updated_at: "2026-06-15T02:00:00.000Z",
        },
      ],
      error: null,
    });

    const records = await getEstimateBindings("p1");
    expect(mockFrom).toHaveBeenCalledWith("estimate_bindings");
    expect(mockSelectEq).toHaveBeenCalledWith("project_id", "p1");
    expect(mockOrder).toHaveBeenCalledWith("target_node_id", { ascending: true });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: "b1",
      projectId: "p1",
      createdBy: "user-7",
      updatedAt: "2026-06-15T02:00:00.000Z",
      binding: {
        targetNodeId: "line:abc:total",
        basis: "currency",
        definition: { kind: "lookup", source: "gc:grandTotal", transform: { multiply: 1 } },
      },
    });
  });

  it("defaults basis to 'currency' when the JSONB omits it", async () => {
    mockOrder.mockResolvedValueOnce({
      data: [
        {
          id: "b1", project_id: "p1", target_node_id: "line:abc:total", kind: "lookup",
          definition: { rule: { kind: "lookup", source: "gc:grandTotal" } }, // no basis key
          created_by: null, created_at: "2026-06-15T01:00:00.000Z", updated_at: "2026-06-15T01:00:00.000Z",
        },
      ],
      error: null,
    });
    const records = await getEstimateBindings("p1");
    expect(records[0].binding.basis).toBe("currency");
    expect(records[0].createdBy).toBeNull();
  });

  it("throws on error", async () => {
    mockOrder.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(getEstimateBindings("p1")).rejects.toThrow("Failed to fetch estimate bindings: boom");
  });
});

describe("deleteEstimateBinding — remove by (project_id, target_node_id)", () => {
  it("deletes by both keys", async () => {
    mockDeleteEq2.mockResolvedValueOnce({ error: null });
    await deleteEstimateBinding("p1", "line:abc:total");
    expect(mockFrom).toHaveBeenCalledWith("estimate_bindings");
    expect(mockDeleteEq1).toHaveBeenCalledWith("project_id", "p1");
    expect(mockDeleteEq2).toHaveBeenCalledWith("target_node_id", "line:abc:total");
  });

  it("throws on error", async () => {
    mockDeleteEq2.mockResolvedValueOnce({ error: { message: "nope" } });
    await expect(deleteEstimateBinding("p1", "line:abc:total")).rejects.toThrow(
      "Failed to delete estimate binding: nope"
    );
  });
});

describe("estimate_bindings mutable surface (the inverse of append-only overrides)", () => {
  it("the db gateway exposes read + save (upsert) + delete for bindings", () => {
    const gateway = db as unknown as Record<string, unknown>;
    expect(typeof gateway.getEstimateBindings).toBe("function");
    expect(typeof gateway.saveEstimateBinding).toBe("function");
    expect(typeof gateway.deleteEstimateBinding).toBe("function");
  });
});

describe("round-trip → recompute-on-load (save -> reload -> recompute FROM SOURCE)", () => {
  it("a lookup binding reloads from the persisted payload and recomputes to the same value", async () => {
    // SAVE (create path): update misses, then insert persists a lookup with a ×2 +50 transform.
    mockUpdateSelect.mockResolvedValueOnce({ data: [], error: null });
    mockInsert.mockResolvedValueOnce({ error: null });
    const binding: Binding = {
      targetNodeId: "line:r1:total",
      basis: "currency",
      definition: { kind: "lookup", source: "gc:supervisionSubtotal", transform: { multiply: 2, add: 50 } },
    };
    await saveEstimateBinding("p1", binding);

    // RELOAD: build the DB row from the ACTUAL inserted payload, so the test rides the
    // real persisted shape (not a hand-written duplicate).
    const inserted = mockInsert.mock.calls[0][0] as Record<string, unknown>;
    mockOrder.mockResolvedValueOnce({
      data: [{
        id: "b1",
        project_id: inserted.project_id,
        target_node_id: inserted.target_node_id,
        kind: inserted.kind,
        definition: inserted.definition,
        created_by: inserted.created_by,
        created_at: "2026-06-15T01:00:00.000Z",
        updated_at: "2026-06-15T01:00:00.000Z",
      }],
      error: null,
    });
    const [record] = await getEstimateBindings("p1");

    // RECOMPUTE FROM SOURCE: source supervision subtotal = 1000 -> 1000*2 + 50 = 2050.
    const sourceNodes: GraphNode[] = [
      { id: "gc:supervisionSubtotal", basis: "currency", inputs: [], evaluate: () => 1000 },
    ];
    const values = recomputeBindingValues([record.binding], sourceNodes, []);
    expect(values.get("line:r1:total")).toBe(2050);
  });

  it("a rollup binding recompiles against the current lines on load (sum over matched members)", async () => {
    const lines: BindingLine[] = [
      { id: "L1", itemId: "03-0000.001", costType: "M", source: "template", procoreCode: "", total: 100, unitPrice: 0, matchedQty: 0 },
      { id: "L2", itemId: "03-0000.002", costType: "L", source: "template", procoreCode: "", total: 250, unitPrice: 0, matchedQty: 0 },
      { id: "L3", itemId: "09-0000.001", costType: "M", source: "template", procoreCode: "", total: 999, unitPrice: 0, matchedQty: 0 },
    ];
    const rollup: Binding = {
      targetNodeId: "summary:div03",
      basis: "currency",
      definition: { kind: "rollup", op: "sum", set: { field: "division", match: "equals", value: "03" } },
    };

    // Source nodes for the lines (line:<id>:total etc.) — the groundwork a rollup depends on.
    const values = recomputeBindingValues([rollup], lineFieldSourceNodes(lines), lines);
    expect(values.get("summary:div03")).toBe(350); // L1 + L2, not L3
    // sanity: the per-line source nodes are present and recomputed-from-source
    expect(values.get(lineFieldNodeId("L1", "total"))).toBe(100);
  });

  it("is INERT with no bindings — returns exactly the source values (goldens stay $0.00)", () => {
    const sourceNodes: GraphNode[] = [
      { id: "gc:grandTotal", basis: "currency", inputs: [], evaluate: () => 1234 },
      { id: "siteops:demolition", basis: "currency", inputs: [], evaluate: () => 0 },
    ];
    const values = recomputeBindingValues([], sourceNodes, []);
    expect(values.get("gc:grandTotal")).toBe(1234);
    expect(values.get("siteops:demolition")).toBe(0);
    expect(values.size).toBe(2); // no extra nodes introduced
  });
});
