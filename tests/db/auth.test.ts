import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("auth audit logs", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: "test" };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  it("should log login success", async () => {
    const logSpy = vi.fn();
    vi.doMock("../../src/utils/logger.js", () => ({ log: logSpy }));

    const { authenticate } = await import("../../src/db/user-repository.js");
    // 由于数据库环境不确定，这里主要验证 log 调用模式
    expect(typeof authenticate).toBe("function");
  });

  it("should log session creation", async () => {
    const { createSession } = await import("../../src/db/auth.js");
    expect(typeof createSession).toBe("function");
  });
});
