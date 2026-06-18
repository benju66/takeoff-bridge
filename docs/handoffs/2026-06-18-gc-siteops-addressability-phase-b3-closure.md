# GC/Site-Ops Addressability — Phase B3 closure & Phase B4 kickoff
_2026-06-18 · branch `gc-siteops-addressability` · commit `01118f8` (on top of B2 `dda8149`, closure `8cf281b`)_

> Plan of record: `docs/plans/2026-06-16-gc-siteops-addressability-grid-convergence.md`
> (locked decisions D1–D4, ID-1…ID-4). B3 puts Step 3 on the same grid surface as B2 and
> factors the shared mechanics into a core. Predecessor: `…-phase-b2-closure.md`.
> Implementation plan: `docs/plans/2026-06-17-gc-siteops-phase-b3-implementation.md`.

---

## What Phase B3 shipped — Step 3 (Site Operations) as a grid + a shared grid core

Step 3 was the bespoke read-only `<input>` table `InfrastructureStep`. It is now a **real
spreadsheet on the shared `GridShell<TRow>`** — the ~37-line catalog across the **8 Site-Ops
sections (02.A–02.H)** — with per-cell click-to-edit, keyboard nav, in-session cell locks,
section dividers, 🔗 engine-Links badges, undo/redo, and an audited per-line **type-over (⚑)**.
**Imported Step 3 is untouched** — it stays the read-only `ImportedStep23Panel` (D4).

### Architecture — the shared core (ID-3), GC + Site-Ops both specialize it
B2 shipped one 692-line GC hook. B3 lifts the **section-agnostic** mechanics into a new
**`useSectionLineGrid` core** and rewrites both steps as thin specs over it:
- **Core (`useSectionLineGrid.tsx`)** owns: selection / context-menu / in-session cell-lock,
  `useCommandHistory<SectionGridCommand>`, the click-to-toggle cell renderers, keyboard nav,
  the `useReactTable<EstimateSectionLine>` instance + the `GridHostContract` `meta`, undo/redo,
  the per-line type-over commit/revert (→ `estimate_overrides`, NOT on the undo stack), and the
  `GridShellConfig` (section dividers + override-⚑ overlay).
- **A spec (`SectionGridSpec`)** supplies the section pieces: display-ordered rows, the
  calc-by-`code` lookup, the `applyEdit` setter dispatch, `buildColumns`, and the grouping.
- **`useGcPersonnelGrid`** is now a spec onto the core — **behavior byte-identical** (the B2 e2e
  + the 3 goldens guard it; the B2 e2e was re-run and **still passes**).
- **`useSiteOpsGrid`** is the new Site-Ops twin spec.

This is the uniform surface (plan ID-3) that **B4/B5 build on without forking twice** — a removal
or one-off gesture is added once in the core/spec seam, not once per step.

### Site-Ops specifics (vs GC)
- **`qtyRate` manual lines have BOTH an editable qty AND an editable rate** (today only Soil
  Borings). The rate cell is editable for `qtyRate` lines via `resolveRateKey`; GC manual lines
  were qty/lumpSum only. `dynamic` lines are auto (no input); `qty` lines show their card rate
  read-only; `lumpSum` lines show "—".
- **Display order** = section order (02.A→02.H), then dynamic-before-manual within a section
  (matches the old `InfrastructureStep`); rows re-sort by `order` so each section's rows are
  contiguous for the divider.

### Type-over (D3 / A+1) — audited, not on Ctrl+Z
`activeOverrides` now threads into `useInfrastructureCalculations` → `computeSiteOperations(…,
lineOverrides)` (the A+1 layer was already in the engine, keyed by
`siteOpsDynamicLineId`/`siteOpsManualLineId`). Typing over a total records an append-only
`estimate_overrides` event via `recordEstimateOverride` keyed by
`sectionLineTotalOverrideKey(lineId)`; the override layers IN the calc result, so grand total /
linked totals / export reflect it for free and the computed value is retained. Surfaced as the
`renderCellOverlay` ⚑ with click-to-revert. Inert with no overrides → goldens tie $0.00.

### Files
- **NEW `src/hooks/useSectionLineGrid.tsx`** — the shared Step-2/3 grid core (`SectionGridSpec` +
  `SectionColumnContext` + `SectionColumnDefs`).
- **NEW `src/hooks/useSiteOpsGrid.tsx`** — Site-Ops spec onto the core (rows, calc lookup,
  `applyEdit` = quantity/rate dispatch, `buildSiteOpsColumns` incl. the editable `qtyRate` rate,
  grouping).
- **NEW `src/components/workspace/SiteOpsGridStep.tsx`** — Step 3 host (twin of
  `GcPersonnelGridStep`): title bar, undo/redo, summary `<tfoot>` (grand total +
  `SITEOPS_GRAND_TOTAL_NODE_ID` badge), lock/unlock context menu, click-outside, step-local
  Ctrl+Z/Y listener.
