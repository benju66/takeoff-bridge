# The Correctness Contract — Takeoff Bridge Estimate Math

> **Status:** Phase 1 deliverable of the *Make the Math Trustworthy* plan
> (`docs/plans/make-the-math-trustworthy.md`). Written 2026-06-08. This document is the
> **specification** that Phases 2–5 are measured against.
>
> **What this is:** a plain-language statement of what "correct" *means* for the estimate
> math, written so each promise maps to an automated test. The executable half lives in
> `src/lib/__tests__/correctness-contract.test.ts` — each invariant below names the test that
> guards it.
>
> **Why it exists:** estimators will only abandon a spreadsheet they have trusted for years
> if the app produces *the same number to the penny* and lets them *see* how that number is
> built. This contract is the written promise; the golden harness (Phase 2) is the proof
> against a real bid; the glass-box UI (Phase 5) is how trust is earned by looking.

---

## How to read this

- The **single source of truth** for every financial value is `src/lib/calculations.ts`.
  Nothing else may invent a total, a markup, or a compounding formula.
- The **match bar** the whole system is held to: reproduce the live `STEP 4 - ESTIMATE`
  sheet of the McKenna oracle **to the cent — $0.01** (the existing
  `RECONCILIATION_TOLERANCE` in `exporter.ts`). Every "within $0.01" below is that same bar.
- **Number format:** US (comma thousands, dot decimal). **Negatives can appear** — as
  accounting parentheses `(1,234.50)` or a trailing/leading minus — and must be honored as
  negative, never silently turned positive.
- Each invariant has an ID (`INV-n`). Test descriptions reference these IDs so a failing
  test points straight back to the promise it breaks.

---

## Section 1 — Invariants

Each invariant is phrased as a promise and paired with the test that enforces it. Invariants
marked **(holds today)** are guarded by green tests on day one. Invariants marked
**(Phase 2)** / **(Phase 3)** are specified here and enforced when that phase lands; until
then their tests are recorded as `it.todo` placeholders so the suite stays green and the work
stays visible.

### INV-1 — Single total
**Promise.** The Total Estimated Cost a user sees on screen equals the total that is saved to
the database equals the total that is exported to Procore — all within $0.01.

- *On-screen == saved:* persistence round-trips numbers as-is (no re-derivation on save or
  load; line items load `ORDER BY sort_order ASC` and are not re-summed). A value is computed
  exactly once, by `computeTakeoffSummary`, and stored/displayed unchanged.
- *On-screen == exported:* `validateExportReadiness` (`exporter.ts:418`) already asserts
  `Σ line items + Σ GC + Σ Site Ops == Σ Procore rollup` within `RECONCILIATION_TOLERANCE`
  and blocks export on imbalance. The exporter only *rolls up*; it never re-derives a markup.

**Tests.** The engine-level half (the reported `subtotal` is the same basis the modifiers and
cost-per-SF/unit are computed on) is guarded by
`INV-1 single-total: reported subtotal is the modifier basis`, and the engine → export-rollup
half by `INV-1 full tie-out: on-screen subtotal == exported Procore rollup` (both in
`correctness-contract.test.ts`, run everywhere). **The full cross-layer tie-out to a REAL bid,
to the cent, is now LIVE** in the **Phase 2 golden harness**
(`src/__tests__/golden-mckenna.test.ts`): it reproduces the live McKenna `STEP 4 - ESTIMATE`
SUBTOTAL → 7 modifiers → TOTAL → cost/unit with **$0.00 residual** (skips cleanly where the
confidential fixture is absent). See **Section 4** for the dispositioned findings.

### INV-2 — Subtotal identity (incl. linked-row dedup) **(holds today)**
**Promise.** `subtotal == Σ(matchedQty × unitPrice)` over every **non-linked** row, **plus**
each linked division value counted **exactly once** — never the row's cached `total` field,
never a linked row's typed qty×price.

