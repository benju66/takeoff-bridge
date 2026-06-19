# Phase B5 — Validated escape hatch: one-off lines requiring a Procore code (D1)
_2026-06-18 · branch `gc-siteops-addressability` · plan-of-record §"Phase B5", decisions D1 / ID-4_

> Companion to `docs/plans/2026-06-16-gc-siteops-addressability-grid-convergence.md`
> and the B4 closure `docs/handoffs/2026-06-18-gc-siteops-addressability-phase-b4-closure.md`.
> **No feature code is written until this plan is approved (AGENTS.md execution boundary).**

---

## Plain-language goal

Today the estimator can remove and re-add the *standard* GC/Site-Ops lines (B4). B5 lets
them add a **brand-new one-off line** — a generic "description + quantity/rate (or lump sum)"
entry that isn't in the catalog (e.g. a project-specific fee). To keep the export honest, a
one-off **does not count toward the Procore export until it carries a valid Procore cost code**.
An uncoded one-off is blocked from export with a clear, line-named message. It reuses the
existing manual-line math (no new formulas), is fully undoable, persists, and survives reload.
Bespoke structured lines stay catalog-only — there is no way to mint a new utilization/driver
line (ID-4). Imported bids are untouched (D4). A default project adds none, so both export
goldens stay byte-identical at **$0.00**.

---

## Key design invariant (what makes it correct)

A one-off is, end to end, a `source: 'manual'` section line whose **`id` == internal `code` ==
manual-config `key`** (one generated identifier, e.g. `gc:oneoff:<rand>` / `siteops:oneoff:<rand>`).
- The engine appends it via the EXISTING `buildXLineSet({ addManual })` and reads its typed
  value from `manualEntries`/`quantities`/`rates` keyed by that id — no new per-line math.
- The dual-read bridge (`project.ts`) reconstructs the SAME config + value injection from the
  section line, so the dual-read tripwire stays green.
- The grid joins calc↔row by `code` (= the id), unchanged.
- `isOneOffLine(row) = row.source === 'manual'` is the single detector (catalog seed is
  `'template'`; imported is its own read-only path). Used by the grid, the load reconstruction,
  and the synthesis split.

## Export-gate fact (verified)

Every GC/Site-Ops catalog `procoreCode` is valid under the unprimed JSON baseline (checked:
72 unique codes, 0 missing). So the gate can flag **any GC/Site-Ops line with dollars whose
`procoreCode` fails `isValidProcoreCode`** — that signal uniquely identifies an uncoded/invalid
one-off and NEVER trips on a catalog line. No source-plumbing into the exporter is needed, and
a default project (no one-offs) is byte-identical → goldens tie $0.00.

## Cost type at assignment (D1 "with a cost type")

Extend the Procore valid-code oracle (`procoreValidCodes.ts`) to also carry the Procore **type**
(`code → Labor|Material|Subcontract|Equipment`), populated by the existing prime path
(`primeProcoreValidCodesFromList`, already fed the full `ProcoreCostCode[]` in `useTakeoffWorkbook`).
A new synchronous `getProcoreCostType(code)` lets the assign flow capture the cost type; reverse
of `ESTIMATE_TO_PROCORE_TYPE` maps it to L/M/S/E (default `'M'` when type unknown — cost type is
BLI metadata, never moves a rollup dollar, so the goldens cannot move).

---

## Implementation plan