- **NEW pure `src/lib/sectionLines/siteOpsGridModel.ts`** — 02.A–02.H grouping/order, the
  calc-by-`code` join (`buildSiteOpsCalcLookup`), `entryValue`, `resolveQtyKey`/`resolveRateKey`.
- **NEW `src/lib/__tests__/siteOpsGridModel.test.ts`** (12) + **`e2e/site-ops-grid.spec.ts`**.
- **`useGcPersonnelGrid.tsx`** rewritten as a thin spec onto the core.
- **`types/index.ts`** — `GcGridCommand` → `SectionGridCommand`; `EditSectionCellCommand.target`
  widened to `string` (the section's `applyEdit` dispatches it).
- **`useInfrastructureCalculations.ts`** — `lineOverrides` param threaded into the engine + the
  dual-read tripwire.
- **`page.tsx`** — passes `activeOverrides` into `useInfrastructureCalculations`; renders
  `SiteOpsGridStep` for app-born step3 (imported → `ImportedStep23Panel`).
- **`gcGridModel.ts`** — stable `gcGroupKey`/`gcGroupLabel` exports for the GC spec.
- **DELETED `InfrastructureStep.tsx`**.
- **SKILL** `data-table-architecture`: Step 3 + the shared core added as consumers; **all §8
  anti-patterns kept verbatim**.

## Verification (CLAUDE.md Definition of Done)
- **Unit:** `npm run test` → **96 files / 1147 pass** (baseline 95/1135 + `siteOpsGridModel.test.ts`
  (12)); McKenna / synthetic / CARE goldens tie **$0.00**.
- **Types:** `npx tsc --noEmit` clean. **Build:** `npm run build` green. **Lint:** touched files clean.
- **/code-review (self, high):** no correctness findings. One **parity note** (not a bug): the old
  form's per-section subtotal 🔗 badge is gone — the section total now shows in the GridShell
  divider header without a badge, exactly mirroring B2's GC dividers (the leaf-line 🔗 + grand-total
  🔗 remain; the `siteops:<section>` engine-graph node still exists and is still tested).
- **Playwright e2e** `e2e/site-ops-grid.spec.ts` **PASSES (14.4s)**: scratch project → Step 3 renders
  as a grid (02.A divider + 🔗 badges), a **FFE Relocation lump-sum cell edit recomputes** its total
  to $5,000.00 (duration-independent, so it proves the cell→command→infrastructure setter→engine→
  display path regardless of schedule), **Ctrl+Z restores** $0.00, and a **🔗 badge opens the STEP 4
  Trust "Links" tab** focused on that STEP 3 engine node. **`e2e/gc-personnel-grid.spec.ts` (B2)
  STILL PASSES (7.3s)** — the shared-core extraction did not regress Step 2.
- **Manual /verify caveats (architect spot-check):** the e2e covers render · cell edit · recompute ·
  undo · 🔗 → Step 4 Links. **The editable `qtyRate` rate cell (Soil Borings), cell-lock, and the
  type-over ⚑ set/revert were NOT individually e2e-exercised** — the type-over engine integration is
  unit-tested (`siteOpsGridModel.test.ts`: the `line:siteops:*:total` key applies in
  `computeSiteOperations` for both `knox` (qty) and `soilBorings` (qtyRate), retains computed,
  ignores foreign keys, inert with no overrides). Worth a 2-minute browser spot-check: type a qty +
  a rate on Soil Borings → total = qty × rate; type over a total → ⚑ appears + grand total moves →
  click ⚑ to revert; right-click a cell → Lock → it goes read-only.

## Git
Committed to `gc-siteops-addressability` as **`01118f8`** (one commit, message via `git commit -F`).
**Not pushed** (commit-only; push when the architect asks). ⚠️ The branch is now **local-only and
ahead of origin by 6 commits**: B1b `dc9b003` + closure `f6d8b77` + B2 `dda8149` + closure `8cf281b`
+ **B3 `01118f8`** (+ this closure). Track B follows B2's cadence — per-phase PR or one merge at
Track B's end, the architect's call.

## Known limits / notes (carry-forward)
- **Per-section subtotal 🔗 badge** absent (see /code-review parity note above) — mirrors B2.
- **Cell locks are in-session only** (B2-D3) — not persisted this phase; keys are section-line-id
  namespaced so persistence drops in cleanly at the B6 sweep.
- Keyboard nav under an **active column filter** indexes the filtered row model by data-index (same
  pre-existing pattern as Step 4); the unfiltered default is correct.
- The `num`/`CalcCell` shapes are shared from `gcGridModel`; `num` is also defined locally in
  `siteOpsGridModel` (a one-liner) to keep the Site-Ops model self-contained.

---

## NEXT — Phase B4: Removable / re-addable catalog seed (D2)

**Goal (plan §"Phase B4"):** the fixed catalogs become a helpful **default, not a forced checklist**.
Hide/remove a catalog line that doesn't apply (the active line set becomes a **subset** — A1's
`buildPersonnelLineSet`/`buildSiteOpsLineSet` `removeCodes` path) and pull standard lines back from a
**picker** anytime. Undoable via the section-grid command history. **Bespoke structured lines are
removable but NOT re-inventable** (ID-4 — there is deliberately no structured-line adder; the picker
only re-adds catalog lines). Imported projects unaffected.

