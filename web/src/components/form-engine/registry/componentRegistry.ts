import React from "react";
import type { RaosFieldSchema, FieldState } from "../types.js";

export interface FieldRendererProps {
  schema: RaosFieldSchema;
  name: string;
  value: any;
  onChange: (value: any) => void;
  onBlur: () => void;
  formData: Record<string, any>;
  fieldState: FieldState;
  readOnly?: boolean;
  disabled?: boolean;
}

export type FieldComponent = React.FC<FieldRendererProps>;

const registry = new Map<string, FieldComponent>();

export { registry };

export function registerComponent(name: string, component: FieldComponent): void {
  registry.set(name, component);
}

export function getComponent(name: string): FieldComponent {
  const component = registry.get(name);
  if (!component) {
    throw new Error(`Component "${name}" not found in registry`);
  }
  return component;
}

export function hasComponent(name: string): boolean {
  return registry.has(name);
}

export function listComponents(): string[] {
  return Array.from(registry.keys());
}

const PlaceholderInput: FieldComponent = () => React.createElement("input", null);
registerComponent("input", PlaceholderInput);
