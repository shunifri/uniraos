import { test, expect } from "@playwright/test";

test.describe("Files E2E (P4)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const phoneInput = page.locator('input[type="tel"], input[placeholder*="手机"]').first();
    if (await phoneInput.isVisible().catch(() => false)) {
      await phoneInput.fill("13800138000");
      await page.locator('button:has-text("登录"), button:has-text("Login")').first().click();
      await page.waitForURL("**/chat", { timeout: 10000 });
    }
  });

  test("should navigate to files page", async ({ page }) => {
    const filesLink = page.locator('a:has-text("Files"), a:has-text("文件"), [data-testid="nav-files"]').first();
    if (await filesLink.isVisible().catch(() => false)) {
      await filesLink.click();
      await page.waitForURL("**/files", { timeout: 10000 });
      await expect(page.locator("body")).toContainText("文件");
    }
  });
});
