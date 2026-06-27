# GC/Site-Ops Addressability — Phase B4 closure & Phase B5 kickoff
_2026-06-18 · branch `gc-siteops-addressability` · commit `f1eadd5` (on top of B3 follow-on `f2baff4`)_

> Plan of record: `docs/plans/2026-06-16-gc-siteops-addressability-grid-convergence.md`
> (locked decisions D1–D4, ID-1…ID-4). B4 makes the catalog seed removable / re-addable.
> Predecessor: `…-phase-b3-closure.md` (the shared `useSectionLineGrid` core + template columns).

---

## What Phase B4 shipped — removable / re-addable catalog seed (D2)

The fixed Step 2 (GC Personnel) and Step 3 (Site Operations) catalogs are now a helpful
**default, not a forced checklist**. The estimator can:
- **Remove** a catalog line that doesn't apply — right-click any cell → **"Remove line"**.
  The row leaves the grid, and its total leaves the grand total, the linked-division bridge,
  and the export.
- **Re-add** a standard line — the title-bar **"+ Add line"** picker lists the lines NOT
  currently present, grouped by the same 01.A–01.F / 02.A–02.H section dividers; clicking one
  restores it (with its prior input preserved).

Both gestures are **undoable** (a single Ctrl+Z reverses each). **Bespoke structured lines are
removable but NOT user-mintable** (ID-4): the picker only re-adds *catalog* lines — there is
deliberately no structured-line adder. **Imported projects are unaffected** (D4).

## Architecture — the seam (the first phase where the B2/B3 veneer leaks)

A **`removedCodes` set in each calc hook** (`usePersonnelCalculations` /
`useInfrastructureCalculations`) is the single seam — everything already flows from the hook's
`calcResult` + `sectionLines`, so one set propagates removal everywhere:

- **`calcResult`** now computes via `buildPersonnelLineSet({ removeCodes })` /
  `buildSiteOpsLineSet({ removeCodes })` instead of the bare `DEFAULT_*_LINES`. With nothing
  removed the builders return the **same catalog array refs** → byte-identical → **goldens tie
  $0.00**. (The goldens also call the engines directly with default args, so they're doubly safe.)
- **`sectionLines`** = synthesize(full catalog) then `.filter(!removed)`. The grid rows drop the
  removed line; the **A3 dual-write persists the filtered set** (removal = the line is *absent*
  from `estimate_section_lines`).
- **The dual-read tripwire stays green even with removals**: `computeXFromSectionLines` derives
  its `removeCodes` from the *present* codes in the (now-filtered) `sectionLines`, which equals
  the hook's `removedCodes` exactly → both paths converge on the same active set. (Also robust to
  a stale removed code: `buildXLineSet` filters nothing for an unknown code, and the tripwire
  derives `[]`, so the two paths still match.)

**Persistence across reload** closes the loop (the "section-lines-as-source step" the B3 handoff
named): `useProjectWorkspace` additionally reads `getSectionLines` on load and derives
`persistedRemovedCodes` (catalog − present) via the new pure `deriveRemovedCodesFromLines`. The
page threads it into the calc hooks as `initialRemovedCodes` — **app-born only** (imported passes
`undefined`, D4; double-guarded in the workspace hook *and* the page). A never-saved project
(empty table) → removal OFF → full catalog. `useEstimatePersistence` gained a `sectionLines`
identity key in its debounced-save deps so a **remove/re-add with no other edit still fires the
dual-write** (removal preserves the blob inputs, so no blob string changes on its own).

### The command pair (shared core)
`useSectionLineGrid` gained `removeLine(line)` / `restoreLine(code)` → a
**`REMOVE_SECTION_LINE` / `ADD_SECTION_LINE`** command pair (command pushed BEFORE the dispatch,
the standard guardrail; REMOVE snapshots the full line for inverse fidelity). Undo of REMOVE =
restore, undo of ADD = remove; redo mirrors. The derived `removedLines` (catalog − present) feeds
the picker. Both specs (`useGcPersonnelGrid` / `useSiteOpsGrid`) supply `catalog` +
`applyRemove`/`applyRestore` (driving the calc hook's `removeLine`/`restoreLine` via the existing
ref). **Per-line type-overs are still NOT on the undo stack** (unchanged from B2/B3).

