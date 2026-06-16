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
- Commit messages: write the message to a file and commit with `git commit -F <file>` to avoid quoting/encoding issues. Never put multi-line commit text inline in the shell.
- For commands likely to exceed ~965 bytes, write a script file instead of inlining.

## Phased Workflow
When implementing a multi-phase plan: implement the current phase, run tests until green, commit, and write handoff docs that sequence the next phase for a fresh session.

## Claude Code Workflow
- **Non-trivial tasks** (touching > 1 file): enter plan mode, write plan to file,
  get approval before executing
- **Database tasks**: invoke the `supabase:supabase` skill before touching any DB code
- **Before delivery**: run `/code-review`, confirm `npm run test` passes
- **Context handoff**: when context fills, write plan to file and save non-obvious
  discoveries to memory before ending the session

## Testing
Always run the test suite after code changes and confirm green before committing.

## Excel/XML Exports
When generating or parsing spreadsheet XML, ensure cells are written in ascending column order to avoid corrupt files; double-check column-letter parsing.

## Rules & Guardrails
@AGENTS.md
