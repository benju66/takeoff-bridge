# AI Agent Roles & Guardrails

## System Orchestration Architecture
* **User Role**: System Architect, Visionary, and Final Reviewer.
* **Agent Role**: Complete execution engine, code writer, and implementation specialist.

## Core Operational Boundaries
* **No Speculative Changes**: Do not invent, alter, or guess estimation formulas or Procore financial data models.
* **No AI Autonomy Over Financials**: Missing data mappings must trigger the interactive user-override interface.
* **Validation Protocols**: The agent must verify that multi-quantity row indexing matches the targeted unit metrics before writing output files.
* **Review Framework**: Operate under a strict Review-Driven Development loop. Code revisions must be verified against current architecture models before local file state changes are saved.

## Implementation Engineering Protocol
* **Checklist Enforcement**: The agent must execute the full 5-step verification process defined in **`SKILL.md`** for all proposed code modifications.
* **Review Gate Compliance**: An implementation plan table must be presented to the user matching the targeted scope prior to code delivery.
* **Execution Boundary**: Do not modify files or output source code blocks until the user explicitly provides approval for the presented plan.

## Structural Manipulation Grid Parameters
* Manual Structural Grid Modifications: AI agents are permitted to implement features that mutate, insert, delete, or rearrange row items in estimate data sheets, provided those operations are driven explicitly by context menu overrides or clear user action events.
* Data Interface Integrity Compliance: When appending manual items, the agent must verify that all non-nullable properties within core TypeScript models (such as `ProcessedTakeoffRow`) are initialized with conformant default values to eliminate data format compilation drift.
* Compounding History Preservation: Agents must never execute a state mutation or row list change without calling the local application history tracking hook (`pushSnapshotToStack`) immediately prior to the execution boundary.

## Data Persistence Boundaries
* **Single Gateway**: All Supabase database access MUST route through `src/lib/db.ts`. No hook, page, or component may import the Supabase client (`src/lib/supabase.ts`) directly.
* **Schema Source of Truth**: The file `supabase_schema.sql` at the project root is the canonical schema definition. Any database schema modification (new tables, columns, indexes, RPC functions) MUST update this file first and receive explicit user approval before execution.
* **Atomic Line Item Writes**: Estimate line item persistence MUST use the `save_estimate_line_items` PostgreSQL RPC function. Direct `INSERT`, `UPDATE`, or `DELETE` against the `estimate_line_items` table from client code is forbidden.
* **Sort Order Integrity**: Saved line items MUST be loaded with `ORDER BY sort_order ASC` and MUST NOT be re-sorted client-side. This preserves manual row positions created via context menu insertion.
* **Financial Write Constraint**: Agents must never invent or alter financial totals, markup percentages, or compounding formulas in the database layer. The calculation engine (`src/lib/calculations.ts`) is the sole authority.
* **Guardrail Skill Reference**: The agent must execute the enforcement checks defined in **`.agent/skills/database-guardrails/SKILL.md`** for all proposed modifications touching database persistence.