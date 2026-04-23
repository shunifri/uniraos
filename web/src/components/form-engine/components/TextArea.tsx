import React from "react";
import { Input } from "antd";
import type { FieldRendererProps } from "../registry/componentRegistry.js";

export const TextArea: React.FC<FieldRendererProps> = ({
  schema,
  value,
  onChange,
  onBlur,
  fieldState,
}) => {
  const uiProps = schema["ui:props"] || {};

  return (
    <Input.TextArea
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={schema["ui:placeholder"]}
      disabled={fieldState.disabled}
      readOnly={fieldState.readonly}
      status={fieldState.errors?.length ? "error" : undefined}
      rows={uiProps.rows ?? 3}
      showCount={uiProps.showCount}
      maxLength={uiProps.maxLength ?? schema.maxLength}
      {...uiProps}
    />
  );
};
