# System Architecture & Data Flow

## Data Entities & Constants
* **`TogalRowPayload`**: Multi-quantity wide row layout straight from CSV ingestion containing `Classification`, `Quantity 1`, `UOM1`, `Quantity 2`, `UOM2`.
* **`InternalEstimateItem`**: Target lines leveraging precise custom suffix definitions (e.g., `04-0000.001` for CMU Backup) mapping back to clean Procore parent codes (`4-40000.000`).
* **`DeterministicMappingRegistry`**: The key-value junction table binding literal Togal string classifications to precise internal suffix codes.

## Processing Execution Pipeline
1. **File Ingestion Engine**: Server-side parsing of raw Togal CSV arrays via `PapaParse`.
2. **Relational Lookup Utility**: Cross-references Togal string names against `DeterministicMappingRegistry`.
3. **UOM Filter Loop**: Scans wide-row dimensions to pull out the metric matching the `targetUom` constraint.
4. **Human-In-The-Loop UI**: Halts processing on missing keys to display an editable data grid for manual assignments.
5. **Dynamic Dictionary Cache**: Writes new user assignments immediately to Firestore to automate subsequent uploads.
6. **Export Core Pipeline**: Generates a structured paste-ready Excel CSV and a summarized Procore Budget CSV.