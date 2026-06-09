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
6. **Rounding default → `none`** — flip the `?? "dollar"` fallbacks (`calculations.ts`, `page.tsx`,
   `exporter.ts`); check/align any DB column default for `rounding_rule` (schema-source-of-truth
   guardrail → update `supabase_schema.sql` first + get approval if a DDL default changes); update the
   contract G-1 disposition note.

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
