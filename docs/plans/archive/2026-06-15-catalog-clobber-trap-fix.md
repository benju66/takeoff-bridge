# Plan — Disarm the `estimate-catalog.json` clobber trap

**Date:** 2026-06-15
**Status:** PROPOSED (awaiting architect approval)
**Size:** SMALL (~3 files, ~40 lines, no DDL, no schema change)
**Goal lens:** Database integrity — protects the catalog spine the entire cost
database maps onto. Disarms a silent-corruption path before backlog import + team
adoption.

---

## 1. Problem statement

`src/lib/estimate-catalog.json` is a **generated** artifact: `npm run sync-codes`
(→ `scripts/harvest-cost-codes.js`) rebuilds it from the company template's
`STEP 4 - ESTIMATE` sheet. It currently holds **227** entries:

- **221** harvested from the template, plus
- **6** architect-confirmed manual additions (2026-06-10) that have **no STEP 4 row
  in the template** and therefore cannot be re-harvested:

  | itemId | description | procoreCode | uom | costType |
  |---|---|---|---|---|
  | `03-3543.002` | Sealed Concrete | `3-33543.000` | SF | S |
  | `07-1000.003` | Tuckpointing | `7-71000.000` | SF | S |
  | `09-9000.002` | Painting - Exterior | `9-99000.000` | SF | S |
  | `26-0000.006` | Electrical - Generator | `26-260000.000` | LS | S |
  | `32-1613.007` | Concrete Curb Stops | `32-321613.000` | EA | M |
  | `01-0230.002` | SAC Determination | `1-10260.000` | LS | S |

The script's final `writeFileSync` (`harvest-cost-codes.js:500`) **overwrites** the
file with the pure 221-code harvest, silently dropping the 6. Today the only
protections are (a) a FOOTGUN comment and (b) `catalogManualAdditions.test.ts`,
which goes red **after** the damage is done. Running `sync-codes` also breaks
`catalogPriceLookup.test`, `catalogRateSeed.test`, `rateCardSeed.test`,
`constants.test` (all pin 227).

**Root cause:** the 6 manual codes have no durable, non-clobbered home — they live
inside the very file the harvest regenerates.

---

## 2. Consumer surface (what must not move)

Everything that reads `estimate-catalog.json`, traced exhaustively:

| Consumer | How it reads | Sensitivity |
|---|---|---|
| `src/lib/mock-data.ts` → `ESTIMATE_ITEMS_MASTER` | `import` whole object | key-lookup dictionary; **order-independent** |
| `catalogPriceLookup.test.ts` | `import`, iterates `Object.values`, pins `length === 227` | count + key lookup; order-independent |
| `catalogRateSeed.test.ts` | `import`, builds `Map` by itemId, pins 227 / 271 | key lookup; order-independent |
| `rateCardSeed.test.ts` | `import` | key lookup |
| `constants.test.ts` | `import` | catalog-integrity assertions |
| `procore-type-reconciliation.test.ts` | `import` | key lookup |
| `scripts/verify-phase2-resync.js` | `require`, checks specific codes + prints count | read-only one-off, not in `npm run test` |
| `scripts/generate-rate-card-seed.js` | `readFileSync(CATALOG_PATH)`, `Object.values`, **`.sort()`** before emit | order-independent (explicit sort) |
| `scripts/generate-cost-code-map-seed.js` | `readFileSync(CATALOG_PATH)`, **`Object.keys().sort()`** before emit | order-independent (explicit sort) |

> The two seed generators read via a `CATALOG_PATH` variable (not the literal
> string), so a naive grep misses them — found via an independent inventory pass.
> Both **explicitly sort** before emitting SQL, so catalog key order cannot affect
> their output. They are not run by `npm run test`. Critically, the **committed
> seeds already carry all 6 manual codes** (verified: `supabase_seed_rate_card.sql`
> contains `03-3543.002`, `26-0000.006`, `01-0230.002`, …), so this change requires
> **no seed regeneration** and `catalogRateSeed` / `rateCardSeed` (which pin the
> seed at 227 / 271) stay green untouched.

**Only writer:** `scripts/harvest-cost-codes.js`. No runtime code writes the file.
**Single-writer claim independently re-verified** (one `writeFileSync` at line 500).

**Verified invariant:** *no consumer depends on key ORDER* — every one does
key-lookups, `Object.values` iteration, or `.length`/count assertions. (Confirmed
by reading each reader.) This means a future harvest may re-emit the 6 in a
different position with zero functional effect.

The calculation engine and exporter consume **project line-item rows**, not the
master catalog's iteration order, so neither golden can move from a catalog key
re-order.

---

## 3. Approaches considered

