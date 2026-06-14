import { test, expect } from "@playwright/test";

test.describe("Auth E2E (P4)", () => {
  test("should login and access chat", async ({ page }) => {
    // 1. 访问首页
    await page.goto("/");

    // 2. 等待登录页面加载（如果未登录会重定向到登录页）
    await page.waitForLoadState("networkidle");

    // 3. 尝试使用默认凭据登录
    // 注意：这假设数据库中有 admin 用户或使用匿名登录
    const phoneInput = page.locator('input[type="tel"], input[placeholder*="手机"]').first();
    if (await phoneInput.isVisible().catch(() => false)) {
      await phoneInput.fill("13800138000");
      await page.locator('button:has-text("登录"), button:has-text("Login")').first().click();
    }

    // 4. 验证进入聊天页面
    await page.waitForURL("**/chat", { timeout: 10000 });
    await expect(page.locator("text=发送").or(page.locator("text=Send")).first()).toBeVisible();
  });
});
