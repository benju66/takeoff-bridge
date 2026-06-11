# STEP 2/3 Review Gate at Import — Plan of Record
_2026-06-10 · status: PROPOSED · import-module roadmap item 1
(kickoff: docs/handoffs/import-step23-review-gate-kickoff.md)_

## Goal
When an estimator imports a past bid, the GC/Site-Ops (STEP 2/3) lines get the same
audit treatment STEP 4 lines already get. On the import page, before saving, the
estimator can: **see** every captured STEP 2/3 line with the code it will resolve to
("→ 01-0410.001" or "unmapped"); **correct** a wrong as-bid unit before it enters the
project and the /rates rate history; **assign** an existing GC/Site-Ops code to an
unmapped line (e.g. CARE's hand-inserted "Demolition - Openings in CMU" → Demolition);
and **create** a brand-new deterministic code (e.g. `02-4100.003`) when no existing
line fits — a code that then auto-resolves the same line in every other bid, past and
future, with no re-import. Assigned and created codes count as resolved, so those
lines feed the /rates staff-rate history. The review is advisory: skipping it imports
everything verbatim, exactly as today.

## Out of scope / deferred
- **Post-import assignment** — assigning a code to a line on an already-saved import.
  Re-import remains the recovery path. (Different feature; needs its own design
  because the stored payload is write-once.)
- **Roadmap items 2–5** — past-vs-active distinction, housekeeping, the full Catalog
  Manager (which still owns editing/retiring custom codes and STEP 4 catalog adds),
  fork-a-past-bid. Do not chain.
- **Calculator/rate-card integration of custom codes** — a minted code does not
  appear in the app's GC/Site-Ops calculators or get a rate-card row. It is a label,
  a resolver target, and a mining key. Giving it a card rate (and ADOPT) comes later.
- **Lump-override mining; export-of-imports.**

## Locked decisions (architect, 2026-06-10)
- **Assignment is additive** — an assigned line stores a new optional `assignedCode`
  next to its verbatim as-bid code; the original code is never rewritten.
- **New-code creation happens at the import gate** (architect overruled deferring it
  to Catalog Manager): a new DB-backed table holds user-minted GC/Site-Ops line
  definitions, and the resolver reads them on top of the built-in definitions at
  render time — which makes a minted code apply retroactively to every stored bid.
- **Mint form = code + name + unit + Procore BLI if known**: suffix auto-suggested
  (next free `.NNN` for the base), name defaults to the line's description (this is
  what makes auto-resolution work), unit defaults to the as-bid UOM, and an optional
  Procore Budget Line Item picked from the valid list (nullable — Catalog Manager
  can fill it in later).
- **Assignment = resolution**: assigned/minted lines feed the /rates mining, subject
  to the existing minable filter (qty ≠ 0, rate ≠ 0, not %-UOM).
- **Advisory, not blocking**: the section is collapsible; save is never gated on it.
  The dollars ride the linked STEP 4 rows and the tie-out gate already guards them.
- **UOM corrections replace the stored value** (same as the STEP 4 review gate); a
  wrong unit is not history worth preserving.

## How it fits the guardrails
- `imported_step23_lines` stays **write-once**: corrections are applied to the
  payload in memory, before the single existing `saveImportedStep23Lines` call. The
  workspace keeps treating the column as read-only. Payload change is **additive
  only** (`assignedCode?`) — old payloads degrade fine through every shape gate.
- **No dollar moves**: corrections touch only `uom` and `assignedCode`; qty, rate,
  total, and the tie-out are untouched by construction (tests prove it).
- All DB access through `src/lib/db.ts`; the new table lands in
  `supabase_schema.sql` FIRST and waits for explicit approval (⛔ below).
- `calculations.ts` remains the sole financial authority; the resolver and the
  corrections layer are pure modules.

## Phases

### Phase 1 — Pure corrections layer (no DB, no UI)
- **Scope:**
  - `src/types/db.ts`: additive `assignedCode?: string` on `ImportedSheetLine`.
  - `src/lib/importEstimate.ts` (or sibling): pure
    `applyStep23Corrections(payload, { uomCorrections, assignments })` mirroring
    `applyAcceptedMappings` — originals untouched, corrections win, dollars cannot
    move.
  - `src/lib/step23Normalization.ts`: resolution precedence — a line's
    `assignedCode` (validated against the known defs) wins over description
    matching; `step23Observations` files assigned lines under their assigned code.
  - `ImportedStep23Panel`: an assigned line renders its violet "→ code" from
    `assignedCode` (inert until Phase 3 writes one — old payloads unaffected).
- **Approval gates:** none (pure code + additive type field).
- **Exit criteria:** `npm run test` green (505/51 baseline; goldens McKenna +
  synthetic + CARE tie $0.00) · `npx tsc --noEmit` clean · committed
  (`git commit -F <tempfile>`) · handoff via /handoff.

