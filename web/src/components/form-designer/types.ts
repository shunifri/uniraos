/**
 * Form Designer - Type Definitions
 */

import type { RaosFormSchema, RaosFieldSchema } from "@/components/form-engine/types";

export interface FieldCategory {
  key: string;
  label: string;
  icon: string;
}

export interface FieldTemplate {
  type: string;
  label: string;
  icon: string;
  category: string;
  defaultSchema: RaosFieldSchema;
}

export interface DesignerField {
  key: string;
  schema: RaosFieldSchema;
}

export interface FormMeta {
  key: string;
  name: string;
  description: string;
}

export interface DesignerState {
  schema: RaosFormSchema;
  selectedFieldKey: string | null;
  formMeta: FormMeta;
  isDirty: boolean;
  isLoading: boolean;
  error: string | null;
}

export type DesignerAction =
  | { type: "SET_SCHEMA"; schema: RaosFormSchema }
  | { type: "ADD_FIELD"; fieldKey: string; schema: RaosFieldSchema; index?: number }
  | { type: "UPDATE_FIELD"; fieldKey: string; schema: RaosFieldSchema }
  | { type: "REMOVE_FIELD"; fieldKey: string }
  | { type: "MOVE_FIELD"; fieldKey: string; direction: "up" | "down" }
  | { type: "SELECT_FIELD"; fieldKey: string | null }
  | { type: "SET_FORM_META"; meta: Partial<FormMeta> }
  | { type: "SET_DIRTY"; isDirty: boolean }
  | { type: "SET_LOADING"; isLoading: boolean }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "NEW_FORM" }
  | { type: "LOAD_FORM"; schema: RaosFormSchema; meta: FormMeta }
  | { type: "REORDER_FIELDS"; keys: string[] };
