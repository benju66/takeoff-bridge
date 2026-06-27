# GC/Site-Ops Addressability — Phase A3 closure & Phase A4 kickoff
_2026-06-17 · branch `gc-siteops-addressability` (off `main`)_

> Plan of record: `docs/plans/2026-06-16-gc-siteops-addressability-grid-convergence.md`
> (read it first — locked decisions D1–D4, ID-1…ID-4). Phase A3 is **done & committed**
> (`034b34d`). Phase A4 is the **#1-risk** phase: the imported frozen-vs-derived split.

---

## What Phase A3 shipped (commit `034b34d`)

The first strangler-fig phase: app-born Step 2/3 inputs are synthesized into
`estimate_section_lines` rows in memory on load, the A1-parameterized engine is driven
off them and **proven byte-identical** to the legacy blob path, then the rows are
persisted alongside the legacy blobs on next save. **No DDL, no export change. App-born
projects only.**

### New pure modules — `src/lib/sectionLines/`
- **`entryKinds.ts`** — the shared `entry_kind` vocabulary (the A2-closure suggested set),
  pinned so A5 / B2 / B3 agree:
  - STRUCTURED (catalog-only; removable but **not** user-mintable — ID-4):
    `staffRole` · `operationalExpense` · `equipment` · `dynamic`
  - MANUAL (the D1 escape-hatch evaluator's kinds; a manual config's `entry` IS its kind):
    `qty` · `qtyRate` · `lumpSum`
  - Exports `ENTRY_KIND`, `EntryKind`, `ENTRY_KINDS`, `STRUCTURED_ENTRY_KINDS`,
    `MANUAL_ENTRY_KINDS`, `isManualEntryKind`, `isStructuredEntryKind`.
- **`synthesize.ts`** — PURE `synthesizePersonnelSectionLines(gcUtilization,
  gcEquipmentOverrides)` / `synthesizeSiteOpsSectionLines(siteOpsQuantities, siteOpsRates)`
  (+ a combined `synthesizeSectionLines`). Emits **one line per catalog entry** in catalog
  order, carrying identity (code/procoreCode/costType/label) + the project's saved inputs in
  `inputs`. **No total** is ever emitted (ID-1 "derived, never frozen"). Mirrors the hooks'
  blob-key remapping **exactly**, incl. the legacy `qtyKnox`/`rateSoilBorings` keys and the
  capitalized `util*`/`rate*`/`eq*` GC keys (the rate-override `>= 0` guard included, so a
  legit 0 override round-trips). Stable ids: `gc:staff:<key>`, `gc:op:<code>`,
  `gc:equip:<key>`, `gc:manual:<key>`, `siteops:dynamic:<code>`, `siteops:manual:<key>`.