**Concrete starting points**
- The calc engines already accept a filtered line set (A1): `computePersonnelCosts` /
  `computeSiteOperations` take a `lines` arg, and `buildPersonnelLineSet({ removeCodes })` /
  `buildSiteOpsLineSet({ removeCodes })` produce a subset. The shared core's `applyEdit` /
  command seam is the place to add a **REMOVE_SECTION_LINE / ADD_SECTION_LINE** command pair (full
  inverse data: the removed line's identity + inputs so re-add restores it).
- **Where "removed" lives:** the active set is currently derived from which section lines are
  present (`project.ts` `computePersonnelFromSectionLines` builds `removeCodes` from
  `presentCodes`). So **removal = dropping the line from the persisted section-line set**, and
  re-add = re-synthesizing the catalog seed line. The grid rows already come from
  `personnel.sectionLines` / `infrastructure.sectionLines` — filter/insert there, persist via the
  existing A3 dual-write (`saveSectionLines`). NOTE the current B2/B3 hooks are **veneers** that
  read `*.sectionLines` derived from the blobs; removing a line needs the calc hooks to honor a
  "removed codes" set (a new bit of state in `usePersonnelCalculations`/`useInfrastructureCalculations`,
  or a section-lines-as-source step). Decide the seam early — this is the first phase where the
  veneer leaks, and B6 is where section lines become the sole store.
- **Picker UI:** a "+ Add line" affordance per section listing the catalog lines NOT currently
  present (by `code`), grouped by the same 01.A–01.F / 02.A–02.H sections. Re-add inserts the
  synthesized seed line at its catalog `order`. Both remove + re-add push commands → Ctrl+Z works.
- **Tests:** remove a line → its total leaves the grand total + the linked-division bridge + export;
  re-add → it returns; both fully undoable. **Both export goldens tie $0.00** (a default project
  removes nothing → byte-identical). Add a model/calc test for the subset path and an e2e for
  remove → re-add → undo.

**Gate:** remove + re-add a line, totals recompute correctly, fully undoable · **both export goldens
$0.00** · a new Playwright e2e + manual `/verify` · `tsc` + `build` + full suite green ·
`/code-review`. Then a `/handoff` sequencing **B5** (validated one-off lines requiring a Procore
code, D1). **Stop at the B4 boundary.**

### Phase B4 kickoff prompt (paste into a fresh session)

> Implement **Phase B4** of GC/Site-Ops Addressability & Grid Convergence — **Removable / re-addable
> catalog seed (D2)**. Read the plan (`docs/plans/2026-06-16-gc-siteops-addressability-grid-convergence.md`,
> Phase B4 + decisions D2/ID-4) and this B3 closure
> (`docs/handoffs/2026-06-18-gc-siteops-addressability-phase-b3-closure.md`) first. **Branch:**
> continue on `gc-siteops-addressability` (B3 is committed at `01118f8`; ensure current with origin,
> pull if pushed). Do NOT branch off or commit on `main`.
>
> Scope: let the estimator **hide/remove** a Step 2/3 catalog line that doesn't apply (the active
> line set becomes a subset — reuse A1's `buildPersonnelLineSet`/`buildSiteOpsLineSet` `removeCodes`
> path; the calc engines already accept a filtered `lines` arg) and **re-add** a standard line from a
> per-section picker. Add a **REMOVE/ADD section-line command pair** to the shared
> `useSectionLineGrid` core / spec seam with **full inverse data** (removed line identity + inputs so
> re-add restores it), so a single Ctrl+Z reverses each. **Bespoke structured lines (utilization-by-
> role, operational, equipment, dynamic) are removable but NOT user-mintable (ID-4)** — the picker
> only re-adds catalog lines, never invents structured ones. Persist via the existing A3 dual-write
> (`saveSectionLines`); decide early how the veneer hooks (`usePersonnelCalculations` /
> `useInfrastructureCalculations`) honor a "removed codes" set without breaking the byte-identical /
> dual-read tripwire (this is the first phase where the veneer leaks). **Imported projects are
> unaffected (D4).** Keep every §8 anti-pattern in `.agent/skills/data-table-architecture/SKILL.md`
> intact. Take it through the CLAUDE.md **Definition of Done** (suite green, **both export goldens
> $0.00** — a default project removes nothing → byte-identical, tsc, build, `/code-review`, commit via
> `git commit -F`, no push unless asked) plus a remove→re-add→undo e2e + manual `/verify`. Then write
> a `/handoff` sequencing **Phase B5**. **Stop at the B4 boundary.**

## Where this sits
Track A: A1→A5 + A+1 ✅ (merged, PR #9). Track B: **B1a ✅ → B1b ✅ → B2 (Step 2 grid) ✅ → B3 (Step 3
grid + shared core) ✅ (this session) → B4 (removable seed, D2) → B5 (validated one-off, D1) → B6
(sweep + retire blob columns, ⛔DDL).**
