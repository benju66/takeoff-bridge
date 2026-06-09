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
- **Slice 3 — 5b Reconciliation tab + status-bar chip (live, not export-gated): DONE (2026-06-09).**
  - New pure helper `exporter.rollupEffectiveModifiers(summary)` — Σ the 7 effective modifier values,
    mirroring `generateProcoreBudget`'s `subtotal > 0` guard (the exact 60-xxxx dollars it writes). A
    rollup of engine-computed values, NOT new math (calculations.ts stays sole authority).
  - New pure view-model `trustInspector.buildReconciliationModel({ reconciliation, blockerCount,
    summary, modifierRollupTotal, roundingMode, tolerance })` → `ReconciliationModel`: **scope layer**
    (lineItemTotal ↔ 217-code rollup, reuses the gate's result) + **grand-total layer**
    (`totalEstimatedCost` ↔ full Procore budget = `rollupTotal + modifierRollupTotal`). Grand `ok`
    uses a **rounding-aware tolerance** (½ the rounding unit + cent): under `none` ties to the cent;
    under `dollar` the ≤$0.50 subtotal rounding residual still counts as tied. `status` ∈
    `ties | blocked | override` (**architect decision 2026-06-09**: distinguish a deliberate
    subtotal/total override the Procore CSV can't carry → blue ⓘ `override`, from real export blockers
    → amber ⚠ `blocked`; modifier overrides always tie ✅). Type-only decoupled (no exporter runtime import).
  - `TrustInspector.tsx`: filled the slice-2 Reconcile placeholder with `ReconcileTab` (both layers,
    Δ ✅/ⓘ/⚠, active rounding mode inline + a "switch to none" hint when ≠ none, unmapped-blocker count).
    New `reconciliation?` + `initialTab?` props; opens on the requested tab.
  - `EstimateTable.tsx`: new required `reconciliation` prop; `openTrust(field, tab?)`; new **status-bar
    `ReconChip`** (`Procore ✅ ties` green / `Procore ✅ scope ties · ⓘ override` blue / `Procore Δ $X ⚠`
    | `Procore ⚠ N unmapped` amber) → opens the inspector on the Reconcile tab.
  - `page.tsx`: extracted a shared `summaryRates` memo (used by both summaries — no drift); added
    `fullTakeoffSummary` (FULL unfiltered rows — Amendment F: the recon must not reflect a filtered
    partial) + a `reconciliation` memo calling the SAME `validateExportReadiness` the export gate runs
    (single source) + `rollupEffectiveModifiers`. Passes `reconciliation` to `EstimateTable`.
  - **No engine change; no override setter** (slice 4). Tests: +6 in `export-integrity.test.ts` (grand
    total ties no-override; **still ties with a Fee override = live INV-1**; `rollupEffectiveModifiers`
    == real CSV 60-xxxx; direct total override classified info-not-blocker) and +8 pure builder tests
    in `trustInspector.test.ts` (scope+grand tie, modifier-override tie, broken scope→blocked, unmapped
    →blocked, direct override→override, rounding residual→ties, unexplained mismatch→blocked, rounding
    label). Golden McKenna ties $0.00. Suite **379 pass + 1 todo** (35 files); `tsc` clean; new code
    lint-clean; code-review clean.
- **Slice 4 — Override setter (first write path) + ⚑ overridden flags: DONE (2026-06-09).**
  - New pure helper `src/lib/overrideSetter.ts` — the setter's decision logic, unit-testable in node
    (no DOM): `selectPristineComputedValue` (the honest-audit trap — first override = live
    `summary[field]`, re-override = `summary.overrides[field].computedValue`, NEVER the prior
    override), `validateOverrideInput` (reason required; numeric; empty rejected; **`0` is a valid
    SET**, INV-3), `buildSetPayload` / `buildRevertPayload` (tombstone `overrideValue: null`, default
    reason `"Reverted to computed value"`). All map 1:1 onto `recordEstimateOverride`'s 5-arg shape.
  - `TrustInspector.tsx` — new shared `<OverrideEditor>` rendered under each overridable Trace node
    (subtotal `Row`, total `Row`, every `ModifierRow`). Computed value always shown; override number
    input + **required reason** + `[ Save override ]` `[ Cancel ]`; `[ Revert to computed ]` only when
    already overridden. `saveState: idle→saving→saved/failed`; the override only reflects after the
    page's `refresh()` reloads (no optimistic UI). **Escape inside the editor cancels only the editor**
    (stops propagation so the inspector's document-level Escape-to-close doesn't discard typed input).
    **Filtered-view trap (Amendment F): the action is DISABLED while `isFiltered`** (a 🔒 note replaces
    it) — recording against a partial filtered subtotal is impossible; when unfiltered the inspector's
    `summary` IS the full summary, so the recorded `computedValue` is provably correct.
  - `EstimateTable.tsx` — new props `isFiltered` + `onSaveOverride`, threaded to the inspector; the
    `SummaryTraceCell` (subtotal / 7 modifiers / total tfoot cells) now shows a **⚑** when
    `takeoffSummary.overrides?.[field]` is present, with the computed→override pair on hover (5c.2
    partial; computed value never hidden).
  - `page.tsx` — destructures `refresh` from `useEstimateOverrides`; `handleSaveOverride` =
    `await recordEstimateOverride(projectId, field, computedValue, overrideValue, reason)` then
    `refresh()` (lets the THROW reject so the editor surfaces "save failed"); passes `isFiltered` +
    `onSaveOverride`.
  - **DB access only via `src/lib/db.ts`'s existing `recordEstimateOverride`** (append-only; reverts
    are tombstone records; no schema change → `supabase:supabase` not needed). Tests: +13 in new
    `overrideSetter.test.ts` (pristine selection incl. re-override, validation incl. empty-reason /
    non-numeric / `0`-is-a-set, set/revert payload builders, and a **set→active / tombstone→fallback /
    `0`→active round-trip through `reduceLatestActiveOverrides`** = the same reducer the engine
    consumes). Golden McKenna ties $0.00 (no overrides → inert). Suite **392 pass + 1 todo** (36
    files); `tsc` clean; no new lint (EstimateTable keeps its 2 pre-existing warnings); code-review
    clean (1 UX finding fixed: Escape-loses-input).
