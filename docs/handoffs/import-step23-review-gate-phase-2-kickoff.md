# Kickoff — STEP 2/3 Review Gate, Phase 2 (custom code defs: DDL ⛔ + db layer + resolver overlay)

> Paste the prompt at the bottom as the first message of a fresh session. Workflow per
> [[feedback-one-phase-per-fresh-session]]. Plan of record (all forks locked):
> `docs/plans/import-step23-review-gate.md`. Do NOT chain into Phase 3 or roadmap items 2–5.

## Phase 1 BUILD STATUS — DONE (commit `e8aa586`, on local main, NOT pushed)

The pure corrections layer is in, exactly per plan, no scope drift:

- **`src/types/db.ts`** — `ImportedSheetLine` gained optional `assignedCode?: string`
  (additive; as-bid `code` never rewritten; old payloads pass every shape gate — verified
  the `getImportedStep23History` gate only checks the two arrays exist, it strips nothing).
- **`src/lib/importEstimate.ts`** — new `step23LineKey(step, rowNumber)` (keys are
  SHEET-SCOPED: `"step2:30"` ≠ `"step3:30"` — the two sheets can reuse row numbers) and
  pure `applyStep23Corrections(payload, { uomCorrections, assignments })` mirroring
  `applyAcceptedMappings`: originals never mutated (escape-hatch map pattern), corrections
  win, UOM corrections normalized to the payload's trim+uppercase contract, blank/unknown
  keys ignored. Only `uom` and `assignedCode` can change — dollars untouched by
  construction (tested).
- **`src/lib/step23Normalization.ts`** — `resolveStep23Line(code, description,
  assignedCode?)`: a KNOWN assigned code wins over description matching; a stale/unknown
  assignment falls through to normal resolution (never fabricates). `step23Observations`
  passes `line.assignedCode` through → assigned lines feed /rates mining (assignment =
  resolution), still subject to the minable filter.
- **`ImportedStep23Panel`** — resolves with `l.assignedCode`; an assigned line shows the
  same violet "→ code" with an "Assigned at import review" tooltip. Inert until Phase 3
  writes the field.
- **Tests** — +9 (6 in `src/__tests__/legacy-import.test.ts` block "applyStep23Corrections",
  3 in `src/lib/__tests__/step23Normalization.test.ts`). Suite **514 pass / 51 files**
  (baseline was 505/51); goldens McKenna + synthetic + CARE tie $0.00; `npx tsc --noEmit`
  clean.

## Phase 2 scope (from the plan — re-read it first, it is the authority)

1. ⛔ **New table `custom_step23_line_defs`** (code PK, label, unit, nullable
   procore_code, source/audit columns; corporate-data RLS modeled on `cost_code_map`
   **plus the INSERT policy** the gate needs). Update `supabase_schema.sql` FIRST, show
   the exact SQL, **STOP for explicit architect approval**, only then apply live
   (project `nefvkrhbbkiqnpeabyqz`). Flag the INSERT policy with the same
   "move writes server-side" follow-up note as cost_code_map/rate_card.
2. **`src/lib/db.ts`** — `getCustomStep23LineDefs()` (read; consumers fail-soft) and
   `createCustomStep23LineDef()` (validates code shape `NN-NNNN.NNN`, collision against
   static `STEP23_LINE_DEFS` + existing custom rows). Invoke the `supabase:supabase`
   skill + `.agent/skills/database-guardrails/SKILL.md` checks before touching db code.
3. **`src/lib/step23Normalization.ts`** — resolver accepts EXTRA defs as a parameter
   (stays pure). Collision rule: a custom code may never shadow a built-in one (built-in
   wins; conflict must surface, not silently merge — write the collision test).
4. **`ImportedStep23Panel` + `/rates`** load custom defs fail-soft; mined history under a
   custom code is report-only (no card row → no ADOPT, by construction).

## Gates (unchanged)
Suite green per commit (514/51 at this handoff); goldens tie $0.00; new db tests mirror
`src/lib/__tests__/importedStep23HistoryDb.test.ts`; `npx tsc --noEmit` clean; multi-line
commits via message FILE + `git commit -F`; NO push to origin without architect say-so;
schema change lands in `supabase_schema.sql` before any live DDL and waits for the ⛔ gate.

## Phase 2 kickoff prompt

> Read `docs/plans/import-step23-review-gate.md` (plan of record, forks locked) and
> `docs/handoffs/import-step23-review-gate-phase-2-kickoff.md` (Phase 1 build status),
> then execute **Phase 2 only**: the `custom_step23_line_defs` table (⛔ update
> `supabase_schema.sql` first, show the exact SQL, STOP for my approval before applying
> live), `getCustomStep23LineDefs`/`createCustomStep23LineDef` in `src/lib/db.ts` with
> shape + collision validation, the resolver's extra-defs parameter (pure; built-in
> always beats custom), and fail-soft custom-def loading in `ImportedStep23Panel` +
> `/rates`. Invoke the supabase skill before db code. Baseline: suite 514 pass / 51
> files; goldens tie $0.00. Exit: suite + goldens + new db tests green, `npx tsc
> --noEmit` clean, committed via `git commit -F <tempfile>`, close with /handoff
> (do NOT push). Stop at the phase boundary.
