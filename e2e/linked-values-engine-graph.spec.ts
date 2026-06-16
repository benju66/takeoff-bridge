import { test, expect, Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Linked Values - Bucket B Phase 2 end-to-end (plan section 5 Phase 2 exit criteria):
//   open the Trust Inspector's "Links" tab FROM A SUMMARY CELL and confirm it shows the
//   engine wiring for that value - its real depends-on (the cross-page leaves) - sourced
//   from the read-only engine graph descriptor, with no user bindings authored.
//
// This is the smallest-slice proof from the kickoff: clicking a summary total opens the
// Links tab showing its real inputs. Self-cleaning: the scratch project is deleted at the
// end.
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

test.describe("Linked Values Bucket B Phase 2 - open the Links tab from a summary cell", () => {
  test.use({ actionTimeout: 15000 });
  test.setTimeout(240_000);

  test("summary cell -> Links tab shows the engine depends-on (cross-page leaves)", async ({ page }) => {
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log(`[BROWSER ERROR] ${msg.text()}`);
    });
    page.on("pageerror", (err) => console.log(`[PAGE ERROR] ${err.message}`));
    page.on("dialog", (dialog) => dialog.accept()); // project-delete confirm in cleanup

    await login(page);

    const projectName = `LV ENG ${Date.now()}`;
    try {
      // ---- Scratch project ---------------------------------------------------
      await page.goto("/projects");
      await page.locator("button:has-text('Initialize Project')").first().click();
      await page.locator("input[placeholder*='Oakridge']").fill(projectName);
      await page.locator("input[placeholder*='Chicago']").fill("bucket b verify");
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

      // ---- Open the Links tab from the Subtotal summary cell (its 2nd icon) ----
      // The summary footer renders a SummaryTraceCell per total row; the first one is the
      // Subtotal. Its link affordance opens Trust focused on summary:subtotal, Links tab.
      const linkBtn = page.getByTestId("summary-links").first();
      await expect(linkBtn).toBeVisible({ timeout: 15000 });
      await linkBtn.click();

      const inspector = page.locator("div.fixed.top-0.right-0");
      await expect(inspector).toBeVisible();
      await expect(inspector.getByText("Focused value")).toBeVisible();
      await expect(inspector.getByText("Depends on", { exact: true })).toBeVisible();

      // The engine descriptor wires subtotal <- takeoffSubtotal + linkedDivisionsTotal.
      // describeSourceNode labels them with friendly names ("Summary . Takeoff subtotal" /
      // "Summary . Linked divisions total"), so both appear.
      await expect(inspector.getByText("Takeoff subtotal", { exact: false }).first()).toBeVisible();
      await expect(inspector.getByText("Linked divisions", { exact: false }).first()).toBeVisible();
    } finally {
      // ---- Cleanup: delete the scratch project -------------------------------
      await page.goto("/projects");
      const projectRow = page.locator("tr", { hasText: projectName });
      if (await projectRow.isVisible().catch(() => false)) {
        await projectRow.locator("button:has-text('Delete')").click();
        await expect(projectRow).not.toBeVisible({ timeout: 15000 });
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Linked Values - Bucket B Phase 5 end-to-end (the per-cell GC/Site-Ops Links badge):
//   the entry point the architect's visual spot-check was held for. From the SITE-OPS page
//   (STEP 3) click a value's EngineLinkBadge; the page coordinator navigates to STEP 4 and
//   opens the Trust Inspector "Links" tab focused on that engine node, showing its real
//   depends-on (qty + rate) and used-by (its subtotal / section). Self-cleaning.
// ---------------------------------------------------------------------------

test.describe("Linked Values Bucket B Phase 5 - Site-Ops Links badge (cross-step)", () => {
  test.use({ actionTimeout: 15000 });
  test.setTimeout(240_000);

  test("Site-Ops value badge -> STEP 4 Links tab shows the engine depends-on / used-by", async ({ page }) => {
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log(`[BROWSER ERROR] ${msg.text()}`);
    });
    page.on("pageerror", (err) => console.log(`[PAGE ERROR] ${err.message}`));
    page.on("dialog", (dialog) => dialog.accept()); // project-delete confirm in cleanup

    await login(page);

    const projectName = `LV ENG P5 ${Date.now()}`;
    try {
      // ---- Scratch project ---------------------------------------------------
      await page.goto("/projects");
      await page.locator("button:has-text('Initialize Project')").first().click();
      await page.locator("input[placeholder*='Oakridge']").fill(projectName);
      await page.locator("input[placeholder*='Chicago']").fill("bucket b p5 verify");
      await page.locator("form select").first().selectOption({ index: 1 });
      await page.locator("input[placeholder*='145000']").fill("10000");
      await page.locator("input[placeholder*='120']").fill("12");
      await page.locator("button:has-text('Create Node')").click();

      const projectRow = page.locator("tr", { hasText: projectName });
      await expect(projectRow).toBeVisible({ timeout: 15000 });
      await projectRow.locator("a:has-text('Launch')").click();
      await page.waitForURL("**/projects/*", { timeout: 30000 });

      // ---- Go to the Site Operations page (STEP 3) ---------------------------
      await page.locator("aside a:has-text('Site Operations')").click();
      await page.waitForURL("**/projects/*?step=step3", { timeout: 15000 });
      await expect(
        page.locator("h3:has-text('Site Operations Calculation Module')")
      ).toBeVisible({ timeout: 30000 });

      // ---- Click the first engine Links badge (a duration/sqft-driven leaf is non-zero) --
      const badge = page.getByTestId("engine-inspect").first();
      await expect(badge).toBeVisible({ timeout: 15000 });
      await badge.click();

      // The coordinator navigates to STEP 4 where the inspector lives.
      await page.waitForURL("**/projects/*?step=step4", { timeout: 15000 });

      const inspector = page.locator("div.fixed.top-0.right-0");
      await expect(inspector).toBeVisible();
      await expect(inspector.getByText("Focused value")).toBeVisible();
      // Focused on a STEP 3 engine node (labelled "STEP 3 . <name>").
      await expect(inspector.getByText("STEP 3", { exact: false }).first()).toBeVisible();
      // A Site-Ops leaf total depends on its qty + rate (the engine wiring), and is used by
      // its parameter-driven subtotal.
      await expect(inspector.getByText("Depends on", { exact: true })).toBeVisible();
      await expect(inspector.getByText("Used by", { exact: true })).toBeVisible();
      await expect(inspector.getByText("(qty)", { exact: false }).first()).toBeVisible();
      await expect(inspector.getByText("(rate)", { exact: false }).first()).toBeVisible();
    } finally {
      // ---- Cleanup: delete the scratch project -------------------------------
      await page.goto("/projects");
      const projectRow = page.locator("tr", { hasText: projectName });
      if (await projectRow.isVisible().catch(() => false)) {
        await projectRow.locator("button:has-text('Delete')").click();
        await expect(projectRow).not.toBeVisible({ timeout: 15000 });
      }
    }
  });
});