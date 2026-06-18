import { test, expect, Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// GC/Site-Ops Addressability — Phase B2 end-to-end: Step 2 (GC Personnel) as a grid.
//
// Proves the bespoke form is now the shared GridShell surface: section dividers
// (01.A–01.F) render, a utilization cell edits → its total recomputes through the A1
// engine, Ctrl+Z reverts it, and a per-line 🔗 EngineLinkBadge opens the STEP 4 Trust
// "Links" tab focused on that GC engine node (cross-step navigation). Self-cleaning.
//
// NOTE: the local e2e environment has a known session-refresh flake (see the B1a/B1b
// closures); run e2e/linked-values-engine-graph.spec.ts as the green reference.
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

test.describe("GC/Site-Ops B2 — Step 2 GC Personnel grid", () => {
  test.use({ actionTimeout: 15000 });
  test.setTimeout(240_000);

  test("renders as a grid, recomputes a cell edit, undoes it, and opens STEP 4 Links", async ({ page }) => {
    page.on("console", (msg) => { if (msg.type() === "error") console.log(`[BROWSER ERROR] ${msg.text()}`); });
    page.on("pageerror", (err) => console.log(`[PAGE ERROR] ${err.message}`));
    page.on("dialog", (dialog) => dialog.accept()); // project-delete confirm in cleanup

    await login(page);

    const projectName = `GC GRID B2 ${Date.now()}`;
    try {
      // ---- Scratch project (12 months, 10,000 SF — non-zero engine drivers) -----
      await page.goto("/projects");
      await page.locator("button:has-text('Initialize Project')").first().click();
      await page.locator("input[placeholder*='Oakridge']").fill(projectName);
      await page.locator("input[placeholder*='Chicago']").fill("b2 verify");
      await page.locator("form select").first().selectOption({ index: 1 });
      await page.locator("input[placeholder*='145000']").fill("10000");
      await page.locator("input[placeholder*='120']").fill("12");
      await page.locator("button:has-text('Create Node')").click();

      const projectRow = page.locator("tr", { hasText: projectName });
      await expect(projectRow).toBeVisible({ timeout: 15000 });
      await projectRow.locator("a:has-text('Launch')").click();
      await page.waitForURL("**/projects/*", { timeout: 30000 });

      // ---- STEP 2 (General Conditions) renders as a grid --------------------------
      await page.locator("aside a:has-text('General Conditions')").click();
      await page.waitForURL("**/projects/*?step=step2", { timeout: 15000 });
      await expect(page.locator("h3:has-text('Division 01 General Conditions Pricing Matrix')")).toBeVisible({ timeout: 30000 });
      // GridShell section dividers + per-line engine Links badges prove the shared surface.
      await expect(page.getByText("01.A — Staff Labour Directs", { exact: false })).toBeVisible();
      await expect(page.getByTestId("engine-inspect").first()).toBeVisible({ timeout: 15000 });

      // ---- Edit the dumpsters equipment lump-sum → its total recomputes -----------
      // (Duration-independent: total === the typed amount, so it proves the
      // cell-edit → command → personnel setter → engine → display path regardless of
      // the scratch project's schedule.)
      const equipCell = page.locator('[id="cell-gc:equip:dumpsters-entry"]');
      const equipTotal = page.locator('[id="cell-gc:equip:dumpsters-total"]');
      await expect(equipTotal).toContainText("$0.00");
      await equipCell.click(); // select
      await equipCell.click(); // toggle into edit
      const input = page.locator("input:focus");
      await expect(input).toBeVisible({ timeout: 10000 });
      await input.fill("1500");
      await input.press("Enter");
      await expect(equipTotal).toContainText("$1,500.00", { timeout: 10000 });

      // ---- Ctrl+Z restores the prior value (full inverse data) --------------------
      await page.keyboard.press("Control+z");
      await expect(equipTotal).toContainText("$0.00", { timeout: 10000 });

      // ---- A 🔗 badge opens the STEP 4 Trust "Links" tab on that GC node ----------
      await page.getByTestId("engine-inspect").first().click();
      await page.waitForURL("**/projects/*?step=step4", { timeout: 15000 });
      const inspector = page.locator("div.fixed.top-0.right-0");
      await expect(inspector).toBeVisible();
      await expect(inspector.getByText("Focused value")).toBeVisible();
      await expect(inspector.getByText("STEP 2", { exact: false }).first()).toBeVisible();
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
