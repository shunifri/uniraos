import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FormRenderer } from "../../web/src/components/form-engine/core/FormRenderer";
import type { RaosFormSchema } from "../../web/src/components/form-engine/types";

describe("FormRenderer AutoSave", () => {
  const schema: RaosFormSchema = {
    type: "object",
    title: "Test Form",
    properties: {
      name: { type: "string", title: "Name", "ui:widget": "input" },
    },
  };

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("should restore draft from localStorage", () => {
    localStorage.setItem("test-draft", JSON.stringify({ name: "Draft Name", _timestamp: Date.now() }));

    render(
      <FormRenderer
        schema={schema}
        autoSave={{ localStorageKey: "test-draft" }}
      />
    );

    const input = screen.getByLabelText("Name") as HTMLInputElement;
    expect(input.value).toBe("Draft Name");
  });

  it("should save draft to localStorage on change", async () => {
    render(
      <FormRenderer
        schema={schema}
        autoSave={{ localStorageKey: "test-draft", debounce: 100 }}
      />
    );

    const input = screen.getByLabelText("Name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "New Value" } });

    await waitFor(
      () => {
        const draft = localStorage.getItem("test-draft");
        expect(draft).toBeTruthy();
        const parsed = JSON.parse(draft!);
        expect(parsed.name).toBe("New Value");
        expect(parsed._timestamp).toBeDefined();
      },
      { timeout: 1000 }
    );
  });

  it("should call onSave callback", async () => {
    const onSave = vi.fn();
    render(
      <FormRenderer
        schema={schema}
        autoSave={{ onSave, debounce: 50 }}
      />
    );

    const input = screen.getByLabelText("Name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Callback Value" } });

    await waitFor(
      () => {
        expect(onSave).toHaveBeenCalled();
      },
      { timeout: 3000 }
    );

    // Verify the saved data contains the new value
    const lastCall = onSave.mock.calls[onSave.mock.calls.length - 1][0];
    expect(lastCall.name).toBe("Callback Value");
  });

  it("should show save status when showStatus is true", async () => {
    render(
      <FormRenderer
        schema={schema}
        autoSave={{ localStorageKey: "test-draft", debounce: 50, showStatus: true }}
      />
    );

    const input = screen.getByLabelText("Name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Status Test" } });

    // Should show "saving" or "saved" eventually
    await waitFor(
      () => {
        const status = screen.queryByText(/保存中|已自动保存/);
        expect(status).toBeTruthy();
      },
      { timeout: 5000 }
    );
  });

  it("should not restore expired draft (older than 7 days)", () => {
    const oldTimestamp = Date.now() - 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem("test-draft", JSON.stringify({ name: "Old Draft", _timestamp: oldTimestamp }));

    render(
      <FormRenderer
        schema={schema}
        autoSave={{ localStorageKey: "test-draft" }}
      />
    );

    const input = screen.getByLabelText("Name") as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("should merge draft with initialData", () => {
    localStorage.setItem("test-draft", JSON.stringify({ name: "Draft", _timestamp: Date.now() }));

    render(
      <FormRenderer
        schema={schema}
        initialData={{ name: "Initial" }}
        autoSave={{ localStorageKey: "test-draft" }}
      />
    );

    const input = screen.getByLabelText("Name") as HTMLInputElement;
    expect(input.value).toBe("Draft");
  });
});
