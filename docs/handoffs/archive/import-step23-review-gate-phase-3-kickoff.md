# Kickoff — STEP 2/3 Review Gate, Phase 3 (the import-page review section: UI + save wiring)

> **STATUS: PHASE 3 BUILT 2026-06-10 (commit `6235a35`, local main, NOT pushed) —
> this kickoff is now historical. The review gate (roadmap item 1) is COMPLETE;
> see docs/handoffs/import-step23-review-gate-complete.md for the closure note.**

> Paste the prompt at the bottom as the first message of a fresh session. Workflow per
> [[feedback-one-phase-per-fresh-session]]. Plan of record (all forks locked):
> `docs/plans/import-step23-review-gate.md`. Phase 3 is the LAST phase of this roadmap
> item — do NOT chain into roadmap items 2–5.

## Phase 2 BUILD STATUS — DONE (commit `3c647e7`, on local main, NOT pushed)

Custom code definitions are live end-to-end, exactly per plan, no scope drift:

- **`custom_step23_line_defs` table — APPLIED LIVE** (project `nefvkrhbbkiqnpeabyqz`,
  2026-06-10, architect-approved; `supabase_schema.sql` Table 14 updated FIRST).
  Columns: `code` TEXT PK (CHECK `NN-NNNN.NNN`), `label` NOT NULL (CHECK non-blank —
  it is the auto-resolution key), `unit` (DEFAULT ''), `procore_code` nullable,
  `source` `'import_gate'|'manual'` (DEFAULT `'import_gate'`), created/updated
  timestamps. RLS: SELECT + INSERT to authenticated, **NO UPDATE/DELETE** — minted
  codes are immutable from the browser (editing/retiring = Catalog Manager, item 4).
  Advisors after DDL: ONE expected new WARN (always-true INSERT policy) — the plan's
  accepted single-company exposure, same "move writes server-side" follow-up note as
  cost_code_map/rate_card; pre-existing baseline of 3 unchanged. Constraints
  smoke-tested live (insert+rollback; defaults stamp correctly; table left empty).
- **`src/lib/db.ts`** — `getCustomStep23LineDefs(): Promise<CustomStep23LineDef[]>`
  (code-ordered; consumers fail-soft) and `createCustomStep23LineDef({ code, label,
  unit?, procoreCode? })` — Phase 3's mint call. It validates BEFORE the write
  (deterministic shape, non-empty label, collision vs built-in defs via
  `isBuiltInStep23Code`, collision vs existing custom rows; a PK race lands on the
  same "Custom code X already exists" error), normalizes unit to trim+UPPERCASE and
  blank Procore BLI to NULL, and stamps `source='import_gate'` via the column default.
- **`src/types/db.ts`** — `CustomStep23LineDef { code, label, unit, procoreCode:
  string|null, source }`; structurally a `Step23LineDef`, so arrays of it pass
  straight into the resolver as `extraDefs`.
- **`src/lib/step23Normalization.ts`** — `resolveStep23Line(code, description,
  assignedCode?, extraDefs?)` and `step23Observations(sources, extraDefs?)`: pure
  overlay, memoized per array (keep the defs array referentially stable in state).
  Custom defs join BOTH paths — assigned codes AND bare-base/description matching —
  so a minted code labels matching lines in every stored bid retroactively. Built-in
  ALWAYS beats a colliding custom (tested); a custom under a previously 1:1 base
  makes it shared (description then required — the resolver never guesses). New
  exports: `isStep23DeterministicCode`, `isBuiltInStep23Code`.
- **Consumers fail-soft** — `ImportedStep23Panel` loads custom defs in a cancellable
  effect (outage = built-ins only); `/rates` mines step23 history with the overlay.
  History under a custom code is report-only by construction: no rate_card row → no
  card row → no ADOPT.
- **Tests** — +19 (11 in `src/lib/__tests__/customStep23LineDefsDb.test.ts`, 8 in the
  overlay block of `step23Normalization.test.ts`). Suite **533 pass / 52 files**
  (baseline was 514/51); goldens McKenna + synthetic + CARE tie $0.00; `npx tsc
  --noEmit` clean.

## Phase 3 scope (from the plan — re-read it first, it is the authority)

1. **`/projects/import` page**: collapsible advisory "GC/Site-Ops (STEP 2/3) review"
   section — table of captured lines (as-bid code, "→ resolved"/"unmapped" via the
   workspace panel's violet/amber idiom, description, qty, EDITABLE UOM cell with the
   violet corrected-state + original-in-tooltip pattern, rate, total); per-line assign
   dropdown (built-in + custom GC/Site-Ops codes) for unmapped lines; "create new
   code" mini-form (suffix auto-suggested = next free `.NNN` for the base, name
   defaults to the line's description, unit defaults to the as-bid UOM, optional
   Procore BLI picker over the valid list) that mints via `createCustomStep23LineDef`
   and assigns in one step.
2. **Save wiring**: corrections live in state maps over the immutable parsed payload
   (the proven `accepted`/`uomOverrides` escape-hatch pattern already on the page);
   `handleSave` applies them via Phase 1's `applyStep23Corrections(payload,
   { uomCorrections, assignments })` (keys are SHEET-SCOPED `step23LineKey(step,
   rowNumber)` — `"step2:30"` ≠ `"step3:30"`) immediately before the single existing
   `saveImportedStep23Lines` write. Review is ADVISORY: save is never gated on it.
3. **Parsed-summary counts** (STEP 2/3 resolved / unmapped / corrected).
4. **Extend the synthetic legacy fixture** with one unmappable STEP 2/3 line —
   extend, don't reshape; goldens must keep tying $0.00.

## Gates (Phase 3 has the extra delivery gates)
Suite green per commit (533/52 at this handoff); goldens tie $0.00; `npx tsc --noEmit`
clean; **`/code-review` before delivery + `npm run build` clean** (plan Phase 3 exit);
multi-line commits via message FILE + `git commit -F`; NO push without architect
say-so; no DDL anywhere in Phase 3. Close by updating [[import-past-bids-plan]] memory
and this doc's status + the plan's status line.

## Phase 3 kickoff prompt

> Read `docs/plans/import-step23-review-gate.md` (plan of record, forks locked) and
> `docs/handoffs/import-step23-review-gate-phase-3-kickoff.md` (Phase 2 build status +
> API surface), then execute **Phase 3 only**: the collapsible advisory "GC/Site-Ops
> (STEP 2/3) review" section on `/projects/import` — resolved/unmapped table over the
> parsed payload, editable UOM cells, per-line assign dropdown (built-in + custom
> defs), "create new code" mini-form minting via `createCustomStep23LineDef` then
> assigning in one step; corrections in state maps applied via
> `applyStep23Corrections` inside `handleSave` right before the single
> `saveImportedStep23Lines` write (advisory — save never gated); parsed-summary
> counts; extend the synthetic fixture with one unmappable STEP 2/3 line. No DDL.
> Baseline: suite 533 pass / 52 files; goldens tie $0.00. Exit: suite + goldens green,
> `npx tsc --noEmit` clean, `npm run build` clean, `/code-review` before delivery,
> committed via `git commit -F <tempfile>`, close with /handoff (do NOT push). Stop at
> the phase boundary — roadmap items 2–5 stay out of scope.