The subtotal decomposes exactly: `takeoffSubtotal` (non-linked rows) `+ linkedDivisionsTotal`
(linked values, deduped by `itemId`) `== subtotal` (at `roundingRule: "none"`).

**Test.** `INV-2 subtotal identity` — builds non-linked rows plus duplicate linked rows with a
known `linkedTotals` fixture and asserts the decomposition holds and ignores `row.total`.

### INV-3 — Explicit-zero protection **(holds today)**
**Promise.** A value a user *explicitly enters as `0`* is **never** silently replaced by a
default. An explicit `0%` GL or Fee stays `0` — only a genuinely *unset* (`null`/`undefined`)
rate falls back to a system default.

The engine honors this via nullish coalescing (`?? `, not `|| `), so `0` is preserved.

**Test.** `INV-3 explicit-zero protection` — passes a full rates object with
`glInsuranceRate: 0` and `feeRate: 0` and asserts both come back `0`, not the 1%/5% defaults.

> The contract **extends** this promise to the import/price path: a unit price the user typed
> as `0` must likewise survive (not be overwritten by a rate-card default). That extension is
> tracked in the silent-escape register (card-price defaulting) and made visible in Phase 5.

### INV-4 — Rounding neutrality **(holds today)**
**Promise.** No penny is created or lost between what is displayed and the total. Each of the
7 modifiers is rounded **independently** (`applyRounding`) *before* summing, and the Total
Estimated Cost equals the **exact arithmetic sum of the rounded components** —
`roundedSubtotal + Σ(rounded modifiers)`. The number shown for each line is the number that
went into the total.

**Test.** `INV-4 rounding neutrality` — uses `roundingRule: "dollar"` with rates chosen so
rounding actually moves values, then asserts `totalEstimatedCost` equals the sum of the
exact rounded fields the engine returns (subtotal + all 7 modifiers).

### INV-5 — Order independence **(holds today)**
**Promise.** Re-ordering the rows never changes the subtotal at the cent. The total must not
depend on floating-point summation order.

**Test.** `INV-5 order independence` — sums a set of fractional-dollar rows, then the same
rows reversed, and asserts the rounded subtotal and total are identical (and the raw
`takeoffSubtotal` agrees within $0.01).

> **Watch-item (from the plan).** If the Phase 2 McKenna run ever reveals order-sensitivity at
> the cent, switch to an order-insensitive summation. The guard test is the tripwire.

### INV-6 — Linked-row non-duplication **(holds today)**
**Promise.** A linked division row (the 10 GC / Site Ops STEP 4 rows, `isLinkedDivisionRow`)
contributes **only** its computed STEP 2/3 value — its own typed `matchedQty × unitPrice`
**never** enters any total, and a duplicated linked `itemId` is counted once. This closes the
double-count trap: the same dollars cannot appear both as a STEP 2/3 line *and* as a typed
STEP 4 row.

**Test.** `INV-6 linked-row non-duplication` — puts large stray typed dollars on a linked row
and a duplicate of it, and asserts only the single linked value counts.

### INV-7 — Provenance completeness
**Promise.** Every row carries a `source` (`'template' | 'csv_import' | 'manual' |
'ai_suggestion'`), and every persisted number can be traced to where it came from
(template / import / manual / — Phase 4 — override). No row is born without provenance.

Assignment points (AGENTS.md): template-initialized → `'template'`; parser output →
`'csv_import'`; context-menu insert → `'manual'`. Undo must restore the original `source`.

**Tests.** Today this is enforced by the type system plus the ingestion/command paths (rows
are born with a `source`, and `MERGE_TAKEOFF_DATA` captures `source` in
`prev/nextRowStates`). A focused day-one guard for the *display* side is out of scope for the
pure calc layer; the visible badge per provenance is **Phase 5**. Recorded here as `it.todo`
to keep the promise on the board.

### INV-8 — Loud failure on import **(Phase 3)**
**Promise.** No import row that carries data silently disappears, and no number silently flips
sign.

