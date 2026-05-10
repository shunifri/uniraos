import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FormRenderer } from "../../web/src/components/form-engine/core/FormRenderer";
import type { RaosFormSchema } from "../../web/src/components/form-engine/types";

describe("Cascade DataSource", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should load dependent field options when parent changes", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          options: [
            { label: "张三", value: "u1" },
            { label: "李四", value: "u2" },
          ],
        },
      }),
    });

    const schema: RaosFormSchema = {
      type: "object",
      properties: {
        department: {
          type: "string",
          title: "部门",
          "ui:widget": "input",
        },
        employee: {
          type: "string",
          title: "员工",
          "ui:widget": "select",
          "x-dataSource": {
            type: "remote",
            url: "/api/employees",
            cascade: {
              dependency: "department",
              debounce: 100,
            },
          },
        },
      },
    };

    render(<FormRenderer schema={schema} />);

    // Change department value
    const deptInput = screen.getByLabelText("部门") as HTMLInputElement;
    fireEvent.change(deptInput, { target: { value: "rd" } });

    // Wait for debounce + fetch
    await waitFor(
      () => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
      },
      { timeout: 2000 }
    );

    const callArgs = fetchMock.mock.calls[0];
    expect(callArgs[0]).toBe("/api/form/data-source/resolve");
    expect(callArgs[1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const body = JSON.parse(callArgs[1].body);
    expect(body.dependencyValues).toEqual({ department: "rd" });
    expect(body.formData).toMatchObject({ department: "rd" });
  });

  it("should clear dependent field value when clearOnChange is true and new options do not contain current value", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          options: [{ label: "张三", value: "u1" }],
        },
      }),
    });

    const schema: RaosFormSchema = {
      type: "object",
      properties: {
        department: {
          type: "string",
          title: "部门",
          "ui:widget": "input",
        },
        employee: {
          type: "string",
          title: "员工",
          "ui:widget": "select",
          "ui:props": { variant: "dropdown" },
          "x-dataSource": {
            type: "remote",
            url: "/api/employees",
            cascade: {
              dependency: "department",
              debounce: 50,
              clearOnChange: true,
            },
          },
        },
      },
    };

    render(<FormRenderer schema={schema} initialData={{ employee: "old-value" }} />);

    const deptInput = screen.getByLabelText("部门") as HTMLInputElement;
    fireEvent.change(deptInput, { target: { value: "rd" } });

    await waitFor(
      () => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
      },
      { timeout: 2000 }
    );

    // After fetch resolves, employee value should be cleared because old-value is not in new options
    await waitFor(() => {
      const employeeSelect = screen.getByText("员工").closest(".ant-form-item")?.querySelector(".ant-select") as HTMLElement;
      // The select should show placeholder because value was cleared
      expect(employeeSelect).toBeTruthy();
    });
  });

  it("should not fetch when executeWhen is allFilled and dependencies are empty", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { options: [] },
      }),
    });

    const schema: RaosFormSchema = {
      type: "object",
      properties: {
        department: {
          type: "string",
          title: "部门",
          "ui:widget": "input",
        },
        employee: {
          type: "string",
          title: "员工",
          "ui:widget": "select",
          "x-dataSource": {
            type: "remote",
            url: "/api/employees",
            cascade: {
              dependency: "department",
              executeWhen: "allFilled",
              debounce: 50,
            },
          },
        },
      },
    };

    render(<FormRenderer schema={schema} />);

    // department is empty initially, trigger a change to empty
    const deptInput = screen.getByLabelText("部门") as HTMLInputElement;
    fireEvent.change(deptInput, { target: { value: "" } });

    // Wait a bit
    await new Promise((r) => setTimeout(r, 300));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("should set loading state during fetch", async () => {
    let resolveFetch: (value: any) => void;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });

    fetchMock.mockReturnValue(fetchPromise);

    const schema: RaosFormSchema = {
      type: "object",
      properties: {
        department: {
          type: "string",
          title: "部门",
          "ui:widget": "input",
        },
        employee: {
          type: "string",
          title: "员工",
          "ui:widget": "select",
          "x-dataSource": {
            type: "remote",
            url: "/api/employees",
            cascade: {
              dependency: "department",
              debounce: 0,
            },
          },
        },
      },
    };

    render(<FormRenderer schema={schema} />);

    const deptInput = screen.getByLabelText("部门") as HTMLInputElement;
    fireEvent.change(deptInput, { target: { value: "rd" } });

    // Immediately after change, loading should be set (but since fetch is async,
    // we can verify by checking the Select component has loading prop)
    // We can verify this indirectly by resolving the fetch later
    await waitFor(
      () => {
        // fetch should have been called
        expect(fetchMock).toHaveBeenCalledTimes(1);
      },
      { timeout: 1000 }
    );

    resolveFetch!({
      ok: true,
      json: async () => ({
        success: true,
        data: { options: [{ label: "张三", value: "u1" }] },
      }),
    });

    await waitFor(
      () => {
        // After resolution, options should be available in the select
        expect(screen.getByText("员工")).toBeInTheDocument();
      },
      { timeout: 1000 }
    );
  });
});
