# System Architecture & Data Flow

## Data Entities & Constants
* **`TogalRowPayload`**: Multi-quantity wide row layout straight from CSV ingestion containing `Classification`, `Quantity 1`, `UOM1`, `Quantity 2`, `UOM2`.
* **`InternalEstimateItem`**: Target lines leveraging precise custom suffix definitions (e.g., `04-0000.001` for CMU Backup) mapping back to clean Procore parent codes (`4-40000.000`).
* **`DeterministicMappingRegistry`**: The key-value junction table binding literal Togal string classifications to precise internal suffix codes.

## Processing Execution Pipeline
1. **File Ingestion Engine**: Client-side browser file parsing of raw Togal CSV files via `PapaParse`, initiated dynamically by drag-and-drop or manual upload directly in the client context.
2. **Pre-compiled Lookup Maps** (`src/lib/parser.ts`): Before the row-iteration loop begins, the parser pre-compiles three `Map<string, string>` structures with normalized (lowercased/trimmed) keys for O(1) classification resolution:
   - `userMap` — from the project-isolated `userRegistry` parameter (built per parse call).
   - `globalMap` — from the corporate `globalRegistry` parameter (built per parse call).
   - `initialMap` — from the static `INITIAL_MAPPING_REGISTRY` constant (built once at module load).
   - **Resolution priority**: Exact-case direct lookup first (`userRegistry[classification]` → `globalRegistry[classification]` → `INITIAL_MAPPING_REGISTRY[classification]`), then normalized fallback (`userMap.get(norm)` → `globalMap.get(norm)` → `initialMap.get(norm)`).
   - Row column headers are also normalized once per row via `normalizeRowKeys()` → `Map<string, unknown>`, replacing per-column `Object.keys().find()` scans with single `Map.get()` calls.
3. **UOM Filter Loop**: Scans wide-row dimensions to pull out the metric matching the `targetUom` constraint.
4. **Human-In-The-Loop UI**: Halts processing on missing keys to display an editable data grid for manual assignments.
5. **Supabase Persistence Layer**: All application state is persisted to a cloud PostgreSQL database via Supabase. The data access layer (`src/lib/db.ts`) serves as the single gateway — no other file imports the Supabase client directly.
   - **Projects, estimates, registries, column definitions, and cell locks** are stored in dedicated normalized tables with `ON DELETE CASCADE` referential integrity.
   - **Data Sanitization**: Before upserting records (such as project estimates), numerical fields are sanitized (converting invalid `NaN` or non-finite float inputs to `0`). This prevents PostgreSQL constraint violations (e.g. `NOT NULL` violations) on serialization.
   - **Verbose Database Error Logging**: Data layer errors are caught, decomposed, and logged with raw PostgreSQL status codes, details, and hints, avoiding empty JSON stringification (`{}`) of non-enumerable properties.
   - **Estimate line items** are saved atomically via a PostgreSQL stored procedure (`save_estimate_line_items`) that wraps DELETE + INSERT in a single transaction to prevent data loss during network interruptions.
   - **Sort order preservation**: Each line item stores a `sort_order` integer matching its array index. On reload, items are loaded with `ORDER BY sort_order ASC` to preserve the exact visual layout, including manually spliced rows.
   - **Debounced auto-persist**: All auto-save effects use 1500ms debounce timers to prevent excessive network traffic during rapid keyboard-driven data entry.
   - **Classification registries** are persisted at two scopes: project-isolated (`project_registries`) and global corporate (`global_registry`). Lookup resolution follows the fallback chain: project registry → global registry → static constants.
   - **Theme & Sidebar preference**: Layout themes and layout settings (such as sidebar hover auto-expand under `takeoff-bridge-sidebar-hover-expand`) are stored in browser `localStorage`. Realtime layout updates are communicated via window-level `CustomEvent` dispatches (e.g. `"sidebar-settings-updated"`) to prevent full-page refreshes.
6. **Export Core Pipeline**: Generates a structured paste-ready Excel CSV and a summarized Procore Budget CSV.

## Automated Test Infrastructure
The project uses **Vitest** (`vitest.config.ts`) for unit and regression testing. Test files live in `src/lib/__tests__/` and are executed via `npm run test` (single run) or `npm run test:watch` (interactive).
* **Parser regression suite** (`src/lib/__tests__/parser.test.ts`): 7 test cases validating exact-case matching, case-insensitive fallback, registry priority chain, unmapped classification defaults, empty classification filtering, missing quantity column defaults, and duplicate normalized key detection.
* **Test gate**: All agents must execute `npm run test` and confirm zero failures before presenting work for user review (enforced via `AGENTS.md` and `SKILL.md`).

