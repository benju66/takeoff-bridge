# Database Fidelity — Phase 3 Kickoff (trust-rules module)

_2026-06-11 · previous phase: Phase 2 complete on local main (`f731a7e`, not
pushed) — per-line "combined" toggle on the STEP 4 import review table; marked
lines save `data_fidelity='macro_lump_sum'`; training writes tagged
`user_lump` via the new `src/lib/resolvedBy.ts` vocabulary;
`getClassificationHistoryBulk` / `getClassificationHistory` /
`getImportedPriceHistory` exclude lump observations read-side. Suite 649/61,
goldens tie $0.00, tsc clean._

## Ready-to-paste prompt for a fresh session

> Read `docs/plans/database-fidelity.md` (plan of record, forks locked) and
> execute **Phase 3 only**: the trust-rules module. Scope: new PURE
> `src/lib/historyTrust.ts` — the single authority on which historical price
> observations count and how they group (the analytics twin of
> `calculations.ts`): (1) group by (code, unit, market sector), where "code"
> is the POST-MERGE resolved code (`resolveStep23Line` already follows
> Catalog-Manager merge redirects — never group raw as-bid codes or a merge
> silently splits one item's history); (2) exclude lump-tagged / zero-qty /
> zero-rate / %-unit rows; (3) a small unit-alias table (SF = SQFT etc.) —
> ⛔ the ALIAS LIST is domain knowledge: propose one, then STOP for architect
> approval before shipping it; (4) recency ordering + a minimum-sample-size
> label ("2 observations — low confidence") on every aggregate; (5) the
> statistical outlier screen per (code, unit) group (median-skew/IQR style;
> FLAG-ONLY — marks the observation and excludes it from aggregates, never
> deletes; AACE practice orders this BEFORE any normalization); (6) the
> escalation seam — an optional date-based index-adjustment input that ships
> INERT (identity) until Phase 6 chooses an index. Rewire the existing /rates
> imported-price report (`priceHistory.ts` / `aggregatePriceHistory`
> consumers) and the STEP 2/3 history report (`step23Observations`) through
> the module. All DB access stays in `src/lib/db.ts`; the module is pure and
> read-side only, so it applies retroactively to everything already imported.
> Exit: `npm run test` green · goldens tie $0.00 · `npx tsc --noEmit` clean ·
> a test proving report outputs are UNCHANGED for already-clean data ·
> `/code-review` findings resolved · committed via `git commit -F <tempfile>`
> · close with /handoff (do NOT push). Stop at the phase boundary — Phases
> 4–6 and import-roadmap items 2/3/5 stay out of scope.

## Where Phase 2 left off (context a cold session may need)

- **Plan file:** `docs/plans/database-fidelity.md` — Phase 3 section + the
  "Locked decisions" block + the unit-alias-list risk note (architect
  supplies/approves the alias list INSIDE Phase 3 before it ships).
- **The `resolved_by` vocabulary lives in `src/lib/resolvedBy.ts`** (Phase 2):
  `RESOLVED_BY` (user / global / seed / ai / user_lump) + the
  `TRUSTED_RESOLVED_BY` allowlist. Phase 5 extends THIS module. The
  database-guardrails SKILL.md §8 points at it.
- **Where Phase 2's exclusions live (Phase 3 should subsume the price side):**
  classification-history reads filter `.in("resolved_by", TRUSTED_RESOLVED_BY)`
  in `db.ts`; `getImportedPriceHistory` filters
  `.neq("data_fidelity", "macro_lump_sum")` at the query. Code-review altitude
  note, deferred to Phase 3 by design: the lump rule for PRICE history ideally
  becomes a named, testable filter inside historyTrust (e.g. surface
  `dataFidelity` on `PriceObservation` and filter in the module) so every
  consumer goes through one authority. Either keep the query filter as a
  fetch-size optimization or move it — but the trust module must own the rule.
- `PriceObservation` / `aggregatePriceHistory` are in `src/lib/priceHistory.ts`;
  STEP 2/3 mining is `step23Observations` in `src/lib/step23Normalization.ts`
  (already resolves merge redirects + honors `assignedCode`); both feed
  `src/app/rates/page.tsx` (page loads them fail-soft).
- **Known notes for later phases (do not fix in Phase 3 unless free):**
  (a) the `'discrete_unit' | 'macro_lump_sum'` union is spelled out in 4
  places (types/index.ts, types/db.ts, calculations.ts, db.ts cast) —
  housekeeping-roadmap candidate; (b) workspace cell edits recompute
  `dataFidelity` heuristically (`evaluateDataFidelity` in useCellEditing), so
  editing qty/price on an imported row in the workspace can overwrite an
  import-gate "combined" mark — matches the plan's deferred "workspace
  mark-as-combined" item, surface it there.
- **Uncommitted working tree (pre-existing, NOT Phase 2's):** a docs archive
  move (deleted `docs/handoffs/*` + `docs/plans/*` with untracked copies under
  `docs/*/archive/`) sits in the working tree. Leave it alone; never sweep it
  into a phase commit (`git add` specific files only).
- Exit-gate commands: `npm run test` · `npx tsc --noEmit` · commit message
  written to a temp file (Write tool, no BOM) then `git commit -F <file>` —
  never inline multi-line commit text (Windows shell rule).

## Approval gates

⛔ **Unit-alias list** — propose, show the architect, STOP for sign-off before
wiring it in (domain knowledge: does the company ever price the same item in
both SF and SY?). No DDL this phase; no export changes. The next hard gate
after that is Phase 6 sequencing.
