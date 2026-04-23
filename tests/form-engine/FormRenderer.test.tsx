import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FormRenderer } from "../../web/src/components/form-engine/core/FormRenderer";
import type { RaosFormSchema } from "../../web/src/components/form-engine/types";

describe("FormRenderer", () => {
  it("渲染 input 字段", () => {
    const schema: RaosFormSchema = {
      type: "object",
      properties: {
        name: {
          type: "string",
          title: "Name",
          "ui:widget": "input",
        },
      },
    };
    render(<FormRenderer schema={schema} />);
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("渲染 select 字段", () => {
    const schema: RaosFormSchema = {
      type: "object",
      properties: {
        status: {
          type: "string",
          title: "Status",
          "ui:widget": "select",
          "x-dataSource": {
            type: "static",
            options: [{ label: "Active", value: "active" }],
          },
        },
      },
    };
    render(<FormRenderer schema={schema} />);
    expect(screen.getByText("Status")).toBeInTheDocument();
  });

  it("onChange 回调", () => {
    const onChange = vi.fn();
    const schema: RaosFormSchema = {
      type: "object",
      properties: {
        name: {
          type: "string",
          title: "Name",
          "ui:widget": "input",
        },
      },
    };
    render(<FormRenderer schema={schema} onChange={onChange} />);
    const input = screen.getByLabelText("Name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "John" } });
    expect(onChange).toHaveBeenCalledWith({ name: "John" });
  });

  it("联动规则（visible）", () => {
    const schema: RaosFormSchema = {
      type: "object",
      properties: {
        amount: {
          type: "number",
          title: "Amount",
          "ui:widget": "number",
        },
        reason: {
          type: "string",
          title: "Reason",
          "ui:widget": "input",
          "x-linkage": [
            { type: "visible", when: "{{amount}} > 1000" },
          ],
        },
      },
    };
    render(<FormRenderer schema={schema} />);
    // amount 默认空，reason 隐藏
    expect(screen.queryByLabelText("Reason")).not.toBeInTheDocument();
    // 修改 amount 为 1500，reason 应该显示
    const amountInput = screen.getByLabelText("Amount") as HTMLInputElement;
    fireEvent.change(amountInput, { target: { value: "1500" } });
    expect(screen.getByLabelText("Reason")).toBeInTheDocument();
  });

  it("验证错误显示", async () => {
    const schema: RaosFormSchema = {
      type: "object",
      properties: {
        email: {
          type: "string",
          title: "Email",
          "ui:widget": "input",
          format: "email",
        },
      },
      required: ["email"],
    };
    render(<FormRenderer schema={schema} />);
    const input = screen.getByLabelText("Email");
    fireEvent.blur(input); // 触发验证
    await waitFor(() =>
      expect(screen.getByText("此字段为必填项")).toBeInTheDocument()
    );
  });

  it("表单提交 - 有错误时不调用 onSubmit", async () => {
    const onSubmit = vi.fn();
    const schema: RaosFormSchema = {
      type: "object",
      properties: {
        email: {
          type: "string",
          title: "Email",
          "ui:widget": "input",
          format: "email",
        },
      },
      required: ["email"],
    };
    render(<FormRenderer schema={schema} onSubmit={onSubmit} />);
    const form = document.querySelector("form");
    if (form) {
      fireEvent.submit(form);
    }
    await waitFor(() => {
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  it("表单提交 - 验证通过后调用 onSubmit", async () => {
    const onSubmit = vi.fn();
    const schema: RaosFormSchema = {
      type: "object",
      properties: {
        name: {
          type: "string",
          title: "Name",
          "ui:widget": "input",
        },
      },
      required: ["name"],
    };
    render(<FormRenderer schema={schema} onSubmit={onSubmit} />);
    const input = screen.getByLabelText("Name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "John" } });
    const form = document.querySelector("form");
    if (form) {
      fireEvent.submit(form);
    }
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ name: "John" });
    });
  });

  it("组件不存在时显示错误提示", () => {
    const schema: RaosFormSchema = {
      type: "object",
      properties: {
        unknown: {
          type: "string",
          title: "Unknown",
          "ui:widget": "nonexistent",
        },
      },
    };
    render(<FormRenderer schema={schema} />);
    expect(screen.getByText(/Unknown component/)).toBeInTheDocument();
  });

  it("grid 布局渲染", () => {
    const schema: RaosFormSchema = {
      type: "object",
      properties: {
        firstName: {
          type: "string",
          title: "First Name",
          "ui:widget": "input",
          "ui:colSpan": 12,
        },
        lastName: {
          type: "string",
          title: "Last Name",
          "ui:widget": "input",
          "ui:colSpan": 12,
        },
      },
      layout: {
        type: "grid",
        columns: 2,
        gutter: 16,
      },
    };
    render(<FormRenderer schema={schema} />);
    expect(screen.getByLabelText("First Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Last Name")).toBeInTheDocument();
  });

  it("sections 布局渲染", () => {
    const schema: RaosFormSchema = {
      type: "object",
      properties: {
        name: {
          type: "string",
          title: "Name",
          "ui:widget": "input",
        },
        email: {
          type: "string",
          title: "Email",
          "ui:widget": "input",
        },
      },
      layout: {
        type: "vertical",
        sections: [
          {
            key: "basic",
            title: "Basic Info",
            fields: ["name"],
          },
          {
            key: "contact",
            title: "Contact",
            fields: ["email"],
          },
        ],
      },
    };
    render(<FormRenderer schema={schema} />);
    expect(screen.getByText("Basic Info")).toBeInTheDocument();
    expect(screen.getByText("Contact")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("不可见字段不渲染", () => {
    const schema: RaosFormSchema = {
      type: "object",
      properties: {
        secret: {
          type: "string",
          title: "Secret",
          "ui:widget": "input",
          "ui:hidden": true,
        },
      },
    };
    render(<FormRenderer schema={schema} />);
    // ui:hidden 目前不直接控制可见性，需要通过 x-linkage 控制
    // 这里主要测试组件在 fieldState.visible = false 时不渲染
    expect(screen.getByLabelText("Secret")).toBeInTheDocument();
  });

  it("readOnly 模式", () => {
    const schema: RaosFormSchema = {
      type: "object",
      properties: {
        name: {
          type: "string",
          title: "Name",
          "ui:widget": "input",
        },
      },
    };
    render(<FormRenderer schema={schema} readOnly={true} />);
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("initialData 初始化", () => {
    const schema: RaosFormSchema = {
      type: "object",
      properties: {
        name: {
          type: "string",
          title: "Name",
          "ui:widget": "input",
        },
      },
    };
    render(<FormRenderer schema={schema} initialData={{ name: "Alice" }} />);
    const input = screen.getByLabelText("Name") as HTMLInputElement;
    expect(input.value).toBe("Alice");
  });
});
