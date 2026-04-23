import { describe, it, expect, vi } from "vitest";
import React from "react";
import {
  registerComponent,
  registerAsyncComponent,
  getComponent,
  getComponentAsync,
  hasComponent,
  listComponents,
  listComponentMeta,
  getComponentMeta,
} from "../componentRegistry";
import type { FieldRendererProps } from "../componentRegistry";

const DummyComp: React.FC<FieldRendererProps> = () => React.createElement("div", null, "dummy");

describe("Component Registry", () => {
  it("should register and retrieve sync component", () => {
    registerComponent("testSync", DummyComp, { name: "testSync", displayName: "Test Sync" });
    const comp = getComponent("testSync");
    expect(comp).toBe(DummyComp);
  });

  it("should check component existence", () => {
    expect(hasComponent("testSync")).toBe(true);
    expect(hasComponent("nonExistent")).toBe(false);
  });

  it("should list components", () => {
    const list = listComponents();
    expect(list).toContain("testSync");
  });

  it("should return component metadata", () => {
    const meta = getComponentMeta("testSync");
    expect(meta?.displayName).toBe("Test Sync");
  });

  it("should list all metadata", () => {
    const metas = listComponentMeta();
    const found = metas.find((m) => m.name === "testSync");
    expect(found?.displayName).toBe("Test Sync");
  });

  it("should register and load async component", async () => {
    const loader = vi.fn(() => Promise.resolve({ default: DummyComp, meta: { name: "asyncTest", displayName: "Async Test" } }));
    registerAsyncComponent("asyncTest", loader);
    expect(hasComponent("asyncTest")).toBe(true);

    const comp = await getComponentAsync("asyncTest");
    expect(comp).toBe(DummyComp);
    expect(loader).toHaveBeenCalled();

    const meta = getComponentMeta("asyncTest");
    expect(meta?.displayName).toBe("Async Test");
  });

  it("should cache async component after first load", async () => {
    const loader = vi.fn(() => Promise.resolve({ default: DummyComp }));
    registerAsyncComponent("cachedAsync", loader);
    await getComponentAsync("cachedAsync");
    await getComponentAsync("cachedAsync");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("should throw for unknown component", () => {
    expect(() => getComponent("unknown")).toThrow('Component "unknown" not found');
  });

  it("should throw for unloaded async component via getComponent", () => {
    const loader = vi.fn(() => Promise.resolve({ default: DummyComp }));
    registerAsyncComponent("unloaded", loader);
    expect(() => getComponent("unloaded")).toThrow("is async and not loaded");
  });
});
