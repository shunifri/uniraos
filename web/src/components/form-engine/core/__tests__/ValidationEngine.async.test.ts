import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { validateFieldAsync, debouncedAsyncValidate } from "../ValidationEngine";
import type { RaosFieldSchema } from "../../types";

describe("Async Validation", () => {
  let originalLang: string;

  beforeAll(() => {
    originalLang = navigator.language;
    Object.defineProperty(navigator, "language", { value: "zh-CN", configurable: true });
  });

  afterAll(() => {
    Object.defineProperty(navigator, "language", { value: originalLang, configurable: true });
  });

  const schema: RaosFieldSchema = {
    type: "string",
    title: "Username",
    minLength: 3,
  };

  it("should fail sync validation before async", async () => {
    const result = await validateFieldAsync(schema, "ab", {}, true);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("不能少于");
  });

  it("should pass when no async config", async () => {
    const result = await validateFieldAsync(schema, "valid", {}, true);
    expect(result.valid).toBe(true);
  });

  it("should debounce async validation", async () => {
    const validateFn = vi.fn(() => Promise.resolve({ valid: true, errors: [] as string[] }));
    const p1 = debouncedAsyncValidate("field1", validateFn, 50);
    const p2 = debouncedAsyncValidate("field1", validateFn, 50);
    const result = await p2;
    expect(validateFn).toHaveBeenCalledTimes(1);
    expect(result.valid).toBe(true);
  });

  it("should handle remote validation failure", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ valid: false, message: "已存在" }),
      })
    ) as any;

    const asyncSchema: RaosFieldSchema = {
      ...schema,
      "x-asyncValidator": {
        type: "remote",
        url: "/api/check",
        method: "GET",
      },
    };

    const result = await validateFieldAsync(asyncSchema, "testuser", {}, true);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toBe("已存在");
  });
});
