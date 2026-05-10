import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FormRenderer } from "../../web/src/components/form-engine/core/FormRenderer";

describe("debug", () => {
  it("debug dom", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ success: true, data: { options: [{ label: "张三", value: "u1" }] } }),
    } as any);

    const schema: any = {
      type: "object",
      properties: {
        department: { type: "string", title: "部门", "ui:widget": "input" },
        employee: {
          type: "string", title: "员工", "ui:widget": "select",
          "x-dataSource": { type: "remote", url: "/api/employees", cascade: { dependency: "department", debounce: 50, clearOnChange: true } },
        },
      },
    };

    render(<FormRenderer schema={schema} initialData={{ employee: "old-value" }} />);

    const deptInput = screen.getByLabelText("部门") as HTMLInputElement;
    fireEvent.change(deptInput, { target: { value: "rd" } });

    await waitFor(() => {
      const html = document.body.innerHTML;
      // Find all elements with id or class containing "select" or "employee"
      const matches = html.match(/<[^>]*(id|class)="[^"]*(?:select|employee)[^"]*"[^>]*>/gi) || [];
      console.log("MATCHES:", matches.slice(0, 20));
    }, { timeout: 2000 });
    expect(true).toBe(true);
  });
});
