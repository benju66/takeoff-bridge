import { test, expect, Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// GC/Site-Ops Addressability — Phase B5 end-to-end: validated one-off lines (D1).
//
// Proves the escape hatch end to end on Step 3 in a SINGLE grid mount (kept short to beat
// the known local session-refresh flake — see the B2/B3/B4 closures):
//   - add a project-specific ONE-OFF line (a generic manual entry NOT in the catalog);
//   - it shows the "⚠ Assign code" affordance (the visible NOT-exportable state — an uncoded
//     one-off is blocked from export, proven exhaustively in oneOffSectionLines.test.ts);
//   - assign a valid Procore code in the row → the code replaces the affordance (exportable);
//   - Ctrl+Z reverses the assign (ASSIGN_ONE_OFF_CODE), a second Ctrl+Z reverses the add
//     (ADD_ONE_OFF_LINE) — the undoable command pair.
//
// The dollar-level export gate (uncoded blocked / coded ok / default $0.00) is unit-tested;
// this e2e proves the interactive grid + undo path. Self-cleaning.
// The grid is virtualized (maxHeight 70vh), so the one-off (last row) needs a container scroll.
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

async function scrollGridToBottom(page: Page) {
  await page.locator(".grid-scroll").first().evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(300);
}

test.describe("GC/Site-Ops B5 — validated one-off lines (D1)", () => {
  test.use({ actionTimeout: 15000 });
  test.setTimeout(240_000);

  test("adds a one-off, assigns a Procore code, and undoes both", async ({ page }) => {
    page.on("console", (msg) => { if (msg.type() === "error") console.log(`[BROWSER ERROR] ${msg.text()}`); });
    page.on("pageerror", (err) => console.log(`[PAGE ERROR] ${err.message}`));
    page.on("dialog", (dialog) => dialog.accept());

    await login(page);
    const projectName = `SECTION ONEOFF B5 ${Date.now()}`;
    try {
      // ---- Scratch project (12 months, 10,000 SF) --------------------------------
      await page.goto("/projects");
      await page.locator("button:has-text('Initialize Project')").first().click();
      await page.locator("input[placeholder*='Oakridge']").fill(projectName);
      await page.locator("input[placeholder*='Chicago']").fill("b5 verify");
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

      // ---- Add a $7,000 lump-sum one-off via the title-bar form ------------------
      await page.locator("[data-testid='add-one-off-trigger']").click();
      await page.locator("[data-testid='one-off-description']").fill("E2E One-off Fee");
      await page.locator("[data-testid='one-off-kind']").selectOption("lumpSum");
      await page.locator("[data-testid='one-off-value']").fill("7000");
      await page.locator("[data-testid='one-off-submit']").click();

      // ---- Uncoded → the "Assign code" affordance is shown (NOT exportable) -------
      await scrollGridToBottom(page);
      await expect(page.locator("[data-testid='one-off-assign']")).toBeVisible({ timeout: 10000 });

      // ---- Assign a valid Procore code in the row's Code cell (exportable) --------
      await page.locator("[data-testid='one-off-assign']").click();
      await page.locator("[data-testid='one-off-code-input']").fill("2-29010.000");
      await page.locator("[data-testid='one-off-code-confirm']").click();
      await expect(page.locator("[data-testid='one-off-assign']")).toHaveCount(0, { timeout: 10000 });
      await expect(page.getByText("2-29010.000").first()).toBeVisible({ timeout: 10000 });

      // ---- Ctrl+Z reverses the assign → the row is uncoded again ------------------
      await page.keyboard.press("Control+z");
      await expect(page.locator("[data-testid='one-off-assign']")).toBeVisible({ timeout: 10000 });

      // ---- Ctrl+Z reverses the add → the one-off leaves the grid ------------------
      await page.keyboard.press("Control+z");
      await expect(page.locator("[data-testid='one-off-assign']")).toHaveCount(0, { timeout: 10000 });
    } finally {
      // ---- Cleanup: delete the scratch project -----------------------------------
      await page.goto("/projects");
      const row = page.locator("tr", { hasText: projectName });
      if (await row.isVisible().catch(() => false)) {
        await row.locator("button:has-text('Delete')").click();
        await expect(row).not.toBeVisible({ timeout: 15000 });
      }
    }
  });
});
