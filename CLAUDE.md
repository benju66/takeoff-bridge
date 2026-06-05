# Takeoff Bridge — Claude Code Instructions

Single-company internal construction estimating tool. Replaces siloed Excel workflows
with a structured web app that exports to Procore via template-mapped XLSX files.

## Tech Stack
Next.js 16 · React 19 · TypeScript · Supabase (Postgres + RLS) · TanStack Table ·
ExcelJS · PapaParse · Vitest · Playwright

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

## Shell Commands
This environment uses PowerShell heavily; keep inline commands short and write a script file instead of long one-liners (commands over ~965 bytes fail to parse).

## Excel/XML Exports
When generating or parsing spreadsheet XML, ensure cells are written in ascending column order to avoid corrupt files; double-check column-letter parsing.

## Rules & Guardrails
@AGENTS.md
