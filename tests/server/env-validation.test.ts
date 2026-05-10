import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("validateEnvOrExit", () => {
  const originalEnv = process.env;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: "production" };
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    vi.resetModules();
  });

  it("should exit when required env vars are missing", async () => {
    delete (process.env as any).JWT_SECRET;
    delete (process.env as any).MYSQL_PASSWORD;

    const { validateEnvOrExit } = await import("../../src/server/env-validation.js");
    validateEnvOrExit();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("should exit when placeholder values are used", async () => {
    process.env.JWT_SECRET = "__REPLACE_IN_PRODUCTION__";
    process.env.MYSQL_PASSWORD = "good_password_1";
    process.env.MINIO_PASSWORD = "good_password_2";
    process.env.RABBITMQ_PASS = "good_password_3";
    process.env.LLM_API_KEY = "good_password_4";

    const { validateEnvOrExit } = await import("../../src/server/env-validation.js");
    validateEnvOrExit();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("should exit when JWT_SECRET is too short", async () => {
    process.env.JWT_SECRET = "short";
    process.env.MYSQL_PASSWORD = "good_password_1";
    process.env.MINIO_PASSWORD = "good_password_2";
    process.env.RABBITMQ_PASS = "good_password_3";
    process.env.LLM_API_KEY = "good_password_4";

    const { validateEnvOrExit } = await import("../../src/server/env-validation.js");
    validateEnvOrExit();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("should pass when all required env vars are set", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "a".repeat(32);
    process.env.MYSQL_PASSWORD = "MyS3cr3t!";
    process.env.MINIO_PASSWORD = "MnS3cr3t!";
    process.env.RABBITMQ_PASS = "RbS3cr3t!";
    process.env.LLM_API_KEY = "sk-abc123xyz789";
    delete (process.env as any).REDIS_PASSWORD;
    delete (process.env as any).OPENAI_API_KEY;
    delete (process.env as any).NEO4J_PASSWORD;
    delete (process.env as any).DOCMIND_ACCESS_KEY_ID;

    const { validateEnvOrExit } = await import("../../src/server/env-validation.js");
    validateEnvOrExit();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("should skip validation in non-production", async () => {
    process.env.NODE_ENV = "development";
    delete (process.env as any).JWT_SECRET;

    const { validateEnvOrExit } = await import("../../src/server/env-validation.js");
    validateEnvOrExit();

    expect(exitSpy).not.toHaveBeenCalled();
  });
});