- *No dropped rows:* a parsed row with a **valid cost code but no matching template row**
  (`targetIdx === -1`) must be **appended to the grid** (visible, provenance `'csv_import'`,
  recorded via `commandHistory.pushCommand` for atomic undo) — never dropped. A parsed row
  with **no cost code** keeps surfacing its classification name **and** carries its quantity
  into the override surface, so nothing is lost.
- *No silent sign flip:* an accounting-negative `(1,234.50)` or trailing-minus `1,234.50-`
  parses to **−1234.50**, so a credit *reduces* the subtotal. Anything genuinely ambiguous
  **fails loud** — it routes to the interactive override interface rather than guessing.

**Tests.** Specified here; **implemented in Phase 3** (new `parser-numbers.test.ts` and an
import-integrity test). Recorded in the contract test file as `it.todo` until then.

---

## Section 2 — Single source of truth, and what is forbidden to invent

**`src/lib/calculations.ts` is the sole authority on financial values.** Specifically it owns:
- the takeoff subtotal and the 10 linked-division values (`computeTakeoffSummary`,
  `computeLinkedDivisionTotals`);
- the 7 modifiers and their rounding (`applyRounding`), the Total Estimated Cost, cost/SF,
  cost/unit;
- the GC and Site Ops line math (`computePersonnelCosts`, `computeSiteOperations`).

Rates may be *layered in* by the caller (project override `??` company rate-card `??` constant
default) and *passed in* as plain inputs — but the **arithmetic that turns inputs into dollars
lives only here.**

**Forbidden — no other file may:**
1. **Invent or alter a total, subtotal, markup %, or compounding formula.** The exporter, the
   parser, the hooks, the components, and the DB layer consume calc outputs; they never
   re-derive them.
2. **Re-derive a markup in the exporter.** `exporter.ts` only **rolls up** existing line
   dollars into the 217 granular Budget Line Item codes and writes them **as values** (no
   surviving SUMIF). It reconciles (`validateExportReadiness`) but never recomputes a rate.
3. **Recompute on save or load.** `db.ts` / the `save_estimate` RPC persist numbers as-is and
   load them `ORDER BY sort_order ASC`; a number is not re-summed on round-trip.
4. **Default a financial input silently.** Any fallback (unset modifier rate, rate-card price
   miss) must be *visible* as a default, not silently substituted (see Section 3 and Phase 5).
5. **Guess a missing mapping or an ambiguous number.** Missing/ambiguous data routes to the
   interactive override interface — "No AI Autonomy Over Financials" (AGENTS.md).

This restates the AGENTS.md / CLAUDE.md guardrails as a testable contract: the calc engine is
the one place a dollar figure is *made*.

---

## Section 3 — Silent-escape register

Every place a wrong or missing number can escape today, and how each is made to fail loud.
This is the punch-list the later phases work down. **#5 and #3 are SPECIFIED here and
IMPLEMENTED in Phase 3** — they are not changed in Phase 1.

