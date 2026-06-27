# GC/Site-Ops Addressability — Phase B5 closure & Phase B6 kickoff
_2026-06-18 · branch `gc-siteops-addressability` · on top of B4 `f1eadd5`_

> Plan of record: `docs/plans/2026-06-16-gc-siteops-addressability-grid-convergence.md`
> (locked decisions D1–D4, ID-1…ID-4). B5 detail plan: `docs/plans/2026-06-18-gc-siteops-phase-b5-one-off-lines.md`.
> Predecessor: `…-phase-b4-closure.md` (removable / re-addable catalog seed, D2).

---

## What Phase B5 shipped — validated escape hatch: one-off lines (D1)

The estimator can now add a **one-off line** on Step 2 (GC) and Step 3 (Site Operations) — a
project-specific manual entry that is **not** in the catalog (e.g. a site-specific fee):
- **"+ One-off line"** (title bar, beside "+ Add line") opens a small form: Description, Kind
  (**Quantity × Rate** or **Lump sum**), Unit, the typed value (+ rate). It mints an **uncoded**
  line that shows the unmapped treatment.
- The row's **Code cell** is the assign-and-place affordance: **"⚠ Assign code"** → an inline
  validated Procore-code input. Until it resolves to a valid `procore_cost_codes` entry the
  one-off is **blocked from export** with a clear, line-named message; once coded it exports.
- Both gestures + the typed value/rate edits are **undoable** (a single Ctrl+Z reverses each).
- **Bespoke structured lines are still NOT mintable** (ID-4 — only the generic manual/lump kind).
  **Imported projects are unaffected** (D4).

The escape hatch reuses the **existing** manual-line evaluator — there is **no new per-line math**.

## Architecture — the one invariant

A one-off is, end to end, a **`source: 'manual'` section line whose `id === internal code ===
engine manual-config key`** (one generated marker, `gc:oneoff:<rand>` / `siteops:oneoff:<rand>`):
- **Calc hooks** (`usePersonnelCalculations` / `useInfrastructureCalculations`) hold a new
  `oneOffLines` set (load-applied once, app-born only). The calc memo feeds them to the engine via
  `buildXLineSet({ removeCodes, addManual: oneOffConfigs })` and injects each one-off's typed value
  into the `manualEntries` / `quantities` map **keyed by the line id**; a qty one-off's rate rides
  `config.rate` (a one-off code is never on the rate card). `sectionLines` = `synthesize(catalog)
  .filter(!removed)` **+ oneOffLines** (so the dual-write persists them and reload reconstructs them).
- **The dual-read tripwire stays green**: the bridge (`src/lib/sectionLines/project.ts`) wires the
  previously-deferred **non-catalog branch** — a manual-kind line not in the catalog map →
  `oneOffToXManualConfig(line)` + inject `value` keyed by `line.id`, then `addManual`. Hook and
  bridge build identical configs in identical order → `JSON.stringify` equality holds.
- **`isOneOffLine(line) = source==='manual' && isManualEntryKind(entryKind)`** is the single
  detector — used by the grid (one-off-aware cells / divider / unit), the synthesis split, and the
  load reconstruction `deriveOneOffsFromLines` (mirrors `deriveRemovedCodesFromLines`).

