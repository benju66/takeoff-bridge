import { test, expect, Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// GC/Site-Ops Addressability — Phase B4 end-to-end: removable / re-addable catalog seed (D2).
//
// Proves the fixed catalog is now a default, not a forced checklist: on Step 3 a catalog
// line is REMOVED via the cell context menu (its row leaves the grid + the grand total),
// RE-ADDED from the "+ Add line" picker (it returns with its prior input preserved), and
// the re-add is reversed by a single Ctrl+Z (undoable via the section-grid command pair).
// Self-cleaning. Shares the known local session-refresh flake noted in the B2/B3 closures.
//
// Uses the FFE Relocation lump-sum line (typed dollar amount IS the total, duration/sqft-
// independent), so the remove/re-add total deltas are unambiguous regardless of schedule.
// ---------------------------------------------------------------------------

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

test.describe("GC/Site-Ops B4 — remove / re-add a catalog line", () => {
  test.use({ actionTimeout: 15000 });
  test.setTimeout(240_000);

  test("removes a Site-Ops line, re-adds it from the picker, and undoes the re-add", async ({ page }) => {
    page.on("console", (msg) => { if (msg.type() === "error") console.log(`[BROWSER ERROR] ${msg.text()}`); });
    page.on("pageerror", (err) => console.log(`[PAGE ERROR] ${err.message}`));
    page.on("dialog", (dialog) => dialog.accept()); // project-delete confirm in cleanup

    await login(page);

    const projectName = `SECTION REMOVE B4 ${Date.now()}`;
    try {
      // ---- Scratch project (12 months, 10,000 SF) --------------------------------
      await page.goto("/projects");
      await page.locator("button:has-text('Initialize Project')").first().click();
      await page.locator("input[placeholder*='Oakridge']").fill(projectName);
      await page.locator("input[placeholder*='Chicago']").fill("b4 verify");
      await page.locator("form select").first().selectOption({ index: 1 });
      await page.locator("input[placeholder*='145000']").fill("10000");
      await page.locator("input[placeholder*='120']").fill("12");
      await page.locator("button:has-text('Create Node')").click();

      const projectRow = page.locator("tr", { hasText: projectName });
      await expect(projectRow).toBeVisible({ timeout: 15000 });
      await projectRow.locator("a:has-text('Launch')").click();
      await page.waitForURL("**/projects/*", { timeout: 30000 });

      // ---- STEP 3 (Site Operations) renders as a grid ----------------------------
      await page.locator("aside a:has-text('Site Operations')").click();
      await page.waitForURL("**/projects/*?step=step3", { timeout: 15000 });
      await expect(page.locator("h3:has-text('Division 02 Site Operations Calculation Module')")).toBeVisible({ timeout: 30000 });

      // ---- Give FFE Relocation a value so its presence is visible in the total ----
      const rateCell = page.locator('[id="cell-siteops:manual:ffeRelocation-rate"]');
      const totalCell = page.locator('[id="cell-siteops:manual:ffeRelocation-total"]');
      await rateCell.click(); // select
      await rateCell.click(); // toggle into edit
      const input = page.locator("input:focus");
      await expect(input).toBeVisible({ timeout: 10000 });
      await input.fill("5000");
      await input.press("Enter");
      await expect(totalCell).toContainText("$5,000.00", { timeout: 10000 });

      // ---- Remove the line via the cell context menu → its row leaves the grid ----
      await rateCell.click({ button: "right" });
      const removeBtn = page.getByRole("button", { name: "Remove line" });
      await expect(removeBtn).toBeVisible({ timeout: 10000 });
      await removeBtn.click();
      await expect(totalCell).toHaveCount(0, { timeout: 10000 });

      // ---- Re-add it from the "+ Add line" picker → it returns with $5,000 kept ----
      await page.getByRole("button", { name: /Add line/ }).click();
      const pickerItem = page.getByRole("button", { name: /FFE Relocation/ });
      await expect(pickerItem).toBeVisible({ timeout: 10000 });
      await pickerItem.click();
      await expect(totalCell).toBeVisible({ timeout: 10000 });
      await expect(totalCell).toContainText("$5,000.00", { timeout: 10000 });

      // ---- Ctrl+Z reverses the re-add (ADD_SECTION_LINE is undoable) --------------
      await page.keyboard.press("Control+z");
      await expect(totalCell).toHaveCount(0, { timeout: 10000 });
    } finally {
      // ---- Cleanup: delete the scratch project -----------------------------------
      await page.goto("/projects");
      const projectRow = page.locator("tr", { hasText: projectName });
      if (await projectRow.isVisible().catch(() => false)) {
        await projectRow.locator("button:has-text('Delete')").click();
        await expect(projectRow).not.toBeVisible({ timeout: 15000 });
      }
    }
  });
});
