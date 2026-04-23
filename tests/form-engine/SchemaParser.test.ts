import { describe, it, expect } from "vitest";
import {
  flattenFields,
  getValueByPath,
  setValueByPath,
  getAllFieldNames,
} from "../../web/src/components/form-engine/core/SchemaParser";

describe("SchemaParser", () => {
  describe("flattenFields", () => {
    it("扁平化嵌套对象", () => {
      const schema = {
        type: "object" as const,
        properties: {
          user: {
            type: "object" as const,
            title: "User",
            properties: {
              name: { type: "string" as const, title: "Name" },
            },
          },
        },
      };
      const fields = flattenFields(schema);
      expect(fields).toContainEqual({
        name: "user.name",
        schema: { type: "string", title: "Name" },
      });
    });

    it("处理数组 items", () => {
      const schema = {
        type: "object" as const,
        properties: {
          items: {
            type: "array" as const,
            title: "Items",
            items: {
              type: "object" as const,
              title: "Item",
              properties: {
                name: { type: "string" as const, title: "Name" },
              },
            },
          },
        },
      };
      const fields = flattenFields(schema);
      expect(fields).toContainEqual({
        name: "items.name",
        schema: { type: "string", title: "Name" },
      });
    });
  });

  describe("getValueByPath", () => {
    it("读取嵌套值", () => {
      expect(getValueByPath({ user: { name: "John" } }, "user.name")).toBe(
        "John"
      );
      expect(getValueByPath({ user: { name: "John" } }, "user.age")).toBeUndefined();
      expect(getValueByPath(null, "user.name")).toBeUndefined();
    });
  });

  describe("setValueByPath", () => {
    it("设置嵌套值", () => {
      const data = { user: { name: "John" } };
      setValueByPath(data, "user.name", "Jane");
      expect(data.user.name).toBe("Jane");
    });

    it("创建中间对象", () => {
      const data = {};
      setValueByPath(data, "user.name", "John");
      expect(data).toEqual({ user: { name: "John" } });
    });
  });

  describe("getAllFieldNames", () => {
    it("获取所有字段名", () => {
      const schema = {
        type: "object" as const,
        properties: {
          name: { type: "string" as const, title: "Name" },
          address: {
            type: "object" as const,
            title: "Address",
            properties: {
              city: { type: "string" as const, title: "City" },
            },
          },
        },
      };
      expect(getAllFieldNames(schema)).toEqual(["name", "address.city"]);
    });
  });
});
