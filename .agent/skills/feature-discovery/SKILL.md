# TASK: Feature Deconstruction & Contextual Discovery

Execute these steps to build a 360-degree understanding of the target feature. Stop and ask for clarification if you find conflicting logic or dead-end code paths. Do not write or propose any implementation plans during this discovery phase.

**Step 1: Workspace Indexing & File Discovery**
Search the repository explicitly to identify every component, utility, type schema, or style layer related to this feature.
* Group discoveries by application workspace layers: Next.js frontend pages (`src/app/`), interface components (`src/components/`), and structural data libraries (`src/lib/`).
* Identify the exact file paths for browser storage caching actions: local storage keys, data retrieval handlers, or registry synchronization hooks.
* Output: A structured Markdown table of "Primary Impact Files" (direct state adjustments) and "Secondary Impact Files" (import/export compilation modules).

**Step 2: Data Lifecycle & Core State Boundaries**
Trace the complete chronological flow of data for this feature from entry to output serialization.
* Identify the origination point: **TogalRowPayload** wide-row CSV imports via **PapaParse**, manual cell entries, or right-click pointer actions.
* Track frontend state transformation layers: Detail exactly how **TanStack Table** instances, local React array states, or dictionary states manipulate the layout data.
* Track local execution calculations: Trace how target items resolve suffix mapping matching via the **ESTIMATE_ITEMS_MASTER** dictionary catalog or dynamic UOM matching loops.

**Step 3: State Integrity & Relational Isolation Constraints**
Conduct a strict structural isolation check for the targeted estimation workflows.
* Verify relational containerization boundaries: Confirm that target estimate states are uniquely isolated using explicit **projectId** parameters to prevent global scope contamination.
* Enforce structural grid safeguards: Validate that manual cell entries or list adjustments conform to active **lockedCells** markers and strict **ProcessedTakeoffRow** interface type contracts.
* Identify memory mutation gates: Verify that list changes or batch spreadsheet modifications trigger the **pushSnapshotToStack** hook right at the execution boundary.

**Step 4: Pattern Alignment & Constraint Matching**
Review **AGENTS.md** alongside all target sub-skills within the repository to extract required layout conventions.
* Extract reusable patterns: Enforce the use of spreadsheet focus handlers (**ArrowUp**, **ArrowDown**, **Enter**, **Tab**), high-performance cell grids, or custom tab-delimited clipboard text processors.
* Check for compounding overhead rules: Ensure that final price summary ledgers calculate **General Liability Insurance** factors at exactly **1%** and **Contractor Fees** at exactly **5%**.
* Scan for forbidden anti-patterns: Flag and block raw numerical mutations bypassing the timeline undo array stack, untyped currency variables, missing client browser checks, or unmapped child suffix line items bypassing parent cost-code grouping filters.

**Step 5: Contextual Summary & Blast Radius Profile**
Provide a concise, scannable technical summary of the system's current data flow for this scope.
* Detail the exact "Blast Radius" of potential side effects across downstream math equations, project directory navigation elements, or exported spreadsheet files (**ExcelJS**, **Procore Budget** payloads).
* Stop entirely and wait for further instructions. Do not write an implementation plan.