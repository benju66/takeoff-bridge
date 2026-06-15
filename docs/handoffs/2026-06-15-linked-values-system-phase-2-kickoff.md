# Linked Values System — Phase 2 Kickoff (paste into a fresh session)

_Handoff written 2026-06-15. Phase 1 is complete; this sequences Phase 2._

---

## Where Phase 1 left off (one line)

The kind-agnostic binding **engine room** is built as pure library code (`src/lib/bindings/`)
with exhaustive unit tests — committed as **`4ced34d`** on branch **`linked-values-system`**;
nothing is wired into the pages, DB, or calculation engine yet, so the goldens are untouched.

## Branch (LD-5) — do this first

```
git switch linked-values-system
```

Do **NOT** work on `main` or on `template-catalog-reconciliation`. The plan of record and all
Phase 1 code already live on `linked-values-system` (Phase 1 = `4ced34d`, plan = `a658de1`,
branched off `main` `d1529a0` which already contains the merged reconciliation workstream).

> Note: the branch working tree carries some **unrelated** pre-existing WIP from before this
> workstream (`CLAUDE.md`, `src/app/cost-codes/page.tsx`, a couple of `docs/plans/*` edits,
> `COMMIT_MSG.txt`, `review.diff`). It is NOT part of Linked Values — leave it alone and never
> `git add -A`; stage only the files you create/modify for Phase 2.

## Read before any code

1. **Plan of record:** `docs/plans/2026-06-15-linked-values-system.md` — especially **§2** (the
   authored binding spec), **§5 Phase 2**, and **§6 Risks** (the imported-project branch is the
   single highest-risk item — see below).
2. **Phase 1 surface you'll build on** (`src/lib/bindings/`):
   - `types.ts` — `Binding`, open `BindingKind`, `Basis`, `SetRule`, `GraphNode`, `BindingLine`,
     `CompileContext`.
   - `graph.ts` — `buildGraph` / `topologicalSort` / `findCycle` / `evaluateGraph` (kind-blind).
   - `compile.ts` — `compileBinding`, `compileBindingToNode`, `lineFieldNodeId`,
     `DEFAULT_ROLLUP_FIELD` (the ONLY kind-aware module).
   - `setRule.ts` — `matchesSetRule` / `selectLines`.

## Phase 2 — Value registry + reframe the existing bridge (end-to-end proof)

**Goal:** prove the new engine reproduces the app's existing linked-division behavior **exactly**,
then route the live injection through the engine as a drop-in — with zero golden movement.

### Scope

- **New `src/lib/bindings/registry.ts` (pure).** Turn the existing calc results into source
  `GraphNode`s with the stable IDs from spec §2.2:
  - STEP 2 GC computed values → `gc:<key>` (e.g. `gc:supervisionSubtotal`, `gc:grandTotal`)
    and raw inputs → `gc:input:<configKey>` as needed.
  - STEP 3 Site-Ops computed values → `siteops:<section>` (e.g. `siteops:demolition`,
    `siteops:grandTotal`).
  - STEP 4 line fields → `line:<rowId>:<field>` via `lineFieldNodeId` (project the rows to
    `BindingLine`).
  - Summary fields → `summary:<field>` (only as needed for this phase).
  These are **constant source nodes** (`inputs: []`, `evaluate: () => value`).
- **Express the 10 `LINKED_DIVISION_ROWS` as `lookup` bindings** (target
  `line:<linkedRowId>:total` ← `gc:supervisionSubtotal` / `gc:general` / `siteops:<section>` per
  the existing `source.kind` discriminator) and prove
  `evaluateGraph([...sourceNodes, ...lookupNodes])` reproduces
  `computeLinkedDivisionTotals(gcCalcResult, siteOpsCalcResult)` **to the cent for all 10 rows**.
- **Route the page's linked-total injection through the engine as a drop-in.** Replace the call
  site that currently injects `computeLinkedDivisionTotals` output with the engine-produced
  values, keeping the exact same numbers.

### Existing code to study (accurate pointers)

- `src/lib/calculations.ts` — `computeLinkedDivisionTotals` (~line 241): the oracle to reproduce.
  Note its two non-lookup sources: `gcGeneralTotal = gcCalcResult.grandTotal - supervisionTotal`
  (a derived value, not a raw subtotal) and the per-section sums over Site-Ops lines.
- `src/lib/constants.ts` — `LINKED_DIVISION_ROWS` (~line 506) with the `source.kind` discriminator
  (`gcSupervision | gcGeneral | {section}`), and `SUPERVISION_STAFF_CODES` / `SITE_OPS_*_DEFAULTS`.
- `src/hooks/useTakeoffWorkbook.tsx` and `src/app/projects/[projectId]/page.tsx` — where linked
  totals are injected and `getLinkedRowState` marks rows read-only (the drop-in target).
- `src/lib/importEstimate.ts` + `src/__tests__/imported-step23.test.ts` — the imported branch.

### ⚠️ Highest-risk item (do not miss) — the imported-project branch

For **imported** projects (`isImported`), the page reads linked totals from the **saved rows**
(`linkedTotalsFromRows`), NOT from STEP 2/3 (which are frozen for imported bids). The reframe MUST
preserve this: for imported projects, the linked nodes are **constants sourced from the saved row
values**, NOT lookups into STEP 2/3. If you wire imported linked rows as STEP 2/3 lookups, the
**imported golden will drift**. Build the registry so the source of the linked constants is
branch-aware (app-born → STEP 2/3 computed values; imported → saved row values).

### Carry-forward note from the Phase 1 code review

`compileRollup`'s `evaluate` defaults an absent member node to `0`. Not exercised in Phase 2 (the
10 reframed rows are **lookups**, not rollups), but when the registry starts feeding rollups, it
**must emit a source node for every line a SetRule can match**, or rollups silently under-count.

### Approval gates

**None** for Phase 2 (no DB, no DDL, no UI, no export change). Phase 2 is pure-lib + a drop-in at
one call site. (The DDL gate is **Phase 3** — `estimate_bindings` table.) Do **not** start Phase 3.

### Exit criteria

- A test asserting the engine output **`===` legacy `computeLinkedDivisionTotals`** for all 10 rows
  (app-born) AND that the **imported branch is preserved** (imported linked nodes = saved-row
  constants).
- **Both goldens tie $0.00** — the app-born golden AND an imported-project golden
  (`golden-mckenna` / `golden-synthetic` / `golden-care` + the imported path).
- `npm run test` green · `npx tsc --noEmit` clean · `npx eslint <changed files>` clean.
- Work committed on `linked-values-system` (multi-line message via `git commit -F <tempfile>`;
  never inline a multi-line PowerShell commit).
- A Phase 3 handoff doc written via the `/handoff` skill.

**STOP at the Phase 2 boundary — do not start Phase 3 (the DDL gate).**

---

## Process reminders (AGENTS.md / CLAUDE.md)

- Present the implementation plan table + run the SKILL.md 5-step verification, and **wait for
  explicit approval** before writing code (Execution Boundary).
- Lead chat responses with a plain-language summary, full technical depth below it.
- Windows: use the **PowerShell** tool; no emoji in scripts; commit via `git commit -F <file>`.
- Keep the graph core kind-blind (LD-4) — `kind` must appear ONLY in `compileBinding`. The registry
  produces plain `GraphNode`s and `Binding`s; it must not teach the graph any kind.
