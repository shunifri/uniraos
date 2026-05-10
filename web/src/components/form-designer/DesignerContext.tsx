/**
 * Form Designer - React Context & Reducer
 */

import React, { createContext, useContext, useReducer, useCallback } from "react";
import type { RaosFormSchema } from "@/components/form-engine/types";
import type { DesignerState, DesignerAction, FormMeta } from "./types";

const DEFAULT_SCHEMA: RaosFormSchema = {
  type: "object",
  title: "新建表单",
  properties: {},
  layout: {
    type: "vertical",
  },
};

const DEFAULT_META: FormMeta = {
  key: "",
  name: "新建表单",
  description: "",
};

const initialState: DesignerState = {
  schema: DEFAULT_SCHEMA,
  selectedFieldKey: null,
  formMeta: DEFAULT_META,
  isDirty: false,
  isLoading: false,
  error: null,
};

function designerReducer(state: DesignerState, action: DesignerAction): DesignerState {
  switch (action.type) {
    case "SET_SCHEMA": {
      return { ...state, schema: action.schema, isDirty: true };
    }

    case "ADD_FIELD": {
      const properties = { ...state.schema.properties };
      if (action.index !== undefined && action.index >= 0) {
        const entries = Object.entries(properties);
        entries.splice(action.index, 0, [action.fieldKey, action.schema]);
        const newProperties: Record<string, any> = {};
        entries.forEach(([k, v]) => {
          newProperties[k] = v;
        });
        return {
          ...state,
          schema: { ...state.schema, properties: newProperties },
          selectedFieldKey: action.fieldKey,
          isDirty: true,
        };
      }
      return {
        ...state,
        schema: {
          ...state.schema,
          properties: { ...properties, [action.fieldKey]: action.schema },
        },
        selectedFieldKey: action.fieldKey,
        isDirty: true,
      };
    }

    case "UPDATE_FIELD": {
      if (!state.schema.properties[action.fieldKey]) return state;
      return {
        ...state,
        schema: {
          ...state.schema,
          properties: {
            ...state.schema.properties,
            [action.fieldKey]: action.schema,
          },
        },
        isDirty: true,
      };
    }

    case "REMOVE_FIELD": {
      const properties = { ...state.schema.properties };
      delete properties[action.fieldKey];
      return {
        ...state,
        schema: { ...state.schema, properties },
        selectedFieldKey: state.selectedFieldKey === action.fieldKey ? null : state.selectedFieldKey,
        isDirty: true,
      };
    }

    case "MOVE_FIELD": {
      const entries = Object.entries(state.schema.properties);
      const idx = entries.findIndex(([k]) => k === action.fieldKey);
      if (idx === -1) return state;

      const newIdx = action.direction === "up" ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= entries.length) return state;

      [entries[idx], entries[newIdx]] = [entries[newIdx], entries[idx]];
      const newProperties: Record<string, any> = {};
      entries.forEach(([k, v]) => {
        newProperties[k] = v;
      });
      return {
        ...state,
        schema: { ...state.schema, properties: newProperties },
        isDirty: true,
      };
    }

    case "SELECT_FIELD": {
      return { ...state, selectedFieldKey: action.fieldKey };
    }

    case "SET_FORM_META": {
      return {
        ...state,
        formMeta: { ...state.formMeta, ...action.meta },
        isDirty: true,
      };
    }

    case "SET_DIRTY": {
      return { ...state, isDirty: action.isDirty };
    }

    case "SET_LOADING": {
      return { ...state, isLoading: action.isLoading };
    }

    case "SET_ERROR": {
      return { ...state, error: action.error };
    }

    case "NEW_FORM": {
      return {
        ...initialState,
        schema: {
          ...DEFAULT_SCHEMA,
          title: "新建表单",
        },
      };
    }

    case "LOAD_FORM": {
      return {
        ...state,
        schema: action.schema,
        formMeta: action.meta,
        selectedFieldKey: null,
        isDirty: false,
        error: null,
      };
    }

    case "REORDER_FIELDS": {
      const newProperties: Record<string, any> = {};
      action.keys.forEach((k) => {
        if (state.schema.properties[k]) {
          newProperties[k] = state.schema.properties[k];
        }
      });
      return {
        ...state,
        schema: { ...state.schema, properties: newProperties },
        isDirty: true,
      };
    }

    default:
      return state;
  }
}

interface DesignerContextValue {
  state: DesignerState;
  dispatch: React.Dispatch<DesignerAction>;
  addField: (type: string, index?: number) => void;
  updateField: (fieldKey: string, schema: any) => void;
  removeField: (fieldKey: string) => void;
  moveField: (fieldKey: string, direction: "up" | "down") => void;
  reorderFields: (keys: string[]) => void;
  selectField: (fieldKey: string | null) => void;
  setFormMeta: (meta: Partial<FormMeta>) => void;
  setSchema: (schema: RaosFormSchema) => void;
  newForm: () => void;
  loadForm: (schema: RaosFormSchema, meta: FormMeta) => void;
}

const DesignerContext = createContext<DesignerContextValue | null>(null);

export function DesignerProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(designerReducer, initialState);

  const addField = useCallback(
    (type: string, index?: number) => {
      import("./constants").then(({ getFieldTemplate, generateFieldKey }) => {
        const template = getFieldTemplate(type);
        if (!template) return;
        const existingKeys = Object.keys(state.schema.properties);
        const fieldKey = generateFieldKey(type, existingKeys);
        dispatch({
          type: "ADD_FIELD",
          fieldKey,
          schema: { ...template.defaultSchema },
          index,
        });
      });
    },
    [state.schema.properties]
  );

  const updateField = useCallback((fieldKey: string, schema: any) => {
    dispatch({ type: "UPDATE_FIELD", fieldKey, schema });
  }, []);

  const removeField = useCallback((fieldKey: string) => {
    dispatch({ type: "REMOVE_FIELD", fieldKey });
  }, []);

  const moveField = useCallback((fieldKey: string, direction: "up" | "down") => {
    dispatch({ type: "MOVE_FIELD", fieldKey, direction });
  }, []);

  const selectField = useCallback((fieldKey: string | null) => {
    dispatch({ type: "SELECT_FIELD", fieldKey });
  }, []);

  const setFormMeta = useCallback((meta: Partial<FormMeta>) => {
    dispatch({ type: "SET_FORM_META", meta });
  }, []);

  const setSchema = useCallback((schema: RaosFormSchema) => {
    dispatch({ type: "SET_SCHEMA", schema });
  }, []);

  const newForm = useCallback(() => {
    dispatch({ type: "NEW_FORM" });
  }, []);

  const loadForm = useCallback((schema: RaosFormSchema, meta: FormMeta) => {
    dispatch({ type: "LOAD_FORM", schema, meta });
  }, []);

  const reorderFields = useCallback((keys: string[]) => {
    dispatch({ type: "REORDER_FIELDS", keys });
  }, []);

  return (
    <DesignerContext.Provider
      value={{
        state,
        dispatch,
        addField,
        updateField,
        removeField,
        moveField,
        reorderFields,
        selectField,
        setFormMeta,
        setSchema,
        newForm,
        loadForm,
      }}
    >
      {children}
    </DesignerContext.Provider>
  );
}

export function useDesigner() {
  const ctx = useContext(DesignerContext);
  if (!ctx) throw new Error("useDesigner must be used within DesignerProvider");
  return ctx;
}
