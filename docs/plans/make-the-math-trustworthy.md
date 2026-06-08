# Plan — Make the Estimate Math Provably Correct, and Visibly Trustworthy

> **Status:** APPROVED 2026-06-08 (architect: Lochness). This is the canonical
> phased-handoff doc. Run **one phase per fresh context window** — see "Working agreement"
> below. Each phase's kickoff prompt is reconstructable from its "Cold-start brief".

---

## Context — why we are doing this

Takeoff Bridge exists to move our estimators off siloed Excel and onto a structured
app that exports to Procore. They will only abandon a spreadsheet they have trusted for
years if the app can prove, on a real bid, that it produces **the same number to the
penny** — and then let them *see* how that number is built so trust is earned by looking,
not by faith.

Today the calculation engine (`src/lib/calculations.ts`) is the single authority and is
well-structured, but three things block estimator trust:

1. **No proof against reality.** Every test today uses synthetic rows. Nothing yet runs a
   *real completed bid* through the engine and proves it matches the company Excel
   template to the cent. That proof is the keystone trust artifact — and it does not exist.
2. **Two ways a wrong/missing number escapes silently** (both confirmed in code):
   - **#5 — sign corruption on import.** `parseCleanFloat` (`src/lib/parser.ts:45-49`)
     strips everything except digits/dot/minus, so an accounting-negative `"(1,234.50)"`
     becomes **+1234.50**. A credit silently *adds* to the bid.
   - **#3 — silent row drop on import.** In `mergeTakeoffData`
     (`src/hooks/useFileIngestion.ts:162-178`), a parsed row that has a *valid* cost code
     but no matching template row (`targetIdx === -1`) is dropped with **zero indication** —
     it is not merged and not added to the unmapped warning list. A correctly-classified
     quantity simply vanishes.
3. **The math is a black box.** Totals are computed correctly but the estimator cannot
   trace a total down to its inputs, cannot *see* the export reconciliation that already
   runs silently, and cannot tell a value that was *defaulted/imported* from one they
   *typed*.

This plan makes the math **provably correct** (a contract + a real-bid golden harness) and
**visibly correct** (override/audit + a glass-box UI). It is sequenced so the contract and
the reproduction harness come first.

### Decisions locked with the architect (2026-06-08)
- **Reproduction target:** the **live `STEP 4 - ESTIMATE`** sheet of
  `McKenna-Crossing-Estimate.xlsx` (still formula-linked to STEP 1/2/3 + Budget Line Items,
  so both inputs and outputs are reconstructable).
- **Match bar:** **exact to the cent — $0.01 tolerance** (same as the existing
  `RECONCILIATION_TOLERANCE`). This is the bar the golden test enforces.
- **Import data shape:** US format (comma thousands, dot decimal); **negatives can appear**
  as parentheses or trailing minus. Fix honors those as negative, keeps US parsing, and
  **fails loud** (routes to override) on anything ambiguous — never guesses.

### Hard guardrails this plan obeys (from AGENTS.md / CLAUDE.md)
- `src/lib/calculations.ts` is the **sole authority** on financial values — no other file
  invents totals, markups, or compounding.
- All DB access routes through `src/lib/db.ts`. Line-item writes use the `save_estimate`
  RPC only. **Any** schema change updates `supabase_schema.sql` **first** + gets explicit
  approval before execution.
- `estimate_snapshots` and `classification_history` are **append-only**.
- `npm run test` must be green before every commit; run `/code-review` before delivery.
- Confidential bid pricing **never** enters git.

---

## Phase 0 — Research findings (complete; no code changed)

Plain-language map of how a number is born, saved, and exported today.

