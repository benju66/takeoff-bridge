# Skill: Database Guardrails

Execute these enforcement checks whenever a proposed modification touches Supabase tables, `db.ts`, `supabase.ts`, or any hook/page that reads or writes persistent state. These guardrails protect data integrity, transactional safety, and schema parity across the application.

---

## 1. Single Gateway Enforcement

* **Sole Importer Rule**: Only `src/lib/db.ts` is permitted to import `src/lib/supabase.ts`. No hook, page, component, or utility may import the Supabase client directly.
* **No Raw Queries**: Consumer code (hooks, pages) must call named async functions exported from `db.ts`. Direct `.from()`, `.rpc()`, or `.select()` calls outside `db.ts` are forbidden.
* **Violation Check**: Run `grep -r "from.*supabase" src/ --include="*.ts" --include="*.tsx"` and verify that only `db.ts` appears in the results.

## 2. Atomic Line Item Persistence

* **RPC Mandate**: All writes to `estimate_line_items` MUST go through the `save_estimate_line_items` PostgreSQL stored procedure via `supabase.rpc()`. Never perform direct `INSERT`, `UPDATE`, or `DELETE` against `estimate_line_items` from the client.
* **Transaction Boundary**: The RPC function wraps DELETE + INSERT in a single `plpgsql` block. If either step fails, the entire operation rolls back. Do not replicate this logic on the client side.
* **sort_order Contract**: The `sort_order` integer for each row MUST equal its array index (`rows.map((row, index) => ({ sort_order: index, ... }))`). This preserves the visual position of manually spliced rows.

## 3. Sort Order Preservation

* **Load Path**: When reading line items from the database, ALWAYS query with `ORDER BY sort_order ASC`. Do not apply any client-side `.sort()` to existing saved data.
* **First Init Exception**: Sorting by `itemId` is ONLY permitted when `estimate_line_items` returns zero rows for a project (first initialization). Once rows exist in the database, their `sort_order` is authoritative.
* **New Master Codes**: If the application's `ESTIMATE_ITEMS_MASTER` catalog introduces new cost codes not present in the saved data, append them to the **tail** of the existing array. Never interleave them into the middle or re-sort the entire dataset.

## 4. Schema Parity

* **Source of Truth**: The file `supabase_schema.sql` at the project root is the canonical schema definition. All schema changes MUST be reflected here before being applied to the Supabase Dashboard.
* **Migration Discipline**: When adding columns, tables, indexes, or RPC functions:
  1. Update `supabase_schema.sql` with the new DDL.
  2. Write the corresponding `ALTER TABLE` / `CREATE FUNCTION` migration statement.
  3. Update `db.ts` mapper functions to handle the new fields.
  4. Present the migration plan to the user for approval before execution.
* **Supabase MCP Integration**:
  * Leverage lazy-loaded Supabase MCP server tools (e.g., `list_tables`, `execute_sql`, `list_migrations`, `apply_migration`) to safely inspect live database structures and verify/run migrations.
  * Run `generate_typescript_types` to refresh database type definitions in the codebase when schema changes occur to prevent typescript compilation drift.
  * *Boundary reminder*: These MCP administrative tools are for development use only and do not change the "Single Gateway Enforcement" rule—all compiled application reads and writes must route through `src/lib/db.ts`.
* **CASCADE Awareness**: Child tables with `ON DELETE CASCADE` from `projects`: `project_estimates`, `estimate_line_items`, `project_column_defs`, `project_locked_cells`, `project_registries`, `estimate_snapshots`. The `classification_history` table uses `ON DELETE SET NULL` on `project_id` — deleting a project preserves training data with a null project reference. Never manually delete child records — delete the parent `projects` row and let PostgreSQL handle cleanup.

## 5. Debounce & Concurrency

* **Auto-Persist Debounce**: All `useEffect`-driven auto-save hooks MUST use a debounce timer of ≥1000ms (currently 1500ms) to prevent network saturation during rapid keyboard-driven data entry.
* **Overlap Prevention**: Concurrent saves to the same resource MUST be guarded (e.g., `isSavingRef` flag or equivalent) to prevent overlapping network requests that could cause data races.
* **Cancellation Guard**: All async `useEffect` IIFE patterns MUST include a `cancelled` boolean checked after `await` to prevent setting state on unmounted components.

## 6. Registry Isolation

* **Two-Scope Model**: Classification-to-cost-code registries exist at two scopes:
  * **Project-isolated** (`project_registries` table, keyed by `project_id`) — stores project-specific mappings.
  * **Global corporate** (`global_registry` table, singleton row `id=1`) — stores organization-wide mappings.
* **Resolution Order**: Lookup resolution MUST follow: project registry → global registry → `ESTIMATE_ITEMS_MASTER` static constants. Never skip or invert this chain.
* **Write-Through**: When a user maps a classification in a project, the mapping MUST be written to both the project registry AND the global registry to build the corporate lookup cache.

## 7. Financial Data Integrity

* **No Speculative Writes**: Do not invent, alter, or guess financial totals, markup percentages, or compounding formulas in the database layer. The calculation engine (`src/lib/calculations.ts`) is the sole authority for deriving `subtotal`, `generalLiability`, `fee`, and `totalCost`.
* **Read-Only Totals**: The `project_estimates` table stores computed totals for persistence only. These values are recalculated on every edit cycle by the calculation engine and then persisted. Never use stored totals as inputs to further calculations.

## 8. Classification History Integrity

* **Append-Only**: The `classification_history` table is an immutable training data store. Agents must NEVER issue `UPDATE` or `DELETE` statements against this table. Each row is a permanent observation.
* **Write Path**: All inserts MUST route through `recordClassificationResolution()` in `db.ts`. Direct `.from('classification_history').insert()` calls outside `db.ts` are forbidden.
* **Fire-and-Forget**: All calls to `recordClassificationResolution()` from hooks MUST include `.catch(() => {})`. Training data loss is non-critical and must never block user workflows or cause unhandled promise rejections.
* **Resolution Sources**: The `resolved_by` vocabulary is defined in ONE module — `src/lib/resolvedBy.ts` — and `recordClassificationResolution()` is typed against it. Current values: `'user'` (manual itemId edit / import-review confirm), `'global'` (global registry resolution), `'seed'` (CSV import auto-mapping), `'ai'` (future AI classification), `'user_lump'` (import-review confirm on a line marked "combined" — recorded but excluded from suggestion ranking and price mining via the `TRUSTED_RESOLVED_BY` allowlist). New phases MUST extend that module, never write ad-hoc tag strings.

## 9. Snapshot Immutability

* **Append-Only**: The `estimate_snapshots` table stores frozen state captures. Agents must NEVER issue `UPDATE` or `DELETE` statements against this table.
* **Write Path**: All inserts MUST route through `createEstimateSnapshot()` in `db.ts`. Direct `.from('estimate_snapshots').insert()` calls outside `db.ts` are forbidden.
* **Fire-and-Forget**: All calls to `createEstimateSnapshot()` from hooks MUST include `.catch(() => {})`. Snapshot failure must never block imports or user actions.
* **Snapshot Types**: The `snapshot_type` column MUST be one of: `'auto'`, `'manual'`, `'pre_import'`, `'milestone'`.

## 10. Source Provenance

* **Required Column**: The `source` column on `estimate_line_items` tracks row origin. Valid values: `'template'` (default initialization), `'csv_import'` (parser output), `'manual'` (context menu insertion).
* **Undo State**: The `source` field MUST be included in `MERGE_TAKEOFF_DATA` command `prevRowStates` and `nextRowStates` captures to ensure Ctrl+Z correctly restores original provenance tags.
