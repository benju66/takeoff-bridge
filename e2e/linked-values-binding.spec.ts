import { test, expect, Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Linked Values System — Phase 4 end-to-end (plan §5 Phase 4 exit criteria):
//   create a binding -> it shows as a read-only badged derived cell -> it
//   recomputes live when its source changes -> clear it -> undo/redo.
//
// Exercises the dev/test affordance (context menu "Bind Total (dev)"), which
// binds a row's total to the nearest preceding bindable row as a `lookup`. Uses
// Division 06 template rows (no hardcoded linked-division rows live above Div 03),
// so the bound row's source is the adjacent template row above it.
//
// Self-cleaning: the scratch project is deleted at the end; estimate_bindings rows
// cascade away with it (ON DELETE CASCADE on project_id).
// ---------------------------------------------------------------------------

const DIV = "06-";

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

/** Click-to-select then click-to-edit a grid cell and commit a value (React 19: a
 *  second click enters edit; dblclick never fires). Mirrors the phase3c helper. */
async function editCell(page: Page, cellId: string, inputPrefix: string, value: string) {
  const cell = page.locator(`[id='${cellId}']`);
  await expect(cell).toBeVisible();
  await page.waitForTimeout(400);
  await cell.click();
  await cell.click();
  const input = page.locator(`input[id^='${inputPrefix}-']`);
  await expect(input).toBeVisible();
  await input.press("ControlOrMeta+a");
  await input.pressSequentially(value, { delay: 20 });
  await input.press("Enter");
  await page.waitForTimeout(600);
}

test.describe("Linked Values Phase 4 — bind a cell, recompute live, clear, undo", () => {
  test.use({ actionTimeout: 15000 });
  test.setTimeout(300_000);

  test("create binding -> read-only badged cell -> live recompute -> clear -> undo", async ({ page }) => {
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log(`[BROWSER ERROR] ${msg.text()}`);
    });
    page.on("pageerror", (err) => console.log(`[PAGE ERROR] ${err.message}`));
    page.on("dialog", (dialog) => dialog.accept()); // project-delete confirm in cleanup

    await login(page);

    const projectName = `LV BIND ${Date.now()}`;
    try {
      // ---- Scratch project ---------------------------------------------------
      await page.goto("/projects");
      await page.locator("button:has-text('Initialize Project')").first().click();
      await page.locator("input[placeholder*='Oakridge']").fill(projectName);
      await page.locator("input[placeholder*='Chicago']").fill("lv binding verify");
      // Market Sector is a required <select> — pick the first real option.
      await page.locator("form select").first().selectOption({ index: 1 });
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

      // ---- Pick two adjacent Division-06 template rows (A above B) ------------
      const gridSearch = page.locator("input[placeholder='Search all columns...']");
      await gridSearch.fill(DIV);
      const divCells = page.locator(`[id^='cell-row-${DIV}'][id$='-itemId']`);
      await expect(divCells.first()).toBeVisible();
      const ids = await divCells.evaluateAll((els) => els.map((el) => el.id));
      expect(ids.length, "need at least two Division 06 rows").toBeGreaterThanOrEqual(2);
      const keyA = ids[0].replace("cell-", "").replace("-itemId", "");
      const keyB = ids[1].replace("cell-", "").replace("-itemId", "");
      console.log(`Source row A: ${keyA} ; target row B: ${keyB}`);

      // ---- Give A a known total: 4 x $25 = $100 ------------------------------
      await editCell(page, `cell-${keyA}-matchedQty`, "qty-input", "4");
      await expect(page.locator(`[id='cell-${keyA}-matchedQty']`)).toContainText("4.00");
      await editCell(page, `cell-${keyA}-unitPrice`, "price-input", "25");
      await expect(page.locator(`[id='cell-${keyA}-total']`)).toContainText("$100.00");

      // ---- Create the binding on B via the dev context-menu affordance --------
      const descB = page.locator(`[id='cell-${keyB}-description']`);
      const totalB = page.locator(`[id='cell-${keyB}-total']`);
      const bindB = async () => {
        await descB.click({ button: "right" });
        await page.locator("[data-testid='ctx-bind-total']").click();
      };
      const heading = page.locator("h3:has-text('Takeoff Workbook')");

      await bindB();
      // B is now a read-only DERIVED cell: badge present + mirrors A's $100.
      await expect(page.getByTestId("binding-badge")).toHaveCount(1);
      await expect(totalB).toContainText("$100.00");
      // Read-only: B's unit-price cell must not open an editor (two clicks = edit on a
      // normal cell; a hard-locked bound cell stays display-only).
      const priceB = page.locator(`[id='cell-${keyB}-unitPrice']`);
      await priceB.click();
      await priceB.click();
      await expect(page.locator("input[id^='price-input-']")).toHaveCount(0);

      // ---- Undo the create (SET_BINDING is top of the undo stack) -------------
      await heading.click(); // blur any focused input first
      await page.keyboard.press("Control+z");
      await expect(page.getByTestId("binding-badge")).toHaveCount(0);
      await expect(totalB).toContainText("$0.00");

      // ---- Re-create the binding, then prove LIVE recompute ------------------
      await bindB();
      await expect(page.getByTestId("binding-badge")).toHaveCount(1);
      await expect(totalB).toContainText("$100.00");
      await editCell(page, `cell-${keyA}-unitPrice`, "price-input", "50"); // 4 x $50 = $200
      await expect(page.locator(`[id='cell-${keyA}-total']`)).toContainText("$200.00");
      await expect(totalB).toContainText("$200.00");

      // ---- Clear the binding -> B reverts to its own ($0) --------------------
      await descB.click({ button: "right" });
      await page.locator("[data-testid='ctx-clear-binding']").click();
      await expect(page.getByTestId("binding-badge")).toHaveCount(0);
      await expect(totalB).toContainText("$0.00");

      // ---- Undo the clear (CLEAR_BINDING is top) -> restored, mirrors $200 ---
      await heading.click();
      await page.keyboard.press("Control+z");
      await expect(page.getByTestId("binding-badge")).toHaveCount(1);
      await expect(totalB).toContainText("$200.00");
    } finally {
      // ---- Cleanup: delete scratch project (bindings cascade away) -----------
      await page.goto("/projects");
      const projectRow = page.locator("tr", { hasText: projectName });
      if (await projectRow.isVisible().catch(() => false)) {
        await projectRow.locator("button:has-text('Delete')").click();
        await expect(projectRow).not.toBeVisible({ timeout: 15000 });
        console.log(`Scratch project "${projectName}" deleted`);
      }
    }
  });
});
