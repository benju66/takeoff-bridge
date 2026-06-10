# Import Past Bids — Phase 3 Slice 3: STEP 2/3 Normalization + Staff-Rate Mining
_2026-06-10 · status: APPROVED — forks locked by the architect (F-A: app defs only;
F-B: qty ≠ 0 AND rate ≠ 0, excluding %-UOM rows) · branch `import-past-bids-slice-3`
(phase-3 branch was fast-forward-merged to main `105eb2f` at session start, architect-approved)_

## Goal
Imported bids' STEP 2/3 lines are stored verbatim with legacy bare codes
(`01-0410 Sr Superintendent`, qty + rate + UOM). This slice (1) maps those bare codes to the
app's deterministic GC/Site-Ops codes — labeling only, **never moving a dollar** — shown
alongside the as-bid code in the read-only panels, and (2) mines per-line staff-rate history
onto /rates with the same UOM-gated one-click ADOPT as the Slice 2 catalog price report.
This FINALIZES the importer; the architect imports the whole backlog after it lands.

## Evidence (probed on the CARE fixture, 2026-06-10 — DB is empty by design)
Probe script: `scripts/slice3-probe-step23-sumifs.js` (read-only).

- **BLI SUMIF criteria**: 143 point at STEP 4, **34 at STEP 2, 38 at STEP 3** (= the "~73"),
  plus 2 `#REF!`-broken (BLI r2 `1-10000.000`, r218 `80-800001.000`). Zero conflicts
  (no bare code claimed by two Procore codes on either sheet).
- **All 72 STEP 2/3 SUMIF mappings agree exactly with the app's own line defs**: for every
  bare code, the BLI's Procore code equals the `procoreCode` the app's GC/SO def(s) for that
  base already carry (verified 34/34 + 38/38). The workbook bridge therefore adds NO new
  information on the template family — and it CANNOT split shared bases (both `02-9010`
  lines roll to the same `2-29010.000`), which is the only hard part.
- **Shared-base cases on CARE** (base → 2+ app defs; description disambiguates):
  - STEP 2 `01-5110` ×2: "Temp Office Set up and Takedown" (EA) → `.001` exact-label;
    "Temp Office" (MO) → `.002` whose app label is "Temp Office (Monthly)" — matches after
    stripping the def label's trailing parenthetical.
  - STEP 3 `02-9010` ×2: "Progress Cleaning - Payroll"/"- Hired" → `.001`/`.002` exact.
  - STEP 3 `02-9200` ×2: "Survey & Layout" / "… - Floor Scanning" → `.001`/`.002` exact.
  - STEP 3 `02-4100` ×3: "Demolition" → `.001`, "Demolition - Sawcutting" → `.002` exact;
    **"Demolition - Openings in CMU" (hand-inserted, $280,394) matches NO app line → stays
    bare and visibly unresolved** (the honest case; its dollars already ride the linked
    STEP 4 row — normalization is labeling).
  - Every other CARE base (33 on STEP 2, 35 on STEP 3) is unique → mechanical 1:1.
  - Coverage on CARE: STEP 2 35/35 lines resolve, STEP 3 41/42 (1 honest unresolved).
- **Rate-card bound**: only the 44 rate-bearing GC/SO lines have card rows (lump-sum
  `rate:null` lines are not seeded) → the /rates history line + ADOPT can only appear on
  real rate lines (8 staff `hr` + operational/monthly `mo|ea` + qty site-ops). Lump-sum
  scopes (Design fees, Demolition…) get resolved LABELS in the panel but no /rates surface.
- **Mining shape caveats from CARE**: many template rows carry the era's default rate with
  qty 0 (unused, not a bid decision); `%`-UOM rows (Safety Consultant, Procore) hold the
  project base in the rate column (e.g. $16,000,000) — not unit rates.

## Forks (lock with the architect before building)
- **F-A — resolver source**: static resolver derived from the app's own line defs ONLY
  (Recommended — bridge is provably redundant on the family, can't split shared bases, and
  a pure read-time function works on stored lines where no workbook exists) vs ALSO extend
  `deriveLegacyBridge` to STEP 2/3 as an import-time consistency check.