## Export gate (D1)
`validateExportReadiness` pushes a **`kind:'oneOff'` blocker** for any GC/Site-Ops line with dollars
whose `procoreCode` fails `isValidProcoreCode`. **Every catalog procoreCode is valid by construction**
(machine-verified: 72 unique codes, 0 missing under the JSON baseline), so this signal **only ever
catches an uncoded/invalid one-off** — a default project adds none → byte-identical → goldens $0.00.
`useExportHandlers.runExportGate` routes one-off blockers to a clear `setExportError` (the takeoff-row
override modal can't fix them); takeoff blockers behave exactly as before. The page's recon chip /
Trust Inspector count a one-off blocker via `blockers.length` (so an uncoded one-off reads "blocked").

## Cost type (D1 "with a cost type")
The Procore valid-code oracle (`procoreValidCodes.ts`) now also carries the Procore **type**,
populated by the existing prime (`primeProcoreValidCodesFromList`, already fed the full master list in
`useTakeoffWorkbook`). New sync `getProcoreCostType(code)`; `validateOneOffCode` resolves the code +
maps its type to L/M/S/E (default `'M'` when unknown — cost type is BLI metadata, moves no dollar).

## Commands / undo
NEW `SectionGridCommand`s: `ADD_ONE_OFF_LINE` / `REMOVE_ONE_OFF_LINE` (full line snapshot) /
`ASSIGN_ONE_OFF_CODE` (prev/next code+type). One-off value/rate edits reuse `EDIT_SECTION_CELL` via
new `'oneOffValue'` / `'oneOffRate'` targets. `useSectionLineGrid` pushes each command BEFORE the
dispatch (guardrail) and inverts them in undo/redo; the spec supplies `applyAddOneOff` /
`applyRemoveOneOff` / `applyAssignOneOffCode`, and the column ctx gains `assignOneOff` (the Code cell).

## Files
- **NEW `src/lib/sectionLines/oneOff.ts`** — pure model: `isOneOffLine`, `newOneOffLine`,
  `oneOffToGcManualConfig` / `oneOffToSiteOpsManualConfig`, `oneOffValueInjection`, `validateOneOffCode`,
  `oneOffUnit`. Kind = `qty | lumpSum` (D1 scope; `qtyRate` trimmed as redundant for a one-off).
- **`src/lib/sectionLines/project.ts`** — non-catalog branch in both bridge fns + `deriveOneOffsFromLines`.
- **`usePersonnelCalculations.ts` / `useInfrastructureCalculations.ts`** — `oneOffLines` state + one-time
  load apply + `addOneOff`/`removeOneOff`/`setOneOffValue`/`setOneOffRate`/`assignOneOffCode`; calc memo
  `addManual` + value injection; `sectionLines` += one-offs.
- **`useProjectWorkspace.ts`** — derives + exposes `persistedOneOffLines` (imported → empty, D4).
- **`page.tsx`** — threads `initialOneOffLines` into both hooks (app-born only).
- **`exporter.ts`** — `ExportBlocker.kind` + the one-off gate. **`useExportHandlers.ts`** — routing.
- **`procoreValidCodes.ts` / `procoreValidCodesPrime.ts`** — type-carrying oracle + `getProcoreCostType`.
- **`useSectionLineGrid.tsx`** — the one-off command triad + appliers + `assignOneOff` ctx + undo/redo.
- **`useGcPersonnelGrid.tsx` / `useSiteOpsGrid.tsx`** — one-off Code/Quantity/Rate cells + `oneOffValue`/
  `oneOffRate` dispatch + the appliers; `gcRowUnit`/`siteOpsRowUnit`.
- **`gcGridModel.ts` / `siteOpsGridModel.ts`** — one-off group/divider (01.G / 02.I), `*RowUnit`.
- **NEW `OneOffCodeCell.tsx`** (Code-cell assign), **NEW `AddOneOffLineForm.tsx`** ("+ One-off line").
- **`GcPersonnelGridStep.tsx` / `SiteOpsGridStep.tsx`** — mount the form + context-menu "Remove one-off line".
- **`types/index.ts`** — the 3 new commands. **SKILL** `data-table-architecture` — one-off rows documented;
  §8 #1–#8 kept verbatim.
- **NEW `src/lib/__tests__/oneOffSectionLines.test.ts`** (14) + **NEW `e2e/section-line-one-off.spec.ts`**.

## Verification (CLAUDE.md Definition of Done)
- **Unit:** `npm run test` → **98 files / 1174 pass** (B4 baseline 97/1160 + the 14 new). McKenna /
  synthetic / CARE goldens tie **$0.00** (a default project adds no one-off → byte-identical).
- **Types:** `npx tsc --noEmit` clean. **Build:** `npm run build` green.
- **/code-review (high, two independent reviewer agents):** **no correctness findings.** Two quality
  findings, both **applied**: (1) hoisted the removed-codes `Set` out of the `sectionLines` `.filter`
  (restored the B4 perf shape — was rebuilding it per row); (2) trimmed the redundant `qtyRate` one-off
  kind (a one-off `qty` already = value × typed rate, and the form never minted `qtyRate`).
- **No DDL** — rides the existing `estimate_section_lines` `inputs` JSONB + `source`/`code`/`procore_code`/
  `cost_type` columns.
- **Playwright e2e** `e2e/section-line-one-off.spec.ts`: add one-off → "⚠ Assign code" → assign
  `2-29010.000` → coded → Ctrl+Z reverses the assign → Ctrl+Z reverses the add. **PASSES (9.3s)** after
  the two follow-on fixes below.

### Follow-on fixes (2026-06-19) — two real bugs the e2e surfaced (separate commits)
The e2e was initially blocked, which exposed two genuine defects (NOT B5 logic bugs):
1. **App-wide auth remount on every token refresh (`src/context/AuthContext.tsx`, OWN commit).** The
   auth-change handler called `setLoading(true)` on EVERY Supabase event including `TOKEN_REFRESHED`
   (~hourly + on tab refocus), so `ProtectedRoute` (gates on `loading || !user`) unmounted the whole app
   subtree and remounted after the profile re-fetch — flashing "Authenticating Session Node…" and dropping
   in-session unsaved state. Predates B5 (the B2/B3/B4 closures all noted this same flake). Fix: skip the
   re-gate + profile re-fetch for a SAME-user event (tracked via `userIdRef`); genuine sign-in/out keep the
   original gate. A same-user refresh still RECOVERS a null profile (transient initial-load failure) quietly
   without gating (preserves the pre-fix self-heal — per /code-review). 
2. **One-off assign input wiped by virtualizer churn (B5 follow-on commit).** `OneOffCodeCell` held its
   open/text state INSIDE the virtualized grid body; the one-off (last/boundary row) mounts+unmounts as the
   virtualizer re-measures (proven via mount/unmount probes), wiping that state so the assign input never
   opened. Fix (matches the §2/§3 rule + the context-menu pattern): `OneOffCodeCell` is now display+dispatch
   only; the validated code input moved to a HOST-owned `OneOffAssignPopover` (state in
   `GcPersonnelGridStep`/`SiteOpsGridStep`, immune to grid churn). Cell → `ctx.requestAssign` (stable,
   ref-backed) → host `setAssignTarget` → popover → `grid.assignOneOffCode`.

Suite still **98/1174**, tsc + build green after both fixes; /code-review (focused reviewer agent) → 1
finding (the profile-recovery regression), applied.

### Manual /verify (architect spot-check — kickoff DoD item)
2-minute browser pass: (1) Step 3 → **"+ One-off line"** → add a $5,000 lump sum → the row shows
**"⚠ Assign code"** and the Site-Ops grand total does NOT yet include it on export; (2) try a Procore
**export** → **blocked** with the clear one-off message; (3) assign a valid code in the row's Code cell →
it exports / the recon chip clears; (4) Ctrl+Z twice reverses assign then add; (5) confirm a coded one-off
**survives a reload** (rides the A3 dual-write — the same fail-soft reload caveat as B4).

## Git
B5 committed to `gc-siteops-addressability`. **NOT pushed** (kickoff said no push unless asked — ask the
architect if they want it backed up). One commit for the phase (message via `git commit -F`).

## Known limits / notes (carry-forward)
- **Reload persistence rides the fail-soft dual-write** (same gotcha as A3/B2/B3/B4): if a one-off's
  section-line write fails, the table keeps the old set and the one-off won't reload. Non-authoritative
  until **B6** makes the table the sole store (and removes the fail-soft).
- **Export-gate invariant (forward-looking, NOT a bug today):** the gate flags *any* GC/Site-Ops line
  whose procoreCode fails `isValidProcoreCode`. This relies on "every catalog procoreCode is always valid"
  (true today, 217≡217). A future catalog addition of a code not yet in the live active set would block
  export on a *catalog* line with a misleading "one-off"-flavored path. Revisit if catalog codes ever
  outrun the Procore master list.
- **One-off cost type** defaults to `'M'` when the oracle is unprimed (cold start / SSR) or the code's
  Procore type is unknown. Metadata only (moves no dollar); the real type lands once primed.

---

## NEXT — Phase B6: finish the migration — idempotent sweep + retire legacy blob columns  ⛔ DDL GATE

**Goal (plan §"Phase B6"):** with lazy synthesis proven in the wild (A3 app-born + A4 imported + B4
removals + B5 one-offs all ride `estimate_section_lines`), run a one-shot **idempotent** sweep applying
the same synthesis to every remaining un-migrated project; then **remove the dual-read shim + dual-write**
and **retire the four legacy blob columns** (`gc_utilization`, `gc_equipment_overrides`,
`site_ops_quantities`, `site_ops_rates`) — dropping them from the `save_estimate` RPC's upsert list.
(`imported_step23_lines` STAYS — it is the imported frozen source.) After B6 the section-lines table is
**authoritative**, so the fail-soft reload caveat (and the dual-read tripwire) go away.

**Approval gates:** ⛔ **DDL** — update `supabase_schema.sql` FIRST, present the exact sweep + column
drops + `save_estimate` RPC change, **STOP for architect sign-off** before applying. `list_tables` /
`get_advisors` before & after; `generate_typescript_types` after. (Invoke the `supabase:supabase` skill first.)

**Exit criteria:** the sweep is idempotent (re-running is a no-op); every project loads from the new
table; the dual-read shim + dual-write are removed; **both export goldens tie $0.00**; standard exits.

### Phase B6 kickoff prompt (paste into a fresh session)

> Implement **Phase B6** of GC/Site-Ops Addressability & Grid Convergence — **finish the migration:
> idempotent sweep + retire the legacy blob columns (⛔ DDL GATE)**. Read the plan
> (`docs/plans/2026-06-16-gc-siteops-addressability-grid-convergence.md`, Phase B6 + decisions D4/ID-2)
> and this B5 closure first. **Branch:** continue on `gc-siteops-addressability` (`git pull` first if it's
> been pushed). Do NOT branch off or commit on `main`. **Invoke the `supabase:supabase` skill FIRST** (DB work).
>
> Scope: (1) a one-shot **idempotent** sweep that synthesizes `estimate_section_lines` for every remaining
> un-migrated app-born project (reuse the A3 `synthesize.ts`; imported projects use the A4 frozen path) —
> re-running it must be a no-op; (2) remove the dual-read tripwire shim + the dual-write fail-soft, making
> the section-lines table the SOLE store for Step 2/3 inputs; (3) **retire** the four legacy blob columns
> (`gc_utilization`, `gc_equipment_overrides`, `site_ops_quantities`, `site_ops_rates`) and drop them from
> the `save_estimate` RPC's upsert list — KEEP `imported_step23_lines`. **⛔ DDL GATE:** update
> `supabase_schema.sql` first, present the exact sweep + column drops + RPC change, and STOP for explicit
> architect approval before touching the live DB; run `get_advisors` before & after and regenerate types.
> Take it through the CLAUDE.md **Definition of Done** (suite green, **both export goldens $0.00**, tsc,
> build, `/code-review`, commit via `git commit -F`, no push unless asked). This is the FINAL phase of the
> workstream — after B6, sequence the workstream-end merge → main (architect's call). **Stop at the B6 boundary.**

## Where this sits
Track A: A1→A5 + A+1 ✅ (merged, PR #9). Track B: B1a ✅ → B1b ✅ → B2 ✅ → B3 ✅ → B4 ✅ →
**B5 (validated one-off, D1) ✅ (this session)** → B6 (sweep + retire blob columns, ⛔DDL) = FINAL.