### Option A — Harvest re-injects the 6 from a sidecar  ✅ RECOMMENDED
Give the 6 a durable home in a new hand-maintained
`src/lib/estimate-catalog-manual.json`. Teach the harvest to merge that sidecar
into its output **after** the valid-code gate, so `sync-codes` now produces the
full **227** union instead of dropping to 221. The committed
`estimate-catalog.json` stays the 227 union every consumer already reads.

- **Blast radius:** 1 new data file + ~8 lines in the harvest script + 1 new guard
  test. `estimate-catalog.json` is **not rewritten** by this change — the fix is
  latent and only changes the *next* harvest's behavior (227, not 221).
- **Semantics unchanged:** the 6 remain **built-ins** (`ESTIMATE_ITEMS_MASTER` =
  227), so `isBuiltInCatalogCode`, drift logic, reconciliation tests, and all
  count-pinned tests are untouched.

### Option B — Split sources (JSON → 221, merge in `mock-data.ts`)  ❌ REJECTED
Rewrite the JSON to 221, add the sidecar, merge the two in `mock-data.ts`.
*Architecturally purer* (harvest output is pure), but it forces:
- rewriting `estimate-catalog.json` now, **and**
- repointing all 5 pinned tests + `verify-phase2-resync.js` off the raw JSON onto
  a merged source — otherwise they drop to 221 and break.

8+ files, directly touching the correctness tests. Violates the "doesn't impact
the app at all" requirement. Rejected.

### Option C — Route the 6 through the existing runtime overlay (`primeCatalogAdditions`)  ❌ REJECTED
`catalog.ts` already has an additions overlay, but it layers additions **under**
built-ins and would (a) require seeding the 6 into the `catalog_additions` DB
table (data change), (b) make them non-built-ins so `ESTIMATE_ITEMS_MASTER` drops
to 221 → breaks the 5 pinned tests, and (c) flip their drift state. Wrong tool.

---

## 4. Detailed change set (Option A)

### 4.1 NEW `src/lib/estimate-catalog-manual.json`
The 6 entries, copied **verbatim** from today's `estimate-catalog.json` (exact
bytes — same field order, `defaultUnitPrice: 0`, parent/procore/uom/costType as
they stand). This file is the source of truth for the 6 and is **never written by
the harvest**.

### 4.2 EDIT `scripts/harvest-cost-codes.js`
Immediately **before** the catalog `writeFileSync` (line 500) and **after** the
hard valid-code gate (lines 478–486):

```js
// Re-inject architect-confirmed manual built-ins that have no STEP 4 template
// row (2026-06-10). These live in estimate-catalog-manual.json — the harvest's
// durable, non-clobbered home for them — so sync-codes preserves them instead of
// dropping them. Merged AFTER the valid-code gate so they never alter gate
// behavior; their Procore codes are validated by catalogManualAdditions.test.
const manualPath = path.join(rootDir, 'src', 'lib', 'estimate-catalog-manual.json');
if (fs.existsSync(manualPath)) {
  const manual = JSON.parse(fs.readFileSync(manualPath, 'utf-8'));
  for (const [code, entry] of Object.entries(manual)) {
    if (catalog[code]) {
      // A real STEP 4 row now exists in the template — the manual sibling is
      // superseded. Surface it so the architect can retire it from the sidecar.
      console.warn(`NOTE: manual addition ${code} is now harvested from the template; consider removing it from estimate-catalog-manual.json`);
      continue; // template harvest wins (built-in authority)
    }
    catalog[code] = entry;
  }
  console.log(`* Re-injected ${Object.keys(manual).length} manual built-in(s) from estimate-catalog-manual.json`);
}
```

Also rewrite the FOOTGUN warning comment (lines 489–499) to state the trap is
disarmed: the 6 are preserved from the sidecar; to add/remove a manual addition,
edit `estimate-catalog-manual.json` (not the generated file).

> Note: the harvested-vs-manual collision branch prefers the **template** harvest
> (a built-in always wins), matching the architect-locked collision rule in
> `catalog.ts`. This is the same direction the runtime overlay already enforces.

### 4.3 NEW `src/lib/__tests__/catalogManualSidecar.test.ts`
A small guard that locks the migration in and prevents the two copies from drifting:

1. Every key in `estimate-catalog-manual.json` is present in `ESTIMATE_ITEMS_MASTER`
   and **deep-equals** the sidecar entry (the JSON's copy can't silently diverge).
2. The sidecar contains exactly the 6 known codes (pins the set).
3. Each sidecar entry's `procoreCode` passes `isValidProcoreCode` — so the merge
   can never silently inject a code with an invalid Procore destination (mirrors
   the assertion already in `catalogManualAdditions.test.ts`, now applied to the
   sidecar as the source of truth).

