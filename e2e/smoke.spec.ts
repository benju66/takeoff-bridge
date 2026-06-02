import { test, expect } from "@playwright/test";

test.describe("Takeoff Bridge E2E Smoke Suite", () => {
  test("Complete user flow: login -> dashboard -> project load -> math cell edit", async ({ page }) => {
    // Enable browser console log forwarding for debug visibility
    page.on("console", msg => {
      console.log(`[BROWSER CONSOLE] ${msg.type().toUpperCase()}: ${msg.text()}`);
    });

    // 1. Load root
    await page.goto("/");
    
    // Allow a small delay for Next.js hydration and redirect checks
    await page.waitForTimeout(2000);

    // If redirected to login, perform manual input submission
    if (page.url().includes("/login")) {
      console.log("Auto-login not finished/triggered. Performing manual credentials submission...");
      const email = process.env.NEXT_PUBLIC_DEV_EMAIL || "burness@fpcinc.com";
      const password = process.env.NEXT_PUBLIC_DEV_PASSWORD || "BuildIt2026!!";
      
      await expect(page.locator("input[type='email']")).toBeVisible();
      await page.locator("input[type='email']").fill(email);
      await page.locator("input[type='password']").fill(password);
      await page.locator("button:has-text('Access Terminal')").click();
    }

    // Wait for URL navigation to /projects
    await page.waitForURL("**/projects", { timeout: 15000 });
    
    // Verify Dashboard header is visible
    const portalHeader = page.locator("h1");
    await expect(portalHeader).toContainText("TAKEOFF PORTAL");

    // 2. Check if projects exist, initialize a new project if empty
    const launchButton = page.locator("a:has-text('Launch')").first();
    const isLaunchVisible = await launchButton.isVisible();

    if (!isLaunchVisible) {
      console.log("No projects found, initializing a new test project...");
      await page.locator("button:has-text('Initialize Project')").first().click();
      
      // Wait for modal and fill fields
      await page.locator("input[placeholder*='Oakridge']").fill("Smoke Test Project");
      await page.locator("input[placeholder*='Chicago']").fill("Local Dev Machine");
      await page.locator("input[placeholder*='145000']").fill("5000");
      await page.locator("input[placeholder*='120']").fill("10");
      
      // Submit form
      await page.locator("button:has-text('Create Node')").click();
      
      // Wait for table to populate
      await expect(launchButton).toBeVisible({ timeout: 10000 });
    }

    // 3. Launch project workspace
    await launchButton.click();
    await page.waitForURL("**/projects/*", { timeout: 10000 });

    // Verify collapsible Sidebar is visible
    const sidebar = page.locator("aside");
    await expect(sidebar).toBeVisible();

    // 4. Navigate to Step 4 (Estimate) via Sidebar link
    const estimateLink = page.locator("aside a:has-text('Estimate')");
    await expect(estimateLink).toBeVisible();
    await estimateLink.click();
    
    // Verify query parameter step=step4 is set
    await page.waitForURL("**/projects/*?step=step4", { timeout: 10000 });

    // Verify spreadsheet is rendered
    const workbookTitle = page.locator("h3:has-text('Takeoff Workbook')");
    await expect(workbookTitle).toBeVisible();

    // 5. Interact with Estimate Spreadsheet (cell edit math parser check)
    // Find the first quantity cell in the list
    const firstQtyCell = page.locator("[id$='-matchedQty']").first();
    await expect(firstQtyCell).toBeVisible();

    const originalText = await firstQtyCell.innerText();
    console.log(`Original Quantity: ${originalText}`);

    // Click the cell once to select it, then double click to enter editing mode
    await firstQtyCell.click();
    await firstQtyCell.dblclick();

    // The NumberCellInput input field should appear with id qty-input-*
    const qtyInput = page.locator("input[id^='qty-input-']");
    await expect(qtyInput).toBeVisible();

    // Type dynamic math equation: = 15 * 6
    await qtyInput.fill("= 15 * 6");
    await qtyInput.press("Enter");

    // The input should unmount and the cell should now display 90.00 (re-evaluated formula)
    await expect(firstQtyCell).toContainText("90.00");
    console.log("E2E math parsing verified successfully!");
  });
});
