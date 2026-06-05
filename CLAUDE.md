# Takeoff Bridge — Claude Code Instructions

Single-company internal construction estimating tool. Replaces siloed Excel workflows
with a structured web app that exports to Procore via template-mapped XLSX files.

## Tech Stack
Next.js 16 · React 19 · TypeScript · Supabase (Postgres + RLS) · TanStack Table ·
ExcelJS · PapaParse · Vitest · Playwright

## Claude Code Workflow
- **Non-trivial tasks** (touching > 1 file): enter plan mode, write plan to file,
  get approval before executing
- **Database tasks**: invoke the `supabase:supabase` skill before touching any DB code
- **Before delivery**: run `/code-review`, confirm `npm run test` passes
- **Context handoff**: when context fills, write plan to file and save non-obvious
  discoveries to memory before ending the session

## Rules & Guardrails
@AGENTS.md
