# GC/Site-Ops Addressability — Phase A+1 closure & Phase B1 kickoff
_2026-06-17 · branch `gc-siteops-addressability` (off `main`) · commit `35c70ae`_

> Plan of record: `docs/plans/2026-06-16-gc-siteops-addressability-grid-convergence.md`
> (read it first — locked decisions D1–D4, ID-1…ID-4). **Track A is now COMPLETE
> (A1→A5 + A+1).** Phase B1 opens **Track B** — the structured-first TanStack grid
> convergence — starting with a behavior-preserving extraction of the shared grid shell.

---

## What Phase A+1 shipped (decision D3 — audited type-over on auto-calc lines)

An estimator can now type a dollar figure **over** an auto-calculated GC (Step 2) or
Site-Ops (Step 3) line's computed result; the computed value is **retained underneath**
and the event records into the existing append-only `estimate_overrides` audit model.
The override layers **per line, inside the A1-parameterized calc engine**, keyed by each
line's **stable section-line node id** — the SAME `line:<id>:total` address Phase A5 made
addressable, so a line's type-over and a line's Linked-Values binding share **one address
space**. **No DDL** (`estimate_overrides.field` is already free TEXT). **No grid yet** —
this is the **headless** engine + audit path; the type-over *gesture* lands in Track B
(mirrors how Linked Values P4 exercised `SET_BINDING` headless before the gesture).

**Inert by default:** with no overrides, every calc result is byte-identical and the new
`overrides` trace key is absent, so all three export goldens (McKenna / synthetic / CARE)
tie **$0.00**.

**The override layers in the calc RESULT** (the cleanest seam, per the A5 closure's "tie
point" note): because each line's `total` becomes the EFFECTIVE (override-applied) value,
the grand total, the linked-division bridge (`computeLinkedDivisionTotals`), the A5
projection (`projectAppBornSectionLines` reads the overridden total by `(section, code)`),
and the export dollar rollup all reflect the type-over **for free** — a bound or
rolled-up GC/Site-Ops line reflects the override with no extra wiring. The typed
qty×price of a GC line still never counts in the STEP 4 subtotal (linked rows are
display-only), so **no double-count**.

### New / changed code
- **NEW `src/lib/sectionLines/ids.ts`** — the single source of truth for the
  `<section>:<group>:<key|code>` section-line id scheme (`gc:staff:<key>`, `gc:op:<code>`,
  `gc:equip:<key>`, `gc:manual:<key>`, `siteops:dynamic:<code>`, `siteops:manual:<key>`)
  plus **`sectionLineTotalOverrideKey(id)`** = `line:<id>:total`. **Zero deps**, so
  `calculations.ts` imports it WITHOUT pulling in the bindings layer (which would create a
  `bindings/registry.ts → calculations.ts` cycle). The key is **equal by contract** to the
  bindings layer's `lineFieldNodeId(id,"total")` — asserted in the test so the two never
  drift. Imported-line ids (`imported:gc:<row>`/`imported:siteops:<row>`) are deliberately
  NOT here: imported lines are frozen constants synthesized in `imported.ts`, never routed
  through the engine, so they carry **no engine-applied override** (D4).
- **`src/lib/sectionLines/synthesize.ts`** — now stamps every synthesized line's id via
  those helpers (byte-identical ids; guarded by `sectionLinesSynthesis.test.ts`).
- **`src/lib/calculations.ts`** — both engines gained a trailing **defaulted**
  `lineOverrides: EstimateOverrideMap = {}` param. A shared pure helper
  **`makeLineOverrideLayer(map, trace)`** returns `apply(sectionLineId, computed)` that
  substitutes a recorded override for a line's COMPUTED total (substitutes `total` ONLY —
  computed qty/rate are retained), recording the computed-vs-override pair in `trace`.
  Honors an explicit `0` (`hasOwnProperty` + `typeof === "number"` — INV-3). Both result
  interfaces (`PersonnelCalcResult` / `SiteOpsCalcResult`) gained an optional **`overrides`
  trace** (`LineOverrideTrace`), present ONLY when ≥1 override applied — mirrors
  `TakeoffSummary.overrides` exactly (so a no-override result is byte-identical).
