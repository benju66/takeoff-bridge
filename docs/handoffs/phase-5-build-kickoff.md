# Kickoff — Phase 5 BUILD (Visual Trust UI / glass box)

> Paste this as the first message of a fresh session to BUILD Phase 5. The DESIGN phase is done and
> **architect-approved (2026-06-09)**. This session writes UI code. Read in order:
> 1. `docs/plans/phase-5-visual-trust-ui-design.md` — the approved interaction design + build plan
>    (the four locked decisions are in §8; the build slices are in §9).
> 2. `docs/plans/make-the-math-trustworthy.md` — Phase 5 in the canonical plan.
> 3. `docs/handoffs/phase-4-override-audit.md` — the override data layer you build the setter on +
>    the carried-forward INV-1 export requirement.
> 4. `docs/correctness-contract.md` (INV-1, INV-7, Section 3 visibility rows) and
>    `docs/backlog-math-trust.md` (B-3, B-4).
> 5. `CLAUDE.md`, `AGENTS.md`, `memory/` (start with `MEMORY.md` → `[[math-trust-plan]]`).

## Build progress log (update as slices land)
- **Branch:** `phase-5-visual-trust` (cut from main `8a09cfc`).
- **Slice 1 — Export applies overrides (INV-1): DONE `8b35559` (2026-06-09).** Threaded
  `activeOverrides` page.tsx → `useTakeoffWorkbook` → `useExportHandlers` → the 3 generators (every
  new param optional / `={}` → inert by default). `generateExcelPayload`/`generateProcoreBudget`:
  pass `overrides` into their `computeTakeoffSummary` call (modifier rows now carry effective values).
  `generateExcelWorkbook`: computes the effective STEP 4 summary ONCE (`step4Summary`, with overrides)
  and — when ≥1 override is applied (`step4Summary.overrides` non-empty) — writes the subtotal / 7
  modifiers / grand total as **VALUES** instead of the template formulas, so an overridden subtotal
  cannot compound into the `F*$I$subtotal` modifier formulas and the exported total ties the
  on-screen total to the cent. The same `step4Summary` is reused for the STEP 2/3 %-line basis (the
  old duplicate `computeTakeoffSummary` there was removed). With no overrides everything is
  byte-identical (formulas kept) → golden McKenna still ties $0.00. Tests: +6 in
  `export-integrity.test.ts`. Suite **357 pass + 1 todo**; `tsc` clean; code-review clean.
  - *Why it could land alone (ahead of the slice-4 setter):* with no setter, `activeOverrides` is
    always `{}`, so the export path is provably inert — INV-1 is never transiently violated. The
    setter (slice 4) must not ship before this; it now can.
