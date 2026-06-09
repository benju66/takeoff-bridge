# Phase 5 — Visual Trust UI (Glass Box): Interaction Design & Build Plan

> **Status:** DESIGN ONLY (drafted 2026-06-09). This document is the Phase 5 deliverable of
> `docs/plans/make-the-math-trustworthy.md`. It produces (1) an interaction design for the
> three glass-box surfaces + the override setter, and (2) a follow-up build plan. **No app
> code is changed in this phase.** It PAUSES for an architect design review. Once the design
> is approved, a build-phase kickoff is written for a fresh session and the build begins on a
> new branch.
>
> Reads over (read-only, no math moves — `calculations.ts` stays the sole financial authority):
> `src/app/projects/[projectId]/page.tsx`, `src/components/workspace/EstimateTable.tsx`,
> `src/hooks/useTakeoffWorkbook.tsx`, `src/lib/calculations.ts`, `src/lib/exporter.ts`, and the
> Phase 4 override layer (`db.recordEstimateOverride` / `db.getEstimateOverrides` /
> `useEstimateOverrides` / `OVERRIDABLE_SUMMARY_FIELDS`).

---

## 1. The goal, in one sentence

Make every number's **construction** visible — so an estimator earns trust by *looking*, not by
faith — and let them **override** any computed value with a recorded reason, without ever hiding
what the engine computed.

The good news the research confirms: **all three surfaces are largely a VIEW over data the engine
already returns.** Almost nothing new is computed; we are *displaying* what is already there.

| Surface | Data it renders (already exists) | Source |
|---|---|---|
| 5a Click-to-trace | `takeoffSubtotal`, `linkedDivisionsTotal`, the 7 modifiers, `subtotal`, `totalEstimatedCost`, `costPerSf/Unit`; the 10 `linkedDivisionTotals`; `divisionBreakdown`/`costTypeBreakdown`; whether each rate was project-set (`project[rateField] != null`) | `computeTakeoffSummary`, `computeLinkedDivisionTotals`, `project` |
| 5b Reconciliation | `{ lineItemTotal, rollupTotal, delta, ok }` + the active `roundingRule`; **plus a new grand-total tie** (subtotal + 7 modifiers ↔ full Procore budget incl. `60-xxxx` codes) | `validateExportReadiness` (runs silently today), `project.roundingRule`, `computeTakeoffSummary`, a new modifier-rollup |
| 5c Provenance & flags | per-row `source` + `needsReview`; per-summary `overrides[field] = { computedValue, overrideValue }`; the unmapped-classification list | `ProcessedTakeoffRow`, `summary.overrides`, `overrideRecords` |

---

## 2. Surface architecture (DECIDED)

**One unified "Trust Inspector" with two presentations + lightweight in-place markers.**

The Inspector renders **one shared set of content** (Trace · Reconcile · Flags) in **two layout
shells**: it opens as a docked **right slide-over** (keeps the clicked number visible for a quick
trace), and an **expand ⤢** control promotes the *same* content into a **full-screen modal** for deep
review — scrolling the contributing-rows list, studying all modifiers, or reading the full override
audit log. Escape / restore drops back to the slide-over. One component, two shells; no duplicated
logic. *(Architect decision 2026-06-09: "both" — slide-over and full-screen.)*

```
 ┌───────────────────────────── Estimate (Step 4) ─────────────────────────────┐
 │  Takeoff Workbook grid …                                       [ 🔍 Trust ]  │  ← persistent button
 │  ▦ 03-3000.001  Footings        1,200  $42.50   $51,000   ⬚                  │  ← in-grid provenance badge
 │  ⚠ 09-9100.004  (needs review)      0   …                                    │  ← needsReview marker
 │  …                                                                            │
 │  ─ Estimate Subtotal (incl. GC + Site Ops) ……………… $16,054,166.37  🔍        │  ← click any total → opens
 │  ─ Construction Contingency (1.5%) ⚙ ……………………… $   240,812.50  🔍        │     inspector to that field
 │  ─ Fee (4%) ✎ ⚑ …………………………………………………… $   684,000.00  🔍        │  ← ⚑ overridden
 │  ═ TOTAL ESTIMATED COST ……………………………………… $17,097,687.18  🔍        │
 │  status bar: Rows 312 · Subtotal $… · Est.Total $… · Procore ✅ ties · ⌽dollar │  ← always-visible recon chip
 └──────────────────────────────────────────────────────────────────────────────┘

                                      opens →    ┌──────── Trust Inspector ──── ⤢ ─┐
                                                 │ [ Trace ][ Reconcile ][ Flags ] │  ← three tabs
                                                 │  … focused on the clicked total │  ⤢ = expand to
                                                 └─────────────────────────────────┘     full screen
```

