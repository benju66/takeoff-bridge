/**
 * Phase 1 — Estimate Buyout Lens storage layer.
 *
 * The React hook is a thin in-memory mirror over these pure, React-free helpers (storage
 * key, read, write, immutable map mutation). Testing the helpers directly with a fake
 * Storage locks the real substance — set / get / persist round-trip and the fail-soft
 * contract (a storage failure MUST never throw into the UI) — in the node test env
 * without a DOM, matching the codebase's pure-logic test convention.
 */

import { describe, it, expect } from "vitest";
import {
  buyoutStorageKey,
  readBuyoutMap,
  writeBuyoutMap,
  setLineField,
  EMPTY_BUYOUT_LINE,
  BuyoutMap,
  BuyoutStorage,
} from "../useBuyoutTracking";

/** A minimal in-memory localStorage stand-in. */
function memoryStorage(seed: Record<string, string> = {}): BuyoutStorage & { dump: Record<string, string> } {
  const store: Record<string, string> = { ...seed };
  return {
    dump: store,
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = v;
    },
  };
}

/** A Storage whose every operation throws — models quota/private-mode/unavailable storage. */
const throwingStorage: BuyoutStorage = {
  getItem: () => {
    throw new Error("getItem boom");
  },
  setItem: () => {
    throw new Error("setItem boom");
  },
};

describe("buyoutStorageKey", () => {
  it("scopes the ledger per project and mirrors the tb.* convention", () => {
    expect(buyoutStorageKey("p1")).toBe("tb.buyout.p1");
    expect(buyoutStorageKey("p2")).toBe("tb.buyout.p2");
  });
});

describe("setLineField (pure map mutation)", () => {
  it("creates a line from the blank default when none exists", () => {
    const next = setLineField({}, "row-1", "vendor", "Acme");
    expect(next["row-1"]).toEqual({ vendor: "Acme", actual: null });
  });

  it("updates one field without disturbing the other", () => {
    const start = setLineField({}, "row-1", "vendor", "Acme");
    const next = setLineField(start, "row-1", "actual", 900);
    expect(next["row-1"]).toEqual({ vendor: "Acme", actual: 900 });
  });

  it("is immutable — returns a new map and leaves the input untouched", () => {
    const start: BuyoutMap = { "row-1": { vendor: "Acme", actual: null } };
    const next = setLineField(start, "row-1", "actual", 100);
    expect(next).not.toBe(start);
    expect(start["row-1"].actual).toBe(null);
  });

  it("does not cross-contaminate other rows", () => {
    const start: BuyoutMap = { a: { vendor: "A", actual: 1 } };
    const next = setLineField(start, "b", "vendor", "B");
    expect(next.a).toEqual({ vendor: "A", actual: 1 });
    expect(next.b).toEqual({ vendor: "B", actual: null });
  });

  it("EMPTY_BUYOUT_LINE is a blank line", () => {
    expect(EMPTY_BUYOUT_LINE).toEqual({ vendor: "", actual: null });
  });
});

describe("write → read round-trip (persist)", () => {
  it("persists a map and reads it back identically", () => {
    const storage = memoryStorage();
    const map: BuyoutMap = {
      "row-1": { vendor: "Acme", actual: 900 },
      "row-2": { vendor: "", actual: null },
    };
    expect(writeBuyoutMap(storage, "p1", map)).toBe(true);
    expect(storage.dump["tb.buyout.p1"]).toBe(JSON.stringify(map));
    expect(readBuyoutMap(storage, "p1")).toEqual(map);
  });

  it("keeps separate projects independent", () => {
    const storage = memoryStorage();
    writeBuyoutMap(storage, "p1", { r: { vendor: "A", actual: 1 } });
    writeBuyoutMap(storage, "p2", { r: { vendor: "B", actual: 2 } });
    expect(readBuyoutMap(storage, "p1")).toEqual({ r: { vendor: "A", actual: 1 } });
    expect(readBuyoutMap(storage, "p2")).toEqual({ r: { vendor: "B", actual: 2 } });
  });
});

describe("readBuyoutMap (fail-soft reads)", () => {
  it("returns {} when nothing is stored", () => {
    expect(readBuyoutMap(memoryStorage(), "p1")).toEqual({});
  });

  it("returns {} on malformed JSON instead of throwing", () => {
    const storage = memoryStorage({ "tb.buyout.p1": "{ not json" });
    expect(readBuyoutMap(storage, "p1")).toEqual({});
  });

  it("returns {} when the stored payload is not a plain object (e.g. an array)", () => {
    const storage = memoryStorage({ "tb.buyout.p1": "[1,2,3]" });
    expect(readBuyoutMap(storage, "p1")).toEqual({});
  });

  it("returns {} when the storage backend itself throws", () => {
    expect(() => readBuyoutMap(throwingStorage, "p1")).not.toThrow();
    expect(readBuyoutMap(throwingStorage, "p1")).toEqual({});
  });
});

describe("readBuyoutMap (entry sanitization — localStorage is user-writable)", () => {
  it("normalizes a missing/non-string vendor to '' and non-finite actual to null", () => {
    const storage = memoryStorage({
      "tb.buyout.p1": JSON.stringify({
        a: { actual: 900 }, // missing vendor
        b: { vendor: 42, actual: "oops" }, // wrong types
        c: { vendor: "Acme", actual: null },
      }),
    });
    expect(readBuyoutMap(storage, "p1")).toEqual({
      a: { vendor: "", actual: 900 },
      b: { vendor: "", actual: null },
      c: { vendor: "Acme", actual: null },
    });
  });

  it("drops entries that are not objects (e.g. a stray number)", () => {
    const storage = memoryStorage({
      "tb.buyout.p1": JSON.stringify({ a: 5, b: null, c: { vendor: "Bolt", actual: 10 } }),
    });
    expect(readBuyoutMap(storage, "p1")).toEqual({ c: { vendor: "Bolt", actual: 10 } });
  });

  it("coerces NaN/Infinity actual to null so downstream math never sees them", () => {
    // JSON can't carry NaN/Infinity literally; they serialize to null, but a tampered
    // payload could still arrive — guard at the boundary regardless.
    const storage = memoryStorage({
      "tb.buyout.p1": '{"a":{"vendor":"X","actual":1e999}}', // 1e999 parses to Infinity
    });
    expect(readBuyoutMap(storage, "p1")).toEqual({ a: { vendor: "X", actual: null } });
  });
});

describe("writeBuyoutMap (fail-soft writes)", () => {
  it("never throws when the storage backend fails — reports false", () => {
    let result: boolean | undefined;
    expect(() => {
      result = writeBuyoutMap(throwingStorage, "p1", { r: EMPTY_BUYOUT_LINE });
    }).not.toThrow();
    expect(result).toBe(false);
  });

  it("reports true on a successful write", () => {
    expect(writeBuyoutMap(memoryStorage(), "p1", {})).toBe(true);
  });
});
