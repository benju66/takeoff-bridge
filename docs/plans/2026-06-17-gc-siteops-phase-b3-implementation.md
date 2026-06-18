# Phase B3 — Step 3 (Site Operations) as a grid · Implementation plan

_2026-06-17 · branch `gc-siteops-addressability` · on top of B2 `dda8149` / closure `8cf281b`_

> Plan of record: `docs/plans/2026-06-16-gc-siteops-addressability-grid-convergence.md` (Phase B3,
> decisions ID-1…ID-4, D2/D3/D4). Predecessor closure: `docs/handoffs/2026-06-17-…-phase-b2-closure.md`.

## Goal
Render **Step 3 (Site Operations)** through the shared `GridShell<TRow>` — the larger ~37-line catalog
across the **8 Site-Ops sections** — with per-cell editing, keyboard nav, in-session cell locks, 🔗
engine-Links badges, undo/redo with full inverse data, and an audited per-line type-over (⚑). Imported
Step 3 stays the read-only `ImportedStep23Panel` (D4). Both export goldens tie **$0.00**.

## Architecture decision — factor a shared core (ID-3)
B2 shipped `useGcPersonnelGrid` (692 lines), most of which is **section-agnostic**: cell renderers,
keyboard nav, the TanStack instance + meta + contract buffers, undo/redo plumbing, the override
commit/revert, and the gridConfig (group/divider + override ⚑ overlay). B3 lifts that into a shared
**`useSectionLineGrid(spec, onSaveOverride)`** core; GC and Site-Ops each supply a thin spec (their rows,
calc-lookup, `applyEdit` setter dispatch, `buildColumns`, and grouping). This is the ID-3 "uniform
surface" and prevents B4/B5 forking twice. **Fallback:** if the extraction can't keep B2 byte-identical
in one session, ship Site-Ops as a parallel twin and factor later (the B2 e2e + unit tests + 3 goldens +
tsc + build are the safety net).

## Site-Ops specifics vs GC
- **`qtyRate` manual lines have BOTH an editable qty and an editable rate** (GC manual lines were
  qty/lumpSum only). Only `soilBorings` is `qtyRate` today.
- Edit kinds: `dynamic` (auto, no input), `qty` (typed qty × card rate), `qtyRate` (typed qty × typed
  rate), `lumpSum` (typed $). Setters: `handleLineQuantityChange` / `handleLineRateChange`.
- Group by the 8 `SITE_OPS_SECTIONS` (02.A–02.H); display order = section order, then dynamic-before-
  manual within a section (matches `InfrastructureStep`). Row id = section-line id (`siteops:dynamic:<code>`
  / `siteops:manual:<key>`). Engine badge node = `siteOpsLeafNodeId(group, code, "total")`; grand total =
  `SITEOPS_GRAND_TOTAL_NODE_ID`.
- Type-over key = `sectionLineTotalOverrideKey(line.id)` — equals what `computeSiteOperations` forms via
  `siteOpsDynamicLineId`/`siteOpsManualLineId` (proven in the model test).

## Files
**NEW**
1. `src/lib/sectionLines/siteOpsGridModel.ts` — pure model (twin of `gcGridModel.ts`): `SITEOPS_GROUP_LABELS`,
   `SITEOPS_ROW_META` (group/order/engineGroup/unit), `SITEOPS_MANUAL_BY_CODE`, `buildSiteOpsCalcLookup`,
   `entryValue`, `resolveQtyKey`, `resolveRateKey`.
2. `src/hooks/useSectionLineGrid.tsx` — the shared core extracted from `useGcPersonnelGrid` (selection /
   ctx-menu / locks, `useCommandHistory<SectionGridCommand>`, commit/lock/override/revert, keyboard nav,
   cell renderers, TanStack table + meta + contract buffers, undo/redo, gridConfig). Parameterized by
   `SectionGridSpec`.
3. `src/hooks/useSiteOpsGrid.tsx` — thin Site-Ops spec → `useSectionLineGrid` (rows, calcLookup, `applyEdit`,
   `buildColumns` incl. the editable `qtyRate` rate cell, grouping).
4. `src/components/workspace/SiteOpsGridStep.tsx` — host (twin of `GcPersonnelGridStep`): title bar,
   undo/redo, summary `<tfoot>` (grand total + badge), lock/unlock ctx menu, click-outside, step-local
   Ctrl+Z/Y listener, `<GridShell/>`.
5. `src/lib/__tests__/siteOpsGridModel.test.ts` — twin of `gcGridModel.test.ts` (grouping/order/no-stragglers,
   calc join, entry/qty/rate resolution per kind incl. `qtyRate`, type-over field key applies in
   `computeSiteOperations`, inert-no-override, recognized-keys guard).
6. `e2e/site-ops-grid.spec.ts` — Step 3 grid e2e (section dividers + 🔗; manual-line edit → total recomputes;
   Ctrl+Z; 🔗 → Step 4 Links).

**MODIFY**
7. `src/hooks/useGcPersonnelGrid.tsx` — rewrite as a thin spec delegating to `useSectionLineGrid` (byte-
   identical behavior).
8. `src/types/index.ts` — rename `GcGridCommand` → `SectionGridCommand`; widen `EditSectionCellCommand.target`
   to `string` (dispatched by the section's `applyEdit`).
9. `src/hooks/useInfrastructureCalculations.ts` — add `lineOverrides: EstimateOverrideMap = {}`; thread into
   `computeSiteOperations` + the dual-read tripwire (`computeSiteOpsFromSectionLines` already accepts it).
10. `src/app/projects/[projectId]/page.tsx` — pass `activeOverrides` to `useInfrastructureCalculations`;
    render `SiteOpsGridStep` for app-born step3 (imported → `ImportedStep23Panel`, unchanged).
11. `src/hooks/useCommandHistory.ts` — update the `GcGridCommand` comment → `SectionGridCommand` (cosmetic).
12. `.agent/skills/data-table-architecture/SKILL.md` — add Step 3 + the shared core as GridShell consumers;
    **keep every §8 anti-pattern verbatim**.

**DELETE**
13. `src/components/workspace/InfrastructureStep.tsx` — replaced by `SiteOpsGridStep` (only the page consumed it).

## Definition of Done
Suite green (+ new model test + e2e) · **both export goldens $0.00** · `npx tsc --noEmit` clean · `npm run
build` green · touched-file lint clean · `/code-review` resolved · commit via `git commit -F` (no push
unless asked) · Step-3 grid e2e + manual `/verify` · `/handoff` sequencing **Phase B4**. **Stop at the B3
boundary.**
