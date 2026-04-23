import { describe, it, expect } from "vitest";
import {
  evaluateLinkage,
  evaluateExpression,
  findDependentFields,
} from "../../web/src/components/form-engine/core/LinkageEngine";

describe("LinkageEngine", () => {
  describe("evaluateLinkage", () => {
    it("visible 联动", () => {
      const rules = [{ type: "visible" as const, when: "{{amount}} > 1000" }];
      const result = evaluateLinkage(rules, { amount: 1500 });
      expect(result.visible).toBe(true);
    });

    it("hidden 联动", () => {
      const rules = [{ type: "hidden" as const, when: "{{amount}} > 1000" }];
      const result = evaluateLinkage(rules, { amount: 1500 });
      expect(result.visible).toBe(false);
    });

    it("disabled 联动", () => {
      const rules = [
        { type: "disabled" as const, when: '{{status}} === "locked"' },
      ];
      const result = evaluateLinkage(rules, { status: "locked" });
      expect(result.disabled).toBe(true);
    });

    it("setValue 联动", () => {
      const rules = [
        {
          type: "setValue" as const,
          when: '{{type}} === "admin"',
          then: "Admin User",
        },
      ];
      const result = evaluateLinkage(rules, { type: "admin" });
      expect(result.value).toBe("Admin User");
    });

    it("setValue else 分支", () => {
      const rules = [
        {
          type: "setValue" as const,
          when: '{{type}} === "admin"',
          then: "Admin",
          else: "User",
        },
      ];
      const result = evaluateLinkage(rules, { type: "guest" });
      expect(result.value).toBe("User");
    });

    it("默认状态（无规则匹配）", () => {
      const rules: any[] = [];
      const result = evaluateLinkage(rules, { amount: 500 });
      expect(result.visible).toBe(true); // 默认 visible=true，无规则
      expect(result.disabled).toBe(false);
      expect(result.readonly).toBe(false);
      expect(result.required).toBe(false);
    });
  });

  describe("evaluateExpression", () => {
    it("字符串比较", () => {
      expect(
        evaluateExpression('{{type}} === "admin"', { type: "admin" })
      ).toBe(true);
      expect(
        evaluateExpression('{{type}} === "admin"', { type: "user" })
      ).toBe(false);
    });

    it("数值比较", () => {
      expect(evaluateExpression("{{amount}} > 1000", { amount: 1500 })).toBe(
        true
      );
      expect(evaluateExpression("{{amount}} <= 1000", { amount: 500 })).toBe(
        true
      );
    });

    it("逻辑组合", () => {
      expect(
        evaluateExpression("{{a}} > 1 && {{b}} < 10", { a: 5, b: 5 })
      ).toBe(true);
    });

    it("expr 前缀", () => {
      expect(evaluateExpression("expr:Math.ceil(3.5)", {})).toBe(true); // 4 !== 0 → true
    });
  });

  describe("findDependentFields", () => {
    it("查找联动依赖", () => {
      const properties = {
        highAmountReason: {
          "x-linkage": [{ when: "{{amount}} > 1000" }],
        },
      };
      expect(findDependentFields("amount", properties)).toContain(
        "highAmountReason"
      );
    });

    it("查找数据源依赖", () => {
      const properties = {
        employeeId: {
          "x-dataSource": {
            database: {
              queryParams: [
                { source: "formField", sourceField: "department" },
              ],
            },
          },
        },
      };
      expect(findDependentFields("department", properties)).toContain(
        "employeeId"
      );
    });

    it("查找级联依赖", () => {
      const properties = {
        employeeId: {
          "x-dataSource": {
            type: "remote",
            url: "/api/employees",
            cascade: {
              dependency: "department",
            },
          },
        },
      };
      expect(findDependentFields("department", properties)).toContain(
        "employeeId"
      );
    });

    it("查找多级联依赖", () => {
      const properties = {
        employeeId: {
          "x-dataSource": {
            type: "remote",
            url: "/api/employees",
            cascade: {
              dependency: ["department", "team"],
            },
          },
        },
      };
      expect(findDependentFields("department", properties)).toContain(
        "employeeId"
      );
      expect(findDependentFields("team", properties)).toContain("employeeId");
    });
  });
});