## Files
- **`src/hooks/usePersonnelCalculations.ts` / `useInfrastructureCalculations.ts`** — `removedCodes`
  state + `initialRemovedCodes` param (one-time load apply) + `removeLine`/`restoreLine`;
  `calcResult` via `buildXLineSet({ removeCodes })`; `sectionLines` filtered; `removedCodesString`
  threaded into the memo/tripwire deps.
- **`src/hooks/useProjectWorkspace.ts`** — loads `getSectionLines` (fail-soft `.catch(() => [])`),
  derives + exposes `persistedRemovedCodes` (imported → empties).
- **`src/lib/sectionLines/project.ts`** — NEW pure `deriveRemovedCodesFromLines(lines)` (catalog −
  present per section; `[]` on empty input).
- **`src/hooks/useEstimatePersistence.ts`** — `sectionLinesKey` added to the save effect deps.
- **`src/hooks/useSectionLineGrid.tsx`** — `SectionGridSpec` gains `catalog` + `applyRemove`/
  `applyRestore`; core gains `removeLine`/`restoreLine` (+ commands) + derived `removedLines`;
  undo/redo extended.
- **`src/hooks/useGcPersonnelGrid.tsx` / `useSiteOpsGrid.tsx`** — supply `catalog` (the new
  `GC_CATALOG_LINES` / `SITEOPS_CATALOG_LINES`) + `applyRemove`/`applyRestore`.
- **`src/lib/sectionLines/gcGridModel.ts` / `siteOpsGridModel.ts`** — NEW `SectionCatalogEntry`
  type + `GC_CATALOG_LINES` / `SITEOPS_CATALOG_LINES` (display-ordered picker entries; labels
  mirror synthesis). NOTE: the catalog IIFE must sit **after** the `*GroupLabel` declarations
  (TDZ — it calls them at module init).
