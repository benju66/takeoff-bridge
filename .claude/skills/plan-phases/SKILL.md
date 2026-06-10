---
name: plan-phases
description: Generate a phased implementation plan-of-record for a new feature or workstream in Takeoff Bridge. Use whenever the user asks to plan a feature, break work into phases or slices, start a new workstream, or describes a multi-session feature to build — even if they never say the word "plan" (e.g. "how should we approach X", "next I want the app to do Y"). This skill produces the plan only; it never implements code.
---

# Phased Implementation Plan (plan-of-record)

Produce a plan that lets each phase run in its own fresh session. The user is a
system architect and domain expert, not a developer — write the plan in plain
language, frame technical choices as decisions with trade-offs, and never bury a
decision inside implementation detail.

This skill is the opening half of a matched pair: `/plan-phases` opens a feature,
`/handoff` closes each phase. The plan must never implement code — planning and
implementation always happen in separate sessions so each phase starts with a
cold, focused context.

## Step 1 — Investigate (read-only)

Before proposing anything, understand the ground truth:

- Read the relevant source code, `supabase_schema.sql`, and any related prior
  plans in `docs/plans/` and handoffs in `docs/handoffs/`.
- Check AGENTS.md guardrails that the feature will touch (db.ts gateway, command
  history, append-only tables, etc.) — phases must be designed around them, not
  discover them mid-build.
- Make no file modifications during this step.

## Step 2 — Surface open decisions BEFORE writing the plan

Identify design choices the architect must make (data model, UI placement,
export format, what's deferred). For each:

- Present it as a plain-language question with concrete options.
- Mark exactly one option "(Recommended)" with a one-line reason.
- For fuzzy or exploratory forks, discuss conversationally first to sharpen the
  question rather than firing a multiple-choice picker cold.

Do not write the plan file until the load-bearing decisions are settled — a plan
built on guessed decisions gets rewritten.

## Step 3 — Write the plan to `docs/plans/<feature-slug>.md`

Use this structure:

```markdown
# <Feature> — Plan of Record
_Date · status: PROPOSED_

## Goal
One paragraph: what exists when this is done, in user-visible terms.

## Out of scope / deferred
Explicit list — what this plan deliberately does NOT do.

## Locked decisions
Decisions the architect has already made, one line each, with the why.

## Phases
### Phase N — <name>
- **Scope:** what gets built (files/areas touched)
- **Approval gates:** ⛔ flag any step requiring explicit user sign-off
  before execution: DB schema changes / DDL (show exact SQL and stop),
  new export template tabs, pushes to main.
- **Exit criteria:** `npm run test` green · `npx tsc --noEmit` clean ·
  committed (multi-line messages via `git commit -F <tempfile>`) ·
  handoff doc written (close the phase with the /handoff skill).

## Risks & unknowns
What could force a plan revision, and which phase will find out.

## Phase 1 kickoff prompt
A ready-to-paste prompt for a fresh session: names this plan file, states
Phase 1 scope and exit criteria, and says to stop at the phase boundary.
```

## Phase sizing rule

Each phase must be completable in **one fresh session**: roughly one vertical
slice or one architectural layer. If a phase needs a DB migration AND a new UI
page AND export changes, split it. A phase that can't be described in three
bullet points is too big. When in doubt, make phases smaller — an extra handoff
is cheap; a phase that overruns its context window is not.

## Step 4 — Present and stop

Summarize the plan in chat (goal, phase list, where the approval gates are),
note any decisions still open, and wait for approval. Do not begin Phase 1 in
this session even if approved — hand the user the Phase 1 kickoff prompt to
paste into a fresh session.