| # | File | Change |
|---|------|--------|
| 1 | `src/lib/procoreValidCodes.ts` | Add optional `type` to `ProcoreValidCode`; store a `code→ProcoreCostCodeType` map (populated/cleared by `primeProcoreValidCodes` / `resetProcoreValidCodes`); export `getProcoreCostType(code): ProcoreCostCodeType \| null`. |
| 2 | `src/lib/procoreValidCodesPrime.ts` | Pass each active code's `type` through `primeProcoreValidCodesFromList`. |
| 3 | `src/lib/sectionLines/oneOff.ts` **(NEW, pure)** | One-off model + helpers: `isOneOffLine(line)`, `newOneOffLine({section,label,unit,entry,value,rate})` (generates the `id=code=key`, `source:'manual'`, `inputs:{value,rate?,unit}`), `oneOffToManualConfig(line)` → `GcManualConfig`/`SiteOpsManualConfig`, `oneOffValueInjection(line)` → `{key,value,rate?}`, and `validateOneOffCode(code)` → `{ok,procoreCode,costType}` \| `{ok:false,error}` (validates via `isValidProcoreCode`, types via `getProcoreCostType`→L/M/S/E, default `'M'`). |
| 4 | `src/lib/sectionLines/project.ts` | Wire the deferred **non-catalog branch** in `computePersonnelFromSectionLines` / `computeSiteOpsFromSectionLines`: a manual-kind line whose code is not in the catalog map builds a one-off config (`oneOffToManualConfig`) + injects its value/rate keyed by `line.id`, then `buildXLineSet({ removeCodes, addManual: oneOffConfigs })`. Add `deriveOneOffsFromLines(lines)` → `{gc, siteOps}` (the `source:'manual'` lines per section) for the load path (mirrors `deriveRemovedCodesFromLines`). |
| 5 | `src/hooks/usePersonnelCalculations.ts` | New `oneOffLines` state (+ `initialOneOffLines` param, one-time load apply like removed-codes, app-born only). Setters `addOneOff` / `removeOneOff` / `updateOneOffValue` / `assignOneOffCode`. Feed `buildPersonnelLineSet({ removeCodes, addManual: oneOffConfigs })` + merge one-off values into the `manualEntries` passed to the engine. `sectionLines` memo = `synthesize(catalog).filter(!removed)` **+ oneOffLines**. Expose `oneOffLines` + setters. Dual-read tripwire deps include the one-offs key. |
| 6 | `src/hooks/useInfrastructureCalculations.ts` | Same as #5 for Site-Ops: one-off `quantities` (value) + `rates` (qtyRate) injection; `addManual` to `buildSiteOpsLineSet`; `sectionLines` += one-offs. |
| 7 | `src/hooks/useProjectWorkspace.ts` | Also derive `persistedOneOffLines: {gc, siteOps}` from the loaded section lines via `deriveOneOffsFromLines` (imported → empties, D4). Expose it (referentially-stable state, like `persistedRemovedCodes`). |
| 8 | `src/app/projects/[projectId]/page.tsx` | Thread `persistedOneOffLines.gc/.siteOps` into the two calc hooks as `initialOneOffLines` (app-born only). One-offs already flow into `sectionLines` (dual-write) + `validateExportReadiness` (via the calc results) with no further page change. |
| 9 | `src/lib/exporter.ts` | In `validateExportReadiness`, after `collectGcSiteOpsLines`, push a CLEAR blocker (`kind:'oneOff'`) for any line with `\|total\|>tol` and `!isValidProcoreCode(procoreCode)`. Add `kind?: 'takeoff' \| 'oneOff'` to `ExportBlocker` (default `'takeoff'`). Catalog lines all pass → default project unchanged. |
| 10 | `src/hooks/useExportHandlers.ts` | In `runExportGate`, route one-off blockers to a clear `setExportError` naming the line(s) (the Step-4 override modal only fixes takeoff rows; one-offs are fixed on Step 2/3). Takeoff blockers behave exactly as today. |
| 11 | `src/types/index.ts` | Add `ADD_ONE_OFF_LINE` / `REMOVE_ONE_OFF_LINE` / `ASSIGN_ONE_OFF_CODE` to the `SectionGridCommand` union (full inverse data per AGENTS.md); extend `EDIT_SECTION_CELL` targets `'oneOffValue'` / `'oneOffRate'` (the `target` field is already an open string — doc only). |
| 12 | `src/lib/sectionLines/gcGridModel.ts` / `siteOpsGridModel.ts` | One-off awareness: `rowUnit(line)` (ROW_META unit, else `inputs.unit`), a one-off group key/label (`"01.G — One-off lines"` / `"02.I — One-off lines"`), `gcGroupKey`/`siteOpsGroupKey` return it for `source:'manual'`, display order sorts one-offs last (stable). `resolveEntryTarget`/`resolveQtyKey`/`resolveRateKey` return one-off targets (`oneOffValue`/`oneOffRate`, key = id) for one-offs. (Catalog re-add picker `*_CATALOG_LINES` unchanged — ID-4: one-offs are NOT re-addable from the catalog picker.) |
| 13 | `src/hooks/useSectionLineGrid.tsx` | `SectionGridSpec` gains `applyAddOneOff` / `applyRemoveOneOff` / `applyAssignOneOffCode`. Core: `addOneOff(line)` / `removeOneOff(line)` / `assignOneOffCode(id, code, type)` push the new commands BEFORE dispatch (guardrail); `applyEdit` `'oneOffValue'`/`'oneOffRate'` routes via the section spec; undo/redo handle the 3 new commands. Code-cell assign helper surfaced (`canAssignOneOff`). |
| 14 | `src/hooks/useGcPersonnelGrid.tsx` / `useSiteOpsGrid.tsx` | Supply `applyAddOneOff`/`applyRemoveOneOff`/`applyAssignOneOffCode` (drive the calc-hook setters via the existing ref). `applyEdit` handles the one-off value/rate targets. Code column renders the one-off **assign-code cell** (`OneOffCodeCell`) when `isOneOffLine`. |
| 15 | `src/components/workspace/OneOffCodeCell.tsx` **(NEW)** | The Code-cell assign-and-place affordance for an uncoded one-off: shows "⚠ Assign code" → inline validated Procore-code input (`validateOneOffCode`) → `assignOneOffCode`. When coded, shows the code + a "manual one-off" marker. Ref-check dismiss (§8 #7). |
| 16 | `src/components/workspace/AddOneOffLineForm.tsx` **(NEW)** | Title-bar "+ One-off line" popover: Description, Kind (GC: Qty×Rate \| Lump sum; Site-Ops: + Qty×Rate(typed)), Unit, Value, Rate (when applicable) → `newOneOffLine(...)` → `grid.addOneOff(line)`. Creates UNCODED (code assigned on the row). Ref-check dismiss. |
| 17 | `src/components/workspace/GcPersonnelGridStep.tsx` / `SiteOpsGridStep.tsx` | Mount `AddOneOffLineForm` in the title bar (beside "+ Add line"); add context-menu **"Remove one-off line"** for a one-off row (drives `removeOneOff`). |
| 18 | `.agent/skills/data-table-architecture/SKILL.md` | Document the one-off line + `OneOffCodeCell` + `AddOneOffLineForm` + the 3 new commands; keep all §8 anti-patterns (#1–#8) verbatim. |
| 19 | Tests | NEW `oneOffSectionLines.test.ts` (model + dual-read parity: bridge(synthesized incl. one-off) === hook calc; export-gate blocks uncoded, passes coded); extend export-readiness coverage; NEW e2e `section-line-one-off.spec.ts` (add one-off → blocked → assign valid code → exports/ties; Ctrl+Z reverses). Goldens unchanged. |

### Out of scope (held)
No new structured/bespoke line kinds (ID-4). No DDL (the `inputs` JSONB + `source`/`code`/
`procore_code`/`cost_type` columns already exist — B6 owns the blob retirement). No A5 binding
authoring against one-offs beyond the inert projection (it already tolerates them). No export
template change (the validation gate exists).

---

## Definition of Done (CLAUDE.md)
1. Implement on `gc-siteops-addressability`.
2. **No DDL** — none required (verify).
3. `npm run test` green (new unit + e2e; both export goldens **$0.00** — default project adds none → byte-identical).
4. `npx tsc --noEmit` clean.
5. `npm run build` green.
6. `/code-review` (high) — resolve findings.
7. Commit via `git commit -F` (one commit). No push unless asked.
8. `/handoff` sequencing **Phase B6** (idempotent sweep + retire legacy blob columns, ⛔ DDL GATE). Stop at the B5 boundary.
