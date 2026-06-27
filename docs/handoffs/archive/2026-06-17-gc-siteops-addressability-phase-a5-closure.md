# GC/Site-Ops Addressability — Phase A5 closure & Phase A+1 kickoff
_2026-06-17 · branch `gc-siteops-addressability` (off `main`)_

> Plan of record: `docs/plans/2026-06-16-gc-siteops-addressability-grid-convergence.md`
> (read it first — locked decisions D1–D4, ID-1…ID-4). Phase A5 is **done & committed**.
> Phase A+1 layers an audited type-over on the auto-calc lines (D3).

---

## What Phase A5 shipped

The Linked Values **LD-1 addressability gap closes**: the new A3/A4 `EstimateSectionLine`
rows are now first-class in the kind-blind binding graph. Each GC (Step 2) and Site-Ops
(Step 3) line can be a binding **target** (`line:<id>:total`) and a rollup **member** — the
exact same way STEP 4 rows already can. **No DDL, no export change, no grid (that's Track B).**
The fold is **inert by default**: a project with no user bindings still builds zero graph
nodes, so all three export goldens tie **$0.00**.

The money-safety law from A4 carries straight through the projection:
- **App-born lines** expose their LIVE engine per-line total (the calc engine stays the sole
  total authority — A5 only *reads* the totals it already produced).
- **Imported lines** expose their FROZEN `inputs.value` (the as-bid lump) as a **constant** —
  never recomputed. A live STEP 2/3 input can never move them (the constants gate).

### New code — `src/lib/bindings/registry.ts` (the projection + fold)
- **`projectSectionLine(line, total)`** — the section analog of `projectLine`. Projects an
  `EstimateSectionLine` → minimal `BindingLine`: `itemId = line.code` (so a SetRule's
  `itemId`/`division`/`costType` predicate addresses it like a STEP 4 line), carries
  `costType`/`source`/`procoreCode`, `total` = the caller-resolved total, and
  **`unitPrice`/`matchedQty` = 0** (a GC/Site-Ops line has no qty×price decomposition).
- **`projectAppBornSectionLines(lines, gc, siteOps)`** — resolves each line's total from the
  live calc results **by `(section, code)`** (codes are unique within a section, the same
  assumption `sectionTotalsByCode` and the engine leaf tiers make; an unmatched code → 0).
- **`projectImportedSectionLines(lines)`** — total = frozen `inputs.value` (constant; the
  parametric calc results are NOT consulted). These two projectors ARE the single
  total-resolution seam (app-born = engine / imported = frozen).
- **`AssembleBindingGraphOptions.sectionLines?: readonly BindingLine[]`** — pre-projected
  section lines folded into `assembleBindingGraphNodes` via the one `lines` array
  (`[...rows.map(projectLine), ...options.sectionLines]`). Because section-line ids
  (`gc:*`/`siteops:*`/`imported:*`) are **disjoint** from STEP 4 row ids (`line:<uuid>`),
  the combined set both (a) emits each section line's `line:<id>:<field>` source node (via
  `userBindingSourceNodes → lineFieldSourceNodes`) AND (b) makes section lines
  rollup-membership candidates (via `compileBindingToNode → selectLines`). **Folded BELOW the
  inert early-return**, so passing section lines never defeats inertness. Default `[]` →
  every existing caller (grid recompute, Links tab `trustInspector.ts`, the cycle-guard) is
  byte-identical. Stays **KIND-BLIND** (LD-4 — no kind knowledge added here; it only decides
  WHICH nodes enter the graph).
- **`recomputeLineBindingValues`** gained a trailing defaulted `sectionLines` param, passed
  straight into `assembleBindingGraphNodes`.

### Wiring — the page hands the projected lines to the engine
- `src/app/projects/[projectId]/page.tsx`: the `sectionLines` memo **moved up** above the
  `useTakeoffWorkbook` call (it has no dependency on `rows`, so the move is safe), and a new
  **`sectionBindingLines`** memo projects it (branch on `isImported` → imported vs app-born
  projector) and is passed as the new last arg to `useTakeoffWorkbook`. Persistence still
  consumes the same `sectionLines`.
