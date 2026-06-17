# GC/Site-Ops Addressability — Phase A4 closure & Phase A5 kickoff
_2026-06-17 · branch `gc-siteops-addressability` (off `main`)_

> Plan of record: `docs/plans/2026-06-16-gc-siteops-addressability-grid-convergence.md`
> (read it first — locked decisions D1–D4, ID-1…ID-4). Phase A4 is **done & committed**
> (`65664be`). Phase A5 surfaces the section lines as binding targets / rollup members.

---

## What Phase A4 shipped (commit `65664be`)

The **#1-risk phase, isolated**: imported bids now fit the new addressable-row model
**without ever re-deriving**. An imported bid's GC/Site-Ops values are hand-authored lump
sums the app cannot recompute (finding G-2), so A4 added a **separate** synthesis path that
reads the **frozen** `imported_step23_lines` detail and emits `lumpSum` section lines whose
value **IS** the frozen as-bid total. **No DDL, no export change. Imported projects only.**

### New pure module — `src/lib/sectionLines/imported.ts`
- **`synthesizeImportedSectionLines(imported?, extraDefs?, projectId?)`** — reads the frozen
  `step2Lines` (→ `section: 'gc'`) / `step3Lines` (→ `section: 'site_ops'`), GC first, and
  emits one **`lumpSum`** `EstimateSectionLine` per as-bid line with **`inputs.value =
  line.total`** (the authoritative frozen dollar). `qty`/`rate`/`uom` ride along in `inputs`
  for **display only** — the value that counts is the lump, never `qty × rate` (hand-authored
  sheets do not multiply cleanly; the panel surfaces that, so the synthesis must too). **No
  `total` field anywhere** (ID-1).
- Codes resolved via **`resolveStep23Line`** (the *same* resolver the read-only
  `ImportedStep23Panel` uses), honoring the import review-gate `assignedCode`. An unmappable
  line keeps its **bare as-bid code** with empty Procore identity. A resolved code's
  `procoreCode`/`costType` come from a `CATALOG_IDENTITY_BY_CODE` map built from the **same six
  `*_DEFAULTS` arrays** that back `STEP23_LINE_DEFS` (cannot drift from the resolver).
- Stable, namespaced ids **`imported:gc:<rowNumber>` / `imported:siteops:<rowNumber>`** —
  disjoint from the app-born `gc:*` / `siteops:*` ids, so A5 graph nodes stay separable.
- **A SIBLING of `synthesize.ts`** on purpose: keeps `step23Normalization`'s transitive deps
  out of the app-born calc-hook hot path (which imports `synthesize.ts`).

### Wiring (`page.tsx`)
- The `sectionLines` memo now **branches on `project?.isImported`**: imported →
  `synthesizeImportedSectionLines(projectEstimate?.importedStep23Lines)`; app-born → the
  existing `[...personnel.sectionLines, ...infrastructure.sectionLines]`. The branch sits
  beside the existing `computeImportedLinkedDivisionTotalsViaEngine(rows)` path, which is
  **preserved exactly** — imported inputs are **never** routed through
  `computePersonnelCosts` / `computeSiteOperations`.
- A4 wires the page with **built-ins-only** resolution (no custom-def overlay). The resolved
  identity is labeling; the **frozen value is unaffected** by it. (A5 may unify with the
  panel's `getCustomStep23LineDefs()` overlay if section-line identity needs to match the
  panel exactly — see "for A5" below.)

### Persistence (`useEstimatePersistence`)
- The dual-write **now persists section lines for imported projects too**: dropped the
  `!isImported` gate and **removed the now-unused `isImported` param** (the page is the only
  caller and supplies the right lines per provenance, so the hook needs no flag). Still
  **FAIL-SOFT** — nothing reads the table yet, so a section-line write failure logs but never
  flips the committed primary save to an error. (**B6 makes the table authoritative and must
  remove the fail-soft.**)

### Tests / verification (A4 exit — all green)
- New **`src/lib/__tests__/importedSectionLinesSynthesis.test.ts`** (12): `lumpSum` value
  `=== frozen total` (incl. a line whose `qty*rate !== total` — the lump wins); the
  **CONSTANTS gate** — mutating per-line `qty`/`rate` with `total` held fixed does **not** move
  the value, only `total` does; GC/Site-Ops split + namespaced ids; resolution cases (1:1 base,
  shared base by description, unmappable stays bare, `assignedCode` wins); `undefined` payload
  → `[]`; a realistic CI-safe payload via the synthetic legacy fixture.
