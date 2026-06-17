# Takeoff Bridge — Claude Code Instructions

Single-company internal construction estimating tool. Replaces siloed Excel workflows
with a structured web app that exports to Procore via template-mapped XLSX files.

## Tech Stack
Next.js 16 · React 19 · TypeScript · Supabase (Postgres + RLS) · TanStack Table ·
ExcelJS · PapaParse · Vitest · Playwright

## Response Style (for the architect)
The primary reader is the system architect and domain expert — not a software developer.
When responding in chat:
- **Lead with a plain-language summary**: what changed (or what I'm proposing) and what it
  means for the product / estimating workflow — before any code or implementation detail.
- **Two layers, never dumbed down**: keep full technical depth, but place it *below* the
  summary under a "Technical detail" heading the architect can skip. Never replace the plain
  summary with a jargon-only one.
- **Define jargon on first use** in a few words (e.g. "RLS — the database's per-tenant access rules").
- **Be concise**: lead with the answer/recommendation; don't narrate options I'm not taking.
- When presenting choices, always mark one **(Recommended)** with a one-line reason.

This governs conversational explanation only. It does NOT shorten required work products —
the implementation plan table, the 5-step verification, and handoff docs (per AGENTS.md) stay as specified.

## Shell & Encoding Rules
- This is a Windows machine: always use the PowerShell tool (not Bash) for shell commands. Never mix PowerShell here-string syntax (`@'...'@`) inside the Bash tool.
- Never use emoji in PowerShell scripts (cp1252 encoding mangles them).
- Avoid PowerShell reserved/automatic variables like `$PID`; choose distinct names to prevent collisions.
- Commit messages: write the message to a file and commit with `git commit -F <file>` to avoid quoting/encoding issues. Never put multi-line commit text inline in the shell.
- For commands likely to exceed ~965 bytes, write a script file instead of inlining.

## Phased Workflow
When implementing a multi-phase plan: implement the current phase, take it through the
**Definition of Done** below, then hand off to a fresh session for the next phase. Run one
phase per cold context window — don't chain phases.

## Definition of Done
The single exit checklist for any phase, slice, or non-trivial change. The `handoff` skill and
all kickoff docs reference this section rather than restating it — one source, no drift.

1. **Implement** the phase. For DB work, invoke the `supabase:supabase` skill *first*.
2. **DDL gate** — STOP. Any live schema change (tables, columns, indexes, RPCs) requires
   updating `supabase_schema.sql` first, then explicit architect approval of the exact SQL
   before it touches the live database. Never apply DDL un-approved.
3. **Tests green** — `npm run test` passes; no regressions.
4. **Types clean** — `npx tsc --noEmit` reports no errors.
5. **Build green** — `npm run build` succeeds (catches Next.js server/client-boundary and
   build-time errors that tests and `tsc` miss).
6. **Review** — run `/code-review` (I choose the effort level for the phase's risk) and resolve
   findings before delivery.
7. **Commit & back up** — commit the phase to the plan's branch (message written to a file,
   committed via `git commit -F` per Shell & Encoding Rules), then push the branch to back it
   up. One commit per phase. Never merge or push to `main` here — see Git Workflow below.
8. **Handoff** — write the handoff doc sequencing the next phase for a fresh session.

## Git Workflow (branch per implementation plan)
The architect works on branches, never directly on `main`, and does not type git commands —
the agent drives all git mechanics; the architect approves in plain language. Translate intent
generously ("ship it", "back it up", "land it" all mean what they sound like).

- **New implementation plan / workstream** → create ONE branch off the latest `main`, named
  for the workstream (e.g. `gc-siteops-addressability`). Every phase of that plan is committed
  to this one branch. Don't make a branch per phase.
- **Each phase** → handled by the Definition of Done above: commit the phase to the branch and
  push the branch to back it up. Feature-branch pushes are safe and auto-allowed.
- **End of the workstream** (all phases done) → merge the branch into `main` and push `main`.
  This is the ONLY step that touches `main`, and it requires explicit architect approval.
  The push to `main` will prompt once (the push-guard hook) — that prompt IS the gate.
  Default to a direct merge; the architect never has to deal with a PR.
- **PR is opt-in** → only when the architect asks (e.g. wants the cloud `/code-review ultra`
  or CI to run before landing). Then the agent opens and drives the PR; "merge it" lands it.
- Never merge, push to `main`, or force-push without explicit approval.

## Claude Code Workflow
- **Non-trivial tasks** (touching > 1 file): enter plan mode, write plan to file,
  get approval before executing
- **Before delivery**: take the change through the **Definition of Done** above
- **Context handoff**: when context fills, write plan to file and save non-obvious
  discoveries to memory before ending the session

## Testing
Always run the test suite after code changes and confirm green before committing.

## Excel/XML Exports
When generating or parsing spreadsheet XML, ensure cells are written in ascending column order to avoid corrupt files; double-check column-letter parsing.

## Rules & Guardrails
@AGENTS.md
