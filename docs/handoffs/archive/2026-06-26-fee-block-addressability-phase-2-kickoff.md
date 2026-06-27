# Phase 2 Kickoff — Division 60 Fee-Block Addressability: Calc engine (flat post-subtotal fee lines)

_Ready-to-paste prompt for a fresh cold session. Written 2026-06-26._

---

## Kickoff prompt

> Implement **Phase 2 of the Division 60 Fee-Block Addressability plan**
> (`docs/plans/2026-06-23-fee-block-addressability.md` — read it first, plus the
> Phase 1 context below). Scope is the **calc engine only**: feed `section='markup'`
> fee lines into the estimate summary as a **flat addend applied AFTER the subtotal +
> the 7 modifiers**, so the new dollars NEVER enter the markup base (no compounding).
>
> **Concretely:**
> - Add an `additionalFees` (sum of the markup lines' amounts) field to the
>   `TakeoffSummary` interface (`src/lib/calculations.ts:508`) and to the returned
>   object (`:698`).
> - Feed the markup lines (or their pre-summed amount) into `computeTakeoffSummary`
>   (`:572`). Each fee line's amount is rounded per the existing `applyRounding`
>   helper (`:630`) for visual-sum alignment (Zero Budget Leaks), then summed.
> - Add `additionalFees` into BOTH `computedTotal` (`:652`) and
>   `effectiveComponentTotal` (`:685`) — i.e. AFTER `subtotal + CC + DC + BR + SI +
>   GL + Bond + Fee`. It must NOT be added to `subtotal` and must NOT feed any of the
>   7 `raw*` modifier computations (which are `subtotal * rate` at `:621-627`) — that
>   is what guarantees "flat, below-subtotal, never marked up" (locked decision).
> - Respect the override + rounding layers: a direct `totalEstimatedCost` override
>   still wins; component overrides still reconcile (INV-4). Decide whether
>   `additionalFees` itself is overridable as a component (`eff("additionalFees",
>   …)`) and/or per-line via the `line:<id>:total` override key
>   (`src/lib/sectionLines/ids.ts:sectionLineTotalOverrideKey`) — mirror how
>   GC/Site-Ops one-off line totals are attributed.
> - Ensure the **Trust Inspector / reconciliation** can attribute the new addend
>   (the grand total must still reconcile to its components — search the bindings /
>   summary-node describers, e.g. `describeSummaryNodes` in
>   `src/lib/bindings/engineGraph.ts`, and add a node for `additionalFees` if the
>   reconciliation test requires it).
>
> **No UI, no render, no export, no import** — Phase 2 is engine math only. Markup
> lines are still not loaded into any page (that is Phase 3).
>
> **Approval gates:** none (no DDL, no schema change — the storage + types already
> exist from Phase 1). Do NOT merge to `main`.
>
> Take the phase through the full **Definition of Done** (CLAUDE.md): `npm run test`
> green · `npx tsc --noEmit` clean · `npm run build` green · `/code-review` resolved ·
> commit via `git commit -F` to the **existing** `fee-block-addressability` branch +
> push · write the Phase 3 handoff via `/handoff`. **Run only this one phase.**

---

## Exit criteria (from the plan, Phase 2)

- Unit + golden tests prove a single flat **$2,500** markup line raises
  `totalEstimatedCost` by **exactly $2,500**, while `subtotal` and all 7 modifiers
  (CC / DC / Builders Risk / Special Insurance / GL / Bond / Fee) are
  **byte-identical** to the no-fee-line result (no compounding into the markup base).
- An empty markup-line set leaves every `TakeoffSummary` field byte-identical to
  today (the change is fully INERT with no fee lines — mirror the override layer's
  "fully INERT when absent" property).
- Full Definition of Done: test green · `tsc` clean · `build` green · `/code-review`
  resolved · committed + pushed to `fee-block-addressability` · Phase 3 handoff written.

---

## Where Phase 1 left off (storage foundation — COMPLETE)

Phase 1 is **done, committed (`4b4d699`), and pushed** on branch
`fee-block-addressability`. It laid the storage pipe only — no calc, no UI.

**DDL (approved + applied live to project `nefvkrhbbkiqnpeabyqz`):**
- `estimate_section_lines_section_check` was DROP + re-ADD'd to widen the CHECK to
  `section IN ('gc','site_ops','markup')`. Verified live. `supabase_schema.sql`
  updated to match (the canonical source of truth).
- **No RPC change** was needed: `save_section_lines` and the `src/lib/db.ts` gateway
  (`saveSectionLines` / `getSectionLines`, `buildSectionLinePayload` /
  `mapSectionLineFromRow`) are **section-agnostic** — `section` passes straight
  through the JSONB payload. A markup line round-trips with zero gateway edits.

**Code shipped in Phase 1:**
- `src/types/db.ts` — `SectionDiscriminator` widened to `'gc' | 'site_ops' | 'markup'`.
- `src/lib/sectionLines/markup.ts` **(new)** — the fee-line shape:
  - `MARKUP_SECTION` (`'markup'`) constant.
  - `isMarkupLine(line)` — section discriminator predicate.
  - `feeLineAmount(line)` — reads the flat dollar from `inputs.amount` (0 if absent/invalid).
  - `NewFeeLineInput` + `newFeeLine(input)` — builds an `EstimateSectionLine` with
    `section='markup'`, `entryKind='lumpSum'`, `inputs={ amount }`, `code=''`,
    **blank `procoreCode` by default** (never guessed — AGENTS.md "No Speculative
    Changes"), `source` defaulting to `'manual'`. Identity rides `id`
    (`markup:fee:<uuid>`); the row PK is `(project_id, id)`.
- `src/lib/sectionLines/oneOff.ts` — `isOneOffLine()` tightened to also require a
  `gc`/`site_ops` section, so a markup fee line (which is ALSO `source='manual'` +
  `lumpSum`) is never misclassified as a GC/Site-Ops one-off. Behavior-identical for
  all existing data (every caller already pre-filters to gc/site_ops).
- `src/lib/__tests__/markupFeeLine.test.ts` **(new)** — builder/reader unit coverage
  + a gateway round-trip (save→reload) proving the RPC payload carries
  `section='markup'`, `entry_kind='lumpSum'`, and `inputs.amount`, and that
  `isOneOffLine()` rejects a markup line. Full suite **1429 passing**; tsc clean;
  build green.

## Phase 2 gotchas / pointers

- **Storage shape:** a fee line's dollar is in `inputs.amount` (NOT `inputs.value` —
  that is the GC/Site-Ops one-off convention). Use `feeLineAmount()` from
  `markup.ts` to read it; use `isMarkupLine()` to filter.
- **Identity:** markup lines are addressed by `id`, not `code` (`code` is `''`). Any
  per-line override / graph node must key off `id` (`line:<id>:total`), exactly like
  the A+1 section-line type-over (`sectionLineTotalOverrideKey` in
  `src/lib/sectionLines/ids.ts`).
- **Never marked up:** the 7 modifiers are computed as `subtotal * rate`
  (`calculations.ts:621-627`) BEFORE the override layer; do not let `additionalFees`
  touch `subtotal` or any `raw*`. Add it only at the two TOTAL summation points
  (`computedTotal` `:652`, `effectiveComponentTotal` `:685`).
- **Rounding:** round each fee line individually via the existing `applyRounding`
  closure (`:630`) before summing, to keep visual-sum alignment (each component is
  rounded independently per the existing comment at `:642`).
- **Inert-when-empty:** with no markup lines, `additionalFees` must be `0` and every
  other field byte-identical — add a test asserting this (mirrors the override
  layer's INV property).
- **No DB read yet:** Phase 2 does not load markup lines from the DB into the page —
  pass them (or their sum) into the pure engine in tests. Wiring the page load
  through `getSectionLines` + rendering is Phase 3.

## Remaining phases (plan of record)

- **Phase 3** — Render markup lines in the Division 60 block (load via gateway,
  display + persistence; likely lift the block out of the static `<tfoot>`).
- **Phase 4** — Edit: context-menu Insert/Delete + inline edit, command history
  (undo/redo), `source='manual'`, Procore code validation against the authority.
- **Phase 5** — Export: write fee lines into the template fee block + Procore BLI
  rollup (highest risk — fixed-template-layout / formula re-anchoring).
- **Phase 6** — Import fold-in (`templateExtractor.ts` ~440-457): capture an
  unknown fee-block row as a markup line so a hand-keyed `$2,500` fee ties out to
  `$0.00`. **After Phase 6 the workstream is complete → merging to `main` requires
  explicit architect approval** (the one main-push prompt is the gate).