## Fuzzy Token Matching Engine
To assist users in reconciling unmapped classifications, `src/lib/similarity.ts` generates interactive user suggestion badges using a hybrid token-distance scoring engine:
1. **Token Ingestion & Normalization**: Splits user input and target master records into normalized lowercase alphanumeric tokens.
2. **Token Overlap Calculation (50% Weight)**: Evaluates the proportion of input tokens matched within the item description or ID to ensure strong contextual relevance.
3. **Levenshtein String Distance on Description (40% Weight)**: Evaluates character-by-character edit distance between the normalized user input and candidate description to capture spelling/phonetic similarities.
4. **Levenshtein String Distance on Item ID (10% Weight)**: Computes the edit distance against the item ID for secondary exact matches.
5. **Badging UI Resolution**: Sorts all potential master items by the combined score, rendering the top three recommendations to the user as clickable action badges in the manual reconciliation table.

## Custom Context Menu & Manual Row Insertion Pipeline (Phase 1 Expansion)
To transition the ingestion grid from a rigid tabular layout into an elastic spreadsheet experience, the application uses a decoupled, event-driven row splicing architecture:

1. Context Pointer Interception: The UI intercepts native browser right-click triggers on the Step 4 Estimate Table via `onContextMenu` cell handlers. It prevents standard window events and records mouse coordinates (`clientX`, `clientY`) alongside runtime row index markers.
2. Context Menu Portal UI: A floating context menu primitive renders conditionally at the recorded cursor screen coordinates. It provides explicit operational commands ("Insert Row Above", "Insert Row Below").
3. Command Pattern History Protection: Before performing any array mutations, the system records an atomic `WorkbookCommand` delta via `commandHistory.pushCommand()` (defined in `src/hooks/useCommandHistory.ts`). The command captures the minimum inverse data needed for undo/redo — including per-field prev/next values, cascade effects for sibling rows (computed via dual-simulation of `applyCellEditDirect`), and registry deltas. This replaces the former snapshot-based approach and supports full bidirectional undo/redo with 50-entry history depth.
4. Compliant Skeleton Splicing: The insertion engine performs an absolute array modification using `.splice()`. To maintain type contract validation and prevent application rendering runtime exceptions, the manual row object must initialize with valid fallback properties matching the `ProcessedTakeoffRow` contract:
   - `id`: Unique timestamp-appended custom string hash.
   - `classification`: Literalled string indicator `"MANUAL ENTRY"`.
   - `itemId` & `procoreParentCode`: Empty strings until assigned.
   - `description`: Empty text baseline.
   - `matchedQty` & `unitPrice` & `total`: Hardset numerical defaults `0`.
   - `isMapped`: Evaluates to boolean `false`.
   - `costType`: Default construction material placeholder `"M"`.
5. Window Blur Dismissal: An ambient event listener registers against the global `window` click target to automatically clear layout coordinate tracking and hide the panel on outside interaction clicks.

## Compounding Overhead Calculation Layer
Upon establishing all mapped quantities and unit prices, the application dynamically aggregates takeoff values through a compounding overhead calculation layer using project-specific pricing modifiers:
1. **Itemized Subtotal**: Sum of all line items, where `Total Cost = Matched Quantity × Unit Price`.
2. **Overhead Markup**: Calculated as `Subtotal × (overheadRate / 100)`.
3. **General Liability Insurance**: Computed as `Subtotal × (liabilityRate / 100)`.
4. **Contractor Fee**: Computed as `Subtotal × (feeRate / 100)`.
5. **Sales Tax (Material-Only)**: Sums all line items where `costType === 'M'` (Materials) and multiplies by `(taxRate / 100)`.
6. **Cell Rounding Rules**: Applied to each summary component individually (rounding to nearest $1, $10, or $100 depending on the project's `roundingRule`) before calculating the Grand Total to prevent floating-point leaks and ensure that spreadsheet column values match the total exactly.
7. **Total Estimated Cost**: Cumulative sum of the rounded subtotal and rounded modifiers, displaying the live calculation across the terminal dashboards and top metrics panel.