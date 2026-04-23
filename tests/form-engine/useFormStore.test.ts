import { describe, it, expect } from "vitest";
import {
  createFormStore,
  createDefaultFieldState,
  extractDefaults,
} from "../../web/src/components/form-engine/store/useFormStore.js";
import type { RaosFormSchema } from "../../web/src/components/form-engine/types.js";

describe("useFormStore", () => {
  it("should create store and verify initial data", () => {
    const schema: RaosFormSchema = {
      type: "object",
      properties: {
        name: { type: "string", title: "Name" },
      },
    };

    const store = createFormStore({
      schema,
      initialData: { name: "John" },
    });

    expect(store.getState().formData.name).toBe("John");
  });

  it("should update field value", () => {
    const schema: RaosFormSchema = {
      type: "object",
      properties: {
        name: { type: "string", title: "Name" },
      },
    };

    const store = createFormStore({ schema });
    store.getState().setFieldValue("name", "Jane");

    expect(store.getState().formData.name).toBe("Jane");
  });

  it("should set field error", () => {
    const schema: RaosFormSchema = {
      type: "object",
      properties: {
        email: { type: "string", title: "Email" },
      },
    };

    const store = createFormStore({ schema });
    store.getState().setFieldError("email", ["Invalid email"]);

    expect(store.getState().errors.email).toEqual(["Invalid email"]);
  });

  it("should set field state (visible/disabled)", () => {
    const schema: RaosFormSchema = {
      type: "object",
      properties: {
        age: { type: "integer", title: "Age" },
      },
    };

    const store = createFormStore({ schema });
    store.getState().setFieldState("age", { visible: false });

    expect(store.getState().fieldStates.age.visible).toBe(false);
    expect(store.getState().fieldStates.age.disabled).toBe(false);
  });

  it("should reset to initial state", () => {
    const schema: RaosFormSchema = {
      type: "object",
      properties: {
        name: { type: "string", title: "Name" },
      },
    };

    const store = createFormStore({
      schema,
      initialData: { name: "John" },
    });

    store.getState().setFieldValue("name", "Changed");
    expect(store.getState().formData.name).toBe("Changed");

    store.getState().reset();
    expect(store.getState().formData.name).toBe("John");
    expect(store.getState().errors).toEqual({});
    expect(store.getState().submitting).toBe(false);
  });

  it("should extract default values from schema", () => {
    const schema: RaosFormSchema = {
      type: "object",
      properties: {
        status: { type: "string", title: "Status", default: "active" },
      },
    };

    const store = createFormStore({ schema });

    expect(store.getState().formData.status).toBe("active");
  });

  it("should auto-mark required fields", () => {
    const schema: RaosFormSchema = {
      type: "object",
      properties: {
        email: { type: "string", title: "Email", required: true },
      },
      required: ["email"],
    };

    const store = createFormStore({ schema });

    expect(store.getState().fieldStates.email.required).toBe(true);
  });
});

describe("createDefaultFieldState", () => {
  it("should return correct default state", () => {
    const state = createDefaultFieldState();
    expect(state.visible).toBe(true);
    expect(state.disabled).toBe(false);
    expect(state.readonly).toBe(false);
    expect(state.required).toBe(false);
  });
});

describe("extractDefaults", () => {
  it("should extract fields with default values", () => {
    const schema: RaosFormSchema = {
      type: "object",
      properties: {
        status: { type: "string", title: "Status", default: "active" },
        name: { type: "string", title: "Name" },
        count: { type: "integer", title: "Count", default: 0 },
      },
    };

    const defaults = extractDefaults(schema);
    expect(defaults).toEqual({ status: "active", count: 0 });
  });
});
