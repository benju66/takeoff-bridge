/**
 * Linked Values System — binding-list store helpers (Phase 4).
 *
 * Pure, KIND-BLIND list operations over `Binding[]`, identified by `targetNodeId`
 * (one binding per target — mirrors the DB's UNIQUE (project_id, target_node_id)).
 * Used for the in-memory optimistic binding state and for the SET_BINDING /
 * CLEAR_BINDING command inverse (prev/next), so the same upsert/remove logic backs
 * the live edit, undo, and redo paths. These never inspect `definition.kind` (LD-4).
 */

import type { Binding } from "./types";

/** The binding currently targeting `targetNodeId`, or `undefined`. */
export function findBindingByTarget(
  bindings: readonly Binding[],
  targetNodeId: string
): Binding | undefined {
  return bindings.find((b) => b.targetNodeId === targetNodeId);
}

/**
 * Returns a new list with `binding` inserted, or REPLACING any existing binding on
 * the same `targetNodeId` (one binding per target). Order is preserved: a replace
 * keeps the existing slot; a new binding is appended.
 */
export function upsertBinding(bindings: readonly Binding[], binding: Binding): Binding[] {
  const idx = bindings.findIndex((b) => b.targetNodeId === binding.targetNodeId);
  if (idx === -1) return [...bindings, binding];
  const next = [...bindings];
  next[idx] = binding;
  return next;
}

/** Returns a new list with the binding on `targetNodeId` removed (idempotent). */
export function removeBinding(bindings: readonly Binding[], targetNodeId: string): Binding[] {
  return bindings.filter((b) => b.targetNodeId !== targetNodeId);
}
