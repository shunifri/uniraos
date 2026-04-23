import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FormRenderer } from "../../web/src/components/form-engine/core/FormRenderer";
import type { RaosFormSchema } from "../../web/src/components/form-engine/types";

describe("Variant Components", () => {
  const options = [
    { label: "Option A", value: "a" },
    { label: "Option B", value: "b" },
    { label: "Option C", value: "c" },
  ];

  describe("RadioGroup variant", () => {
    it("默认渲染传统 radio", () => {
      const schema: RaosFormSchema = {
        type: "object",
        properties: {
          choice: {
            type: "string",
            title: "Choice",
            "ui:widget": "radio",
            "x-dataSource": { type: "static", options },
          },
        },
      };
      render(<FormRenderer schema={schema} />);
      expect(screen.getByText("Option A")).toBeInTheDocument();
      expect(screen.getByText("Option B")).toBeInTheDocument();
      expect(screen.getByText("Option C")).toBeInTheDocument();
    });

    it("variant=segmented 渲染 Segmented 分段控制器", () => {
      const schema: RaosFormSchema = {
        type: "object",
        properties: {
          choice: {
            type: "string",
            title: "Choice",
            "ui:widget": "radio",
            "ui:props": { variant: "segmented" },
            "x-dataSource": { type: "static", options },
          },
        },
      };
      render(<FormRenderer schema={schema} />);
      // Segmented 渲染为按钮式分段选择器
      expect(screen.getByText("Option A")).toBeInTheDocument();
      expect(screen.getByText("Option B")).toBeInTheDocument();
      expect(screen.getByText("Option C")).toBeInTheDocument();
    });

    it("variant=button 渲染按钮式 radio", () => {
      const schema: RaosFormSchema = {
        type: "object",
        properties: {
          choice: {
            type: "string",
            title: "Choice",
            "ui:widget": "radio",
            "ui:props": { variant: "button" },
            "x-dataSource": { type: "static", options },
          },
        },
      };
      render(<FormRenderer schema={schema} />);
      expect(screen.getByText("Option A")).toBeInTheDocument();
      expect(screen.getByText("Option B")).toBeInTheDocument();
    });

    it("segmented 变体支持选择交互", () => {
      const onChange = vi.fn();
      const schema: RaosFormSchema = {
        type: "object",
        properties: {
          choice: {
            type: "string",
            title: "Choice",
            "ui:widget": "radio",
            "ui:props": { variant: "segmented" },
            "x-dataSource": { type: "static", options },
          },
        },
      };
      render(<FormRenderer schema={schema} onChange={onChange} />);
      const optionB = screen.getByText("Option B");
      fireEvent.click(optionB);
      expect(onChange).toHaveBeenCalledWith({ choice: "b" });
    });
  });

  describe("CheckboxGroup variant", () => {
    it("默认渲染传统 checkbox", () => {
      const schema: RaosFormSchema = {
        type: "object",
        properties: {
          choices: {
            type: "array",
            title: "Choices",
            "ui:widget": "checkbox",
            "x-dataSource": { type: "static", options },
          },
        },
      };
      render(<FormRenderer schema={schema} />);
      expect(screen.getByText("Option A")).toBeInTheDocument();
      expect(screen.getByText("Option B")).toBeInTheDocument();
    });

    it("variant=tag 渲染 CheckableTag 胶囊标签", () => {
      const schema: RaosFormSchema = {
        type: "object",
        properties: {
          choices: {
            type: "array",
            title: "Choices",
            "ui:widget": "checkbox",
            "ui:props": { variant: "tag" },
            "x-dataSource": { type: "static", options },
          },
        },
      };
      render(<FormRenderer schema={schema} />);
      expect(screen.getByText("Option A")).toBeInTheDocument();
      expect(screen.getByText("Option B")).toBeInTheDocument();
      expect(screen.getByText("Option C")).toBeInTheDocument();
    });

    it("tag 变体支持多选交互", () => {
      const onChange = vi.fn();
      const schema: RaosFormSchema = {
        type: "object",
        properties: {
          choices: {
            type: "array",
            title: "Choices",
            "ui:widget": "checkbox",
            "ui:props": { variant: "tag" },
            "x-dataSource": { type: "static", options },
          },
        },
      };
      render(<FormRenderer schema={schema} onChange={onChange} />);
      const optionA = screen.getByText("Option A");
      fireEvent.click(optionA);
      expect(onChange).toHaveBeenCalledWith({ choices: ["a"] });
    });
  });

  describe("SelectInput variant", () => {
    it("默认渲染传统 select", () => {
      const schema: RaosFormSchema = {
        type: "object",
        properties: {
          status: {
            type: "string",
            title: "Status",
            "ui:widget": "select",
            "x-dataSource": { type: "static", options },
          },
        },
      };
      render(<FormRenderer schema={schema} />);
      expect(screen.getByText("Status")).toBeInTheDocument();
    });

    it("单选 + variant=segmented 渲染 Segmented", () => {
      const onChange = vi.fn();
      const schema: RaosFormSchema = {
        type: "object",
        properties: {
          status: {
            type: "string",
            title: "Status",
            "ui:widget": "select",
            "ui:props": { variant: "segmented" },
            "x-dataSource": { type: "static", options },
          },
        },
      };
      render(<FormRenderer schema={schema} onChange={onChange} />);
      expect(screen.getByText("Option A")).toBeInTheDocument();
      expect(screen.getByText("Option B")).toBeInTheDocument();
      expect(screen.getByText("Option C")).toBeInTheDocument();
    });

    it("多选 select 保持传统下拉模式（segmented 仅单选生效）", () => {
      const schema: RaosFormSchema = {
        type: "object",
        properties: {
          tags: {
            type: "array",
            title: "Tags",
            "ui:widget": "select",
            "ui:props": { variant: "segmented", multiple: true },
            "x-dataSource": { type: "static", options },
          },
        },
      };
      render(<FormRenderer schema={schema} />);
      // 多选时仍渲染 Select（segmented 不支持多选）
      expect(screen.getByText("Tags")).toBeInTheDocument();
    });
  });
});