- **`golden-care.test.ts`** (the imported golden, runs where the CARE fixture exists) gained
  **+1 assertion**: the frozen detail reproduces through the new row model (`value === total`,
  section sums tie). The existing **subtotal / grand-total $0.00 tie is untouched**.
- `npm run test` → **92 files / 1103 tests pass** (A3's 1090 + 13). All goldens tie **$0.00**:
  McKenna + synthetic (app-born) and **CARE (imported)**.
- `npx tsc --noEmit` clean; `eslint` clean on all changed/new files.

### Discoveries / gotchas for later phases
- **Imported section lines now live in the table (fail-soft).** The dual-write is still the
  A3 fail-soft swallow-and-log. **B6** (table authoritative) must remove it for BOTH app-born
  and imported, so a lost write surfaces.
- **`inputs` carries strings for imported lines** (`uom`). `EstimateSectionLine.inputs` is
  `Record<string, unknown>`; the app-born synthesis used `Record<string, number>`. The
  imported module widens to `Record<string, number | string>`. Any consumer reading `inputs`
  generically must keep coercing (the app-born bridge's `num()` guard already does).
- **Built-ins-only resolution at the page (A4).** Imported section-line `code`/`label` resolve
  without the user-minted custom-def overlay, so a line minted at a review may show its bare
  code on the *persisted* section line while the read-only panel (which loads
  `getCustomStep23LineDefs()`) shows the deterministic one. Inert today (nothing reads the
  table). Unify in A5 if/when identity becomes graph-addressable (pass `extraDefs`).
- **Imported lines are `lumpSum` constants, not engine-driven.** They are deliberately NOT
  routed through `project.ts` (the app-born bridge). A5 should project them as **constant
  source nodes**, not as live-evaluated lines.

---

## Phase A5 — the next phase (surface section lines as BindingLines / registry source nodes)

**Goal (plan §"Phase A5"):** project the new section-line rows to `BindingLine`s and
`line:<id>:<field>` graph nodes via `src/lib/bindings/registry.ts` — the same way Step 4 rows
are projected — so each GC/Site-Ops line becomes a binding **target** and a rollup **member**.
Fold at the existing `assembleBindingGraphNodes` collision-precedence seam; stay **kind-blind**
(LD-4). **Still behind the existing forms — no grid yet** (that's Track B).

### Scope (from the plan, ID-1 / LD-4)
- Project an `EstimateSectionLine` to the minimal **`BindingLine`** the SetRule evaluator and
  rollup compiler read (mirror `projectLine` for `ProcessedTakeoffRow` in `registry.ts`):
  `id`, `itemId`(= `code`), `costType`, `source`, `procoreCode`, and the aggregatable fields.
  The aggregatable **value** for a section line is its computed total — for **imported** lines
  that is `inputs.value` (the frozen lump); for **app-born** lines it is the engine total the
  A3 bridge (`computePersonnelFromSectionLines` / `computeSiteOpsFromSectionLines`) already
  derives per line. Decide the single seam where each section line's total is resolved
  (app-born = engine line total; imported = `inputs.value`) and emit one
  `line:<id>:total` (+ `:unitPrice`/`:matchedQty` if meaningful) **constant** source node each.
- Fold these section-line source nodes in at **`assembleBindingGraphNodes`** (the ONE
  collision-precedence seam), the same way `lineFieldSourceNodes(lines)` already folds Step 4
  rows — so a user lookup/rollup can **target** a section line's `line:<id>:total` node or
  **aggregate** a set of them. **Stay inert by default**: with no user bindings and the engine
  fold OFF, the grid/recompute path must still short-circuit to `[]` (goldens tie $0.00).
- **Imported section lines project as constants** (the frozen `inputs.value`), never as
  STEP 2/3 lookups — same frozen-vs-derived law as A4.

### Concrete anchors
- Registry seam: `projectLine` / `lineFieldSourceNodes` / `assembleBindingGraphNodes` /
  `userBindingSourceNodes` in `src/lib/bindings/registry.ts`; node-id helper `lineFieldNodeId`
  in `src/lib/bindings/compile.ts`.
- The two A4/A3 synthesis modules: `src/lib/sectionLines/{imported,synthesize,project}.ts`.
  The app-born per-line totals already exist on `computePersonnelFromSectionLines` /
  `computeSiteOpsFromSectionLines` results (`staffLines`/`manualLines`/… each carry `total`).
- The page memo that builds `sectionLines` (`src/app/projects/[projectId]/page.tsx`) — the
  natural place to hand the projected section `BindingLine`s to the binding engine, beside the
  existing `rows`/`bindings` plumbing.
- Kind-blindness contract: all binding-kind knowledge stays in `compileBinding` (LD-4); the
  registry only decides WHICH nodes enter the graph.

### Approval gates
- **None** (no DDL; no export change). The hard gate is: a unit test authors a lookup/rollup
  that targets/aggregates a section line and the engine evaluates it, AND the engine fold stays
  inert by default so **all three goldens tie $0.00**.

### Exit criteria
- A unit test **authors a `lookup` (and a `rollup`)** that targets/aggregates a section line and
  the engine evaluates it to the expected value · the engine fold stays **inert by default** →
  McKenna + synthetic + CARE goldens tie **$0.00** · `npm run test` green · `npx tsc --noEmit`
  clean · committed via `git commit -F` · a `/handoff` sequencing **Phase A+1** (the next
  plan-of-record phase: type-over-with-audit on calc rows, Track A+).
- **Stop at the Phase A5 boundary — do not start Phase A+1 or any Track B grid work.**

### Phase A5 kickoff prompt (paste into a fresh session)

> **Branch first (AGENTS.md / LD-5):** confirm you're on `gc-siteops-addressability`
> (`git switch gc-siteops-addressability`); do NOT work on `main`. Confirm the plan file
> `docs/plans/2026-06-16-gc-siteops-addressability-grid-convergence.md` and this handoff are
> present.
>
> Implement **Phase A5** of GC/Site-Ops Addressability & Grid Convergence (read the plan's
> Phase A5 + locked decisions ID-1 / LD-4 first). Project the new `EstimateSectionLine` rows
> (app-born from `synthesize.ts`/`project.ts`, imported from `imported.ts`) to `BindingLine`s
> and `line:<id>:<field>` graph **source nodes** via `src/lib/bindings/registry.ts` — the same
> way `projectLine` / `lineFieldSourceNodes` project Step 4 rows — and fold them in at the
> existing `assembleBindingGraphNodes` collision-precedence seam, so each GC/Site-Ops line
> becomes a binding **target** and a rollup **member**. App-born section lines project their
> engine-derived per-line total; **imported** section lines project their frozen `inputs.value`
> as a CONSTANT (never a STEP 2/3 lookup — same frozen-vs-derived law as A4). Stay **kind-blind**
> (LD-4: all kind knowledge stays in `compileBinding`). Keep the fold **inert by default** — the
> grid/recompute path with no user bindings and the engine fold OFF must still return `[]` so the
> export goldens tie $0.00. No grid yet (that's Track B). Exit when a unit test authors a
> lookup/rollup that targets/aggregates a section line and the engine evaluates it, all three
> goldens tie $0.00, `npm run test` is green, `npx tsc --noEmit` is clean, the work is committed
> (`git commit -F`), and a `/handoff` doc sequencing **Phase A+1** is written. **Stop at the
> Phase A5 boundary.**

---

## Where this sits in the workstream
Track A: **A1 ✅** → **A2 ✅** (table+gateway, DDL) → **A3 ✅** (lazy synthesis, app-born —
`034b34d`) → **A4 ✅** (imported branch, the #1 risk — `65664be`) → **A5** (project to
BindingLines / registry source nodes). Then **A+1** (override-with-audit, D3), then Track B
(B1 grid-shell extraction → B2/B3 grids → B4 removable seed → B5 one-off escape hatch → B6
finish-migration + retire blobs, DDL). A4 added the **imported** synthesis path; A5 makes BOTH
the app-born (A3) and imported (A4) section lines addressable in the binding graph.
