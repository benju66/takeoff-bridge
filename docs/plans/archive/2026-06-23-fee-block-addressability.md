# Division 60 Fee-Block Addressability (Tier 2, with import fold-in) — Plan of Record
_2026-06-23 · status: PROPOSED_

## Goal
When this is done, the **Division 60 fee/markup block** at the bottom of the STEP 4
Estimate page is no longer a locked, calculated footer. An estimator can right-click
in that block and **Insert Row** to add a flat fee line — e.g. "Preconstruction Fee" =
$2,500.00 — give it a label and a Procore Budget Line Item (BLI), and that line:
- **adds to the grand total as a flat amount that is NOT marked up** by the Fee% /
  insurance% (it sits below the subtotal, like the original estimator did by hand),
- **shows up on the printout** (the exported company XLSX template),
- **rolls up to its Procore BLI** on the Procore export,
- is **fully undo/redo-able** and persists across reloads.

The same machinery fixes the import problem in one stroke: when importing an **old
estimate** that has a hand-keyed fee line in that block (today silently dropped,
causing the "off by $2,500" tie-out failure), the importer captures it as one of these
new flat fee lines so the import **ties out to $0.00** — the line comes in with its
dollar intact and its Procore code left for you to assign.

The seven existing %-driven rows (Fee, contingencies, insurances, bond) are unchanged —
they remain automatic and are still edited via project rate settings.

## Out of scope / deferred
- **The 7 existing modifier rows stay computed.** We do NOT make Fee% / insurance% /
  contingency rates inline-editable in the grid (they keep their current rate-settings
  UI). Tier 2 only ADDS insertable flat lines alongside them. _(Locked decision.)_
- **No marked-up fee lines.** Every new fee line is a flat, below-subtotal add. A
  per-line "mark this up" toggle (above-subtotal placement) is deferred. _(Locked decision.)_
- **PERMITS section grouping** — the permit lines (`01-0230.001` etc.) already import as
  Division 01 rows; giving them a dedicated "PERMITS" section/panel is separate
  housekeeping (see the Permits-section backlog), not this plan.
- **Division 60 header / black-bar template cleanup** — modeling Division 60 as a proper
  CSI division vs. a markup block is template housekeeping, not this plan.
- **No new export template TAB** — we write into the existing STEP 4 fee block; no new
  worksheet is added.
- **Reviving `60-4000.002` in the harvested catalog** — explicitly NOT done; fee-block
  lines live in `estimate_section_lines`, never `estimate-catalog.json`.

## Locked decisions
- **Storage:** reuse the existing `estimate_section_lines` table with a NEW `section`
  value `'markup'`. _Why:_ it already carries `procore_code`, an open `entry_kind` with
  `lumpSum` defined, is inputs-only (never a frozen total — fits "derived, never frozen"),
  and has its own atomic `save_section_lines` RPC. This mirrors the shipped GC/Site-Ops
  Addressability pattern, so fee lines behave like GC/Site-Ops lines. Requires one small
  DDL change (extend the `section` CHECK).
