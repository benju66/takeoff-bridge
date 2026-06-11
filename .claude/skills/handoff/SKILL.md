---
name: handoff
description: Implement the current phase, run the full test suite until green, commit with a descriptive message, then write a handoff doc sequencing the next phase for a fresh session.
---

# Handoff

Implement the current phase, then exit in this order:
1. Run `npm run test` until green
2. Run `npx tsc --noEmit` — confirm clean
3. Run `/code-review` — resolve any findings before proceeding
4. Commit (multi-line messages via `git commit -F <tempfile>`)
5. Write the handoff doc for the next phase

## Handoff doc naming

Write the kickoff doc to:

```
docs/handoffs/<YYYY-MM-DD>-<feature-slug>-<phase>-kickoff.md
```

Use the date from `currentDate` in the system context (format: `YYYY-MM-DD`) as the filename prefix.

**Example:** `2026-06-11-catalog-manager-phase-3-kickoff.md`

## Kickoff doc structure

The doc must be a ready-to-paste prompt for a cold fresh session — no assumed context. Include:

- Which plan file to read (`docs/plans/...`)
- Phase number, name, and scope
- Exit criteria (tests green, tsc clean, committed, handoff written)
- Any approval gates to stop at (DDL, push to main, etc.)
- A one-line summary of where the previous phase left off