- **Slice 5 — 5c row provenance badges + Flags tab + INV-7 flip: DONE (2026-06-09).**
  - New pure helper `src/lib/rowProvenance.ts` — `rowProvenanceBadge(row) → { kind, label, tooltip }`.
    `needsReview` wins (the ⚠ worklist signal); else `source` maps 1:1 (template/csv_import→imported/
    manual/ai_suggestion); unset/unknown source → template. TOTAL (never undefined) — that totality
    IS the INV-7 promise. Unit-tested in node (`rowProvenance.test.ts`, +4).
  - New component `src/components/workspace/RowProvenanceGlyph.tsx` — maps `kind` → a lucide icon
    (AlertTriangle/LayoutGrid/FileSpreadsheet/Pencil/Sparkles), rendered in the item-id cell
    (`useTakeoffWorkbook.tsx`, non-editing view) as a glyph beside the code — NOT another border
    (the unmapped amber `border-l` stays the only border). No source emoji.
  - New pure view-model `trustInspector.buildFlagsModel({ rows, overrideRecords }) → FlagsModel`
    (needs-review worklist + unmapped-import worklist [carries qty] + audit log projected from the
    append-only `overrideRecords`, newest-first preserved; revert = `overrideValue === null`). Also
    `summaryFieldLabel(field)`. Unit-tested in node (`trustInspector.test.ts`, +4).
  - `TrustInspector.tsx` — filled the slice-2 Flags placeholder with `<FlagsTab>`: needs-review +
    unmapped worklists (click a row → `onViewRow` closes the inspector, clears the filter, scrolls the
    grid to that row) + the read-only override audit log (field, computed→override / "Reverted to
    computed", reason, who, when). New `flagsModel?` + `onViewRow?` props.
  - `EstimateTable.tsx` — new required `overrideRecords` prop; builds `flagsModel` (pure) + a
    `handleViewRow` (same setGlobalFilter("")+scrollToRowRef path as `[view rows]`, targeting one row).
  - `page.tsx` — destructures `overrideRecords` from `useEstimateOverrides` (no new fetch) and passes it.
  - **Flipped INV-7** (`correctness-contract.test.ts`): the `it.todo` is now 4 real assertions over the
    pure helper (every source → a defined badge with a kind; per-source kind mapping; needsReview
    priority; unset-source totality).
  - **B-4 SPLIT to slice 5b** (authorized by the kickoff): slice 5 ships the unmapped worklist
    read-only + jump-to-grid (the grid's Code cell already assigns codes with fuzzy suggestions →
    map-without-re-import works today). The IN-PANEL inline "assign code & place" control + its
    command-builder (pushCommand, undo-fidelity test) is **slice 5b**.
  - **No engine/math change** (pure view over `source`/`needsReview`/`overrideRecords`). Golden McKenna
    ties $0.00 (no overrides / no needs-review rows → all surfaces inert). Suite **404 pass, 0 todo**
    (37 files); `tsc` clean; EstimateTable keeps only its 2 pre-existing warnings; code-review clean
    (2 low findings: collapsed-division scroll dead-end = pre-existing scrollToRowRef limit, left as-is;
    redundant empty-state messaging = fixed).
- **Slice 5b — B-4 inline assign-and-place for unmapped import rows: DONE (2026-06-09).**
  - New pure helper `src/lib/assignCode.ts` — `validateAssignInput(code)` → `{ ok, itemId }` |
    `{ ok:false, error }` (empty/whitespace rejected; resolves a free-entry code to a known
    `ESTIMATE_ITEMS_MASTER` itemId — catalog is keyed by itemId, with a value-`itemId` fallback for
    key/itemId drift), and `suggestCodesForClassification(classification, limit?)` — a thin wrapper
    over `getFuzzySuggestions(…, ESTIMATE_ITEMS_MASTER)`, the SAME fuzzy source the grid's Code cell
    uses. No math, no DB, NO command construction. Unit-tested in node (`assignCode.test.ts`, **+7**:
    empty/whitespace → err, unknown → err, known key → canonical itemId + whitespace-trim,
    `09-9000.001` round-trip, suggestions for a classification capped at limit + each is assignable,
    `[]` for empty classification).
  - `TrustInspector.tsx` — new `onAssignCode?(rowId, newItemId)` threaded → `FlagsTab` → a new
    **`UnmappedRow`** (replaces the read-only `WorklistRow` in the unmapped section **only when
    `onAssignCode` is wired** — falls back to read-only jump-to-grid otherwise). The control:
    one-click **suggestion chips** (`suggestCodesForClassification`, already-valid itemIds) + a
    **free-entry input** (`list="estimate-items-options"` datalist, Enter-to-assign) validated by
    `validateAssignInput` (inline amber error; cleared on edit). Carried qty + an optional **view**
    jump preserved (consistent with slice 5's `onViewRow`). After a successful assign the row becomes
    mapped and drops off `unmappedRows` on the next render.
  - `EstimateTable.tsx` — new `handleAssignCode(rowId, newItemId)`: resolves the row's index in the
    **full `rows`** array (not the filtered table model — correct under an active filter, since
    `handleCellEdit` indexes `rowsRef.current === rows`) + its current itemId, then calls
    `meta.handleCellEdit(idx,"itemId",newItemId)` + `meta.commitCellEdit(rowId,"itemId",cur,newItemId)`
    — the **exact pair** the grid's fuzzy chips use (`useTakeoffWorkbook.tsx:863/914`). This inherits
    `pushCommand` + the 10-field itemId self-cascade + the cross-division `moveEffect` (one Ctrl+Z
    undoes the assignment AND the relocation atomically — AGENTS.md "Move Effect Atomicity") and the
    fire-and-forget `recordClassificationResolution(...).catch(()=>{})` (Training Data Immutability) —
    **no new `WorkbookCommand`, no new write path, no engine/math change**. Passed to `<TrustInspector>`.
  - **No engine/math change** (a row mutation via the existing command path; the summary recomputes
    naturally once the row is mapped). Golden McKenna ties $0.00 (no unmapped rows → the control is
    inert). The command's undo/redo fidelity is already covered by `commandCapture.test.ts` — **not
    re-tested here** (cited). Suite **411 pass / 0 todo** (38 files); `tsc` clean; new files lint-clean
    (EstimateTable keeps only its 2 pre-existing warnings); self-review clean (the grid path is
    replicated verbatim; reused, not reimplemented per the kickoff hard constraint).
- **Slice 6: NOT STARTED.**
  - **Slice 6 PAUSES for architect approval** of the 1-line `projects.rounding_rule` migration
    (update `supabase_schema.sql` first; invoke the `supabase:supabase` skill). The default stays
    `'dollar'` in code until then — slice 3 only DISPLAYS the active mode.

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
