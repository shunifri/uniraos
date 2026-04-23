import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { ArrayField } from "../../web/src/components/form-engine/components/ArrayField";
import { GroupField } from "../../web/src/components/form-engine/components/GroupField";
import { TableField } from "../../web/src/components/form-engine/components/TableField";
import type { FieldRendererProps } from "../../web/src/components/form-engine/registry/componentRegistry";

const baseProps: Omit<FieldRendererProps, "schema" | "value" | "onChange"> = {
  name: "test",
  onBlur: vi.fn(),
  formData: {},
  fieldState: { visible: true, disabled: false, readonly: false, required: false },
};

describe("ArrayField", () => {
  it("should render empty array and add item", () => {
    const onChange = vi.fn();
    render(
      <ArrayField
        {...baseProps}
        schema={{ type: "array", title: "Tags", items: { type: "string", title: "Tag" } }}
        value={[]}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByText("Add Item"));
    expect(onChange).toHaveBeenCalledWith([""]);
  });
});

describe("GroupField", () => {
  it("should render nested fields", () => {
    const onChange = vi.fn();
    render(
      <GroupField
        {...baseProps}
        schema={{
          type: "object",
          title: "Address",
          properties: {
            city: { type: "string", title: "City" },
            zip: { type: "string", title: "ZIP" },
          },
        }}
        value={{ city: "Beijing" }}
        onChange={onChange}
      />
    );
    expect(screen.getByText("Address")).toBeInTheDocument();
  });
});

describe("TableField", () => {
  it("should render table and add row", () => {
    const onChange = vi.fn();
    render(
      <TableField
        {...baseProps}
        schema={{
          type: "array",
          title: "Items",
          items: {
            type: "object",
            properties: {
              name: { type: "string", title: "Name" },
              qty: { type: "number", title: "Qty" },
            },
          },
        }}
        value={[{ name: "A", qty: 1 }]}
        onChange={onChange}
      />
    );
    expect(screen.getByText("A")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Add Row"));
    expect(onChange).toHaveBeenCalled();
  });
});
