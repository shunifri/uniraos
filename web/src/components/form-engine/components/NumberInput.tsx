import React from "react";
import { InputNumber } from "antd";
import type { FieldRendererProps } from "../registry/componentRegistry.js";

export const NumberInput: React.FC<FieldRendererProps> = ({
  schema,
  value,
  onChange,
  onBlur,
  fieldState,
}) => {
  return (
    <InputNumber
      value={value}
      onChange={(val) => onChange(val)}
      onBlur={onBlur}
      placeholder={schema["ui:placeholder"]}
      disabled={fieldState.disabled}
      readOnly={fieldState.readonly}
      status={fieldState.errors?.length ? "error" : undefined}
      min={schema.minimum}
      max={schema.maximum}
      style={{ width: "100%" }}
      {...(schema["ui:props"] || {})}
    />
  );
};
