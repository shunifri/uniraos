import { describe, it, expect } from "vitest";
import { safeEvaluateExpression, safeEvaluateBoolean } from "../../src/utils/safe-expression.js";

describe("safeEvaluateExpression", () => {
  it("should evaluate basic arithmetic", () => {
    expect(safeEvaluateExpression("1 + 2")).toBe(3);
    expect(safeEvaluateExpression("10 - 3 * 2")).toBe(4);
    expect(safeEvaluateExpression("(1 + 2) * 3")).toBe(9);
  });

  it("should evaluate string concatenation", () => {
    expect(safeEvaluateExpression("'hello' + ' ' + 'world'")).toBe("hello world");
  });

  it("should access context variables", () => {
    expect(safeEvaluateExpression("a + b", { a: 1, b: 2 })).toBe(3);
    expect(safeEvaluateExpression("name", { name: "Alice" })).toBe("Alice");
  });

  it("should evaluate ternary expressions", () => {
    expect(safeEvaluateExpression("a > 5 ? 'big' : 'small'", { a: 10 })).toBe("big");
    expect(safeEvaluateExpression("a > 5 ? 'big' : 'small'", { a: 3 })).toBe("small");
  });

  it("should evaluate comparison operators", () => {
    expect(safeEvaluateExpression("a == 5", { a: 5 })).toBe(true);
    expect(safeEvaluateExpression("a != 5", { a: 3 })).toBe(true);
    expect(safeEvaluateExpression("a >= 5", { a: 5 })).toBe(true);
    expect(safeEvaluateExpression("a < 5", { a: 3 })).toBe(true);
  });

  it("should use Math functions", () => {
    expect(safeEvaluateExpression("Math.abs(-5)")).toBe(5);
    expect(safeEvaluateExpression("Math.max(1, 5, 3)")).toBe(5);
  });

  it("should throw on dangerous expressions", () => {
    expect(() => safeEvaluateExpression("process.exit(1)")).toThrow();
    expect(() => safeEvaluateExpression("require('fs')")).toThrow();
    expect(() => safeEvaluateExpression("eval('1+1')")).toThrow();
  });
});

describe("safeEvaluateBoolean", () => {
  it("should evaluate boolean expressions", () => {
    expect(safeEvaluateBoolean("a > 5", { a: 10 })).toBe(true);
    expect(safeEvaluateBoolean("a > 5", { a: 3 })).toBe(false);
  });

  it("should handle logical operators", () => {
    expect(safeEvaluateBoolean("a > 5 && b < 10", { a: 10, b: 5 })).toBe(true);
    expect(safeEvaluateBoolean("a > 5 || b > 10", { a: 3, b: 15 })).toBe(true);
  });
});