| # | Escape | Where | Today (silent) | Made loud by |
|---|--------|-------|----------------|--------------|
| **#5** | **Sign corruption on import** | `parser.ts:45-50` (`parseCleanFloat`) | `String(val).replace(/[^0-9.-]/g, '')` strips the parens off `"(1,234.50)"` → parses **+1234.50**; a trailing minus `"1,234.50-"` is dropped by `parseFloat` → **+1234.50**. A credit silently *adds* to the bid. | **Phase 3.** Rewrite to detect accounting `( … )` and leading/trailing minus → negative, strip US thousands separators, parse the decimal; return a sentinel that **routes to override** on anything ambiguous (never guesses). Guard: `parser-numbers.test.ts`. |
| **#3** | **Silent row drop on import** | `useFileIngestion.ts:162-178` (`mergeTakeoffData`) | A parsed row with a *valid* `itemId` but no matching template row (`targetIdx === -1`) falls through the `if (targetIdx !== -1)` with **no else** — not merged, not added to `unmappedList`. A correctly-classified quantity vanishes with zero indication. | **Phase 3.** Append such a row to the grid (`source:'csv_import'`, all non-nullable `ProcessedTakeoffRow` fields initialized, placed in its division) **and** record it on the same `MERGE_TAKEOFF_DATA` command via `pushCommand` (full inverse data → one Ctrl+Z reverses the whole merge). For a row with **no** `itemId`, also carry its *quantity* into the override surface (today only the name survives). Guard: import-integrity test. |
| **(visibility)** | **Unset-modifier defaulting** | `calculations.ts:349-356` | When the whole `rates` object is absent, `glInsuranceRate ?? 0.01` and `feeRate ?? 0.05` quietly apply 1% / 5%. **Correct** (and required by INV-3, which protects explicit `0`), but a *defaulted* rate is indistinguishable on screen from a *typed* one. | **Make it visible, not silent (Phase 5).** Flag a modifier whose rate fell back to a system default (`⚙ system default` vs `✎ project-set`) in the glass-box trace. No math change — this is a transparency fix. INV-3 already guards that an *explicit* `0` is never defaulted. |
| **(visibility)** | **Card-price defaulting** | `parser.ts:119` (`resolveCatalogPrice(itemId, masterItem?.defaultUnitPrice \|\| 0)`); resolver fallback | A unit price is filled from the rate card or, on a card miss / unprimed resolver, from the catalog default or `0` — silently. An estimator can't tell a price they *typed* from one the card *supplied* from a defaulted `0`. | **Make it visible, not silent (Phase 5).** Badge a price by origin (rate-card vs typed vs defaulted). Extend INV-3 so a user-typed `0` price survives a later card resolve. No math change in Phase 1. |

**Legend of dispositions:** *Phase 3* = behavior changes (loud failure / no drop).
*Visibility (Phase 5)* = the number is already correct; the fix is to *show* that it was
defaulted so trust is earned by looking, not by faith.

---

## Section 4 — Golden reproduction: McKenna findings (Phase 2)

> Added at the close of Phase 2 (2026-06-08). Oracle = the live `STEP 4 - ESTIMATE` tab of
> `McKenna Crossing Estimate.xlsx` (McKenna Crossing Terrace II: 129,981 SF, 72 units, 13-month
> duration, Construction Contingency 1.5% / GL 1% / Fee 4%). The harness reads both inputs and
> expected outputs from that one git-ignored file; no bid figure is committed.

**Headline — the keystone ties to the cent (actually to $0.00).** Fed the extracted STEP 4 line
items (including the 10 GC/Site-Ops linked-row values Excel pulled from STEP 2/3) and the STEP 1
modifier rates, `computeTakeoffSummary` reproduces the bid exactly:

| Output | Engine | Oracle | Δ |
|---|---|---|---|
| STEP 4 SUBTOTAL | 16,054,166.367222 | 16,054,166.367222 | $0.00 |
| Total Estimated Cost | 17,097,687.181092 | 17,097,687.181092 | $0.00 |
| Cost / Unit | 237,467.877515 | 237,467.877515 | $0.00 |
| Each of 7 modifiers (CC/GL/Fee non-zero) | — | — | ≤ $0.01 |

This is the trust artifact: on a real completed bid, the app's number equals the spreadsheet's
to the penny.

**Dispositioned residual differences** (each triaged per the plan as engine bug / extraction
error / legitimate Excel-vs-JS difference):

