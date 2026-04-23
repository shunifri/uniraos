import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DynamicForm from "../../web/src/components/DynamicForm";

describe("DynamicForm", () => {
  it("渲染表单标题和操作按钮", () => {
    const schema = {
      type: "object" as const,
      title: "测试表单",
      properties: {
        name: {
          type: "string" as const,
          title: "姓名",
          "ui:widget": "input",
        },
      },
      actions: [{ type: "submit" as const, label: "提交", primary: true }],
    };
    render(<DynamicForm schema={schema} />);
    expect(screen.getByText("测试表单")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /提\s*交/ })).toBeInTheDocument();
  });

  it("描述文本显示", () => {
    const schema = {
      type: "object" as const,
      title: "测试表单",
      description: "这是一个测试表单",
      properties: {},
    };
    render(<DynamicForm schema={schema} />);
    expect(screen.getByText("这是一个测试表单")).toBeInTheDocument();
  });

  it("readOnly 模式下隐藏操作按钮", () => {
    const schema = {
      type: "object" as const,
      title: "只读表单",
      properties: {
        name: {
          type: "string" as const,
          title: "姓名",
          "ui:widget": "input",
        },
      },
      actions: [{ type: "submit" as const, label: "提交" }],
    };
    render(<DynamicForm schema={schema} readOnly />);
    expect(screen.queryByRole("button", { name: /提\s*交/ })).not.toBeInTheDocument();
  });

  it("多种操作按钮", () => {
    const schema = {
      type: "object" as const,
      title: "测试表单",
      properties: {},
      actions: [
        { type: "submit" as const, label: "提交", primary: true },
        { type: "reset" as const, label: "重置" },
        { type: "saveDraft" as const, label: "保存草稿" },
      ],
    };
    render(<DynamicForm schema={schema} />);
    expect(screen.getByRole("button", { name: /提\s*交/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /重\s*置/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /保存草稿/ })).toBeInTheDocument();
  });

  it("提交回调", async () => {
    const onSubmit = vi.fn();
    const schema = {
      type: "object" as const,
      title: "测试表单",
      properties: {
        name: {
          type: "string" as const,
          title: "姓名",
          "ui:widget": "input",
        },
      },
      actions: [{ type: "submit" as const, label: "提交", primary: true }],
    };
    render(<DynamicForm schema={schema} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("姓名"), {
      target: { value: "John" },
    });
    fireEvent.click(screen.getByRole("button", { name: /提\s*交/ }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ name: "John" }));
  });
});