- **NEW `src/components/workspace/AddLinePicker.tsx`** — the shared "+ Add line" dropdown
  (grouped by section; ref-check dismiss per §8 #7).
- **`GcPersonnelGridStep.tsx` / `SiteOpsGridStep.tsx`** — context-menu "Remove line" + the picker
  in the title bar.
- **`src/types/index.ts`** — `RemoveSectionLineCommand` / `AddSectionLineCommand` in the
  `SectionGridCommand` union.
- **NEW `src/lib/__tests__/sectionLinesRemovedCodes.test.ts`** (6) + **NEW
  `e2e/section-line-remove-readd.spec.ts`**.
- **SKILL** `data-table-architecture`: the REMOVE/ADD pair + the picker added as consumers; **all
  §8 anti-patterns (#1–#8) kept verbatim**.

## Verification (CLAUDE.md Definition of Done)
- **Unit:** `npm run test` → **97 files / 1160 pass** (baseline 96/1154 + the 6 new). McKenna /
  synthetic / CARE goldens tie **$0.00** (a default project removes nothing → byte-identical).
- **Types:** `npx tsc --noEmit` clean. **Build:** `npm run build` green. **Lint:** touched files clean.
- **/code-review (high, independent reviewer agent):** no confirmed correctness findings; all six
  seams (the removed-codes seam, the tripwire under removals, the load-once apply, the load-read +
  imported guard, the persistence trigger, the command pair / undo inverse) verified clean.
- **Playwright e2e** `e2e/section-line-remove-readd.spec.ts` **PASSES (12.9s)**: scratch project →
  Step 3 → edit FFE Relocation lump → $5,000 → right-click **"Remove line"** (row gone) → **"+ Add
  line"** picker re-adds FFE (returns with $5,000 preserved) → **Ctrl+Z** reverses the re-add.
  **`e2e/site-ops-grid.spec.ts` (B3) + `e2e/gc-personnel-grid.spec.ts` (B2) STILL PASS** — the
  shared-core extension did not regress Steps 2/3.

### Manual /verify (architect spot-check)
The e2e covers Site-Ops remove → re-add → undo. Worth a 2-minute browser glance: (1) do the same on
**Step 2 (GC)** — remove a staff line, watch the grand total drop, re-add it from "+ Add line";
(2) confirm a removal **survives a page reload** (the load-read) — this is the one piece NOT
e2e-confirmable in the sandbox (see the known limit below); (3) the picker shows lines grouped by
the section dividers and the count badge updates.

## Git
B4 committed to `gc-siteops-addressability` as **`f1eadd5`**. **NOT pushed** (the kickoff said no
push unless asked — ask the architect if they want it backed up). Track B cadence (per-phase PR or
one merge at Track B's end) remains the architect's call.

## Known limits / notes (carry-forward)
- **Reload persistence rides the fail-soft dual-write** (same gotcha as A3/B2/B3): if a removal's
  section-line write fails, the table keeps the old set and the line returns on reload. The table
  is non-authoritative until **B6** makes it the sole store (and removes the fail-soft).
  Unit-tested + architect spot-check; not e2e-confirmable in the sandbox.
- **Removing literally every line of BOTH sections does not persist** — an empty
  `estimate_section_lines` reads as "never saved → full catalog" (and the `length > 0` dual-write
  guard skips the write). Truly degenerate; removing all of *one* section while the other remains
  persists correctly (covered by a unit test).
- **A removed line that carried a type-over** (`estimate_overrides`) leaves the append-only override
  row in place, inert (the engine no longer produces that line, so `override ?? computed` finds
  nothing). On re-add the override re-applies if the key still matches. A removed line that was a
  **binding target** simply drops out of the graph. Both are minor, non-blocking (bindings/overrides
  are Track A); revisit if it surfaces.
- **In-session cell locks** are still not persisted (B2-D3) — drops in at the B6 sweep.

---

## NEXT — Phase B5: Validated escape hatch — one-off lines requiring a Procore code (D1)

**Goal (plan §"Phase B5"):** add a **one-off line** (a generic manual entry — A1's `addManual`
path) that the estimator authors on Step 2/3, which must **resolve to a valid `procore_cost_codes`
entry before it counts in the export** — the same gate Step 4 manual rows already enforce
(`validateExportReadiness`). An uncoded one-off is blocked from export with a clear message.
Provenance `'manual'`.

**Concrete starting points**
- The engines already accept one-offs (A1): `buildPersonnelLineSet({ addManual })` /
  `buildSiteOpsLineSet({ addManual })` append a user-authored generic MANUAL line that runs through
  the **existing** manual-line evaluator (no new per-line math). A one-off is `qty`/`lumpSum` (GC)
  or `qty`/`qtyRate`/`lumpSum` (Site-Ops) + a rate + a resolved code.
- **The B4 seam extends naturally:** B4 added `removedCodes` to the calc hooks; B5 adds an
  `oneOffLines` set (the user-authored configs) the hook feeds to `buildXLineSet({ addManual })`,
  and the hook's synthesis emits them as section lines carrying their unit/section/code/rate in
  `inputs` (the A3 `project.ts` bridge already notes the deferred "non-catalog one-off" branch —
  `computePersonnelFromSectionLines` skips a code not in the catalog map; B5 wires that branch).
- **The grid:** an "+ Add one-off line" affordance (distinct from B4's catalog "+ Add line"
  picker) → an inline new row whose code cell uses the Step 4 **assign-and-place** command pattern
  (`assignCode.ts`) to resolve a valid Procore code; reuse the Procore-cost-code authority
  (`getProcoreCostCodes` / the primed `procoreValidCodes` overlay). Until coded, the row shows the
  unmapped-row treatment and is blocked from export.
- **Export gate:** `validateExportReadiness` already blocks uncoded manual rows; the one-off must
  flow into the same readiness check. No new export tab (the gate exists).
- **Persistence:** one-offs persist as section lines (`source: 'manual'`) via the A3 dual-write,
  symmetric with B4's removed-codes load (a one-off is a section line whose code is NOT in the
  catalog → it loads back as a one-off, not a catalog seed). Decide the load-side reconstruction
  early (mirror `deriveRemovedCodesFromLines`: the non-catalog present codes ARE the one-offs).
- **Tests:** add a one-off, assign a valid code → it exports; an uncoded one-off is blocked ·
  **both export goldens tie $0.00** (a default project adds none → byte-identical) · a model/calc
  test for the additive path (A1 already has one) + an e2e for add one-off → assign code → export
  vs blocked.

**Gate:** add a one-off, assign a valid code → it exports; an uncoded one-off is blocked · **both
export goldens $0.00** · a new Playwright e2e + manual `/verify` · `tsc` + `build` + full suite
green · `/code-review`. Then a `/handoff` sequencing **B6** (idempotent sweep + retire the legacy
blob columns, ⛔ DDL GATE). **Stop at the B5 boundary.**

### Phase B5 kickoff prompt (paste into a fresh session)

> Implement **Phase B5** of GC/Site-Ops Addressability & Grid Convergence — **Validated escape
> hatch: one-off lines requiring a Procore code (D1)**. Read the plan
> (`docs/plans/2026-06-16-gc-siteops-addressability-grid-convergence.md`, Phase B5 + decisions
> D1/ID-4) and this B4 closure (`docs/handoffs/2026-06-18-gc-siteops-addressability-phase-b4-closure.md`)
> first. **Branch:** continue on `gc-siteops-addressability` (latest commit `f1eadd5` — `git pull`
> first if it's been pushed). Do NOT branch off or commit on `main`.
>
> Scope: let the estimator add a **one-off line** on Step 2/3 — a generic manual entry routed
> through A1's `buildPersonnelLineSet({ addManual })` / `buildSiteOpsLineSet({ addManual })` (the
> EXISTING manual-line evaluator; NO new per-line math, and do NOT make bespoke structured lines
> mintable, ID-4). The one-off must resolve to a valid `procore_cost_codes` entry (with a cost
> type) before it counts in export — reuse the Procore-cost-code authority + `validateExportReadiness`
> + the Step 4 assign-and-place command pattern (`assignCode.ts`); an uncoded one-off is blocked
> from export with a clear message. Extend the B4 calc-hook seam: add an `oneOffLines` set the hook
> feeds to `buildXLineSet({ addManual })` and synthesizes as section lines (`source: 'manual'`,
> code/unit/section/rate in `inputs`); wire the deferred non-catalog branch in
> `src/lib/sectionLines/project.ts`. Persist via the A3 dual-write and reconstruct one-offs on load
> from the non-catalog present codes (mirror `deriveRemovedCodesFromLines`). Add the REMOVE/ADD-style
> command(s) for the one-off so it's undoable. **Imported projects are unaffected (D4).** Keep every
> §8 anti-pattern (#1–#8) in `.agent/skills/data-table-architecture/SKILL.md` intact. Take it through
> the CLAUDE.md **Definition of Done** (suite green, **both export goldens $0.00** — a default
> project adds none → byte-identical, tsc, build, `/code-review`, commit via `git commit -F`, no push
> unless asked) plus an add-one-off → assign-code → export-vs-blocked e2e + manual `/verify`. Then
> write a `/handoff` sequencing **Phase B6** (idempotent sweep + retire the legacy blob columns,
> ⛔ DDL GATE). **Stop at the B5 boundary.**

## Where this sits
Track A: A1→A5 + A+1 ✅ (merged, PR #9). Track B: B1a ✅ → B1b ✅ → B2 (Step 2 grid) ✅ → B3 (Step 3
grid + shared core) ✅ → **B4 (removable seed, D2) ✅ (this session)** → B5 (validated one-off, D1) →
B6 (sweep + retire blob columns, ⛔DDL).