Three pieces:

1. **Trust Inspector** — a right slide-over (the same collapsible/drawer idiom already used by the
   analytics drawer and the I/O bar) with an **expand ⤢ → full-screen modal** for deep review. Three
   tabs: **Trace** (5a), **Reconcile** (5b), **Flags** (5c row-level review + audit log). Opens
   focused on whatever the user clicked; a persistent **🔍 Trust** button reopens it.
2. **In-grid provenance badges** (5c) — a small glyph per row (on the item-id cell) driven by
   `row.source` / `needsReview`. These live *in the grid*, not the inspector, because provenance is
   a property of each line.
3. **Always-visible reconciliation chip** (5b) — a compact `Procore ✅ ties` / `⌽ dollar` indicator
   in the existing status bar, expandable into the Reconcile tab. The high-trust signal is visible
   without opening anything.

**Why slide-over-first with an expand-to-full-screen, over inline-expanding panels:** the summary
lives in a fixed-layout, virtualized `<tfoot>` (flex rows) where injecting an expanding tree is
fragile. The slide-over keeps the clicked number visible for a quick trace and reuses a drawer pattern
the codebase and the user already know; the ⤢ full-screen state gives a roomy surface (the
contributing-rows list, all modifiers, the full audit log) without permanently stealing the screen.
The two share one content tree, so there is no second implementation to keep in sync.

---

## 3. 5a — Click-to-trace

**Trigger.** Click any summary number — Subtotal, any of the 7 modifiers, or Total Estimated Cost
(the `OVERRIDABLE_SUMMARY_FIELDS` set) — or the 🔍 affordance on its row. The inspector opens to the
**Trace** tab focused on that field.

**What it shows (Total Estimated Cost example):**

```
 ┌── Trust Inspector · Trace ─────────────────────────────────────┐
 │ TOTAL ESTIMATED COST ………………………………… $17,097,687.18 │
 │                                                                 │
 │ ├─ Subtotal ………………………………………………… $16,054,166.37  │
 │ │   ├─ Takeoff  Σ(qty × price) · 302 rows ………… $15,300,000.00 │ → [view rows]
 │ │   └─ Linked divisions (GC + Site Ops) ……………… $   754,166.37 │ → [10 rows ▾]
 │ │        ├─ 01 General Conditions — General …… $   420,000.00   │
 │ │        ├─ 01 GC — Supervision ………………………… $   190,000.00   │
 │ │        ├─ 02 Site Ops — Earthwork …………………… $   …            │
 │ │        └─ … 7 more                                            │
 │ ├─ Construction Contingency  1.5% × Subtotal · ⚙ default … $240,812.50 │
 │ ├─ Design Contingency  0% · ⚙ default ……………………………… $        0.00 │
 │ ├─ General Liability Ins.  1% × Subtotal · ⚙ default …… $160,541.66 │
 │ ├─ Fee  4% × Subtotal · ✎ project-set · ⚑ OVERRIDDEN …… $684,000.00 │
 │ │     computed $642,166.65  →  override $684,000.00   [view ▾]  │
 │ └─ … remaining modifiers …                                      │
 │                                                                 │
 │ Rounding: ⌽ dollar (each line rounded to the nearest $1)        │
 │ ───────────────────────────────────────────────────────────── │
 │ [ Override this value… ]                                        │  ← setter entry (see §6)
 └─────────────────────────────────────────────────────────────────┘
```

**Decomposition (all already returned by the engine):**
- `subtotal = takeoffSubtotal + linkedDivisionsTotal` (exact — INV-2).
- **Takeoff Σ(qty×price)** → `takeoffSubtotal`, with a row count = non-linked rows. `[view rows]`
  filters/scrolls the grid to those rows (reuses `globalFilter` / `scrollToRowRef`), so "the N rows"
  is not a number you take on faith — you can see them.
- **Linked divisions** → `linkedDivisionsTotal`, expandable to the 10 `linkedDivisionTotals`
  (`itemId`, `description`, `sourceLabel`, `total`) — each row shows where in Step 2/3 it came from.