- **Edit scope:** add new flat lines only; the 7 %-modifier rows are untouched.
- **Markup behavior:** new fee lines are flat, below-subtotal, never marked up.
- **Imported lines:** captured with the dollar intact but **Procore code blank /
  needs-review** — never guessed (AGENTS.md "No Speculative Changes" / "No invented
  financial mappings").
- **"Printout" = the exported XLSX template** (no separate PDF path exists).
- **Build order:** storage → calc → render → edit → export → import. Import is the
  capstone that proves the Tier-1 fold-in end-to-end against fully-working machinery.

## Phases

### Phase 1 — Storage foundation (pipe + DDL only)
- **Scope:** Extend `estimate_section_lines.section` CHECK to add `'markup'`. Verify the
  `save_section_lines` RPC and the `src/lib/db.ts` gateway round-trip a markup line
  (the RPC is a full per-project replace across all sections, so markup rows coexist with
  gc/site_ops rows — confirm no section whitelist blocks it). Add the fee-line shape to
  `src/lib/sectionLines/` (`section='markup'`, `entry_kind='lumpSum'`, fields: `label`,
  `amount` input, optional `procore_code`, `source`). TypeScript types only — **no UI, no
  calc, no render** (mirrors GC/Site-Ops Phase A2: lay the pipe).
- **Approval gates:** ⛔ **DDL** — update `supabase_schema.sql` FIRST, then present the
  exact SQL (drop + recreate the `section` CHECK constraint to
  `CHECK (section IN ('gc','site_ops','markup'))`, plus any RPC delta) and **STOP** for
  explicit approval before it touches the live database. Invoke the `supabase:supabase`
  skill first per CLAUDE.md Definition of Done step 1.
- **Exit criteria:** `supabase_schema.sql` updated + approved + applied · gateway/RPC
  round-trip a markup line in a test · `npm run test` green · `npx tsc --noEmit` clean ·
  `npm run build` green · `/code-review` findings resolved · committed via `git commit -F`
  to the workstream branch + pushed · handoff doc written (`/handoff`).

### Phase 2 — Calc engine: flat post-subtotal fee lines
- **Scope:** Feed markup section lines into `computeTakeoffSummary` (`calculations.ts`) as
  a new addend applied **after** `subtotal + 7 modifiers` (so they never enter the markup
  base — `calculations.ts:685`). Add an `additionalFees` (sum) field to the
  `TakeoffSummary` return and into `computedTotal` / `effectiveComponentTotal`. Respect the
  override + rounding layers (each fee line rounded per `applyRounding`); ensure the Trust
  Inspector / reconciliation can attribute the new addend. **No UI yet.**
- **Approval gates:** none.
- **Exit criteria:** unit + golden tests prove a single flat $2,500 line raises
  `totalEstimatedCost` by **exactly $2,500** while `subtotal` and all 7 modifiers are
  **byte-identical** (no compounding) · full Definition of Done (test/tsc/build/review/
  commit+push/handoff).

### Phase 3 — Render fee lines in the estimate + persistence
- **Scope:** Load markup section lines through the gateway and render them in the
  Division 60 block of `EstimateTable.tsx` as real rows alongside the 7 computed modifier
  rows (display: label, amount, Procore code or "unmapped" badge). Wire load + save through
  `save_section_lines` (alongside the GC/Site-Ops save path, independent of the Step 4
  `save_estimate` line-item replace). **Display + persistence only — no editing / context
  menu yet.** Likely requires lifting the block out of the static `<tfoot>` (`EstimateTable.tsx:989`)
  into a render path that can host data rows.
- **Approval gates:** none.
- **Exit criteria:** a stored markup line shows on the estimate page, with its flat amount
  reflected in the total, and survives a reload · full Definition of Done.

### Phase 4 — Edit fee lines: context menu + command history
- **Scope:** Make the context menu functional in the fee block — **Insert Row** (add a
  flat fee line), **Delete Row**, and inline-edit label / amount / Procore code. Wire
  **command history** (`commandHistory.pushCommand()` with a properly constructed
  `WorkbookCommand`, per AGENTS.md) so insert / delete / edit are each fully undo/redo-able
  with inverse data. Inserted lines get `source='manual'`. Validate the Procore code against
  the `procore_cost_codes` authority (via the primed overlay), surfacing the override UI for
  unknown codes rather than inventing a type. _("Define Link" stays as-is — it is the
  value-binding authoring panel, NOT the Procore mapping; out of scope here.)_
- **Approval gates:** none.
- **Exit criteria:** insert / edit / delete work in the block; a single Ctrl+Z reverses
  each atomically; manual lines persist with `source='manual'` · full Definition of Done.

### Phase 5 — Export: write fee lines into the template + Procore rollup
- **Scope:** Extend `exporter.ts` so markup fee lines are written into the exported STEP 4
  fee block (the "printout") and roll up to their mapped Procore BLI on the Procore export.
  Handle the fixed-template-layout constraint (the template's fee rows are fixed positions
  ~333–340; inserting a variable number of lines must not corrupt the sheet or break the
  SUBTOTAL/TOTAL formulas — write cells in ascending column order per CLAUDE.md). Unmapped
  lines follow existing export rules (skip-with-flag, never silently mis-route).
- **Approval gates:** none (no new template tab). **Flag:** export-fidelity is the highest
  risk — see Risks.
- **Exit criteria:** the exported template shows the new line in the fee block; the Procore
  export rolls it to the correct BLI; `export-integrity` golden delta is **$0.00** vs the
  engine · full Definition of Done.

### Phase 6 — Import wiring (Tier 1 fold-in) + tie-out golden
- **Scope:** Change the modifier loop in `templateExtractor.ts` (~lines 440–457) so a
  fee-block row that is NOT one of the 7 known modifiers is **captured** as a markup section
  line (`entry_kind='lumpSum'`, `source='csv_import'`, `procore_code=''` → needs-review)
  instead of `continue`-skipped (`:443`). Route it through `importEstimate.ts` so the engine
  total includes it and `checkImportTieOut` ties out. Surface these lines in the import
  review with an editable Procore mapping (per the "unmapped, you assign it" decision).
- **Approval gates:** none. After this phase the workstream is complete →
  **⛔ merge to `main` requires explicit architect approval** (the one main-push prompt is
  the gate, per CLAUDE.md Git Workflow).
- **Exit criteria:** a golden test of a past estimate carrying a hand-keyed $2,500 fee-block
  line imports with tie-out delta **$0.00** (the off-by-$2,500 fixed); the line appears
  editable and unmapped in the review · full Definition of Done.

## Risks & unknowns
- **Export fidelity (highest risk — Phase 5 finds out).** The XLSX template's fee block is
  a fixed-row layout with SUBTOTAL/TOTAL formulas referencing specific rows. Injecting a
  variable number of new lines risks shifting/breaking those references or corrupting the
  sheet. Mitigation candidates surface in Phase 5 (reserve spare rows vs. true row-insert
  with formula re-anchoring). If row-insertion proves unsafe, Phase 5 may narrow to a capped
  number of fee lines.
- **RPC / gateway section handling (Phase 1).** If `save_section_lines` or the gateway
  whitelists sections anywhere beyond the CHECK, Phase 1 must widen it; the plan assumes the
  full-replace RPC is section-agnostic.
- **Footer → grid lift (Phase 3).** The block currently renders in `<tfoot>` as computed
  cells; hosting editable data rows there may affect table layout, virtualization, and the
  status-bar/Buyout-footer ordering. Phase 3 confirms the cleanest render path.
- **Command-history reuse (Phase 4).** Whether the existing grid `WorkbookCommand` model
  cleanly covers section-line insert/delete/edit, or needs a new command variant, is
  resolved in Phase 4.
- **Trust Inspector / bindings coverage (Phases 2–3).** The new addend must be explainable
  in the Trust Inspector and reconciliation; whether fee lines also need to be bindable
  graph nodes is assessed as we render them.

## Phase 1 kickoff prompt
> Implement **Phase 1 of the Division 60 Fee-Block Addressability plan**
> (`docs/plans/2026-06-23-fee-block-addressability.md`). Scope is the **storage foundation
> only**: extend `estimate_section_lines` to support a new `section='markup'`, confirm the
> `save_section_lines` RPC + `src/lib/db.ts` gateway round-trip a markup line, and add the
> fee-line shape to `src/lib/sectionLines/` (`entry_kind='lumpSum'`, fields label / amount /
> optional procore_code / source) with TypeScript types. **No UI, no calc, no render** —
> this phase only lays the pipe (mirrors GC/Site-Ops Phase A2).
>
> This is DDL work: invoke the `supabase:supabase` skill FIRST, update `supabase_schema.sql`
> BEFORE touching the live DB, then present the exact SQL (drop + recreate the `section`
> CHECK to `CHECK (section IN ('gc','site_ops','markup'))`, plus any RPC delta) and **STOP
> for explicit approval** before applying it live. Do not apply un-approved DDL.
>
> Take the phase through the full Definition of Done (test green · `tsc --noEmit` clean ·
> `npm run build` green · `/code-review` resolved · commit via `git commit -F` to the
> workstream branch + push). **Stop at the phase boundary** and write the Phase 2 handoff
> with the `/handoff` skill. Run only this one phase.