- **`src/lib/sectionLines/project.ts`** — `SectionCalcContext.lineOverrides` is forwarded
  straight to the engine by `computePersonnelFromSectionLines` /
  `computeSiteOpsFromSectionLines`. This is the seam the **B2/B3 grids drive type-overs
  through**; defaulted/inert until then.

### The recognized-keys guard (the phase's load-bearing risk, plan §Risks)
The engine forms the override key **only from the lines it is actively producing**, so a
stale override **cannot mis-apply**:
- A **foreign / summary key** (`fee`, `subtotal`, `line:gc:staff:DOESNOTEXIST:total`) is
  never looked up — line keys (`line:…:total`) and summary keys are disjoint namespaces, so
  the SAME full `estimate_overrides` map can feed `computeTakeoffSummary` AND both engines
  safely (each consumes only its own keys).
- An override for a **removed line** (D2 subset) is never looked up because the engine no
  longer iterates that line → no `overrides` key, byte-identical to the subset result.

### Tests / verification (A+1 exit — all green)
- **NEW `src/lib/__tests__/calculationsLineOverrides.test.ts`** (10): the key === A5
  node-id contract; **inert-by-default** (no map / `{}` / omitted all byte-identical, no
  `overrides` key); a GC staff override layers (effective `total`, retained computed,
  un-overridden lines derive live, grand total moves by exactly the delta); **INV-3**
  explicit `0`; Site-Ops dynamic + manual in one map; the **recognized-keys guard**
  (foreign/summary key ignored; removed line ignored); the override **flows into
  `projectAppBornSectionLines`** (A5 tie point) and **through the `project.ts` bridge**.
- `npm run test` → **94 files / 1124 tests pass** (A5's 1114 + 10). Goldens tie **$0.00**.
- `npx tsc --noEmit` clean · `eslint` clean on changed/new files · `npm run build` green ·
  `/code-review` (high) — **no findings**.

### Discoveries / gotchas for Track B
- **The override is engine-resolved, headless.** Nothing on the page loads
  `useEstimateOverrides` for GC/Site-Ops lines or threads `lineOverrides` into the calc
  hooks yet — that wiring belongs with the **B2/B3 grid gesture** that actually CREATES a
  type-over (no trigger exists today; wiring it now would be plumbing with no caller and
  needless risk to the calc hooks + their dual-read tripwires). The pure path is proven and
  the `project.ts` seam is ready.
- **Export-detail rendering of an overridden line is a Track B decision (NOT done here).**
  The export DOLLAR rollup (`exporter.ts:416-421`) uses `l.total`, so a type-over flows into
  dollars correctly. But the STEP 2/3 **detail** columns (`exporter.ts:1131-1145`) emit the
  computed `qty`/`rate` — which, for an overridden line, would NOT multiply to the
  overridden total (the engine intentionally retains computed qty/rate). When the gesture
  lands, decide how an overridden line renders its qty/rate on the detail sheet.
- **`reduceLatestActiveOverrides` is the map producer.** When B2/B3 wires this, load the
  estimate's overrides, reduce to the active map (`src/lib/overrides.ts`), and pass the SAME
  map to `computeTakeoffSummary` and both engines (the namespaces are disjoint, proven).

---

## Phase B1 — the next phase (extract the shared grid shell; behavior-preserving)

**Goal (plan §"Phase B1", ID-3):** extract a **generalized grid shell + decoration/Trust
layer** out of `EstimateTable` so Steps 2/3 can later plug in — with **Step 4 as the SOLE
consumer** through this phase. This is the **riskiest Track B phase** (large, coupled
component) and must be **strictly zero-behavior-change**.

### Scope (from the plan, ID-3)
- Adopt/extend the **existing** `src/components/ui/grid/` primitives (which `EstimateTable`
  does **not** yet consume) inside `EstimateTable`.
- Extract the grid shell (TanStack instance plumbing + selection/keyboard + rendering)
  **plus** the decoration/Trust layer (provenance glyph, override ⚑, 🔗 binding badge, cell
  lock, context menu, Trust Inspector) behind a **generalized host contract** that replaces
  today's Step-4-specific `TableMeta` vocabulary (`code|desc|qty|price|uom`,
  `insertManualRow`/`deleteRow`, `lockedCells`, `selection`).