- **Each modifier** → its value, its **rate**, and `rate × Subtotal`. The rate's **origin badge**:
  `✎ project-set` when `project[`${key}Rate`] != null`, else `⚙ system default` (GL 1% / Fee 5% /
  others 0). This is the "make defaulting visible, not silent" fix from the contract's silent-escape
  register — no math change, pure transparency.
- **Total** → sum of the effective rounded components (or, when directly overridden, the override
  value — flagged ⚑).
- **Rounding mode** shown inline (B-3 visibility).

**Pure view.** The only input 5a needs beyond the summary object is `project` (to derive rate origin)
— already passed to `EstimateTable`. No engine change.

---

## 4. 5b — Reconciliation view

**The cheapest, highest-trust win:** `validateExportReadiness()` already computes a tie-out on every
export and **throws the result away when it passes**. We surface it live — and (architect decision)
**extend it to the grand total**, so the panel proves the full **Total Estimated Cost** reaches
Procore to the cent. That grand-total line *is* INV-1 made visible: on-screen total == exported total.

```
 ┌── Trust Inspector · Reconcile ─────────────────────────────────┐
 │  PROCORE EXPORT RECONCILIATION                                  │
 │                                                                 │
 │  Scope subtotal (line items + GC + Site Ops) … $16,054,166.37  │  reconciliation.lineItemTotal
 │    rolls up to 217 budget codes …………………………… $16,054,166.37  │  reconciliation.rollupTotal
 │  + 7 modifiers (60-xxxx codes) ……………………………… $ 1,043,520.81  │  Σ effective modifiers (NEW rollup)
 │  ───────────────────────────────────────────────────────────  │
 │  = TOTAL ESTIMATED COST …………………………………………… $17,097,687.18  │  summary.totalEstimatedCost
 │    full Procore budget total ………………………………… $17,097,687.18  │  scope rollup + modifier rollup
 │  Difference ……………………………………………………………………… $0.00  ✅ TIES   │  delta / ok   (INV-1, live)
 │                                                                 │
 │  Rounding mode ……………………………………… none (template-faithful)     │  project.roundingRule  (B-3)
 │  “No rounding — the total ties your source spreadsheet exactly. │
 │   A project switched to ‘dollar’ rounds each modifier to the    │
 │   nearest $1 and may then differ by up to ~$0.50/modifier.”     │
 │  [ change rounding… ]                                           │
 │                                                                 │
 │  Unmapped rows carrying dollars: 0   ✅                         │  reconciliation blockers
 └─────────────────────────────────────────────────────────────────┘
```

**Two layers, both shown (architect decision: build the grand-total tie now).**
1. **Scope tie** — the existing `reconciliation` object: Σ non-linked rows + GC + Site Ops **↔** the
   Procore rollup of the 217 codes. Proves *every dollar of scope reaches Procore to the cent.* (This
   layer already exists and runs silently today — we just stop hiding it.)
2. **Grand-total tie (NEW)** — add a small modifier-rollup so the panel also ties **subtotal + the 7
   effective modifiers** (= `totalEstimatedCost`) to the **full Procore budget** (scope rollup + the
   `60-xxxx` modifier codes that `generateProcoreBudget` writes). With overrides applied (task 1) this
   is the **live INV-1 proof** the estimator can read at any moment — not just at export.

**Live, not export-gated.** Today the object is computed inside `useExportHandlers.runExportGate`,
behind a download. We expose it as a derived value on the page (a tiny `useExportReadiness` selector,
or memoized inline) so the chip + tab reflect it continuously. The export gate keeps using the same
function — single source, no divergence.

**Status-bar chip.** `Procore ✅ ties` (green) or `Δ $X.XX ⚠` (amber, click → Reconcile tab). This is
the "earned by looking" signal that is always on screen.

---

## 5. 5c — Provenance & override flags

Two distinct badge families — provenance is per-**row**; override/default flags are per-**summary
value**.

### 5c.1 Row provenance (in the grid)
A small glyph on each grid row (rendered in the item-id cell, the existing left-most identity cell):

```
 Legend:  ▦ template   ⬚ imported (CSV)   ✎ manual   ⚠ needs review
```