**The number's life:**
1. **Import** — `parseTogalCSV`/`parseTogalXLSX` read a takeoff file. Per row,
   `matchedQty = parseCleanFloat(quantity)`, `unitPrice = resolveCatalogPrice(itemId, …)`,
   `total = qty × price`. Provenance set to `'csv_import'`. *(Bugs #5 and #3 live here.)*
2. **Edit** — every cell edit flows through `commitCellEdit`
   (`src/hooks/useCellEditing.ts`) → recomputes `total = matchedQty × unitPrice`, captures a
   `WorkbookCommand` with cascade/move effects, and `pushCommand`s it for atomic undo/redo.
   Integrity here is solid.
3. **Summarize** — `computeTakeoffSummary` (`calculations.ts:314`) is the heart:
   - `subtotal = Σ(matchedQty × unitPrice)` over **non-linked** rows + the 10 **linked
     division** values (GC + Site Ops), each counted **once** (`Set`-deduped). Linked rows'
     own qty×price never count — the double-count trap is closed.
   - Each of 7 modifiers = `subtotal × rate`, **rounded independently** via `applyRounding`
     (`Math.round` for "dollar", etc.) *before* summing.
   - `totalEstimatedCost = roundedSubtotal + Σ(rounded modifiers)`.
   - Rates use `??` (nullish), so an explicit `0` is preserved; only a genuinely *unset*
     GL/Fee falls back to 1%/5% (`calculations.ts:353-355`).
4. **GC / Site Ops** — `computePersonnelCosts` + `computeSiteOperations` build STEP 2/3
   line detail; `computeLinkedDivisionTotals` maps their subtotals into the 10 STEP 4
   linked rows. Invariant (tested): the 10 linked values sum exactly to GC + Site Ops grand
   totals.
5. **Persist** — `saveEstimate` → atomic `save_estimate(p_estimate, p_items)` RPC; loaded
   back `ORDER BY sort_order ASC`. Numbers round-trip as-is (a value corrupted on import
   stays corrupted forever).
6. **Export** — `exporter.ts` rolls STEP 4 + GC/Site Ops up into the 217 granular Budget
   Line Item codes, writes them as **values** (no surviving SUMIF), and
   `validateExportReadiness` checks `Σ line items + GC + Site Ops == Σ rollup` within $0.01,
   blocking export on imbalance. **This reconciliation runs but is never shown to the user.**

**Existing assets we will reuse (do not rebuild):**
- `src/lib/xlsx-reader.ts` — already reads `.xlsx` and extracts cell *results* (the
  extractor in Phase 2 extends its `extractCellValue` to also capture *formula text*).
- `src/__tests__/export-integrity.test.ts` — already loads the **blank** master template
  and asserts cell-level tie-outs with ExcelJS. The golden harness mirrors its patterns on a
  **real completed** bid.
- `validateExportReadiness` (`exporter.ts:418`) returns the reconciliation object the
  Visual UI will simply *display*.
- `computeTakeoffSummary` already exposes `takeoffSubtotal` and `linkedDivisionsTotal`
  separately, plus `computeDivisionBreakdown` / `computeCostTypeBreakdown` — the click-to-trace
  UI is mostly a *view* over data the engine already returns.
- `estimate_snapshots` table + `createEstimateSnapshot/getEstimateSnapshots` in `db.ts`
  (built, append-only, partially wired — a `pre_import` snapshot already fires on import) —
  the audit backbone.

---

## Execution sequence (how the mission's phases map to shippable work)

The mission framed five concerns. Re-sequenced so each phase is independently shippable and
**green at commit**, with the contract and harness first:

| Order | Phase | Mission concern |
|---|---|---|
| 1 | **Correctness Contract** (doc + guard tests) | Phase 1 |
| 2 | **Reproduction Harness** (fixtures + extractor + golden tests) | Phase 2 |
| 3 | **Fail-Loud Hardening** (implement #5 then #3) | Phase 1's "fail loud, not silent" |
| 4 | **Override + Audit Model** | Phase 3 |
| 5 | **Visual Trust UI** (glass box — *design only* in this plan) | Phase 4 |

### Working agreement — one phase per fresh session
By the architect's preference, **each phase runs in its own fresh context window**, cold.
To make that reliable:
- This canonical plan — plus `CLAUDE.md`, `AGENTS.md`, and `memory/` — is the durable anchor
  every fresh session reads first.
- **Every phase ends** by: running `npm run test` to green, committing, and writing a short
  **handoff note** (project `handoff` convention / `handoff` skill) that tells the *next*
  fresh session exactly where to start and what changed.
- **Every phase begins** in a new window by reading: this plan → the latest handoff note →
  the "Cold-start brief" line in the phase below → the named source files. No phase assumes
  memory of a prior session's conversation.
- Phases are strictly ordered (1→5); do not start a phase until the prior one is committed
  green. Phase 4 additionally pauses for schema approval before any DB change.

---

## Phase 1 — The Correctness Contract

> **Cold-start brief:** Read `docs/correctness-contract.md` (may not exist yet — you create
> it), `src/lib/calculations.ts`, and `src/lib/__tests__/calculations.test.ts`. No prior
> phase. Output: the contract doc + guard tests. No behavior change.

**Goal:** Write down, in one place, what "correct" *means* — as invariants that can each be
tested — and lock today's correct behavior in with guard tests so no future change can
silently regress it. **No behavior change in this phase.**

**Deliverable A — `docs/correctness-contract.md`** (plain language). Sections:

1. **Invariants** — each phrased so it maps to a test. Starting set:
   - *Single total:* on-screen Total Estimated Cost == saved total == exported total
     (within $0.01).
   - *Subtotal identity:* subtotal == `Σ(qty × price)` over non-linked rows + linked
     division values, each counted once.
   - *Explicit-zero protection:* a value the estimator explicitly enters as `0` is **never**
     silently replaced by a default. (Engine already honors this via `??`; the contract
     makes it a tested promise and extends it to the import/price path.)
   - *Rounding neutrality:* the rounded components sum to the rounded total with no penny
     created or lost; modifiers round independently and tie to the template.
   - *Order independence:* re-ordering rows never changes the subtotal (guards
     floating-point summation order).
   - *Linked-row non-duplication:* a linked division's typed qty×price never enters any
     total; its STEP 2/3 value is its only representation.
   - *Provenance completeness:* every row carries a `source`; every persisted number can be
     traced to template / import / manual / override.
   - *Loud failure:* no import row with data silently disappears; no value silently flips
     sign. (Specifies the required behavior that Phase 3 implements.)
2. **Single source of truth** — `calculations.ts` for all financials; explicit "forbidden
   to invent" list (no totals/markups/formulas anywhere else; exporter only *rolls up*,
   never *re-derives* a markup).
3. **Silent-escape register** — a table of every place a wrong/missing number could escape
   today and how each is made to fail loud. Seeds: #5 (sign), #3 (dropped row), unset
   modifier defaulting (visibility), card-price defaulting (visibility).

**Deliverable B — guard tests** in `src/lib/__tests__/correctness-contract.test.ts` that
encode the invariants that **already hold** (subtotal identity, rounding neutrality, order
independence, linked non-duplication, explicit-zero in the engine). These pass on day one
and are the executable contract. The fail-loud invariants (#5/#3) are written here too but
referenced as "implemented in Phase 3."

**Files:** new `docs/correctness-contract.md`; new
`src/lib/__tests__/correctness-contract.test.ts`. Reuse the `makeRow` factory pattern from
`calculations.test.ts`.

**Done when:** contract doc reviewed by architect; guard tests green; `npm run test` green.

**Handoff:** the contract doc is the spec Phases 2–5 are measured against.

---

## Phase 2 — The Reproduction Harness  ⭐ keystone

> **Cold-start brief:** Read this plan + Phase 1's handoff note + `docs/correctness-contract.md`,
> then `src/lib/xlsx-reader.ts`, `src/lib/calculations.ts`, and
> `src/__tests__/export-integrity.test.ts` (the pattern to mirror). The oracle file is at
> `C:\Users\BUrness\takeoff-bridge-fixtures\McKenna-Crossing-Estimate.xlsx`; reproduce its
> live `STEP 4 - ESTIMATE` to **$0.01**.

**Goal:** Prove, on the real McKenna bid, that the engine reproduces the Excel template's
`STEP 4 - ESTIMATE` to the cent — and build that proof as **reusable machinery** (the same
extractor a future "upload past estimates as projects" feature will use).

**Step 2.1 — Confidential fixtures, never in git.**
- Add to `.gitignore`: `/fixtures/golden/` (and `*.xlsx` under it).
- Create `fixtures/golden/.gitkeep` + `fixtures/golden/README.md` explaining the folder
  holds real bid files and is git-ignored.
- Resolution order for the oracle file: env var `TAKEOFF_GOLDEN_XLSX` → `fixtures/golden/
  McKenna-Crossing-Estimate.xlsx` → the architect's master copy at
  `C:\Users\BUrness\takeoff-bridge-fixtures\McKenna-Crossing-Estimate.xlsx`.
- **No confidential number is ever hardcoded in a committed test.** The golden test reads
  *both* the inputs and the expected outputs *from the same gitignored file*, so the
  repo never contains a bid figure.

**Step 2.2 — The reusable extractor** — `src/lib/templateExtractor.ts`.
- Extends `xlsx-reader.ts`'s `extractCellValue` to capture **both** formula text and cached
  result (today it returns only the result).
- Reads a template-format workbook into a typed `ExtractedEstimate`:
  - **Inputs:** STEP 1 project data (sqft, unit count, start/finish dates → `durationMonths`
    via `getMonthsBetween`, the 7 modifier rates at G18–G24); STEP 4 line items (cost code +
    qty + unit price, located by scanning the cost-code column the way the exporter matches
    by `itemId` — *not* by hardcoded row numbers, so it survives template row shifts); STEP 2
    staff utilizations/rates/equipment/manual entries; STEP 3 site-ops quantities/rates/manual.
  - **Expected outputs (the oracle):** STEP 2 grand total + supervision subtotal, STEP 3
    section + grand totals, the 10 linked division values (STEP 4 rows 12–24), the STEP 4
    subtotal cell, each modifier $ cell, total estimated cost, cost/SF, cost/unit, and the
    Budget Line Items grand total.
- Designed as a library module (not test-only) so the future import-past-estimates feature
  reuses it verbatim.

**Step 2.3 — The golden test** — `src/__tests__/golden-mckenna.test.ts`.
- `describe.skipIf(!fixtureExists)` so the suite stays green for anyone without the file
  (CI, other machines) — it skips, never fails, when the oracle is absent.
- **Engine half:** feed extracted inputs through `computePersonnelCosts`,
  `computeSiteOperations`, `computeLinkedDivisionTotals`, `computeTakeoffSummary`; assert
  every output equals the extracted oracle cell **within $0.01**.
- **Export half:** run the same inputs through `rollupByProcoreCode` + `rollupGcSiteOps`
  (and/or `generateExcelWorkbook` read back via ExcelJS, mirroring `export-integrity.test.ts`);
  assert the Budget Line Items grand total ties to the oracle within $0.01.

**Step 2.4 — First run is a discovery event.** The first golden run will likely surface
mismatches. Each is triaged as: (a) an **engine bug** to fix, (b) an **input we extract
wrong**, or (c) a **legitimate Excel-vs-JS rounding difference** to document in the contract.
Output of this step: a short findings note appended to the contract listing every delta and
its disposition. *This is the moment that earns estimator trust — it tells us exactly where,
if anywhere, the app and the spreadsheet disagree.*

**Files:** `.gitignore` (edit); `fixtures/golden/{.gitkeep,README.md}` (new);
`src/lib/templateExtractor.ts` (new); `src/__tests__/golden-mckenna.test.ts` (new).

**Done when:** golden test runs against McKenna and either ties to the cent or every
residual delta is explained and dispositioned in the contract; `npm run test` green (suite
skips cleanly where the file is absent).

**Architect handoff (minimal):** nothing — the master file already lives at
`C:\Users\BUrness\takeoff-bridge-fixtures\…`; the test reads it there by default. Optionally
copy it into `fixtures/golden/` (git-ignored) for portability.

---

## Phase 3 — Fail-Loud Hardening (the contract made real)

> **Cold-start brief:** Read this plan + Phase 2's handoff note, then `src/lib/parser.ts`
> (lines ~45-49, 104-120) and `src/hooks/useFileIngestion.ts` (lines ~113-220). Decisions:
> US format, negatives can appear → honor `()`/trailing-minus, fail loud on ambiguous.
> The Phase 2 golden harness must still tie to the cent after these fixes.

**Goal:** Turn the two silent-escape paths into loud, recoverable ones. Each fix ships with
a red→green test, and the golden harness guards against regressions.

**Fix #5 — sign-safe US number parsing** (`src/lib/parser.ts:45-49`).
- Rewrite `parseCleanFloat` to: detect accounting-negative `( … )` and trailing/leading
  minus → negative; strip US thousands separators; parse the decimal. If the cleaned string
  is ambiguous (e.g., looks non-US, multiple separators it can't resolve), return a
  sentinel that routes the row to the override interface rather than guessing.
- New `src/lib/__tests__/parser-numbers.test.ts`: `"(1,234.50)" → -1234.50`,
  `"-1,234.50" → -1234.50`, `"1,234.50- " → -1234.50`, `"1,234.50" → 1234.50`,
  ambiguous → flagged. Confirms a credit now *reduces* the subtotal.

**Fix #3 — no silent row drop** (`src/hooks/useFileIngestion.ts:162-178`).
- For a parsed row with a **valid itemId but `targetIdx === -1`** (no template row to merge
  into): **append it to the grid** as a new row (`source:'csv_import'`, all non-nullable
  `ProcessedTakeoffRow` fields initialized per AGENTS.md), placed in its division — so its
  quantity is preserved and visible — **and** record the structural change via
  `commandHistory.pushCommand` with full inverse data (AGENTS.md compounding-history rule),
  embedded in the same `MERGE_TAKEOFF_DATA` command.
- For a parsed row with **no itemId** (unmapped classification): keep surfacing the
  classification name, but also carry its **quantity** into the override surface (today only
  the name is shown; the quantity is lost), so the estimator can map-and-place without
  re-importing.
- New integration test in `src/hooks/__tests__/` (or `src/__tests__/`): import a file whose
  rows include (a) a valid code absent from the template and (b) an unmapped classification;
  assert neither vanishes and both are visible/recoverable; assert one Ctrl+Z cleanly
  reverses the whole merge.

**Files:** `src/lib/parser.ts`; `src/hooks/useFileIngestion.ts`; two new test files. No DB
or schema change.

**Done when:** new tests + contract fail-loud invariants green; golden harness still ties to
the cent; `npm run test` green; `/code-review` clean.

---

## Phase 4 — Override + Audit Model

> **Cold-start brief:** Read this plan + Phase 3's handoff note, `supabase_schema.sql`,
> `src/lib/db.ts` (snapshot + estimate functions), and the `estimate_snapshots` /
> `classification_history` table defs. **Invoke the `supabase:supabase` skill before
> touching DB code. Pause for architect schema approval before any DDL.**

**Goal:** Let an estimator override any computed value when their judgment differs, and
record every override and change so a bid can later be explained and defended — without ever
letting an override silently overwrite the computed value (both stay visible).

**Design (recommended):**
- **Override record (per overridden value):** `{ field, computedValue, overrideValue,
  reason, who, when }`. The engine uses `overrideValue` in place of the computed value but
  **always carries the computed value alongside** (the glass-box UI shows both with a clear
  "overridden" flag). This generalizes the pattern the template already uses for the two
  hand-typed %-of-estimate lines.
- **Storage — schema change, gated.** Recommended: a new **append-only** `estimate_overrides`
  table (one immutable row per override event — consistent with the append-only audit ethos
  of `classification_history`/`estimate_snapshots`). **Before any code:** update
  `supabase_schema.sql` first and get explicit architect approval (guardrail). All reads/writes
  through `db.ts`; line-item writes still only via `save_estimate`.
  *(Lighter alternative if we want zero new tables: a JSONB `overrides` field on
  `project_estimates`/`custom_fields`. Recommend the dedicated table for a real audit trail.)*
- **Change history — reuse what exists.** `estimate_snapshots` already captures append-only
  point-in-time milestones and a `pre_import` snapshot already fires on import. Extend the
  wiring to capture milestone snapshots at save/export so a bid's evolution is reconstructable.
  Session-level edits remain covered by the existing command history.

**Done when:** override round-trips (set → save → reload → still applied, computed value
still shown); audit entries are immutable; schema file + live DB match; tests green.

**Handoff:** this is the data layer the Visual UI's "overridden" flags and reconciliation
panel read from. **Stop for architect approval at the schema gate before writing DDL.**

---

## Phase 5 — Visual Trust UI (glass box) — *design only in this plan*

> **Cold-start brief:** Read this plan + Phase 4's handoff note, then the estimate UI
> (`src/app/projects/[projectId]/page.tsx`, `src/components/EstimateTable.tsx`,
> `src/hooks/useTakeoffWorkbook.tsx`) and `validateExportReadiness` in `src/lib/exporter.ts`.
> This phase produces a design + a follow-up build plan, not shipped UI.

**Goal:** Make every number's construction visible, so trust is earned by looking. Per the
mission, this phase is **described, not built** here; we refine the interaction design
together before any code. Three surfaces, each largely a *view* over data the engine already
returns:

**5a — Click-to-trace.** Click any total → a trace panel unfolds its formula down to inputs.
Uses `computeTakeoffSummary`'s already-exposed `takeoffSubtotal` / `linkedDivisionsTotal`
and `computeDivisionBreakdown` / `computeCostTypeBreakdown`.

```
 Total Estimated Cost ........ $X,XXX,XXX        [click a row to drill ↓]
 ├─ Subtotal ................. $X,XXX,XXX
 │   ├─ Takeoff (Σ qty×price)  $X,XXX,XXX  →  [N rows]  ┐ click → list of
 │   └─ Linked divisions ..... $  XXX,XXX  →  GC+SiteOps ┘ contributing rows
 ├─ Construction Conting. (3%) $   XX,XXX   (rate: project-set ✎ / system default ⚙)
 ├─ Fee (5%) ................. $   XX,XXX   (rate: system default ⚙)
 └─ … 5 more modifiers
```

**5b — Reconciliation view (cheap, high-trust).** Surface the *already-running*
`validateExportReadiness` result instead of hiding it behind the export gate:

```
 ┌─ Procore Reconciliation ─────────────────────────────┐
 │  On-screen Total Estimated Cost ......  $X,XXX,XXX    │
 │  Exported Procore rollup total .......  $X,XXX,XXX    │
 │  Difference ..........................  $0.00   ✅ TIES │
 └──────────────────────────────────────────────────────┘
```

**5c — Provenance & override flags.** Color/badge every cell by `source`
(template / imported / manual / overridden — data already on each row), and flag values
that were *defaulted* (modifier rate fell back to system default; price came from the rate
card vs typed) vs *entered*. Overridden cells show computed-vs-override on hover (Phase 4).

```
 Legend:  ▦ template   ⬚ imported   ✎ manual   ⚑ overridden   ⚙ system default
```

**Done when:** architect approves the interaction design; then a follow-up build plan is
written per the phased-handoff convention.

---

## Verification (end to end)

- **Per phase:** `npm run test` green before each commit; `/code-review` before delivery.
- **Phase 1:** contract guard tests green; architect reviews `docs/correctness-contract.md`.
- **Phase 2:** `src/__tests__/golden-mckenna.test.ts` ties McKenna engine + export outputs to
  the oracle within **$0.01**, or every residual delta is documented and dispositioned. Suite
  skips cleanly on machines without the fixture (verify by temporarily unsetting the path).
- **Phase 3:** new parser-number and import-integrity tests green; manually import a file
  containing a parenthesized credit and an off-template valid code → confirm the credit
  reduces the subtotal and neither row vanishes; golden test still ties.
- **Phase 4:** override set → save → reload persists and still shows the computed value;
  audit rows immutable; `supabase_schema.sql` matches live DB (`list_tables`/advisors).
- **Phase 5:** design walkthrough with architect; reconciliation panel shows a real tie-out.

## Risks / watch-items
- **Float summation order** — guard test in Phase 1; if McKenna reveals order-sensitivity,
  consider a sum that is order-insensitive at the cent.
- **Excel-vs-JS rounding** — Phase 2.4 will tell us if any modifier diverges; document any
  legitimate difference rather than forcing a false tie.
- **Schema gate (Phase 4)** — do not write DDL before architect approval; update
  `supabase_schema.sql` first.
- **Confidential data** — the golden test must never hardcode a bid figure; it reads expected
  values from the gitignored oracle at runtime.

## What I need from you (architect), and when
- **Phase 2:** nothing up front (file already on disk at the known path). After the first
  golden run, I'll bring you the delta findings to disposition.
- **Phase 4:** approval of the `estimate_overrides` schema **before** any DB change.
- **Phase 5:** a design review session before we build the glass-box UI.
