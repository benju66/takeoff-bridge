# Skill: Feature Verification Protocol

## 1. Data Ingestion & Schema Alignment
* **Ingest Isolation**: Verify that raw file uploads pass directly to client-side **PapaParse** processing streams without blocking the main UI thread.
* **Target Metric Enforcement**: Confirm that row filtering logic accurately drops mismatched metrics and maps exclusively to the active **targetUom** parameter.
* **Fallback Validation**: Test that unmapped database items render clickable reconciliation badges rather than throwing silent layout errors.

## 2. Spreadsheet Grid Behavior
* **Keyboard Navigation Bounds**: Verify focus updates deterministically via **ArrowUp**, **ArrowDown**, **Enter**, and **Tab** keyboard strokes.
* **Focus Escape Prevention**: Confirm that rapid arrow navigation does not trigger native browser page scroll offsets when cell boundaries are reached.
* **Context Menu Boundary Check**: Test that right-click portal elements inherit dark theme variables (`bg-neutral-900 border border-neutral-800`) and position accurately at pointer screen coordinates.
* **Overlay Dismissal**: Ensure that any clicking action outside active context panels completely clears layout tracking menus from the DOM.

## 3. Financial Ledger Precision
* **Command History Integrity**: Validate that executing a manual row insertion, deletion, or cell modification calls `commandHistory.pushCommand()` with a `WorkbookCommand` payload prior to updating state arrays. Verify that the command captures cascade effects for `itemId`, `description`, and `unitPrice` edits on classified rows.
* **Compounding Formula Audit**: Confirm that cumulative estimate totals accurately run the following compounding chain based on dynamic project rates and rounding rules:
  * `Itemized Subtotal = Sum(Quantity × Unit Price)`
  * `Overhead Markup = Itemized Subtotal × (overheadRate / 100)`
  * `General Liability Insurance = Itemized Subtotal × (liabilityRate / 100)`
  * `Contractor Fee = Itemized Subtotal × (feeRate / 100)`
  * `Sales Tax (Material-Only) = Sum(Material-Only Quantities × Unit Price) × (taxRate / 100)`
  * `Total Estimated Cost = Rounded(Subtotal) + Rounded(Overhead) + Rounded(GL) + Rounded(Fee) + Rounded(Tax)`
* **Zero Budget Leaks**: Verify that final tallies are completely free of floating-point rounding errors or JavaScript `NaN` leaks in the UI views.

## 4. Downstream Export Integration
* **ExcelJS Equation Injections**: Open and verify generated spreadsheet binaries to confirm that summary fields use functional, executable string formulas (`SUM(...)`) rather than hardcoded static numbers.
* **Procore Parent Rollups**: Audit exported budget payload object arrays to guarantee fine-grained child suffixes match cleanly with valid, structured parent cost codes.