> **Overlap note:** `catalogManualAdditions.test.ts` already guards the 6 codes'
> *presence* in `ESTIMATE_ITEMS_MASTER`. The new test is complementary — it guards
> the *sidecar↔JSON integrity* (deep-equal + set-pin + valid-code), which the
> existing test does not. Acceptable to keep separate; could later fold both into
> one file. Not a blocker.

### 4.4 (Optional, deferred) AGENTS.md guardrail update
The existing AGENTS.md `sync-codes` clobber paragraph can later be softened to
"the harvest now preserves the 6 via `estimate-catalog-manual.json`." **Not done
in this change** to keep the diff minimal; called out as a one-line follow-up.

---

## 5. Why this cannot break the app (confidence basis)

1. **No runtime file changes.** `estimate-catalog.json` is not rewritten by this
   change. `ESTIMATE_ITEMS_MASTER` is byte-identical → the app, the calc engine,
   the exporter, and **both goldens** are provably unaffected.
2. **No consumer change.** All 7 readers keep reading the same 227-entry file.
   Nothing imports the new sidecar except the new guard test.
3. **The only behavioral change is to the harvest script** — the exact thing that
   was doing the clobbering — and its new output is *more* correct (227, not 221).
4. **The +1 guard test** asserts only what is already true today, so it is green on
   the first run.

---

## 6. Verification protocol (Definition of Done)

1. `npm run test` → **796 pass** (795 + 1 new guard), 0 fail.
2. `npx tsc --noEmit` clean; `npm run lint` introduces no new warnings.
3. **Live trap-disarm proof (throwaway):** copy the repo state, run
   `npm run sync-codes`, confirm the regenerated `estimate-catalog.json` has
   **227** keys with all 6 manual codes present and value-identical, then
   `git checkout -- src/lib/estimate-catalog.json` to discard the cosmetic
   key re-order. (We do **not** commit a regenerated catalog — the committed file
   stays exactly as-is.)
4. Goldens: `catalogPriceLookup` / `catalogRateSeed` / `rateCardSeed` /
   `constants` / `procore-type-reconciliation` all green (they pin 227).
5. Commit via message file (`git commit -F`), branch off `main` if needed.

---

## 9. Coordination with in-flight development (IMPORTANT)

This fix edits `scripts/harvest-cost-codes.js` and (optionally) `AGENTS.md`. Two
in-flight branches touch the same files:

- **`origin/claude/excel-roundtrip-export-wfezu4`** (the Excel round-trip PR queued
  for review/merge) — edits `harvest-cost-codes.js`, `AGENTS.md`, `catalog.ts`.
- **`estimate-ui-density`** (local, unmerged) — edits `harvest-cost-codes.js`,
  `estimate-catalog.json`.

**Separate, higher-priority hazard surfaced while checking this:** the Excel
round-trip branch forked from `b4639b0` (2026-06-11) and is **missing ~18 commits**
now on main — the **entire** procore-cost-codes workstream (PR #4, `e81b4d8`) and
the **entire** Template + Catalog Reconciliation workstream (Phases 1–6, `d1529a0`),
plus the guardrails commit `aaf403c`. A naive merge would **revert** all of it,
including re-opening this very clobber trap, deleting the AGENTS.md "Procore Cost
Code Authority" section, and reverting the linked-division valid-code-gate
exemption. **That PR must be rebased onto current main before merge regardless of
this fix.**

**Sequencing (recommended):**
1. Rebase + merge the Excel round-trip PR onto current main first (it needs this
   anyway).
2. Apply this catalog fix on top of the resulting main, on its **own small branch
   off `main`** (not the current `linked-values-system` branch).

This ordering means I edit the post-rebase harvest script, so there is **no merge
conflict** and the fix cannot be silently reverted by the stale branch. If this
fix lands first instead, whoever rebases the Excel PR MUST preserve the
merge-after-gate hunk in `harvest-cost-codes.js`.

## 7. Rollback

Single-commit, additive. Revert = delete the sidecar + new test and revert the
script hunk. No data, no schema, no runtime path touched, so rollback is risk-free.

---

## 8. Residual risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Future harvest re-orders catalog keys, producing a noisy git diff | Low | Cosmetic only; verified no consumer is order-sensitive. DoD step 3 discards the re-order. |
| A 7th manual addition is made but only added to the JSON, not the sidecar | Low | The new guard test pins the sidecar set; a JSON-only addition won't be protected and the FOOTGUN comment now points to the sidecar as the add path. |
| Sidecar and JSON copies drift apart | Low | Guard test deep-equals them. |
| A manual code later gains a real template row (collision) | Low | Script prefers the template harvest + logs a NOTE to retire the sidecar entry. |
