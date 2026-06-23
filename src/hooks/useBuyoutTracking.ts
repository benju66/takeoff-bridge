"use client";

import { useCallback, useState } from "react";
import { BuyoutLine, BuyoutStore } from "@/lib/buyout";

// ---------------------------------------------------------------------------
// useBuyoutTracking — the browser-local store for the Buyout lens (Phase 1).
//
// A private side-ledger keyed by project + line id → { vendor, actual }, backed by
// localStorage ONLY (L-5). It NEVER touches the estimate's saved line items, the costing
// engine, the export, or the database — so it sits entirely outside AGENTS.md's
// financial-write / atomic-write / db.ts-gateway boundaries by simply never using those
// paths. The path to a real shared `estimate_buyout` table later is a single swap of the
// read/write helpers below.
//
// The substance lives in pure, React-free helpers (storage key, read, write with fail-soft,
// and the immutable map mutation) so it is unit-testable in the node test env without a DOM.
// The hook is a thin in-memory mirror over them.
//
// Storage key mirrors the existing `tb.estimate.*` convention in EstimateTable.tsx.
// ---------------------------------------------------------------------------

/** Project-scoped buyout annotations, keyed by line (row) id. */
export type BuyoutMap = Record<string, BuyoutLine>;

/** A blank annotation — the default for any line not yet bought out. */
export const EMPTY_BUYOUT_LINE: BuyoutLine = { vendor: "", actual: null };

/** localStorage key for a project's buyout ledger (one entry per project). */
export function buyoutStorageKey(projectId: string): string {
  return `tb.buyout.${projectId}`;
}

/**
 * A localStorage-shaped store. `window.localStorage` satisfies it; tests pass a fake.
 * Kept minimal (the two methods we use) so the helpers stay trivially mockable.
 */
export interface BuyoutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Coerces an untrusted stored entry into a well-formed BuyoutLine, or `null` if it isn't a
 * usable object. localStorage is user-writable, so the read boundary — not the consumers —
 * is where we guarantee `vendor` is a string and `actual` is a finite number or null. This
 * is what keeps a hand-tampered payload from later throwing in `isCommitted`/rollup math.
 */
function coerceLine(value: unknown): BuyoutLine | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  return {
    vendor: typeof v.vendor === "string" ? v.vendor : "",
    actual: typeof v.actual === "number" && Number.isFinite(v.actual) ? v.actual : null,
  };
}

/**
 * Reads a project's buyout map from storage. Fail-soft: any error (unavailable storage,
 * malformed JSON, non-object payload) yields an empty map rather than throwing into the UI.
 * Every returned line is sanitized via `coerceLine`, so the map is always well-formed
 * regardless of what is actually in localStorage.
 */
export function readBuyoutMap(storage: BuyoutStorage, projectId: string): BuyoutMap {
  try {
    const raw = storage.getItem(buyoutStorageKey(projectId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const clean: BuyoutMap = {};
    for (const [rowId, entry] of Object.entries(parsed as Record<string, unknown>)) {
      const line = coerceLine(entry);
      if (line) clean[rowId] = line;
    }
    return clean;
  } catch {
    return {};
  }
}

/**
 * Writes a project's buyout map to storage. Fail-soft: a write failure (quota, private
 * mode, unavailable storage) is swallowed and reported as `false` — it MUST never throw
 * into the UI. The in-memory mirror is the source of truth for the current session, so a
 * dropped write only loses persistence, never the live edit.
 */
export function writeBuyoutMap(storage: BuyoutStorage, projectId: string, map: BuyoutMap): boolean {
  try {
    storage.setItem(buyoutStorageKey(projectId), JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}

/**
 * Immutably sets one field of one line, returning a new map. Pure — the engine of
 * setVendor/setActual, separated out so the merge logic is testable without React.
 */
export function setLineField<K extends keyof BuyoutLine>(
  map: BuyoutMap,
  rowId: string,
  field: K,
  value: BuyoutLine[K]
): BuyoutMap {
  const existing = map[rowId] ?? EMPTY_BUYOUT_LINE;
  return { ...map, [rowId]: { ...existing, [field]: value } };
}

/**
 * The hook's return — structurally the {@link BuyoutStore} meta handle (extends it so the
 * two can never drift). Persistence/mirroring is the hook's concern; the interface shape is
 * shared so the grid's `meta.buyout` and the rollup both consume the same contract.
 */
export interface UseBuyoutTrackingReturn extends BuyoutStore {
  /** The whole project ledger — fed to computeBuyoutRollup for the footer. */
  map: BuyoutMap;
}

/** Hydrate a project's ledger from localStorage; `{}` on the server or with no projectId. */
function loadBuyoutMap(projectId: string): BuyoutMap {
  if (typeof window === "undefined" || !projectId) return {};
  return readBuyoutMap(window.localStorage, projectId);
}

/**
 * React hook over the browser-local buyout ledger. Hydrates from localStorage on mount /
 * project change, mirrors edits in memory, and persists each edit fail-soft.
 */
export function useBuyoutTracking(projectId: string): UseBuyoutTrackingReturn {
  // Lazy initializer reads localStorage once — the same SSR-guarded pattern as the
  // tb.estimate.* flags in EstimateTable.tsx (no hydration effect → no setState-in-effect).
  const [map, setMap] = useState<BuyoutMap>(() => loadBuyoutMap(projectId));

  // Re-hydrate when the project changes, the React-idiomatic way: adjust state DURING render
  // (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes),
  // not in an effect. React discards the in-progress render and re-runs with the new map.
  const [hydratedFor, setHydratedFor] = useState(projectId);
  if (projectId !== hydratedFor) {
    setHydratedFor(projectId);
    setMap(loadBuyoutMap(projectId));
  }

  const commit = useCallback(
    <K extends keyof BuyoutLine>(rowId: string, field: K, value: BuyoutLine[K]) => {
      // The persist lives INSIDE the updater on purpose: it ties each write to the exact
      // `prev` it derives from, so back-to-back edits both persist under React 19 batching
      // and a project switch can't write the old map to the new key. The only cost is an
      // idempotent double-write under dev StrictMode (harmless) — do NOT lift it into a
      // [map] effect, which reintroduces both of those bugs.
      setMap((prev) => {
        const next = setLineField(prev, rowId, field, value);
        // Persist fail-soft: a dropped write never throws and never blocks the live edit.
        if (typeof window !== "undefined" && projectId) {
          writeBuyoutMap(window.localStorage, projectId, next);
        }
        return next;
      });
    },
    [projectId]
  );

  const getLine = useCallback((rowId: string): BuyoutLine => map[rowId] ?? EMPTY_BUYOUT_LINE, [map]);
  const setVendor = useCallback((rowId: string, vendor: string) => commit(rowId, "vendor", vendor), [commit]);
  const setActual = useCallback((rowId: string, actual: number | null) => commit(rowId, "actual", actual), [commit]);

  return { getLine, setVendor, setActual, map };
}