| # | Finding | Disposition |
|---|---------|-------------|
| **G-1** | **Excel applies NO rounding** to its modifier/total cells. With the app's `"dollar"` rounding rule the total would diverge by ~$0.18 on this bid (up to ~$0.50 per modifier). | **(c) Legitimate Excel-vs-JS difference.** The harness runs `roundingRule: "none"` to match the spreadsheet exactly. Ties to the INV-4 watch-item: a project configured to round will *intentionally* differ from an unrounded sheet — that is a setting, not a bug. |
| **G-2** | **STEP 2/3 are hand-authored**, not generated by the app's parametric GC/Site-Ops driver model (e.g. the bid's *Small Tools* qty = months directly, where the app drives it by months × superintendent-utilization; *Safety Consultant* is entered as % × whole-job basis). So `computePersonnelCosts` / `computeSiteOperations` are **not** expected to reproduce this bid's STEP 2/3 *totals* from clean parametric inputs. | **(c) Legitimate model difference.** The app's GC/Site-Ops engine is a parametric *input aid*, not a re-derivation of a hand-built sheet. The harness therefore takes the 10 linked-division values from the sheet (the template's own STEP 2/3 → STEP 4 linkage) and **ties each STEP 2/3 section subtotal to its STEP 4 linked row** — 9 of 10 match to the cent; see G-3. Deep parametric reconstruction is explicitly out of scope for the golden tie-out. |
| **G-3** | **Special Inspections linked row** (`02-9500.008`) carries qty 0 on STEP 4 (→ $0) and its STEP 3 section subtotal cell (I82) has no cached result, and the template links the row to `I81` rather than the section total — a known single-cell template quirk. | **(c) Dispositioned.** Contributes $0 to the subtotal either way (qty 0), so it does not affect the keystone tie-out. The linkage assertion covers the other 9 linked rows; this one is skipped, not failed. |
| **G-4** | **The bid's Budget Line Items rollup is `#REF!`-broken** — 112 of 217 code rows have no cached numeric value (their `SUMIF`s reference deleted cells). | **Recorded, not asserted.** This is the concrete reason the exporter rewrites every BLI row as a **computed value** (no surviving `SUMIF`). The export reconciliation is proven instead by the engine identity Σ(line items) == SUBTOTAL (above) plus `export-integrity.test.ts`'s 217-row value tie-out on synthetic data. |
| **G-5** | **STEP 4 is row-shifted**: this bid's SUBTOTAL sits at row 328, not the blank template's 331 (rows were deleted upstream). | **(b)→resolved by design.** Confirms the "scan, never hardcode rows" requirement. The extractor locates SUBTOTAL/TOTAL/modifier/section anchors by **label and cost-code pattern**, so it survives the shift; no row numbers are hardcoded. |

**Net:** zero engine bugs surfaced. Every difference is either a deliberate app setting (G-1
rounding), a deliberate model boundary (G-2/G-3 the parametric GC aid vs a hand-built sheet), or
a defect in the *source spreadsheet* that the app already corrects (G-4 broken BLI). The engine's
STEP 4 math reproduces the real bid to $0.00.

---

## Appendix — invariant → test map

| Invariant | Status | Test (in `correctness-contract.test.ts` unless noted) |
|---|---|---|
| INV-1 Single total | engine + export-rollup guards today; **real-bid tie-out LIVE (Phase 2)** | `INV-1 single-total: reported subtotal is the modifier basis`; `INV-1 full tie-out: on-screen subtotal == exported Procore rollup`; real-bid = `golden-mckenna.test.ts` (ties McKenna to $0.00, skips without fixture) |
| INV-2 Subtotal identity | holds today | `INV-2 subtotal identity` |
| INV-3 Explicit-zero protection | holds today | `INV-3 explicit-zero protection` |
| INV-4 Rounding neutrality | holds today | `INV-4 rounding neutrality` |
| INV-5 Order independence | holds today | `INV-5 order independence` |
| INV-6 Linked-row non-duplication | holds today | `INV-6 linked-row non-duplication` |
| INV-7 Provenance completeness | type + ingestion today; badge Phase 5 | `it.todo` placeholder |
| INV-8 Loud failure on import | Phase 3 | `it.todo` placeholders (→ `parser-numbers.test.ts`, import-integrity test) |