- `src/hooks/useTakeoffWorkbook.tsx`: new trailing optional param
  `sectionBindingLines: readonly BindingLine[] = []`, forwarded to `recomputeLineBindingValues`
  (so the live grid recompute folds section lines too). `[]` default = inert; existing callers
  unchanged.

### Tests / verification (A5 exit — all green)
- New **`src/lib/__tests__/sectionLineBindings.test.ts`** (11): projection field-mapping
  (`unitPrice`/`matchedQty` = 0); app-born totals resolve from the calc by code (+ unmatched →
  0); imported total = `inputs.value` NOT qty×rate, plus the **CONSTANTS gate** (mutate
  qty/rate with the frozen total held → projected total unchanged); a **lookup reading** a
  section line; a **rollup aggregating** section lines (explicitIds → Σ totals); a section line
  as a binding **target** (its constant replaced); an **imported** section line as a constant
  source; and **inert by default** (`assembleBindingGraphNodes`/`recomputeLineBindingValues`
  return `[]`/empty with no bindings even when section lines are passed).
- `npm run test` → **93 files / 1114 tests pass** (A4's 1103 + 11). All goldens tie **$0.00**:
  McKenna + synthetic (app-born) and **CARE (imported)**.
- `npx tsc --noEmit` clean; `eslint` clean on all changed/new files.

### Discoveries / gotchas for later phases
- **The fold is groundwork, not yet user-reachable.** Section lines now enter the live graph
  whenever a binding exists, but there is **no UI** that authors a binding against a section
  line yet (the authoring picker `DefineLinkPanel` still passes only STEP 4 `rows` to
  `userBindingSourceNodes`). Surfacing section-line nodes in the picker + Links tab is a
  **Track B** concern (the grid). A5 deliberately keeps it inert/headless (mirrors how
  Linked Values P4 exercised `SET_BINDING` headless before the gesture landed).
- **By-`code` total resolution assumes codes are unique within a section.** This is the same
  assumption already baked into `sectionTotalsByCode` and the engine leaf-label tiers. If a
  future one-off (B5) introduces a duplicate code within a section, resolve app-born totals by
  section-line **id** instead (e.g. zip the A3 bridge result), not by code.
- **`unitPrice`/`matchedQty` are 0 for section lines.** A rollup over `field: "unitPrice"` or
  `"matchedQty"` of section lines sums zeros — intentional (a GC/Site-Ops line has no clean
  unit decomposition). Only `total` is meaningful. If a future need arises, populate them in
  the projector, not at the call site.

---

## Phase A+1 — the next phase (audited type-over on auto-calc lines, D3)

**Goal (plan §"Phase A+1"):** let an estimator type a number **over** an auto-calc GC/Site-Ops
line's computed result, keeping the computed value underneath and recording the event in the
append-only `estimate_overrides` audit model. Built and tested **headless** (a dev/test path —
the actual type-over *gesture* lands in Track B's grid).

### Scope (from the plan, D3)
- Layer **`override ?? computed` per line** inside the A1-parameterized engine
  (`computePersonnelCosts` / `computeSiteOperations`), keyed by each line's **stable node id**
  (the same `line:<sectionLineId>:total` ids A5 just made addressable — so a line override and
  a line binding share one address space). The computed value is **always retained**.
- **Reuse** `recordEstimateOverride` / `getEstimateOverrides` and the existing append-only audit
  model. The `estimate_overrides.field` column is already free TEXT, so line node ids need **no
  migration** (NO DDL).
- The engine must apply an override **only to keys it recognizes** (mirror
  `OVERRIDABLE_SUMMARY_FIELDS`), or a stale override could mis-apply (plan §Risks — "Override
  addressing vocabulary"). This is the load-bearing guard for the phase.
- The Trust Inspector shows **computed + manual side by side** (display wiring; the editor
  gesture is Track B).

### Concrete anchors
- Engine seam: the per-line `.map(...)` bodies in `computePersonnelCosts` /
  `computeSiteOperations` (`src/lib/calculations.ts`) — layer the override at the point each
  line's `total` is finalized, keyed by the line's stable id (the A3/A4 synthesizers stamp
  those ids: `gc:staff:<key>`, `siteops:manual:<key>`, `imported:gc:<row>`, …).
- Override model: `recordEstimateOverride` / `getEstimateOverrides` (`src/lib/db.ts`),
  `src/lib/overrides.ts` (the `override ?? computed` layering already used for summary fields),
  `useEstimateOverrides` hook, and `OVERRIDABLE_SUMMARY_FIELDS` (the recognized-keys pattern to
  mirror for line ids).
- Tie point: the override must layer **before** the section line's total is projected to its
  `line:<id>:total` binding source node (A5) — so a bound/rolled-up section line reflects the
  override too. Decide whether the override layers in the calc result (so
  `projectAppBornSectionLines` reads the overridden total for free) — the cleanest seam.

### Approval gates
- **None** (no DDL — reuses `estimate_overrides`; the `field` column is already free TEXT).

### Exit criteria
- A recorded line override **layers over** the computed value; un-overridden lines still derive
  live · the engine applies overrides **only to recognized line keys** · **inert with no
  overrides** → all three goldens tie **$0.00** · `npm run test` green · `npx tsc --noEmit`
  clean · committed via `git commit -F` · a `/handoff` sequencing **Phase B1** (extract the
  shared grid shell — the first Track B phase). **Stop at the Phase A+1 boundary.**

### Phase A+1 kickoff prompt (paste into a fresh session)

> **Branch first (AGENTS.md / LD-5):** confirm you're on `gc-siteops-addressability`
> (`git switch gc-siteops-addressability`); do NOT work on `main`. Confirm the plan file
> `docs/plans/2026-06-16-gc-siteops-addressability-grid-convergence.md` and this handoff are
> present.
>
> Implement **Phase A+1** of GC/Site-Ops Addressability & Grid Convergence (read the plan's
> Phase A+1 + decision D3 first). Layer an **audited type-over** on the auto-calc GC/Site-Ops
> lines: inside the A1-parameterized engine (`computePersonnelCosts` / `computeSiteOperations`),
> apply `override ?? computed` **per line**, keyed by each line's **stable node id** (the same
> `line:<sectionLineId>:total` ids Phase A5 made addressable), always **retaining** the computed
> value. **Reuse** `recordEstimateOverride` / `getEstimateOverrides` and the append-only
> `estimate_overrides` model (the `field` column is already free TEXT — **NO DDL**). The engine
> must apply an override **only to line keys it recognizes** (mirror `OVERRIDABLE_SUMMARY_FIELDS`)
> so a stale override can't mis-apply. Build and test **headless** (a dev/test path — the
> type-over *gesture* lands in Track B's grid). Keep it **inert with no overrides** so all three
> goldens tie $0.00. Exit when a unit test proves a recorded line override layers over the
> computed value while un-overridden lines still derive live, the goldens tie $0.00,
> `npm run test` is green, `npx tsc --noEmit` is clean, the work is committed (`git commit -F`),
> and a `/handoff` doc sequencing **Phase B1** is written. **Stop at the Phase A+1 boundary.**

---

## Where this sits in the workstream
Track A: **A1 ✅** → **A2 ✅** (table+gateway, DDL) → **A3 ✅** (lazy synthesis, app-born) →
**A4 ✅** (imported branch, the #1 risk) → **A5 ✅** (section lines as BindingLines / source
nodes — addressability gap closed). Then **A+1** (override-with-audit on calc rows, D3 — the
next phase), then Track B (B1 grid-shell extraction → B2/B3 grids → B4 removable seed → B5
one-off escape hatch → B6 finish-migration + retire blobs, DDL).
