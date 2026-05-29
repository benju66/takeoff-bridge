# SKILL.md

### Step 1: Primary Inspection & Skill Routing
* Review **AGENTS.md**, **CLAUDE.md**, and the current Implementation Plan[cite: 2].
* Identify the technical domain of the targeted modifications (e.g., **PapaParse** ingest, **TanStack Table** state, **ExcelJS** mutation, **Procore** grouping).
* Explicitly identify bugs, logical gaps, unhandled edge cases, and layout regressions before proceeding[cite: 2].
* Update the plan to mitigate broken user entry flows, lost snapshot states, or incorrect math equations[cite: 2].

### Step 2: Secondary Sweep & Guardrail Compliance
* Conduct a structural code sweep prioritizing performance and strict state safety[cite: 2].
* If editing grid inputs, spreadsheet components, or lookup pipelines, explicitly verify compliance with:
  * **pushSnapshotToStack**: Enforce calling the historical ledger hook immediately before any layout array or state mutations to protect multi-stage undo rollbacks.
  * **Excel-like Controls**: Intercept and bind keyboard events (**ArrowUp**, **ArrowDown**, **Enter**, **Tab**) to explicitly manage focus bounds and prevent native browser scroll overrides.
  * **Relational Fallbacks**: Ensure lookup resolution queries scan project-isolated overrides (`"takeoff_user_registry_[projectId]"`) before falling back to global `localStorage` keys or static constants.
  * **Parent Code Remapping**: Confirm that fine-grained suffix codes (e.g., `04-0000.001`) combine into clean, valid parent cost codes (e.g., `4-40000.000`) during **Procore Budget** serialization.

### Step 3: Impact Analysis & Topological Sorting
* Audit multi-tab calculation views to ensure downstream UI modules are fully synchronized[cite: 2].
* Verify that modifications to row fields do not alter the fixed metadata variables (**squareFootage**, **unitCount**), GC Personnel utilization logic, or jobsite infrastructure overhead metrics.
* Eliminate circular execution sequences[cite: 2]. 
* Ensure no interface row, action badge, or context menu feature is built before its parent state hook or parser type definition is implemented[cite: 2].
* Outline a localized rollback strategy targeting modified processing streams[cite: 2].

### Step 4: Verification Integration
* Define rigid testing criteria for every isolated adjustment introduced[cite: 2].
* Provide testing verifications checking:
  * Raw file payload mapping accuracy against **TogalRowPayload** schemas.
  * Grid performance and layout response during high-speed, keyboard-only data inputs.
  * Exact compounding math calculations, specifically validating that **General Liability Insurance** outputs at **1%** and the **Contractor Fee** outputs at **5%**.
  * Binary stream compliance of **ExcelJS** exports.

### Step 5: Review Gate
* Present the finalized strategy using a scannable Markdown table block[cite: 2]:

| File Path | Proposed Change | Impacted System | Verification Method |
| :--- | :--- | :--- | :--- |
| | | | |

* Explicitly confirm that the proposed codebase additions contain zero console logs, placeholder remarks, or hardcoded test values[cite: 2].
* **Stop and wait for explicit human approval before executing code changes[cite: 2].**