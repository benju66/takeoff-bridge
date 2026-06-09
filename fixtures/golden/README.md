# `fixtures/golden/` — confidential reproduction oracles (git-ignored)

This folder holds **real, completed bid workbooks** used as the golden oracle for the
reproduction harness (`src/__tests__/golden-mckenna.test.ts`). These files contain
**confidential bid pricing** and **must never enter git**.

`.gitignore` tracks only this `README.md` and `.gitkeep`; every workbook in here is
ignored. Do not `git add -f` a bid file.

## What goes here

The keystone oracle is the **live `STEP 4 - ESTIMATE`** tab of a real bid saved in the
company estimate-template format (still formula-linked to `STEP 1`, `STEP 2 - GCs`,
`STEP 3 - SITE OPS`, and `Budget Line Items`). The harness reads **both** the inputs and
the expected outputs from this one file, so no bid figure is ever hardcoded in a
committed test.

Default file name the harness looks for:

```
fixtures/golden/McKenna-Crossing-Estimate.xlsx
```

## How the harness finds the oracle (resolution order)

`src/__tests__/golden-mckenna.test.ts` resolves the oracle path in this order, using the
first one that exists:

1. `process.env.TAKEOFF_GOLDEN_XLSX` — an absolute path you set per-machine.
2. `fixtures/golden/McKenna-Crossing-Estimate.xlsx` — this folder (recommended; portable).
3. `C:\Users\BUrness\takeoff-bridge-fixtures\McKenna-Crossing-Estimate.xlsx` — the
   architect's master copy.

If none resolve, the golden suite **skips cleanly** (`describe.skipIf`) — it never fails
on a machine (CI, a teammate's laptop) that lacks the confidential file.

## Adding / refreshing the oracle

Copy the canonical bid workbook into this folder under the default name:

```
cp "<path-to-bid>.xlsx" fixtures/golden/McKenna-Crossing-Estimate.xlsx
```

Then run `npm run test`. The golden test reproduces the bid's `STEP 4 - ESTIMATE` totals
through the calculation engine and asserts they match to the cent ($0.01). See
`docs/correctness-contract.md` (Section "Golden reproduction — McKenna findings") for the
dispositioned deltas.
