import React from "react";
import { Input } from "antd";
import type { FieldRendererProps } from "../registry/componentRegistry.js";

export const TextInput: React.FC<FieldRendererProps> = ({
  schema,
  name,
  value,
  onChange,
  onBlur,
  formData,
  fieldState,
  readOnly,
  disabled,
  ...rest
}) => {
  return (
    <Input
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={schema["ui:placeholder"]}
      disabled={fieldState.disabled || disabled}
      readOnly={fieldState.readonly || readOnly}
      status={fieldState.errors?.length ? "error" : undefined}
      {...(schema["ui:props"] || {})}
      {...rest}
    />
  );
};
