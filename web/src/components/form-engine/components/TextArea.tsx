import React from "react";
import { Input } from "antd";
import type { FieldRendererProps } from "../registry/componentRegistry.js";

export const TextArea: React.FC<FieldRendererProps> = ({
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
  const uiProps = schema["ui:props"] || {};

  return (
    <Input.TextArea
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={schema["ui:placeholder"]}
      disabled={fieldState.disabled || disabled}
      readOnly={fieldState.readonly || readOnly}
      status={fieldState.errors?.length ? "error" : undefined}
      rows={uiProps.rows ?? 3}
      showCount={uiProps.showCount}
      maxLength={uiProps.maxLength ?? schema.maxLength}
      {...uiProps}
      {...rest}
    />
  );
};
