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
* **CASCADE Awareness**: All child tables (`project_estimates`, `estimate_line_items`, `project_column_defs`, `project_locked_cells`, `project_registries`) use `ON DELETE CASCADE` from `projects`. Never manually delete child records — delete the parent `projects` row and let PostgreSQL handle cascading cleanup.

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
