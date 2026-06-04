# SKILL: Pre-Implementation Architectural Review Gate

## Step 1: Baseline Integrity Check & Skill Routing
* Execute **npm run build** and **npm run test** in the terminal to establish a clean pre-flight baseline. If the current branch fails compiling or testing, abort and report the errors immediately.
* Review **AGENTS.md**, **CLAUDE.md**, and the proposed execution plan.
* Map out the specific technical domains being altered (**PapaParse** ingestion parsing, **TanStack Table** state arrays, **ExcelJS** mutation pipelines, or **Procore** grouping hooks).
* Identify hidden architectural bugs, logical gaps, and prospective layout regressions before editing any production files.
* Update the proposed execution plan to explicitly handle edge cases, layout shifts, broken user entry flows, lost command history states, or calculation anomalies.

## Step 2: Strict Guardrail Validation Sweep
* Prioritize maximum grid performance and absolute state isolation during the codebase sweep.
* When modifying workspace grids, interactive tables, or custom data hooks, verify absolute conformity to these strict constraints:
  * **commandHistory.pushCommand()**: Call `commandHistory.pushCommand()` with a verified `WorkbookCommand` payload (matching `src/hooks/useCommandHistory.ts`) *immediately prior* to executing any layout array mutations or cell state transformations. You must capture exact inverse states (prev/next differentials, registry deltas, multi-variable simulations) to guarantee lossless undo/redo execution.
  * **Move Effect Atomicity**: When an `EDIT_CELL` command changes a row's division (via `itemId`), the resulting `moveEffect` MUST be embedded on the *same* `EditCellCommand` payload. A single Ctrl+Z must undo both the edit and the relocation atomically. Never create a separate command for row relocation.
  * **Excel-like Keyboard Navigation**: Intercept and handle native browser keys (**ArrowUp**, **ArrowDown**, **Enter**, **Tab**) within grid components to precisely manage boundary tracking and prevent native scroll overrides.
  * **Database Gateway Restriction**: All Supabase database access MUST route through `src/lib/db.ts`. No component, page, or hook may import the Supabase client (`src/lib/supabase.ts`) directly.
  * **Atomic Line Item Writes**: Persistence of estimate line items MUST use the `save_estimate_line_items` PostgreSQL RPC function. Direct `INSERT`, `UPDATE`, or `DELETE` against the `estimate_line_items` table is forbidden.
  * **Relational Persistence Fallbacks**: Ensure data lookups fall back through the strict async persistence resolution sequence: project-isolated registry (`project_registries` table via `getProjectRegistry`) ➔ global corporate registry (`global_registry` table via `getGlobalRegistry`) ➔ static fallback constants (`ESTIMATE_ITEMS_MASTER`).
  * **Division Code Standardization**: All division code extraction from `itemId` strings MUST use `getDivisionCode()` from `src/lib/division.ts`. Inline substrings, splits, or regex extractions are forbidden.
  * **Source Provenance & Skeleton Splicing**: Every `ProcessedTakeoffRow` MUST have a `source` field (`'template'`, `'csv_import'`, or `'manual'`). When manually appending items, initialize all non-nullable properties within core TypeScript models to eliminate data format compilation drift.
  * **Parent Cost Code Mapping**: Confirm that fine-grained item suffix strings (e.g., `04-0000.001`) aggregate and remap cleanly to true parent asset codes (e.g., `4-40000.000`) before triggering **Procore Budget** serialization.
  * **Training Data Immutability**: The `classification_history` and `estimate_snapshots` tables are append-only. All writes must use `.catch(() => {})` to prevent unhandled promise rejections from blocking workflows.

## Step 3: Topological Impact Analysis & TDD Setup
* Audit multi-tab data flows to guarantee real-time downstream synchronization.
* Confirm that file mutations or cell layout updates do NOT alter fixed project variables (**squareFootage**, **unitCount**), GC Personnel allocation vectors, or jobsite infrastructure calculation metrics.
* Create the target unit test file inside `src/lib/__tests__/` according to strict **Test-Driven Development (TDD)** rules. Write explicit assertions matching the new product requirement, execute it via terminal command `npm run test`, and confirm it safely exits with a failure code (`exit 1`) to eliminate false-positive test results.
* Eliminate circular execution patterns. Ensure no grid UI component, context menu asset, or operational badge is generated before its supporting state hooks or engine types are cleanly implemented.
* Outline a localized rollback plan to isolate the modified computational streams if calculations drift.

## Step 4: Verification Parameter Integration
* Define clear, immutable testing variables for every code path introduced.
* Build technical validations checking the following system constraints:
  * Raw spreadsheet payload parsing accuracy against active **TogalRowPayload** structural schemas.
  * Fluid UI grid responsiveness and row virtualization stability under rapid, keyboard-only manual inputs.
  * Mathematical accuracy of the compounding fee engine, ensuring **General Liability Insurance** calculates strictly at **1%** and the **Contractor Fee** calculates strictly at **5%** (per the `ESTIMATE_MODIFIERS` constants).
  * Sort order preservation, checking that database reads load with `ORDER BY sort_order ASC` and are not re-sorted on the client side.
  * Numerical data sanitization, verifying cell edits convert invalid `NaN` or non-finite inputs to `0` prior to DB persistence.
  * Total structural stream integrity of generated **ExcelJS** binary exports.

## Step 5: Review Gate Formulation
* Compile your final, actionable strategy into this structured markdown table:

| File Path | Proposed Change | Impacted System | Verification Method |
| :--- | :--- | :--- | :--- |
| | | | |

* Ensure the proposed code additions are free of console logs, empty remarks, unhandled warnings, or hardcoded mock constants.
* **STOP EXECUTING IMMEDIATELY. Do not write or apply any production feature patches until you receive explicit human approval in the workspace chat.**