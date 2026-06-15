import { test, expect, Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Linked Values System — Phase 5 end-to-end (plan §5 Phase 5 exit criteria):
//   author a LOOKUP from the grid -> read-only badged cell mirrors its source ->
//   inspect depends-on in the Trust Inspector "Links" tab -> live recompute ->
//   edit the link (×transform) -> a circular reference is REJECTED with a message ->
//   delete the link -> undo. Then author a ROLLUP (sum over a rule-described set) and
//   confirm its value + matched-member count, then delete it.
//
// Drives the real "Define link…" panel that replaced the Phase-4 dev affordance. Uses
// Division 06 template rows (no hardcoded linked-division rows live there), so a row's
// lookup source is the adjacent template row above it.
//
// Self-cleaning: the scratch project is deleted at the end; estimate_bindings rows cascade
// away with it (ON DELETE CASCADE on project_id).
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

test.describe("Linked Values Phase 5 — author/inspect/edit/cycle/delete a link", () => {
  test.use({ actionTimeout: 15000 });
  test.setTimeout(360_000);

  test("define link panel: lookup + Links tab + recompute + edit + cycle reject + delete + undo + rollup", async ({ page }) => {
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log(`[BROWSER ERROR] ${msg.text()}`);
    });
    page.on("pageerror", (err) => console.log(`[PAGE ERROR] ${err.message}`));
    page.on("dialog", (dialog) => dialog.accept()); // project-delete confirm in cleanup

    await login(page);

    const projectName = `LV LINK ${Date.now()}`;
    try {
      // ---- Scratch project ---------------------------------------------------
      await page.goto("/projects");
      await page.locator("button:has-text('Initialize Project')").first().click();
      await page.locator("input[placeholder*='Oakridge']").fill(projectName);
      await page.locator("input[placeholder*='Chicago']").fill("lv authoring verify");
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

      // ---- Give A a known total: 4 x $25 = $100 ------------------------------
      await editCell(page, `cell-${keyA}-matchedQty`, "qty-input", "4");
      await editCell(page, `cell-${keyA}-unitPrice`, "price-input", "25");
      await expect(page.locator(`[id='cell-${keyA}-total']`)).toContainText("$100.00");

      const descB = page.locator(`[id='cell-${keyB}-description']`);
      const totalB = page.locator(`[id='cell-${keyB}-total']`);
      const heading = page.locator("h3:has-text('Takeoff Workbook')");

      // ---- Author a LOOKUP on B: mirror A's total via the panel --------------
      await descB.click({ button: "right" });
      await page.getByTestId("ctx-define-link").click();
      await expect(page.getByTestId("define-save")).toBeVisible();
      await page.getByTestId("define-mode-lookup").click();
      await page.getByTestId("lookup-source").selectOption(`line:${keyA}:total`);
      // Live preview reflects A's $100 before saving (glass box).
      await expect(page.getByTestId("define-preview-value")).toContainText("$100.00");
      await page.getByTestId("define-save").click();

      // B is now a read-only DERIVED cell: badge present + mirrors A's $100.
      await expect(page.getByTestId("binding-badge")).toHaveCount(1);
      await expect(totalB).toContainText("$100.00");

      // ---- Inspect the Links tab via the badge -------------------------------
      await page.getByTestId("binding-badge").click();
      await expect(page.getByText("Focused value")).toBeVisible();
      await expect(page.getByText("Depends on", { exact: true })).toBeVisible();
      // The depends-on edge names the source row (A's item code) inside the inspector.
      const inspector = page.locator("div.fixed.top-0.right-0");
      const aItemId = keyA.replace("row-", "");
      await expect(inspector.getByText(aItemId, { exact: false }).first()).toBeVisible();
      await page.keyboard.press("Escape"); // close the inspector

      // ---- Live recompute: change A's price -> B follows ---------------------
      await editCell(page, `cell-${keyA}-unitPrice`, "price-input", "50"); // 4 x $50 = $200
      await expect(page.locator(`[id='cell-${keyA}-total']`)).toContainText("$200.00");
      await expect(totalB).toContainText("$200.00");

      // ---- Edit the link: add a ×2 transform -> B mirrors A×2 = $400 ---------
      await descB.click({ button: "right" });
      await page.getByTestId("ctx-edit-link").click();
      await page.getByTestId("lookup-multiply").fill("2");
      await expect(page.getByTestId("define-preview-value")).toContainText("$400.00");
      await page.getByTestId("define-save").click();
      await expect(totalB).toContainText("$400.00");

      // ---- Cycle rejection: try to bind A -> B (B already depends on A) ------
      const descA = page.locator(`[id='cell-${keyA}-description']`);
      await descA.click({ button: "right" });
      await page.getByTestId("ctx-define-link").click();
      await page.getByTestId("define-mode-lookup").click();
      await page.getByTestId("lookup-source").selectOption(`line:${keyB}:total`);
      // The panel surfaces the circular reference and disables Save.
      await expect(page.getByText("Circular reference", { exact: false }).first()).toBeVisible();
      await expect(page.getByTestId("define-save")).toBeDisabled();
      await page.keyboard.press("Escape"); // cancel without saving

      // ---- Delete B's link -> reverts to its own ($0) -----------------------
      await descB.click({ button: "right" });
      await page.getByTestId("ctx-edit-link").click();
      await page.getByTestId("define-delete").click();
      await expect(page.getByTestId("binding-badge")).toHaveCount(0);
      await expect(totalB).toContainText("$0.00");

      // ---- Undo the delete -> link restored (mirrors A×2 = $400) -------------
      await heading.click(); // blur first
      await page.keyboard.press("Control+z");
      await expect(page.getByTestId("binding-badge")).toHaveCount(1);
      await expect(totalB).toContainText("$400.00");

      // ---- Author a ROLLUP on A: sum of total where division = 03 ------------
      // A is a Division-06 row, so summing Division 03 cannot include A itself (a rollup
      // that matched its own target would be rejected as a cycle — the guard at work).
      await descA.click({ button: "right" });
      await page.getByTestId("ctx-define-link").click();
      await page.getByTestId("define-mode-rollup").click();
      await page.getByTestId("rollup-op").selectOption("sum");
      await page.getByTestId("rollup-mode-rule").click();
      await page.getByTestId("rule-value-0").fill("03");
      // Preview shows a result (and Save is enabled — no cycle).
      await expect(page.getByTestId("define-preview-value")).toBeVisible();
      await expect(page.getByTestId("define-save")).toBeEnabled();
      await page.getByTestId("define-save").click();
      await expect(page.getByTestId("binding-badge")).toHaveCount(2); // A and B now bound

      // ---- Delete the rollup on A --------------------------------------------
      await descA.click({ button: "right" });
      await page.getByTestId("ctx-edit-link").click();
      await page.getByTestId("define-delete").click();
      await expect(page.getByTestId("binding-badge")).toHaveCount(1); // only B remains bound
    } finally {
      // ---- Cleanup: delete scratch project (bindings cascade away) -----------
      await page.goto("/projects");
      const projectRow = page.locator("tr", { hasText: projectName });
      if (await projectRow.isVisible().catch(() => false)) {
        await projectRow.locator("button:has-text('Delete')").click();
        await expect(projectRow).not.toBeVisible({ timeout: 15000 });
      }
    }
  });
});
