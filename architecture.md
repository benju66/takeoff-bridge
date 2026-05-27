# System Architecture & Data Flow

## Data Entities & Constants
* **`TogalRowPayload`**: Multi-quantity wide row layout straight from CSV ingestion containing `Classification`, `Quantity 1`, `UOM1`, `Quantity 2`, `UOM2`.
* **`InternalEstimateItem`**: Target lines leveraging precise custom suffix definitions (e.g., `04-0000.001` for CMU Backup) mapping back to clean Procore parent codes (`4-40000.000`).
* **`DeterministicMappingRegistry`**: The key-value junction table binding literal Togal string classifications to precise internal suffix codes.

## Processing Execution Pipeline
1. **File Ingestion Engine**: Client-side browser file parsing of raw Togal CSV files via `PapaParse`, initiated dynamically by drag-and-drop or manual upload directly in the client context.
2. **Relational Lookup Utility**: Cross-references Togal string names against `DeterministicMappingRegistry`.
3. **UOM Filter Loop**: Scans wide-row dimensions to pull out the metric matching the `targetUom` constraint.
4. **Human-In-The-Loop UI**: Halts processing on missing keys to display an editable data grid for manual assignments.
5. **Dynamic Dictionary Cache**: Persists newly mapped classification-to-suffix pairs in browser `localStorage` (key: `"takeoff_user_registry"`) to preserve mapping definitions locally across page reloads without database roundtrips.
6. **Export Core Pipeline**: Generates a structured paste-ready Excel CSV and a summarized Procore Budget CSV.

## Fuzzy Token Matching Engine
To assist users in reconciling unmapped classifications, `src/lib/similarity.ts` generates interactive user suggestion badges using a hybrid token-distance scoring engine:
1. **Token Ingestion & Normalization**: Splits user input and target master records into normalized lowercase alphanumeric tokens.
2. **Token Overlap Calculation (50% Weight)**: Evaluates the proportion of input tokens matched within the item description or ID to ensure strong contextual relevance.
3. **Levenshtein String Distance on Description (40% Weight)**: Evaluates character-by-character edit distance between the normalized user input and candidate description to capture spelling/phonetic similarities.
4. **Levenshtein String Distance on Item ID (10% Weight)**: Computes the edit distance against the item ID for secondary exact matches.
5. **Badging UI Resolution**: Sorts all potential master items by the combined score, rendering the top three recommendations to the user as clickable action badges in the manual reconciliation table.

## Custom Context Menu & Manual Row Insertion Pipeline (Phase 1 Expansion)
To transition the ingestion grid from a rigid tabular layout into an elastic spreadsheet experience, the application uses a decoupled, event-driven row splicing architecture:

1. Context Pointer Interception: The UI intercepts native browser right-click triggers on the Step 4 Takeoff Workbook Matrix via `onContextMenu` cell handlers. It prevents standard window events and records mouse coordinates (`clientX`, `clientY`) alongside runtime row index markers.
2. Context Menu Portal UI: A floating context menu primitive renders conditionally at the recorded cursor screen coordinates. It provides explicit operational commands ("Insert Row Above", "Insert Row Below").
3. Historical Rollback Protection: Before performing any array mutations, the system executes an isolated state copy save to the `pushSnapshotToStack(rows)` undo ledger. This ensures manual row insertions can be rolled back using the existing action undo infrastructure.
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
Upon establishing all mapped quantities and unit prices, the application dynamically aggregates takeoff values through a compounding overhead calculation layer:
1. **Itemized Subtotal**: Sum of all line items, where `Total Cost = Matched Quantity × Unit Price`.
2. **General Liability Insurance**: Generates a financial layer computed at exactly `1%` of the cumulative itemized subtotal (`Subtotal × 0.01`).
3. **Contractor Fee**: Generates an agency fee calculated at exactly `5%` of the itemized subtotal (`Subtotal × 0.05`).
4. **Total Estimated Cost**: Accumulates all components via `Total Est. Cost = Subtotal + General Liability (1%) + Contractor Fee (5%)`, displaying the live calculation across the terminal dashboards and top metrics panel.