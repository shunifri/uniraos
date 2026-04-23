import React from "react";
import { Input } from "antd";
import type { FieldRendererProps } from "../registry/componentRegistry.js";

export const TextInput: React.FC<FieldRendererProps> = ({
  schema,
  value,
  onChange,
  onBlur,
  fieldState,
}) => {
  return (
    <Input
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={schema["ui:placeholder"]}
      disabled={fieldState.disabled}
      readOnly={fieldState.readonly}
      status={fieldState.errors?.length ? "error" : undefined}
      {...(schema["ui:props"] || {})}
    />
  );
};
