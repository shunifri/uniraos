import { defineConfig, devices } from "@playwright/test";

/**
 * RAOS 前后端联合 E2E 测试配置
 *
 * 运行前请确保：
 * 1. 后端服务运行在 http://localhost:3000
 * 2. 前端服务运行在 http://localhost:9002
 *
 * 或使用 webServer 自动启动（见下方注释）
 */

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:9002",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
  ],

  // 自动启动服务（取消注释以启用）
  // webServer: [
  //   {
  //     command: "npm run dev",
  //     url: "http://localhost:3000/api/health",
  //     reuseExistingServer: !process.env.CI,
  //     timeout: 120_000,
  //   },
  //   {
  //     command: "cd web && npm run dev",
  //     url: "http://localhost:9002",
  //     reuseExistingServer: !process.env.CI,
  //     timeout: 120_000,
  //   },
  // ],
});
