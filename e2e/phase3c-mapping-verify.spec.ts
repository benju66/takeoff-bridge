import { test, expect, Page } from "@playwright/test";
import ExcelJS from "exceljs";
import fs from "fs";
import os from "os";
import path from "path";

// ---------------------------------------------------------------------------
// Phase 3c end-to-end chokepoint proof (plan §8.0):
//   1. Edit a cost_code_map mapping in the /cost-codes editor.
//   2. Create a SCRATCH project — its template-init rows are created AFTER the
//      edit and must pick up the EDITED mapping, not the stale catalog value.
//   3. Sanity-check the itemId cascade path in the UI (same resolver call).
//   4. Export the workbook and assert the dollars land on the NEW Procore
//      code in Budget Line Items — and not on the old one.
//   5. Revert the mapping and delete the scratch project (no residue:
//      22-4129.001 was already source='manual' from Phase 3a).
//
// Remaps 22-4129.001 (Shower Pans, seeded → 22-220000.000) to 6-64100.000
// (Architectural Casework — a STEP-4-sourced BLI row whose column H is
// value-written by the rollup).
// ---------------------------------------------------------------------------

const INTERNAL_CODE = "22-4129.001";
const NEW_PROCORE_CODE = "6-64100.000";
const CASCADE_SOURCE_ROW = "03-0000.001"; // template row whose itemId we re-point

async function login(page: Page) {
  await page.goto("/");
  await page.waitForTimeout(2000);
  if (page.url().includes("/login")) {
    const email = process.env.NEXT_PUBLIC_DEV_EMAIL || "burness@fpcinc.com";
    const password = process.env.NEXT_PUBLIC_DEV_PASSWORD || "BuildIt2026!!";
    await expect(page.locator("input[type='email']")).toBeVisible();
    await page.locator("input[type='email']").fill(email);
    await page.locator("input[type='password']").fill(password);
    await page.locator("button[type='submit']").click();
  }
  await page.waitForURL("**/projects", { timeout: 15000 });
}

/** Set a mapping on /cost-codes and wait for the persisted confirmation. */
async function setMapping(page: Page, internalCode: string, procoreCode: string) {
  await page.goto("/cost-codes");
  await expect(page.locator("h1:has-text('COST CODE MAPPING')")).toBeVisible({ timeout: 30000 });
  await page.locator("input[placeholder*='Search by internal code']").fill(internalCode);

  const rowButton = page.locator(`button[title*='${internalCode}']`);
  await expect(rowButton).toBeVisible();
  const current = (await rowButton.innerText()).trim();
  if (current.includes(procoreCode)) return current; // already set

  await rowButton.click();
  const select = page.locator(`select[title='Procore destination for ${internalCode}']`);
  await expect(select).toBeVisible();
  await select.selectOption(procoreCode);

  // Save confirmed when the button re-renders with the new code
  await expect(page.locator(`button[title*='${internalCode}']`)).toContainText(procoreCode, { timeout: 15000 });
  return current;
}

/** Click-to-select then click-to-edit a grid cell and commit a value. */
async function editCell(page: Page, cellId: string, inputPrefix: string, value: string) {
  const cell = page.locator(`[id='${cellId}']`);
  await expect(cell).toBeVisible();
  // Let the virtualizer finish repositioning after filter changes — a click on
  // a moving row can select the wrong cell.
  await page.waitForTimeout(500);
  // Click-to-toggle (React 19: dblclick never fires; second click enters edit)
  await cell.click();
  await cell.click();
  const input = page.locator(`input[id^='${inputPrefix}-']`);
  await expect(input).toBeVisible();
  // Real keystrokes (not fill): the buffered cell inputs re-sync their buffer
  // on focus, which can swallow a programmatic value-set.
  await input.press("ControlOrMeta+a");
  await input.pressSequentially(value, { delay: 20 });
  await input.press("Enter");
}

