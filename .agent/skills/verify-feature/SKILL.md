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
* **Compounding Formula Audit**: Confirm that cumulative estimate totals accurately run the following compounding chain based on dynamic project rates (stored as decimals) and rounding rules:
  * `Itemized Subtotal = Sum(Quantity × Unit Price)`
  * `Construction Contingency = Subtotal × constructionContingencyRate`
  * `Design Contingency = Subtotal × designContingencyRate`
  * `Builders Risk Insurance = Subtotal × buildersRiskRate`
  * `Special Insurance = Subtotal × specialInsuranceRate`
  * `General Liability Insurance = Subtotal × glInsuranceRate` (default 0.01 = 1%)
  * `Bond = Subtotal × bondRate`
  * `Fee = Subtotal × feeRate` (default 0.05 = 5%)
  * `Total Estimated Cost = Rounded(Subtotal) + Sum(Rounded(7 modifiers))`
* **Zero Budget Leaks**: Verify that final tallies are completely free of floating-point rounding errors or JavaScript `NaN` leaks in the UI views.

## 4. Downstream Export Integration
* **ExcelJS Equation Injections**: Open and verify generated spreadsheet binaries to confirm that summary fields use functional, executable string formulas (`SUM(...)`) rather than hardcoded static numbers.
* **Procore Parent Rollups**: Audit exported budget payload object arrays to guarantee fine-grained child suffixes match cleanly with valid, structured parent cost codes.

## 5. Post-Implementation Verification Gate

### Step 1: Compilation Execution Validation
* Spin up a local terminal process and execute **npm run build**.
* Verify that the newly appended features or database hooks generate zero layout breaks, linter errors, or TypeScript type compilation warnings.

### Step 2: Complete Unit Regression Suite
* Execute **npm run test** in the terminal to trigger the workspace unit testing suite.
* Confirm all 9 core unit test suites pass completely without regression.
* Ensure calculations, workbook parsers, and Excel layout shifting logic operate properly, validating that no legacy cell ranges or lookup chains were damaged.

### Step 3: End-to-End Browser Smoke Test
* Execute **npm run test:e2e** to launch the headless browser engine via Playwright.
* Verify the live application stream successfully passes the full system sequence: authentication login ➔ dashboard routing ➔ workspace load ➔ formula entry ➔ real-time UI grid cell matrix calculation and expression parsing.

### Step 4: Zero-Failure Enforcement & Loop Stopping Condition
* If any step logs a non-zero exit code or tracking failure, you are explicitly blocked from marking the task complete.
* Read the terminal `stderr` stack trace directly, enter self-correction mode, fix the bug within a sandboxed file state, and run this verification skill sequentially from Step 1 again.
* Do not request human review or close out the active agent session until the runtime test environment goes 100% green. If failures are determined to be pre-existing environment issues or out-of-scope infrastructure bottlenecks, document them clearly and request user review to address the blockage.