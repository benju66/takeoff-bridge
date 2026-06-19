import { test, expect, Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// GC/Site-Ops Addressability — Phase B3 end-to-end: Step 3 (Site Operations) as a grid.
//
// Proves the bespoke form is now the shared GridShell surface: section dividers
// (02.A–02.H) render, a manual lump-sum cell edits → its total recomputes through the
// A1 engine, Ctrl+Z reverts it, and a per-line 🔗 EngineLinkBadge opens the STEP 4 Trust
// "Links" tab focused on that Site-Ops engine node (cross-step navigation). Self-cleaning.
//
// NOTE: the local e2e environment has a known session-refresh flake (see the B1a/B1b/B2
// closures); run e2e/linked-values-engine-graph.spec.ts as the green reference.
//
// Edits a lump-sum line (FFE Relocation): the typed dollar amount IS the total, so it is
// duration/sqft-independent and proves the cell-edit → command → infrastructure setter →
// engine → display path regardless of the scratch project's schedule.
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

test.describe("GC/Site-Ops B3 — Step 3 Site Operations grid", () => {
  test.use({ actionTimeout: 15000 });
  test.setTimeout(240_000);

  test("renders as a grid, recomputes a cell edit, undoes it, and opens STEP 4 Links", async ({ page }) => {
    page.on("console", (msg) => { if (msg.type() === "error") console.log(`[BROWSER ERROR] ${msg.text()}`); });
    page.on("pageerror", (err) => console.log(`[PAGE ERROR] ${err.message}`));
    page.on("dialog", (dialog) => dialog.accept()); // project-delete confirm in cleanup

    await login(page);

    const projectName = `SITE OPS GRID B3 ${Date.now()}`;
    try {
      // ---- Scratch project (12 months, 10,000 SF — non-zero engine drivers) -----
      await page.goto("/projects");
      await page.locator("button:has-text('Initialize Project')").first().click();
      await page.locator("input[placeholder*='Oakridge']").fill(projectName);
      await page.locator("input[placeholder*='Chicago']").fill("b3 verify");
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
      // GridShell section dividers + per-line engine Links badges prove the shared surface.
      await expect(page.getByText("02.A — Site Operations", { exact: false })).toBeVisible();
      await expect(page.getByTestId("engine-inspect").first()).toBeVisible({ timeout: 15000 });
      // Template column layout: Quantity · Unit · Rate · Total · Cost/S.F.
      await expect(page.getByText("Cost/S.F.", { exact: false }).first()).toBeVisible();

      // ---- Edit the FFE Relocation lump amount (in Rate) → its total recomputes -----
      // A lump-sum line carries Quantity 1 and the dollar amount in the Rate column.
      const entryCell = page.locator('[id="cell-siteops:manual:ffeRelocation-rate"]');
      const totalCell = page.locator('[id="cell-siteops:manual:ffeRelocation-total"]');
      await expect(totalCell).toContainText("$0.00");
      await entryCell.click(); // select
      await entryCell.click(); // toggle into edit
      const input = page.locator("input:focus");
      await expect(input).toBeVisible({ timeout: 10000 });
      await input.fill("5000");
      await input.press("Enter");
      await expect(totalCell).toContainText("$5,000.00", { timeout: 10000 });

      // ---- Ctrl+Z restores the prior value (full inverse data) --------------------
      await page.keyboard.press("Control+z");
      await expect(totalCell).toContainText("$0.00", { timeout: 10000 });

      // ---- Override a duration-driven Quantity (locked → unlock via context menu) --
      // Safety (02-9015.001) is duration-driven, so its Quantity is derived/locked. The
      // estimator right-clicks → "Override quantity" → types a value → an audited override
      // (the ⚑) records; clicking the ⚑ reverts to the computed quantity.
      const safetyQty = page.locator('[id="cell-siteops:dynamic:02-9015.001-quantity"]');
      await safetyQty.click({ button: "right" });
      const overrideBtn = page.getByRole("button", { name: "Override quantity" });
      await expect(overrideBtn).toBeVisible({ timeout: 10000 });
      await overrideBtn.click();
      // The locked cell unlocks into an editable input (located by id, then `fill` focuses it).
      const qtyInput = page.locator('[id^="quantity-input"]');
      await expect(qtyInput).toBeVisible({ timeout: 10000 });
      await qtyInput.fill("24");
      await qtyInput.press("Enter");
      await expect(page.getByTestId("section-qty-override-flag")).toBeVisible({ timeout: 10000 });
      // Revert via the ⚑ → the override clears.
      await page.getByTestId("section-qty-override-flag").click();
      await expect(page.getByTestId("section-qty-override-flag")).toHaveCount(0, { timeout: 10000 });

      // ---- A 🔗 badge opens the STEP 4 Trust "Links" tab on that Site-Ops node ----
      await page.getByTestId("engine-inspect").first().click();
      await page.waitForURL("**/projects/*?step=step4", { timeout: 15000 });
      const inspector = page.locator("div.fixed.top-0.right-0");
      await expect(inspector).toBeVisible();
      await expect(inspector.getByText("Focused value")).toBeVisible();
      await expect(inspector.getByText("STEP 3", { exact: false }).first()).toBeVisible();
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