Driven by `row.source` (`'template' | 'csv_import' | 'manual' | 'ai_suggestion'`) and `row.needsReview`
(Phase 3 / INV-8). Hover → tooltip ("Imported from CSV", "Hand-entered", "Flagged: ambiguous import
quantity — review before export"). This is the **INV-7 provenance-completeness** badge the contract
parked as `it.todo` — Phase 5 makes the promise visible and flips the todo to a real assertion.

The grid already color-codes unmapped rows with a `border-l-4 border-l-amber-500`; provenance badges
sit alongside as glyphs (not another border) to avoid visual collision.

### 5c.2 Summary value flags (in the tfoot + trace)
On the Subtotal / modifier / Total cells:
- **⚙ system default** — rate fell back to the engine default (GL 1% / Fee 5%), i.e.
  `project[rateField] == null`. Visibility fix; no math change.
- **⚑ overridden** — `summary.overrides[field]` is present. Hover/click → the computed-vs-override
  pair from `summary.overrides[field] = { computedValue, overrideValue }` plus the latest matching
  `overrideRecords` entry (reason / who / when). The computed value is **never hidden**.

### 5c.3 Flags tab (row-level review + recovery — B-4)
A worklist of everything that needs a human:
- **Needs-review rows** (`needsReview`, INV-8) — listed with their carried quantity; click → scroll to
  the row in the grid to resolve.
- **Unmapped import classifications** (B-4) — today these surface in a banner that only links to
  `/registry`. Phase 5 carries each one's **quantity** (Phase 3 already preserves it) into an inline
  "assign code & place" control here (the same assignment UX as `ExportOverrideModal`), so the
  estimator maps-and-places **without re-importing**. This is the "inline-recoverable unmapped import
  rows" backlog item B-4.
- **Audit log** — the full append-only `overrideRecords` trail (newest first): each override/revert
  event with field, computed→override, reason, who, when. Read-only, immutable.

---

## 6. The override SETTER (the new write path)

This is the one genuinely new *interaction* (Phase 4 built the data layer; there is no setter yet).

**Recommended affordance: override-from-trace.** In the Trace tab, each overridable value has an
**[ Override this value… ]** action that expands an inline editor:

```
 ┌── Override · Fee ──────────────────────────────────────────────┐
 │  Computed value ……………… $642,166.65   (1.5% × subtotal)       │  ← always shown
 │  Override to ……………………… [ $ 684,000.00 ]                      │  ← number input
 │  Reason (required) ………… [ Negotiated fee per owner LOI 6/8 ]  │  ← captured for audit
 │                                                                 │
 │  [ Save override ]   [ Cancel ]                                 │
 │  ─────────────────────────────────────────────────────────────│
 │  Currently overridden →  [ Revert to computed ]                │  ← only when active
 └─────────────────────────────────────────────────────────────────┘
```

**Flow (exactly the Phase 4 contract):**
1. **Set:** `await db.recordEstimateOverride(projectId, field, computedValue, overrideValue, reason)`
   then `useEstimateOverrides().refresh()`. `field` ∈ `OVERRIDABLE_SUMMARY_FIELDS`.
2. **Revert:** the same call with `overrideValue: null` (a tombstone — the field falls back to
   computed). Revert is an explicit button, **never** "clear the input."
3. **Audit:** every set/revert is an immutable row; the Flags-tab log reads `overrideRecords`.

**Constraints the setter UI must honor (from Phase 4):**
- **An override of `0` is real (INV-3).** "0" in the input is a genuine override; reverting is the
  separate button. The input must not treat empty/0 as "remove."
- **`recordEstimateOverride` THROWS** (financial intent, not fire-and-forget). The button shows a
  **saving → saved / failed** state and only reflects the override after `refresh()` confirms the
  reload — no optimistic display that could diverge from the DB.
- **Record the pristine computed value.** When first overriding, `computedValue` = the live
  `summary[field]`. When *changing* an existing override, `computedValue` =
  `summary.overrides[field].computedValue` (the engine's value, not the prior override) so the audit
  trail stays honest.
- **No compounding.** Overriding the subtotal does **not** recompute modifiers (the engine already
  enforces this); the UI states the total = sum of effective components, except a *direct* total
  override (the one deliberate exception, flagged ⚑).
- **Filtered-view trap (Amendment F).** The on-screen summary reflects **only visible rows when a
  filter is active** (`filteredRows`). An override must be recorded against the **unfiltered** computed
  value — so the setter must either (a) compute `computedValue` from the full unfiltered summary, or
  (b) disable the override action while a filter/search is active. Recording an override against a
  filtered subtotal would capture a partial number — a silent correctness bug. Build must guard this.

**Why override-from-trace over inline cell-edit or a standalone modal:** it captures the **reason**
(audit requires it), shows **computed vs override side by side** at the moment of decision, and reuses
the trace that *justifies* the override. Inline-editing the locked tfoot cell gives no reason capture
and fights the "locked-down summary" model; a standalone modal is fine for bulk but detaches the
override from its rationale. (Architect decision 2026-06-09 — see §8.)

---

## 7. INV-1 — export must apply overrides (carried-forward, FIRST-CLASS build task)

**The risk (from the Phase 4 handoff).** The save path persists the effective (override-applied)
`takeoffSummary`, and the on-screen numbers apply overrides — but the **export path does not**.
`generateExcelPayload`, `generateProcoreBudget`, and `generateExcelWorkbook` each call
`computeTakeoffSummary(...)` **without** `overrides`, and `generateExcelWorkbook` writes modifier
**formulas** (`F{r}*$I${subtotal}`) that recompute in-sheet. Today this can never diverge (no setter →
`activeOverrides` is always `{}`). **The moment the setter ships, an un-fixed export silently breaks
INV-1** (on-screen == saved == exported). So the setter and the export fix MUST land together.

The threading path (already traced in the code):

```
 page.tsx  useEstimateOverrides → activeOverrides
    │  (new) pass activeOverrides into useTakeoffWorkbook(...)
    ▼
 useTakeoffWorkbook  →  useExportHandlers(rows, …, activeOverrides)
    ▼
 generateExcelPayload / generateProcoreBudget / generateExcelWorkbook  (accept `overrides?`)
    ├─ generateExcelPayload, generateProcoreBudget: pass `overrides` into their
    │   computeTakeoffSummary(...) call — they already write VALUES, so the written
    │   subtotal/modifier/total values become the effective ones. (one-line each)
    └─ generateExcelWorkbook: the modifier rows are FORMULAS, not values. For an
        overridden field, write the override VALUE into column I instead of the
        `F{r}*$I${subtotal}` formula (and the subtotal/total cells likewise when those
        are overridden). A directly-overridden grand total is written as a value (the
        in-sheet SUM identity intentionally yields to the override, mirroring the engine).
```

This is the most involved build item and is **task 1** of the build plan, gated to ship with the
setter.

---

## 8. Decisions (LOCKED with the architect, 2026-06-09)

1. **Glass-box surface shape** → **Both** — unified Trust Inspector as a docked slide-over **and** an
   expand-⤢ full-screen modal (one shared content tree, two layout shells).
2. **Override setter affordance** → **Override-from-trace + required reason** (computed shown, override
   input, mandatory reason; explicit Revert). The only option that captures the audit "why."
3. **Rounding default (B-3)** → **Switch the default to `none`** (template-faithful — the app ties the
   unrounded company spreadsheet to the cent out of the box). A per-project toggle remains (a bid can
   opt into `dollar`), and the active mode is shown in 5b. **Rollout (refined 2026-06-09):** the
   effective default lives in ~8 code `?? "dollar"` sites, and `db.ts` writes `rounding_rule`
   explicitly on every save into a `NOT NULL` column — so **existing saved projects keep `'dollar'`
   and do NOT move**; only new/unsaved projects pick up `'none'`. (Earlier "existing projects shift
   ≤~$0.50/modifier" was overstated — they shift only if a user toggles them.) Confirmed schema gate:
   `projects.rounding_rule … DEFAULT 'dollar'` (supabase_schema.sql:73) → `'none'` + migration, with
   approval.
4. **5b reconciliation scope** → **Build the grand-total tie now** (subtotal **+ 7 modifiers** ↔ full
   Procore budget incl. `60-xxxx` codes), in addition to the existing scope-level tie. This doubles as
   the live INV-1 proof.

---

## 9. Build plan (follow-up — runs in a fresh session AFTER design approval)

Sequenced so the suite is green at every commit, one logical slice per commit. **Task 1 (export
applies overrides) and Task 4 (the setter) ship together** so INV-1 is never transiently violated.
New branch (e.g. `phase-5-visual-trust`) cut only when this plan is approved.

| # | Slice | Touches | Gate |
|---|---|---|---|
| **1** | **Export applies overrides (INV-1)** — thread `activeOverrides` page → `useTakeoffWorkbook` → `useExportHandlers` → the 3 generators; pass `overrides` into their `computeTakeoffSummary` calls; in `generateExcelWorkbook` write override **values** for overridden subtotal/modifier/total cells instead of the recomputing formula. | `page.tsx`, `useTakeoffWorkbook.tsx`, `useExportHandlers.ts`, `exporter.ts` | New test: with an override active, on-screen total == value written to the exported workbook/CSV. **Golden McKenna still ties** (no overrides → inert). `export-integrity` green. |
| **2** | **Trust Inspector shell (slide-over + ⤢ full-screen) + 5a Trace (read-only)** — one component, two layout shells; Trace/Reconcile/Flags tabs; 🔍 affordances on the summary cells; Trace decomposition tree (subtotal → takeoff/linked → modifiers with rate-origin ⚙/✎); `[view rows]` filters the grid. | new `TrustInspector` component(s); `EstimateTable.tsx` wiring; reads existing summary + `project` + `linkedDivisionTotals` | Pure view; snapshot/interaction tests. No engine change. |
| **3** | **5b Reconciliation tab + status-bar chip** — expose `validateExportReadiness().reconciliation` live (small selector/hook, single source with the export gate); **add a modifier-rollup so the panel ties the grand total** (subtotal + 7 modifiers ↔ full Procore budget incl. `60-xxxx`) = live INV-1 proof; show the active rounding mode (B-3 visibility). | `exporter.ts` (modifier rollup helper), `page.tsx` (or new `useExportReadiness`), `TrustInspector`, status bar | Tests: scope **and grand-total** tie at the cent; chip reflects a forced Δ; **grand-total still ties with an override active** (INV-1). |
| **4** | **Override setter + ⚑ flags** (ships **with task 1**) — override-from-trace editor (computed shown, override input, required reason, save/revert); wire `db.recordEstimateOverride` + `refresh()`; ⚑ on overridden summary cells with computed-vs-override on hover; saving/failed states (throws surfaced). | `TrustInspector`, `EstimateTable.tsx`, reuse `useEstimateOverrides` | Tests: set → reload persists + computed still shown; revert; override of `0` honored; save-failure surfaced. |
| **5** | **5c row provenance badges + Flags tab** — ▦/⬚/✎/⚠ glyphs per row from `source`/`needsReview`; Flags tab worklist (needs-review rows, **B-4** inline-recoverable unmapped classifications with carried qty, audit log from `overrideRecords`). | grid cell renderer / `columns`, `EstimateTable.tsx`, `TrustInspector` | **Flip INV-7 `it.todo` → real assertion** in `correctness-contract.test.ts`. B-4 recovery test. |
| **6** | **B-3 rounding default → `none`** — flip ALL `?? "dollar"` sites (`calculations.ts:384`, `exporter.ts:118/276/1676`, `db.ts:42` read + `db.ts:73` write, `page.tsx:155`, `ArchitecturalParametersStep.tsx:146`); **schema gate confirmed tripped** → `projects.rounding_rule … DEFAULT 'dollar'` (`supabase_schema.sql:73`) to `'none'` + migration, approval first; keep per-project toggle. Existing saved projects keep `'dollar'` (don't move). | `calculations.ts`, `exporter.ts`, `db.ts`, `page.tsx`, `ArchitecturalParametersStep.tsx`, **`supabase_schema.sql` + migration** | Audit tests that omit `roundingRule` expecting `dollar`; update contract G-1 note (`none` now default). Golden still ties (already runs `none`). |

**Cross-cutting requirements for the build:**
- No financial math leaves `calculations.ts`; every surface is a view over its outputs (AGENTS.md).
- `recordEstimateOverride` is the only override write; reverts are tombstone records; the table stays
  append-only (no update/delete).
- `npm run test` green before each commit; `/code-review` before delivery; golden McKenna must keep
  tying to $0.00 throughout.
- Per the working agreement, the build itself may span multiple fresh sessions (one slice-group per
  session, green + committed + handoff each time).

---

## 10. Definition of done (this design phase)

- [x] Interaction design for 5a / 5b / 5c **and** the override setter (this doc).
- [x] Follow-up build plan that **explicitly** includes export-applies-overrides (INV-1, task 1),
      B-3 (task 3 visibility + task 6 default→`none`), B-4 (task 5), and INV-7 (task 5 flips the todo).
- [x] Architect design review / walkthrough; the four forks decided (§8); 5b grand-total tie designed
      against the real McKenna reconciliation ($17,097,687.18 ↔ $17,097,687.18, Δ $0.00).
- [x] No app code changed; `npm run test` green (351 passed + 1 todo, 34 files — unchanged from Phase 4).
- [x] Approved → `math-trust-plan` memory + `MEMORY.md` updated; build-phase kickoff written
      (`docs/handoffs/phase-5-build-kickoff.md`). **Stop — do not start the build.**
</content>
</invoke>
