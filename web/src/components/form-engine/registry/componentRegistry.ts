import React from "react";
import type { RaosFieldSchema, FieldState } from "../types.js";
import { TextInput } from "../components/TextInput.js";
import { TextArea } from "../components/TextArea.js";
import { NumberInput } from "../components/NumberInput.js";
import { PasswordInput } from "../components/PasswordInput.js";
import { SelectInput } from "../components/SelectInput.js";
import { RadioGroup } from "../components/RadioGroup.js";
import { CheckboxGroup } from "../components/CheckboxGroup.js";
import { SwitchInput } from "../components/SwitchInput.js";
import { DatePickerField } from "../components/DatePickerField.js";
import { DateRangePickerField } from "../components/DateRangePickerField.js";
import { TimePickerField } from "../components/TimePickerField.js";

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

registerComponent("input", TextInput);
registerComponent("textarea", TextArea);
registerComponent("number", NumberInput);
registerComponent("password", PasswordInput);
registerComponent("select", SelectInput);
registerComponent("radio", RadioGroup);
registerComponent("checkbox", CheckboxGroup);
registerComponent("switch", SwitchInput);
registerComponent("datePicker", DatePickerField);
registerComponent("dateRange", DateRangePickerField);
registerComponent("timePicker", TimePickerField);
