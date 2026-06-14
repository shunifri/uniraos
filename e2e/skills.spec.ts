import { test, expect } from "@playwright/test";

test.describe("Skills E2E (P4)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // 如果登录页出现，使用匿名登录
    const phoneInput = page.locator('input[type="tel"], input[placeholder*="手机"]').first();
    if (await phoneInput.isVisible().catch(() => false)) {
      await phoneInput.fill("13800138000");
      await page.locator('button:has-text("登录"), button:has-text("Login")').first().click();
      await page.waitForURL("**/chat", { timeout: 10000 });
    }
  });

  test("should navigate to skills page", async ({ page }) => {
    // 1. 点击 Skills 菜单
    const skillsLink = page.locator('a:has-text("Skills"), a:has-text("技能"), [data-testid="nav-skills"]').first();
    if (await skillsLink.isVisible().catch(() => false)) {
      await skillsLink.click();
      await page.waitForURL("**/skills", { timeout: 10000 });
      await expect(page.locator("body")).toContainText("Skill");
    }
  });
});