- **Slice 2 — Trust Inspector shell (slide-over + ⤢) + 5a Trace (read-only): DONE (2026-06-09).**
  - New pure view-model `src/lib/trustInspector.ts` — `buildTraceModel()` *arranges* engine outputs
    (`computeTakeoffSummary` + `computeLinkedDivisionTotals` + `project` rates) into the decomposition
    tree; computes **zero dollars** (calculations.ts stays sole authority). Also `ROUNDING_MODE_LABELS`
    / `roundingModeLabel()` for the inline rounding display (B-3 visibility). Unit-tested in node
    (`src/lib/__tests__/trustInspector.test.ts`, **+10 tests**) — the repo has NO DOM-test harness
    (no @testing-library/react / jsdom; default node env), so the trace's wiring is asserted on the
    pure builder, not the DOM. Tests assert STRUCTURE/wiring (which engine value lands on which node,
    rate origin ✎/⚙, row count, rounding label, override pairs) — **no engine-math assertions**.
  - New component `src/components/workspace/TrustInspector.tsx` — ONE shared content tree in TWO
    shells: docked right **slide-over** (no backdrop → clicked number stays visible) + **⤢ full-screen
    modal** (`Maximize2`/`Minimize2`). **Escape** collapses full-screen→slide-over, else closes. Three
    tabs **Trace · Reconcile · Flags**; **Trace filled**, Reconcile (slice 3) + Flags (slice 5) are
    clearly-marked placeholders. Trace tree: Total → Subtotal → Takeoff Σ(qty×price) · N rows
    `[view rows]` / Linked divisions (expand → the 10 `linkedDivisionTotals` rows) → 7 modifiers
    (rate% × Subtotal, ✎ project-set / ⚙ default badge, override computed→override pair) → inline
    rounding mode. Icons via lucide (no source emoji).
  - `EstimateTable.tsx`: new required prop `linkedDivisionTotals`; persistent **🔍 Trust** button in
    the grid controls; **🔍 affordance** (`SummaryTraceCell`) on the subtotal / 7 modifier / total
    summary cells → opens focused on that `OVERRIDABLE_SUMMARY_FIELDS` field. A `trustSeq` counter
    `key`s the inspector so each open remounts fresh (Trace tab, slide-over) — avoids a
    setState-in-effect. `[view rows]` = clear `globalFilter` + `scrollToRowRef.current(0)`.
    `takeoffRowCount` counts the **filtered** table model (matches the on-screen takeoffSubtotal under
    a filter — Amendment F). `page.tsx`: passes `linkedDivisionTotals` (already a local).
  - **No engine change; no override setter** (that's slice 4); pure view. Golden McKenna ties $0.00
    (7/7). Suite **367 pass + 1 todo** (35 files); `tsc` clean; new files lint-clean (EstimateTable
    keeps only its 2 pre-existing warnings); code-review clean. Committed as the slice-2 feature commit.
- **Slices 3–6: NOT STARTED.** Next session begins at **slice 3** (5b Reconciliation tab + status
  chip — surface `validateExportReadiness().reconciliation` live + the modifier-rollup grand-total
  tie + rounding mode). Reminder: **slice 6 PAUSES for architect approval** of the 1-line
  `projects.rounding_rule` migration (update `supabase_schema.sql` first; invoke the
  `supabase:supabase` skill).

## What this phase ships
A "glass box" so an estimator trusts the math by **looking**: click-to-trace (5a), a live Procore
reconciliation incl. grand-total tie (5b), per-row provenance + override flags (5c), and the
**override setter** (the first write path onto the Phase 4 data layer). It is largely a VIEW over data
`computeTakeoffSummary` / `validateExportReadiness` already return — **no financial math leaves
`calculations.ts`** (AGENTS.md; `calculations.ts` stays the sole authority).

## The four locked decisions (architect, 2026-06-09)
1. **Surface = Trust Inspector in BOTH presentations** — docked right slide-over **and** an expand-⤢
   full-screen modal sharing one content tree (Trace · Reconcile · Flags tabs). Plus in-grid
   provenance badges and an always-visible reconciliation chip in the status bar.
2. **Override setter = override-from-trace + REQUIRED reason** — click a value → editor shows the
   computed number, an override input, a mandatory reason; Save = `db.recordEstimateOverride` then
   `useEstimateOverrides().refresh()`; Revert = a record with `overrideValue: null` (explicit button,
   never "clear the field"). An override of `0` is real (INV-3).
3. **Rounding default → `none`** (template-faithful; ties the unrounded company sheet to the cent out
   of the box). Keep the per-project toggle; show the active mode in 5b. Existing projects with an
   unset `roundingRule` shift ≤~$0.50/modifier — accepted.
4. **5b builds the grand-total tie** (subtotal + 7 modifiers ↔ full Procore budget incl. `60-xxxx`
   codes), on top of the existing scope-level tie. This doubles as the **live INV-1 proof**.

## Build sequence (full detail + per-slice gates in design doc §9)
Cut a branch (e.g. `phase-5-visual-trust`) first. One logical slice per commit; suite green before each.

1. **Export applies overrides (INV-1)** — thread `activeOverrides` (page → `useTakeoffWorkbook` →
   `useExportHandlers` → `generateExcelPayload` / `generateProcoreBudget` / `generateExcelWorkbook`);
   pass `overrides` into their `computeTakeoffSummary` calls; in `generateExcelWorkbook` write override
   **values** for overridden subtotal/modifier/total cells instead of the recomputing
   `F{r}*$I${subtotal}` formula. **Ships together with the setter (slice 4)** so INV-1 is never
   transiently violated.
2. **Trust Inspector shell (slide-over + ⤢) + 5a Trace** (read-only view).
3. **5b Reconciliation tab + status chip** — surface `validateExportReadiness().reconciliation` live;
   add a modifier-rollup helper for the grand-total tie; show rounding mode.
4. **Override setter + ⚑ flags** (with slice 1).
5. **5c row provenance badges + Flags tab** — ▦/⬚/✎/⚠ from `source`/`needsReview`; B-4 inline recovery
   of unmapped import rows; audit log from `overrideRecords`. **Flip the INV-7 `it.todo` → a real
   assertion** in `correctness-contract.test.ts`.
6. **Rounding default → `none`** — *the effective default lives in code, not the DB.* Flip ALL of
   these `?? "dollar"` sites to `"none"`: `calculations.ts:384`, `exporter.ts:118/276/1676`,
   `db.ts:42` (read) **and `db.ts:73` (write)**, `page.tsx:155`,
   `ArchitecturalParametersStep.tsx:146-147` (the toggle's default display). **Schema gate IS tripped**
   (confirmed 2026-06-09): `projects.rounding_rule TEXT NOT NULL DEFAULT 'dollar'` (supabase_schema.sql
   line 73) → change to `DEFAULT 'none'` + a live migration; update `supabase_schema.sql` first and get
   architect approval (invoke `supabase:supabase` skill). **Rollout nuance:** because `db.ts:73` writes
   `rounding_rule` explicitly on every save and the column is NOT NULL, **existing saved projects
   already have `'dollar'` persisted and will NOT move** — only new/unsaved projects pick up `'none'`.
   Existing bids change only if a user toggles them (per-project toggle stays, surfaced in 5b). Keep
   the contract G-1 note in sync (`none` is now the default). Audit any test that omits `roundingRule`
   expecting `dollar` (most pass it explicitly).

## Hard constraints (don't regress these)
- **Golden McKenna must keep tying to $0.00** throughout (it runs with no overrides → the override
  layer is inert; it already runs `roundingRule: "none"`).
- **`estimate_overrides` stays append-only** — only `recordEstimateOverride` writes; reverts are
  tombstone records; no update/delete path.
- **`recordEstimateOverride` THROWS** (financial intent) — the setter surfaces save failure; no
  optimistic display before `refresh()` confirms.
- **Filtered-view trap (Amendment F).** The page summary reflects only visible rows when a
  filter/search is active (`filteredRows`). The setter must record an override against the
  **unfiltered** computed value — compute `computedValue` from the full summary, or disable the
  override action while a filter is active. Never record an override against a filtered subtotal.
- All DB access via `src/lib/db.ts`; line-item writes only via the `save_estimate` RPC.
- `npm run test` green before every commit; `/code-review` before delivery. The build may span several
  fresh sessions (one slice-group each, green + committed + handoff per the working agreement).

## Where the data already is (no new math)
- `computeTakeoffSummary` returns `takeoffSubtotal`, `linkedDivisionsTotal`, the 7 modifiers,
  `subtotal`, `totalEstimatedCost`, `costPerSf/Unit`, and `overrides[field] = { computedValue,
  overrideValue }` (present only when ≥1 override). `OVERRIDABLE_SUMMARY_FIELDS` = the clickable set.
- `computeLinkedDivisionTotals` → the 10 linked rows (`itemId`/`description`/`sourceLabel`/`total`).
- `validateExportReadiness(...)` → `{ lineItemTotal, rollupTotal, delta, ok }` (scope tie — runs
  silently today). The grand-total tie (slice 3) adds the modifier rollup.
- Rate origin (⚙ default vs ✎ project-set) is derivable in the UI from `project[`${key}Rate`] == null`.
- Row provenance from `row.source` + `row.needsReview`; override audit from `overrideRecords`.

Baseline at design close: **351 passed + 1 todo, 34 files**, no app code changed, main = `2e98cd5`
(design docs to be committed on top).
