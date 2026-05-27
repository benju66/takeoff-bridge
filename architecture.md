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

## Compounding Overhead Calculation Layer
Upon establishing all mapped quantities and unit prices, the application dynamically aggregates takeoff values through a compounding overhead calculation layer:
1. **Itemized Subtotal**: Sum of all line items, where `Total Cost = Matched Quantity × Unit Price`.
2. **General Liability Insurance**: Generates a financial layer computed at exactly `1%` of the cumulative itemized subtotal (`Subtotal × 0.01`).
3. **Contractor Fee**: Generates an agency fee calculated at exactly `5%` of the itemized subtotal (`Subtotal × 0.05`).
4. **Total Estimated Cost**: Accumulates all components via `Total Est. Cost = Subtotal + General Liability (1%) + Contractor Fee (5%)`, displaying the live calculation across the terminal dashboards and top metrics panel.