- **F-B — which lines become rate observations**: qty ≠ 0 AND rate ≠ 0, excluding `%`-UOM
  rows (Recommended — mines actual bid decisions, not era template defaults or project-base
  pseudo-rates) vs include zero-qty rows vs include everything.

## Design (read-time derivation — zero schema work, zero writes to the protected JSONB)

### New pure module `src/lib/step23Normalization.ts`
- `STEP23_LINE_DEFS`: built once from the SAME constants arrays the calculators use —
  `STAFF_ROLE_DEFAULTS`, `OPERATIONAL_EXPENSE_DEFAULTS`, `GC_MANUAL_DEFAULTS`,
  `EQUIPMENT_DEFAULTS`, `SITE_OPS_DYNAMIC_DEFAULTS`, `SITE_OPS_MANUAL_DEFAULTS`
  (code, label, unit, base via `getDivisionCode`-safe parsing).
- `resolveStep23Line(code, description) → { code, label } | null`:
  1. already-deterministic code that IS a def → itself (future-proof);
  2. bare base with exactly ONE def → that def (mechanical 1:1);
  3. bare base with 2+ defs → normalized description match (lowercase, trim, collapse
     whitespace) against each def label, also matching the label with its trailing
     parenthetical annotation stripped ("Temp Office (Monthly)" → "temp office");
     resolves ONLY on exactly one hit;
  4. anything else → null. **Never guesses; null stays bare and visible.**
- `step23Observations(payloads…) → PriceObservation[]`: flattens stored
  `imported_step23_lines` + project context into Slice 2's `PriceObservation` shape, keyed
  by the RESOLVED deterministic code (unresolved lines are skipped — no key to file under),
  filtered per F-B. Reuses `aggregatePriceHistory` UNCHANGED for stats.

### Display — `ImportedStep23Panel`
Code cell shows the as-bid code plus the resolved deterministic code (violet, with the app
label in the tooltip); unresolved lines get a subtle "unmapped" mark. Render-time pure call;
the stored payload is untouched.

### Mining — db + /rates
- `db.ts getImportedStep23History()`: read-only — `project_estimates` rows where
  `imported_step23_lines` is not null, joined to `projects(name, bid_date, market_sector)`.
- `/rates`: second fail-soft load → `step23History` map (kept SEPARATE from the catalog map
  so STEP 4 unit-price observations and STEP 2/3 rate observations never mix — `02-4100.002`
  exists in both worlds); rendered with the same violet history line + per-project tooltip
  + the SAME `handleAdopt` (existing audited `updateRateCardEntry`, confirm, MANUAL stamp),
  UOM-gated exactly like Slice 2.

## Slices (each ends suite-green + committed)
| Slice | Files | Tests |
|---|---|---|
| A — pure resolver | NEW `src/lib/step23Normalization.ts` | NEW `step23Normalization.test.ts`: unique base; Payroll/Hired; Temp Office paren-strip; Openings-in-CMU → null; suffixed-code passthrough; never-guess on ambiguity |
| B — panel labels | `src/components/workspace/ImportedStep23Panel.tsx` | extend `imported-step23.test.ts` (resolved + unresolved render) |
| C — mining + /rates | `src/lib/step23Normalization.ts` (observations), `src/lib/db.ts` (read), `src/app/rates/page.tsx` (surface) | observation filtering per F-B; aggregation reuse; db mapping test (mirror `importedPriceHistoryDb.test.ts`); fail-soft |

## Gates (every commit)
`npm run test` green (490 pass / 49 files at start) · goldens McKenna + synthetic + CARE tie
$0.00 · `imported_step23_lines` untouched (read-only this slice) · training tables append-only
· `import type` discipline (resolver + observations stay out of the ExcelJS graph) ·
`npx tsc --noEmit` clean · `/code-review` before delivery · `git commit -F` for multi-line
messages · NO push to origin without the architect's say-so.

## Out of scope (per kickoff)
Granular GC Procore rollup / export-of-imports; lump-override mining; archive & comparison;
catalog manager; Permits section. Backfill is moot — nothing is imported yet.
