import { describe, it, expect } from "vitest";
import { validateField } from "../../web/src/components/form-engine/core/ValidationEngine";

describe("Custom Validator Sandbox", () => {
  it("should pass when expression returns true", async () => {
    const result = await validateField(
      { type: "number", title: "Age", customValidator: "value >= 18" } as any,
      25,
      {},
      false
    );
    expect(result.valid).toBe(true);
  });

  it("should fail when expression returns false", async () => {
    const result = await validateField(
      { type: "number", title: "Age", customValidator: "value >= 18" } as any,
      16,
      {},
      false
    );
    expect(result.valid).toBe(false);
  });

  it("should support expr: prefix", async () => {
    const result = await validateField(
      { type: "string", title: "Code", customValidator: "expr: value.length === 3" } as any,
      "ABC",
      {},
      false
    );
    expect(result.valid).toBe(true);
  });

  it("should access formData in expression", async () => {
    const result = await validateField(
      { type: "number", title: "Max", customValidator: "value <= formData.limit" } as any,
      50,
      { limit: 100 },
      false
    );
    expect(result.valid).toBe(true);
  });

  it("should return custom error string", async () => {
    const result = await validateField(
      { type: "number", title: "Qty", customValidator: '"Quantity must be even"' } as any,
      3,
      {},
      false
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toBe("Quantity must be even");
  });

  it("should catch syntax error gracefully", async () => {
    const result = await validateField(
      { type: "string", title: "X", customValidator: "value >>" } as any,
      "test",
      {},
      false
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Custom validator error");
  });
});
