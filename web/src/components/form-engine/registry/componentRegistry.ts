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
import { DateTimeRangePickerField } from "../components/DateTimeRangePickerField.js";
import { TimePickerField } from "../components/TimePickerField.js";
import { UserPicker } from "../components/UserPicker.js";
import { DeptPicker } from "../components/DeptPicker.js";
import { FileUploader } from "../components/FileUploader.js";
import { ArrayField } from "../components/ArrayField.js";
import { GroupField } from "../components/GroupField.js";
import { TableField } from "../components/TableField.js";

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

export interface ComponentMeta {
  name: string;
  displayName: string;
  description?: string;
  icon?: string;
  category?: string;
  defaultProps?: Record<string, any>;
  configSchema?: RaosFieldSchema;
}

export interface AsyncComponentModule {
  default: FieldComponent;
  meta?: ComponentMeta;
}

export type ComponentLoader = () => Promise<AsyncComponentModule>;

interface RegistryEntry {
  component?: FieldComponent;
  loader?: ComponentLoader;
  meta?: ComponentMeta;
  loaded: boolean;
  loading?: Promise<FieldComponent>;
}

const registry = new Map<string, RegistryEntry>();

export function registerComponent(name: string, component: FieldComponent, meta?: ComponentMeta): void {
  registry.set(name, { component, meta, loaded: true });
}

export function registerAsyncComponent(name: string, loader: ComponentLoader, meta?: ComponentMeta): void {
  registry.set(name, { loader, meta, loaded: false });
}

export function hasComponent(name: string): boolean {
  return registry.has(name);
}

export function listComponents(): string[] {
  return Array.from(registry.keys());
}

export function listComponentMeta(): ComponentMeta[] {
  const result: ComponentMeta[] = [];
  for (const [name, entry] of registry.entries()) {
    result.push(entry.meta ? { ...entry.meta, name } : { name, displayName: name });
  }
  return result;
}

export function getComponentMeta(name: string): ComponentMeta | undefined {
  const entry = registry.get(name);
  return entry?.meta ? { ...entry.meta, name } : undefined;
}

export async function getComponentAsync(name: string): Promise<FieldComponent> {
  const entry = registry.get(name);
  if (!entry) throw new Error(`Component "${name}" not found in registry`);
  if (entry.loaded && entry.component) return entry.component;
  if (entry.loading) return entry.loading;
  if (entry.loader) {
    const promise = entry.loader().then((mod) => {
      entry.component = mod.default;
      entry.loaded = true;
      entry.loading = undefined;
      if (mod.meta) entry.meta = { ...mod.meta, name };
      return mod.default;
    });
    entry.loading = promise;
    return promise;
  }
  throw new Error(`Component "${name}" has no loader or component`);
}

export function getComponent(name: string): FieldComponent {
  const entry = registry.get(name);
  if (!entry) throw new Error(`Component "${name}" not found in registry`);
  if (entry.component) return entry.component;
  throw new Error(`Component "${name}" is async and not loaded. Use getComponentAsync instead.`);
}

export async function loadExternalComponent(url: string, name?: string): Promise<void> {
  const mod = await import(/* @vite-ignore */ url) as AsyncComponentModule;
  const componentName = name || mod.meta?.name || url.split("/").pop()?.replace(/\.[^.]+$/, "") || "custom";
  if (!mod.default) throw new Error(`External module ${url} does not export a default component`);
  registerComponent(componentName, mod.default, mod.meta);
}

registerComponent("input", TextInput, { name: "input", displayName: "Text Input", category: "basic" });
registerComponent("textarea", TextArea, { name: "textarea", displayName: "Text Area", category: "basic" });
registerComponent("number", NumberInput, { name: "number", displayName: "Number", category: "basic" });
registerComponent("password", PasswordInput, { name: "password", displayName: "Password", category: "basic" });
registerComponent("select", SelectInput, { name: "select", displayName: "Select", category: "basic" });
registerComponent("radio", RadioGroup, { name: "radio", displayName: "Radio", category: "basic" });
registerComponent("checkbox", CheckboxGroup, { name: "checkbox", displayName: "Checkbox", category: "basic" });
registerComponent("switch", SwitchInput, { name: "switch", displayName: "Switch", category: "basic" });
registerComponent("datePicker", DatePickerField, { name: "datePicker", displayName: "Date Picker", category: "basic" });
registerComponent("dateRange", DateRangePickerField, { name: "dateRange", displayName: "Date Range", category: "basic" });
registerComponent("dateTimeRange", DateTimeRangePickerField, { name: "dateTimeRange", displayName: "Date Time Range", category: "basic" });
registerComponent("timePicker", TimePickerField, { name: "timePicker", displayName: "Time Picker", category: "basic" });
registerComponent("userPicker", UserPicker, { name: "userPicker", displayName: "User Picker", category: "business" });
registerComponent("deptPicker", DeptPicker, { name: "deptPicker", displayName: "Department Picker", category: "business" });
registerComponent("fileUploader", FileUploader, { name: "fileUploader", displayName: "File Uploader", category: "business" });
registerComponent("array", ArrayField, { name: "array", displayName: "Array", category: "advanced" });
registerComponent("group", GroupField, { name: "group", displayName: "Group", category: "advanced" });
registerComponent("table", TableField, { name: "table", displayName: "Table", category: "advanced" });

// Example async component registration (lazy-loaded)
registerAsyncComponent(
  "signaturePad",
  () => import("../examples/SignaturePad"),
  { name: "signaturePad", displayName: "Signature Pad", category: "custom" }
);