### Phase 2 — Custom code definitions (DDL ⛔ + db layer + resolver overlay)
- **Scope:**
  - ⛔ **New table** (working name `custom_step23_line_defs`: code PK, label, unit,
    nullable procore_code, source/audit columns; corporate-data RLS modeled on
    cost_code_map **plus an INSERT policy** the gate needs). Update
    `supabase_schema.sql` first, show the exact SQL, STOP for approval, then apply
    live. The INSERT policy slightly widens the browser's write surface — flagged
    with the same server-side-writes follow-up note as cost_code_map/rate_card.
  - `src/lib/db.ts`: `getCustomStep23LineDefs()` (read, consumers fail-soft) and
    `createCustomStep23LineDef()` (validates code shape, collision against static
    defs + existing custom rows).
  - `src/lib/step23Normalization.ts`: resolver accepts extra defs as a parameter
    (stays pure); collision rule: a custom code may never shadow a built-in one.
  - `ImportedStep23Panel` + `/rates` load custom defs fail-soft; mined history under
    a custom code is report-only (no card row → no ADOPT, by construction).
- **Approval gates:** ⛔ the table DDL (exact SQL shown, explicit sign-off before
  any live change).
- **Exit criteria:** same gates as Phase 1 + the new db tests (mirror
  `importedStep23HistoryDb.test.ts`).

### Phase 3 — The import-page review section (UI + save wiring)
- **Scope:**
  - `/projects/import`: collapsible advisory "GC/Site-Ops (STEP 2/3) review"
    section — table of captured lines (as-bid code, "→ resolved"/"unmapped" using
    the same violet/amber idiom as the workspace panel, description, qty, editable
    UOM cell with the violet corrected-state + original-in-tooltip pattern, rate,
    total); per-line assign dropdown (built-in + custom GC/Site-Ops codes) for
    unmapped lines; "create new code" mini-form (suffix auto-suggested, name
    defaults to description, unit defaults to as-bid UOM, optional Procore BLI
    picker) that mints via Phase 2's db call and assigns in one step.
  - Corrections live in state maps over the immutable parsed payload (the proven
    `accepted`/`uomOverrides` escape-hatch pattern); `handleSave` applies them via
    `applyStep23Corrections` immediately before the single
    `saveImportedStep23Lines` write.
  - Parsed-summary counts (STEP 2/3 resolved / unmapped / corrected).
  - Extend the synthetic legacy fixture with one unmappable STEP 2/3 line
    (extend, don't reshape — goldens must keep tying $0.00).
- **Approval gates:** none (UI + wiring; no DDL, no new export tabs).
- **Exit criteria:** same gates + `/code-review` before delivery + `npm run build`
  clean + handoff updates `[[import-past-bids-plan]]` and the kickoff doc's status.

## Risks & unknowns
- **INSERT policy exposure** (Phase 2): any authenticated user can mint a code.
  Accepted for a single-company tool; carries the existing "move writes
  server-side" follow-up. Phase 2 presents the exact policy for sign-off.
- **Suffix collisions with future built-in codes**: if `constants.ts` later defines
  a code a user already minted, the resolver prefers the built-in and the conflict
  must surface, not silently merge. Phase 2 writes the collision test; residual
  risk is a human one (mint `.003` today, app ships a different `.003` next year) —
  Catalog Manager is where renumbering tooling would live.
- **Mint hygiene during the backlog push**: rapid importing could create
  near-duplicate custom codes. Mitigated (dropdown shows existing custom codes
  first; name defaults to the exact description), not eliminated. Phase 3 finds out
  how it feels in practice.
- **Datalist/dropdown scale**: ~120 built-in GC/Site-Ops defs + customs in a
  per-row picker. Phase 3 reuses the shared-datalist pattern from the STEP 4 table;
  if it's unwieldy the fallback is a single shared picker row.
- The backlog may be partially imported before this lands — those bids are verbatim
  and fine; minted codes still label them retroactively at render time (the one
  exception: lines needing a *manual assignment to an existing code* still require
  re-import, by design).

## Phase 1 kickoff prompt
Paste into a fresh session:

> Read `docs/plans/import-step23-review-gate.md` (plan of record, all forks locked)
> and execute **Phase 1 only**: the pure STEP 2/3 corrections layer — additive
> `assignedCode?` on `ImportedSheetLine`, pure `applyStep23Corrections` mirroring
> `applyAcceptedMappings`, assigned-code precedence in `resolveStep23Line` +
> `step23Observations`, and `ImportedStep23Panel` rendering an assigned line's
> "→ code". No DDL, no UI section, no chaining into Phases 2–3. Baseline: suite
> 505 pass / 51 files; goldens McKenna + synthetic + CARE tie $0.00. Exit: suite +
> goldens green, `npx tsc --noEmit` clean, committed via `git commit -F <tempfile>`,
> close with /handoff (do NOT push to origin). Stop at the phase boundary.