- **`project.ts`** — the inverse bridge `computePersonnelFromSectionLines` /
  `computeSiteOpsFromSectionLines`: reconstruct the engine input maps from each line's
  `inputs`, build the **active line set** via A1's `buildPersonnelLineSet` /
  `buildSiteOpsLineSet` (a catalog code absent from the lines becomes a `removeCodes` entry —
  **D2-ready**), then call `computePersonnelCosts` / `computeSiteOperations`. **This is the
  seam B2/B3 will drive their live totals through.** One-off (non-catalog) lines are the D1
  escape hatch — the dormant branch is left unbuilt (Phase B5 extends synthesis + this bridge
  together, e.g. storing a one-off's `unit`/`section` in `inputs`).

### Dual-read (calc hooks)
- `usePersonnelCalculations` / `useInfrastructureCalculations` each expose a memoized
  `sectionLines: EstimateSectionLine[]` (synthesized from the serialized blob snapshots they
  already build) and run a **DEV-ONLY tripwire** (`process.env.NODE_ENV !== 'production'`)
  that asserts the section-line calc reproduces the blob-driven `calcResult` to the byte
  (`console.error` on drift, never throws). **The blob path stays authoritative** for display
  + export — zero behavior change to the live calc.

### Dual-write (persistence)
- `useEstimatePersistence` gained two trailing params (`sectionLines`, `isImported`, both
  defaulted). After the primary `saveEstimate` succeeds it persists the lines via the
  **independent `save_section_lines` RPC** (`db.ts` `saveSectionLines`), **app-born only**
  (`!isImported`), and **FAIL-SOFT**: nothing reads the table yet, so a section-line write
  failure logs but **never flips the (committed) primary save to an error**. Legacy blobs are
  still written through `save_estimate` unchanged. `page.tsx` memoizes the combined
  `[...personnel.sectionLines, ...infrastructure.sectionLines]` (GC first, then Site Ops —
  the gateway re-stamps `sort_order` from the array index) and passes it + `project?.isImported`.

### Tests / verification (A3 exit — all green)
- New `src/lib/__tests__/sectionLinesSynthesis.test.ts` (17 tests): **byte-identical
  round-trip** across fixtures — zeros, realistic, **legacy `qtyKnox` keys**, **rate overrides
  incl. a legit 0**, `qtyRate`, an injected `rateLookup`; entry-kind + **no-straggler**
  structural completeness (one line per catalog entry, unique stable ids, no `total`); and
  **removal generality** (dropping a line removes exactly its total).
- `npm run test` → **91 files / 1090 tests pass** (A2's 1073 + 17). All 3 export goldens
  (McKenna / synthetic / CARE) tie **$0.00** (the live calc + export are untouched).
- `npx tsc --noEmit` clean; `eslint` clean on all changed/new files.

### Discoveries / gotchas for later phases
- **The dual-write is deliberately FAIL-SOFT** (swallows + logs), which DIVERGES from the
  `saveSectionLines` gateway's throw-on-failure contract. Correct for A3 (the table is not yet
  read), but **any phase that makes the table authoritative (B6) must remove this fail-soft**
  so a lost write surfaces.
- **Imported projects still synthesize app-born-style `sectionLines` in the calc hooks**
  (parametric defaults), but they are **never written** (dual-write gated on `!isImported`).
  A4 must produce the *correct* imported lines from the frozen detail — likely a **separate
  synthesis path** keyed off `importedStep23Lines`, not the calc-hook blob path.
- **The dev tripwire is a runtime aid, not a gate.** The hard proof is the test suite. It will
  also catch drift while B2/B3 are built — keep it.
- **`EstimateSectionLine` has no `unit` column.** The bridge gets `unit` from the catalog (by
  code). One-offs (B5) and any imported line needing a unit must carry it in `inputs`.

---

## Phase A4 — the next phase (the #1 risk: imported frozen-vs-derived)

**Goal (plan §"Phase A4"):** imported projects synthesize their section lines from the
**frozen `imported_step23_lines` detail** (`step2Lines` / `step3Lines`) and stay
**non-derived** — never recomputed from live STEP 2/3 inputs. The frozen-vs-derived split
must survive the new row model intact. **`computeImportedLinkedDivisionTotalsViaEngine` must
be preserved exactly** (it is the authority that lets a reopened import tie to the cent).

### Why this is the #1 risk
An imported bid's GC/Site-Ops lump sums are hand-authored and **cannot be re-derived** from
staffing inputs (finding G-2). If synthesis accidentally feeds imported rows through the live
engine (the app-born path), the **imported golden drifts immediately**. A4 isolates this in
its own phase with an imported golden gate.

### Scope (from the plan, ID-2 provenance branch)
- A **separate imported synthesis** (e.g. in `synthesize.ts` or a sibling) that reads the
  frozen `ImportedStep23Lines` (`project_estimates.imported_step23_lines` — `step2Lines[]`,
  `step3Lines[]`, each an `ImportedSheetLine` with `code`/`description`/`qty`/`rate`/`total`/
  `assignedCode?`/`uom?`) and emits `EstimateSectionLine[]` whose value is the **frozen
  as-bid total**, NOT a live recompute.
- **Suggested design call for the architect (the table has NO total column — ID-1):** model
  each imported line as a **`lumpSum`** entry-kind section line with `inputs.value` = the
  frozen `total`. The bridge's lump-sum evaluator returns `total = value` → the frozen number
  is reproduced **without** any utilization/qty/rate recomputation. (Optionally also carry the
  as-bid `qty`/`rate`/`uom` in `inputs` for display, but the **value that counts is the
  frozen lump sum**.) Resolve imported codes via `resolveStep23Line(code, description,
  assignedCode, extraDefs)` (`src/lib/step23Normalization.ts`) so the assigned-code review-gate
  decisions are honored.
- Wire it where `page.tsx` already branches on `project?.isImported` (the
  `computeImportedLinkedDivisionTotalsViaEngine(rows)` path). Imported dual-write may now
  persist these frozen lines (architect's call), but **must never** route imported inputs
  through `computePersonnelCosts`/`computeSiteOperations` as live derivations.

### Approval gates
- **None** (no DDL; no export change). The **imported golden + app-born golden + the
  "constants, not recomputed" test** are the hard gate.

### Concrete anchors
- Imported frozen source: `project_estimates.imported_step23_lines` (`ImportedStep23Lines` /
  `ImportedSheetLine` in `src/types/db.ts`); written once by `db.ts saveImportedStep23Lines`,
  read-only thereafter (deliberately outside the `save_estimate` RPC upsert list).
- Imported authority: `computeImportedLinkedDivisionTotalsViaEngine(rows)`
  (`src/lib/bindings/registry.ts`) — derives the 10 linked section totals from the **saved
  linked-division rows as constants**. The page uses it under `project?.isImported`.
- Resolver: `resolveStep23Line(code, description, assignedCode?, extraDefs?)`
  (`src/lib/step23Normalization.ts`).
- A3 modules to extend: `src/lib/sectionLines/{synthesize,project,entryKinds}.ts`.
- The page branch + `importedSectionTotals` / `sectionTotalsFromLinked` in
  `src/app/projects/[projectId]/page.tsx`.

### Exit criteria
- **Imported golden ties $0.00** AND the **app-born golden still ties $0.00** · a test asserts
  an imported project's section lines are **constants** (changing a STEP 2/3 *input* does not
  move them; only the frozen detail does) · `npm run test` green · `npx tsc --noEmit` clean ·
  committed via `git commit -F` · a `/handoff` sequencing **Phase A5**.
- **Stop at the Phase A4 boundary — do not start Phase A5** (BindingLines / registry source
  nodes).

### Phase A4 kickoff prompt (paste into a fresh session)

> **Branch first (AGENTS.md / LD-5):** confirm you're on `gc-siteops-addressability`
> (`git switch gc-siteops-addressability`); do NOT work on `main`. Confirm the plan file
> `docs/plans/2026-06-16-gc-siteops-addressability-grid-convergence.md` and this handoff are
> present.
>
> Implement **Phase A4** of GC/Site-Ops Addressability & Grid Convergence (read the plan's
> Phase A4 + locked decisions D4 / ID-2 first). **This is the #1-risk phase: imported bids must
> stay FROZEN and never re-derive.** Add a SEPARATE imported synthesis path that turns the
> frozen `imported_step23_lines` detail (`step2Lines` / `step3Lines`, `ImportedSheetLine`) into
> `EstimateSectionLine[]` whose value is the **frozen as-bid total** (suggested: a `lumpSum`
> section line with `inputs.value = total`, so the bridge reproduces the frozen number with no
> utilization/qty/rate recompute), resolving codes via `resolveStep23Line`. Wire it where the
> page already branches on `project?.isImported`; **preserve
> `computeImportedLinkedDivisionTotalsViaEngine` exactly** — never route imported inputs through
> `computePersonnelCosts`/`computeSiteOperations` as live derivations. No DDL, no export change.
> Exit when the **imported golden ties $0.00**, the **app-born golden still ties $0.00**, a test
> asserts imported section lines are constants (a STEP 2/3 input change does not move them),
> `npm run test` is green, `npx tsc --noEmit` is clean, the work is committed (`git commit -F`),
> and a `/handoff` doc sequencing **Phase A5** is written. **Stop at the Phase A4 boundary.**

---

## Where this sits in the workstream
Track A: **A1 ✅** → **A2 ✅** (table+gateway, DDL) → **A3 ✅** (lazy synthesis, app-born —
`034b34d`) → **A4** (imported branch, the #1 risk) → A5 (project to BindingLines / registry
source nodes). Then A+1 (override-with-audit, D3), then Track B (B1 grid-shell extraction →
B2/B3 grids → B4 removable seed → B5 one-off escape hatch → B6 finish-migration + retire blobs,
DDL). A3 built the section-line synthesis + the projection bridge that A5 / B2 / B3 all consume.
