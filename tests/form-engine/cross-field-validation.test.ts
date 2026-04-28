import { describe, it, expect } from "vitest";
import { validateCrossFieldRules } from "../../web/src/components/form-engine/core/ValidationEngine";
import type { CrossFieldValidationRule } from "../../web/src/components/form-engine/types";

describe("validateCrossFieldRules", () => {
  it("should pass when expression returns true", () => {
    const rules: CrossFieldValidationRule[] = [
      { expr: "formData.a > formData.b", message: "a must be greater than b", targetFields: ["a"] },
    ];
    const errors = validateCrossFieldRules(rules, { a: 10, b: 5 });
    expect(errors).toHaveLength(0);
  });

  it("should fail when expression returns false", () => {
    const rules: CrossFieldValidationRule[] = [
      { expr: "formData.a > formData.b", message: "a must be greater than b", targetFields: ["a"] },
    ];
    const errors = validateCrossFieldRules(rules, { a: 3, b: 5 });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("a must be greater than b");
    expect(errors[0].targetFields).toEqual(["a"]);
  });

  it("should support string comparison", () => {
    const rules: CrossFieldValidationRule[] = [
      { expr: 'formData.endDate > formData.startDate', message: "结束日期必须大于开始日期", targetFields: ["endDate"] },
    ];
    const errors = validateCrossFieldRules(rules, { startDate: "2024-01-01", endDate: "2024-12-31" });
    expect(errors).toHaveLength(0);
  });

  it("should support multiple target fields", () => {
    const rules: CrossFieldValidationRule[] = [
      { expr: "formData.password === formData.confirmPassword", message: "密码不一致", targetFields: ["password", "confirmPassword"] },
    ];
    const errors = validateCrossFieldRules(rules, { password: "123", confirmPassword: "456" });
    expect(errors).toHaveLength(1);
    expect(errors[0].targetFields).toEqual(["password", "confirmPassword"]);
  });

  it("should return custom message when expression returns a string", () => {
    const rules: CrossFieldValidationRule[] = [
      { expr: "formData.age >= 18 ? true : '必须年满18岁'", message: "年龄不足", targetFields: ["age"] },
    ];
    const errors = validateCrossFieldRules(rules, { age: 16 });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("必须年满18岁");
  });

  it("should handle expression errors gracefully", () => {
    const rules: CrossFieldValidationRule[] = [
      { expr: "formData.x.y.z", message: "invalid", targetFields: ["x"] },
    ];
    const errors = validateCrossFieldRules(rules, { x: null });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/Cross-field validation error:/);
  });

  it("should validate multiple rules independently", () => {
    const rules: CrossFieldValidationRule[] = [
      { expr: "formData.a > 0", message: "a must be positive", targetFields: ["a"] },
      { expr: "formData.b > 0", message: "b must be positive", targetFields: ["b"] },
    ];
    const errors = validateCrossFieldRules(rules, { a: -1, b: -2 });
    expect(errors).toHaveLength(2);
  });

  it("should default targetFields to empty array", () => {
    const rules: CrossFieldValidationRule[] = [
      { expr: "false", message: "always fails" },
    ];
    const errors = validateCrossFieldRules(rules, {});
    expect(errors[0].targetFields).toEqual([]);
  });

  it("should support {{fieldName}} syntax", () => {
    const rules: CrossFieldValidationRule[] = [
      { expr: "{{endDate}} > {{startDate}}", message: "结束日期必须大于开始日期", targetFields: ["endDate"] },
    ];
    const errors = validateCrossFieldRules(rules, { startDate: "2024-01-01", endDate: "2024-12-31" });
    expect(errors).toHaveLength(0);
  });

  it("should fail with {{fieldName}} syntax when condition not met", () => {
    const rules: CrossFieldValidationRule[] = [
      { expr: "{{endDate}} > {{startDate}}", message: "结束日期必须大于开始日期", targetFields: ["endDate"] },
    ];
    const errors = validateCrossFieldRules(rules, { startDate: "2024-12-31", endDate: "2024-01-01" });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("结束日期必须大于开始日期");
  });

  it("should support {{fieldName}} with number comparison", () => {
    const rules: CrossFieldValidationRule[] = [
      { expr: "{{max}} >= {{min}}", message: "最大值必须大于等于最小值", targetFields: ["max"] },
    ];
    const errors = validateCrossFieldRules(rules, { min: 10, max: 5 });
    expect(errors).toHaveLength(1);
  });

  it("should support mixed syntax (formData and {{}})", () => {
    const rules: CrossFieldValidationRule[] = [
      { expr: "formData.a > {{b}}", message: "a must be greater than b", targetFields: ["a"] },
    ];
    const errors = validateCrossFieldRules(rules, { a: 10, b: 5 });
    expect(errors).toHaveLength(0);
  });
});
