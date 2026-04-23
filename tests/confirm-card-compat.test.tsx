import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ConfirmCard from "../web/src/components/ConfirmCard";

describe("ConfirmCard Backward Compatibility", () => {
  it("renders old format form", () => {
    render(
      <ConfirmCard
        confirmId="test-123"
        type="form"
        title="Old Form"
        fields={[
          { key: "name", type: "text", label: "Name", required: true },
        ]}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText("Old Form")).toBeInTheDocument();
  });

  it("renders new format form with schema", () => {
    render(
      <ConfirmCard
        confirmId="test-456"
        type="form"
        title="New Form"
        schema={{
          type: "object",
          title: "New Form",
          properties: {
            email: {
              type: "string",
              title: "Email",
              "ui:widget": "input",
            },
          },
        }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText("New Form")).toBeInTheDocument();
  });

  it("selection type is not affected", () => {
    render(
      <ConfirmCard
        confirmId="test-789"
        type="selection"
        title="Choose One"
        options={[
          { id: "A", label: "A" },
          { id: "B", label: "B" },
          { id: "C", label: "C" },
        ]}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText("Choose One")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
  });
});