test.describe("Phase 3c — mapping edit moves export dollars (resolveProcoreCode chokepoint)", () => {
  // Fail individual actions fast instead of retrying until the test timeout —
  // a detached/unstable element must surface as a step failure, not a hang.
  test.use({ actionTimeout: 15000 });
  test.setTimeout(300_000);

  test("edit mapping -> new project picks it up -> BLI dollars move -> revert", async ({ page }) => {
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log(`[BROWSER ERROR] ${msg.text()}`);
    });
    page.on("pageerror", (err) => console.log(`[PAGE ERROR] ${err.message}\n${err.stack}`));
    // Auto-accept the project-delete confirm dialog in cleanup
    page.on("dialog", (dialog) => dialog.accept());

    await login(page);

    // ---- 1. Edit the mapping ------------------------------------------------
    const originalCode = await setMapping(page, INTERNAL_CODE, NEW_PROCORE_CODE);
    expect(originalCode).not.toContain(NEW_PROCORE_CODE);
    console.log(`Mapping ${INTERNAL_CODE}: ${originalCode} -> ${NEW_PROCORE_CODE}`);

    const projectName = `3C VERIFY ${Date.now()}`;
    try {
      // ---- 2. Scratch project: template init AFTER the edit ----------------
      await page.goto("/projects");
      await page.locator("button:has-text('Initialize Project')").first().click();
      await page.locator("input[placeholder*='Oakridge']").fill(projectName);
      await page.locator("input[placeholder*='Chicago']").fill("3c verification");
      await page.locator("input[placeholder*='145000']").fill("1000");
      await page.locator("input[placeholder*='120']").fill("1");
      await page.locator("button:has-text('Create Node')").click();

      const projectRow = page.locator("tr", { hasText: projectName });
      await expect(projectRow).toBeVisible({ timeout: 15000 });
      await projectRow.locator("a:has-text('Launch')").click();
      await page.waitForURL("**/projects/*", { timeout: 30000 });

      await page.locator("aside a:has-text('Estimate')").click();
      await page.waitForURL("**/projects/*?step=step4", { timeout: 15000 });
      await expect(page.locator("h3:has-text('Takeoff Workbook')")).toBeVisible({ timeout: 30000 });

      // ---- 3. Cascade path: re-point a SAME-DIVISION row's itemId so no
      // moveEffect relocation is involved (cross-division moves interact with
      // virtualization/filtering and are exercised elsewhere) ----------------
      const gridSearch = page.locator("input[placeholder='Search all columns...']");
      await gridSearch.fill("22-"); // bring Division 22 rows into the window
      const div22Cells = page.locator("[id^='cell-row-22-'][id$='-itemId']");
      await expect(div22Cells.first()).toBeVisible();
      const allDiv22 = await div22Cells.evaluateAll((els) => els.map((el) => el.id));
      const cascadeCellId = allDiv22.find((id) => !id.includes(INTERNAL_CODE))!;
      expect(cascadeCellId, "no second Division 22 row found").toBeTruthy();
      const cascadeRowKey = cascadeCellId.replace("cell-", "").replace("-itemId", "");
      console.log(`Cascade source row: ${cascadeRowKey}`);
      await editCell(page, cascadeCellId, "code-input", INTERNAL_CODE);
      // Let the commit fully settle before touching the search bar — focusing
      // it too early swallows the in-flight commit.
      await page.waitForTimeout(3000);

      // Cascade proof: description rewritten from the catalog by the SAME
      // branch that assigns procoreCode via the chokepoint two lines above.
      await expect(page.locator(`[id='cell-${cascadeRowKey}-description']`)).toContainText("Shower Pans", { timeout: 15000 });

      // Cascade row: qty 5 × price 100 = $500 on the NEW code
      await editCell(page, `cell-${cascadeRowKey}-matchedQty`, "qty-input", "5");
      await expect(page.locator(`[id='cell-${cascadeRowKey}-matchedQty']`)).toContainText("5.00");
      await editCell(page, `cell-${cascadeRowKey}-unitPrice`, "price-input", "100");
      await expect(page.locator(`[id='cell-${cascadeRowKey}-unitPrice']`)).toContainText("100");

      // Template-init row: qty 10 × price 100 = $1,000 on the NEW code
      await gridSearch.fill(INTERNAL_CODE);
      await editCell(page, `cell-row-${INTERNAL_CODE}-matchedQty`, "qty-input", "10");
      await expect(page.locator(`[id='cell-row-${INTERNAL_CODE}-matchedQty']`)).toContainText("10.00");
      await editCell(page, `cell-row-${INTERNAL_CODE}-unitPrice`, "price-input", "100");
      await expect(page.locator(`[id='cell-row-${INTERNAL_CODE}-unitPrice']`)).toContainText("100");

      // ---- 4. Export and assert the rollup ----------------------------------
      const downloadPromise = page.waitForEvent("download", { timeout: 90000 });
      await page.locator("button:has-text('Download Full Estimate Workbook')").click();
      const download = await downloadPromise;
      const xlsxPath = path.join(os.tmpdir(), `phase3c-verify-${Date.now()}.xlsx`);
      await download.saveAs(xlsxPath);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(xlsxPath);
      const bli = workbook.getWorksheet("Budget Line Items");
      expect(bli, "Budget Line Items sheet missing from export").toBeTruthy();

      let newCodeValue: number | null = null;
      let oldCodeValue: unknown = null;
      bli!.eachRow((row) => {
        const code = (row.getCell(1).text || "").trim();
        if (code === NEW_PROCORE_CODE) newCodeValue = Number(row.getCell(8).value) || 0;
        if (originalCode.includes(code) && code.length > 0) oldCodeValue = row.getCell(8).value;
      });
      fs.unlinkSync(xlsxPath);

      console.log(`BLI[${NEW_PROCORE_CODE}] = ${newCodeValue}; BLI[${originalCode}] = ${JSON.stringify(oldCodeValue)}`);

      // The $1,500 (template-init $1,000 + cascade $500) must land on the NEW
      // code — proves BOTH chokepoint paths …
      expect(newCodeValue).not.toBeNull();
      expect(Math.abs((newCodeValue as unknown as number) - 1500)).toBeLessThan(0.01);
      // … and must NOT appear under the old code.
      expect(Number(oldCodeValue) || 0).not.toBeCloseTo(1500, 2);
    } finally {
      // ---- 5. Cleanup: revert mapping, delete scratch project ---------------
      await setMapping(page, INTERNAL_CODE, originalCode);
      console.log(`Mapping ${INTERNAL_CODE} reverted to ${originalCode}`);

      await page.goto("/projects");
      const projectRow = page.locator("tr", { hasText: projectName });
      // isVisible() does not auto-wait — wait for the table to load first.
      await expect(projectRow).toBeVisible({ timeout: 15000 });
      await projectRow.locator("button:has-text('Delete')").click();
      await expect(projectRow).not.toBeVisible({ timeout: 15000 });
      console.log(`Scratch project "${projectName}" deleted`);
    }
  });
});
