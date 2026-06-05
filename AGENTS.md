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
* **Automated Test Gate**: The agent must run `npm run test` and confirm all tests pass before presenting work for user review. Regressions must be resolved before delivery.

## Structural Manipulation Grid Parameters
* Manual Structural Grid Modifications: AI agents are permitted to implement features that mutate, insert, delete, or rearrange row items in estimate data sheets, provided those operations are driven explicitly by context menu overrides or clear user action events.
* Data Interface Integrity Compliance: When appending manual items, the agent must verify that all non-nullable properties within core TypeScript models (such as `ProcessedTakeoffRow`) are initialized with conformant default values to eliminate data format compilation drift.
* Compounding History Preservation: Agents must never execute a state mutation or row list change without calling `commandHistory.pushCommand()` with a properly constructed `WorkbookCommand` payload (defined in `src/hooks/useCommandHistory.ts`) immediately prior to the execution boundary. Each command must capture sufficient inverse data (prev/next values, cascade effects, registry deltas) to enable full undo/redo fidelity.
* Move Effect Atomicity: When an `EDIT_CELL` command changes a row's division (via `itemId`), the resulting `moveEffect` MUST be embedded on the same `EditCellCommand` payload. A single Ctrl+Z must undo both the edit and the relocation atomically. Never create a separate command for row relocation.

## Data Persistence Boundaries
* **Single Gateway**: All Supabase database access MUST route through `src/lib/db.ts`. No hook, page, or component may import the Supabase client (`src/lib/supabase.ts`) directly.
* **Schema Source of Truth**: The file `supabase_schema.sql` at the project root is the canonical schema definition. Any database schema modification (new tables, columns, indexes, RPC functions) MUST update this file first and receive explicit user approval before execution.
* **Atomic Line Item Writes**: Estimate line item persistence MUST use the `save_estimate_line_items` PostgreSQL RPC function. Direct `INSERT`, `UPDATE`, or `DELETE` against the `estimate_line_items` table from client code is forbidden.
* **Sort Order Integrity**: Saved line items MUST be loaded with `ORDER BY sort_order ASC` and MUST NOT be re-sorted client-side. This preserves manual row positions created via context menu insertion.
* **Financial Write Constraint**: Agents must never invent or alter financial totals, markup percentages, or compounding formulas in the database layer. The calculation engine (`src/lib/calculations.ts`) is the sole authority.
* **Guardrail Skill Reference**: The agent must execute the enforcement checks defined in **`.agent/skills/database-guardrails/SKILL.md`** for all proposed modifications touching database persistence.

## Division Code Standardization
* **Single Utility**: All division code extraction from `itemId` strings MUST use `getDivisionCode()` from `src/lib/division.ts`. Direct `substring()`, `split('-')[0]`, or inline regex extraction is forbidden.
* **Return Contract**: `getDivisionCode(itemId)` returns a 2-digit CSI string (e.g., `"09"`) or `""` for invalid/missing inputs. Consumers must handle the empty-string case.

## Source Provenance Tracking
* **Mandatory Field**: Every `ProcessedTakeoffRow` MUST have a `source` field set to one of: `'template'`, `'csv_import'`, or `'manual'`.
* **Assignment Points**: Template-initialized rows → `'template'`. Parser output rows → `'csv_import'`. Context-menu-inserted rows → `'manual'`.
* **Undo Fidelity**: The `source` field MUST be captured in `MERGE_TAKEOFF_DATA` command `prevRowStates` and `nextRowStates` to ensure undo correctly restores original provenance.

## Training Data Immutability
* **Classification History**: The `classification_history` table is append-only. Agents must never `UPDATE` or `DELETE` rows. Each resolution event is an immutable training observation.
* **Estimate Snapshots**: The `estimate_snapshots` table is append-only. Snapshots are frozen state captures and must never be modified after creation.
* **Fire-and-Forget Pattern**: All writes to training data tables (`classification_history`, `estimate_snapshots`) from hooks MUST use `.catch(() => {})` to prevent unhandled promise rejections. Training data loss must never block user workflows.