- **Step 4 remains the sole consumer** via `useTakeoffWorkbook` (the dedicated Step-4
  proving phase). Steps 2/3 plug in only in B2/B3.

### Concrete anchors
- `src/components/workspace/EstimateTable.tsx` (~1,236 lines; the only `useReactTable`
  consumer today) and `src/hooks/useTakeoffWorkbook.tsx` (~1,575 lines).
- `src/components/ui/grid/` — the unused primitives to adopt/extend.
- The Trust layer surfaces the A+1 work will eventually need: provenance glyph, override
  ⚑ (today summary-only via `TrustInspector`), 🔗 binding badge (`EngineLinkBadge`), Trust
  Inspector Links tab. Capture these in the host contract so Steps 2/3 reuse them.

### Approval gates
- **None** — but treat the **export goldens + the ENTIRE suite + `tsc` + `build`** as the
  hard gate (zero behavior change). If the extraction can't land green in one session,
  **split it** (an extra handoff is cheap): "adopt ui/grid primitives" then "extract host
  contract".

### Exit criteria (per CLAUDE.md "Definition of Done")
- Export goldens, the **entire** test suite, `tsc`, and `build` ALL unchanged (zero
  behavior change) · `/code-review` resolved · committed via `git commit -F` · a `/handoff`
  doc sequencing **Phase B2** (Step 2 as a grid). **Stop at the Phase B1 boundary.**

### Phase B1 kickoff prompt (paste into a fresh session)

> **Branch first (AGENTS.md / LD-5):** confirm you're on `gc-siteops-addressability`
> (`git switch gc-siteops-addressability`); do NOT work on `main`. Confirm the plan file
> `docs/plans/2026-06-16-gc-siteops-addressability-grid-convergence.md` and this handoff are
> present.
>
> Implement **Phase B1** of GC/Site-Ops Addressability & Grid Convergence (read the plan's
> Phase B1 + decision ID-3 first). This opens Track B: **extract the shared grid shell +
> decoration/Trust layer** out of `EstimateTable` behind a **generalized host contract**
> that replaces the Step-4-specific `TableMeta` vocabulary — adopting/extending the existing
> (currently unused) `src/components/ui/grid/` primitives. **Step 4 must remain the SOLE
> consumer** via `useTakeoffWorkbook` this phase (Steps 2/3 plug in only in B2/B3). This is
> the **riskiest Track B phase** — keep it **strictly zero-behavior-change**: the export
> goldens, the ENTIRE test suite, `tsc`, and `build` must ALL be unchanged. If it can't land
> green in one session, **split it** ("adopt ui/grid primitives" then "extract host
> contract") and write an extra handoff — don't force it. Take the change through the
> CLAUDE.md **Definition of Done** (tests green · tsc clean · build green · `/code-review`
> resolved · `git commit -F`), then write a `/handoff` doc sequencing **Phase B2**. **Stop at
> the Phase B1 boundary.**

---

## Where this sits in the workstream
Track A: **A1 ✅** → **A2 ✅** (table+gateway, DDL) → **A3 ✅** (lazy synthesis, app-born) →
**A4 ✅** (imported branch, the #1 risk) → **A5 ✅** (section lines as BindingLines / source
nodes) → **A+1 ✅** (audited type-over on calc rows, D3 — Track A COMPLETE). Then Track B:
**B1** (grid-shell extraction — the next phase) → B2/B3 (Step 2 / Step 3 grids) → B4
(removable/re-addable seed, D2) → B5 (validated one-off escape hatch, D1) → B6
(finish-migration sweep + retire blobs, ⛔ DDL).
