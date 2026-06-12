# Phase 3 Kickoff Prompt — Fail-Loud Hardening

> Paste the block below as the first message of a **fresh** session to start Phase 3 of
> `docs/plans/make-the-math-trustworthy.md`. It is self-contained: every file it names is the
> durable anchor a cold session needs. Companion: `docs/handoffs/phase-2-reproduction-harness.md`.

---

```
Phase 3 — Fail-Loud Hardening (the contract made real) for Takeoff Bridge's estimate math.

Read first, in this order:
  1. The approved plan: docs/plans/make-the-math-trustworthy.md (focus on "Phase 3")
  2. The Phase 2 handoff: docs/handoffs/phase-2-reproduction-harness.md
  3. The contract you are making real: docs/correctness-contract.md
     (INV-8 + Section 3 "Silent-escape register" rows #5 and #3)
  4. The carried-forward backlog: docs/backlog-math-trust.md (context only — NOT Phase 3 work)
  5. CLAUDE.md, AGENTS.md, and everything under memory/ (start with MEMORY.md)
  6. The code you are changing:
       - src/lib/parser.ts (parseCleanFloat at :45; the card-price default at :119)
       - src/hooks/useFileIngestion.ts (mergeTakeoffData at :113; the silent drop is the
         `if (targetIdx !== -1)` at :165 with NO else; the MERGE_TAKEOFF_DATA command at :199)
       - src/hooks/useCommandHistory.ts (WorkbookCommand / pushCommand payload shape)
       - src/lib/__tests__/correctness-contract.test.ts (the two INV-8 it.todo to flip)

PHASE 3 GOAL: Turn the two silent-escape paths into LOUD, recoverable ones. A wrong or missing
number must never escape quietly. Each fix ships red→green, and the Phase 2 golden harness must
still tie McKenna to the cent afterward.

Locked decisions (from Phase 1/2 / architect):
  - Import data is US format (comma thousands, dot decimal). Negatives CAN appear as accounting
    parentheses "(1,234.50)" or a trailing/leading minus.
  - Honor those as negative; on anything genuinely ambiguous, FAIL LOUD — route the row to the
    interactive override interface. Never guess (AGENTS.md: No AI Autonomy Over Financials).
  - NO schema change in Phase 3. calculations.ts stays the sole financial authority; all DB
    access via db.ts.

Scope (two fixes + their tests):

  Fix #5 — sign-safe US number parsing (parser.ts parseCleanFloat, register #5 / INV-8):
    - Detect accounting "( … )" and leading/trailing minus → negative; strip US thousands
      separators; parse the decimal. Ambiguous input → a sentinel that routes the row to the
      override interface rather than silently parsing +N.
    - New src/lib/__tests__/parser-numbers.test.ts covering:
        "(1,234.50)" → -1234.50 ; "-1,234.50" → -1234.50 ; "1,234.50- " → -1234.50 ;
        "1,234.50" → 1234.50 ; ambiguous → flagged. Confirm a credit now REDUCES the subtotal.

  Fix #3 — no silent row drop (useFileIngestion.ts mergeTakeoffData, register #3 / INV-8):
    - A parsed row with a VALID itemId but no matching template row (targetIdx === -1) must be
      APPENDED to the grid: source:'csv_import', ALL non-nullable ProcessedTakeoffRow fields
      initialized (per AGENTS.md Data-Interface-Integrity), placed in its division (use
      getDivisionCode from src/lib/division.ts) — quantity preserved and visible — AND recorded
      on the SAME MERGE_TAKEOFF_DATA command via commandHistory.pushCommand with full inverse
      data (prev/next row states incl. `source`, registry deltas) so ONE Ctrl+Z reverses the
      whole merge (AGENTS.md compounding-history + source-provenance rules).
    - A parsed row with NO itemId keeps surfacing its classification name AND carries its
      quantity into the override surface (today only the name survives).
    - New integration test under src/hooks/__tests__/ (or src/__tests__/): import a file whose
      rows include (a) a valid code absent from the template and (b) an unmapped classification;
      assert neither vanishes and both are visible/recoverable; assert one Ctrl+Z cleanly
      reverses the whole merge.

Workflow (project rules):
  - This touches >1 file → enter PLAN MODE first: write the plan to a file and present an
    implementation-plan table to the architect; do NOT modify files or output code until the
    architect approves the plan (AGENTS.md Review-Gate / Execution-Boundary).
  - After approval, implement, then run `npm run test` to green BEFORE presenting work.
  - Then flip the two INV-8 it.todo placeholders in correctness-contract.test.ts to real tests.

Definition of done:
  - New parser-numbers + import-integrity tests green; the INV-8 fail-loud invariants green.
  - REGRESSION GATE: the Phase 2 golden harness (src/__tests__/golden-mckenna.test.ts) still
    ties McKenna to the cent — run it where the fixture is present and confirm green (it skips
    cleanly elsewhere).
  - `npm run test` fully green; run /code-review and address findings.
  - Commit, then write a Phase 4 handoff note (docs/handoffs/) sequencing the next fresh session
    (Phase 4 = Override + Audit Model, which DOES pause for architect schema approval before any
    DDL). Update the math-trust-plan memory + MEMORY.md.
  - Stop after Phase 3 — do not begin Phase 4.
```
