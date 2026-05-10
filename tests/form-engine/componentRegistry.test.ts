import { describe, it, expect } from "vitest";
import React from "react";
import {
  registerComponent,
  getComponent,
  hasComponent,
  listComponents,
// eslint-disable-next-line @typescript-eslint/no-unused-vars
  registry,
  type FieldComponent,
} from "../../web/src/components/form-engine/registry/componentRegistry.js";

describe("Component Registry", () => {
  it("should return the pre-registered input component without throwing", () => {
    const component = getComponent("input");
    expect(component).toBeDefined();
    expect(typeof component).toBe("function");
  });

  it("should register and retrieve a custom component", () => {
    const CustomWidget: FieldComponent = () => React.createElement("div", null, "custom");
    registerComponent("custom", CustomWidget);

    const retrieved = getComponent("custom");
    expect(retrieved).toBe(CustomWidget);
  });

  it("should throw an error when getting a nonexistent component", () => {
    expect(() => getComponent("nonexistent")).toThrow(
      'Component "nonexistent" not found in registry'
    );
  });

  it("should check if a component exists via hasComponent", () => {
    expect(hasComponent("input")).toBe(true);
    expect(hasComponent("nonexistent")).toBe(false);
  });

  it("should list all registered component names", () => {
    const names = listComponents();
    expect(names).toContain("input");
    expect(names).toContain("custom");
  });
});
